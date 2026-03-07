import { FunctionTool } from "@google/adk";
import { z } from "zod";
import { exec } from "node:child_process";
import { promisify } from "node:util";
const execAsync = promisify(exec);
import { GoogleGenerativeAI } from "@google/generative-ai";
import { captureScreenMimeData } from "./vision.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openApp, openPath, openUrl, getFrontmostAppName, addCalendarEvent } from "./macos.js";
import type { ToolCall, ToolResult } from "./schemas.js";
import {
  browserClickResult,
  browserClickText,
  browserExtractText,
  browserGo,
  browserNewTab,
  browserSearch,
  browserTypeActive
} from "./browserController.js";
import {
  createFolder,
  movePath,
  renamePath,
  searchFiles,
  trashPath
} from "./systemController.js";
import {
  clickMenu,
  focusApp,
  pressKeys,
  typeText
} from "./accessibilityController.js";

type ToolHandler = (args: Record<string, unknown>, opts: { dryRun: boolean }) => Promise<ToolResult>;

export type ToolSchemaDescriptor = {
  description: string;
  args_schema: Record<string, unknown>;
};

export type ExecutedToolResult = {
  requested_tool: string;
  normalized_tool: string;
  result: ToolResult;
};

function ok(observed_state: string): ToolResult {
  return { success: true, observed_state, error: null };
}

function fail(args: { observedState: string; error: unknown }): ToolResult {
  return {
    success: false,
    observed_state: args.observedState,
    error: String(args.error ?? "error")
  };
}

function withVerifiedObservedState(toolName: string, result: ToolResult): ToolResult {
  const observed = (result.observed_state ?? "").trim();
  if (observed.length > 0) return result;
  return fail({
    observedState: `verification_failed: missing observed_state for ${toolName}`,
    error: "missing_observed_state"
  });
}

/** Simple bigram similarity for fuzzy matching app names (0-1 score) */
function fuzzyScore(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const bigrams = (s: string): Set<string> => {
    const bg = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) bg.add(s.slice(i, i + 2));
    return bg;
  };
  const bg1 = bigrams(a);
  const bg2 = bigrams(b);
  let intersection = 0;
  for (const b of bg1) if (bg2.has(b)) intersection++;
  return (2 * intersection) / (bg1.size + bg2.size);
}

const openAppArgs = z.object({ name: z.string().min(1) });
const openPathArgs = z.object({ path: z.string().min(1) });
const openUrlArgs = z.object({ url: z.string().url() });
const searchFilesArgs = z.object({
  query: z.string().min(1).max(200),
  limit: z.coerce.number().int().positive().max(50).optional()
});
const createFolderArgs = z.object({ path: z.string().min(1) });
const renamePathArgs = z.object({
  path: z.string().min(1),
  new_name: z.string().min(1).max(255)
});
const movePathArgs = z.object({
  path: z.string().min(1),
  destination_dir: z.string().min(1)
});
const trashPathArgs = z.object({ path: z.string().min(1) });
const confirmActionArgs = z.object({
  reason: z.string().min(3).max(300)
});
const webSearchArgs = z.object({
  query: z.string().min(1).max(500),
});
const playSpotifyArgs = z.object({
  song: z.string().min(1).max(200),
  artist: z.string().max(200).optional(),
});
const focusAppArgs = z.object({ name: z.string().min(1).max(200) });
const clickMenuArgs = z.object({
  menu_path: z.array(z.string().min(1).max(120)).min(2).max(8),
  app_name: z.string().min(1).max(200).optional()
});
const typeTextArgs = z.object({ text: z.string().min(1).max(4000) });
const pressKeyArgs = z.object({
  keys: z.array(z.string().min(1).max(60)).min(1).max(10)
});
const waitMsArgs = z.object({
  ms: z.coerce.number().int().min(1).max(30000)
});
const browserGoArgs = z.object({ url: z.string().url() });
const browserSearchArgs = z.object({ query: z.string().min(1).max(500) });
const browserClickResultArgs = z.object({ index: z.coerce.number().int().positive() });
const browserClickTextArgs = z.object({ text: z.string().min(1).max(500) });
const browserTypeActiveArgs = z.object({ text: z.string().min(1).max(2000) });
const findAndOpenArgs = z.object({
  query: z.string().min(1).max(200),
  root: z.string().optional()
});
const showContextPanelArgs = z.object({
  text: z.string().max(8000).optional(),
  content: z.string().max(8000).optional(),
  title: z.string().max(100).optional()
}).refine(data => data.text || data.content, {
  message: "Either 'text' or 'content' must be provided",
});
const addCalendarEventArgs = z.object({
  title: z.string().min(1).max(200),
  start_date_iso: z.string().datetime(),
  end_date_iso: z.string().datetime(),
  notes: z.string().max(1000).optional()
});

