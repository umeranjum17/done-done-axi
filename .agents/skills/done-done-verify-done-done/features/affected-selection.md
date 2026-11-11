# Affected journey selection

`done-done affected` follows what a journey's command reaches, with no model: shell `source`/`.`, JS/TS imports and requires, and path calls (a quoted or slashed path naming a tracked file or folder), transitively. A changed file anywhere on that chain selects the journey, with the chain as the reason. An unknown file (in no feature or journey) or a file matching `affected.global_paths` selects the whole `local` tier, each journey with the reason; with no local tier the core journey runs as before.

Source: `src/deps.ts`, `src/affected.ts`, `src/cli.ts`, `src/config.ts`, `dist/deps.js`, `dist/affected.js`, `dist/cli.js` and `journeys/affected-select.mjs`.

Drive: `done-done run affected-select` builds four throwaway repos (a shell script sourcing a helper that runs a node tool importing a util and reading a fixture folder; two tier-`local` journeys) and runs `done-done affected main` after changing one file in each.

Prove: affected-select.log shows the util change selecting `app-check` with the chain `scripts/run.sh -> scripts/lib.sh -> tools/check.mjs -> tools/util.mjs`, the fixture change selecting it by path call, the unknown file selecting `local-a` and `local-b` with "whole local tier" and "in no feature or journey", and the global `package.json` selecting both with "a global file changed"; steps.json lists the four steps.
