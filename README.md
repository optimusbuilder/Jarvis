# AURA — Context‑Aware Copilot (Browser + Computer Control)

AURA is a “Siri‑like” assistant that can **help inside the browser** and (optionally) **take real actions on the user’s computer**—reliably and safely.

This repo is currently **design‑first**: it documents how we’ll build AURA into reality, which credentials/permissions are needed, and how we’ll test every feature **before writing the full product code**.

---

## Product Modes

### 1) Copilot mode (unsolicited, minimal interruptions)

Runs mostly in the browser:
- Observes **structured visible context** (no screenshots for MVP)
- Detects friction (pauses, repeated edits, tab oscillation, unanswered required fields)
- Intervenes only when helpful, with grounded explanations

### 2) Action mode (explicit user command → computer control)

Runs locally on the user’s machine (push‑to‑talk in v1):
- Speech → text → plan → **structured tool calls**
- Executes actions via deterministic controllers (OS APIs, Accessibility, DOM, Playwright)
- **Verifies after every action**
- Asks when ambiguous; confirms destructive actions; includes a kill switch

Important safety stance: **Copilot mode can suggest; Action mode can do.** We don’t silently perform risky OS actions without explicit intent.

---

## High‑Level Architecture (Local‑First, Cloud‑Assisted)

Key rule: **tool execution and safety enforcement happen locally**. Cloud services (LLMs/memory) are optional helpers—never direct “remote control”.

```mermaid
flowchart LR
  subgraph Browser["Chrome Extension (Perception + UI)"]
    CS["Content Script\n(DOM signals → ContextSnapshot)"]
    BGUI["Suggestion Bubble UI\nAccept / Dismiss"]
    CS --> BGUI
  end

  subgraph Desktop["AURA Desktop Agent (Local)"]
    PTT["Push‑to‑Talk\n+ Kill Switch"]
    STT["STT Adapter\n(local or cloud)"]
    PLAN["Planner (LLM)\nJSON tool-calling"]
    SAFE["Safety Layer\nallowlist + confirm + policy"]
    TOOLS["Controllers / Tools\nSystem + Browser + UI"]
    VERIFY["Verification\n(observed state)"]
    LOG["Audit Log\n(redacted)"]
    PTT --> STT --> PLAN --> SAFE --> TOOLS --> VERIFY --> PLAN
    SAFE --> LOG
    TOOLS --> LOG
    VERIFY --> LOG
  end

  subgraph Cloud["Optional Cloud Services"]
    LLM["LLM API\n(Gemini / OpenAI / etc.)"]
    MEM["Session Memory\n(Firestore or local)"]
    EMB["Embeddings Profile\n(optional)"]
  end

  Browser <--> Desktop
  Desktop <--> LLM
  Desktop <--> MEM
  Desktop <--> EMB
```

---

## Deterministic Control Strategy (How We Avoid “Vision Clicking”)

We always prefer the most deterministic control surface:

1. **Structured APIs (preferred)**
   - File operations via OS APIs
   - Browser via DOM (extension) or Playwright locators
2. **Accessibility UI automation**
   - Find controls by role/name, click menu items, set field values
3. **Vision fallback (last resort)**
   - Screenshot → locate target → click coordinates
   - Used only when (1) and (2) fail, and guarded by extra safety rules

---

## Core Tooling (Action Mode)

### Tool contract (verification-first)

Every tool returns:

```json
{
  "success": true,
  "observed_state": "Finder is frontmost; created folder 'Invoices' in ~/Documents; verified exists.",
  "error": null
}
```

The planner must **not** assume success. It reads `observed_state` and decides the next step (retry, alternative, or ask a question).

### Tool schema (MVP set)

System (macOS):
- `open_app(name)`
- `open_path(path)`
- `open_url(url)`
- `search_files(query, root_paths?)`
- `create_folder(path)`
- `rename_path(from, to)`
- `move_path(from, to)`
- `trash_path(path)` (always requires confirmation)

Browser:
- **DOM-first (extension):**
  - `browser_click_text(text)`
  - `browser_type_active(text)`
  - `browser_extract_visible_text()`
  - `browser_get_active_url()`
