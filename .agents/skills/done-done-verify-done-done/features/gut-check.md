# Gut check

With `check.gut_check: true` (off when the key is absent; `done-done init` does not write it), `done-done receipt --new-test <test file>` (repeatable) finds the one project source file the test imports, requires or runs by path (not `node_modules`, not a test file, not a fixture), replaces it with a stub that does nothing in a scratch checkout of HEAD, runs the test there and refuses the receipt when the test still passes. The work tree is never written. Stubs: `.js`/`.mjs`/`.ts` export nothing, `.cjs` an empty `module.exports`, `.sh` `exit 0`, `.py` `pass`. Zero or two or more targets refuse with `gut check needs exactly one target`; exit 77 with the target stubbed is skipped, never a catch. The receipt's `new_tests` rows gain `gut: caught`; a refusal names the test and the target and carries `gut: passed` or `no single target`. It runs beside `check.red_before_green`, and each switch is independent.

Drive: `node --test test/gut-check.test.mjs` builds throwaway git repos from `test/fixtures/gut-check/`, then drives the built CLI through `receipt --outcome <claim> --new-test <file> <captures>`.

Prove: a test that only asserts its target exists exits 1 naming the test and the target and writes no receipt; a behaviour test exits 0 with `gut: caught`; a test with no target or two exits 1 with `gut check needs exactly one target`; a test that exits 77 under the stub exits 1 as skipped; the target is byte-identical and the work tree clean after every run, including one that throws; with the key absent nothing is gutted. No screen: the proof is the CLI's text output.

Integration coverage: test/gut-check.test.mjs (8 cases).
