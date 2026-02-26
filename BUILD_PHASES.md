# AURA Build Phases (Browser Copilot + Computer Control Agent)

This file breaks the build into phases. Each phase has:
- a clear, actionable **goal**
- concrete **deliverables**
- a **Completion Test** (proves the phase works)
- an **Integration/Regression Test** (proves it didn’t break previous phases)

Test naming convention:
- `P{n}-C` = Phase *n* completion test
- `P{n}-IR` = Phase *n* integration/regression test

Assumptions locked for this project:
- Backend runs on **Google Cloud Run** and calls **Vertex AI (Gemini)** (proof-of-GCP requirement).
- STT is **local** via `whisper.cpp` (no keys; audio stays on-device).
- TTS uses **ElevenLabs**, routed through **Cloud Run** (`POST /tts`) with key in **Secret Manager**.
- Browser control uses **Chrome extension + Playwright**.

---

## Phase 0 — Foundations (Repo, Schemas, CI Gates)

**Goal:** Establish an enforceable contract-first foundation: schemas, lint/test pipeline, and “fail closed” defaults.

**Deliverables:**
- Tool-call JSON schema (Action mode) and suggestion JSON schema (Copilot mode)
- `ContextSnapshot` schema + redaction rules
- A single “test runner” entrypoint (Makefile/task runner) that can run unit + contract tests
- CI plan: which tests must pass on every change vs local-only tests (macOS UI automation)

**Test (P0-C): Contract validation gate**
- Feed a set of “known good” and “known bad” JSON fixtures into the schema validators.
- Expected:
  - all good fixtures pass
  - all bad fixtures fail with explicit errors
  - malformed model output yields **no action** (fails closed)

**Test (P0-IR): Baseline CI pipeline**
- Run the full lint + unit + contract suite.
- Expected:
  - deterministic pass
  - no network calls required
  - no secrets required

---

## Phase 1 — Cloud Run Backend Skeleton (GCP Proof Anchor)

**Goal:** Deploy a minimal Cloud Run backend that proves we’re on GCP and can call Vertex AI.

**Deliverables:**
- Cloud Run service with:
  - `GET /healthz`
  - `POST /plan` (calls Vertex AI Gemini and returns tool-call JSON)
- Service account + IAM for Vertex AI invoke
- Structured logs that include a `request_id` for correlation (no sensitive data)

**Test (P1-C): Deployed smoke test (GCP proof)**
- Deploy to Cloud Run.
- Call:
  - `GET /healthz` → `200` with `{ ok: true, version: ... }`
  - `POST /plan` with a canned instruction + minimal state → `200` valid JSON matching schema
- Expected:
  - Cloud Run logs show the request + Vertex AI call success
  - Response validates against the tool-call schema

**Test (P1-IR): Phase 0 regression + deployed smoke**
- Run `P0-IR` plus `P1-C`.
- Expected:
  - contract suite still passes
  - deployed endpoints still conform to schema (no breaking changes)

---

## Phase 2 — Desktop Agent Skeleton (Local Execution Plane)

**Goal:** Create the local agent loop that can receive an instruction, call the backend, and execute tools in a controlled way.

**Deliverables:**
- Local agent server exposing:
  - `GET /status` (frontmost app, agent version, permissions status)
  - `GET /tools` (tool allowlist + schemas)
  - `POST /execute` (accepts tool-call plan JSON; executes with safety gates)
- Tool registry + allowlist enforcement (unknown tool → blocked)
- Verification wrapper for every tool call (`observed_state` required)
- Local redacted audit log (no secrets, no raw sensitive fields)

**Test (P2-C): Local agent API + fail-closed tool execution**
- Start the agent locally.
- Call:
  - `GET /status` and `GET /tools` → `200`
  - `POST /execute` with an unknown tool → rejected
  - `POST /execute` with a known safe tool in “dry run” mode → accepted, but no OS changes
- Expected:
  - strict schema validation
  - blocked actions never execute

