import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getFrontmostAppName, getPermissionStatus } from "./macos.js";

const execFileAsync = promisify(execFile);

export type AccessibilityActionResult = {
  success: boolean;
  observed_state: string;
  error: string | null;
};

function ok(observed_state: string): AccessibilityActionResult {
  return {
    success: true,
    observed_state,
    error: null
  };
}

function fail(observed_state: string, error: unknown): AccessibilityActionResult {
  return {
    success: false,
    observed_state,
    error: String(error ?? "error")
  };
}

function assertMacOS(): void {
  if (process.platform !== "darwin") {
    throw new Error("platform_not_supported: accessibility tools currently require macOS");
  }
}

function escapeAppleScriptString(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function runAppleScript(lines: string[]): Promise<string> {
  const args: string[] = [];
  for (const line of lines) args.push("-e", line);
  const { stdout } = await execFileAsync("osascript", args);
  return stdout.trim();
}

async function ensureAccessibilityPermission(): Promise<void> {
  const status = await getPermissionStatus();
  if (!status.platform_supported) throw new Error("platform_not_supported");
  if (status.accessibility !== true) {
    throw new Error(
      "accessibility_not_enabled: enable Accessibility for your terminal in System Settings > Privacy & Security > Accessibility"
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isFrontmostMatch(args: { expected: string; actual: string | null }): boolean {
  if (!args.actual) return false;
  const expected = args.expected.trim().toLowerCase();
  const actual = args.actual.trim().toLowerCase();
  return expected === actual || expected.includes(actual) || actual.includes(expected);
}

function normalizeMenuPath(menuPath: string[]): string[] {
  const path = menuPath.map((part) => part.trim()).filter(Boolean);
  if (path.length < 2) throw new Error("invalid_menu_path: expected at least [Menu, Item]");
  return path;
}

function buildMenuClickCommand(menuPath: string[]): string {
  const [menuBarItem, ...items] = menuPath;
  let chain = `menu bar item "${escapeAppleScriptString(menuBarItem)}" of menu bar 1`;
  if (items.length > 1) {
    for (const item of items.slice(0, -1)) {
      chain = `menu item "${escapeAppleScriptString(item)}" of menu 1 of ${chain}`;
    }
  }
  const target = items[items.length - 1];
  return `click menu item "${escapeAppleScriptString(target)}" of menu 1 of ${chain}`;
}

type KeyAction = {
  keyCode?: number;
  keystroke?: string;
  modifiers: string[];
};

const modifierMap: Record<string, string> = {
  cmd: "command down",
  command: "command down",
  ctrl: "control down",
  control: "control down",
  option: "option down",
  alt: "option down",
  shift: "shift down"
};

const specialKeyCodeMap: Record<string, number> = {
  enter: 36,
  return: 36,
  tab: 48,
  space: 49,
  delete: 51,
  backspace: 51,
  escape: 53,
  esc: 53,
  left: 123,
  right: 124,
  down: 125,
  up: 126
};

function parseKeyAction(keySpec: string): KeyAction {
  const tokens = keySpec
    .split("+")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  if (!tokens.length) throw new Error(`invalid_key_spec:${keySpec}`);

  const key = tokens[tokens.length - 1];
  const modifiers = tokens
    .slice(0, -1)
    .map((token) => modifierMap[token])
    .filter(Boolean);

  const specialCode = specialKeyCodeMap[key];
  if (typeof specialCode === "number") {
    return { keyCode: specialCode, modifiers };
  }
  if (key.length === 1) {
    return { keystroke: key, modifiers };
  }
  throw new Error(`unsupported_key_spec:${keySpec}`);
}

function buildKeyCommand(action: KeyAction): string {
  const using = action.modifiers.length ? ` using {${action.modifiers.join(", ")}}` : "";
  if (typeof action.keyCode === "number") return `key code ${action.keyCode}${using}`;
  if (typeof action.keystroke === "string") {
    return `keystroke "${escapeAppleScriptString(action.keystroke)}"${using}`;
  }
  throw new Error("invalid_key_action");
}

export async function focusApp(appName: string): Promise<AccessibilityActionResult> {
  try {
    assertMacOS();
    await ensureAccessibilityPermission();
    await runAppleScript([`tell application "${escapeAppleScriptString(appName)}" to activate`]);
    await sleep(180);
    const frontmost = await getFrontmostAppName();
    if (!isFrontmostMatch({ expected: appName, actual: frontmost })) {
      return fail(
        `focus_app_failed: expected='${appName}' frontmost='${frontmost ?? "unknown"}'`,
        "frontmost_mismatch"
      );
    }
    return ok(`focus_app_ok: frontmost='${frontmost ?? appName}'`);
  } catch (error) {
    return fail(`focus_app_failed: app='${appName}'`, error);
  }
}

export async function clickMenu(args: {
  menuPath: string[];
  appName?: string;
}): Promise<AccessibilityActionResult> {
  try {
    assertMacOS();
    await ensureAccessibilityPermission();
    const path = normalizeMenuPath(args.menuPath);
    const frontmost = await getFrontmostAppName();
    const appName = (args.appName ?? frontmost ?? "").trim();
    if (!appName) return fail("click_menu_failed: no_frontmost_app", "no_frontmost_app");
    const command = buildMenuClickCommand(path);
    await runAppleScript([
      'tell application "System Events"',
      `  tell process "${escapeAppleScriptString(appName)}"`,
      `    ${command}`,
      "  end tell",
      "end tell"
    ]);
    return ok(`click_menu_ok: app='${appName}' menu='${path.join(" > ")}'`);
  } catch (error) {
    return fail(`click_menu_failed: menu='${args.menuPath.join(" > ")}'`, error);
  }
}

export async function typeText(text: string): Promise<AccessibilityActionResult> {
  try {
    assertMacOS();
    await ensureAccessibilityPermission();
    await runAppleScript([
      `set auraText to "${escapeAppleScriptString(text)}"`,
      'tell application "System Events"',
      "  keystroke auraText",
      "end tell"
    ]);
    return ok(`type_text_ok: chars=${text.length}`);
  } catch (error) {
    return fail(`type_text_failed: chars=${text.length}`, error);
  }
}

export async function pressKeys(keys: string[]): Promise<AccessibilityActionResult> {
  try {
    assertMacOS();
    await ensureAccessibilityPermission();
    const normalized = keys.map((item) => item.trim()).filter(Boolean);
    if (!normalized.length) return fail("press_key_failed: empty_keys", "invalid_keys");
    const keyCommands = normalized.map((keySpec) => buildKeyCommand(parseKeyAction(keySpec)));
    await runAppleScript(['tell application "System Events"', ...keyCommands.map((cmd) => `  ${cmd}`), "end tell"]);
    return ok(`press_key_ok: keys='${normalized.join(",")}'`);
  } catch (error) {
    return fail(`press_key_failed: keys='${keys.join(",")}'`, error);
  }
}
