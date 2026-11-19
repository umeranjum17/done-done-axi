# Skip is not proof

With `check.skip_is_not_proof: true`, `done-done run` and `done-done verify` run the journey's test command with `JG_TEST_SKIP_EXIT=77` set, and an exit 77 from a run (or from one matrix cell) is recorded as skipped, never as a pass. A run whose every cell skipped has the result `skipped` and the exit 77 on its record, so no receipt cites it; a run with a skipped cell and a passing cell keeps its receipt and lists the skip as `skipped`. A skip is not retried as a flaky failure. The key off or absent (`done-done init` does not write it) runs as before: no variable, and an exit 77 is a plain failure.

Drive: `node --test test/skip-not-proof.test.mjs` builds a throwaway repo with a stub test command that records its `JG_TEST_SKIP_EXIT`, writes a capture per matrix cell and exits 77 when told to, then runs and receipts it with the switch on, off and absent.

Prove: the recorded variable is `77` with the switch on and unset otherwise, an all-skipped run says `skipped` and `a skip is not proof` and the receipt is refused, a two-cell run with one skip keeps its receipt and names the skipped cell, and the switch off reports `exited 77` as a failure. No screen: the proof is the command's recorded env, the run result and the receipt exit.

Integration coverage: test/skip-not-proof.test.mjs.
