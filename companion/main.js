import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { app, BrowserWindow, Tray, Menu, globalShortcut, nativeImage, ipcMain, screen, shell } from "electron";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const AGENT_BASE_URL = process.env.AURA_AGENT_LOCAL_URL?.trim() || "http://127.0.0.1:8765";
const WAKE_POLL_INTERVAL_MS = Number(process.env.AURA_WAKE_POLL_INTERVAL_MS || 2600);
const WAKE_CAPTURE_MS = Number(process.env.AURA_WAKE_CAPTURE_MS || 1800);
const WAKE_COOLDOWN_MS = Number(process.env.AURA_WAKE_COOLDOWN_MS || 8000);
const COMMAND_CAPTURE_MS = Number(process.env.AURA_COMMAND_CAPTURE_MS || 4200);

const SETTINGS_FILENAME = "aura-companion.settings.json";
const STACK_RESTART_BASE_DELAY_MS = 2400;
const STACK_RESTART_MAX_DELAY_MS = 20000;

function parseBoolean(input, fallback) {
  if (input == null) return fallback;
  if (typeof input === "boolean") return input;
  const normalized = String(input).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

const defaultSettings = {
  dryRun: parseBoolean(process.env.AURA_COMPANION_DRY_RUN, false),
  wakeWordEnabled: false,
  openAtLogin: true,
  autoRestartCompanion: true,
  autoStartStack: false,
  playSoundCues: true
};

const settings = { ...defaultSettings };

const state = {
  agentBaseUrl: AGENT_BASE_URL,
  overlayVisible: false,
  listening: false,
  wakeWordEnabled: settings.wakeWordEnabled,
  killSwitchActive: false,
  dryRun: settings.dryRun,
  openAtLogin: settings.openAtLogin,
  autoRestartCompanion: settings.autoRestartCompanion,
  autoStartStack: settings.autoStartStack,
  playSoundCues: settings.playSoundCues,
  stackRunning: false,
  stackPid: null,
  lastAction: "idle",
  lastTranscript: "",
  lastResponse: "",
  lastError: "",
  lastUpdatedAt: new Date().toISOString()
};

let overlayWindow = null;
let tray = null;
let activeCaptureId = null;
let wakeInterval = null;
let wakeLoopBusy = false;
let wakeLastTriggeredAt = 0;
let backendProcess = null;
let desktopProcess = null;
let stackRestartTimer = null;
let stackRestartDelayMs = STACK_RESTART_BASE_DELAY_MS;
let suppressNextStackRestart = false;
let stackGeneration = 0;
let stackFailureHandling = false;
let appIsQuitting = false;
let crashRecoveryInFlight = false;
let settingsSaveTimer = null;

function nowIso() {
  return new Date().toISOString();
}

function settingsPath() {
  return path.join(app.getPath("userData"), SETTINGS_FILENAME);
}

async function loadSettings() {
  try {
    const file = await readFile(settingsPath(), "utf8");
    const parsed = JSON.parse(file);
    if (!parsed || typeof parsed !== "object") return;
    const payload = parsed;
    if (typeof payload.dryRun === "boolean") settings.dryRun = payload.dryRun;
    if (typeof payload.wakeWordEnabled === "boolean") settings.wakeWordEnabled = payload.wakeWordEnabled;
    if (typeof payload.openAtLogin === "boolean") settings.openAtLogin = payload.openAtLogin;
    if (typeof payload.autoRestartCompanion === "boolean") settings.autoRestartCompanion = payload.autoRestartCompanion;
    if (typeof payload.autoStartStack === "boolean") settings.autoStartStack = payload.autoStartStack;
    if (typeof payload.playSoundCues === "boolean") settings.playSoundCues = payload.playSoundCues;
  } catch {
    // First run or malformed file: keep defaults.
  }
}

async function saveSettingsNow() {
  const filePath = settingsPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(settings, null, 2), "utf8");
}

