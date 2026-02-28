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

Minimum for local agent → Cloud Run:
- `AURA_BACKEND_URL`
- `AURA_BACKEND_AUTH_TOKEN`

For local STT (optional until the voice loop exists):
- `WHISPER_CPP_BIN` (usually `whisper-cli`)
- `WHISPER_MODEL_PATH`

## 3) Run the desktop agent

```bash
npm -w desktop run dev
```

Verify:

```bash
curl http://127.0.0.1:8765/status
curl http://127.0.0.1:8765/tools
```

## 4) Build + load the Chrome extension

Build:

```bash
npm -w extension run build
```

Load unpacked extension in Chrome:
- Chrome → Extensions → Enable Developer Mode → “Load unpacked”
- Select the `extension/` folder (it contains `manifest.json`)

Verify snapshot transport:

```bash
curl http://127.0.0.1:8765/snapshot
```

Visit any webpage and re-run the curl; `snapshot` should change over time.

