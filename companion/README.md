# AURA Companion (Native Overlay)

This is the Siri-style local shell for AURA.

It provides:
- floating overlay ("mini agent")
- global shortcuts
- push-to-talk start/stop + run
- optional wake phrase loop (`Hey Aura`, experimental)
- kill switch toggle
- launch-at-login toggle
- auto-restart companion on fatal crashes (toggle)
- auto-start Aura stack (`npm run dev:all`) and restart loop (toggle)
- voice state sound cues (toggle)

## Prerequisites

- macOS (recommended for current desktop agent tooling)
- desktop agent running on `http://127.0.0.1:8765`
- `ffmpeg` installed (already required by push-to-talk flow)
- microphone + accessibility permissions granted to terminal apps

## Install and run

From repo root:

```bash
npm run install:companion
npm run dev:all
npm run dev:companion
```

## Build a double-clickable `.app` (no terminal needed for users)

From repo root:

```bash
npm run install:companion
npm run build:companion:app
```

Output app path:
- `companion/dist/mac/AURA Companion.app`

Optional DMG:

```bash
npm run build:companion:dmg
```

Output DMG path:
- `companion/dist/AURA Companion-0.1.0.dmg` (name may include architecture/version)

## Hotkeys

- `Cmd/Ctrl + Shift + A` → show/hide companion overlay
- `Cmd/Ctrl + Shift + Space` → start listening, then stop+run
- `Cmd/Ctrl + Shift + K` → toggle kill switch

## Environment flags (optional)

- `AURA_AGENT_LOCAL_URL` (default `http://127.0.0.1:8765`)
- `AURA_COMPANION_DRY_RUN` (`true`/`false`, default `false`)
- `AURA_WAKE_POLL_INTERVAL_MS` (default `2600`)
- `AURA_WAKE_CAPTURE_MS` (default `1800`)
- `AURA_COMMAND_CAPTURE_MS` (default `4200`)
- `AURA_WAKE_COOLDOWN_MS` (default `8000`)

## Built-in accessibility/reliability toggles

From the companion overlay or tray menu:
- Open at login
- Play sound cues
- Auto-restart companion
- Auto-start/auto-restart Aura stack
- Wake phrase

All toggles are persisted in `~/Library/Application Support/<App>/aura-companion.settings.json`.

Default behavior:
- Open at login: on
- Auto-restart companion: on
- Sound cues: on
- Wake phrase: off
- Auto-start stack: off

## Notes

- Wake phrase mode is experimental and optimized for demo reliability.
- For deterministic demos, keep wake phrase off and use the global shortcut.
