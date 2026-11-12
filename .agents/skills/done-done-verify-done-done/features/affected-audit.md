# Affected selection audit

`done-done affected --audit <range>` checks how often the feature map selected a journey that later failed. For each commit in the range that has a receipt, a failed run of a journey that receipt never ran is a failure. It is caught when `affected` selects that journey for the commit's diff and missed when it does not. Each missed commit's changed files are written to the feature file that names the journey (`run <journey>`), unless it already cites them, and recall (caught over failures) is printed.

Source: `src/audit.ts`, `src/cli.ts`, `dist/audit.js`, `dist/cli.js` and `journeys/affected-audit.mjs`.

Drive: `done-done run affected-audit` builds a throwaway repo whose commit breaks `app-check` through a computed path no static chain reaches, while the feature map sends that file to `other-check` only. It runs both journeys at the commit, records a receipt holding `other-check`, then runs `done-done affected --audit main..HEAD`, commits the map change and runs `done-done affected main` again.

Prove: affected-audit.log shows `affected main` selecting only `other-check`, the audit reporting one failure, none caught, `app-check` missed with `tools/shared.mjs` and recall `0/1 (0%)`, the next `affected main` selecting `app-check` and `other-check`, and a second audit adding nothing; steps.json lists the four steps.
