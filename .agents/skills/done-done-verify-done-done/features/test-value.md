# Test value

`done-done tests value [<journey>] [--faults <n>] [--source <file>]` plants faults (one flipped operator on one source line) in scratch copies of the repo and runs every journey there. A test that fails on a fault catches it. Verdicts: `real` (catches a fault, and no faster test catches the same set), `slop` (catches none), `duplicate` (a faster or earlier-named test catches exactly the same faults; `duplicate_of` names it), `failing` (fails on the clean copy). Exit 1 when any test is not real. The work copy is only read and nothing is recorded as proof.

Drive: `done-done run test-value` copies the value-test fixture (a source file with two plantable faults; tests `real`, `slop` that asserts nothing, and `slow-duplicate` that repeats real's assertions after a 1.5s wait) into a throwaway git repo, hashes every file, runs the built CLI's `tests value --json`, hashes again.

Prove: `test-value.log` shows exit 1, two `faults`, `real` with `caught: 2`, `slop` with `caught: 0`, `slow-duplicate` as `duplicate` with `duplicate_of: real` and a larger `seconds`, and the line `work copy unchanged` after matching hashes. No screen: the proof is the run's text log.

Integration coverage: none yet in test/cli.test.mjs; the journey is the proof.
