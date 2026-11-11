# Tier filtering

Journey tier selection and CI mode: `--tier <name>` runs only journeys with that tier, and `GITHUB_ACTIONS=true` defaults to tier `ci` with no agent call.

Drive: `done-done run tier-ci` tests the three-tier fixture (ci, integration, manual) under CI mode, verifies only tier `ci` journeys run, rejects non-ci tiers, and proves no agent calls occur (all journeys are echo commands).

Prove: tier-ci.log shows CI mode ran fast-check (tier: ci) and slow-check with --tier ci, rejected integration-test (tier: integration), and made no agent calls; steps.json records the tier filtering flow.

Integration coverage: test/cli.test.mjs (future test: tier filtering in CI mode and with --tier flag)
