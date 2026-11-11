# done-done features

The repo's maintained verification map; a proof that drives one entry point is incomplete when this lists others.

- [README and website](documentation.md): real built-CLI demo, the three first-screen lines run to a first result, GitHub-rendered README and website before/after at 1280 and 390 in light/dark, link and layout checks
- [Installed-agent setup](agents-live.md): live Claude/Codex init, actual doctor probe, real CLI capture and judged receipt; explicit OpenCode free-tier limitations
- [Main command](main.md) (core journey): native run/check/receipt journey, including independent citation-base lookup and wrong-root controls, init's agent-written verify skill, and the real-product rule that refuses code-only proof
- [Upgrade in place](upgrade.md) (upgrade journey): the release path users take: install the last published done-done-axi, upgrade over it with this checkout's package, then drive the main command's e2e journey with the upgraded binary
- [Tier filtering](tier-filtering.md): journey tier selection and CI mode filtering with --tier flag
- [Flaky quarantine](flaky-quarantine.md): a journey that passes on its second run is named flaky with one warning line while the run passes
- [Test inventory ownership](inventory-ownership.md): `done-done run inventory-ownership`; a stray test file and a hand edit to an owned script fail lint by name, the same edit made by a journey command passes
- [QA planning](qa-planning.md): `done-done qa "<feature>"` plans a journey for new user-visible behaviour and marks fixtures, tests and internals no-test, recording stage planned and the reason
- [Test size bounds](size-bounds.md): `done-done run size-bounds`; an over-bound ci journey is stopped as slow, a large journey with no reason fails lint, large is night-only, `tests measure` reports five timings per test
- [Affected journey selection](affected-selection.md): `done-done run affected-select`; `done-done affected` follows sources, imports and path calls to a changed file, and sends unknown or global files to the whole local tier with the reason
- [QA writing](qa-writing.md): `done-done qa "<feature>" --write` adds one journey and config entry for a new command no journey covers, writes nothing on a second run or for a refactor
- [QA proof loop](qa-proving.md): `done-done run qa-prove`; `done-done qa "<feature>" --prove --max n` runs the covering journey through verify, fixes at most n times and seals a receipt for HEAD, or ends fixed on a done-done branch or fail at n
- [Test value](test-value.md): `done-done run test-value`; `tests value` plants faults in scratch copies and marks a test that catches them real, one that catches none slop, and a slower one catching the same faults duplicate, leaving the work copy unchanged
- [Affected selection audit](affected-audit.md): `done-done run affected-audit`; `done-done affected --audit <range>` finds a journey that failed at a receipted commit the map did not select, writes the file/journey pair to the feature that names it, prints recall, and `affected` then selects it
- [Test improvement plan](test-improve.md): `done-done run test-improve`; `tests improve --plan-only` proposes stage proposed with keep, drop and move rows and the gaps no test catches, and leaves git status clean
- [Applying a test plan](test-apply.md): `done-done run test-apply`; `tests improve --apply drop|move --plan <file>` reruns the kept tests against the plan's faults, refuses a plan that loses a fault's only catcher, removes two redundant tests with a shorter summed time, and a journey from `journey add` closes the gap
- [Minimum journey scope](minimum-scope.md): `done-done run minimum-scope`; `done-done verify --journeys <journey> --named-by <who>` drives only the journey the caller names, and the receipt records that list, who named it and the journeys not run (the affected ones too), while `affected` still exits 1
- [Registered test-script updates](registered-script.md): run `done-done run registered-script`
