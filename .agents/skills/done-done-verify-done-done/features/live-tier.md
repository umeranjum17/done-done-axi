# Live tier

`tier: live` on a journey entry (with a `timeout`) makes it a live check: `done-done run --tier live [<name>]` runs only those entries, one after another, each killed at its own timeout, with no agent or judge, and prints one row each (name, green or red, seconds). A red row exits 1 and is a result, not a failed landing. A live entry never reaches `verify`, `affected`, `after-commit`, `qa`, `tests` or the landing path: the config load keeps it out of `journeys`.

Drive: `done-done run live-tier` copies the live-test fixture (a green, a red and an over-timeout live entry, a tier local journey and an untiered one) into a throwaway repo and drives the built CLI through `run --tier live`, `run --tier live <name>`, `run <live name>`, `verify <live name>` and `affected` after a change to a live probe.

Prove: `live-tier.log` shows three rows (green, red `exit 3: the lock is older than its lease`, red `timed out after 1s`) with `bound_seconds: 21` and a run of about a second, exit 1; a single green entry exits 0; the tier local and untiered journeys did not run (no marker file, no evidence folder); `run lock-fresh` and `verify lock-fresh` exit 2; `affected HEAD~1` selects only the local-tier journey. No screen: the proof is the run's text log.

Integration coverage: none in test/cli.test.mjs; the journey is the proof.
