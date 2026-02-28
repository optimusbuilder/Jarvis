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

For local STT (optional until the voice loop exists):
- `WHISPER_CPP_BIN` (usually `whisper-cli`)
- `WHISPER_MODEL_PATH`

If you want the desktop agent to call the backend, set:
- `AURA_BACKEND_URL` (local: `http://127.0.0.1:8080`)
- `AURA_BACKEND_AUTH_TOKEN` (optional; must match backend if set)

Note: `desktop/` and `backend/` will automatically load `.env` from the repo root (or from the workspace directory) during local development.

## 3) Run the desktop agent

```bash
npm -w desktop run dev
```

Verify:

```bash
curl http://127.0.0.1:8765/status
curl http://127.0.0.1:8765/tools
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

Verify snapshot transport:

```bash
curl http://127.0.0.1:8765/snapshot
```

Visit any webpage and re-run the curl; `snapshot` should change over time.