function queueSaveSettings() {
  if (settingsSaveTimer) return;
  settingsSaveTimer = setTimeout(() => {
    settingsSaveTimer = null;
    void saveSettingsNow().catch(() => {
      // best-effort persistence
    });
  }, 300);
}

function applyLoginItemSettings() {
  if (typeof app.setLoginItemSettings !== "function") return;
  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(settings.openAtLogin),
      openAsHidden: true
    });
  } catch {
    // no-op on unsupported environments
  }
}

function syncStateFromSettings() {
  state.dryRun = settings.dryRun;
  state.wakeWordEnabled = settings.wakeWordEnabled;
  state.openAtLogin = settings.openAtLogin;
  state.autoRestartCompanion = settings.autoRestartCompanion;
  state.autoStartStack = settings.autoStartStack;
  state.playSoundCues = settings.playSoundCues;
}

function playCue(type) {
  if (!settings.playSoundCues) return;
  const beep = () => shell.beep();
  if (type === "listen_start") {
    beep();
    return;
  }
  if (type === "listen_done") {
    beep();
    setTimeout(beep, 140);
    return;
  }
  if (type === "error") {
    beep();
    setTimeout(beep, 120);
    setTimeout(beep, 240);
    return;
  }
  beep();
}

function buildTrayMenuTemplate() {
  return [
    { label: "Show / Hide Aura", click: () => toggleOverlay() },
    { label: "Start Listening", click: () => void startListening() },
    { label: "Stop + Run", click: () => void stopAndRunVoice() },
    { type: "separator" },
    {
      label: "Wake Phrase (Experimental)",
      type: "checkbox",
      checked: state.wakeWordEnabled,
      click: () => {
        void toggleWakeWord();
      }
    },
    {
      label: "Open At Login",
      type: "checkbox",
      checked: state.openAtLogin,
      click: (item) => {
        applySettingPatch({ openAtLogin: Boolean(item.checked) });
      }
    },
    {
      label: "Auto-Restart Companion",
      type: "checkbox",
      checked: state.autoRestartCompanion,
      click: (item) => {
        applySettingPatch({ autoRestartCompanion: Boolean(item.checked) });
      }
    },
    {
      label: "Play Voice Cues",
      type: "checkbox",
      checked: state.playSoundCues,
      click: (item) => {
        applySettingPatch({ playSoundCues: Boolean(item.checked) });
      }
    },
    {
      label: "Auto-Start Aura Stack",
      type: "checkbox",
      checked: state.autoStartStack,
      click: (item) => {
        const enabled = Boolean(item.checked);
        applySettingPatch({ autoStartStack: enabled });
        if (enabled && !backendProcess && !desktopProcess) {
          void startAuraStack({ reason: "tray_auto_start_enabled" });
        }
      }
    },
    { type: "separator" },
    { label: "Start Aura Stack", click: () => void startAuraStack({ reason: "tray_manual_start" }) },
    { label: "Stop Aura Stack", click: () => void stopAuraStack("tray_manual_stop") },
    { type: "separator" },
    { label: "Open Control Center", click: () => void shell.openExternal(`${AGENT_BASE_URL}/`) },
    { label: "Quit Aura Companion", click: () => app.quit() }
  ];
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate()));
}

function updateState(patch) {
  Object.assign(state, patch, { lastUpdatedAt: nowIso() });
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send("aura:state", state);
  }
  if (tray) {
    tray.setToolTip(
      `AURA Companion\nlistening=${state.listening ? "yes" : "no"}\nwakeWord=${state.wakeWordEnabled ? "on" : "off"}\nstack=${state.stackRunning ? "running" : "stopped"}`
    );
  }
  refreshTrayMenu();
}

function applySettingPatch(patch) {
  Object.assign(settings, patch);
  syncStateFromSettings();
  applyLoginItemSettings();
  queueSaveSettings();
  updateState({
    dryRun: state.dryRun,
    wakeWordEnabled: state.wakeWordEnabled,
    openAtLogin: state.openAtLogin,
    autoRestartCompanion: state.autoRestartCompanion,
    autoStartStack: state.autoStartStack,
    playSoundCues: state.playSoundCues
  });
}