export const toolSchemas: Record<string, ToolSchemaDescriptor> = {
  show_context_panel: {
    description: "Display text in a beautiful Contextual Copilot popover next to the mouse cursor. Use this ONLY when asked to explain, translate, define, rewrite, or otherwise process the user's [Currently Highlighted Text]. Do not use for generic web searches.",
    args_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The answer, explanation, or rewritten text to display. (You can also use 'content' for this)" },
        title: { type: "string", description: "Optional title, like 'Definition' or 'Rewrite'." },
        content: { type: "string", description: "The answer, explanation, or rewritten text to display." }
      }
    }
  },
  open_app: {
    description: "Open a macOS application by name.",
    args_schema: {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string", minLength: 1 } }
    }
  },
  open_path: {
    description: "Open a file or folder path.",
    args_schema: {
      type: "object",
      required: ["path"],
      properties: { path: { type: "string", minLength: 1 } }
    }
  },
  open_url: {
    description: "Open a URL in the default browser.",
    args_schema: {
      type: "object",
      required: ["url"],
      properties: { url: { type: "string", format: "uri" } }
    }
  },
  play_spotify: {
    description: "Search for a song and flawlessly play it natively on Spotify.",
    args_schema: {
      type: "object",
      required: ["song"],
      properties: {
        song: { type: "string", minLength: 1 },
        artist: { type: "string" }
      }
    }
  },
  search_files: {
    description: "Search allowed filesystem roots for names matching a query.",
    args_schema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", minLength: 1 },
        limit: { type: "integer", minimum: 1, maximum: 50 }
      }
    }
  },
  create_folder: {
    description: "Create a folder path inside allowed filesystem roots.",
    args_schema: {
      type: "object",
      required: ["path"],
      properties: { path: { type: "string", minLength: 1 } }
    }
  },
  rename_path: {
    description: "Rename a file or folder by new basename.",
    args_schema: {
      type: "object",
      required: ["path", "new_name"],
      properties: {
        path: { type: "string", minLength: 1 },
        new_name: { type: "string", minLength: 1 }
      }
    }
  },
  move_path: {
    description: "Move a file/folder into a destination directory.",
    args_schema: {
      type: "object",
      required: ["path", "destination_dir"],
      properties: {
        path: { type: "string", minLength: 1 },
        destination_dir: { type: "string", minLength: 1 }
      }
    }
  },
  trash_path: {
    description: "Move a file/folder to trash. Requires confirm_action first.",
    args_schema: {
      type: "object",
      required: ["path"],
      properties: {
        path: { type: "string", minLength: 1 }
      }
    }
  },
  confirm_action: {
    description: "Grant one-time confirmation for the next destructive action.",
    args_schema: {
      type: "object",
      required: ["reason"],
      properties: {
        reason: { type: "string", minLength: 3 }
      }
    }
  },
  web_search: {
    description: "Search the web for real-time information, news, current events, weather, or facts. Returns a summarized answer.",
    args_schema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", minLength: 1, maxLength: 500 }
      }
    }
  },
  add_calendar_event: {
    description: "Add a new event to the macOS Calendar app. Requires standard ISO-8601 date strings for start and end times in the user's local timezone.",
    args_schema: {
      type: "object",
      required: ["title", "start_date_iso", "end_date_iso"],
      properties: {
        title: { type: "string", minLength: 1, maxLength: 200 },
        start_date_iso: { type: "string", format: "date-time" },
        end_date_iso: { type: "string", format: "date-time" },
        notes: { type: "string", maxLength: 1000 }
      }
    }
  },
  focus_app: {
    description: "Focus an application via macOS Accessibility APIs.",
    args_schema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", minLength: 1 }
      }
    }
  },
  click_menu: {
    description: "Click a menu item path in the focused app (e.g. [\"Edit\", \"Copy\"]).",
    args_schema: {
      type: "object",
      required: ["menu_path"],
      properties: {
        menu_path: {
          type: "array",
          minItems: 2,
          items: { type: "string", minLength: 1 }
        },
        app_name: { type: "string", minLength: 1 }
      }
    }
  },
  type_text: {
    description: "Type text into the currently focused UI element via Accessibility.",
    args_schema: {
      type: "object",
      required: ["text"],
      properties: {
        text: { type: "string", minLength: 1 }
      }
    }
  },
  press_key: {
    description: "Press one or more key chords via Accessibility (e.g. [\"cmd+c\"]).",
    args_schema: {
      type: "object",
      required: ["keys"],
      properties: {
        keys: {
          type: "array",
          minItems: 1,
          items: { type: "string", minLength: 1 }
        }
      }
    }
  },
  wait_ms: {
    description: "Wait for a bounded duration in milliseconds.",
    args_schema: {
      type: "object",
      required: ["ms"],
      properties: {
        ms: { type: "integer", minimum: 1, maximum: 30000 }
      }
    }
  },
  browser_new_tab: {
    description: "Open a new browser tab in the automation controller.",
    args_schema: {
      type: "object",
      properties: {}
    }
  },
  browser_go: {
    description: "Navigate active automation tab to a URL and verify page readiness.",
    args_schema: {
      type: "object",
      required: ["url"],
      properties: { url: { type: "string", format: "uri" } }
    }
  },
  browser_search: {
    description: "Submit a search query in the current page context.",
    args_schema: {
      type: "object",
      required: ["query"],
      properties: { query: { type: "string", minLength: 1 } }
    }
  },
  browser_click_result: {
    description: "Click a search result link by 1-based index.",
    args_schema: {
      type: "object",
      required: ["index"],
      properties: { index: { type: "integer", minimum: 1 } }
    }
  },
  browser_extract_text: {
    description: "Extract visible text from current page with verification summary.",
    args_schema: {
      type: "object",
      properties: {}
    }
  },
  browser_click_text: {
    description: "Click the first clickable element containing the provided text.",
    args_schema: {
      type: "object",
      required: ["text"],
      properties: { text: { type: "string", minLength: 1 } }
    }
  },
  browser_type_active: {
    description: "Type text into the currently focused element in automation context.",
    args_schema: {
      type: "object",
      required: ["text"],
      properties: { text: { type: "string", minLength: 1 } }
    }
  },
  browser_extract_visible_text: {
    description: "Alias for browser_extract_text.",
    args_schema: {
      type: "object",
      properties: {}
    }
  },
  find_and_open: {
    description: "Search for a file or folder by name and open the best match. Use when user references a specific file/folder name.",
    args_schema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", minLength: 1 },
        root: { type: "string", description: "Optional subfolder to search within, e.g. 'Documents'" }
      }
    }
  }
};

