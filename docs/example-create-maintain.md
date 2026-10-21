# Worked example: create and maintain a verify skill

done-done on a tiny public sample, **Pocket Notes**: a zero-dependency Node web app where you type a note, press a button and see it in a list. It walks the whole loop with a real coding agent and a real judge: `init` writes a verify skill, a source change makes the skill drift, `maintain` finds and fixes it, a real browser journey captures the screen, and the judge passes it. Nothing is stubbed and no image is copied in.

You need Node 22.18+, git, Chrome or Chromium, and a coding agent and judge you are signed in to (any pair `done-done init --help` lists). Replace the `--agent`/`--model` and `--judge`/`--judge-model` values with yours; a free or cheap model is fine. A throwaway `DONE_DONE_HOME` keeps this off your own config and evidence.

**1. Install the built package and make the sample.**

```sh
d=$(mktemp -d) && cd "$d"
npm pack done-done-axi && npm install -g --prefix "$d/prefix" ./done-done-axi-*.tgz   # or: npm install -g done-done-axi
export PATH="$d/prefix/bin:$PATH" DONE_DONE_HOME="$d/home"
cp -r "$d/prefix/lib/node_modules/done-done-axi/docs/examples/pocket-notes" . && cd pocket-notes
git init -q -b main && npm install && git add -A && git commit -qm "Pocket Notes"
```

The sample is in the package under `docs/examples/pocket-notes/` (also in this repo): `server.mjs` (an HTTP server: `GET`/`POST /api/notes`, `GET /health`, the page at `/`, port from `PORT`, data folder from `NOTES_DATA`), `public/index.html` (a heading, a `Write a note` field, an `Add note` button and the list) and the journey script of step 5. Any small web app works the same way. Add a `.gitignore` with `node_modules` and `notes.json` before the commit.

**2. `init` has your agent write the skill.**

```sh
done-done init --agent <agent> --model <model> --judge <judge> --judge-model <model>
```

It writes `.done-done.yaml` and `.agents/skills/done-done-verify-pocket-notes/` (`SKILL.md` plus one file per feature, one marked the core journey). Read it: the launch should use a temp `NOTES_DATA` and its own port, and each feature should name its source (`public/index.html`). Commit it. `done-done doctor` should pass.

**3. Change the source; the skill is now stale.** Rename the button to `Save note`, the placeholder to `Type a note` and the health route to `/healthz`, and commit:

```sh
sed -i 's#/health#/healthz#' server.mjs
sed -i 's#Write a note#Type a note#; s#>Add note<#>Save note<#' public/index.html
git commit -qam "Rename Add to Save, health to /healthz"
```

**4. `maintain` finds the drift, then fixes the skill.**

```sh
done-done maintain --foreground          # result: drift, with each finding
printf 'auto_fix:\n  maintain: 2\n' >> .done-done.yaml && git commit -qam "Allow maintain fixes"
done-done maintain --foreground          # result: changed, a commit on done-done/maintain-<run-id>
git merge --ff-only done-done/maintain-<run-id>
done-done maintain --foreground          # result: clean
```

The first run reports that the feature file says `Write a note` and `Add note` and `SKILL.md` says `/health`, each with the source line. The fix commit touches only the skill folder; your branch is untouched until you merge it. (Before 0.6.3 a tool-less reader was given no source when a feature file named it without a line number, so this step ended `clean` without reading anything.)

**5. A real journey.** `init --journey` records it (the command drives the product; a test run would be refused):

```yaml
instance:
  command: PORT=$DONE_DONE_PORT NOTES_DATA=$TMPDIR node server.mjs
  ready: { url: http://127.0.0.1:$DONE_DONE_PORT/healthz }
journeys:
  add-note:
    command: node scripts/prove-core.mjs
    core: true
```

`scripts/prove-core.mjs` (already in the sample; `npm install` fetched `playwright-core`) opens `$DONE_DONE_BASE_URL` in headless Chrome at 390x844 with `playwright-core` (`executablePath` from `DONE_DONE_CHROME`, else `/usr/bin/chromium`), fills `Type a note` with `milk`, clicks `Save note`, waits for `milk` in the list and saves `$DONE_DONE_EVIDENCE_ROOT/note-listed.png`.

**6. Run, check, receipt.** Commit first, then:

```sh
done-done run add-note
done-done check --outcome "a user can type a note, press Save note, and see it in the list" <the png the run printed>
done-done receipt --outcome "<same claim>" <same png>
```

The judge looks at the screenshot (`result: pass`, exit 0). Open the picture yourself too.

What it shows:

- Keep each outcome to what one capture shows; a claim with several parts comes back `inconclusive`.
- The agent's skill is a draft: read it, and let `maintain` keep it true as the source moves.
- A model free-tier or weekly limit ends a call with the provider's own message and reset time (exit 2), never a result.
