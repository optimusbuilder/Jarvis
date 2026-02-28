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
- `x-request-id` is returned for Cloud Run log correlation

## Other workspace tests

```bash
npm test
```

## Notes

- Contract fixtures are under `/Users/oluwaferanmioyelude/Documents/Aura/backend/test/fixtures/contracts`.
- CI policy details are in `/Users/oluwaferanmioyelude/Documents/Aura/docs/CI_PLAN.md`.
- UI automation (macOS Accessibility) and Playwright flows stay local-only for now.