- **Playwright (optional deterministic flows):**
  - `browser_new_tab()`, `browser_go(url)`, `browser_search(query)`, `browser_click_result(index)`

UI (Accessibility):
- `focus_app(name)`
- `click_menu(menu_path[])`
- `click_role(name, role)`
- `type_text(text)`
- `press_key(keys[])`

Safety:
- `confirm_action(reason)` (required for destructive/irreversible operations)
- `abort(reason)` (kill switch / safe stop)

---

## Data Models

### `ContextSnapshot` (from extension → desktop agent)

Structured only; sanitized locally before leaving the page.

```ts
type ContextSnapshot = {
  session_id: string;
  url: string;
  domain: string;
  page_type: "article" | "form" | "product" | "editor" | "search" | "other";

  page_title: string;
  visible_text_chunks: Array<{
    id: string;
    text: string; // truncated + sanitized
    source: "h1" | "p" | "li" | "label" | "other";
  }>;

  active_element: null | {
    kind: "input" | "textarea" | "contenteditable" | "select";
    label: string;
    input_type?: string;
    value_length?: number; // length only for sensitive fields
  };

  form_fields: Array<{
    field_id: string;
    label: string;
    kind: "input" | "textarea" | "select";
    input_type?: string;
    required?: boolean;
    is_sensitive: boolean;
    answered: boolean;
  }>;

  user_actions: Array<
    | { type: "cursor_idle"; ms: number }
    | { type: "tab_switch"; from_domain: string; to_domain: string }
    | { type: "text_edit_burst"; count: number }
    | { type: "selection"; chars: number }
  >;

  hesitation_score: number;
  tab_cluster_topic?: string;
  timestamp: string; // ISO-8601
};
```

### Desktop observed state (for verification)

```ts
type DesktopState = {
  os: "macos";
  frontmost_app: string;
  frontmost_window_title?: string;
  active_url?: string; // if browser is detectable
  recent_actions: Array<{ tool: string; ok: boolean; ts: string }>;
};
```

---

## Planner Outputs (Two Schemas)

### Copilot mode output (suggestion only)

```json
{
  "intervene": false,
  "reason": "Not enough friction; user is scrolling normally.",
  "response": "",
  "ui_action": null
}
```

### Action mode output (tool calls)

```json
{
  "goal": "Rename the PDF to include the date",
  "questions": [],
  "tool_calls": [
    { "name": "search_files", "args": { "query": "Report.pdf", "root_paths": ["~/Documents"] } },
    { "name": "rename_path", "args": { "from": "~/Documents/Report.pdf", "to": "~/Documents/Report-2026-02-26.pdf" } }
  ]
}
```

We enforce strict JSON schema validation; malformed model output fails closed (no action).

---

## Safety & Privacy (Non‑Negotiables)

- **No secrets in the Chrome extension.**
- **Local filtering** in extension + **server/local re-checks** (defense-in-depth).
- **Sensitive fields never sent** (passwords, credit cards, SSNs, hidden DOM fields).
- **Domain allow/deny lists** (disable on auth/banking/health by default).
- **Confirmation prompts** for destructive actions (delete/trash/move sensitive files).
- **Ask when ambiguous** (multiple matches, unclear target app/window/file).
- **Kill switch** hotkey stops execution immediately.
- **Audit logs** are redacted and stored locally; cloud logging is opt-in.

---

## Credentials / API Keys / Secrets Needed

You’ll choose providers; keys depend on that choice. The recommended path avoids embedding secrets in the extension and keeps the “actuation plane” local.

### LLM (Planner / Reasoning)

Recommended (Vertex AI):
- Google Cloud Project + Vertex AI enabled
- Desktop agent uses ADC or service account credentials
  - `GOOGLE_CLOUD_PROJECT`
  - `GOOGLE_CLOUD_REGION`
  - `AURA_GEMINI_MODEL`

Alternative (API key):
- `GEMINI_API_KEY` (secret) **stored only by the desktop agent**, never in the extension

Alternative (OpenAI):
- `OPENAI_API_KEY` (secret) for planning/tool-calling models

### STT (Speech‑to‑Text)

Pick one:
- Local STT (e.g., whisper.cpp): **no keys**
- OpenAI STT: `OPENAI_API_KEY`
- Google Speech‑to‑Text: Google Cloud credentials (service account / ADC)

