# Testing

## Phase 0 tests

From the repo root:

```bash
make test-phase0
```

This runs:
- `P0-C` contract tests (`npm run test:contract`)
- unit tests for backend + desktop (`npm run test:unit`)

## Phase 0 regression gate

```bash
make ci-phase0
```

This is `P0-IR`: lint + typecheck + unit + contract tests with no network or secrets.

## Phase 1 deployed smoke (`P1-C`)

```bash
export AURA_BACKEND_URL="https://YOUR_CLOUD_RUN_URL"
export AURA_BACKEND_AUTH_TOKEN="YOUR_TOKEN"
npm run test:phase1:smoke
```

This verifies:
- `GET /healthz` returns `200` + `ok=true` + `version`
- `POST /plan` returns `200` + valid action-plan JSON
- `POST /copilot` returns `200` + valid copilot JSON
- `x-request-id` is returned for Cloud Run log correlation

Note: if `/healthz` returns a Google HTML 404 while `/plan` and `/copilot` pass, the script warns and continues; this indicates edge routing behavior outside app logic.

## Phase 2 local completion (`P2-C`)

Start desktop agent first:

```bash
npm -w desktop run dev
```

In a second terminal:

```bash
npm run test:phase2:completion
```

This verifies:
- `GET /status` and `GET /tools` return `200`
- unknown tool calls are blocked (`tool_not_allowed`)
- known safe tool calls succeed in `dry_run` mode with verification output

## Phase 2 integration (`P2-IR`)

With desktop agent still running and configured to reach backend:

```bash
npm run test:phase2:integration
```

This verifies:
- instruction → backend `/plan` → local `/execute` dry-run loop works end-to-end
- response schema remains stable despite backend tool-name variations
- `request_id` is preserved and correlated across components

## Phase 3 extension unit tests

```bash
npm run test:phase3:unit
```

This verifies:
- snapshot builder excludes sensitive text/fields
- snapshot shape remains compatible with backend schema
- bubble suggestion heuristics trigger only when useful

## Phase 3 extension completion (`P3-C`)

Prereqs:
- desktop agent running (`npm -w desktop run dev`)
- extension loaded unpacked from `extension/`
- open local fixture page: `extension/test/fixtures/p3-fixture.html`

Then run:

```bash
npm run test:phase3:completion
```

This verifies:
- snapshot transport reaches desktop agent `/snapshot`
- hidden/password/credit-card/SSN data is redacted before transport
- `visible_text_chunks`, `form_fields`, and `user_actions` are present

## Phase 3 integration/regression (`P3-IR`)

Run:

```bash
npm run ci:phase0
npm run test:phase2:integration
npm run test:phase3:unit
npm run test:phase3:completion
```

Expected:
- Phase 0 and Phase 2 behavior still pass unchanged
- extension snapshot/redaction changes do not break desktop or backend contracts

## Phase 4 voice completion (`P4-C`)

Prereqs:
- desktop agent running (`npm -w desktop run dev`)
- `WHISPER_CPP_BIN` + `WHISPER_MODEL_PATH` set in `.env`

Then run:

```bash
npm run test:phase4:completion
```

This verifies:
- offline whisper.cpp transcription works on a prerecorded speech fixture
- transcript quality heuristics classify good audio correctly
- low-signal audio is classified as `repeat` (no action)

## Phase 4 voice integration (`P4-IR`)

Prereqs:
- backend reachable from desktop agent (`AURA_BACKEND_URL` configured)
- desktop agent running

Then run:

```bash
npm run test:phase4:integration
```

This verifies:
- `/voice/run` performs local STT then backend `/plan`
- execution remains in `dry_run` mode
- `request_id` is preserved through the voice → plan → execute chain

## Phase 4 regression gate

Run:

```bash
npm run ci:phase0
npm run test:phase2:integration
npm run test:phase3:unit
npm run test:phase3:completion
npm run test:phase4:completion
```

Expected:
- no regressions in previous phases
- voice endpoints and STT heuristics work without breaking existing agent routes

## Phase 5 deployed TTS smoke (`P5-C`)

