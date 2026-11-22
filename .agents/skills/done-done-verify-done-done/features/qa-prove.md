# QA proof loop, plus isolated shadowNewTests admission coverage through receipt

Request: Preserve all existing assertions. Add isolated synthetic end-to-end receipt coverage for src/newtests.ts shadowNewTests: with check.red_before_green enabled, discover added Node tests and declared shell tests; assert a base assertion failure and passing head are an assertion-failed candidate, missing symbol and unsupported runner are no-proof, and a vacuous test gets no-proof. Record actual receipt output and timings in evidence. Use only fixture repositories, no network or model calls in the journey. Leave existing behavior and existing assertions intact.

Source: `journeys/qa-prove.mjs`, `journeys/qa-prove.mjs`.

## Drive and capture

Run `done-done run qa-prove`. The committed script drives the app, checks the result and writes captures and steps.json into $DONE_DONE_EVIDENCE_ROOT.

## Checks

Existing checks preserved unchanged: the export journey's output and steps; qa --prove on a working change seals stage sealed with exit 0, zero fixes, a passing receipt for HEAD and no fixer call; a broken fixable change ends stage fixed on a done-done fix branch with HEAD unsealed, and after merging it seals; a stuck change stops at 2 of 2 fixes with stage fail, exit 1, two fixer calls and no sealed receipt. New, in an isolated synthetic fixture repo (no model, no network; stub judge only): with check.red_before_green on, receipt --new-test tests/shell.test.sh exits 0 and records an admission whose base and head match main and HEAD. Discovered rows are exactly tests/add.test.mjs (assertion-failed: fails on base with ERR_ASSERTION, passes at head), tests/sub.test.mjs (no-proof: missing symbol on base), tests/vacuous.test.mjs (no-proof: passes on base, no assertion failure) and tests/shell.test.sh (no-proof: unsupported runner). Totals: 1 assertion failure, 3 no-proof. Evidence records admission.json, the actual receipt output in receipt-red-before-green.json, the run and receipt wall times in timings.json (ms), and the qa-prove.log transcript.

## Improved coverage

Instruction: Fix the failed generated check only: the real receipt JSON field is admission_shadow, not admission. Keep all existing assertions and fixtures, and read the top-level admission_shadow field. Preserve every existing journey step and evidence capture.

Source: `journeys/qa-prove.mjs`.

Unchanged from the existing feature: the working change seals stage sealed with exit 0, zero fixes, a passing receipt for HEAD and no fixer call; the repairable broken change ends stage fixed on a done-done fix branch with HEAD unsealed, and seals after the merge; the stuck change stops at 2 of 2 fixes with stage fail, exit 1, two fixer calls and no sealed receipt; the export journey prints exactly 'exported'. Shadow admission (the one fix): the shadow receipt's top-level admission_shadow field is read (not admission) and must name the base and head commits, with rows exactly tests/add.test.mjs (assertion-failed, assertion failed on base), tests/sub.test.mjs (no-proof, missing symbol), tests/vacuous.test.mjs (no-proof) and tests/shell.test.sh (no-proof, unsupported runner); totals 1 assertion failure and 3 no-proof. Evidence: qa-prove.log, admission.json, receipt-red-before-green.json, timings.json (ms), steps.json. Failed checks throw and exit nonzero.