function createTrayImage() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
      <rect width="20" height="20" rx="10" fill="#0E183B"/>
      <circle cx="10" cy="10" r="6" fill="#5F8DFF"/>
      <circle cx="8" cy="9" r="1.1" fill="#EAF1FF"/>
      <circle cx="12" cy="9" r="1.1" fill="#EAF1FF"/>
      <rect x="7.5" y="12" width="5" height="1.4" rx="0.7" fill="#EAF1FF"/>
    </svg>
  `.trim();
  const encoded = Buffer.from(svg).toString("base64");
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${encoded}`).resize({ width: 18, height: 18 });
}

function positionOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const display = screen.getPrimaryDisplay();
  const { width, height, x, y } = display.workArea;
  const [windowWidth, windowHeight] = overlayWindow.getSize();
  overlayWindow.setPosition(x + width - windowWidth - 22, y + height - windowHeight - 24, false);
}

function showOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  positionOverlay();
  overlayWindow.show();
  overlayWindow.focus();
  updateState({ overlayVisible: true });
}

function hideOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.hide();
  updateState({ overlayVisible: false });
}

function toggleOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (overlayWindow.isVisible()) hideOverlay();
  else showOverlay();
}

function summarizeRun(payload) {
  const goal = payload?.plan?.goal ? `Goal: ${payload.plan.goal}` : "Goal: (none)";
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const okCount = results.filter((item) => item?.result?.success === true).length;
  const failCount = results.length - okCount;
  const aborted = payload?.aborted ? `aborted (${payload?.abort_reason ?? "unknown"})` : "not aborted";
  if (payload?.needs_repeat === true) {
    return `Need repeat: ${payload?.reason ?? "low_signal"}`;
  }
  return `${goal}\nResults: ${okCount} success, ${failCount} failed\nExecution: ${aborted}`;
}

function summarizeError(error, fallback = "operation_failed") {
  const text = String(error ?? fallback);
  return text.length > 320 ? `${text.slice(0, 320)}…` : text;
}

async function agentJson(route, options = {}) {
  const url = `${AGENT_BASE_URL}${route}`;
  const method = options.method ?? "GET";
  const body = options.body;
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`${route} failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

async function fileExists(filePath) {
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch {
    return false;
  }
}

function stackIsRunning() {
  return Boolean(backendProcess || desktopProcess);
}

function stackLeadPid() {
  return backendProcess?.pid ?? desktopProcess?.pid ?? null;
}

function stackEntries() {
  if (app.isPackaged) {
    const base = path.join(process.resourcesPath, "embedded");
    return {
      mode: "packaged",
      backend: path.join(base, "backend-dist", "index.js"),
      desktop: path.join(base, "desktop-dist", "index.js")
    };
  }
  return {
    mode: "dev",
    backend: path.join(REPO_ROOT, "backend", "dist", "index.js"),
    desktop: path.join(REPO_ROOT, "desktop", "dist", "index.js")
  };
}

function spawnAndWait(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: "inherit",
      env: process.env
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} failed with code ${code ?? "null"}`));
    });
  });
}

async function ensureDevStackBuildArtifacts(entries) {
  if (entries.mode !== "dev") return;
  const backendOk = await fileExists(entries.backend);
  const desktopOk = await fileExists(entries.desktop);
  if (backendOk && desktopOk) return;
  updateState({
    lastAction: "stack-building",
    lastResponse: "Building backend/desktop runtime for companion stack...",
    lastError: ""
  });
  await spawnAndWait(npmCommand(), ["-w", "backend", "run", "build"], REPO_ROOT);
  await spawnAndWait(npmCommand(), ["-w", "desktop", "run", "build"], REPO_ROOT);
}

function spawnNodeScript(scriptPath, env, cwd) {
  return spawn(process.execPath, ["--run-as-node", scriptPath], {
    cwd,
    stdio: "ignore",
    env
  });
}

