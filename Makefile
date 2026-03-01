.PHONY: test-unit test-contract test-phase0 ci-phase0 test-phase2-completion test-phase2-integration

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
