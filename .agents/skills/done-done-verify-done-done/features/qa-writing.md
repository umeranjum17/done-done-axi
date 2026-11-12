# QA writing

`done-done qa "<feature>" [<base>] --write` is stage `writing`: when the plan is a journey, it adds or extends one journey, and only when no journey covers the new command, flag or route. It runs the existing `done-done journey add "<feature>"` when no journey touches the change, `done-done journey enhance <name>` when a journey runs that code but never names the new surface, and writes nothing when a journey names it already or the plan is `no-test`. The result and `<evidence root>/.done-done/qa/<feature>.json` carry `stage: writing` and `write: {action: add|extend|none, journey, reason}`.

Source: `src/qa.ts` (`planWrite`), `src/cli.ts` (`writeQaJourney`, `cmdQa`), `dist/qa.js`, `dist/cli.js` and `journeys/qa-write.mjs`.

Drive: `done-done run qa-write` builds two throwaway repos with a verify skill and no journeys and a stub `claude` agent answering `journey add`, commits a new `tool export` command and a reformatted test fixture, and runs `done-done qa --write` on each, then again on the first after committing what it wrote.

Prove: qa-write.log shows the new command with `write: add tool-export`, one new `journeys/tool-export.mjs` and one config entry; the second run `write: none` (already covered) with no file or config change; the fixture refactor `plan: no-test`, `write: none` and a clean tree; steps.json lists the three steps.