function clearStackRestartTimer() {
  if (!stackRestartTimer) return;
  clearTimeout(stackRestartTimer);
  stackRestartTimer = null;
}

function scheduleStackRestart(reason) {
  if (!settings.autoStartStack) return;
  if (appIsQuitting) return;
  if (stackRestartTimer) return;
  const delay = stackRestartDelayMs;
  stackRestartTimer = setTimeout(() => {
    stackRestartTimer = null;
    void startAuraStack({ reason: `auto_restart:${reason}` });
  }, delay);
  stackRestartDelayMs = Math.min(Math.round(stackRestartDelayMs * 1.6), STACK_RESTART_MAX_DELAY_MS);
  updateState({
    lastAction: "stack-restart-scheduled",
    lastResponse: `Aura stack restart scheduled in ${Math.round(delay / 1000)}s`,
    lastError: ""
  });
}

function resetStackBackoff() {
  stackRestartDelayMs = STACK_RESTART_BASE_DELAY_MS;
}

function killChild(child, signal = "SIGTERM") {
  if (!child) return;
  try {
    child.kill(signal);
  } catch {
    // no-op
  }
}

function tearDownStackProcesses(args = {}) {
  const force = Boolean(args.force);
  if (backendProcess) {
    killChild(backendProcess, force ? "SIGKILL" : "SIGTERM");
    backendProcess = null;
  }
  if (desktopProcess) {
    killChild(desktopProcess, force ? "SIGKILL" : "SIGTERM");
    desktopProcess = null;
  }
  updateState({
    stackRunning: false,
    stackPid: null
  });
}

function handleStackProcessEnded(args) {
  const generation = args.generation;
  const label = args.label;
  const detail = args.detail;
  if (generation !== stackGeneration) return;
  if (stackFailureHandling) return;
  stackFailureHandling = true;

  tearDownStackProcesses({ force: true });
  updateState({
    lastAction: "stack-exited",
    lastResponse: `Aura stack ${label} exited (${detail})`
  });

  const shouldRestart = !suppressNextStackRestart;
  suppressNextStackRestart = false;
  if (shouldRestart) {
    scheduleStackRestart(`child_${label}`);
  }

  stackFailureHandling = false;
}

