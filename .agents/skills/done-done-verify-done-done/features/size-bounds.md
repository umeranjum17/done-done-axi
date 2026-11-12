# Test size bounds and measurement

`size:` on a journey is its time bound: `ci` 15s, `local` 300s, `large` 900s. `done-done run` stops a journey past its bound and fails it as slow; a `large` journey needs `reason:` and is night-only (`--night`); `done-done lint` fails a journey with no size (once any journey has one) and a large one with no reason; `done-done tests measure [<journey>]` runs each sized journey five times and reports five timings per test.

Drive: `done-done run size-bounds` copies the size-test fixture (a ci journey that sleeps 60s, a large journey with no reason, a quick ci journey) into a throwaway repo and drives the built CLI through run, lint and `tests measure`.

Prove: `size-bounds.log` shows `run over-bound` exit 1 with `slow: true` and `is slow: it ran past its ci bound of 15s and was stopped`, `FAIL: test sizes: journey large-no-reason is large and has no reason`, `run large-no-reason` refused without `--night` (exit 2), `tests measure quick` with five `runs` all `ok`, and `PASS` once the large journey has a reason. No screen: the proof is the run's text log.

Integration coverage: none yet in test/cli.test.mjs; the journey is the proof.