Prereqs:
- Cloud Run backend deployed and reachable
- `AURA_BACKEND_URL` set to your deployed backend URL
- `AURA_BACKEND_AUTH_TOKEN` set if backend auth is enabled

Then run:

```bash
npm run test:phase5:smoke
```

This verifies:
- `POST /tts` returns `200`
- response content type is audio
- audio payload size is non-trivial (not empty)
- optional output artifact can be saved with `AURA_TTS_OUTPUT_PATH`

## Phase 5 full loop integration (`P5-IR`)

Prereqs:
- desktop agent running (`npm -w desktop run dev`)
- backend reachable from desktop agent (`AURA_BACKEND_URL` configured)

Then run:

```bash
npm run test:phase5:integration
```

This verifies:
- voice transcription + planning loop works (`/voice/run`)
- response TTS path works (`/voice/respond` → backend `/tts`)
- local audio artifact is produced without breaking dry-run safety

## Phase 5 regression gate

Run:

```bash
npm run ci:phase0
npm run test:phase3:unit
npm run test:phase4:completion
npm run test:phase5:smoke
npm run test:phase5:integration
```

Expected:
- previous phases still pass
- deployed TTS and local response-audio path both pass

## Phase 6 browser automation completion (`P6-C`)

Prereqs:
- desktop agent running (`npm -w desktop run dev`)
- browser tool mode set (`AURA_BROWSER_MODE=http` for deterministic local fixtures)

Then run:

```bash
npm run test:phase6:completion
```

This verifies:
- deterministic browser flow executes end-to-end (`new_tab → go → search → click_result → extract_text`)
- post-action verification strings include navigation and extraction state
- execution succeeds against local fixture pages (no external site dependency)

## Phase 6 integration/regression (`P6-IR`)

Prereqs:
- backend reachable from desktop agent
- desktop agent running with voice pipeline configured

Then run:

```bash
npm run test:phase6:integration
```

This verifies:
- voice pipeline still works (`/voice/run`)
- browser deterministic flow still works in same session
- snapshot endpoint remains healthy (no regression to extension bridge APIs)

## Phase 6 regression gate

Run:

```bash
npm run ci:phase0
npm run test:phase4:completion
npm run test:phase5:integration
npm run test:phase6:completion
npm run test:phase6:integration
```

Expected:
- no regressions in voice/TTS/browser pipelines
- deterministic browser automation remains stable

## Phase 7 system tools completion (`P7-C`)

Prereqs:
- desktop agent running (`npm -w desktop run dev`)
- filesystem target paths under allowed roots (default includes system temp dir)

Then run:

```bash
npm run test:phase7:completion
```

This verifies:
- `create_folder`, `rename_path`, `move_path`, and `search_files` work on a temp sandbox
- `trash_path` is blocked without explicit `confirm_action`
- `confirm_action` unlocks a single destructive `trash_path` execution

## Phase 7 mixed workflow integration (`P7-IR`)

Prereqs:
- desktop agent running with browser mode available (`AURA_BROWSER_MODE=http` recommended for deterministic fixtures)

Then run:

```bash
npm run test:phase7:integration
```

This verifies:
- browser deterministic flow still works in the same `/execute` plan
- filesystem tools still work in the same run (`create_folder` + `search_files`)
- snapshot bridge endpoint remains healthy

## Phase 7 regression gate

Run:

```bash
npm run ci:phase0
npm run test:phase6:completion
npm run test:phase6:integration
npm run test:phase7:completion
npm run test:phase7:integration
```

Expected:
- no regressions in prior browser/voice/TTS behavior
- destructive filesystem actions stay gated by confirmation
- mixed browser + system execution remains stable

## Other workspace tests

```bash
npm test
```

## Notes

- Contract fixtures are under `/Users/oluwaferanmioyelude/Documents/Aura/backend/test/fixtures/contracts`.
- CI policy details are in `/Users/oluwaferanmioyelude/Documents/Aura/docs/CI_PLAN.md`.
- UI automation (macOS Accessibility) and Playwright flows stay local-only for now.
