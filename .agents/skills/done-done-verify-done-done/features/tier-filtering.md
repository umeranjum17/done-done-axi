# Tier filtering

Journey tier selection and CI mode: `--tier <name>` runs only journeys with that tier, and `GITHUB_ACTIONS=true` defaults to tier `ci` with no agent call.

Drive: `done-done run tier-ci` tests the three-tier fixture (ci, integration, manual) under CI mode, verifies only tier `ci` journeys run, rejects non-ci tiers, and proves no agent calls occur (all journeys are echo commands).

Prove: tier-ci.log shows CI mode ran fast-check (tier: ci) and slow-check with --tier ci, rejected integration-test (tier: integration), and made no agent calls; steps.json records the tier filtering flow.

Integration coverage: `GITHUB_ACTIONS=true node --test --test-name-pattern="tier filtering" test/cli.test.mjs` drives local, CI and explicit-tier runs of the built CLI. The local fixture environments explicitly set `GITHUB_ACTIONS=false`; the regression turns it on to prove the CI restriction still holds.

Release CI proof: `GITHUB_ACTIONS=true done-done run e2e` runs the CI-tagged outer journey and drives its isolated local-user fixture through run, check and receipt. Evidence: e2e.log and the run-owned fixture captures.

Shadow deadline: `done-done run tier-ci` also runs a synthetic shadow batch with a shared deadline, checks interrupted work and process cleanup, and checks a passing batch and invalid deadlines. Nested verify fixtures exercise detached instance, readiness, and suite process groups; they must stop without a receipt. This is a shadow measurement and does not issue a verification receipt or enforce a layer budget. Full-batch P95 is unmeasured.

Provider budget: the same journey drives a synthetic OpenAI transport through real verify, checking one bounded request, concurrent and restarted refusals, retained reservation when usage is missing, and zero provider calls after expiry. The synthetic transport records endpoint names and output limits, never request content or credentials.

Layer pilot: `done-done verify --layer fast|release|nightly --base <ref>` runs bounded shadow checks and writes a durable `plan.json`; the previous receipt gate remains required. `--budget` sets a separate layer limit, with fast capped at 300 seconds; `--plan` resumes only the original incomplete plan and cannot renew its deadline or provider slots. The tier-ci journey checks fast refusals, every configured release outcome, a failed nightly outcome, and parent cancellation of nested readiness. Full-batch P95 and sample count are for completed shadow release or nightly batches of that layer; a layer with no sample reports null and zero.
