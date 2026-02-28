# CI Plan (Phase 0 Baseline)

This plan defines what must pass for every code change and what remains local-only.

## Required on every change (CI gate)

Run from `/Users/oluwaferanmioyelude/Documents/Aura`:

```bash
make ci-phase0
```

`make ci-phase0` runs:
1. `npm run lint`
2. `npm run typecheck`
3. `make test-phase0`
   - `npm run test:unit`
   - `npm run test:contract`

### Required properties
- No network calls.
- No cloud credentials.
- No secret values.
- Deterministic pass/fail.

## Local-only test suites (not required in CI yet)

- macOS Accessibility UI automation
- Playwright browser E2E against real sites
- `whisper.cpp` microphone integration
- Deployed Cloud Run smoke tests (`/healthz`, `/plan`, `/tts`)

These remain local-only because they depend on OS permissions, external services, or non-hermetic environments.

## Contract gate details

`P0-C` is implemented by fixture-based contract tests:
- known-good fixtures must parse
- known-bad fixtures must fail with explicit schema issues
- malformed planner/copilot output must fail closed (no actions, no unsolicited intervention)
