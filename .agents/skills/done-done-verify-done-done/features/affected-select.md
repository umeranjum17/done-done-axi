# Affected journey selection: chains, fallbacks and shadow plans

Request: Read src/affected.ts src/native-report.ts src/config.ts src/cli.ts and dist/cli.js. Exercise done-done affected main --shadow <plan.json> using clean committed synthetic fixture repositories. affected.owners maps each owner to tests and inputs glob lists. plan JSON has picks rows {test, owner, input, reason}, native queries and fallback, counts.extras and optional report when --report <junit.xml> --report-head HEAD are supplied. Use a local synthetic node_modules/.bin/jest executable to emulate a runner and make a 92 leaf owner fixture with exactly 91 extras; shared input selects both owners; a nonempty Jest result misses a subprocess input that its declaration restores, and removing that owner requires fallback. Include rename, deletion, glob member, unavailable runner, wrong report revision, JUnit parameter IDs, retries and summary-only unknown counts. Preserve every existing journey check. Use synthetic fixtures only.

Source: `journeys/affected-select.mjs`, `journeys/affected-select.mjs`.

## Drive and capture

Run `done-done run affected-select`. The committed script drives the app, checks the result and writes captures and steps.json into $DONE_DONE_EVIDENCE_ROOT.

## Checks

