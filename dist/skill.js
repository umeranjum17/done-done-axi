// Generates skills/done-done/SKILL.md: a minimal skill that defers to the live CLI, so installed
// copies never restate commands or flags that can go stale.
//
//   npm run build:skill              # write the file
//   npm run build:skill -- --check   # exit 1 if the committed file differs from the generated one
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// The command an agent runs when done-done is not on PATH: the npm package.
const NPX = 'npx -y done-done-axi';
const DESCRIPTION = 'Prove the real app works before work is called done: done-done runs a capture of the real product, ties every screenshot, ' +
    'recording and log it writes to the exact commit, then checks that cited evidence is real, fresh and not reused. ' +
    'Use when the user asks to prove a change or app works, asks whether a task is really done, wants screenshots, ' +
    'recordings or logs captured as evidence, or wants a pull request gated on proof.';
const SKILL = `---
name: done-done
description: ${JSON.stringify(DESCRIPTION)}
license: Apache-2.0
argument-hint: "[what to prove, e.g. the app in this repo works]"
metadata:
  author: umeranjum17
  hermes:
    tags: [proof, evidence, verification, screenshots, ci, axi]
    category: devops
---

# done-done

"No proof, no done." done-done captures proof from the real product, ties every screenshot, recording
and log to the exact commit, and checks that cited proof is real, fresh and not reused. You run it for
the user; they only say what should be proven.

## Current guidance lives in the CLI

Do not follow command or config details from memory or from this file - installed copies go stale.
Get the current source of truth from the CLI.

First run \`command -v done-done\`. If it prints a path, run \`done-done\` as shown below. If not, run
\`${NPX}\` wherever this file or done-done output says \`done-done\` - nothing to install.

- \`done-done\` (no arguments, inside the repo) for this repo's proof setup and the next step
- \`done-done --help\` for every command and flag, the journey format and the exact \`## Checks\` block
- \`done-done <command> --help\` for one command's usage and flags

Results are TOON: read \`result\` and follow the \`help\` lines through
\`init\`, \`doctor\`, \`run\`, \`verify\`, \`check\` and \`receipt\`. \`design\` judges captured screens for visual defects,
\`maintain\` keeps the repo's verify skill true, and \`signoff\` writes a run's gate or evidence as a sign-off message
(it prints the post command and never posts; with \`--post\`, or \`signoff.post: true\` in .done-done.yaml, it posts that message to the
sign-off board and \`--wait\` brings the answer back to the run). Proof comes from driving the real product (the app, CLI or site the way a user does,
captured as screenshots, a recording or its transcript), never from a test, typecheck, lint or build run: \`init --journey\` refuses a journey
that only wraps one (\`npm test\`, \`yarn run check\`, \`tsc\`, \`pytest\`), and \`check\`, \`receipt\` and \`gate\` refuse proof from it. Proof counts only
from a committed tree: commit the done-done setup (config, capture script) before you capture. \`fail\` or
\`inconclusive\` is not done: fix the cause and re-run, or tell the user exactly what is still unproven.
Every app names its core journey (\`core: true\` on a journey, or \`init --journey <name> --core\`): the one thing a user cannot live without,
driven end to end on the real target (for a remote terminal: pair, open a pane, type, see the output); a proof of some other feature
does not show the app works. An app that ships something users install and upgrade (an npm CLI, an Android app, a host service) also
names an upgrade journey (\`--upgrade\`): install the previous release, upgrade over it in place, then drive the core journey; a fresh
install alone is not release proof. \`doctor\` fails until both are named.
To know which journeys a change needs, run \`done-done affected\` after you commit: it maps the diff through the verify skill's feature map
(the paths each feature cites, the journeys it names), adds the core journey when a changed file is in no feature or journey (never fewer),
and exits 1 until the receipt for HEAD has a run of each. Cite a file it flags in the feature file that drives it.
A run waiting at its judge gate (\`awaiting_approval\`) did not pass, and nothing moves it past its judge: show the user
its findings and captures, and end it with \`done-done respond --action fix\` only when they say so.
A journey that \`spends\` runs only after the user approves spending: \`done-done run <journey>\` refuses it, so ask the user and use \`verify\`.

For a web page, \`done-done look <url>\` is the look step a journey calls: it captures the page at a 390x844 phone viewport
with its page-check record and exits 1 on squashed, clipped or cut-off UI, naming each element. A hit fails the journey;
never wrap it in \`|| true\` or log the exit and go on. A claim that a phone UI works needs a 390 px capture of the real
page and the page's scroll-container count as proof: a mock, a different width or a claim with no count is not proof. A journey in \`.done-done.yaml\` that calls it:

\`\`\`yaml
journeys:
  inbox-look:
    command: done-done look http://127.0.0.1:3000/inbox --out "$DONE_DONE_EVIDENCE_ROOT/inbox.png"
\`\`\`

To gate a worker's claim cheaply, \`done-done lint <PR URL | report file> <evidence folder>\` reads the newest \`## Checks\` block
with no judge or model and prints \`PASS\` or \`FAIL: <reason>\` (exit 1 on a fail): missing lines, evidence that is absent,
empty, stale, duplicated or already used by another PR, a n/a repro on a fix, or a PR of 1,000+ added lines all fail.
\`evidence: not proven: <cause>\` passes. A PR URL whose diff changes \`src/\` and no \`journeys/\` file prints \`WARN: <reason>\` (exit 0):
run the journey, commit it, then open the PR, in that order. Fix the cause it names and re-run; never edit the evidence to get past it.

A CI job gets no model and no key, so it never runs \`check\`, \`run\` or \`verify\`. Proof runs on the desktop, then commit the
receipt it wrote (\`<evidence root>/.done-done/receipts/<head>.json\`) into \`.done-done-receipts/\` in a follow-up commit. CI runs only
\`done-done gate <head>\` (full history): \`PASS\` or \`FAIL: <reason>\` for a missing, late, other-head, moved-on or code-only receipt.

\`init\` also has that agent write the repo's \`.agents/skills/done-done-verify-<app>/SKILL.md\` (never overwriting one): read it before
you drive the app, and fix it when it is wrong.

done-done starts a coding agent the user chose. When it says no agent is set, ask the user which agent
(and model) to use and save their answer with the command it prints; never choose one for them.

done-done runs its own agent: \`done-done verify\` drives the journey, then a judge the user chose, in a
fresh session of its own, looks at each capture. \`check\` and \`receipt\` start the judge too,
and nothing turns it off: there is no result without it. When it says no judge is set, ask the user which
judge (and model) to use and save their answer with the command it prints; never choose one for them. When
the judge fails, report its error to the user; never call the work proven without a judge pass.

## Request

$ARGUMENTS

If the request above is non-empty, the user invoked \`/done-done\` explicitly - fetch the current CLI
guidance, then prove that. If it is empty, infer what to prove from the conversation.
`;
const target = fileURLToPath(new URL('../skills/done-done/SKILL.md', import.meta.url));
if (process.argv.includes('--check')) {
    let actual = '';
    try {
        actual = readFileSync(target, 'utf8');
    }
    catch { }
    if (actual !== SKILL) {
        console.error('skills/done-done/SKILL.md is out of date. Run `npm run build:skill` and commit the result.');
        process.exit(1);
    }
    console.log('skills/done-done/SKILL.md is up to date.');
}
else {
    writeFileSync(target, SKILL);
    console.log(`Wrote ${target}`);
}
