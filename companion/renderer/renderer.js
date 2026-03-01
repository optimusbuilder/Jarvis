const api = window.auraCompanion;

const elements = {
  orb: document.getElementById("orb"),
  statusText: document.getElementById("statusText"),
  modePill: document.getElementById("modePill"),
  wakePill: document.getElementById("wakePill"),
  killPill: document.getElementById("killPill"),
  stackPill: document.getElementById("stackPill"),
  instructionInput: document.getElementById("instructionInput"),
  runBtn: document.getElementById("runBtn"),
  listenBtn: document.getElementById("listenBtn"),
  stopBtn: document.getElementById("stopBtn"),
  wakeBtn: document.getElementById("wakeBtn"),
  modeBtn: document.getElementById("modeBtn"),
  killBtn: document.getElementById("killBtn"),
  loginBtn: document.getElementById("loginBtn"),
  soundBtn: document.getElementById("soundBtn"),
  restartBtn: document.getElementById("restartBtn"),
  startStackBtn: document.getElementById("startStackBtn"),
  stopStackBtn: document.getElementById("stopStackBtn"),
  openCenterBtn: document.getElementById("openCenterBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  log: document.getElementById("log")
};

let currentState = null;

function textOrEmpty(value) {
  if (value == null) return "";
  return String(value);
}

function updateOrb(action, hasError) {
  const orb = elements.orb;
  orb.classList.remove("idle", "listening", "thinking", "error");
  if (hasError) {
    orb.classList.add("error");
    return;
  }
  if (action === "listening") {
    orb.classList.add("listening");
    return;
  }
  if (["thinking", "wake-detected"].includes(action)) {
    orb.classList.add("thinking");
    return;
  }
  orb.classList.add("idle");
}

function renderState(state) {
  currentState = state;
  const action = textOrEmpty(state?.lastAction || "idle");
  const error = textOrEmpty(state?.lastError);
  const transcript = textOrEmpty(state?.lastTranscript);
  const response = textOrEmpty(state?.lastResponse);

  updateOrb(action, Boolean(error));
  elements.statusText.textContent = error ? "Error" : action.replaceAll("-", " ");
  elements.modePill.textContent = `Mode: ${state?.dryRun ? "dry-run" : "live"}`;
  elements.wakePill.textContent = `Wake: ${state?.wakeWordEnabled ? "on" : "off"}`;
  elements.wakePill.className = `pill ${state?.wakeWordEnabled ? "on" : ""}`.trim();
  elements.killPill.textContent = `Kill: ${state?.killSwitchActive ? "on" : "off"}`;
  elements.killPill.className = `pill ${state?.killSwitchActive ? "danger" : ""}`.trim();
  elements.stackPill.textContent = `Stack: ${state?.stackRunning ? "running" : "stopped"}`;
  elements.stackPill.className = `pill ${state?.stackRunning ? "on" : ""}`.trim();

  elements.listenBtn.textContent = state?.listening ? "Listening…" : "Start Listen";
  elements.stopBtn.disabled = !state?.listening;
  elements.listenBtn.disabled = Boolean(state?.listening);
  elements.wakeBtn.textContent = state?.wakeWordEnabled ? "Disable Wake" : "Enable Wake";
  elements.modeBtn.textContent = state?.dryRun ? "Switch to Live" : "Switch to Dry";
  elements.killBtn.textContent = state?.killSwitchActive ? "Disable Kill" : "Enable Kill";

  elements.loginBtn.textContent = `Open At Login: ${state?.openAtLogin ? "On" : "Off"}`;
  elements.soundBtn.textContent = `Sound Cues: ${state?.playSoundCues ? "On" : "Off"}`;
  elements.restartBtn.textContent = `Auto Restart: ${state?.autoRestartCompanion ? "On" : "Off"}`;
  elements.startStackBtn.disabled = Boolean(state?.stackRunning);
  elements.stopStackBtn.disabled = !Boolean(state?.stackRunning);

  const parts = [];
  if (transcript) parts.push(`Transcript: ${transcript}`);
  if (response) parts.push(`Response: ${response}`);
  if (error) parts.push(`Error: ${error}`);
  if (!parts.length) parts.push("No events yet.");
  elements.log.classList.toggle("error", Boolean(error));
  elements.log.textContent = parts.join("\n\n");
}

async function runInstruction() {
  const instruction = textOrEmpty(elements.instructionInput.value).trim();
  if (!instruction) return;
  await api.runInstruction(instruction);
}

function bindEvents() {
  elements.runBtn.addEventListener("click", () => {
    void runInstruction();
  });

  elements.listenBtn.addEventListener("click", () => {
    void api.startListening();
  });

  elements.stopBtn.addEventListener("click", () => {
    void api.stopRun();
  });

  elements.wakeBtn.addEventListener("click", () => {
    void api.toggleWakeWord();
  });

  elements.modeBtn.addEventListener("click", () => {
    const nextDryRun = !Boolean(currentState?.dryRun);
    void api.setDryRun(nextDryRun);
  });

  elements.killBtn.addEventListener("click", () => {
    void api.toggleKill("companion_ui");
  });

  elements.loginBtn.addEventListener("click", () => {
    const next = !Boolean(currentState?.openAtLogin);
    void api.updateSetting("openAtLogin", next);
  });

  elements.soundBtn.addEventListener("click", () => {
    const next = !Boolean(currentState?.playSoundCues);
    void api.updateSetting("playSoundCues", next);
  });

  elements.restartBtn.addEventListener("click", () => {
    const next = !Boolean(currentState?.autoRestartCompanion);
    void api.updateSetting("autoRestartCompanion", next);
  });

  elements.startStackBtn.addEventListener("click", () => {
    void api.startStack("renderer_manual_start");
  });

  elements.stopStackBtn.addEventListener("click", () => {
    void api.stopStack("renderer_manual_stop");
  });

  elements.openCenterBtn.addEventListener("click", () => {
    void api.openControlCenter();
  });

  elements.refreshBtn.addEventListener("click", () => {
    void api.refreshStatus();
  });

  elements.instructionInput.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void runInstruction();
    }
  });
}

async function boot() {
  bindEvents();
  const initial = await api.getState();
  renderState(initial);
  api.onState((nextState) => {
    renderState(nextState);
  });
  void api.refreshStatus();
}

void boot();