async function startAuraStack(args = {}) {
  const reason = args.reason ?? "manual";
  if (stackIsRunning()) {
    return { ok: true, already_running: true, pid: stackLeadPid() };
  }

  clearStackRestartTimer();

  try {
    const entries = stackEntries();
    await ensureDevStackBuildArtifacts(entries);

    const backendEntryExists = await fileExists(entries.backend);
    const desktopEntryExists = await fileExists(entries.desktop);
    if (!backendEntryExists || !desktopEntryExists) {
      throw new Error("stack_entries_missing: build artifacts not found");
    }

    const backendPort = Number(process.env.AURA_BACKEND_PORT || 8080);
    const desktopPort = Number(process.env.AURA_DESKTOP_PORT || 8765);
    const sharedEnv = {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV ?? "production"
    };

    const backendEnv = {
      ...sharedEnv,
      PORT: String(backendPort),
      AURA_PLANNER_MODE: sharedEnv.AURA_PLANNER_MODE ?? "local",
      AURA_TTS_MODE: sharedEnv.AURA_TTS_MODE ?? "stub",
      AURA_BACKEND_VERSION: sharedEnv.AURA_BACKEND_VERSION ?? "companion"
    };
    const desktopEnv = {
      ...sharedEnv,
      PORT: String(desktopPort),
      AURA_BACKEND_URL: sharedEnv.AURA_BACKEND_URL ?? `http://127.0.0.1:${backendPort}`,
      AURA_AGENT_VERSION: sharedEnv.AURA_AGENT_VERSION ?? "companion"
    };

    const backendCwd = path.dirname(entries.backend);
    const desktopCwd = path.dirname(entries.desktop);

    const generation = stackGeneration + 1;
    stackGeneration = generation;

    const backendChild = spawnNodeScript(entries.backend, backendEnv, backendCwd);
    const desktopChild = spawnNodeScript(entries.desktop, desktopEnv, desktopCwd);

    backendProcess = backendChild;
    desktopProcess = desktopChild;
    suppressNextStackRestart = false;
    stackFailureHandling = false;
    resetStackBackoff();

    backendChild.once("error", (error) => {
      handleStackProcessEnded({
        generation,
        label: "backend",
        detail: `error:${summarizeError(error)}`
      });
      playCue("error");
    });
    backendChild.once("exit", (code, signal) => {
      handleStackProcessEnded({
        generation,
        label: "backend",
        detail: `code=${code ?? "null"},signal=${signal ?? "none"}`
      });
    });

    desktopChild.once("error", (error) => {
      handleStackProcessEnded({
        generation,
        label: "desktop",
        detail: `error:${summarizeError(error)}`
      });
      playCue("error");
    });
    desktopChild.once("exit", (code, signal) => {
      handleStackProcessEnded({
        generation,
        label: "desktop",
        detail: `code=${code ?? "null"},signal=${signal ?? "none"}`
      });
    });

    updateState({
      stackRunning: true,
      stackPid: desktopChild.pid ?? backendChild.pid ?? null,
      lastAction: "stack-started",
      lastResponse: `Aura stack started (${reason})`,
      lastError: ""
    });

    return {
      ok: true,
      already_running: false,
      pid: desktopChild.pid ?? backendChild.pid ?? null
    };
  } catch (error) {
    updateState({
      stackRunning: false,
      stackPid: null,
      lastAction: "stack-error",
      lastError: summarizeError(error, "stack_start_failed")
    });
    playCue("error");
    scheduleStackRestart("spawn_failure");
    return { ok: false, error: summarizeError(error, "stack_start_failed") };
  }
}

async function stopAuraStack(reason = "manual_stop") {
  clearStackRestartTimer();
  if (!stackIsRunning()) {
    updateState({
      stackRunning: false,
      stackPid: null,
      lastAction: "stack-stopped",
      lastResponse: `Aura stack already stopped (${reason})`,
      lastError: ""
    });
    return { ok: true, already_stopped: true };
  }

  suppressNextStackRestart = true;
  tearDownStackProcesses({ force: false });
  setTimeout(() => {
    if (!stackIsRunning()) return;
    tearDownStackProcesses({ force: true });
  }, 2500);

  updateState({
    stackRunning: false,
    stackPid: null,
    lastAction: "stack-stopped",
    lastResponse: `Aura stack stopping (${reason})`,
    lastError: ""
  });
  return { ok: true, already_stopped: false };
}

function parseWakeTranscript(transcript) {
  const raw = String(transcript || "").trim();
  if (!raw) return { detected: false, command: "" };
  const matcher = /(hey aura|hi aura|ok aura|okay aura|aura)[,\s:.-]*(.*)$/i;
  const match = raw.match(matcher);
  if (!match) return { detected: false, command: "" };
  const command = (match[2] || "").trim();
  return { detected: true, command };
}

async function refreshAgentStatus() {
  try {
    const [statusPayload, controlPayload] = await Promise.all([agentJson("/status"), agentJson("/control")]);
    updateState({
      killSwitchActive: Boolean(controlPayload?.kill_switch_active),
      lastError: "",
      lastAction: state.listening ? "listening" : "ready",
      lastResponse: statusPayload?.frontmost_app ? `Frontmost app: ${statusPayload.frontmost_app}` : state.lastResponse
    });
  } catch (error) {
    updateState({
      lastError: summarizeError(error, "agent_unreachable"),
      lastAction: "error"
    });
    if (settings.autoStartStack && !stackIsRunning()) {
      void startAuraStack({ reason: "agent_unreachable" });
    }
  }
}