const toolNameAliases: Record<string, string> = {
  open_application: "open_app",
  launch_app: "open_app",
  open_folder: "open_path",
  open_file: "open_path",
  navigate_url: "open_url",
  open_website: "open_url",
  file_search: "search_files",
  find_files: "search_files",
  create_directory: "create_folder",
  make_folder: "create_folder",
  rename_file: "rename_path",
  rename_folder: "rename_path",
  move_file: "move_path",
  move_folder: "move_path",
  delete_file: "trash_path",
  delete_path: "trash_path",
  confirm_destructive_action: "confirm_action",
  focus_application: "focus_app",
  press_keys: "press_key",
  click_menu_item: "click_menu",
  click_result: "browser_click_result",
  browser_extract_visible_text: "browser_extract_text",
  search_and_open: "find_and_open",
  locate_and_open: "find_and_open"
};

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function extractFirstUrl(input: string): string | null {
  const match = input.match(/https?:\/\/[^\s"']+/i);
  return match ? match[0] : null;
}

function extractOpenTarget(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed.toLowerCase().startsWith("open ")) return null;
  const withoutOpen = trimmed.slice(5).trim();
  if (!withoutOpen) return null;
  return stripWrappingQuotes(withoutOpen);
}

function extractOpenAppName(command: string): string | null {
  const match = command.match(/open\s+-a\s+("[^"]+"|'[^']+'|[^\s]+)/i);
  if (!match?.[1]) return null;
  return stripWrappingQuotes(match[1]);
}

function normalizeExecuteCommandCall(call: ToolCall): ToolCall | null {
  if (call.name !== "execute_command") return null;
  const args = { ...(call.args ?? {}) };
  const command =
    (typeof args.command === "string" && args.command) ||
    (typeof args.cmd === "string" && args.cmd) ||
    "";
  if (!command.trim()) return null;

  const url = extractFirstUrl(command);
  if (url) {
    return { name: "open_url", args: { url } };
  }

  const openAppName = extractOpenAppName(command);
  if (openAppName) {
    return { name: "open_app", args: { name: openAppName } };
  }

  const openTarget = extractOpenTarget(command);
  if (openTarget) {
    return { name: "open_path", args: { path: openTarget } };
  }

  return null;
}

function normalizeComputerToolCall(call: ToolCall): ToolCall | null {
  if (call.name !== "computer") return null;
  const args = { ...(call.args ?? {}) };
  const action = typeof args.action === "string" ? args.action.trim().toLowerCase() : "";

  if (action === "key" || action === "keypress" || action === "hotkey") {
    const text = typeof args.text === "string" ? args.text : "";
    const arrayKeys = Array.isArray(args.keys)
      ? args.keys.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
      : [];
    const textKeys = text
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const keys = arrayKeys.length ? arrayKeys : textKeys;
    return { name: "press_key", args: { keys } };
  }

  if (action === "type" || action === "input") {
    const text =
      (typeof args.text === "string" && args.text) ||
      (typeof args.value === "string" && args.value) ||
      "";
    return { name: "type_text", args: { text } };
  }

  if (action === "wait") {
    const ms =
      (typeof args.ms === "number" && Number.isFinite(args.ms) && args.ms) ||
      (typeof args.duration_ms === "number" && Number.isFinite(args.duration_ms) && args.duration_ms) ||
      0;
    return { name: "wait_ms", args: { ms } };
  }

  if (action === "open_url" || action === "navigate") {
    const url =
      (typeof args.url === "string" && args.url) ||
      (typeof args.text === "string" && args.text) ||
      "";
    return { name: "open_url", args: { url } };
  }

  if (action === "click") {
    const text =
      (typeof args.text === "string" && args.text) ||
      (typeof args.target === "string" && args.target) ||
      "";
    return { name: "browser_click_text", args: { text } };
  }

  return null;
}

function normalizeToolCall(call: ToolCall): ToolCall {
  const executeMapped = normalizeExecuteCommandCall(call);
  const computerMapped = normalizeComputerToolCall(executeMapped ?? call);
  const baseCall = computerMapped ?? executeMapped ?? call;

  const mappedName = toolNameAliases[baseCall.name] ?? baseCall.name;
  const args = { ...(baseCall.args ?? {}) };

  if (mappedName === "open_app") {
    const alias = typeof args.app_name === "string" ? args.app_name : undefined;
    if (alias && !args.name) args.name = alias;
  }

  if (mappedName === "open_path") {
    const alias =
      (typeof args.folder_path === "string" && args.folder_path) ||
      (typeof args.file_path === "string" && args.file_path) ||
      (typeof args.target_path === "string" && args.target_path);
    if (alias && !args.path) args.path = alias;
  }

  if (mappedName === "open_url") {
    const alias =
      (typeof args.website === "string" && args.website) ||
      (typeof args.target_url === "string" && args.target_url);
    if (alias && !args.url) args.url = alias;
  }

  if (mappedName === "rename_path") {
    const alias =
      (typeof args.newName === "string" && args.newName) ||
      (typeof args.name === "string" && args.name);
    if (alias && !args.new_name) args.new_name = alias;
  }

  if (mappedName === "move_path") {
    const alias =
      (typeof args.destination === "string" && args.destination) ||
      (typeof args.target_dir === "string" && args.target_dir);
    if (alias && !args.destination_dir) args.destination_dir = alias;
  }

  if (mappedName === "click_menu") {
    const alias = Array.isArray(args.path) ? args.path : undefined;
    if (alias && !args.menu_path) args.menu_path = alias;
  }

  return { name: mappedName, args };
}

const CONFIRMATION_TTL_MS = 120000;
let destructiveConfirmationExpiresAt = 0;

function grantDestructiveConfirmation(): void {
  destructiveConfirmationExpiresAt = Date.now() + CONFIRMATION_TTL_MS;
}

function consumeDestructiveConfirmation(): boolean {
  if (Date.now() > destructiveConfirmationExpiresAt) return false;
  destructiveConfirmationExpiresAt = 0;
  return true;
}

async function waitForMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export const toolRegistry: Record<string, ToolHandler> = {
  async show_context_panel(args, opts) {
    const parsed = showContextPanelArgs.safeParse(args);
    if (!parsed.success) {
      return fail({ observedState: "validation_failed", error: "invalid_args: " + parsed.error.message });
    }
    if (opts.dryRun) return ok(`dry_run: would show context panel`);
    try {
      const { showContextPanel } = await import("./overlay.js");
      const displayText = parsed.data.text || parsed.data.content || "Empty response";
      showContextPanel({ text: displayText, title: parsed.data.title });
      return ok("Context panel displayed successfully");
    } catch (e: any) {
      return fail({ observedState: "show_context_panel_error", error: e.message });
    }
  },
  async open_app(args, opts) {
    const parsed = openAppArgs.safeParse(args);
    if (!parsed.success) {
      return fail({
        observedState: "validation_failed: invalid_args for open_app",
        error: "invalid_args"
      });
    }
    if (opts.dryRun) return ok(`dry_run: would open app '${parsed.data.name}'`);
    try {
      await openApp(parsed.data.name);
      const front = await getFrontmostAppName();
      return ok(`opened app '${parsed.data.name}'; frontmost=${front ?? "unknown"}`);
    } catch (error) {
      // App not found — try fuzzy matching with Spotlight
      try {
        const { execFile: ef } = await import("node:child_process");
        const { promisify: pm } = await import("node:util");
        const execFileAsync = pm(ef);
        const { stdout } = await execFileAsync("mdfind", [
          "kMDItemKind == 'Application'"
        ], { timeout: 5000 });

        const appNames = stdout.trim().split("\n")
          .map(p => p.split("/").pop()?.replace(/\.app$/, "") ?? "")
          .filter(Boolean);

        // Find best fuzzy match
        const queryLower = parsed.data.name.toLowerCase();
        const matches = appNames
          .map(name => ({
            name,
            score: fuzzyScore(queryLower, name.toLowerCase()),
          }))
          .filter(m => m.score > 0.5)
          .sort((a, b) => b.score - a.score);

        if (matches.length > 0) {
          const bestApp = matches[0].name;
          await openApp(bestApp);
          const front = await getFrontmostAppName();
          return ok(`opened app '${bestApp}' (fuzzy match for '${parsed.data.name}'); frontmost=${front ?? "unknown"}`);
        }
      } catch { /* fuzzy search failed, fall through */ }

      return fail({
        observedState: `open_app_failed: name='${parsed.data.name}'`,
        error: `Could not find application '${parsed.data.name}'`
      });
    }
  },

  async open_path(args, opts) {
    const parsed = openPathArgs.safeParse(args);
    if (!parsed.success) {
      return fail({
        observedState: "validation_failed: invalid_args for open_path",
        error: "invalid_args"
      });
    }
    if (opts.dryRun) return ok(`dry_run: would open path '${parsed.data.path}'`);
    await openPath(parsed.data.path);
    return ok(`opened path '${parsed.data.path}'`);
  },

  async open_url(args, opts) {
    const parsed = openUrlArgs.safeParse(args);
    if (!parsed.success) {
      return fail({
        observedState: "validation_failed: invalid_args for open_url",
        error: "invalid_args"
      });
    }
    if (opts.dryRun) return ok(`dry_run: would open url '${parsed.data.url}'`);
    await openUrl(parsed.data.url);
    return ok(`opened url '${parsed.data.url}'`);
  },

  async search_files(args, opts) {
    const parsed = searchFilesArgs.safeParse(args);
    if (!parsed.success) {
      return fail({
        observedState: "validation_failed: invalid_args for search_files",
        error: "invalid_args"
      });
    }
    if (opts.dryRun) return ok(`dry_run: would search files query='${parsed.data.query}'`);
    try {
      const result = await searchFiles({
        query: parsed.data.query,
        limit: parsed.data.limit ?? 10
      });
      const sample = result.matches.slice(0, 3).join(" | ") || "none";
      return ok(
        `search_files_ok: query='${result.query}' matches=${result.matches.length} scanned=${result.scanned} sample=${sample}`
      );
    } catch (error) {
      return fail({
        observedState: `search_files_failed: query='${parsed.data.query}'`,
        error
      });
    }
  },

  async create_folder(args, opts) {
    const parsed = createFolderArgs.safeParse(args);
    if (!parsed.success) {
      return fail({
        observedState: "validation_failed: invalid_args for create_folder",
        error: "invalid_args"
      });
    }
    if (opts.dryRun) return ok(`dry_run: would create folder '${parsed.data.path}'`);
    try {
      const created = await createFolder(parsed.data.path);
      return ok(`create_folder_ok: path='${created.path}'`);
    } catch (error) {
      return fail({
        observedState: `create_folder_failed: path='${parsed.data.path}'`,
        error
      });
    }
  },

  async rename_path(args, opts) {
    const parsed = renamePathArgs.safeParse(args);
    if (!parsed.success) {
      return fail({
        observedState: "validation_failed: invalid_args for rename_path",
        error: "invalid_args"
      });
    }
    if (opts.dryRun) return ok(`dry_run: would rename path '${parsed.data.path}' to '${parsed.data.new_name}'`);
    try {
      const renamed = await renamePath({ path: parsed.data.path, newName: parsed.data.new_name });
      return ok(`rename_path_ok: from='${renamed.from}' to='${renamed.to}'`);
    } catch (error) {
      return fail({
        observedState: `rename_path_failed: path='${parsed.data.path}'`,
        error
      });
    }
  },

  async move_path(args, opts) {
    const parsed = movePathArgs.safeParse(args);
    if (!parsed.success) {
      return fail({
        observedState: "validation_failed: invalid_args for move_path",
        error: "invalid_args"
      });
    }
    if (opts.dryRun) {
      return ok(`dry_run: would move '${parsed.data.path}' to '${parsed.data.destination_dir}'`);
    }
    try {
      const moved = await movePath({
        path: parsed.data.path,
        destinationDir: parsed.data.destination_dir
      });
      return ok(`move_path_ok: from='${moved.from}' to='${moved.to}'`);
    } catch (error) {
      return fail({
        observedState: `move_path_failed: path='${parsed.data.path}'`,
        error
      });
    }
  },

  async trash_path(args, opts) {
    const parsed = trashPathArgs.safeParse(args);
    if (!parsed.success) {
      return fail({
        observedState: "validation_failed: invalid_args for trash_path",
        error: "invalid_args"
      });
    }
    if (opts.dryRun) {
      return ok(`dry_run: would trash path '${parsed.data.path}' (requires confirm_action for live runs)`);
    }
    if (!consumeDestructiveConfirmation()) {
      return fail({
        observedState: "blocked: confirmation_required for trash_path; call confirm_action first",
        error: "confirmation_required"
      });
    }
    try {
      const trashed = await trashPath(parsed.data.path);
      return ok(`trash_path_ok: from='${trashed.from}' to='${trashed.to}'`);
    } catch (error) {
      return fail({
        observedState: `trash_path_failed: path='${parsed.data.path}'`,
        error
      });
    }
  },

  async confirm_action(args, _opts) {
    const parsed = confirmActionArgs.safeParse(args);
    if (!parsed.success) {
      return fail({
        observedState: "validation_failed: invalid_args for confirm_action",
        error: "invalid_args"
      });
    }
    grantDestructiveConfirmation();
    return ok(`confirmation_granted: ttl_ms=${CONFIRMATION_TTL_MS} reason='${parsed.data.reason}'`);
  },

  async focus_app(args, opts) {
    const parsed = focusAppArgs.safeParse(args);
    if (!parsed.success) {
      return fail({
        observedState: "validation_failed: invalid_args for focus_app",
        error: "invalid_args"
      });
    }
    if (opts.dryRun) return ok(`dry_run: would focus app '${parsed.data.name}'`);
    const out = await focusApp(parsed.data.name);
    if (!out.success) return fail({ observedState: out.observed_state, error: out.error ?? "focus_app_failed" });
    return ok(out.observed_state);
  },

  async click_menu(args, opts) {
    const parsed = clickMenuArgs.safeParse(args);
    if (!parsed.success) {
      return fail({
        observedState: "validation_failed: invalid_args for click_menu",
        error: "invalid_args"
      });
    }
    if (opts.dryRun) return ok(`dry_run: would click menu '${parsed.data.menu_path.join(" > ")}'`);
    const out = await clickMenu({
      menuPath: parsed.data.menu_path,
      appName: parsed.data.app_name
    });
    if (!out.success) return fail({ observedState: out.observed_state, error: out.error ?? "click_menu_failed" });
    return ok(out.observed_state);
  },

  async type_text(args, opts) {
    const parsed = typeTextArgs.safeParse(args);
    if (!parsed.success) {
      return fail({
        observedState: "validation_failed: invalid_args for type_text",
        error: "invalid_args"
      });
    }
    if (opts.dryRun) return ok(`dry_run: would type ${parsed.data.text.length} chars`);
    const out = await typeText(parsed.data.text);
    if (!out.success) return fail({ observedState: out.observed_state, error: out.error ?? "type_text_failed" });
    return ok(out.observed_state);
  },

  async press_key(args, opts) {
    const parsed = pressKeyArgs.safeParse(args);
    if (!parsed.success) {
      return fail({
        observedState: "validation_failed: invalid_args for press_key",
        error: "invalid_args"
      });
    }
    if (opts.dryRun) return ok(`dry_run: would press keys '${parsed.data.keys.join(",")}'`);
    const out = await pressKeys(parsed.data.keys);
    if (!out.success) return fail({ observedState: out.observed_state, error: out.error ?? "press_key_failed" });
    return ok(out.observed_state);
  },

  async wait_ms(args, opts) {
    const parsed = waitMsArgs.safeParse(args);
    if (!parsed.success) {
      return fail({
        observedState: "validation_failed: invalid_args for wait_ms",
        error: "invalid_args"
      });
    }
    if (opts.dryRun) return ok(`dry_run: would wait ${parsed.data.ms}ms`);
    await waitForMs(parsed.data.ms);
    return ok(`wait_ms_ok: ms=${parsed.data.ms}`);
  },

  async browser_new_tab(_args, opts) {
    if (opts.dryRun) return ok("dry_run: would open browser automation tab");
    const out = await browserNewTab();
    if (!out.success) return fail({ observedState: out.observed_state, error: out.error ?? "browser_new_tab_failed" });
    return ok(out.observed_state);
  },

  async browser_go(args, opts) {
    const parsed = browserGoArgs.safeParse(args);
    if (!parsed.success) {
      return fail({
        observedState: "validation_failed: invalid_args for browser_go",
        error: "invalid_args"
      });
    }
    if (opts.dryRun) return ok(`dry_run: would navigate browser to '${parsed.data.url}'`);
    const out = await browserGo(parsed.data.url);
    if (!out.success) return fail({ observedState: out.observed_state, error: out.error ?? "browser_go_failed" });
    return ok(out.observed_state);
  },

  async browser_search(args, opts) {
    const parsed = browserSearchArgs.safeParse(args);
    if (!parsed.success) {
      return fail({
        observedState: "validation_failed: invalid_args for browser_search",
        error: "invalid_args"
      });
    }
    if (opts.dryRun) return ok(`dry_run: would search '${parsed.data.query}'`);
    const out = await browserSearch(parsed.data.query);
    if (!out.success) return fail({ observedState: out.observed_state, error: out.error ?? "browser_search_failed" });
    return ok(out.observed_state);
  },

  async browser_click_result(args, opts) {
    const parsed = browserClickResultArgs.safeParse(args);
    if (!parsed.success) {
      return fail({
        observedState: "validation_failed: invalid_args for browser_click_result",
        error: "invalid_args"
      });
    }
    if (opts.dryRun) return ok(`dry_run: would click result index=${parsed.data.index}`);
    const out = await browserClickResult(parsed.data.index);
    if (!out.success) {
      return fail({
        observedState: out.observed_state,
        error: out.error ?? "browser_click_result_failed"
      });
    }
    return ok(out.observed_state);
  },

  async browser_extract_text(_args, opts) {
    if (opts.dryRun) return ok("dry_run: would extract browser text");
    const out = await browserExtractText();
    if (!out.success) return fail({ observedState: out.observed_state, error: out.error ?? "browser_extract_text_failed" });
    return ok(out.observed_state);
  },

  async browser_click_text(args, opts) {
    const parsed = browserClickTextArgs.safeParse(args);
    if (!parsed.success) {
      return fail({
        observedState: "validation_failed: invalid_args for browser_click_text",
        error: "invalid_args"
      });
    }
    if (opts.dryRun) return ok(`dry_run: would click text '${parsed.data.text}'`);
    const out = await browserClickText(parsed.data.text);
    if (!out.success) return fail({ observedState: out.observed_state, error: out.error ?? "browser_click_text_failed" });
    return ok(out.observed_state);
  },

  async browser_type_active(args, opts) {
    const parsed = browserTypeActiveArgs.safeParse(args);
    if (!parsed.success) {
      return fail({
        observedState: "validation_failed: invalid_args for browser_type_active",
        error: "invalid_args"
      });
    }
    if (opts.dryRun) return ok(`dry_run: would type ${parsed.data.text.length} chars into active field`);
    const out = await browserTypeActive(parsed.data.text);
    if (!out.success) return fail({ observedState: out.observed_state, error: out.error ?? "browser_type_active_failed" });
    return ok(out.observed_state);
  },

  async browser_extract_visible_text(args, opts) {
    return toolRegistry.browser_extract_text(args, opts);
  },

  async find_and_open(args, opts) {
    const parsed = findAndOpenArgs.safeParse(args);
    if (!parsed.success) {
      return fail({
        observedState: "validation_failed: invalid_args for find_and_open",
        error: "invalid_args"
      });
    }
    if (opts.dryRun) return ok(`dry_run: would search for '${parsed.data.query}' and open best match`);
    try {
      const query = parsed.data.query;
      const root = parsed.data.root;

      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);

      const searchDir = root
        ? `${process.env.HOME}/${root}`
        : process.env.HOME ?? "";

      // Generate query variants to handle transcription quirks
      const variants = new Set<string>();
      variants.add(query);                                    // "medical report"
      variants.add(query.replace(/\s+/g, "_"));              // "medical_report"
      variants.add(query.replace(/\s+/g, ""));               // "medicalreport"
      // Also try individual words for partial matching
      const words = query.split(/\s+/).filter(w => w.length > 2);

      let allMatches: string[] = [];

      // Strategy 1: Search by filesystem name (handles underscores)
      for (const variant of variants) {
        try {
          const { stdout } = await execFileAsync("mdfind", [
            "-onlyin", searchDir,
            `kMDItemFSName == "*${variant}*"cd`
          ], { timeout: 5000 });
          const results = stdout.trim().split("\n").filter(Boolean);
          allMatches.push(...results);
        } catch { /* continue */ }
      }

      // Strategy 2: Also search by display name
      try {
        const { stdout } = await execFileAsync("mdfind", [
          "-onlyin", searchDir,
          `kMDItemDisplayName == "*${query}*"cd`
        ], { timeout: 5000 });
        const results = stdout.trim().split("\n").filter(Boolean);
        allMatches.push(...results);
      } catch { /* continue */ }

      // Strategy 3: Full text name search (catches more results)
      try {
        const { stdout } = await execFileAsync("mdfind", [
          "-onlyin", searchDir,
          `-name "${query}"`
        ], { timeout: 5000 });
        const results = stdout.trim().split("\n").filter(Boolean);
        allMatches.push(...results);
      } catch { /* continue */ }

      // Deduplicate
      allMatches = [...new Set(allMatches)];

      // Filter out junk paths (node_modules, .git, dist, build, etc.)
      const junkPatterns = [
        /\/node_modules\//i,
        /\/\.git\//i,
        /\/dist\//i,
        /\/build\//i,
        /\/\.next\//i,
        /\/\.cache\//i,
        /\/\.swc\//i,
        /\/vendor\//i,
      ];
      allMatches = allMatches.filter(m =>
        !junkPatterns.some(pattern => pattern.test(m))
      );

      // Fallback to custom searcher
      if (allMatches.length === 0) {
        const result = await searchFiles({ query, limit: 10 });
        allMatches = result.matches.filter(m =>
          !junkPatterns.some(pattern => pattern.test(m))
        );
      }

      if (allMatches.length === 0) {
        return fail({
          observedState: `find_and_open_no_results: query='${query}'`,
          error: `No files or folders found matching '${query}'`
        });
      }

      // Score matches
      const queryLower = query.toLowerCase();
      const queryNorm = queryLower.replace(/[\s_-]+/g, ""); // normalized: no spaces/underscores
      const scored = allMatches.map(m => {
        const name = m.split('/').pop()?.toLowerCase() ?? '';
        const nameNorm = name.replace(/[\s_\-.]+/g, "").replace(/\.[^.]+$/, ""); // normalized
        const nameNoExt = name.replace(/\.[^.]+$/, '');
        let score = 0;

        // Exact match (normalized)
        if (nameNorm === queryNorm) score = 100;
        // Name starts with query
        else if (nameNorm.startsWith(queryNorm)) score = 85;
        // Name contains full query
        else if (nameNorm.includes(queryNorm)) score = 70;
        // Original name contains original query
        else if (name.includes(queryLower)) score = 60;
        // Check if all query words appear in the name
        else if (words.length > 1 && words.every(w => nameNorm.includes(w.toLowerCase()))) score = 55;
        // At least some words match
        else score = 40;

        // Boost if in the specified root
        if (root && m.toLowerCase().includes(`/${root.toLowerCase()}/`)) score += 10;

        // Boost directories (no extension = likely folder)
        if (!name.includes('.')) score += 8;

        // Penalize deeply nested paths (prefer top-level project folders)
        const depth = m.split('/').length;
        score -= Math.max(0, (depth - 5) * 2);

        // Boost direct children of ~/Documents, ~/Desktop, ~/Downloads
        const homeDir = process.env.HOME ?? "";
        const topLevel = [`${homeDir}/Documents/`, `${homeDir}/Desktop/`, `${homeDir}/Downloads/`];
        if (topLevel.some(tl => m.startsWith(tl) && m.replace(tl, "").split("/").length <= 1)) {
          score += 15;
        }

        return { path: m, score };
      });

      scored.sort((a, b) => b.score - a.score);
      const bestMatch = scored[0].path;

      await openPath(bestMatch);
      const otherCount = scored.length - 1;
      const extra = otherCount > 0 ? ` (${otherCount} other matches)` : "";
      return ok(`find_and_open_ok: opened '${bestMatch}'${extra}`);
    } catch (error) {
      return fail({
        observedState: `find_and_open_failed: query='${parsed.data.query}'`,
        error
      });
    }
  },

  async web_search(args, opts) {
    const parsed = webSearchArgs.safeParse(args);
    if (!parsed.success) {
      return fail({
        observedState: "validation_failed: invalid_args for web_search",
        error: "invalid_args"
      });
    }
    if (opts.dryRun) return ok(`dry_run: would search web for '${parsed.data.query}'`);

    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      return fail({
        observedState: "web_search_failed: no API key",
        error: "TAVILY_API_KEY not configured in .env"
      });
    }

    try {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          query: parsed.data.query,
          search_depth: "basic",
          max_results: 5,
          include_answer: true,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return fail({
          observedState: `web_search_failed: HTTP ${response.status}`,
          error: `Tavily API error: ${response.status} — ${errorText.slice(0, 200)}`
        });
      }

      const data = await response.json() as {
        answer?: string;
        results?: Array<{ title: string; url: string; content: string }>;
      };

      // Build a concise summary for TTS
      let summary = "";
      if (data.answer) {
        summary = data.answer;
      } else if (data.results && data.results.length > 0) {
        summary = data.results
          .slice(0, 3)
          .map((r, i) => `${i + 1}. ${r.title}: ${r.content.slice(0, 150)}`)
          .join(" | ");
      } else {
        summary = "No results found for that search.";
      }

      return ok(`web_search_ok: ${summary}`);
    } catch (error) {
      return fail({
        observedState: `web_search_failed: query='${parsed.data.query}'`,
        error: String(error)
      });
    }
  },

  async add_calendar_event(args, opts) {
    const parsed = addCalendarEventArgs.safeParse(args);
    if (!parsed.success) {
      return fail({ observedState: "validation_failed", error: parsed.error.message });
    }
    if (opts.dryRun) {
      return ok(`would_add_calendar_event: ${parsed.data.title}`);
    }
    try {
      const calName = await addCalendarEvent(
        parsed.data.title,
        parsed.data.start_date_iso,
        parsed.data.end_date_iso,
        parsed.data.notes || ""
      );
      return ok(`add_calendar_event_ok: added to calendar '${calName}'`);
    } catch (err: any) {
      return fail({ observedState: "add_calendar_event_failed", error: err.message });
    }
  },
  play_spotify: async (args, opts) => {
    const parsed = playSpotifyArgs.safeParse(args);
    if (!parsed.success) {
      return fail({
        observedState: "invalid args for play_spotify",
        error: "invalid_args"
      });
    }
    if (opts.dryRun) return ok(`dry_run: would search and play '${parsed.data.song}' on Spotify`);

    const { exec } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(exec);

    // ── Strategy 1: Official Spotify Web API (preferred, most accurate) ──
    const spotifyClientId = process.env.SPOTIFY_CLIENT_ID;
    const spotifyClientSecret = process.env.SPOTIFY_CLIENT_SECRET;

    if (spotifyClientId && spotifyClientSecret) {
      try {
        // Get access token via Client Credentials Flow
        const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
          method: "POST",
          headers: {
            "Authorization": "Basic " + Buffer.from(`${spotifyClientId}:${spotifyClientSecret}`).toString("base64"),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "grant_type=client_credentials",
        });

        if (!tokenRes.ok) {
          console.warn("  ⚠️  Spotify token request failed, falling back to Tavily");
        } else {
          const tokenData = await tokenRes.json() as any;
          const accessToken = tokenData.access_token;

          // Search for the track
          const searchQuery = parsed.data.artist
            ? `track:${parsed.data.song} artist:${parsed.data.artist}`
            : parsed.data.song;

          const searchRes = await fetch(
            `https://api.spotify.com/v1/search?q=${encodeURIComponent(searchQuery)}&type=track&limit=5&market=US`,
            { headers: { "Authorization": `Bearer ${accessToken}` } }
          );

          if (searchRes.ok) {
            const searchData = await searchRes.json() as any;
            const tracks = searchData?.tracks?.items || [];

            if (tracks.length > 0) {
              // Pick the best match — prefer exact name match, then most popular
              let bestTrack = tracks[0];
              const songLower = parsed.data.song.toLowerCase();
              const artistLower = (parsed.data.artist || "").toLowerCase();

              for (const t of tracks) {
                const nameMatch = t.name.toLowerCase().includes(songLower);
                const artistMatch = !artistLower || t.artists.some((a: any) => a.name.toLowerCase().includes(artistLower));
                if (nameMatch && artistMatch) {
                  bestTrack = t;
                  break;
                }
              }

              const uri = bestTrack.uri; // e.g. "spotify:track:xxxx"
              const displayName = `${bestTrack.name} by ${bestTrack.artists.map((a: any) => a.name).join(", ")}`;
              const safeUri = uri.replace(/"/g, "");
              const script = `tell application "Spotify" to play track "${safeUri}"`;
              await execAsync(`osascript -e '${script}'`);

              return ok(`Native Spotify playback started for ${displayName} (${safeUri})`);
            }
          }
        }
      } catch (e) {
        console.warn(`  ⚠️  Spotify API search failed: ${e}, falling back to Tavily`);
      }
    }

    // ── Strategy 2: Tavily web search fallback ──
    const tavilyKey = process.env.TAVILY_API_KEY;
    if (!tavilyKey) {
      return fail({ observedState: "missing_api_keys", error: "Neither SPOTIFY_CLIENT_ID/SECRET nor TAVILY_API_KEY configured" });
    }

    try {
      const query = `site:open.spotify.com/track ${parsed.data.song} ${parsed.data.artist || ""}`;
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: tavilyKey,
          query: query,
          search_depth: "basic",
          max_results: 5
        })
      });

      if (!response.ok) return fail({ observedState: "tavily_error", error: "Search failed" });
      const data = await response.json() as any;
      const results = data.results || [];
      const trackResult = results.find((r: any) => r.url && r.url.includes("open.spotify.com/track/"));

      if (!trackResult) {
        return ok(`Could not find the exact Spotify Track URI for ${parsed.data.song}.`);
      }

      const idMatch = trackResult.url.match(/track\/([a-zA-Z0-9]+)/);
      if (!idMatch) {
        return ok(`Found URL but could not parse the track ID for ${parsed.data.song}.`);
      }

      const uri = `spotify:track:${idMatch[1]}`;
      const safeUri = uri.replace(/"/g, "");
      const script = `tell application "Spotify" to play track "${safeUri}"`;
      await execAsync(`osascript -e '${script}'`);

      return ok(`Native Spotify playback started for ${parsed.data.song} (${safeUri})`);

    } catch (e) {
      return fail({ observedState: "play_spotify_failed", error: String(e) });
    }
  },
  execute_applescript: async (args, opts) => {
    const parsed = z.object({ script: z.string() }).safeParse(args);
    if (!parsed.success) {
      return fail({
        observedState: "invalid args for execute_applescript",
        error: parsed.error.message
      });
    }
    if (opts.dryRun) {
      return ok(`would_execute_applescript: script = '${parsed.data.script.slice(0, 50)}...'`);
    }

    try {
      // Escape single quotes for bash passing to osascript -e '...'
      const safeScript = parsed.data.script.replace(/'/g, "'\\''");
      const { stdout, stderr } = await execAsync(`osascript -e '${safeScript}'`);

      const output = (stdout || stderr || "success").trim();
      return ok(`applescript_executed: ${output} `);
    } catch (err: any) {
      return fail({
        observedState: `applescript_failed`,
        error: String(err?.stderr || err?.message || err)
      });
    }
  },
  click_element: async (args, opts) => {
    const parsed = z.object({ description: z.string() }).safeParse(args);
    if (!parsed.success) {
      return fail({
        observedState: "invalid args for click_element",
        error: parsed.error.message
      });
    }

    if (opts.dryRun) {
      return ok(`would_click_element: description = '${parsed.data.description}'`);
    }

    try {
      console.log(`  📸 Capturing screen to locate "${parsed.data.description}"...`);
      const mimeData = await captureScreenMimeData();

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("GEMINI_API_KEY missing");

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

      const prompt = `Return the bounding box coordinates[ymin, xmin, ymax, xmax] for the element matching the description: "${parsed.data.description}".Only return the JSON array, no formatting.`;

      const result = await model.generateContent([mimeData, { text: prompt }]);
      const text = result.response.text().trim();

      // Attempt to parse out [ ymin, xmin, ymax, xmax ] (values are 0-1000)
      const match = text.match(/\[\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\]/);
      if (!match) {
        return fail({
          observedState: "vision_failed",
          error: `Gemini could not find "${parsed.data.description}" or returned invalid format: ${text} `
        });
      }

      const [_, yminStr, xminStr, ymaxStr, xmaxStr] = match;

      // Note: Gemini 2.0 spatial coords are on a 1000x1000 grid representing the image
      // We must get the actual screen dimensions from macOS to scale the click.
      const { stdout: dims } = await execAsync(`system_profiler SPDisplaysDataType | grep Resolution`);

      // Extremely naive parsing of the first resolution found (e.g. "Resolution: 2560 x 1600")
      const resMatch = dims.match(/(\d+)\s*x\s*(\d+)/);
      if (!resMatch) {
        throw new Error("Could not detect screen resolution");
      }

      const screenW = parseInt(resMatch[1], 10);
      const screenH = parseInt(resMatch[2], 10);

      const ymin = parseInt(yminStr, 10);
      const xmin = parseInt(xminStr, 10);
      const ymax = parseInt(ymaxStr, 10);
      const xmax = parseInt(xmaxStr, 10);

      // Center of bounding box on 1000x1000 grid
      const cx1000 = xmin + ((xmax - xmin) / 2);
      const cy1000 = ymin + ((ymax - ymin) / 2);

      // Scale to screen
      // Important: Mac coordinates are often logical, but let's try physical pixels first, 
      // or we might need to divide by 2 for Retina. Let's start with native dimensions.
      const targetX = Math.round((cx1000 / 1000) * screenW);
      const targetY = Math.round((cy1000 / 1000) * screenH);

      const dir = dirname(fileURLToPath(import.meta.url));
      const jarvisMousePath = resolve(dir, "..", "assets", "jarvis-mouse");

      console.log(`  🖱️  Clicking at ${targetX}, ${targetY} `);
      await execAsync(`"${jarvisMousePath}" ${targetX} ${targetY} --click`);

      return ok(`clicked_element: ${parsed.data.description} at ${targetX}, ${targetY} `);

    } catch (err: any) {
      return fail({
        observedState: `click_element_failed`,
        error: String(err?.message || err)
      });
    }
  }
};

