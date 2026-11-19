# Command preflight

`check.preflight: true` makes `done-done run`, `run --tier live` and `verify` read every command they would execute (journey, live check and suite command) before anything starts. The first word of each step must be a shell builtin, a path to an executable file, or found on PATH; env assignments and wrappers (`env`, `nohup`, `timeout`, `sh -c`) are read through. Otherwise the run is refused with `command not found: <word> in <journey>: nothing ran`, before any run record, judge or agent call. The key is off when absent from an existing config; each home turns it on in its own config.

Drive: `node --test test/command-preflight.test.mjs` builds throwaway repos with journeys such as `nosuchtool --x`, `cd x && node -e 0`, `./scripts/runnable.sh`, `./scripts/not-executable.sh`, `FOO=1 nosuchtool` and `sh -c '...'`, and drives the built CLI through `run`, `verify` and `run --tier live`.

Prove: the missing-word journeys exit non-zero with the word and journey named and no `run_id`; a judge stub that would write a marker file never ran; the builtin, plumbing, executable-script and wrapper journeys open a run; with the key `false` or absent the run starts and the shell prints its own `not found`. No screen: the proof is the CLI's text output.

Integration coverage: test/command-preflight.test.mjs.