### TTS (Text‑to‑Speech) (optional for demo)

Pick one:
- Local TTS: **no keys**
- OpenAI TTS: `OPENAI_API_KEY`
- Google Cloud Text‑to‑Speech: Google Cloud credentials (service account / ADC)

### Memory (optional)

Local-first (recommended for early demo):
- SQLite/JSON: **no keys**

Cloud memory (optional):
- Firestore (service account / ADC)
  - `AURA_FIRESTORE_SESSIONS_COLLECTION`
  - `AURA_FIRESTORE_EVENTS_COLLECTION`

### Ops (optional)

- `SENTRY_DSN`

---

## Local Permissions (macOS Demo Requirements)

To operate the computer on macOS, the desktop agent will request:

- **Microphone** (push‑to‑talk)
- **Accessibility** (UI automation)
- **Automation / Apple Events** (if controlling specific apps via Apple Events)
- **Screen Recording** (only if enabling vision fallback)
- **Files & Folders / Full Disk Access** (only if file search spans protected locations)

We fail closed if required permissions are missing.

---

## Testing Strategy (How We Prove Each Feature Works)

Guiding rule: **mock the model for determinism**, then run a small number of live-model smoke tests.

### 1) Extension: context capture + privacy filtering

Test:
- Visible text extraction is sanitized + size-limited
- Form parsing captures labels/types/required fields
- Sensitive inputs are detected and excluded

How:
- Unit: JSDOM fixtures
- E2E: Playwright/Puppeteer + extension runner against local HTML fixtures

### 2) Desktop agent: planner + schema enforcement

Test:
- Tool-call JSON validates
- Disallowed tools/args are blocked
- Ambiguity triggers questions, not actions

How:
- Unit: golden tests (“instruction → tool_calls” with a mocked LLM)
- Contract: invalid JSON → no action

### 3) System controller (files/apps/urls)

Test:
- Open app/path/url works and is verified
- File operations are correct and reversible where possible
- Trash/delete always requires confirmation

How:
- Integration: run against temp directories; assert filesystem state after each tool

### 4) Browser controller (DOM-first + Playwright optional)

Test:
- Navigation, search, click, extract text is stable
- Verification reads active URL and page-ready signals

How:
- Integration/E2E: Playwright tests with known sites/fixtures (plus local HTML pages)

### 5) Accessibility controller (UI automation)

Test:
- Focus app/window, click menu items, type text, press keys
- Post-condition verification (frontmost app, UI element existence where possible)

How:
- Local E2E harness (manual + scripted) using a small “test app”/fixture window
- CI uses mocked accessibility tree where feasible (real UI automation is hard in headless CI)

### 6) Voice loop (push‑to‑talk → STT → plan → execute)

Test:
- Push‑to‑talk toggles reliably
- STT produces expected transcript on prerecorded audio
- Full loop succeeds on demo commands and stops safely on kill switch

How:
- E2E: prerecorded audio fixtures + mocked STT for CI + a live STT smoke test flag

---

## 4‑Week Build Timeline (Reliable Demo in 1 Month)

### Week 1 — Core loop
- Push‑to‑talk + kill switch
- STT adapter
- Planner + tool schema + JSON validation
- `open_app`, `open_path`, `open_url`, logging

### Week 2 — Browser control (critical unlock)
- Extension ↔ desktop agent bridge (localhost)
- DOM-first browser tools + verification
- Optional Playwright for deterministic scripted flows

### Week 3 — OS interaction (macOS)
- File tools (create/rename/move) + confirm gates
- Accessibility controller basics (focus/menu/type)

### Week 4 — Reliability + safety
- Ambiguity questions + confirmations
- Retries/timeouts + safe abort
- Action history UI (“what I did”)
- Golden scenario suite + live-model smoke tests

---

## Next Step (When You’re Ready)

Confirm 3 decisions and we can proceed to scaffolding (still minimal/no product code until you say so):

1. **LLM provider:** Vertex AI (service account) vs API-key provider  
2. **STT/TTS path:** local (no keys) vs cloud (keys/credentials)  
3. **Browser control preference:** DOM-first (extension) only, or extension + Playwright