export const allowedToolNames = Object.keys(toolRegistry).sort();

export async function executeToolCall(args: {
  call: ToolCall;
  dryRun: boolean;
}): Promise<ExecutedToolResult> {
  const normalized = normalizeToolCall(args.call);
  const handler = toolRegistry[normalized.name];
  if (!handler) {
    return {
      requested_tool: args.call.name,
      normalized_tool: normalized.name,
      result: fail({
        observedState: `blocked: tool '${normalized.name}' is not allowlisted`,
        error: "tool_not_allowed"
      })
    };
  }

  try {
    const raw = await handler(normalized.args, { dryRun: args.dryRun });
    const result = withVerifiedObservedState(normalized.name, raw);
    return {
      requested_tool: args.call.name,
      normalized_tool: normalized.name,
      result
    };
  } catch (err) {
    return {
      requested_tool: args.call.name,
      normalized_tool: normalized.name,
      result: fail({
        observedState: `execution_failed: ${normalized.name} `,
        error: String(err)
      })
    };
  }
}

// ── Google ADK helpers ─────────────────────────

/**
 * Convert our toolSchemas registry into the FunctionTool[] format
 * that the Google ADK LlmAgent expects in its `tools` array.
 * Filters out browser tools (require active page) and aliases.
 */
export function toAdkTools(): FunctionTool[] {
  // Tools to exclude from ADK (require browser page, are aliases, or are rarely useful in voice)
  const excludeTools = new Set([
    "browser_new_tab", "browser_go", "browser_search",
    "browser_click_result", "browser_extract_text",
    "browser_click_text", "browser_type_active",
    "browser_extract_visible_text",
    "click_element",  // requires vision/screen analysis
  ]);

  return Object.entries(toolSchemas)
    .filter(([name]) => !excludeTools.has(name))
    .map(([name, schema]) => {
      // Build exactly what ADK expects for FunctionTool arguments
      const toolProperties: any = {};
      const requiredArr: string[] = schema.args_schema.required as string[] ?? [];

      const propertiesSource = schema.args_schema.properties as Record<string, any>;
      if (propertiesSource) {
        for (const key of Object.keys(propertiesSource)) {
          // Minimal copy of the properties for the ADK schema
          const propInfo = propertiesSource[key];
          toolProperties[key] = {
            type: propInfo.type,
            description: propInfo.description
          };
          if (propInfo.type === "array" && propInfo.items) {
            toolProperties[key].items = propInfo.items;
          }
        }
      }

      return new FunctionTool({
        name,
        description: schema.description,
        parameters: {
          type: "object",
          properties: toolProperties,
          required: requiredArr,
        } as any,
        execute: async (args: any) => {
          console.log(`[ADK Agent] Executing tool: ${name}`);
          const result = await executeToolCall({
            call: { name, args },
            dryRun: false,
          });
          if (result.result.success) {
            return result.result.observed_state ?? "Tool executed successfully";
          } else {
            return `Error: ${result.result.error ?? "unknown error"}`;
          }
        }
      });
    });
}

