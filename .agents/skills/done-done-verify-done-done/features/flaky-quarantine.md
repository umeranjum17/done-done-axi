# Flaky quarantine

A journey that fails once and passes on its second run is quarantined: `done-done run` names it in `flaky`, prints one `warning:` line, and the run still passes.

Drive: `done-done run flaky-quarantine` runs the flaky-test fixture (a journey that fails first, passes second) in a throwaway repo and reads the run's `--json` result.

Prove: flaky-quarantine.log shows exit 0, `result: recorded`, `flaky: ["flaky-check"]` and exactly one warning line; steps.json records the flow. A journey that fails both runs still fails the run.

Integration coverage: none yet in test/cli.test.mjs; the journey is the proof.
