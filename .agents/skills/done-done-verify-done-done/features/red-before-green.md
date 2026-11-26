# Red before green

With `check.red_before_green: true`, `done-done receipt --new-test <test file>` (repeatable) takes each test a change declares as new behaviour, runs it at HEAD, then on the base commit (`base_ref`, else the merge base with the default branch, else HEAD's parent) in a scratch worktree with the file copied in from HEAD, and refuses the receipt when it passes there. Exit 77 on either side is skipped, never a pass. The receipt records `new_tests: [{file, base: red, head: green}]`. No `--new-test` means exempt; with the switch off the flag is ignored with one warning line. Runners: `.mjs`/`.js` `node --test`, `.sh` `bash`, `.py` `python3 -m pytest -q`, anything else `check.test_run` (`{file}` is the path) or a refusal `no runner for <file>`.

Drive: `node --test test/red-before-green.test.mjs` builds throwaway git repos with a base commit and a head commit that adds the tests, then drives the built CLI through `receipt --outcome <claim> --new-test <file> <captures>`.

Prove: a test that already passes on the base exits 1 with `already passes on the base` and writes no receipt (`receipt --verify HEAD` fails); a test that fails on the base and passes at head exits 0 with `new_tests` base `red`; an exit-77 test, a head failure and an unknown extension each exit 1; no flag leaves the receipt unchanged; the switch off warns once. No screen: the proof is the CLI's text output.

Integration coverage: test/red-before-green.test.mjs (6 cases).

Shadow observation: when `check.red_before_green` is enabled, receipts also discover added tests in the base-to-head diff and report `admission_shadow` for them and declared tests. A Node assertion failure on the base and a passing head are an `assertion-failed` candidate only: the intended assertion and independent oracle have not been established. Other runners, setup failures, skipped tests and unrecognized results are `no-proof`; counts are separate. This advisory does not alter the existing receipt gate. Independent oracle validation and held-out fault scoring are not implemented.
