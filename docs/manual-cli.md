# Manual CLI

[Overview and quick start](../README.md) · [Full reference](reference.md)


**1. Install**

```sh
npm install -g --prefix ~/.local done-done-axi
```

`--prefix ~/.local` installs into your home folder, so it needs no `sudo`. This installs two names for the same CLI: `done-done-axi` and the short `done-done` used below. If `command -v done-done` prints nothing, add `~/.local/bin` to your `PATH`: `export PATH="$HOME/.local/bin:$PATH"`.

To skip the install, run `npx -y done-done-axi` wherever this README says `done-done`.

**2. Set it up in your app's repo**

```sh
cd your-app
done-done init
```

`init` writes a minimal `.done-done.yaml` (only if you don't already have one) that names your app, and a commented global `~/.done-done/config.yaml` (only if there is none). done-done never picks the coding agent it starts: `init` asks you in a terminal, or takes `--agent <agent> --model <model>`. It never picks the judge either, the agent of its own that `check`, `receipt`, `verify` and `design` always start to look at each capture: `init` asks in a terminal, or takes `--judge <agent> --judge-model <model>`. Any agent and model you choose runs, your coding agent's own too (the judge is a fresh session of its own). The config keys are in the [reference](reference.md#config). A plain `init` never overwrites an existing config. When your coding agent is set, `init` also has it write a verify skill, `.agents/skills/done-done-verify-<app>/SKILL.md`, from the repo's own files (never overwriting one; with no agent set, no skill is written; an older `verify-<app>` skill is renamed to this once). Check its launch never touches real accounts or your own state. Evidence lives outside the repo, in `~/.done-done/evidence/<app>`, so it outlives the checkout that captured it. For an `answerer:pi` judge with no explicit model, done-done uses `openai-codex/gpt-6-luna`; `judge.model` or `agent_config.pi.model` overrides it. Then describe how to capture proof — swap the command for whatever drives your real app the way a user does and saves its screenshots, recordings or output (here a CLI's own output):

```yaml
journeys:
  smoke:
    command: npm start > $DONE_DONE_EVIDENCE_ROOT/${RUN_ID}.log
    core: true
```

The command runs from the repo root with `DONE_DONE_EVIDENCE_ROOT` (a new folder for this run in the evidence root) and `DONE_DONE_RUN_ID` set, and `${RUN_ID}` in it is replaced. A run that writes nothing into its folder fails. A journey that only runs code checks (`npm test`, `yarn run check`, `tsc`, `pytest`, a linter or a build) is code-only: its log says the code checks pass, not that the product works, so `init --journey` refuses it and `check`, `receipt` and `gate` never count it as proof ([the rule](reference.md#real-product-evidence)).

Name your **core journey** with `core: true`: the one thing a user cannot live without, driven end to end on the real target (for a remote terminal app: pair, open a pane, type, see the output). If your app ships something users install and upgrade (an npm CLI, an Android app, a host service), also record an **upgrade journey** with `upgrade: true` that installs your previous release, upgrades over it in place, then drives the core journey: a fresh install alone is not how users get your release. `doctor` fails until both are named ([the rule](reference.md#core-journey-and-release-path)).

Optional: `done-done init --hook <claude|codex|opencode|gemini|pi>` adds a session hook or plugin to the repo that shows each session the bare `done-done` state. Each agent's file and behavior are in the [reference](reference.md#set-up-a-repo).

Record the recipe in the repo so anyone can re-run the proof, then commit it (and `.claude/settings.json`, `.codex/hooks.json`, `.gemini/settings.json`, `.opencode/plugins/done-done.js` or `.pi/extensions/done-done.js` if you added a hook):

```sh
done-done init --journey smoke --core -- 'npm start > $DONE_DONE_EVIDENCE_ROOT/${RUN_ID}.log'
git add .done-done.yaml
git commit -m "Add done-done"
```

A `run -- <command>` whose command matches no recorded journey still runs, but its result hints that the recipe is not in the repo. For a proof you drive by hand or by your agent instead of a journey, `done-done run --open` prints a run id and a folder to capture into, and `done-done run --close <run-id>` seals it ([how](reference.md#run-a-journey)).

At any point, `done-done doctor` checks the setup and changes nothing except the `--probe` call record. Each item reports `ok`, `warning` or `missing` with the exact fix command; an agent you have not set yet is `missing`, with the command that saves your choice, and so is a config whose journeys only run code checks, one that names no core journey, or an app that ships an installable artifact with no upgrade journey. `done-done doctor --probe` also asks the agent one question to prove it answers; on a new machine that probe fails until the agent is signed in (for pi, run `pi` and then `/login`). The quick start above never calls the coding agent, so `run` and `check` work before it is signed in; `check` does call the judge, so set one first. The items are listed in the [reference](reference.md#check-the-setup).

`done-done maintain` keeps the verify skill true: it checks the skill's links and feature index, checks that every `file:line` it cites exists, and has your coding agent read the source for each feature, read-only, to report drift. It ends `clean`, `drift` with the findings to fix, or `blocked`. It never runs without that reader: an agent that is not set asks, and one that cannot start or cannot read without tools stops it before the run (exit 2). With `auto_fix: { maintain: <n> }` (as in no-mistakes; 0, the default, reports only), your judge first sorts each drift finding (a skill out of date, or a product that may be wrong, which stops and asks you), then your agent fixes the skill folder only, in a done-done worktree, and maintain runs again, up to n times. A clean end is `changed`: one commit on a `done-done/maintain-<run-id>` branch, your branch untouched ([reference](reference.md#keep-the-verify-skill-true)).

**3. Run it, then check it**

```sh
done-done run smoke
done-done check --outcome "it starts" ~/.done-done/evidence/your-app/*/*.log
```

Each command prints one machine-readable result. By default it is [TOON](https://github.com/toon-format/spec) (the compact AXI convention). `run` shows `result: recorded`: it captured evidence, and says nothing about whether it proves the claim. `check` starts your judge on each capture, and only a check the judge passes shows `result: pass`; with no judge set it asks for one, and a judge that fails stops with the cause (exit 2), never a result. Add `--json` for JSON, or `--full` to list every evidence file or finding instead of the first few. After later runs, use the `run_id` the result prints in place of the first `*`.

When a check passes, save a receipt and re-verify it later:

```sh
done-done receipt --outcome "it starts" ~/.done-done/evidence/your-app/*/*.log
done-done receipt --verify "$(git rev-parse HEAD)"
```

No journey yet? `done-done verify --outcome "<what a user can now do>"` has your coding agent drive one feature of the verify skill the way a user does (`--feature <name>` picks it). Your judge then checks the captures. When it says a capture is wrong or unclear, or a capture it cannot read (a video or other file) is not judged, the run waits at its gate (exit 4) until you answer with `done-done respond --action fix`, which ends it `fail` so you fix the product or the recipe and run again: nothing moves a run past its judge, and no receipt is written without a judge pass. Until then, a new `verify` or `rerun` of the same claim in that checkout is refused, so nothing goes around the gate ([details](reference.md#drive-by-agent)).

With `auto_fix: { verify: <n> }` (0, the default, reports only), a failed verify is fixed with your own agent: your judge first sorts each wrong screen (a product bug to fix, or a question that waits at the gate for you), then your agent fixes the product in a done-done worktree with your ignored files copied in, and verify runs again there, up to n times. A pass ends `changed`, with the fix on a `done-done/verify-<run-id>` branch and your branch untouched ([details](reference.md#fix-the-product)).

While a `verify` or `maintain` run goes, `done-done status` shows its steps and next move, `done-done attach` streams its events, and `done-done logs --step <name>` shows one step's log. `done-done rerun` runs a failed verify run again from the failed step, `done-done abort` stops a live run, `done-done signoff` writes a verify run's sign-off message, and `done-done history` lists past runs.

Run `done-done` with no arguments to see the current config and the next step.
