# QA proof loop

`done-done qa "<feature>" [<base>] --prove [--max <n>]` is stage `sealed`: for a `journey` plan it runs the one journey that covers the change through the existing verify run (`done-done verify <journey> --outcome "<feature>" --fix-tries <n>`), so the drive, check, judge, fix loop and receipt are verify's own, with at most `n` fixes (`--max`, default 2). A pass seals a receipt for HEAD (`stage: sealed`, exit 0). A fix is committed on a `done-done/verify-<run-id>` branch, never the user's, so it ends `stage: fixed` (exit 1) until the branch is merged and the command runs again. A run still failing after `n` fixes ends `stage: fail` (exit 1). A `no-test` plan runs nothing. The result and `<evidence root>/.done-done/qa/<feature>.json` carry `prove: {journey, max, fixes, result, run_id, receipt, fix_branch, reason}`.

Source: `src/qa.ts` (`sealStage`), `src/cli.ts` (`proveQa`, `cmdQa`, `verify --fix-tries`), `dist/qa.js`, `dist/cli.js` and `journeys/qa-prove.mjs`.

Drive: `done-done run qa-prove` builds throwaway tool repos whose journey already covers a new `export` command, with a stub judge and a stub fixer agent, and runs `done-done qa "tool export command" main --prove --max 2` on a working change, on a broken change the fixer repairs (then merges the fix branch and runs again) and on a broken change the fixer cannot repair.

Prove: qa-prove.log shows the working change `stage: sealed` with `receipt --verify HEAD` passing and no fixer call; the repairable one `stage: fixed` on a done-done branch with HEAD unsealed, then `stage: sealed` after the merge; the unrepairable one `stage: fail` after 2 of 2 fixes (`stopped at 2 of 2 fixes`) with no receipt; steps.json lists the three runs.
