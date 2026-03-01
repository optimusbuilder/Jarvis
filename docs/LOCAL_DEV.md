# Local Development

This repo is a monorepo with three workspaces:
- `backend/` — Cloud Run backend (Vertex AI planner + ElevenLabs TTS proxy)
- `desktop/` — local desktop agent (tool execution + localhost API)
- `extension/` — Chrome extension (context snapshots → localhost agent)

## 1) Install dependencies

From the repo root:

```bash
npm install
```

## 2) Configure env vars

Create a local `.env` (never commit it):

```bash
cp .env.example .env
```

For local-only development, keep:
- `AURA_PLANNER_MODE=local`
- `AURA_TTS_MODE=stub`
- `AURA_AUDIT_LOG_PATH=logs/desktop-agent.audit.log` (default)

For local STT (optional until the voice loop exists):
- `WHISPER_CPP_BIN` (usually `whisper-cli`)
- `WHISPER_MODEL_PATH`
- `WHISPER_NO_GPU=true` (recommended on laptops to avoid Metal allocation failures)
- `WHISPER_DEFAULT_LANGUAGE=en`
- `AURA_AUDIO_PLAYER_CMD=afplay` (optional; used when `speak=true`)

If you want the desktop agent to call the backend, set:
- `AURA_BACKEND_URL` (local: `http://127.0.0.1:8080`)
- `AURA_BACKEND_AUTH_TOKEN` (optional; must match backend if set)
- `AURA_BROWSER_MODE=http` (deterministic local fixture mode; optional `playwright` for live browser automation)
- `AURA_BROWSER_TIMEOUT_MS=15000`
- `AURA_ALLOWED_PATHS=/tmp,/Users/<you>/Documents` (optional allowlist for file tools like `create_folder`, `move_path`, `trash_path`)
- `AURA_SEARCH_MAX_SCAN=5000` (optional max entries scanned by `search_files`)

For Accessibility UI tools (`focus_app`, `click_menu`, `type_text`, `press_key`):
- macOS only
- grant Accessibility permission to your terminal/Codex app in System Settings > Privacy & Security > Accessibility

Note: `desktop/` and `backend/` will automatically load `.env` from the repo root (or from the workspace directory) during local development.

## 3) Run the desktop agent

```bash
npm -w desktop run dev
```

Open the user-facing control UI in your browser:

```bash
open http://127.0.0.1:8765
```

The UI gives users:
- typed instruction execution (`/run`)
- push-to-talk start/stop + voice execution (`/voice/ptt/*`, `/voice/run`)
- kill-switch toggle (`/control/kill-switch`)
- keyboard shortcuts while the page is focused:
  - `Cmd/Ctrl + Enter` → run typed instruction
  - `Cmd/Ctrl + Shift + Space` → toggle push-to-talk
  - `Cmd/Ctrl + Shift + K` → toggle kill switch

Optional native overlay companion (Siri-style launcher):

```bash
npm run install:companion
npm run dev:companion
```

Companion hotkeys:
- `Cmd/Ctrl + Shift + A` → show/hide overlay
- `Cmd/Ctrl + Shift + Space` → start/stop voice command
- `Cmd/Ctrl + Shift + K` → toggle kill switch

Companion reliability toggles (in overlay + tray menu):
- Open at login
- Sound cues
- Auto-restart companion
- Start/stop Aura stack (`npm run dev:all`)

Companion docs: `companion/README.md`

Build distributable macOS app bundle:

```bash
npm run build:companion:app
```

Artifact: `companion/dist/mac/AURA Companion.app`

API verify (optional for debugging):

