.PHONY: test-unit test-contract test-phase0 ci-phase0 test-phase2-completion test-phase2-integration test-phase3-unit test-phase3-completion test-phase4-completion test-phase4-integration test-phase5-smoke test-phase5-integration test-phase6-completion test-phase6-integration test-phase7-completion test-phase7-integration

test-unit:
	npm run test:unit

test-contract:
	npm run test:contract

test-phase0: test-unit test-contract

ci-phase0:
	npm run lint
	npm run typecheck
	$(MAKE) test-phase0

test-phase2-completion:
	npm run test:phase2:completion

test-phase2-integration:
	npm run test:phase2:integration

test-phase3-unit:
	npm run test:phase3:unit

test-phase3-completion:
	npm run test:phase3:completion

test-phase4-completion:
	npm run test:phase4:completion

test-phase4-integration:
	npm run test:phase4:integration

test-phase5-smoke:
	npm run test:phase5:smoke

test-phase5-integration:
	npm run test:phase5:integration

test-phase6-completion:
	npm run test:phase6:completion

test-phase6-integration:
	npm run test:phase6:integration

test-phase7-completion:
	npm run test:phase7:completion

test-phase7-integration:
	npm run test:phase7:integration
