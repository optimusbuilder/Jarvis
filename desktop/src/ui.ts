export function renderControlCenterHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AURA Control Center</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0b1020;
      --panel: #121932;
      --panel-2: #1a2345;
      --text: #eaf0ff;
      --muted: #9fb0d9;
      --accent: #6ea8ff;
      --ok: #2dd4bf;
      --warn: #f59e0b;
      --danger: #ef4444;
      --border: #27325f;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      background: linear-gradient(180deg, #0a1024 0%, #0b1020 100%);
      color: var(--text);
      min-height: 100vh;
    }
    .wrap {
      max-width: 1080px;
      margin: 24px auto 48px;
      padding: 0 16px;
      display: grid;
      gap: 14px;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px;
    }
    h1 {
      margin: 0 0 6px;
      font-size: 22px;
      letter-spacing: 0.2px;
    }
    .subtitle {
      margin: 0;
      color: var(--muted);
      font-size: 13px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 12px;
    }
    .label {
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 6px;
    }
    input, textarea, button {
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--panel-2);
      color: var(--text);
      padding: 10px 12px;
      font: inherit;
    }
    textarea {
      width: 100%;
      min-height: 78px;
      resize: vertical;
    }
    .row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    button {
      cursor: pointer;
      transition: 120ms ease;
    }
    button:hover { border-color: var(--accent); }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    .primary { background: #23418f; }
    .danger { background: #68202a; }
    .success { background: #17433b; }
    .pill {
      display: inline-flex;
      padding: 4px 8px;
      border-radius: 999px;
      border: 1px solid var(--border);
      font-size: 12px;
      color: var(--muted);
    }
    .pill.ok { color: #7ff2de; border-color: #1f8c7d; }
    .pill.warn { color: #ffd287; border-color: #8d6828; }
    .pill.danger { color: #ff9aa5; border-color: #8d2b39; }
    pre {
      margin: 0;
      max-height: 360px;
      overflow: auto;
      border-radius: 10px;
      background: #090e1e;
      border: 1px solid #1e2a54;
      padding: 10px;
      font-size: 12px;
      line-height: 1.45;
      color: #cde0ff;
    }
    .hint {
      color: var(--muted);
      font-size: 12px;
    }
    .k {
      display: inline-block;
      border: 1px solid var(--border);
      border-bottom-width: 2px;
      border-radius: 6px;
      padding: 1px 5px;
      font-size: 11px;
      color: #d9e5ff;
      margin: 0 1px;
      background: #1a2245;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="panel">
      <h1>AURA Control Center</h1>
      <p class="subtitle">Use this interface to call AURA without touching API routes.</p>
      <div class="row" style="margin-top:10px;">
        <span id="status-pill" class="pill">Checking status…</span>
        <span id="kill-pill" class="pill">Kill switch unknown</span>
      </div>
    </section>

    <section class="panel grid">
      <div>
        <div class="label">Instruction</div>
        <textarea id="instruction" placeholder="Open Chrome and search for Whisper.cpp model setup steps."></textarea>
        <div class="row" style="margin-top:10px;">
          <button id="run-btn" class="primary">Run Instruction</button>
          <button id="dry-toggle">Mode: Dry Run</button>
        </div>
        <div class="row" style="margin-top:8px;">
          <button class="quick" data-command="Open Google Chrome">Open Chrome</button>
          <button class="quick" data-command="Open Documents folder">Open Documents</button>
          <button class="quick" data-command="Go to youtube.com and search aura demo">Search YouTube</button>
        </div>
      </div>

      <div>
        <div class="label">Voice Push-to-Talk</div>
        <div class="row">
          <button id="ptt-start" class="success">Start Listening</button>
          <button id="ptt-stop-run">Stop + Run Voice Command</button>
        </div>
        <div class="hint" style="margin-top:10px;">
          Page hotkeys:
          <span class="k">⌘/Ctrl</span> + <span class="k">Shift</span> + <span class="k">Space</span> toggles push-to-talk,
          <span class="k">⌘/Ctrl</span> + <span class="k">Enter</span> runs typed instruction,
          <span class="k">⌘/Ctrl</span> + <span class="k">Shift</span> + <span class="k">K</span> toggles kill switch.
        </div>
        <div id="voice-state" class="hint" style="margin-top:10px;">Not listening.</div>
      </div>
    </section>

    <section class="panel grid">
      <div>
        <div class="label">Safety</div>
        <input id="kill-reason" type="text" placeholder="Reason (optional when enabling kill switch)" />
        <div class="row" style="margin-top:10px;">
          <button id="kill-toggle" class="danger">Toggle Kill Switch</button>
          <button id="refresh-btn">Refresh Status</button>
        </div>
      </div>
      <div>
        <div class="label">Session Output</div>
        <pre id="output">Waiting for action…</pre>
      </div>
    </section>
  </div>

  <script>
    const state = {
      dryRun: true,
      pttCaptureId: null,
      killSwitchActive: null,
      running: false
    };

    const outputEl = document.getElementById('output');
    const instructionEl = document.getElementById('instruction');
    const runBtn = document.getElementById('run-btn');
    const dryToggle = document.getElementById('dry-toggle');
    const statusPill = document.getElementById('status-pill');
    const killPill = document.getElementById('kill-pill');
    const pttStartBtn = document.getElementById('ptt-start');
    const pttStopRunBtn = document.getElementById('ptt-stop-run');
    const voiceStateEl = document.getElementById('voice-state');
    const killToggleBtn = document.getElementById('kill-toggle');
    const killReasonEl = document.getElementById('kill-reason');
    const refreshBtn = document.getElementById('refresh-btn');

    function renderJson(label, payload) {
      outputEl.textContent = JSON.stringify({ label, at: new Date().toISOString(), payload }, null, 2);
    }

    function setBusy(busy) {
      state.running = busy;
      for (const button of document.querySelectorAll('button')) {
        button.disabled = busy;
      }
    }

    async function call(path, method, body) {
      const response = await fetch(path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(path + ' failed (' + response.status + '): ' + JSON.stringify(payload));
      }
      return payload;
    }

    function setStatusPills(status, control) {
      if (status && status.ok) {
        statusPill.className = 'pill ok';
        statusPill.textContent = 'Agent online · ' + (status.frontmost_app || 'unknown');
      } else {
        statusPill.className = 'pill danger';
        statusPill.textContent = 'Agent offline';
      }

      state.killSwitchActive = Boolean(control && control.kill_switch_active);
      if (state.killSwitchActive) {
        killPill.className = 'pill danger';
        killPill.textContent = 'Kill switch ON';
      } else {
        killPill.className = 'pill ok';
        killPill.textContent = 'Kill switch OFF';
      }
    }

    async function refreshStatus() {
      try {
        const [status, control] = await Promise.all([
          fetch('/status').then((r) => r.json()),
          fetch('/control').then((r) => r.json())
        ]);
        setStatusPills(status, control);
      } catch (error) {
        statusPill.className = 'pill danger';
        statusPill.textContent = 'Agent offline';
        killPill.className = 'pill';
        killPill.textContent = 'Kill switch unknown';
        renderJson('status_error', { error: String(error) });
      }
    }

    function applyModeLabel() {
      dryToggle.textContent = state.dryRun ? 'Mode: Dry Run' : 'Mode: Live';
    }

    async function runInstruction() {
      const instruction = String(instructionEl.value || '').trim();
      if (!instruction) {
        renderJson('validation_error', { message: 'Instruction is required.' });
        return;
      }
      setBusy(true);
      try {
        const payload = await call('/run', 'POST', {
          instruction,
          dry_run: state.dryRun
        });
        renderJson('run_instruction', payload);
      } catch (error) {
        renderJson('run_instruction_error', { error: String(error) });
      } finally {
        setBusy(false);
        await refreshStatus();
      }
    }

    async function startPtt() {
      setBusy(true);
      try {
        const payload = await call('/voice/ptt/start', 'POST', {});
        state.pttCaptureId = payload.capture_id;
        voiceStateEl.textContent = 'Listening… capture_id=' + payload.capture_id;
        renderJson('voice_ptt_started', payload);
      } catch (error) {
        renderJson('voice_ptt_start_error', { error: String(error) });
      } finally {
        setBusy(false);
      }
    }

    async function stopAndRunVoice() {
      if (!state.pttCaptureId) {
        renderJson('voice_error', { message: 'Not listening. Start push-to-talk first.' });
        return;
      }
      setBusy(true);
      try {
        const stopPayload = await call('/voice/ptt/stop', 'POST', { capture_id: state.pttCaptureId });
        state.pttCaptureId = null;
        voiceStateEl.textContent = 'Not listening.';
        const runPayload = await call('/voice/run', 'POST', {
          audio_path: stopPayload.audio_path,
          dry_run: state.dryRun
        });
        renderJson('voice_run', { stop: stopPayload, run: runPayload });
      } catch (error) {
        renderJson('voice_run_error', { error: String(error) });
      } finally {
        setBusy(false);
        await refreshStatus();
      }
    }

    async function toggleKillSwitch() {
      setBusy(true);
      try {
        const enabling = !state.killSwitchActive;
        const reason = String(killReasonEl.value || '').trim();
        const payload = await call('/control/kill-switch', 'POST', {
          active: enabling,
          reason: reason || undefined
        });
        renderJson('kill_switch_updated', payload);
        await refreshStatus();
      } catch (error) {
        renderJson('kill_switch_error', { error: String(error) });
      } finally {
        setBusy(false);
      }
    }

    runBtn.addEventListener('click', () => { void runInstruction(); });
    pttStartBtn.addEventListener('click', () => { void startPtt(); });
    pttStopRunBtn.addEventListener('click', () => { void stopAndRunVoice(); });
    killToggleBtn.addEventListener('click', () => { void toggleKillSwitch(); });
    refreshBtn.addEventListener('click', () => { void refreshStatus(); });

    dryToggle.addEventListener('click', () => {
      state.dryRun = !state.dryRun;
      applyModeLabel();
    });

    for (const quickButton of document.querySelectorAll('.quick')) {
      quickButton.addEventListener('click', () => {
        const command = quickButton.getAttribute('data-command') || '';
        instructionEl.value = command;
        void runInstruction();
      });
    }

    window.addEventListener('keydown', (event) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;

      if (event.code === 'Enter') {
        event.preventDefault();
        void runInstruction();
        return;
      }

      if (event.shiftKey && event.code === 'Space') {
        event.preventDefault();
        if (state.pttCaptureId) void stopAndRunVoice();
        else void startPtt();
        return;
      }

      if (event.shiftKey && event.code.toLowerCase() === 'keyk') {
        event.preventDefault();
        void toggleKillSwitch();
      }
    });

    applyModeLabel();
    void refreshStatus();
    setInterval(() => { void refreshStatus(); }, 5000);
  </script>
</body>
</html>`;
}

