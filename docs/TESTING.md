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

## Other workspace tests

```bash
npm test
```

## Notes

- Contract fixtures are under `/Users/oluwaferanmioyelude/Documents/Aura/backend/test/fixtures/contracts`.
- CI policy details are in `/Users/oluwaferanmioyelude/Documents/Aura/docs/CI_PLAN.md`.
- UI automation (macOS Accessibility) and Playwright flows stay local-only for now.
