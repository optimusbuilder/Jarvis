.PHONY: test-unit test-contract test-phase0 ci-phase0

test-unit:
	npm run test:unit

test-contract:
	npm run test:contract

test-phase0: test-unit test-contract

ci-phase0:
	npm run lint
	npm run typecheck
	$(MAKE) test-phase0
