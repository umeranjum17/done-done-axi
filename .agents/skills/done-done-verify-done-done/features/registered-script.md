# Registered test-script updates

`journey enhance <name>` and `journey improve <name> "<instruction>"` accept a journey whose command runs a registered test script (`node test/export.test.mjs`, `node --test test/x.test.mjs`): the script is rewritten in place, the journey's command is kept, no second `journeys/<name>.mjs` is written, and the script's hash in `.done-done-inventory.json` is updated, so `done-done lint` passes. A script missing from the inventory is refused with the `inventory record` command to run. The output begins `Stage writing: <file>` and so names the file written. Source: `src/inventory.ts` (`entryScript`), `src/cli.ts` (`cmdJourney`).

Drive: `done-done run registered-script` builds a throwaway repo whose journey runs `node test/export.test.mjs`, answers `journey improve` with a stub agent (no model, no spend) and runs `done-done lint`.

Prove: `registered-script.log` shows `journey improve tool-run` exit 0 with `Stage writing: test/export.test.mjs` and `test/export.test.mjs | 1 +` in the diff, then `done-done lint` printing `PASS`. No screen: the proof is the run's text log.

Integration coverage: none yet in test/cli.test.mjs; the journey is the proof.
