# QA planning

`done-done qa "<feature>" [<base>]` reads the diff and decides whether changed user-visible behaviour needs a journey: `plan: journey` for a new command, flag, route or screen, `plan: no-test` (with the reason) for fixture refactors, tests, docs and internal changes. It records `stage: planned` and the reason to `<evidence root>/.done-done/qa/<feature>.json`.

Source: `src/qa.ts`, `src/cli.ts`, `dist/qa.js`, `dist/cli.js` and `journeys/qa-plan.mjs`.

Drive: `done-done run qa-plan` builds three throwaway repos, commits a new `tool export` command, a reformatted test fixture and a renamed internal helper, and runs `done-done qa` on each.

Prove: qa-plan.log shows the new command planned as `journey` naming `smoke`, the fixture refactor and the internal change planned as `no-test`, and each result with `stage: planned` and its reason matching the recorded file; steps.json lists the three steps.
