# Test size bounds and measurement

`size:` on a journey is its time bound: `ci` 15s, `local` 300s, `large` 900s. `done-done run` stops a journey past its bound and fails it as slow; a `large` journey needs `reason:` and is night-only (`--night`); `done-done lint` fails a journey with no size (once any journey has one) and a large one with no reason; `done-done tests measure [<journey>]` runs each sized journey five times and reports five timings per test.

Drive: `done-done run size-bounds` copies the size-test fixture (a ci journey that sleeps 60s, a large journey with no reason, a quick ci journey) into a throwaway repo and drives the built CLI through run, lint and `tests measure`.

Prove: `size-bounds.log` shows `run over-bound` exit 1 with `slow: true` and `is slow: it ran past its ci bound of 15s and was stopped`, `FAIL: test sizes: journey large-no-reason is large and has no reason`, `run large-no-reason` refused without `--night` (exit 2), `tests measure quick` with five `runs` all `ok`, and `PASS` once the large journey has a reason. No screen: the proof is the run's text log.

Integration coverage: none yet in test/cli.test.mjs; the journey is the proof.

Shadow batch pilot: set `DONE_DONE_SHADOW_TIMING` to a writable JSONL path, then run `done-done tests shadow <journey...> --json`. This drives the named journeys together without imposing a time limit or writing proof. Set `DONE_DONE_SHADOW_EVIDENCE` to an existing directory to retain each child’s output files. The journal records admissions, execution starts, retry events and exits with a monotonic batch duration; queue origin is null when unavailable. It also records provider attempts and cache hits without prompts or credentials. A slow or failed batch is a shadow observation, not a fast-gate pass.


The same journey drives five synthetic shadow children and checks their offsets against batch wall time, null queue origins, successful and failed retries, and an interrupted batch with an unfinished leaf. It drives a local CLI judge through failure, success and cache hit, plus a direct key route with a local failing fetch; it checks one failed CLI attempt, null missing usage, and that no prompt or credential enters the journal. Evidence: `size-bounds.log`, `size-shadow.jsonl`, `size-direct.jsonl`, and `size-interrupt.jsonl`.