**Test (P2-IR): Backend ↔ agent integration (plan → execute dry-run)**
- Run `P1-C` to obtain a plan, then submit it to the agent in dry-run mode.
- Expected:
  - plan JSON passes schema validation end-to-end
  - agent doesn’t crash on backend output changes
  - logs show correlated `request_id` across both components

---

## Phase 3 — Chrome Extension Baseline (Snapshots + UI + Local Bridge)

**Goal:** Capture browser context safely and communicate with the desktop agent; render UI bubbles.

**Deliverables:**
- Extension that:
  - creates `ContextSnapshot` from DOM (structured only)
  - performs **local redaction** (password/cc/ssn/hidden fields)
  - sends snapshots to the desktop agent (localhost)
  - renders suggestion bubble + Accept/Dismiss controls

**Test (P3-C): Extension fixture E2E (privacy + transport + UI)**
- Load extension unpacked.
- Open a local HTML test page with:
  - visible text + form fields (including a password field)
- Expected:
  - agent receives snapshots
  - snapshots never include sensitive values
  - bubble renders and can be dismissed without errors

**Test (P3-IR): Prior phase regression + snapshot schema lock**
- Run `P2-IR` plus `P3-C`.
- Additionally validate that snapshot schema hasn’t regressed (fixtures still pass).
- Expected:
  - no changes in backend/agent break extension snapshot transport
  - redaction still holds

---

## Phase 4 — Voice Input (Push‑to‑Talk + `whisper.cpp`)

**Goal:** Turn spoken commands into reliable transcripts locally, without cloud STT.

**Deliverables:**
- Push‑to‑talk control (hotkey/button)
- Audio capture pipeline
- Local STT adapter using `whisper.cpp`
- Transcript confidence/quality heuristics (e.g., detect too-short/noisy audio → ask to repeat)

**Test (P4-C): Offline STT transcription test**
- Run STT on a fixed set of prerecorded audio fixtures (in repo).
- Expected:
  - transcript matches expected text within an acceptable tolerance
  - low-quality audio yields a “please repeat” result (no action)

**Test (P4-IR): Voice → plan (no action)**
- Speak (or feed audio) a simple command.
- Ensure:
  - transcript is produced locally
  - backend `/plan` is called with the transcript
  - agent receives plan but executes in dry-run mode
- Expected:
  - no regression in phases 1–3
  - correlation IDs connect voice request → plan response → agent receipt

---

## Phase 5 — Cloud Run TTS via ElevenLabs (`POST /tts`)

**Goal:** Produce spoken responses without putting ElevenLabs secrets on the user device.

**Deliverables:**
- Cloud Run endpoint:
  - `POST /tts` → returns audio bytes (and content-type) from ElevenLabs
- ElevenLabs API key stored in **Secret Manager**
- Desktop agent audio playback (or returns audio to UI)

**Test (P5-C): Deployed TTS smoke test**
- Call deployed `POST /tts` with a short sentence.
- Expected:
  - `200`
  - response is playable audio
  - Cloud Run logs show TTS request but do **not** log the text content verbatim if configured as sensitive

**Test (P5-IR): Full loop smoke (voice → plan → response → TTS)**
- Run `P4-IR`, but now:
  - agent speaks back an acknowledgement using `/tts`
- Expected:
  - no regressions in snapshot transport, planning, or agent stability
  - ElevenLabs key exists only in Secret Manager / Cloud Run environment (not extension/device)

---

## Phase 6 — Browser Automation (Extension + Playwright)

**Goal:** Make web tasks deterministic: “search X and open result 2”, “extract text”, etc.

**Deliverables:**
- Playwright controller for repeatable scripted flows:
  - new tab, navigate, search, click result by index, extract visible text
- Extension DOM tools for “current tab” actions:
  - click by text/role, type into active element, extract visible text
- Verification after each action (URL, ready state, existence of expected elements)

**Test (P6-C): Deterministic web flow E2E**
- Run a scripted flow against a stable target (prefer local fixture site for CI).
- Expected:
  - navigation succeeds
  - extraction returns expected content
  - retries/timeouts behave predictably

