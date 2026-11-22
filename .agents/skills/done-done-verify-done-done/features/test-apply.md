# Applying a test plan

`done-done tests improve --plan-only --json` keeps possible duplicates and reports their combinations as `not provably lossless`. Applying a drop or demoting a check without a proven independent fast replacement is refused without writes. A move to a faster tier replays the recorded faults and refuses lost coverage, a broken check, a stale plan, or more than 300 changed lines. Gaps are filled through normal QA writing (`qa --write` or `journey add`).

Drive: `done-done run test-apply` copies the improve-test fixture into a throwaway git repo with a stub `claude` agent and a verify skill, saves the plan, refuses a forged drop and a demotion without replacement, moves local-check to ci, runs `journey add` for the untested isBig line, and plans again.

Prove: `test-apply.log` shows the unproven combination, two refusals with clean fixture state, an applied move naming local-check, and a last plan with no gaps and `is-big` keep. No screen: the proof is the run's text log.

Integration coverage: none yet in test/cli.test.mjs; the journey is the proof.
