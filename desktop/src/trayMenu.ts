/**
 * Native macOS System Tray for Jarvis Voice Agent.
 *
 * Uses JXA (JavaScript for Automation) via `osascript` to create a
 * real macOS NSStatusBar item. Zero npm dependencies, no Electron.
 *
 * Communication:
 * - Voice agent writes state to /tmp/aura-tray-state.json
 * - JXA script reads it every second and updates the menu
 * - JXA script writes actions to /tmp/aura-tray-action.json
 * - Voice agent reads actions and responds
 */

import { writeFile, readFile, unlink } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

const STATE_FILE = "/tmp/aura-tray-state.json";
const ACTION_FILE = "/tmp/aura-tray-action.json";

export type TrayState = {
  status: "idle" | "listening" | "recording" | "transcribing" | "planning" | "executing" | "speaking" | "error";
  lastTranscript: string;
  lastAction: string;
  lastResponse: string;
  killSwitchActive: boolean;
  geminiConnected: boolean;
  ttsEngine: string;
};

export type TrayAction = {
  action: "quit" | "kill_switch" | "open_logs";
  timestamp: number;
};

// The JXA script that creates the native tray icon
const JXA_SCRIPT = `
ObjC.import('Cocoa');
ObjC.import('Foundation');

var app = $.NSApplication.sharedApplication;
app.setActivationPolicy($.NSApplicationActivationPolicyAccessory);

var statusBar = $.NSStatusBar.systemStatusBar;
var statusItem = statusBar.statusItemWithLength(-1);
statusItem.button.title = "🌟";
statusItem.highlightMode = true;

// Build initial menu
var menu = $.NSMenu.alloc.init;
statusItem.menu = menu;

function readStateFile() {
  try {
    var fm = $.NSFileManager.defaultManager;
    var path = "/tmp/aura-tray-state.json";
    if (!fm.fileExistsAtPath(path)) return null;
    var data = $.NSData.dataWithContentsOfFile(path);
    if (!data || data.length === 0) return null;
    var str = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding);
    return JSON.parse(str.js);
  } catch(e) {
    return null;
  }
}

function writeAction(actionName) {
  var obj = { action: actionName, timestamp: Date.now() };
  var str = JSON.stringify(obj);
  var nsStr = $.NSString.alloc.initWithUTF8String(str);
  nsStr.writeToFileAtomicallyEncodingError("/tmp/aura-tray-action.json", true, $.NSUTF8StringEncoding, null);
}

var statusIcons = {
  idle: "🌟",
  listening: "👂",
  recording: "🔴",
  transcribing: "🧠",
  planning: "🤖",
  executing: "⚡",
  speaking: "🔊",
  error: "❌"
};

var statusLabels = {
  idle: "Idle — Listening for wake word",
  listening: "Wake word detected!",
  recording: "Recording your command...",
  transcribing: "Transcribing...",
  planning: "Planning actions...",
  executing: "Executing...",
  speaking: "Speaking response...",
  error: "Error occurred"
};

function updateMenu() {
  var state = readStateFile();
  menu.removeAllItems;

  // Status indicator
  var icon = "🌟";
  var label = "Idle — Listening for wake word";
  if (state) {
    icon = statusIcons[state.status] || "🌟";
    label = statusLabels[state.status] || state.status;
  }
  statusItem.button.title = " " + icon + " AURA";

  var statusEntry = $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent(label, null, "");
  statusEntry.enabled = false;
  menu.addItem(statusEntry);

  menu.addItem($.NSMenuItem.separatorItem);

  // Last transcript
  if (state && state.lastTranscript) {
    var transcriptItem = $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent(
      "📝 " + state.lastTranscript.substring(0, 50), null, "");
    transcriptItem.enabled = false;
    menu.addItem(transcriptItem);
  }

  // Last response
  if (state && state.lastResponse) {
    var responseItem = $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent(
      "💬 " + state.lastResponse.substring(0, 50), null, "");
    responseItem.enabled = false;
    menu.addItem(responseItem);
  }

  if (state && (state.lastTranscript || state.lastResponse)) {
    menu.addItem($.NSMenuItem.separatorItem);
  }

  // Engine info
  var geminiLabel = state && state.geminiConnected ? "✅ Gemini connected" : "⚠️ Local planner only";
  var geminiItem = $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent(geminiLabel, null, "");
  geminiItem.enabled = false;
  menu.addItem(geminiItem);

  var ttsLabel = state && state.ttsEngine ? "🔊 TTS: " + state.ttsEngine : "🔊 TTS: macOS say";
  var ttsItem = $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent(ttsLabel, null, "");
  ttsItem.enabled = false;
  menu.addItem(ttsItem);

  menu.addItem($.NSMenuItem.separatorItem);

  // Quit
  var quitItem = $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent("Quit Jarvis", "terminate:", "q");
  menu.addItem(quitItem);
}

// Update menu every 1 second
var timer = $.NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats(
  1.0,
  {
    timerFired: function() { updateMenu(); }
  },
  "timerFired",
  null,
  true
);

// Initial update
updateMenu();

// Run the app
app.run;
`;

let trayProcess: ChildProcess | null = null;
let stateUpdateInterval: ReturnType<typeof setInterval> | null = null;
let currentState: TrayState = {
  status: "idle",
  lastTranscript: "",
  lastAction: "",
  lastResponse: "",
  killSwitchActive: false,
  geminiConnected: false,
  ttsEngine: "none",
};

/**
 * Write current state to the state file for the JXA script to read.
 */
async function writeState(): Promise<void> {
  try {
    await writeFile(STATE_FILE, JSON.stringify(currentState), "utf8");
  } catch {
    // ignore write errors
  }
}

/**
 * Check for actions written by the JXA script.
 */
async function checkActions(): Promise<TrayAction | null> {
  try {
    const content = await readFile(ACTION_FILE, "utf8");
    await unlink(ACTION_FILE);
    return JSON.parse(content) as TrayAction;
  } catch {
    return null;
  }
}

/**
 * Start the system tray.
 */
export function startTray(config: {
  geminiConnected: boolean;
  ttsEngine: string;
  onQuit?: () => void;
}): {
  updateState: (patch: Partial<TrayState>) => void;
  stop: () => void;
} {
  currentState.geminiConnected = config.geminiConnected;
  currentState.ttsEngine = config.ttsEngine;

  // Write initial state
  void writeState();

  // Spawn the JXA script
  trayProcess = spawn("osascript", ["-l", "JavaScript", "-e", JXA_SCRIPT], {
    stdio: "ignore",
    detached: false,
  });

  trayProcess.on("error", (err) => {
    console.warn(`⚠️  Tray icon error: ${err.message}`);
  });

  trayProcess.on("exit", () => {
    trayProcess = null;
    // If the tray exits (e.g., user clicks Quit), trigger the quit callback
    if (config.onQuit) {
      config.onQuit();
    }
  });

  // Periodically write state
  stateUpdateInterval = setInterval(() => {
    void writeState();
  }, 500);

  return {
    updateState(patch: Partial<TrayState>) {
      Object.assign(currentState, patch);
      void writeState();
    },

    stop() {
      if (stateUpdateInterval) {
        clearInterval(stateUpdateInterval);
        stateUpdateInterval = null;
      }

      if (trayProcess) {
        trayProcess.kill("SIGTERM");
        trayProcess = null;
      }

      // Clean up state files
      void unlink(STATE_FILE).catch(() => { });
      void unlink(ACTION_FILE).catch(() => { });
    },
  };
}