**Test (P6-IR): Regression suite + web flow**
- Run `P5-IR` plus `P6-C`.
- Expected:
  - voice + planning + TTS still work
  - extension snapshot capture still works while Playwright runs

---

## Phase 7 — System Tools (macOS Files + App Launch)

**Goal:** Reliable core OS actions with verification and confirmation for destructive operations.

**Deliverables:**
- Tools:
  - `open_app`, `open_path`, `open_url`
  - `search_files` (scoped to allowed roots)
  - `create_folder`, `rename_path`, `move_path`
  - `trash_path` (hard confirm required)
- Verification:
  - file exists checks
  - frontmost app checks
  - post-action observed state strings

**Test (P7-C): Filesystem integration test (temp sandbox)**
- Execute file ops inside a temporary directory:
  - create folder → rename → move
- Expected:
  - filesystem reflects each change
  - observed state confirms success
  - destructive op (`trash_path`) is blocked until `confirm_action` is provided

**Test (P7-IR): Web + system mixed workflow**
- Execute a two-part scenario:
  1) browse + extract text (P6)
  2) create a note file/folder (P7)
- Expected:
  - no controller interferes with the other
  - previously passing tests (`P6-IR`) still pass

---

## Phase 8 — Accessibility UI Automation (macOS)

**Goal:** Control apps via Accessibility tree (focus, menu actions, click by role/name, type text) with verification and safe fallbacks.

**Deliverables:**
- Accessibility controller:
  - focus app/window
  - click menu items by path
  - find/click elements by role + label
  - type text, press keys
- Permission checks + clear user guidance when missing
- “Vision fallback” remains off by default

**Test (P8-C): Accessibility E2E (local)**
- On macOS with Accessibility permission granted:
  - open TextEdit (or a simple target app)
  - type a sentence
  - verify the typed text exists (best-effort via clipboard/readback)
- Expected:
  - actions succeed without coordinate clicking
  - verification detects failures (e.g., wrong window focused)

**Test (P8-IR): Kill switch + regressions**
- Start an action that takes multiple steps (e.g., open app → type → menu click).
- Trigger kill switch mid-run.
- Expected:
  - execution stops immediately
  - no partial destructive actions
  - re-run `P7-IR` to ensure system + web automation still works

---

## Phase 9 — Copilot Mode (Interventions + Feedback + Optional Memory)

**Goal:** Enable minimal-interruption suggestions grounded in visible context, while keeping Action mode explicit.

**Deliverables:**
- Backend `POST /copilot`:
  - input: `ContextSnapshot`
  - output: `{ intervene, reason, response, ui_action }` (strict schema)
- Local friction scoring + thresholding (model wrapped by deterministic rules)
- Extension UI integration:
  - show bubble, accept/dismiss, cooldowns
  - feedback events routed to backend (optional Firestore)

**Test (P9-C): Copilot golden scenarios**
- Feed canned snapshots for the 4 required flows:
  1) form completion assist
  2) research consolidation
  3) writing rewrite
  4) product comparison
- Expected:
  - interventions only when threshold met
  - responses cite snapshot evidence
  - unsafe contexts produce `intervene:false`

**Test (P9-IR): Full demo regression suite**
- Run a single “demo gate” suite that includes:
  - `P6-C` (web)
  - `P7-C` (files)
  - `P8-C` (accessibility) (local-only)
  - `P5-C` (deployed TTS)
  - `P1-C` (deployed plan)
  - `P9-C` (copilot)
- Expected:
  - no regressions in action mode when copilot is enabled
  - acceptance/dismiss feedback doesn’t break planning/execution

---

## What “Done” Looks Like (Project-Level)

The project is demo-ready when:
- All completion tests (`P0-C`…`P9-C`) pass in their intended environments.
- The regression gate (`P9-IR`) passes.
- We can produce the required **proof of GCP deployment** (Cloud Run + Vertex AI calls visible in console/logs) without exposing secrets.