```bash
curl http://127.0.0.1:8765/status
curl http://127.0.0.1:8765/tools
curl -X POST http://127.0.0.1:8765/execute -H "Content-Type: application/json" -d '{"dry_run":true,"plan":{"goal":"Open Chrome","questions":[],"tool_calls":[{"name":"open_app","args":{"name":"Google Chrome"}}]}}'
curl -X POST http://127.0.0.1:8765/copilot -H "Content-Type: application/json" -d '{"context_snapshot":{"session_id":"local","url":"https://example.com","domain":"example.com","page_type":"article","page_title":"Example","visible_text_chunks":[{"id":"1","text":"hello","source":"p"}],"active_element":null,"form_fields":[],"user_actions":[],"hesitation_score":0.1,"timestamp":"2026-01-01T00:00:00.000Z"}}'
curl -X POST http://127.0.0.1:8765/copilot/feedback -H "Content-Type: application/json" -d '{"session_id":"local","action":"dismiss","suggestion_kind":"summary"}'
curl -X POST http://127.0.0.1:8765/control/kill-switch -H "Content-Type: application/json" -d '{"active":true,"reason":"manual stop"}'
curl -X POST http://127.0.0.1:8765/control/kill-switch -H "Content-Type: application/json" -d '{"active":false}'
```

## 3b) Run the backend locally (local planner + stub TTS)

```bash
npm -w backend run dev
```

Or run both backend + desktop together:

```bash
npm run dev:all
```

## 4) Build + load the Chrome extension

Build:

```bash
npm -w extension run build
```

Load unpacked extension in Chrome:
- Chrome → Extensions → Enable Developer Mode → “Load unpacked”
- Select the `extension/` folder (it contains `manifest.json`)
- For local `file://` fixture pages, enable “Allow access to file URLs” for the extension.

Verify snapshot transport:

```bash
curl http://127.0.0.1:8765/snapshot
```

Visit any webpage and re-run the curl; `snapshot` should change over time.

Optional Phase 3 fixture:
- Open `extension/test/fixtures/p3-fixture.html` in Chrome and interact with fields.
- The extension should:
  - send redacted snapshots (no password/SSN/card values),
  - show an AURA suggestion bubble with Accept/Dismiss when hesitation is detected.

## 5) Run instruction loop (desktop → backend → execute)

```bash
curl -X POST http://127.0.0.1:8765/run \
  -H "Content-Type: application/json" \
  -H "x-request-id: local-run-1" \
  -d '{"instruction":"Open Chrome","dry_run":true}'
```

Audit log is written to `AURA_AUDIT_LOG_PATH` (default: `logs/desktop-agent.audit.log`).

## 6) Run voice loop locally (Phase 4)

With desktop agent running, test offline STT:

```bash
curl -X POST http://127.0.0.1:8765/voice/transcribe \
  -H "Content-Type: application/json" \
  -d '{"audio_path":"'"$(pwd)"'/speech.mp3","language":"en"}'
```

Push-to-talk capture API (macOS, local):

```bash
curl -X POST http://127.0.0.1:8765/voice/ptt/start -H "Content-Type: application/json" -d '{}'
# wait while speaking
curl -X POST http://127.0.0.1:8765/voice/ptt/stop -H "Content-Type: application/json" -d '{}'
```

Voice → planner dry-run:

```bash
curl -X POST http://127.0.0.1:8765/voice/run \
  -H "Content-Type: application/json" \
  -H "x-request-id: local-voice-run-1" \
  -d '{"audio_path":"'"$(pwd)"'/speech.mp3","language":"en","dry_run":true}'
```

Generate TTS audio via backend and return local file path:

```bash
curl -X POST http://127.0.0.1:8765/voice/respond \
  -H "Content-Type: application/json" \
  -d '{"text":"Acknowledged. I opened Chrome.","speak":false}'
```

Run deterministic browser automation flow against local fixture:

```bash
npm run test:phase6:completion
```

Run filesystem safety workflow (create/rename/move/trash with confirmation):

```bash
npm run test:phase7:completion
```

Run Accessibility completion flow (TextEdit focus/type/copy verification):

```bash
npm run test:phase8:completion
```

Run copilot golden scenarios + feedback flow against backend:

```bash
npm run test:phase9:completion
```

Run copilot integration/regression checks (planner + copilot + feedback in one flow):

```bash
npm run test:phase9:integration
```
