# Testing

## Run all workspace tests

From the repo root:

```bash
npm test
```

## Workspace-specific

```bash
npm -w backend test
npm -w desktop test
```

## Notes

- The current unit tests are network-free and use stubs/mocks for cloud calls.
- UI automation (macOS Accessibility) and Playwright flows are intended to be added as local E2E tests (not CI by default).
- See `BUILD_PHASES.md` for the phase completion + integration/regression test plan.

