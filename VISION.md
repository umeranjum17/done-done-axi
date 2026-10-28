# Vision

done-done proves that the real product works before anyone calls a task done.

## Who it is for

- Developers who use coding agents.
- Any project: a web app, a phone app, a desktop app, a CLI or a site.
- A stranger on a clean machine. They install the tool, follow the README and get a useful result in under 5 minutes, with a plain agent setup and no other tool.

## The problem

- "Done" is easy to say. Tests can pass while the app is still broken.
- A green test run, a typecheck, a lint or a build is not the app.
- Screenshots get reused. Recordings go stale.

## The end state

- Anyone can run `init` in a project and use the same verification of work that we use: a verify skill for the app, kept true by `maintain`. That is the whole point of done-done.
- done-done is the verification layer for the real product, not for code checks.
- The proof drives the core user journey. A release proof runs the path users take: install over the previous version, then use the app.
- When new commits change part of a journey, the done-done agent runs that journey again or extends it, and collects the evidence.
- When a design is approved, its screen list is the build contract. A "design done" or release claim fails until every listed screen has a live capture.
- Existing projects move their own scripts to done-done once and keep no old copy. New projects start from the done-done base.

## The three tools

done-done is one of three tools. Each tool does one job well.

- **sign-off** is the main communication board between agents or projects and the user. It has a written contract for how projects communicate.
- **done-done** is the main verification tool.
- **learn-from-mistakes** is the main retro tool.

## Core principles

- **Each tool works alone.** The skill and the CLI work with or without the other two tools. They work with or without an agent supervisor.
- **Together, they connect well.** Small written contracts join them. No tool needs another tool to work.
- **Each tool owns primitives.** A primitive is a small building block that works for any project. When a project needs custom behaviour, that behaviour becomes a new primitive. It never becomes a fork.
- **The user sets everything.** Nothing runs automatically. done-done never picks an agent or a model. Users bring their own agents, models and accounts. The tools have zero hosted cost.
- **The judge is never optional.** A fresh judge checks each capture against the claim. With no judge pass, there is no result and no receipt. The user picks the judge, the coding agent's own too.
- **Any agent.** done-done works with the agents people already have signed in: Claude Code, Codex, opencode, Pi and Gemini CLI. It has no login of its own. It runs on cheap models.
- **The same tool patterns.** Each tool is an [AXI](https://axi.md) CLI. Output is [TOON](https://github.com/toon-format/spec) by default. Every result names the next command in its `help` lines. Agents install the skill with `npx skills`. The CLI ships on npm.
- **Agnostic.** The product names no person's details and no private project.

## Quality bar

- The best human-computer interaction on every surface: the CLI, the skill, the output, the README and the docs.
- The skills and the guards are rock solid.
- People install it and use it with good taste already built in.
- A change that makes the README, the skill or the screenshots stale updates them in the same PR.

## What it is not

- **Not a code checker.** Proof that only runs tests, typecheck, lint or a build is refused.
- **Not a CI step.** CI is build, tests and lint. CI never runs `check`, `run` or `verify` and never gets a model key. The no-model `gate` only checks a committed receipt.
- **Not automatic.** It does not pick an agent or a model, and it does not post to sign-off without the user's opt-in.
- **Not a hosted service.** It has no account, no login and no server of its own.
- **Not a fork per project.** Custom behaviour becomes a primitive for every project.

## done-done's role

done-done is the one verify system for all projects. It does not accept "done" without proof.

What ships now:

- **Proof per commit.** Each claim is proven at the exact commit. Each run keeps a run record.
- **The judge route the user picks.** Any agent and model the user chooses runs, the author's own too (a fresh session of its own); a Pi judge defaults to `openai-codex/gpt-6-luna` unless its model is configured.
- **A gate that asks the user.** When the judge says fail or unsure, the run stops and waits. The user answers with `respond`.
- **Sign-off messages.** `signoff` writes a run's gate or evidence in the sign-off contract v1 shape and prints the post command; it posts only with the opt-in (`--post`, or `signoff.post: true`), and done-done works without sign-off (see the [reference](docs/reference.md)).
- **Receipts.** A receipt records a passing check, the commit and the hash of each file. You can check it again later.
- **Maintain.** `maintain` keeps the verify skill in step with the code.
- **Fix loop.** `auto_fix.maintain` lets done-done fix verify skill drift, and `auto_fix.verify` lets it fix the product after a failed verify.
- **Core and upgrade journeys.** Each app names the one flow a user cannot live without. An app that ships an installable artifact also names the upgrade over its previous release.
- **Affected journeys.** `affected` maps a change to the journeys it needs and fails until the proof covers them.
- **Run-instance harness.** An `instance` block starts the app under test per run, on its own port, with its own HOME and XDG folders, and stops it at the end.
- **Capture matrix.** One verify run captures every theme x width x form cell the repo asks for; each cell is captured or skipped with a reason.
- **DOM assertions.** With a `dom` block, each captured screen's page-check record must be clean: no horizontal overflow, squashed, clipped or cut-off UI, or console error or failed request that an allow list does not name.
- **Base-ref before.** With `base_ref`, `verify` drives the base ref too and judges each head capture together with its base capture.
- **Text evidence.** The judge reads text captures (logs, JSON, CLI output) as well as screens; see the [reference](docs/reference.md).
- **Approved-design coverage.** With an `approved_design` list, every claim fails until each approved screen has a live capture that the judge matches to its mock (on npm from 0.6.6).

## Next milestones

Each milestone ships as a version-bump release on [npm](https://www.npmjs.com/package/done-done-axi?activeTab=versions).

1. **0.6.6: a working first run.** The release puts on npm what is already on main: `init` writes the verify skill for an app that has no earlier release yet, one judge call per check, and approved-design coverage.
2. **Three agents, live.** `init`, `doctor --probe` and one judged run pass on Claude Code, Codex and opencode.
3. **Proof that follows the commits.** After a commit, done-done runs the journeys that `affected` names and proposes the missing journey for the verify skill.

## Works with

- **sign-off.** sign-off owns the communication contract: the schema doc and the validator. When sign-off is present, done-done consumes them and sends asks, reports and evidence through the contract. Without sign-off, done-done works alone.
- **learn-from-mistakes.** It reads failed and waiting runs.

### The communication contract

These four rules keep every report and evidence card the same on the board, so the user does less work.

1. **One strict, versioned schema per message kind.** The kinds that cross tools are ask, report, evidence, gate or approval, and retro finding. sign-off owns the contract doc and a validator. A post that does not match is refused with a clear fix message. It is never shown half-broken.
2. **Every producer emits exactly that shape.** done-done evidence and gates, learn-from-mistakes reports and findings, and any project all use the same shape.
3. **Shared conformance tests.** Each kind has a fixture. Each tool's CI runs the fixtures against the validator.
4. **Each skill teaches the exact command and shape.** It gives one worked example, so agents use the tool right the first time.