async function startListening() {
  if (activeCaptureId) return { ok: true, capture_id: activeCaptureId };
  const started = await agentJson("/voice/ptt/start", { method: "POST", body: {} });
  activeCaptureId = started.capture_id;
  updateState({
    listening: true,
    lastAction: "listening",
    lastError: "",
    lastResponse: `Listening… capture_id=${started.capture_id}`
  });
  playCue("listen_start");
  return started;
}

async function stopAndRunVoice() {
  if (!activeCaptureId) {
    throw new Error("capture_not_active");
  }
  const captureId = activeCaptureId;
  const stopped = await agentJson("/voice/ptt/stop", {
    method: "POST",
    body: { capture_id: captureId }
  });
  activeCaptureId = null;
  updateState({
    listening: false,
    lastAction: "thinking",
    lastTranscript: ""
  });

  const run = await agentJson("/voice/run", {
    method: "POST",
    body: {
      audio_path: stopped.audio_path,
      language: "en",
      dry_run: state.dryRun
    }
  });

  updateState({
    lastAction: run?.needs_repeat ? "needs-repeat" : "done",
    lastTranscript: String(run?.transcript ?? ""),
    lastResponse: summarizeRun(run),
    lastError: ""
  });
  playCue(run?.needs_repeat ? "error" : "listen_done");
  showOverlay();
  return run;
}

async function runInstruction(instruction) {
  const text = String(instruction || "").trim();
  if (!text) throw new Error("instruction_required");
  const result = await agentJson("/run", {
    method: "POST",
    body: {
      instruction: text,
      dry_run: state.dryRun
    }
  });
  updateState({
    lastAction: "done",
    lastResponse: summarizeRun(result),
    lastError: ""
  });
  playCue("listen_done");
  showOverlay();
  return result;
}

async function setKillSwitch(active, reason = "companion_toggle") {
  const payload = await agentJson("/control/kill-switch", {
    method: "POST",
    body: {
      active: Boolean(active),
      reason: reason || undefined
    }
  });
  updateState({
    killSwitchActive: Boolean(payload?.kill_switch_active),
    lastAction: payload?.kill_switch_active ? "kill-on" : "kill-off",
    lastResponse: payload?.kill_switch_active ? "Kill switch enabled" : "Kill switch disabled",
    lastError: ""
  });
  playCue("toggle");
  return payload;
}

async function toggleKillSwitch(reason = "companion_toggle") {
  return setKillSwitch(!state.killSwitchActive, reason);
}

async function runWakeWordProbe() {
  if (wakeLoopBusy) return;
  if (activeCaptureId) return;
  if (Date.now() - wakeLastTriggeredAt < WAKE_COOLDOWN_MS) return;
  wakeLoopBusy = true;
  try {
    const started = await agentJson("/voice/ptt/start", { method: "POST", body: {} });
    await sleep(WAKE_CAPTURE_MS);
    const stopped = await agentJson("/voice/ptt/stop", {
      method: "POST",
      body: { capture_id: started.capture_id }
    });
    const transcribed = await agentJson("/voice/transcribe", {
      method: "POST",
      body: { audio_path: stopped.audio_path, language: "en" }
    });
    const transcript = String(transcribed?.transcript ?? "").trim();
    if (!transcript) return;
    const wake = parseWakeTranscript(transcript);
    if (!wake.detected) return;

    wakeLastTriggeredAt = Date.now();
    updateState({
      lastAction: "wake-detected",
      lastTranscript: transcript,
      lastResponse: "Wake phrase detected",
      lastError: ""
    });
    playCue("toggle");
    showOverlay();

    if (wake.command) {
      await runInstruction(wake.command);
      return;
    }

    await startListening();
    await sleep(COMMAND_CAPTURE_MS);
    if (activeCaptureId) {
      await stopAndRunVoice();
    }
  } catch (error) {
    updateState({
      lastAction: "wake-error",
      lastError: summarizeError(error)
    });
    playCue("error");
  } finally {
    wakeLoopBusy = false;
  }
}

