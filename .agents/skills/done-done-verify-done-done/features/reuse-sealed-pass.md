# Reuse a sealed PASS

With `check.reuse_pass: true`, `done-done run <journey>` and `done-done verify <journey>` do not drive the journey again when HEAD's git tree, the journey name and its command text match a clean run that a well-formed PASS receipt cites and whose cited evidence still matches its hashes. The result is `reused` with `reused_from: <sealed run id>`, a run record carrying that id is written, and the exit is 0. A different tree, a different command, a dirty work tree, an edited capture, a run that did not exit 0, or the key off (absent in an existing config; `done-done init` writes it `true`) runs as before.

Drive: `node --test test/reuse-sealed-pass.test.mjs` builds a throwaway repo with a counting journey and a stub judge, seals a PASS with `run` and `receipt`, then repeats the run and the verify.

Prove: the counter file stays at one line after the repeat, the output says `reused` and names the sealed run id, and the same repeat after a changed file, a changed command, an uncommitted edit, an edited capture or the switch off adds a line. No screen: the proof is the counter and the run record.

Integration coverage: test/reuse-sealed-pass.test.mjs.
