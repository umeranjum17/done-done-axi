# Upgrade in place

Part of the done-done verification map. The release path users take: they already have a published done-done-axi and upgrade over it with `npm install -g done-done-axi@latest`; a fresh install alone does not prove that path.

## How to get to it (user POV)

`npm install -g done-done-axi` once, then `npm install -g done-done-axi@latest` when a release ships.

## Driving it

1. Run `done-done run upgrade` (or `node dist/cli.js run upgrade`) from this repo. `journeys/upgrade.mjs` installs the newest published version that is not this checkout's into a throwaway npm prefix, has that version run `init --journey home -- echo home` in a throwaway repo, packs this checkout and installs it over the old one in the same prefix, checks `done-done --version` moved to this checkout's version, the repo's `.done-done.yaml` is unchanged and the upgraded `doctor` reads it (`config ok`), then runs `journeys/e2e.mjs` (the core journey) with `DONE_DONE_TEST_CLI` set to the upgraded install.
2. Capture: the run folder gets `upgrade.log` (each install, the versions before and after, and doctor's rows after the upgrade) plus everything the e2e journey writes.
3. Needs npm and the npm registry. Use a private HOME, DONE_DONE_HOME and disk-backed TMPDIR.

## Gotchas

Before a release bump, the newest published version may be this checkout's own; the journey then upgrades from the one before it.