function setWakeWordEnabled(active, options = {}) {
  const persist = options.persist !== false;
  const shouldEnable = Boolean(active);
  if (shouldEnable === state.wakeWordEnabled) return;

  if (shouldEnable) {
    wakeInterval = setInterval(() => {
      void runWakeWordProbe();
    }, WAKE_POLL_INTERVAL_MS);
    updateState({
      wakeWordEnabled: true,
      lastAction: "wake-on",
      lastResponse: "Wake word enabled (experimental). Say: Hey Aura"
    });
    if (persist) applySettingPatch({ wakeWordEnabled: true });
    return;
  }

  if (wakeInterval) {
    clearInterval(wakeInterval);
    wakeInterval = null;
  }
  updateState({
    wakeWordEnabled: false,
    lastAction: "wake-off",
    lastResponse: "Wake word disabled"
  });
  if (persist) applySettingPatch({ wakeWordEnabled: false });
}

async function toggleWakeWord() {
  setWakeWordEnabled(!state.wakeWordEnabled);
  return state.wakeWordEnabled;
}

function attemptCrashRecovery(source, error) {
  if (crashRecoveryInFlight) return;
  crashRecoveryInFlight = true;
  const message = summarizeError(error, source);
  if (!settings.autoRestartCompanion) {
    updateState({
      lastAction: "fatal-error",
      lastError: `Fatal error (${source}): ${message}`
    });
    return;
  }
  app.relaunch();
  app.exit(0);
}

function attachIpcHandlers() {
  ipcMain.handle("aura:get-state", () => state);
  ipcMain.handle("aura:toggle-overlay", () => {
    toggleOverlay();
    return state;
  });
  ipcMain.handle("aura:start-listening", async () => {
    try {
      const result = await startListening();
      return { ok: true, result, state };
    } catch (error) {
      updateState({ lastError: summarizeError(error), lastAction: "error" });
      playCue("error");
      return { ok: false, error: summarizeError(error), state };
    }
  });
  ipcMain.handle("aura:stop-run", async () => {
    try {
      const result = await stopAndRunVoice();
      return { ok: true, result, state };
    } catch (error) {
      updateState({
        listening: false,
        lastError: summarizeError(error),
        lastAction: "error"
      });
      playCue("error");
      return { ok: false, error: summarizeError(error), state };
    }
  });
  ipcMain.handle("aura:run-instruction", async (_event, payload) => {
    try {
      const result = await runInstruction(payload?.instruction);
      return { ok: true, result, state };
    } catch (error) {
      updateState({ lastError: summarizeError(error), lastAction: "error" });
      playCue("error");
      return { ok: false, error: summarizeError(error), state };
    }
  });
  ipcMain.handle("aura:toggle-kill", async (_event, payload) => {
    try {
      const result = await toggleKillSwitch(payload?.reason ?? "companion_toggle");
      return { ok: true, result, state };
    } catch (error) {
      updateState({ lastError: summarizeError(error), lastAction: "error" });
      playCue("error");
      return { ok: false, error: summarizeError(error), state };
    }
  });
  ipcMain.handle("aura:set-dry-run", async (_event, payload) => {
    const next = Boolean(payload?.dryRun);
    applySettingPatch({ dryRun: next });
    updateState({ lastResponse: next ? "Dry run mode enabled" : "Live mode enabled" });
    return { ok: true, state };
  });
  ipcMain.handle("aura:toggle-wake-word", async () => {
    const enabled = await toggleWakeWord();
    return { ok: true, enabled, state };
  });
  ipcMain.handle("aura:refresh-status", async () => {
    await refreshAgentStatus();
    return { ok: true, state };
  });
  ipcMain.handle("aura:open-control-center", async () => {
    await shell.openExternal(`${AGENT_BASE_URL}/`);
    return { ok: true };
  });
  ipcMain.handle("aura:start-stack", async (_event, payload) => {
    const result = await startAuraStack({ reason: payload?.reason ?? "renderer_start" });
    return { ok: result.ok !== false, result, state };
  });
  ipcMain.handle("aura:stop-stack", async (_event, payload) => {
    const result = await stopAuraStack(payload?.reason ?? "renderer_stop");
    return { ok: true, result, state };
  });
  ipcMain.handle("aura:update-setting", async (_event, payload) => {
    const key = String(payload?.key ?? "");
    const value = payload?.value;
    if (!["openAtLogin", "autoRestartCompanion", "autoStartStack", "playSoundCues"].includes(key)) {
      return { ok: false, error: "unknown_setting_key", state };
    }
    if (typeof value !== "boolean") {
      return { ok: false, error: "setting_value_must_be_boolean", state };
    }
    applySettingPatch({ [key]: value });
    if (key === "autoStartStack" && value && !stackIsRunning()) {
      void startAuraStack({ reason: "setting_enabled" });
    }
    if (key === "autoStartStack" && !value) {
      clearStackRestartTimer();
    }
    return { ok: true, state };
  });
}

