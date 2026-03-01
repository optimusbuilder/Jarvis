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

## Other workspace tests

```bash
npm test
```

## Notes

- Contract fixtures are under `/Users/oluwaferanmioyelude/Documents/Aura/backend/test/fixtures/contracts`.
- CI policy details are in `/Users/oluwaferanmioyelude/Documents/Aura/docs/CI_PLAN.md`.
- UI automation (macOS Accessibility) and Playwright flows stay local-only for now.
