# Tier filtering

Journey tier selection and CI mode: `--tier <name>` runs only journeys with that tier, and `GITHUB_ACTIONS=true` defaults to tier `ci` with no agent call.

Drive: `done-done run tier-ci` tests the three-tier fixture (ci, integration, manual) under CI mode, verifies only tier `ci` journeys run, rejects non-ci tiers, and proves no agent calls occur (all journeys are echo commands).

Prove: tier-ci.log shows CI mode ran fast-check (tier: ci) and slow-check with --tier ci, rejected integration-test (tier: integration), and made no agent calls; steps.json records the tier filtering flow.

Integration coverage: `GITHUB_ACTIONS=true node --test --test-name-pattern="tier filtering" test/cli.test.mjs` drives local, CI and explicit-tier runs of the built CLI. The local fixture environments explicitly set `GITHUB_ACTIONS=false`; the regression turns it on to prove the CI restriction still holds.

Release CI proof: `GITHUB_ACTIONS=true done-done run e2e` runs the CI-tagged outer journey and drives its isolated local-user fixture through run, check and receipt. Evidence: e2e.log and the run-owned fixture captures.
