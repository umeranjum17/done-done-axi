# Test value

`done-done tests value [<journey>] [--faults <n>] [--source <file>]` plants faults (one flipped operator on one source line) in scratch copies of the repo and runs every journey there. A test that fails on a fault catches it. Verdicts: `real` (catches a fault, and no faster test catches the same set), `slop` (catches none), `duplicate` (a faster or earlier-named test catches exactly the same faults; `duplicate_of` names it), `failing` (fails on the clean copy). Exit 1 when any test is not real. The work copy is only read and nothing is recorded as proof.

Drive: `done-done run test-value` copies the value-test fixture (a source file with two plantable faults; tests `real`, `slop` that asserts nothing, and `slow-duplicate` that repeats real's assertions after a 1.5s wait) into a throwaway git repo, hashes every file, runs the built CLI's `tests value --json`, hashes again.

Prove: `test-value.log` shows exit 1, two `faults`, `real` with `caught: 2`, `slop` with `caught: 0`, `slow-duplicate` as `duplicate` with `duplicate_of: real` and a larger `seconds`, and the line `work copy unchanged` after matching hashes. No screen: the proof is the run's text log.

Integration coverage: none yet in test/cli.test.mjs; the journey is the proof.


## Shadow hygiene observations

`done-done tests value [<journey>] --shadow [--faults <n>] [--source <file>]` runs each clean journey before mutation and reports observations without changing or recommending removal of tests. `affected.owners` connects journey scripts to their owned production input globs; the complete owned JS/TS modules are mutated with an installed StrykerJS command runner, with incremental mode disabled. Missing ownership, a missing runner, an incomplete report or a mapping beyond the fault budget is unknown. `--source` that names a module outside the test's ownership reports wrong target. A timeout, clean-red, killed mutant, survivor, and uncovered mutant are distinct. V8 line coverage and assertion sites are retained when available; unavailable coverage stays unknown. Identical caught-fault sets and forwarding or prose-like scripts are candidates for review, not removal.

Reviewed shell mutations are configured as `hygiene.shell_faults: [{file: bin/example.sh, was: 'original text', now: 'replacement text', review: 'review reference'}]`. The original text must occur exactly once. Each fault is applied only inside a disposable copy and replayed for owned journeys. An optional installed native runner is configured under `hygiene.adapters`, keyed by extension, with `command` and a fresh repo-relative `report` path. The command receives `DONE_DONE_HYGIENE_TEST` (the test command) and `DONE_DONE_HYGIENE_INPUTS` (JSON array of owned modules), and writes a mutation-testing-elements JSON report. Missing or invalid adapters remain unknown.

Drive: `done-done run test-value` with StrykerJS and mutmut available on PATH. The synthetic fixture holds production JS fixed and adds then removes a boundary assertion; it also runs a reviewed shell fault and a native mutmut adapter. Prove: `test-value.log` records the boundary mutant survivor → killed → survivor, uncovered mutants, a timeout, clean-red and wrong-target findings, two different failures through one wrapper, a passing prose contract with unknown ownership, native mutant results, unchanged JS and shell bytes, and the measured command durations. If a runner is absent, the journey records the corresponding result as not proven. Budget is unmeasured; zero dry runs are claimed.
