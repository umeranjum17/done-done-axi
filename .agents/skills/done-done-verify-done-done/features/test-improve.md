# Test improvement plan

`done-done tests improve --plan-only [<journey>] [--faults <n>] [--source <file>]` values the journeys like `tests value` and proposes (stage `proposed`): `inventory`, one `rows` entry per test with `action` keep (real), drop (slop or duplicate), move (real, sized bigger than its measured time needs; `to` is the smaller size) or fix (failing), and `gaps`, the planted faults no test caught (`file`, `line`, `change`). It writes nothing and exits 0.

Drive: `done-done run test-improve` copies the improve-test fixture (math.mjs with add, isEven and an untested isBig; tests `real`, `slop`, `slow-duplicate` sized local and `local-check` sized local but fast) into a throwaway git repo, commits it, runs the built CLI's `tests improve --plan-only --json`, and checks `git status --porcelain` again.

Prove: `test-improve.log` shows `stage: proposed`, `real` keep, `slop` drop, `slow-duplicate` drop naming real, `local-check` move with `to: ci`, one gap at `src/math.mjs` line 3, and the line `git status --porcelain is empty after the plan`. No screen: the proof is the run's text log.

Integration coverage: none yet in test/cli.test.mjs; the journey is the proof.
