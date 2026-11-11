# Applying a test plan

`done-done tests improve --apply <drop|move> --plan <plan.json>` applies one verdict class of a saved `tests improve --plan-only --json` plan. It first reruns the kept tests, at their new sizes, against the faults the plan recorded; a fault the plan said was caught that no kept test catches refuses the plan (`stage: refused`, exit 1, nothing written). Otherwise (`stage: applied`) `drop` removes the journeys from `.done-done.yaml`, deletes scripts no kept journey runs and forgets their inventory entries, `move` sets the smaller size. The answer has `tests`, `lines` (at most 300), `kept` and `seconds.before` / `seconds.after`. Gaps are filled through normal QA writing (`qa --write` or `journey add`).

Drive: `done-done run test-apply` copies the improve-test fixture into a throwaway git repo with a stub `claude` agent and a verify skill, saves the plan, applies a copy of it that also drops `real` (refused), applies drop (slop and slow-duplicate), then move (local-check to ci) from a fresh plan, runs `journey add` for the untested isBig line, and plans again.

Prove: `test-apply.log` shows `stage: refused` with `coverage lost`, the line `git status --porcelain is empty after the refused plan`, `stage: applied` for drop naming slop and slow-duplicate with `seconds.after` below `seconds.before`, `stage: applied` for move naming local-check, and a last plan with no gaps and `is-big` keep. No screen: the proof is the run's text log.

Integration coverage: none yet in test/cli.test.mjs; the journey is the proof.