Existing checks kept: import-chain (app-check with the three-hop reason, no fallback), path-call, unknown-file (local-a,local-b with the whole-local-tier reasons and fallback), global-file (local-a,local-b with the global-file reason). New checks, all on the CLI's shadow plan JSON (the plan file written outside the repo) unless noted:
1. shadow-owned: change src/core/value.mjs. mode shadow, complete true, fallback null, unknown []. 92 leaves picked, counts.selected 92, counts.extras 91 (picked tests not in the runner's file list). Every row owner core, input src/core/value.mjs; the runner-reported leaf keeps its 'runner-reported file list' row.
2. shadow-shared: change src/shared.mjs. Owners are exactly core and web; counts.selected 93; web's leaf is picked with reason 'declared input src/shared.mjs'.
3. shadow-subprocess: change src/core/value.mjs and fixtures/core/data.json. The runner's query for the value file has one file; its query for data.json has files []; the declaration restores 92 leaves for data.json with reason 'declared input fixtures/core/**'; complete true.
4. shadow-rename-delete-glob: a git mv into src/core/renamed/, a git rm of src/core/gone.mjs and a new src/core/deep/member.mjs. Each path is picked by core under 'src/core/**'; complete true, unknown [].
5. shadow-no-owner: core owner removed. Plan incomplete, unknown contains src/core/value.mjs, fallback names 'inputs without declared owners: src/core/value.mjs'. The non-shadow affected run returns journeys local-a,local-b with a fallback saying the file is in no feature or journey.
6. shadow-no-runner: node_modules/.bin/jest absent. Plan still written, complete false, fallback nonempty.
7. shadow-report-wrong-revision: --report-head is the base commit, not HEAD. Plan complete false, fallback mentions report.
8. shadow-report-junit: report at HEAD. Plan complete true; report.format junit; report.raw equals the written bytes; known 93; attempted 92; leaf-000-p2 name decoded to 'value adds [2, & 3]'; leaf-000-p1 has classname core.leaf-000; leaf-001 retries 2 and passed; leaf-002 skipped.
9. shadow-report-summary: summary-only report. report.known and report.attempted null; leaves [].
Caveats: the --shadow, --report and --report-head flag wiring and the plan's report/native shapes are taken from the brief and src/affected.ts, src/native-report.ts; cli.ts was truncated in what I read, so the exact runner invocation and the report key name in the plan are not verified here. I have not run the script. Nothing was edited. Spends: none.

## Improved coverage

Instruction: Repair the generated shadow journey fixture after its check failed. Read src/affected.ts src/native-report.ts src/config.ts src/cli.ts and journeys/affected-select.mjs. The synthetic Jest executable must emit a nonempty version for --version and JSON arrays for --findRelatedTests --listTests --json, not newline paths. Deleted inputs must retain their declared picks and require conservative fallback, and a mismatched --report-head must be rejected without a plan. Preserve all other assertions and coverage; inspect stdout as well as stderr on a CLI failure. Keep the 92 leaf, shared owner, subprocess, unowned, glob, JUnit retry and summary cases.

Source: `journeys/affected-select.mjs`.

Existing checks kept: import-chain, path-call, unknown-file, global-file, shadow-owned (92 picked, 91 extras), shadow-shared (93 selected), shadow-subprocess, shadow-no-owner, shadow-no-runner, shadow-report-junit and shadow-report-summary. Repairs: the synthetic jest prints a nonempty version for --version (the plan's native.version is asserted nonempty) and a JSON array for --findRelatedTests --listTests --json. shadow-rename-delete-glob: renamed, deleted and glob-member inputs each keep their declared 'src/core/**' picks (92 tests), but the plan is incomplete (complete false) and its fallback names the deleted input src/core/gone.mjs. shadow-report-wrong-revision: --report-head set to the base commit makes the CLI exit nonzero with 'report-head does not match HEAD' and writes no plan file. A CLI failure message includes stdout as well as stderr. Not run here.

## Improved coverage

Instruction: Read src/affected.ts src/cli.ts src/native-report.ts journeys/affected-select.mjs and .agents/skills/done-done-verify-done-done/features/affected-select.md. Preserve all checks. On the same 92-leaf synthetic fixture, first drive the existing gate with done-done affected main and assert and record its result and measured wall time, then drive the shadow plan and assert and record 92 selected with 91 extras and its measured wall time. Clearly identify the existing gate as the before/control, not a prior binary; budget remains unmeasured. The generated checks documentation must state explicitly that its latest corrections supersede earlier stale statements: deletion causes incomplete fallback, wrong report revision is rejected with no plan, and the script is run by done-done after generation. Do not claim unperformed checks.

Source: `journeys/affected-select.mjs`.

Generated checks documentation. Its latest corrections supersede earlier stale statements: deletion causes incomplete fallback (a deleted input makes the shadow plan incomplete with a fallback naming it, while its declared picks are kept), a wrong report revision is rejected with no plan written, and the script is run by done-done after generation (done-done run affected-select, i.e. node journeys/affected-select.mjs).

Assertions, all against real CLI output on clean committed synthetic repos (no model, no network):
- Existing checks preserved: import-chain (app-check, three-hop reason, no fallback), path-call, unknown-file (local-a,local-b with the whole-local-tier reasons and fallback), global-file (local-a,local-b with the global-file reason).
- Before/control (existing gate, not a prior binary): done-done affected main on the 92-leaf fixture with src/core/value.mjs changed returns journeys local-a,local-b with a fallback matching "in no feature or journey". Its exit status and measured wall time are recorded in affected-select.log and timings.json.
- shadow-owned (after): mode shadow, complete true, fallback null, unknown [], 92 leaves picked, counts.selected 92, counts.extras 91, every row owner core, runner-reported leaf keeps its row. Measured wall time recorded in timings.json beside the control.
- shadow-shared: owners core and web, counts.selected 93, web leaf reason 'declared input src/shared.mjs'.
- shadow-subprocess: runner query for data.json has files [], declaration restores 92 leaves, complete true.
- shadow-rename-delete-glob: renamed, deleted and glob-member inputs each pick 92 core leaves with 'declared input src/core/**'; complete false; fallback names 'deleted input src/core/gone.mjs'.
- shadow-no-owner: complete false, unknown contains src/core/value.mjs, fallback names it; non-shadow run returns local-a,local-b.
- shadow-no-runner: plan written, complete false, fallback nonempty.
- shadow-report-wrong-revision: CLI exits nonzero, names --report-head, writes no plan.
- shadow-report-junit: complete true, format junit, raw bytes equal, known 93, attempted 92, leaf-000-p2 decoded name, leaf-000-p1 classname, leaf-001 retries 2 and passed, leaf-002 skipped.
- shadow-report-summary: known and attempted null, leaves [].

Budget: unmeasured. No budget was set or measured for the control or the shadow plan; timings.json records budget: unmeasured.

Not performed: this script has not been run. No check above has been observed to pass; the expected results are what the assertions state. Wall times are produced only when the script runs.

## Improved coverage

Instruction: Read src/affected.ts src/cli.ts journeys/affected-select.mjs. Preserve all existing checks and captures. Add one synthetic end-to-end scenario: base commit declares core owner, head commit removes that owner from affected.owners and changes src/core/value.mjs, Jest returns a nonempty core test file list. Drive affected main --shadow plan.json; assert complete false, fallback names removed head declaration or head tests without owners, and base-declared picks remain in the plan. Record the actual result in the journey log. No model or network in the generated journey.

Source: `journeys/affected-select.mjs`.

Existing checks preserved unchanged: import-chain, path-call, unknown-file, global-file, the before/control gate on the 92-leaf fixture, shadow-owned (92 picked, 91 extras), shadow-shared (93 selected), shadow-subprocess, shadow-rename-delete-glob, shadow-no-owner, shadow-no-runner, shadow-report-wrong-revision, shadow-report-junit and shadow-report-summary.

New scenario shadow-owner-removed-at-head (synthetic, committed clean, no model or network): the base commit declares the core owner (tests tests/core/**, inputs src/core/**). The head commit removes core from affected.owners (web only) and changes src/core/value.mjs. The fake Jest returns tests/core/leaf-000.test.mjs as a nonempty list. Driven with `done-done affected main --shadow <plan.json>`.

Assertions: plan.complete is false; plan.fallback contains a line naming "declarations removed at head" (core: src/core/value.mjs) or "head tests without owners"; the 92 base-declared rows (owner core, input src/core/value.mjs, reason "declared input src/core/**") remain, covering 92 distinct tests; leaf-000 keeps its "runner-reported file list" row; counts.selected is 92; unknown is [].

Journey log: affected-select.log gets a line "-> shadow-owner-removed-at-head (actual): complete ..., base-declared picks ..., selected ..., fallback ..." built from the plan the CLI actually wrote. Its step is also added to steps.json.

Not performed: this script has not been run and no assertion has been observed to pass. The expected results above are what the code in src/affected.ts (shadowPlan) predicts; the CLI's shadow wiring for head state was read from the source, not run.