function registerGlobalShortcuts() {
  globalShortcut.register("CommandOrControl+Shift+A", () => {
    toggleOverlay();
  });

  globalShortcut.register("CommandOrControl+Shift+Space", () => {
    if (activeCaptureId) {
      void stopAndRunVoice().catch((error) => {
        updateState({ listening: false, lastError: summarizeError(error), lastAction: "error" });
        playCue("error");
      });
      return;
    }
    void startListening().catch((error) => {
      updateState({ listening: false, lastError: summarizeError(error), lastAction: "error" });
      playCue("error");
    });
  });

  globalShortcut.register("CommandOrControl+Shift+K", () => {
    void toggleKillSwitch("global_shortcut").catch((error) => {
      updateState({ lastError: summarizeError(error), lastAction: "error" });
      playCue("error");
    });
  });
}

function createTray() {
  tray = new Tray(createTrayImage());
  tray.setToolTip("AURA Companion");
  tray.on("click", () => {
    toggleOverlay();
  });
  refreshTrayMenu();
}

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: 320,
    height: 430,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    fullscreenable: false,
    vibrancy: "under-window",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  overlayWindow.on("close", (event) => {
    event.preventDefault();
    hideOverlay();
  });
  overlayWindow.on("show", () => updateState({ overlayVisible: true }));
  overlayWindow.on("hide", () => updateState({ overlayVisible: false }));
}

process.on("uncaughtException", (error) => {
  attemptCrashRecovery("uncaughtException", error);
});

process.on("unhandledRejection", (error) => {
  attemptCrashRecovery("unhandledRejection", error);
});

app.whenReady().then(async () => {
  await loadSettings();
  syncStateFromSettings();
  applyLoginItemSettings();

  attachIpcHandlers();
  createOverlayWindow();
  createTray();
  registerGlobalShortcuts();

  if (settings.wakeWordEnabled) {
    setWakeWordEnabled(true, { persist: false });
  }

  if (settings.autoStartStack) {
    void startAuraStack({ reason: "startup_auto_start" });
  }

  await refreshAgentStatus();
  updateState({
    lastResponse:
      "Companion ready. Use Cmd/Ctrl+Shift+Space to talk, Cmd/Ctrl+Shift+A to show/hide, Cmd/Ctrl+Shift+K for kill switch."
  });

  const loginState = typeof app.getLoginItemSettings === "function" ? app.getLoginItemSettings() : { wasOpenedAtLogin: false };
  if (!loginState?.wasOpenedAtLogin) {
    showOverlay();
  }

  setInterval(() => {
    void refreshAgentStatus();
  }, 5000);
});

app.on("before-quit", () => {
  appIsQuitting = true;
  clearStackRestartTimer();
  if (settingsSaveTimer) {
    clearTimeout(settingsSaveTimer);
    settingsSaveTimer = null;
  }
  if (wakeInterval) {
    clearInterval(wakeInterval);
    wakeInterval = null;
  }
  tearDownStackProcesses({ force: true });
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  // Keep tray app running in background unless explicitly quit.
});

app.on("activate", () => {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    createOverlayWindow();
  }
  showOverlay();
});
