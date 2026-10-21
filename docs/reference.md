# done-done reference

Everything `init`, `doctor`, `run`, `affected`, `check`, `receipt` and the config files do. For the overview and quick start, see the [README](../README.md).

## Install

For the install steps, see the [README](../README.md#use-it-from-your-agent). done-done needs Node 22.18 or later and git. `ffprobe` is optional. Without it, videos are reported as "not verified" and the check is inconclusive, never a pass.

## Use

### Set up a repo

```sh
done-done init
```

`init` writes a minimal `.done-done.yaml` only when one does not exist: just `app`, the repo directory name, so every checkout of the repo finds the same evidence (see [Where proof lives](#where-proof-lives)). It sets no `evidence.root`, so evidence goes outside the repo. When an existing config puts `evidence.root` inside the repo (an older `root: .proof`), `init` adds it to `.gitignore` when git does not already ignore it. A plain `init` never rewrites the config: re-running is a no-op and a customized `.done-done.yaml` is left byte-for-byte; `.gitignore` gains a line only when the ignore entry is missing. A malformed `.done-done.yaml` makes `init` exit 2 with the file named and untouched. Its result says whether the config was `written` or left `unchanged`, the evidence root, what it added to `.gitignore`, the verify skill outcome (`verify_skill`), and the next step.

`init` also has the agent the user set write the verify skill at `skill` (default `.agents/skills/done-done-verify-<app>`) from the repo's own files: plain code gives it the tracked file list and the text of the files that show how the repo proves itself (manifests, `.done-done.yaml` journeys, verify, e2e, smoke and demo scripts, `bin/` files, Dockerfiles, then source files (including Vue, Svelte, HTML, CSS and common compiled-language sources); JSON, YAML and Markdown are excluded except for manifests; at most 150,000 characters, and the prompt names what it left out; a `.env` or `.env.*` file, a file or folder whose path contains `secret`, `credential`, `token` or `password`, and `*.pem`, `*.key`, `*.p12` files never have their text sent by `init`, the agent is told not to open them, and no launch or feature can cite them; the tracked file list still names them), and one read-only call answers with the launch, readiness check, harness, evidence and up to five features (claude reads the repo with its read tools; every other agent gets only that text, and codex and gemini cannot run it tool-less). Launch prefers the repo's own safe proof path, a stub or demo engine with its own state, and when the repo shows none, `SKILL.md` opens Launch with `Not isolated:` and what the launch would touch, and `verify_skill` says so. `Safe:` is written only when the model marks the launch safe and its source is a tracked file that is not a manifest such as `package.json` or `README.md`; any other launch is `Not isolated:`, and its steps are not parsed. Each feature names the repo file it comes from. The prompt says a test suite, typecheck, lint or build is never a launch, a drive or the proof, asks for exactly one feature marked `core` (the core user journey) and, when a tracked file shows the app ships an installable artifact, one marked `upgrade` (see [Core journey and release path](#core-journey-and-release-path)), and plain code refuses an answer with no core feature, more than one, or no upgrade feature for such an app; `SKILL.md` gains a `Core journey` section (and a `Release proof` section for such an app) and `features/README.md` marks those entries `(core journey)` and `(upgrade journey)`. The prompt also says and plain code refuses an answer whose launch steps or a feature's drive is code-only ([Real-product evidence](#real-product-evidence)), as it refuses an answer that cites a file the repo does not track, a secret-looking file, or, for a tool-less agent, a tracked file whose text its prompt left out. It writes `SKILL.md`, plus `features/README.md` and one file per feature with numbered drive and capture steps; `features/README.md` says how many more were found and not written. With no agent set, no skill is written and `init` asks for the agent (exit 2); an agent that fails or answers with an uncited or missing field writes no skill, and `verify_skill` names the cause and the call record (exit 1). On a repo with nothing tracked yet (a fresh `git init`), no skill is written and no agent is asked — no answer could cite a tracked file — and `verify_skill` names the remedy: commit the repo's files, then re-run (exit 1). The write is all-or-nothing: when any target already exists — `SKILL.md`, `features/README.md` or a `features/<name>.md`, as a file or a directory — nothing is written and `verify_skill` says `skipped: <paths> already exist; delete the skill folder to regenerate`, so a re-run after a lost `SKILL.md` can never pair new answers with the old feature map; a finished skill is left byte-identical and a re-run asks the agent nothing. A symlink on the path skips the scaffold and reports why in `verify_skill`, with exit 0. Otherwise the files are written into a temporary directory inside the skill's parent and moved into place, so a failed write leaves no partial skill: the temporary directory and any moved file are removed, `init` exits 1, and `verify_skill` names the error and says to re-run `init`. The config is kept either way. A `skill` path with a `..` segment is refused (exit 2) before anything is written. A repo whose older `init` wrote `.agents/skills/verify-<app>` (and sets no `skill`) keeps working: every command reads that folder, and the next `init` moves it once to `.agents/skills/done-done-verify-<app>` (also updating the `name:` line in its `SKILL.md`) and reports `skill_renamed: <old> -> <new>`; when the prefixed folder already exists, the old one is left alone. Commit `.done-done.yaml` and the verify skill before the first capture: a capture from a tree with uncommitted changes fails `check`, and `init` says so in its help.

```sh
done-done init --agent opencode --model opencode-go/muse-spark-1.3-contributor
```

`init --agent <agent> [--model <model>]` saves the coding agent done-done starts, and its model, into the global `~/.done-done/config.yaml` (`agent` and `agent_config.<agent>.model`), in place, keeping its comments and every other key; the result's `agent` says what was saved. Without `--agent`, when no agent is set, `init` asks in a terminal (a numbered list of agents, then of models; a wrong answer is named before the list asks again, and a typed opencode model must be one `opencode models` lists, or, when opencode is not on PATH, it is saved with a notice that it was not checked; any other agent's model, pi's included, is saved with that notice too) before it writes anything; elsewhere it writes the rest of the config, reports `agent: not set` with the line to ask the user and the save command, and exits 2. When a repo's `.done-done.yaml` sets a different agent, the result's `agent` says the saved agent is overridden by that one. An agent done-done cannot start, `--model` without `--agent`, or an opencode model that is not `provider/model` exits 2 before any write. done-done never picks an agent for you (see [Agents](#agents)). Headless `opencode run` needs `--auto` (or allows the evidence root, `~/.done-done`, in opencode's `external_directory` permission) for done-done to run.

Record a journey's capture recipe in the repo so any checkout can re-run the proof:

```sh
done-done init --journey smoke -- 'echo added: milk > $DONE_DONE_EVIDENCE_ROOT/${RUN_ID}.log'
```

`init --journey <name> -- <command>` writes `journeys.<name>.command` into `.done-done.yaml` (creating the file with the pinned `app` when missing) and reports `written` or `updated` with the journey name. `${RUN_ID}` in the command becomes the run id, exactly as in `run`. The recipe is committed, so an absolute path inside the repo is refused (exit 2, nothing written) with the relative form to use; name the path relative to the repo, or use a placeholder such as `${B:?}` that the caller sets. A code-only command (one that only runs tests, typecheck, lint or a build, see [Real-product evidence](#real-product-evidence)) is refused the same way, before anything is written, with the shape of a command to record instead. `--core` also writes `core: true` (the core user journey) and `--upgrade` writes `upgrade: true` (the release path), see [Core journey and release path](#core-journey-and-release-path); either flag without `--journey` is a usage error. `init`'s help names the `--core` and `--upgrade` commands while the repo still needs them. Commit the config: proof only counts from a clean tree.

```sh
done-done init --hook claude
```

`--hook claude` also adds a Claude Code SessionStart hook to the repo's `.claude/settings.json` (project scope; your `~/.claude` is never touched), so each session starts with the bare `done-done` state as context. The hook runs `command -v done-done >/dev/null && done-done || true`: without done-done on PATH it prints nothing and exits 0, so it never breaks a session. An existing settings file keeps every other key and hook; re-running adds no duplicate. The result's `claude_hook` says `added to .claude/settings.json` or `unchanged`. Any other `--hook` value exits 2 naming the supported values, and a malformed `.claude/settings.json` exits 2 untouched. Commit `.claude/settings.json` to share the hook.

```sh
done-done init --hook codex
```

`--hook codex` also adds a Codex SessionStart hook to the repo's `.codex/hooks.json` (project scope; your `~/.codex` is never touched), so each session starts with the bare `done-done` state as context. Same contract as the Claude hook: it runs `command -v done-done >/dev/null && done-done || true`, keeps every other key and hook, adds no duplicate on re-run, and the result's `codex_hook` says `added to .codex/hooks.json` or `unchanged`. A malformed `.codex/hooks.json` exits 2 untouched. Commit `.codex/hooks.json` to share the hook.

```sh
done-done init --hook opencode
```

`--hook opencode` instead writes a session-start plugin to the repo's `.opencode/plugins/done-done.js` (project scope; your `~/.config/opencode` is never touched), so the bare `done-done` state is added to the first message of each session, not at session open (opencode's plugin hooks cannot add context when a session is created). The plugin remembers sessions in memory, so a resumed session gets the state again after opencode restarts. That `chat.message` hook runs `command -v done-done >/dev/null && done-done || true` and waits for it (up to 30 seconds) before appending the output to the message: without done-done on PATH it appends nothing and never throws, so it never breaks a session. Other files in `.opencode/plugins/` are untouched; re-running adds no duplicate. The result's `opencode_plugin` says `added to .opencode/plugins/done-done.js` or `unchanged`. Delete the file to opt out. Commit it to share the plugin.

```sh
done-done init --hook gemini
```

`--hook gemini` adds a Gemini CLI SessionStart hook to the repo's `.gemini/settings.json` (project scope; your `~/.gemini` is never touched). Gemini CLI shows a hook's plain output only to you, so this hook pipes the bare `done-done` state through `node` into the JSON `hookSpecificOutput.additionalContext` that Gemini CLI adds to the session as context; without done-done on PATH it prints nothing and exits 0. Same merge contract as the Claude hook, and the result's `gemini_hook` says `added to .gemini/settings.json` or `unchanged`. Gemini CLI reads project settings only in a trusted folder and warns once before it runs a new project hook. Commit `.gemini/settings.json` to share the hook.

```sh
done-done init --hook pi
```

`--hook pi` writes an extension to the repo's `.pi/extensions/done-done.js` (project scope; your `~/.pi` is never touched). On the first prompt of each session its `before_agent_start` handler runs `command -v done-done >/dev/null && done-done || true` (up to 30 seconds) and adds the output as a message the model reads; without done-done on PATH it adds nothing and never throws. pi loads project extensions only after you trust the project. Same file contract as the opencode plugin: other files are untouched, a re-run adds no duplicate, an existing file with other content exits 2 untouched, and the result's `pi_extension` says `added to .pi/extensions/done-done.js` or `unchanged`. Commit it to share the extension.

`--hook` works with `--journey` too: `init --journey smoke --hook claude -- <command>` records the journey and adds the hook.

### Check the setup

```sh
done-done doctor
```

`doctor` answers "is this repo worth driving" and changes nothing except the `--probe` call record (the agent itself may keep its own session files). It checks twelve items, each reported `ok`, `warning` or `missing` with the exact fix command (plus a `tool_gate` `warning` row when the agent is pi or codex; see [Agents](#agents)): `git` (inside a repository), `config` (a valid `.done-done.yaml`), `evidence_root` (writable), `verify_skill` (`.agents/skills/done-done-verify-<app>/SKILL.md`), `agent` (the coding agent the user set and its model; `missing` when none is set, with the command that saves the user's choice, or when it is not installed or done-done cannot start it yet; see [Agents](#agents)), `agent_settings` (each effective agent setting, `agent`, its model, effort, how many extra flags are set (never their values), binary and `agent_timeout`, and where it came from: the global config, `.done-done.yaml` or `default`), `judge` (`missing` when no judge is set, with the command that saves the user's choice; else the judge kit is present, and the route's own setup: for `claude-code` an executable `claude` binary (`agent_path_override.claude`, else PATH), with your own sign-in checked only when a capture is judged; for `answerer:<agent>` the agent on PATH; for `openai:key` the `OPENAI_API_KEY` variable and a `judge.model`; for `minimax:key` the `MINIMAX_API_KEY` variable; doctor does not call the model; it is checked even with no agent set), `ffprobe` (video evidence only) and `judge_choice` (the route and model the judge runs and the author it judges, see [Judge relevance](#judge-relevance): `ok`, naming how far apart they are (`agent`, `model` or `session-only`), since any judge the user sets runs; `missing`, with no fix of its own, until the agent is set; `missing` when no judge is set or the judge config is incomplete, such as a key route with no `judge.model`) and `real_product` (whether the journeys drive the product, see [Real-product evidence](#real-product-evidence): `ok` naming them, or with no journeys, since `verify` then drives the verify skill; a `warning` naming code-only journeys beside real ones; `missing` when every journey is code-only, with the command that records a real one), `core_journey` (`ok` naming the journey with `core: true` that drives the product, or the verify skill's `(core journey)` feature-map entry; `missing` otherwise, with the `init --journey <name> --core` command) and `upgrade_journey` (`ok` when no tracked file shows an installable artifact, or naming the journey with `upgrade: true` or the `(upgrade journey)` entry and the files that show the artifact; `missing` when the app ships one and names no upgrade journey, with the `init --journey upgrade --upgrade` command), see [Core journey and release path](#core-journey-and-release-path). `git`, `config`, `evidence_root`, `real_product`, `core_journey`, `upgrade_journey`, `agent` and `judge` are required, since done-done gives no result without its agent and judge, and refuses all proof from a code-only config: `doctor` exits 0 when they are all ok and 2 otherwise. A missing `verify_skill` or `ffprobe`, or a `warning`, never fails it. In a fresh repo with nothing set up, `doctor` names each missing piece, starting with `done-done init`.

```sh
done-done doctor --probe
```

`--probe` also asks the agent one JSON-schema question (one call at its model) and adds a `probe` item that is then required: `ok` only when the agent answers with a valid object. Codex is the exception: it cannot be asked tool-less, so its `probe` row is a `warning` that gives the reason and asks nothing (see [Agents](#agents)). The call record goes to `$DONE_DONE_HOME/agents/` (mode 0600); it keeps the agent, model, effort, extra flags, binary, schema, tools, cwd, timeout, argv, prompt size in bytes, timing, exit code, answer or error, and the last 2000 characters of stderr, never the prompt text. A failed probe row shows one clean line: the agent's last line that names an error, or else its last meaningful line, with no colour codes or stack frames and at most 200 characters. The raw stderr stays in the record.

#### Agents

done-done starts the coding agent you choose, and never picks one. `agent:` names exactly one (`claude`, `codex`, `opencode`, `pi`, `gemini` or `acp:<target>`); there is no auto-detection and no fallback list, so an agent that is not installed or cannot start stops the command with the reason. While no agent is set, a command that starts it asks in a terminal (a numbered list of agents, then of models) and saves the answer to the global config; anywhere else (an agent calling done-done) it exits 2 with `no agent is set: ask the user which agent to use (claude, codex, opencode, pi, gemini, acp:<target>); never pick one for them` and the command that saves the answer: `done-done init --agent <agent> --model <model>`. `doctor` reports an unset agent as missing with that same fix. The model is `agent_config.<agent>.model` (global config only), else the agent's cheap default (`claude-haiku-5-5` for claude, `opencode-go/muse-spark-1.3-contributor` for opencode, `flash-lite` for gemini; claude and opencode also default to `effort: low`). That table is the only place done-done names a default model, and `init` writes it into the global config. `agent_config.<agent>.effort` (`minimal`, `low`, `medium`, `high`, `xhigh` or `max`, or `''` for the CLI's own) goes to the CLI's own flag as written: `--effort` (claude), `-c model_reasoning_effort="<level>"` (codex), `--variant` (opencode) and `--thinking` (pi); gemini and `acp:<target>` have none, so an effort for them is a config error. `agent_args_override.<agent>` adds extra CLI flags after done-done's own (do not repeat a flag done-done passes), `agent_path_override.<agent>` starts that binary instead of the one on PATH, `acpx_path` names the acpx bridge, and `agent_timeout` (default `30m`) bounds each agent call: a verify drive, a maintain reader, the judge and the doctor probe. A streaming agent (pi, opencode, codex, `acp:<target>`) that prints nothing, on stdout or stderr, for 5 minutes is stopped early (30 seconds for the doctor probe); the no-answer reason then quotes its stderr and the call record path, so a hung agent costs minutes, not the whole timeout. A rate limit the CLI prints (HTTP 429, a usage limit) ends any agent call at that line, with the limit and its reset time as the reason; the one exception is a claude judge call with images, which stops only at claude's own rejected rate-limit event, so its retries run. claude and gemini print one answer at the end, so only `agent_timeout` bounds them. These defaults are the cost guard for those agents: done-done never defaults to a flagship model for them. codex, pi and `acp:<target>` have no public cheap alias, so with no `agent_config.<agent>.model` (for `acp:<target>`, `agent_config.acp:<target>.model`) they run their own configured model, which can be a flagship; that setting caps their cost. `agent: acp:<target>` (for example `acp:gemini`) starts any Agent Client Protocol agent through [acpx](https://github.com/openclaw/acpx), which you install yourself (`npm install -g acpx`). doctor reports an `acp:` agent missing, with that install step, when acpx is not on PATH or does not start.

Each call is a fresh, single-shot session that must answer one JSON object matching a schema. The prompt goes on stdin (claude, codex, pi, gemini, acp) or into a 0600 prompt file (opencode), never in argv. done-done can start claude (`claude -p --output-format json --json-schema <schema> --model <model> --no-session-persistence`, all tools off with `--tools ''`; tool-less calls also pass `--setting-sources ''` and run from a scratch folder, so no project settings or hooks load; read-only calls allow only `--tools Read,Grep,Glob` and pass `--setting-sources ''` and `--strict-mcp-config`, so no user settings or MCP servers load), opencode (`opencode run "Follow the attached instructions." --format json -m <provider/model> -f <prompt file>`, with the schema in the 0600 prompt file and every tool denied through `OPENCODE_PERMISSION` except on an edit step ([Drive by agent](#drive-by-agent), Scope)), pi (`pi -p --mode json --no-session --no-tools`, tools off for every read or probe call, since pi has no read-only mode that refuses outside reads, and `--model <model>` only when one is set) and gemini (`gemini -p "Follow the instructions on stdin." -o json -m <model> --approval-mode plan|auto_edit`, where `plan` is read-only for the probe and read steps and `auto_edit` is used for edit steps; `--skip-trust` is added only to the tool-less probe in its scratch folder, so repo calls keep Gemini's workspace trust gate) and codex (`codex exec --json --ephemeral [-m <model>]`, the answer being the last agent message of its JSONL events; an edit step runs in codex's `--sandbox workspace-write` with the run's evidence and scratch folders added by `--add-dir` and network on, so the drive can launch the app and talk to it, while it keeps your own codex config). codex cannot be a tool-less call: probed live on codex-cli 0.159.2 with your config.toml honored, its MCP server read a canary file outside the folder and `--disable multi_agent` left its multi-agent tools on, so done-done never starts codex tool-less: the judge exits with the reason, starting nothing; `doctor --probe` shows a warning with that reason and asks codex nothing; a codex maintain run stops before any run with exit 2 and the reason, as a gemini maintain run does. `acp:<target>` runs `acpx --cwd <dir> --format json --json-strict --deny-all --non-interactive-permissions deny [--model <model>] <target> exec --file -`, with the prompt and schema on stdin; every tool is denied. pi has no permission gate for edit steps, so doctor adds a `tool_gate` warning row whenever pi is the agent: every pi tool runs without approval. codex's sandbox covers its shell too, so doctor adds a `tool_gate` warning row whenever codex is the agent: a drive's recipe tool can write only where the drive may (see [Drive by agent](#drive-by-agent), Scope).

### Run a journey

Describe your journeys in `.done-done.yaml` at the repo root:

```yaml
app: notes
evidence:
  ignore_paths: ["docs/**", "*.md"]  # commits touching only these keep evidence fresh
journeys:
  review:
    command: node scripts/capture-review.mjs --out $DONE_DONE_EVIDENCE_ROOT
```

The script saves its captures into that folder and writes `steps.json` beside them: the target version, start state, user steps and end result ([Step record](#step-record)).

Then run it:

```sh
done-done run review
```

`run` does five things:
- records HEAD, its tree, and whether tracked files were dirty;
- creates a new folder for the run, `<root>/<run-id>/`. The run id is the time, the commit and a random suffix, so two runs never share one;
- runs the command, with `${RUN_ID}` substituted, `DONE_DONE_RUN_ID` exported, and `DONE_DONE_EVIDENCE_ROOT` set to the run's folder. The command's own stdout goes to stderr, so stdout carries only the result document;
- hashes every file in the run's folder. Every checkout of a repo shares the evidence root, so a run records only its own folder and never another run's files;
- writes a run record to `<root>/.done-done/runs/<run-id>.json`.

A run that worked ends `result: recorded`, never `pass`: it captured evidence, and only a judged `check` (or `verify`) says whether that evidence proves the claim, so its next step is that check. A non-zero command exit, or a run that wrote nothing, fails. A run that wrote nothing names its folder and the two names the command gets it under: `DONE_DONE_EVIDENCE_ROOT` and `DONE_DONE_RUN_ID` (or `${RUN_ID}` in the command).

For a proof you drive by hand or through an agent:

```sh
done-done run --open      # prints a run id
# ...capture into the folder it prints (evidence_root)...
done-done run --close <run-id>
```

You can also run a one-off command without a journey: `done-done run -- <command>`. One word is taken as that whole shell command; several words are kept as given, each one quoted as needed, so a word holding spaces or shell metacharacters reaches the command intact (write them as you would write them inside `sh -c`).
A run whose command matches no repo-recorded journey says so in its `help`: the recipe is not in the repo, so nobody can re-run the proof from the config. Record it with `done-done init --journey <name> -- <command>` and commit.
Run `done-done` outside wrappers that expand `${...}` themselves (`systemd-run` does): put such a wrapper inside the command, or it eats `${RUN_ID}`.

#### Run-instance harness

One project-agnostic primitive: with an `instance` block, each journey, agent drive and `done-done run -- <command>` starts the app under test on its own port, with its own HOME and XDG folders, waits until it is ready, and stops it at the end:

```yaml
instance:
  command: node server.mjs
  ready: { url: http://127.0.0.1:$DONE_DONE_PORT/health }  # or { command: curl -sf $DONE_DONE_BASE_URL/ }
  ready_timeout: 30s
```

done-done picks a free local port it owns (a port that is already taken is never used) and passes `DONE_DONE_PORT` and `DONE_DONE_BASE_URL` to the instance, the journey and the agent drive, so a recipe uses `$DONE_DONE_BASE_URL` instead of a hard-coded port. For the app alone, HOME, XDG_CONFIG_HOME/XDG_DATA_HOME/XDG_CACHE_HOME and TMPDIR point under the run's scratch folder; the journey keeps your own HOME, XDG and TMPDIR, and the agent drive keeps its own HOME and XDG. Readiness is HTTP 2xx for `ready.url` or exit 0 for `ready.command` (each probe is killed at the remaining timeout, so a hung command cannot hang the run); past `ready_timeout` the run fails and the instance is killed. The app's output goes to `instance.log` in the run folder, never with the evidence. The group is killed when its journey or agent drive ends, or on the next read after a dead runner. `done-done run --open` does not start the app; its caller starts and stops its own. No `instance` block keeps today's behaviour.

### Capture matrix

One verify run captures every theme x width x form-factor cell the repo asks for:

```yaml
matrix:
  theme: [light, dark]
  width: [390, 1280]
  form: [phone, desktop]
  skip:
    - { theme: dark, form: phone, reason: "dark phone ships next quarter" }
```

Each axis is optional; done-done expands the set axes into cells and drops skipped ones. Theme and form names use letters, digits, `-` and `_` (a dot would blur the capture names); widths are CSS pixels. A skip entry is a partial cell (any of `theme`, `width`, `form`) plus a `reason`: it drops every cell agreeing on each axis it names; a skip that matches no cell, or a matrix that skips every cell, is a config error. With no `matrix` block, journeys run once, as before.

`run` and `verify` run the journey once per required cell and a non-zero exit in any cell fails the run; `verify` also applies one `journeys.<name>.timeout` to all the cells together. Each cell's run gets `DONE_DONE_THEME`, `DONE_DONE_WIDTH`, `DONE_DONE_FORM` and `DONE_DONE_CELL` (the capture name suffix: `dark.390w.phone` for that cell) set. The recipe sets the app's theme and width from those values - done-done never knows how - and names each capture with its suffix. An agent drive instead names every cell and suffix in its prompt. The run record and `status` carry the manifest: every required cell with its captures, every skipped cell with its reason. Verify's check, `done-done check` and `receipt` all fail naming the missing cell when a non-skipped cell has no capture, so every proof of HEAD must cover every non-skipped cell: captured or skipped with a reason, never silently missing.

### Input guard

One verify run proves it did not change the inputs it reads (fixtures, data files): `inputs: ["data/**", "fixtures/seed.json"]` is a list of repo-relative paths or globs. done-done hashes every matching file, dotfiles and git-ignored files included, before the drive and again after; the check step fails naming each changed, appeared or disappeared path, never its contents, and the before/after hash lists go into the run record. An input that is absolute, has a `..` segment, reaches a folder through a symlink, or links outside the repo is refused with an error naming it. With no `inputs` key, a run behaves as before.

### DOM assertions

A capture judge misses page-level defects. With a `dom` block, a run also fails when a captured screen's page overflows the viewport horizontally, logged a console error, had a failed request or shows squashed, clipped or cut-off UI:

```yaml
dom:
  allow_console: ["favicon\\.ico"]   # console error regexes that do not fail
  allow_requests: ["/analytics/"]     # request URL regexes that do not fail
  fail_on_overflow: true              # default true
```

done-done never drives the browser: the recipe or journey writes one page-check record next to each capture (PNG, JPEG, WebP, GIF, MP4 or WebM), named as the capture with `.dom.json` for its extension (`home.dark.390w.png` -> `home.dark.390w.dom.json`, so a matrix cell's record carries its `DONE_DONE_CELL` suffix):

```json
{"url": "http://127.0.0.1:4100/", "overflow": true, "overflowing": ["div#wide"], "console_errors": ["boom"], "failed_requests": [{"url": "http://127.0.0.1:4100/x.js", "status": 404}],
 "squashed_text": [{"element": "h3.card-title", "text": "Approved", "chars": 1.6, "lines": 8, "words": 1}],
 "clipped_text": [{"element": "h3.card-title", "text": "Answered: the release notes are approved", "by": "its own box"}],
 "cut_off": [{"element": "div.clock", "text": "12:30", "edges": ["top"]}]}
```

With your browser tool, for example chrome-devtools-axi: `overflow` and `overflowing` from `eval` (document `scrollWidth` beyond `clientWidth`, and the elements whose right edge passes it), `console_errors` from `console --type error`, `failed_requests` (status 400 or more, or 0 for no response) from `network`, `squashed_text` from `eval` of done-done's measurement function, run in each frame of the page (an embedded frame too). It lists every visible HTML element with its own text (SVG text has no layout box and is skipped; widths are untransformed layout pixels, so a scaled ancestor does not shrink them) whose box is under 8 characters wide (its width over the average glyph width of its font) while its text is wider than the box, or whose text sits on more lines (distinct line boxes) than it has words: a title wrapped one letter per line in a narrow column. `squashed_text`, `clipped_text` and `cut_off` are optional, so a record written without them stays valid; [`done-done look`](#look-check) writes all of them, and the check fails on each `clipped_text` and `cut_off` item as it does on `squashed_text`. The agent drive prompt carries the recipe, and a verify skill should carry it too. Verify's check and `done-done check` fail naming the capture and each issue not on an allow list, and fail when a capture has no record or a record is not this shape. No `dom` block keeps today's behaviour.

### Look check

`done-done look` is the look step a journey calls on a web page. It opens the page in headless Chrome at a 390x844 phone viewport (a mobile device at 1x scale), measures the look defects in the DOM, writes the screenshot with its page-check record next to it, and exits 1 on any hit, naming the element, the kind and its text. It is a measurement step, not a verdict: with no hit it ends `result: clean` (exit 0), never `pass`, and its capture is judged when a `check` or `verify` cites it. No model runs here, so the same page gives the same answer. A worker's claim that a phone UI works needs this 390 px capture of the real page, plus the page's scroll-container count, as proof; a mock or another width is not proof.

```sh
done-done look http://127.0.0.1:3000/inbox --out "$DONE_DONE_EVIDENCE_ROOT/inbox.png"
done-done look ./public/inbox.html                     # a path on disk opens as its file:// URL
```

A journey in `.done-done.yaml` that calls it (one command per screen, `&&` between them, so the first hit stops the journey):

```yaml
journeys:
  inbox-look:
    command: >-
      done-done look "$DONE_DONE_BASE_URL/inbox" --out "$DONE_DONE_EVIDENCE_ROOT/inbox.png" &&
      done-done look "$DONE_DONE_BASE_URL/inbox/1" --out "$DONE_DONE_EVIDENCE_ROOT/answered.png"
```

`$DONE_DONE_BASE_URL` is set when the repo has an [`instance` block](#run-instance-harness); without one, name the page's URL. A hit fails the journey, so `done-done run` and `verify` fail with it. Never write `done-done look ... || true` or log the exit and go on: that is the gap this step closes.

- **What it measures.** In the page's main frame, after it loads and its web fonts are in:

  | Kind | A hit when |
  |---|---|
  | overflow | the page is wider than the viewport, so it scrolls sideways (the elements past the right edge are named) |
  | squashed text | done-done's [squashed-text measurement](#dom-assertions): a text block under 8 characters wide while its text does not fit, or on more lines than it has words |
  | clipped text | part of an element's text shows and part runs past a container that hides its overflow (`overflow: hidden` or `clip`), with no `text-overflow: ellipsis` (sideways) or line clamp (downwards): a card title cut to one line |
  | cut off | part of an element shows and part lies past the left, right or top edge of the viewport: a status-bar clock clipped at the top. The page is at its top, so content below the bottom edge is fine |

  Something entirely outside its container or the viewport is hidden on purpose (a closed drawer, a visually hidden label) and is not a hit; a cut element's children are not listed again. Content in a scrolling container (`overflow: auto` or `scroll`, such as a carousel) scrolls into view and is not clipped.
- **What it writes.** `--out <file.png>` (default `look.png` in `$DONE_DONE_EVIDENCE_ROOT` inside a journey, else in the current folder) gets the viewport screenshot, exactly the viewport size in pixels, and `<file>.dom.json` next to it the page-check record of [DOM assertions](#dom-assertions), with the page's console errors and failed requests too. look itself fails only on the four kinds above; with a `dom` block, verify's check also reads the record and applies its allow lists to console errors and failed requests.
- **Chrome.** look starts its own headless Chrome or Chromium (`google-chrome`, `google-chrome-stable`, `chromium` or `chromium-browser` on PATH, or `DONE_DONE_CHROME` naming the binary) with a throwaway profile, and removes both when it ends. It runs Chrome without its sandbox so it starts in containers, so point it at your own app, not untrusted sites. No Chrome is a usage error (exit 2) that says how to install or point to one; a page that does not load (its network error, or no load event within 30 seconds) is exit 2 with the cause.
- **Limits.** Only the main frame is measured, not an embedded frame; a transform or `clip-path` that hides part of a box is not seen; nothing is clicked or scrolled first, so drive the page to the state to check (a URL per state) before you call look. Look at the capture too: a defect the DOM cannot see (a stretched image, a colour) is the [design check](#design-check)'s.

| Result | Exit |
|---|---|
| no hit | 0 |
| a hit of any kind | 1 |
| bad flags, no Chrome, or the page did not load | 2 |

### Lint check

`done-done lint <PR URL | report file> <evidence folder>` is a deterministic gate on a worker's claim: no judge, no model, and the project config only switches on two optional size rules. It prints `PASS`, `WARN: <reason>` or `FAIL: <reason>` and exits 0 (PASS or WARN), 1, or 2 on a usage error. A PR URL is read with `gh pr view`; a file is read as the report.

- The newest `## Checks` block needs `outcome:`, `repro:`, `proof:` and `evidence:`.
- `proof:` names a command or path, and the repo's `done-done-verify-<app>` skill (a legacy `verify-<app>` skill is read too); it may say `no verify skill` only when `.agents/skills/` in the current folder holds none.
- `repro:` is not `n/a` when the PR title starts with `fix`, `bugfix` or `hotfix`.
- `evidence: not proven: <cause>` passes.
- A PR URL whose changed files include one under `src/` and none under `journeys/` prints `WARN` instead of `PASS` (exit 0; a `FAIL` still wins). It needs no config and never applies to a report file. The worker rule it backs: run the journey, commit it, then open the PR.
- Otherwise each named file (relative to the evidence folder, or absolute) exists, is non-empty and is newer than the evidence folder itself; no two are byte-identical; and at least one has a hash no other PR used. Hashes are kept in `lint.hashes` and each run is appended to `lint.log`, both in `~/.done-done` (`$DONE_DONE_HOME`). A later lint of the same PR is not reuse.
- A PR with 1,000 or more added non-generated lines fails. Lockfiles, `vendor/`, `dist/` and `LICENSE`-type files do not count, and neither do deletions or lines moved between files. A dependabot or renovate PR passes.
- Two optional size rules, both off by default and switched on per repo in `.done-done.yaml` (read from the current folder; they apply to a PR URL, never a report file). With both off a big PR is counted exactly as above. Each runs only when the PR is still at 1,000 lines, and an API failure keeps the full count.
  - `checks.upstream_catch_up: true`: in a fork, lines the parent repo already shipped are not authored here, so lint subtracts the changes between the PR's base and the merge base with the parent's default branch. A PR that merges in no new upstream commit loses nothing.
  - `checks.moved_from: true`: a line in the PR body `moved-from: <owner>/<repo>@<ref> <dst-prefix>=<src-prefix>` (more `dst=src` pairs may follow) cancels added lines that match, byte for byte after trimming, the file at the same path under `<src-prefix>` in that repo at `<ref>`. The source repo must have the PR's owner; authored lines still count.
  - `checks.generated_paths: ["gen/**", "*.snap"]`: globs for the repo's own generated files, counted as generated beside the built-in ones above, so they stay out of the size count. Default none, so results do not change. Like the two rules above it applies to a PR URL, never a report file.

### Base-ref before

A before/after change is judged as a pair. With `base_ref` set to a branch, tag or commit (for example `base_ref: origin/main`), `verify` drives the base ref too, after the head's drive and only when it passed:

```yaml
base_ref: origin/main
```

done-done checks the base ref out in a scratch git worktree of its own under the run folder (never your checkout) and removes it after. The same journey or agent drive runs there with the same `DONE_DONE_RUN_ID`, its own instance (when an `instance` block is set) and every matrix cell's env, and `DONE_DONE_EVIDENCE_ROOT` is the run folder's `before/`, so a journey must write its captures there, not to a path it builds itself. An agent drive is told it is at the base ref, where the outcome is not expected to hold. The run record keeps `base` (the ref and its commit). Each head capture pairs with the base capture of the same name, matrix cell suffix included (`home.dark.png` with `before/home.dark.png`): the judge gets both in one request (two images, or two texts for a text capture) and passes it only when the after capture shows the outcome as a change from before; a base capture is never judged against the outcome alone, and it may match its head capture byte for byte (the judge then sees no change). A head capture with no base capture of its name is reported (inconclusive, exit 3, with why the base drive failed when it did) and judged alone. Without `base_ref` (the default) nothing changes: each capture is judged alone.

### Real-product evidence

done-done proves the real product works, not that its code checks pass. One model-free rule, on a command's text alone, decides which runs count; `init`, `doctor`, `check`, `receipt` and `gate` all use it.

A command is **code-only** when every step in it (split on `&&`, `||`, `;`, `|` and newlines, with redirections dropped and wrappers such as `npx`, `env`, `VAR=value`, `sh -c`, `pnpm exec`, `uv run`, `bundle exec` and `python -m` read through) is a test, typecheck, lint or build runner or shell plumbing around one (`cd`, `echo`, `tee`, `mkdir`, `cp`, `cat`, `npm ci`...), and at least one step is a runner. The runners are a package script named `test`, `check`, `lint`, `typecheck`, `types`, `tsc`, `build`, `format`, `coverage`, `validate` and their variants (`npm test`, `yarn run check`, `pnpm test:unit`, `bun test`), and tools such as `tsc`, `eslint`, `prettier`, `biome`, `jest`, `vitest`, `mocha`, `node --test`, `playwright test`, `cypress run`, `pytest`, `tox`, `mypy`, `ruff`, `go test`, `cargo test`, `make test`, `gradle test`, `mvn test`, `dotnet test`, `flutter test`, `deno test`, `rspec` and `phpunit`, and a test or guard script by its file name or folder, run directly or by an interpreter (`bash tests/relaunch.test.sh`, `node scripts/floor-guard.mjs`, `node scripts/test.mjs`, `python3 tests/test_pair.py`, `go run ./cmd/pair_test.go`): a `*.test.*` or `*.spec.*` file (`x_test.go` too), `test_*.py`, a file in a `test/`, `tests/` or `__tests__/` folder, a script named `test`, or one whose name ends in `guard` or `lint` (`floor-guard.mjs`, `lint.sh`). Any other step (a capture script, `done-done look`, the app's own binary, `npm start`, `curl`, `adb`, `playwright screenshot`) drives the product, so a command with one is not code-only. A run opened by hand (`run --open`) or driven by the agent (`verify` with no journey) has no command and is never code-only.

- `init --journey` refuses a code-only command (exit 2, nothing written), and `init`'s verify skill refuses a code-only launch or feature drive.
- `check` and `receipt` stop before the judge (exit 2) when every journey in `.done-done.yaml` is code-only, naming them, or when every cited capture comes from a code-only run, naming its journey or command. A test log cited beside real captures is fine: they carry the proof.
- A receipt records the run behind each cited capture (`runs`), so `receipt --verify` and `gate` apply the same rule with no config (and the [step record](#step-record) rule after it): a receipt whose runs are all code-only, or one with no `runs` (written before this rule), fails.
- `doctor`'s `real_product` row is `missing` (and doctor exits 2) when every journey is code-only, and a `warning` naming the code-only journeys beside real ones.

### Step record

A capture shows a screen; the **step record** says what a user did to reach it. Every journey (and every agent drive) writes `steps.json` into its run folder, `$DONE_DONE_EVIDENCE_ROOT`, beside the captures:

```json
{
  "target": { "version": "0.6.0" },
  "start": "a fresh host with no paired phone",
  "steps": ["pair the phone", "open a pane", "type `echo hi`"],
  "result": "the pane shows hi on its own line"
}
```

`target.version` is the version of the app driven, `start` the state it began from (for an upgrade journey: the previous version installed), `steps` the steps a user takes, in order, and `result` what a user can see at the end. All four are required; a file that is not JSON or lacks one is recorded as invalid. `run` and `verify` read the file when the run closes and keep it in the run record (`steps`, with `tool`, the done-done version that recorded the run, and `steps_error` when the file is invalid); it is a record, not a capture, so it is not listed in the run's files and the judge never reads it. A journey writes it as it drives, from what it really did, never from the claim.

The check reads the claim against the record, with no model: at least half of the claim's words (four letters or more, without scaffolding such as `user`, `can`, `now`, `works`) must appear in the record's `start`, `steps` and `result`, matching word beginnings (`attach`, `attaches`, `attached`), and at least one of them in `result`. This runs after the code-only rule, which stays the first filter, and with it:

- `check` and `receipt` stop before the judge (exit 2) when no cited capture comes from a run (not code-only) whose step record covers the claim, naming each run and the words its record never mentions. A log from a wrapper script whose record says `ran the unit suite` cannot satisfy a claim about attaching to a pane; a real CLI transcript whose record names the command and its output still satisfies a claim about that command. A cited run with no step record, or an invalid one, is refused the same way, with the shape to write.
- A receipt keeps each run's step record (`runs[].steps`), so `receipt --verify` and `gate` apply the same rule to the receipt's claim with no config or evidence: a receipt whose runs have no covering record fails.
- A run recorded before step records existed (its run record has no `tool`, or a receipt run has none) keeps working: `check`, `receipt`, `receipt --verify` and `gate` still pass, but say so in `warnings` (`gate` prints `WARN: ...` after `PASS`): re-run the journey so it writes `steps.json`.

### Core journey and release path

A proof that drives some feature of the app does not show the app works when the one flow users need is broken, and a release proven by a fresh install does not show the upgrade users take works. So each app names two journeys, and `init`, `doctor` and the verify skill share one model-free rule for them (`src/proof.ts`).

- The **core journey** is the one thing a user cannot live without, driven end to end on the real target the way a user does it: for a remote terminal app, pair, open a pane, type, see the output. A config names it with `journeys.<name>.core: true` (`init --journey <name> --core -- <command>`); a code-only journey never counts. A repo with no journeys names it in its verify skill's `features/README.md` with an entry line (`- ...`) that carries `(core journey)`.
- The **upgrade journey** is the release path users take: install the previous shipped version, upgrade over it in place (install the new APK over the old one, update the host or CLI package in place), then drive the core journey. It is needed when a tracked file shows the app ships an installable or upgradable artifact: a `package.json` with a `bin` that is not `"private": true`, an `eas.json`, an `AndroidManifest.xml`, a `build.gradle` with an `applicationId`, a `pyproject.toml` with `[project.scripts]` or `[tool.poetry.scripts]`, a `Cargo.toml` with `[[bin]]`, a `.goreleaser.yml`, or a systemd `*.service` unit. A config names it with `journeys.<name>.upgrade: true` (`init --journey upgrade --upgrade -- <command>`), or the feature map with `(upgrade journey)`. One journey may be both.
- `doctor`'s `core_journey` and `upgrade_journey` rows are required, and `init`'s verify skill refuses an answer that names neither or, for an app that ships an artifact, no upgrade journey.

```yaml
journeys:
  pair-type:
    command: scripts/proof/pair-open-type.sh > "$DONE_DONE_EVIDENCE_ROOT/pair-type.log"
    core: true
  upgrade:
    command: scripts/proof/upgrade-from-last-release.sh > "$DONE_DONE_EVIDENCE_ROOT/upgrade.log"
    upgrade: true
```

### Affected journeys

```sh
done-done affected            # the change since the last receipt, else since the default branch
done-done affected origin/main
```

`affected [<base>]` says which journeys a change needs and whether HEAD's proof covers them. It is model-free and reads git, `.done-done.yaml` and the verify skill only.

- **The change.** The files that differ from `<base>`, else from the newest receipt whose head is before HEAD (the commits since the last proof), else from the merge base with the default branch (`origin/HEAD`, `origin/main`, `origin/master`, then the local `main` or `master`, the order the [Firstmate merge gate](../README.md#use-with-firstmate-or-another-agent-fleet) uses), plus uncommitted changes to tracked files. Untracked files are not part of the change until added. A file that matches `evidence.ignore_paths`, or a committed receipt under `.done-done-receipts/` ([CI gate](#ci-gate)), needs nothing.
- **The mapping.** A journey is needed when its command runs the changed file (`node journeys/e2e.mjs` runs `journeys/e2e.mjs`). A feature of the verify skill (`features/<name>.md`) is needed when its file cites the changed file: a repo path, a markdown link (read from the feature's folder), a folder written with a slash (`src/` covers every file under it) or a bare file name, which matches each tracked file of that name as `maintain` reads one; or when the feature file itself changed. The skill's `SKILL.md` and `features/README.md` are what every feature follows, so a change to them needs every feature. A needed feature brings each journey it names (`run <journey>` or `verify <journey>` in its text, or a file the journey's command runs that it cites too); a feature that names no journey is driven by your agent: `done-done verify --feature <name>`. A code-only journey ([Real-product evidence](#real-product-evidence)) is never needed.
- **Uncertain means more, never less.** A changed file that no feature or journey covers, or no base to diff against, makes the mapping uncertain: the core journey ([Core journey and release path](#core-journey-and-release-path)) is needed too, or the feature the feature map marks `(core journey)`, or every journey when none is named. Each such file is listed under `unmapped` and flagged in `help`: add it to the feature file that drives it (`done-done maintain` reports recent files no feature covers), or record a journey for it.
- **The proof.** `fresh` (exit 0) when the receipt for HEAD verifies ([Record a receipt](#record-a-receipt)), its `runs` include a run of every needed journey (by name, or by the journey's command) and every needed feature (a `verify --feature` drive, which the receipt records as the run's `feature`), and no tracked file has an uncommitted change. Otherwise exit 1: `stale` when the newest receipt is for an earlier commit (it names that commit and the journeys the new commits need), when the receipt for HEAD misses a needed journey or feature, or when there are uncommitted changes; `missing` when there is no receipt at all. `help` gives the commands that capture the missing proof (`done-done run <journey>`, `done-done verify --feature <name>`), then the receipt step.

The result lists the base and where it came from, the changed files (`--full` for more than five), each needed journey and feature with why (the first three reasons; `--full` for all), the unmapped files and the fallback. Bare `done-done` adds an `affected` block with the proof and the journeys still needed whenever the proof is not fresh, so every [session hook](#set-up-a-repo) shows them with no extra call. A `<base>` that is not a commit is a usage error (exit 2).

### Check a claim

```sh
done-done check --outcome "notes sync between two devices" ~/.done-done/evidence/notes/<run-id>/after.png
done-done check --from pr-body.md                 # a file, `-` for stdin, or a GitHub PR URL (needs gh)
```

`check` looks only at the files the claim names. It never scans the whole folder.

`check` and `receipt` accept `--citation-base <dir>` for evidence paths supplied as arguments or in a Checks block, for example `done-done check --citation-base /path/to/captures --from pr-body.md`. Relative citations resolve against that directory; a relative base itself resolves against cwd. Absolute citations are unchanged. With the flag, the existing result `evidence` list contains resolved absolute paths. Without it, a relative citation resolves against the repo root first (so a check from a subdirectory finds the same evidence), then against the caller's cwd (so a shell-relative path typed for that shell still works). The flag does not relocate `--from`, change the caller repository/HEAD or config (`--trusted-ref` still selects trusted config), or change `evidence.root`: that remains the run-record, receipt and reuse-ledger store. All provenance, freshness and judge rules still apply. Passing checks preserve an explicit `--citation-base` in their suggested receipt or merge gate command; run the follow-up from the same cwd when the base is relative.

With `--from`, it reads the newest `## Checks` block:

```
## Checks
outcome: <what a user can now do>
repro: <command that failed before and passes now, or n/a>
proof: <verify skill or command that drove the real product>
evidence: <paths of the evidence files, or "not proven: <cause>">
```

**Form rules for the Checks block:**
- all four lines must be present;
- `proof` names a command or path;
- if the repo has its verify skill (`.agents/skills/done-done-verify-<app>`), `proof` names it (`done-done-verify-<app>`; an older `verify-<app>` name is accepted); otherwise `proof` names some `verify-` skill or says "no verify skill";
- a fix PR needs a repro (checked against the PR title; a local file or stdin uses the HEAD commit subject as its title).

**Each cited file must pass these checks:**

| Check | Rule |
|---|---|
| Not empty | The file must contain bytes. |
| Valid media | The magic bytes match the extension. PNG and JPEG are complete (end markers present) and at least 64×64. PNG is not a blank frame. WebP and GIF are not truncated. MP4/MOV and WebM/MKV decode at least two video packets (`ffprobe`). Text and log files hold text; JSON parses. |
| Fresh | The file is in a run record whose commit is HEAD. The one exception: if the only commits since the run touch `ignore_paths`, the evidence still counts. An empty commit does not count as touching only `ignore_paths`. |
| Clean | The run was not dirty, unless `evidence.allow_dirty: true`. The run command also exited 0. |
| Not reused | Fails when the files are byte-identical within one claim. Also fails when every file was already used to prove a different claim in this repo. A claim is named by `--claim-id <id>`, by default the current branch (with `--from <PR URL>`, the PR's branch; on a detached HEAD, the commit), so rewording the outcome is not reuse. One branch is one claim: several claims on one branch each need their own `--claim-id`, or they share one reuse scope. The ledger is `<root>/.done-done/ledger` in the evidence root, so each repo keeps its own (pin `app`, as `init` does, so two repos with the same directory name do not share one); `DONE_DONE_HOME` moves it only with the default evidence root. |

A plain check is never a verdict on its own. A cited file that fails one of these checks, or a Checks block that breaks a form rule, stops the check before its judge is asked: it exits 2 with every cause in `error` and the next command in `help`, and gives no result. A check with no cited capture the judge reads (only video or other files, or none from a done-done run) stops the same way, before the judge is asked.

Files that are in no run record give an inconclusive result when another cited capture is one the judge reads: nothing ties them to a commit. So does a file that more than one run record claims when none of those runs is at the current commit (possible only with records from before each run had its own folder). Byte-identical captures from several runs are fine when one of those runs is at the current commit: that run ties the file to the commit. A file whose path is named in a run record but whose bytes no longer match fails as `changed after run <run-id>` (exit 2, before the judge), not inconclusive: the path ties it to that run, so editing it after the run is tampering, not untied evidence.

A config whose journeys are all code-only, or cited captures that all come from code-only runs, stop the check the same way, before the judge, naming the journeys ([Real-product evidence](#real-product-evidence)). So does a claim that no cited run's step record covers ([Step record](#step-record)).

`evidence: not proven: <cause>` stops the check before its judge is asked, always: exit 2, no result, no receipt. `checks.not_proven` is gone: a config that still sets it is a config error (exit 2) that says to delete the line.

### Judge relevance

The checks above prove a capture is real, fresh and tied to a commit. They do not prove it shows the outcome. The judge adds that one question: is this capture the correct screen or text for the outcome, or the wrong one (another screen, an error, a dialog or keyboard hiding the content)?

```sh
done-done init --judge pi --judge-model openai-codex/gpt-6-luna   # once: the judge you choose
done-done verify --outcome "<what a user can now do>"          # always judged
done-done check --from pr-body.md                               # always judged
```

- **Always on, done-done's own agent.** done-done gives no result without its judge: `check`, `receipt`, `verify`, `rerun` and `design` always start it, and there is no flag or key that turns it off. The checks above still run as steps, but they never give a result on their own: a check that fails stops the command with its causes before the judge (exit 2, no verdict), and a pass needs the judge to pass at least one capture, so a check that cites only files the judge does not read (video, other files) stops with exit 2 and no result, before the judge is asked. A judge that fails (a model error, a timeout, a used-up plan, an answer it cannot read) is an error with its cause: `check`, `receipt`, `design` and `verify` exit 2 with no result, and a `verify` run stops at its judge step with its cause in the run record. Neither writes a receipt. `judge.enabled` and the `--no-judge` flag are gone: the key is a config error (exit 2) that says to delete the line, and the flag is an unknown option. `check --judge <route>` (the form `judge.route` takes: `claude-code`, `answerer:opencode`, `answerer:pi`, `answerer:gemini` or `openai:key`) chooses the judge for that call only, over the config's; it saves nothing, and its model is that agent's default, or `judge.model` when the route is the configured one.

- **Set by the user, never picked.** The judge route is exactly `judge.route` from the global config: no route auto-pick or PATH detection. The model is `judge.model` when set, otherwise the agent's configured/default model (Pi defaults to `openai-codex/gpt-6-luna`). While none is set, a command that needs the judge asks in a terminal (a numbered list of judges, then of models) and saves the answer to the global config; anywhere else (an agent calling done-done) it exits 2 with `no judge is set: ask the user which judge to use (claude, opencode, pi, gemini); never pick one for them` and the command that saves the answer: `done-done init --judge <agent> --judge-model <model>` (`claude` is saved as `judge.route: claude-code`, `opencode`, `pi` and `gemini` as `answerer:<agent>`). An empty `judge.model` means that agent's `agent_config` model, else its cheap model; pi uses `openai-codex/gpt-6-luna` when no `agent_config.pi.model` is set. `judge.route: auto` from older configs is a config error (exit 2) naming the global config file; it says to delete the `judge.route` line in that file, then run that command (the file then loads, and the command saves the judge).
- **One question per capture.** Each cited capture that is in a done-done run record goes to the model with the claim's `outcome:` line and nothing else: no repo, no paths, no other files. The judge reads PNG and JPEG screens as images, and text captures (`.txt`, `.log`, `.json`, `.jsonl`, `.out`, `.err`, `.stdout`, `.stderr`, `.md`, `.csv`, `.xml`, `.html`, `.toon`) as text, asking whether the text shows the outcome; a wrong text capture fails as `judge says wrong output`. A text capture over 64 KiB is never cut, and a screen that cannot be downscaled to the judge size is never sent: either stops the command with its cause (exit 2, no verdict) before any model is asked, so capture only the output the outcome is about. Video, WebP, GIF and other files are not judged, and the result lists them as `not_judged`. With `base_ref`, a head screen and its base screen are one question, and so are a head text capture and its base text capture (the judge sees both texts); a screen is never paired with text, see [Base-ref before](#base-ref-before).
- **Where a capture goes.** Each capture goes to the provider of the judge the user set, which may be a different provider than the author's; doctor's `judge_choice` row names it.
- **A fresh, tools-off call on your own plan, through BYOKit.** Each question is one single-shot call through [`@byokit/decide`](https://www.npmjs.com/package/@byokit/decide) on a route set by `judge.route`:
  - `claude-code`: your own `claude` binary (`agent_path_override.claude`, else PATH), run the way the [agent](#agents) runs it with your normal `claude` sign-in: a fresh session, every tool off, `--safe-mode` and `--setting-sources ''` keeping your CLAUDE.md, hooks, plugins and MCP servers out of the call, and no session persistence. done-done keeps no sign-in folder of its own and sets neither `HOME` nor `CLAUDE_CONFIG_DIR` for the call. A capture goes as an image content block (stream-json input). Your `agent_args_override.claude` flags and `agent_config.claude.effort` also apply to these judge calls, as they do to every claude call.
  - `answerer:<agent>`: BYOKit's answerer calls that coding agent's CLI through the same adapter as the [agent](#agents) itself, in a scratch folder holding only the capture, with every tool off and the capture attached (for example `answerer:opencode` on `opencode-go/muse-spark-1.3-contributor`). It uses the agent's existing login. How each CLI runs tools-off:
    - `opencode`: `OPENCODE_PERMISSION` denies every tool; the capture is an attached file (`-f`). OpenCode's free-tier models refuse every call made with every tool off (HTTP 403 "OpenCode's free tier can only be used from within OpenCode"), so the opencode judge needs a `judge.model` that is not on that free tier; the error names this fix.
    - `pi`: `--no-tools`, and no skills, prompt templates or context files, so none of your own pi setup reaches the judge, and no extensions but the one that supplies the chosen model's provider; the capture is an `@<file>` argument. The model is `judge.model`, else `agent_config.pi.model`, else `openai-codex/gpt-6-luna`; it must be a model that reads images: a built-in pi provider's model (`pi --list-models` shows which do), or a claude-bridge model written as `claude-bridge/<model>`, so done-done loads the bridge extension for the call. A bare model id gets no extension.
    - `gemini`: plan mode plus a deny-all `--policy` file, which replaces your own policy folder and removes every tool, MCP ones too; the capture is an `@<file>` in the prompt, which Gemini CLI's own `@`-command code reads (outside the tool policy, per its source; not yet proven live, since Gemini CLI was not signed in on the test machine), only inside the scratch folder.
    - An `acp:<target>` agent cannot judge, since done-done cannot send it an image; doctor's `config` row says so when `judge.route` names one.
  - `openai:key`: a key-only route with no agent CLI. BYOKit's OpenAI backend sends the capture to the OpenAI Responses API on your own API key, which done-done reads from `OPENAI_API_KEY` and hands only to the kit (never printed or stored). Set `judge.model` to a model your key can use that reads images; there is no default. API billing applies.
  - `minimax:key`: a key-only route on your MiniMax key, with no agent CLI. done-done reads `MINIMAX_API_KEY` and hands it only to the kit's Anthropic backend, which done-done points at MiniMax's Anthropic-compatible endpoint (`https://api.minimax.io/anthropic/v1`, the only address it will send the key to). `judge.model` is optional: empty runs `MiniMax-M3.1-Flash-Preview`, which reads images. This route is the only one with a fallback: when its call fails (a refused or missing key, a rate limit, no answer), `check`, `receipt` and `verify` judge the whole check again on `claude-code` at claude's cheap model (`agent_config.claude.model`, else the default), and the result's `judge` block names the route that answered. When the fallback fails too, the error carries both causes. Setting `judge.route: minimax:key` is your choice, like any route; `check --judge minimax:key` tries it for one call.

  A provider key for an `answerer:<agent>` judge, or `OPENAI_API_KEY` / `MINIMAX_API_KEY` for `openai:key` / `minimax:key`, is read from the environment of whoever runs done-done. To work in every shell, point `judge.env_file` (global config) at a file of `KEY=value` lines (`export` and quotes allowed); its names that the shell has not exported go to the judge's call only. done-done never writes a key into a config file and never prints one; `init --judge` on its own changes only the global config, in any directory.

  Apart from that file, done-done never reads, copies or stores a credential. The kit is a regular dependency, installed with done-done; it needs Node 22.18 or later. The `claude-code` route uses the `claude` you already signed in with (`claude auth login`, as usual); there is no second sign-in.

- **Bounded.** Captures longer than 1280 px on their long side are downscaled first to PNG (8-bit PNG or JPEG). One request per capture (or per base-ref pair), at most 10 requests per check (later captures are unsure), `agent_timeout` per request. An answer that cannot be read (a question left out, or probabilities that do not sum to 1) is asked once more; one that still cannot be read is an error with its cause (no result) and is not cached.
- **Any judge the user sets runs.** The judge is a fresh session of its own, so it may be the author's own agent and model, and the fixer's too under `auto_fix`; done-done never refuses or warns about the user's choice. The author is the coding agent done-done starts (`agent:`), or `no agent set`. An `acp:<target>` author counts as the agent its target names (`acp:claude-code` is claude), and an author with no known model is never `model` apart. The result and doctor's `judge_choice` row name how far apart they are: `agent` (another agent), `model` (the same agent at another model) or `session-only` (the same agent and model, in a fresh session). `judge.allow_same` is gone: a config that still sets it is a config error (exit 2) that says to delete the line.
- **Cached and recorded.** Verdicts are kept in `$DONE_DONE_HOME/runs/<app>/judge/`, keyed by the capture's sha256 (and its base capture's, for a pair), the outcome text, the route and the model, so a re-run asks no model. Each answerer call writes its agent's 0600 call record (what ran and what came back; never the prompt text) to the run's `agents/` folder under `verify`, else to `$DONE_DONE_HOME/agents/`; the `claude-code` route writes one too, since it runs your `claude` the same way.
- **Only runs on a passing check.** When the deterministic checks already fail, no capture is judged, and a judge pass never turns a failed check into a pass.

| Verdict | Result | Exit |
|---|---|---|
| `pass`: the capture shows the outcome | pass | 0 |
| `fail`: wrong screen | fail | 1 |
| `unsure`: the model said it cannot tell, or its pick was below `judge.floor` | inconclusive | 3 |
| the judge did not answer (a model error, a timeout, a used-up plan, an answer it cannot read) | no result, an error with its cause | 2 (`verify`: the run fails, 1) |

Under `verify`, a `fail` or `unsure` verdict does not end the run: it parks it at its [gate](#the-gate-and-respond).

The result gains a `judge` block with the route, the model, the independence, the author and, for each judged file, its verdict, a short reason and whether it came from the cache, and, when the outcome names several parts, the parts it lists and the positions of the ones it shows (`parts`, `covers`). For the `claude-code` route, a missing `claude` binary or an `agent_path_override.claude` that is not an executable file, or a Node older than 22.18 is a config error (exit 2) whose `help` line is the command to fix it. A `claude` that is not signed in (checked only when a call fails) is exit 2 too, with `claude auth login` as the `help` line, the same sign-in you use in your shell. done-done does not check which plan that sign-in is on, so `claude` uses whatever sign-in your environment gives it. The kit cannot tell a bad `judge.model` from a used-up plan, so the error names both. For `openai:key`, an unset `OPENAI_API_KEY` is a config error (exit 2) too, and a refused key or a bad `judge.model` is an error with the HTTP status, naming both. The judge's confidence is the model's own estimate, not a calibrated score. `judge.floor` (global config, a number from 0 to 1, default `0.7`) is the least probability the judge's pick may carry and still count: a pick below it is `unsure` with `not confident enough (confidence <n> below floor <f>)`, and never a pass. It governs every judge: check and receipt relevance, maintain triage, and the design check. An outcome that names several parts (widths, themes or frames, such as "at 390 and 1440 wide") needs each one shown by a passing capture: every capture lists the parts the outcome names and the positions of the ones it shows, and the check matches those parts by name, never by position, so a call that lists them in another order or writes a label with other case, spacing or trailing punctuation still covers the same part; a part named in a reply that no passing capture shows makes the check inconclusive, naming that part. The lists are the judge kit's answer fields (`answerFields` on the question), so they arrive on the answer the kit resolves; the `openai:key` route is asked for no such field, so it requires no part, and on every other route a reply that leaves either list out, or names a position its own parts list has no part at, is asked once more, and one that still does is an error (exit 2). Each request asks the judge to name the element the outcome claims and quote what it sees before it decides, and a text capture (JSON, a log) is read entry by entry, every width and frame, before the judge answers; the reason shown is the model's one-sentence person reason, else its rationale; each judged file also shows the model's rationale, the quote it read, under `seen` when the model gave one. The floor is part of the verdict cache key, so a changed floor asks the judge again.

### Design check

The checks above prove a screen is real and shows the outcome. `design` asks whether it looks right: the same judge looks at each captured screen and fails it on a visual defect.

```sh
done-done design shots/home.png shots/home.dark.png shots/home.small.png shots/home.large-font.png
done-done design shots/home.png --mock shots/home.png=design/home.png
```

- **One request per screen, the judge's route.** Each screen goes to the judge the user set (`judge.route` and `judge.model`; with none set, `design` asks for one as in [Judge relevance](#judge-relevance); `design` starts no coding agent, so it needs no `agent:`), as one fresh, tools-off call through BYOKit with the screen and nothing else: no paths, no repo. Any judge the user sets runs, the author's own agent and model too. Each request writes its own 0600 call record to `$DONE_DONE_HOME/agents/` (`design-<stamp>-<n>-<request>.agent.json`, the request's number in this run), never the prompt. On the answerer route, a reply that is not valid JSON in the answer shape is tried again within its request, once. An answer the judge gives that cannot be read (a kind or an option left out, or probabilities that are all zero or do not sum to 1) is asked once more, so a screen costs one request, or two when the first answer is unreadable (up to four agent calls on the answerer route); a second unreadable answer stops the command with no result and the error `the judge did not answer` (the verdict table below), never a judge unsure about every kind. The judge's answer is cached in the run store (`$DONE_DONE_HOME/runs/<app>/design/`, one `<key>.json` file per input) per exact input: the screen and mock bytes, the questions, `judge.route` and `judge.model`, and the cache version of the release. A re-run of the same input asks no model and gives the same verdict, marked `cached: true`; a changed screen, mock, route, model or `judge.floor` is a new input. To have a cached verdict judged again, delete its `<key>.json` file; the next run asks the judge. An answer that never came (a model error) or cannot be read is not cached.
- **The defect kinds.** The judge answers one question per kind, and a screen fails on any kind it names:

  | Kind | Fails when |
  |---|---|
  | `aspect` | an image, photo, avatar, logo or icon is stretched or squashed (an avatar, app icon or logo mark more than 1.3 times wider than tall, or taller than wide) |
  | `clipped-text` | text is cut off at an edge or by its container, or cut mid-word without an ellipsis |
  | `overlap` | elements cover each other, or content sits under the status bar or system bars |
  | `off-screen` | an element is pushed past the left, right or top edge (content that scrolls below the bottom is fine) |
  | `blank-strip` | a blank, black or solid band where the app should paint, such as a black bar down one side; also measured from the pixels, below |
  | `squashed-text` | a text block rendered narrower than about 8 characters while its text does not fit, or broken onto more lines than it has words, such as a title wrapped one letter per line in a narrow column |
  | `layout` | elements misaligned, squeezed, badly wrapped or stacked wrongly, or text unreadable against its background |

- **Measured strips.** A blank strip is also measured from the pixels of each PNG or JPEG screen: a band along a whole edge, at least 2% of that side deep, in one plain colour with nothing in it, and clearly apart from the screen's main colour. The measurement goes to the judge with the screen, as `measured_from_pixels` with its edge, colour and depth (`left edge: a plain #151815 band 132 px deep (12% of the width), full height, with nothing in it`); the verdict is the judge's, and the measurement never fails a screen on its own. A nav rail or bar that holds icons or a title is content, not a strip, and a screen that is all one colour is the blank-frame check's. A band its `--mock` has too (same edge, about as deep as a share of that side, and in about the same colour) is approved design and is not sent; a band the mock lacks is. If the mock cannot be measured, a band on the screen goes to the judge as one the mock could not be measured to compare. A fully transparent pixel is never measured as part of a band, so a transparent margin is not a strip on a light or dark screen. The measure misses a strip close to the screen's main colour (a black bar on a near-black screen); the judge's question still covers it.
- **Mocks.** `--mock <screen>=<mock>` sends the screen and its approved mock in the same request, and the judge reports a difference from the mock as a defect of its kind (a moved, missing or resized element is `layout`); live data such as names, numbers and times is not a defect, and an element shaped as in the mock is not stretched. A dialog, sheet, menu, popover or toast is not a defect only where the mock draws that same overlay in the same place; one the mock lacks, or draws elsewhere, is judged like any other element. Repeat `--mock` per screen; a screen named only in `--mock` is still checked. Without a mock, the screen is judged alone.
- **Variants.** `design` judges the screens it is given and captures nothing. Capture each variant your change touches (dark theme, small width, large font) as its own screen and pass them all; a name such as `home.dark.png` or `home.large-font.png` keeps them apart, and each variant takes its own `--mock`. Pass the raw capture: the judge reads everything in the image as the app, so a device frame or letterbox band fails as a `blank-strip`.
- **From a verify flow.** Run it on the screens a journey writes, after the capture, so a failing screen fails the journey and the `verify` run with it: `journeys: { shots: { command: "node capture.mjs && done-done design $DONE_DONE_EVIDENCE_ROOT/*.png" } }`.

| Verdict | Result | Exit |
|---|---|---|
| every screen `pass` | pass | 0 |
| a screen `fail`: the judge named a defect | fail | 1 |
| no fail, but a screen `unsure`: its pick for a kind was below `judge.floor` | inconclusive | 3 |
| a screen or mock the judge cannot be sent (empty, truncated, a blank frame, not a PNG or JPEG, or one that cannot be downscaled), or the judge did not answer (a model error, a timeout, an answer it cannot read) | no result, an error with its cause | 2 |

The result lists each screen (failing first, then unsure, then passing; `--full` for more than five) with its `verdict`, its `mock` when it had one, its `defects` (each a `kind` and `where`: the element and where it is on the screen) and a `reason` when it is unsure, plus the `judge` block (route, model, independence and author) and the counts. A missing screen or mock file, or a `--mock` without `=`, is a usage error (exit 2). The judge reads only what is visible, so a wide logo mark that is meant to be wide can fail without a mock; pass its mock to settle it.

### Record a receipt

A receipt ties one passing check to one commit and to the exact bytes it cited, so a merge gate (or `gate` in CI) can re-verify the same proof later.

```sh
done-done receipt --from pr-body.md       # or --outcome "<claim>" <files...>, or --from -
done-done receipt --verify <head>         # read-only: check a recorded receipt
```

`receipt` takes the same claim inputs as `check` and runs that check. It writes `<root>/.done-done/receipts/<head>.json` only when the check passes on the current HEAD, the tracked tree is clean, and the check cited at least one evidence file; a dirty tracked tree, a failed or inconclusive check, a pass that cited no evidence, or a moved HEAD writes nothing and exits non-zero. The record holds the repo, the head and tree sha, the claim outcome, every cited file with its sha256, the run behind each cited capture (`runs`: run id, journey and command, the command `null` for a run opened by hand or driven by the agent) and a timestamp. Every receipt is schema 2 and holds a `judge` block: the route, model, independence and author, and each judged file's path, sha256 and verdict. A cited file is stored relative to the repo, or as `<evidence root>/<path>` when it is under an evidence root outside the repo, so the receipt still finds it from another checkout or a restored evidence root.

`receipt --verify <head>` changes nothing. The argument may be a full commit sha or a ref (`HEAD`, a branch or a tag), resolved to the commit with `git rev-parse --verify <arg>^{commit}` before the receipt lookup; an unresolvable argument fails with the same missing-receipt shape. It succeeds only when the receipt exists, is PASS, the current HEAD is still that head, and every cited file still hashes to the recorded sha256. A receipt is written only after a judge pass, so it reads schema 2 only: any other receipt (one recorded without the judge, or by an older build that let a run past its gate) fails as malformed, and a schema 2 receipt needs a well-formed `judge` block whose every verdict is `pass` for a cited file with the same sha256, which the result shows, and `runs` that are not all code-only ([Real-product evidence](#real-product-evidence)) and carry a step record covering the claim ([Step record](#step-record); a run recorded before step records passes with a `warnings` entry); a receipt with no `runs`, written before that rule, fails: re-run `receipt` for the head. A receipt from `--from` (or a `verify` run that drove the skill) also records the verify skill that ran as `skill` (for example `done-done-verify-<app>`), which `--verify` and so the merge gate show; an older receipt without it still verifies. A missing or malformed receipt and a hash mismatch are failures (exit 1), not usage errors. When the mismatched path is named in a run record, the failure names it as `changed after run <run-id>`.

### Verify a change in one run

```sh
done-done verify [<journey>] --outcome "<what a user can now do>"   # --no-wait, --wait (the default), or --foreground (for scripts)
done-done verify --outcome "<claim>" [--feature <name>]             # no journey: the author agent drives a verify skill feature
done-done respond [--run <run-id>] --action fix | --action approve|skip --reason "<why>"   # answer a run at its gate (approve: a spend gate only)
done-done status [--run <run-id>]                                   # the newest run of this checkout by default
done-done attach [--run <run-id>]                                   # stream the run's events to stderr until it ends, then show it
done-done logs --step <name> [--run <run-id>] [--full]              # one step's log, the last 50 lines unless --full
done-done rerun [--run <run-id>] [--wait | --no-wait]               # a new run of the same journey, from the failed step
done-done abort [--run <run-id>]                                    # stop a live run and its journey
done-done history [--limit <n>]                                     # this checkout's runs, newest first
```

`verify` writes `$DONE_DONE_HOME/runs/<app>/<run-id>/run.json` (schema 2), then starts a detached runner that drives the journey, checks the files it wrote and records a receipt (steps `resolve`, `drive`, `check`, `judge`, `triage` and `fix` (with `auto_fix.verify` above 0, see [Fix the product](#fix-the-product)), `gate`, `receipt`, `report`; `judge` always runs (it is skipped only after a failed check, which stops the run with its causes and no verdict), and its output goes to `logs/judge.log`; a judge that fails stops the run at its judge step with the cause (exit 2), and no receipt; with no judge set, `verify` asks for one or exits 2 before it starts a run, as in [Judge relevance](#judge-relevance)). The runner goes on when the command or shell that started it ends. It writes its pid, the journey's and the instance's process groups and a heartbeat to `run.json`, each step to `events.jsonl`, and step output to `logs/`. `run.json` keeps the run's inputs and step state; the head, tree, dirty flag and evidence come from the evidence run record it points to. `verify` waits until the run ends (`--wait`, the default), then prints it like `status`; `--no-wait` returns at once. A journey still running after `journeys.<name>.timeout` (default `30m`, e.g. `90s`) is killed with everything it started, and the run ends inconclusive (exit 3) with `journey timed out after <timeout>`. `status` only reads the store, except that an open run whose runner is gone (its pid is no longer alive, or it never wrote a pid and is still open after 60 s) is shown as `failed` at the step it was on and its journey's and instance's process groups are killed once (`journey.killed` and `instance.killed` markers in the run folder keep later reads from signalling again). Runs are stored per app, shared by every checkout of it; `status` shows the newest run of the current checkout and names its `repo`. `status --run <id>` also shows an evidence run record that `run` printed (its commit, dirty flag and files) when no verify run has that id.

`attach` prints each new event line to stderr while the run goes on, and exits when the run ends or its runner is gone. The step names for `logs --step` are the run's steps (`resolve`, `drive`, `check`, `judge`, `triage` and `fix` (when `auto_fix.verify` is above 0), `gate`, `receipt`, `report`; a `maintain` run has `locate`, `hygiene`, `source-wave`, `reconcile`, `report`, plus `triage` and `fix` when `auto_fix.maintain` is above 0).

#### Drive by agent

With no journey named and none configured (or with `--feature`), the drive step has the author agent (the `agent:` you set; with none set, `verify` asks as described in [Agents](#agents)) drive one feature of the verify skill the way a user does. It reads the skill's `SKILL.md` and `features/<name>.md`, launches the app, drives that feature, saves PNG screenshots of the resulting state (or, when the outcome shows in text, the CLI output, log or JSON as a text file) into the run's evidence folder (`$DONE_DONE_EVIDENCE_ROOT`) and stops what it started. The judge checks every capture there against the outcome, so the agent is told to keep captures of earlier steps (an empty or half-filled form, or text from before the outcome) in its scratch folder. `--feature <name>` picks the feature; without it, the only feature is used, or with several the agent picks the one the outcome is about and the run records it. The claim and the recipe paths go to the agent on stdin or in a prompt file, never in argv. The agent is told to follow the recipe and never add steps or data to make the outcome look true.

- **Scope.** The drive runs under the agent's own approval policy, in the repo, with the CLI scope listed below (the run's evidence folder and its scratch folder (`<run>/tmp`, also `$TMPDIR`) where that CLI can limit access to them): claude with `--permission-mode acceptEdits --allowedTools Bash --add-dir`, opencode with `OPENCODE_PERMISSION` allowing every folder outside the repo except your home folder, where only the run's evidence and scratch folders are allowed again (opencode's own data folder, its login and database, is always denied; a headless `opencode run` cannot answer a permission ask and auto-rejects it, so the drive would end with no answer, and done-done then names the refused permission), gemini with `--approval-mode auto_edit --allowed-tools run_shell_command --include-directories`, codex with `--sandbox workspace-write --add-dir`. Only codex sandboxes its shell. Each codex command runs in its own process namespace, so a server or browser bridge it starts in the background ends with that command; done-done's prompt tells codex, for every edit step (a drive, a maintain fix), to start what it needs, use it and stop it within one shell command. Its commands write only the repo, the run's evidence and scratch folders, `$TMPDIR` and `/tmp`, so a recipe tool that keeps state elsewhere fails under codex until you add that folder with `agent_args_override.codex: [--add-dir, <absolute folder>]`, and the drive's agent can then write there too. chrome-devtools-axi keeps its state in `~/.chrome-devtools-axi`, and without a local chrome-devtools-mcp it runs `npx -y chrome-devtools-mcp@latest`, which writes the npm cache: install chrome-devtools-mcp to a fixed prefix (`npm install --prefix <folder> chrome-devtools-mcp`), set `CHROME_DEVTOOLS_AXI_MCP_PATH` to its `build/src/bin/chrome-devtools-mcp.js`, and add only `<home>/.chrome-devtools-axi`. Adding `<home>/.npm` instead also works, but the agent can then change the packages npx runs later outside the sandbox. Codex's commands also cannot see your other processes, so a chrome-devtools-axi session you already use (the default one included) looks dead to them: the drive clears that session's page and collides with its bridge on its port, and fails with `No page is currently selected` or hangs. Give each drive a session of its own in the recipe, in the shell command that drives the browser: `export CHROME_DEVTOOLS_AXI_SESSION=done-done-$DONE_DONE_RUN_ID` (each run leaves a small folder under `~/.chrome-devtools-axi/sessions`). Elsewhere the drive's shell is not sandboxed: claude's Bash and gemini's run_shell_command can run any command the user can, and done-done only checks tracked files afterwards. The drive's environment sets `DONE_DONE_DRIVE` to its run id, and `respond`, `receipt`, `verify`, `rerun` and `maintain` exit 2 while it is set. That keeps the agent from answering its own gate, writing a receipt or starting a run by accident, and nothing more; it is not a sandbox: the drive's shell is not sandboxed, so an agent can unset the variable (`env -u DONE_DONE_DRIVE`) and then answer a gate or write a receipt, logged under the git user, or write the run or receipt files by hand. Pi has no permission gate, so doctor warns (`tool_gate`). An `acp:<target>` agent cannot drive (done-done runs ACP agents with every tool denied): `verify` exits 2. A drive that changes a tracked file in the repo fails, judged by the content of the tracked diff, so an edit to a file that was already modified before the drive counts too. The agent's output is capped at 64 MiB; past it the call is killed and the drive fails.
- **Bounded.** The agent runs in its own process group, bounded by `agent_timeout` (30m by default); the group is killed when the drive ends or times out. If the runner dies mid-drive, the group is killed the next time `status`, `abort` or `rerun` reads that run, as for journeys.
- **Judged.** The judge the user set (any agent and model, the author's own too, in a fresh session, as in [Judge relevance](#judge-relevance)) judges each capture; nothing turns it off. A drive that reports a blocker or saves nothing the check accepts fails. A capture the judge did not read (a video or other file, anything but PNG, JPEG or text) parks the drive at the gate; a drive where no capture could be judged stops with exit 2, as a check does, so a passing judge never covers an unread capture.
- **Recorded.** The call goes to `agents/drive.json` (no prompt text), and the agent's answer (feature, captures, blocker) to `logs/drive.log`.
- **Usage errors (exit 2):** no verify skill, an unknown `--feature`, a journey and `--feature` together, no agent set outside a terminal, or an agent that cannot be started. A verify, rerun or journey run that stops before its judge (a plain check that fails, `not proven`, no capture the judge reads) or whose judge errors also exits 2: its run record keeps the cause and its status reads `failed`.

#### The gate and respond

When the judge says `fail` or `unsure` for a capture (or an agent drive has a capture the judge did not read, or no judged capture), the run parks at its `gate` step: `status: awaiting_approval`, exit 4, with one `ask-user` finding per problem (`gate-1`, ...). The runner exits; the run waits until someone answers it with `respond`:

- `--action fix`: end the run `fail` (exit 1), with no receipt; fix the product or the verify skill's recipe (`done-done maintain` checks the skill against the source), commit, then `rerun`.
- `--action skip`: end the run `fail` (exit 1) without the fix, at a spend gate or at the judge gate; the reason says which was skipped.

Fix and skip are the answers at the judge gate: nothing moves a run past its judge, and no receipt is ever written without a judge pass. `--action approve` there exits 2 and leaves the run parked (it answers only a spend gate, see [Journeys that spend](#journeys-that-spend)). The answer is logged in `events.jsonl` (`step: gate`, the action and who answered (git `user.name`, else the OS user)) and kept in `run.json` as `response`. A run is answered once (a second `respond` exits 2). `abort` cancels a parked run. While a run waits at its gate, `verify` and `rerun` of the same claim (its `--claim-id`, else the branch it started on) in the same checkout exit 2, naming the waiting run and its `respond` and `abort` commands, so a new run never goes around the gate. A run waiting with neither key, recorded by an older build in the same checkout, blocks every `verify` and `rerun` there until it is answered or aborted. A run record that cannot be read or parsed stops `verify`, `rerun`, `status`, `respond`, `abort` and `history` (exit 2), naming the file to fix or remove.

#### Fix the product

`auto_fix: { verify: <n> }` (global or `.done-done.yaml`, as for maintain) lets done-done fix a failed verify with your agent up to n times; 0, the default, reports only. It needs the agent and the judge the user set (an `acp:<target>` agent cannot fix, exit 2); the judge may be the fixer's own agent and model, in a fresh session. Only a product failure is fixed: a journey that exited non-zero, an agent drive the product stopped (its blocker), or screens the judge calls wrong. A timeout, a secret, a check failure or a journey that spends is not.

- `triage`: the judge gets each wrong screen with the outcome: does the product miss a clear claim (fix), or may the claim be wrong, unclear or need a product decision (ask)? Any ask or unsure answer parks the run at the gate with every wrong screen and its class (`triage: fix` or `triage: ask`), and nothing is fixed. A mixed judge result (wrong screens plus unsure or unread captures) is never fixed either: the judge sorts the wrong screens, then they all park at the gate. Each sort is recorded in `agents/triage.json` (`triage-fix<k>.json` after attempt k, `triage-gate.json` for a mixed result after a fix).
- `fix`: an uncommitted change to a tracked file ends the run `blocked` with `dirty:` first, since the fix starts from the committed head. The agent then edits the product in a done-done worktree at that head (`<run>/fix`, detached), never in your checkout. Your checkout's ignored files (`node_modules`, `.env.local`; not done-done's own evidence root or `DONE_DONE_HOME`) are copied into it, and copied again over anything the agent did to them before each re-run, so the re-run sees the fix commit with your own ignored files. A fixer's edit to a still-ignored copied file is never committed and is copied over before the re-run. Plain code drops the attempt and ends the run `blocked` when the agent changes the verify skill, `.done-done.yaml`, a test file or a test-runner config, un-ignores a copied file of your checkout, makes a commit, changes your checkout (done-done's own folders in it, such as an in-repo evidence root, do not count), changes nothing, reports a blocker, or a copy of your ignored files into the worktree fails. Copies that are still ignored are removed from the worktree when the fix ends, whatever its result; a copy the fixer un-ignored is dropped with the attempt and stays only until the worktree is removed. Otherwise done-done commits the change and verifies again in the worktree: the fixer's call is `agents/fix-<k>.json`, the re-run's drive log `logs/fix<k>drive.log` and its run record `<run-id>-fix<k>`. A pass ends `changed` (exit 1, since your HEAD still fails) with the fix on a `done-done/verify-<run-id>` branch and a receipt for its commit; a re-run that parks at the gate keeps the branch. Still failing: the next attempt starts from the new failures, sorted again; when all n are used, the run is `blocked` (exit 1). `logs --step fix` shows each attempt.

#### Secrets in the evidence

After the drive, whether it passed or failed, and before the check, `verify` scans the run's text evidence (files with no NUL byte in their first 8 KB, so images are skipped) and the run folder's `logs/` and `agents/` for secrets: private key blocks (`private-key`), GitHub tokens (`github-token`), well-known key prefixes such as `sk-`, `AKIA`, `AIza`, `xox?-`, `glpat-` and `npm_` (`api-key`), `Bearer` headers (`bearer`), a `key`, `token`, `secret` or `password` name set to a value of 8 or more characters with no spaces or quotes, and an `auth` name set to a value of 24 or more characters with letters and digits (`key-value`). `secrets.patterns` in `.done-done.yaml` adds named regexes. A match that any `secrets.allow` regex matches is known-safe and skipped. Any other hit fails the run (exit 1) with `secrets: <file>:<line>: holds a secret (<pattern>)`: at `check` when the drive passed, and on a failed drive as `drive: secrets: <file>:<line>: holds a secret (<pattern>)`, which replaces the drive's own reason so no agent or instance text that could hold the value is printed. The file, line and pattern name are shown, never the value. A run whose logs hold a secret gets no fix agent. Remove the secret from the journey or app output and run again.

#### Journeys that spend

A journey with `spends: "<what a run spends>"` (for example `one live generation`) never runs until the user approves spending for that run. `verify` parks it before the drive: `status: awaiting_approval` at the `drive` step, exit 4, with one `ask-user` finding `spend-1`, and help that says to ask the user. `respond --action approve --reason "<who approved the spend>"` records `spend` (who, why, when) in `run.json`, then runs the journey and the rest of the run as usual, waiting like `verify`; `--action skip` ends the run `fail` with nothing spent; the gate takes only `approve` or `skip` (exit 2 otherwise). `run <journey>` refuses such a journey (exit 2, nothing runs) and prints the `verify` command that asks the user. Every new run asks again, `rerun` included, unless it reuses the source's drive. With `auto_fix.verify`, a failed spending run is not fixed or re-run, so one approval pays for one run; its reason says so. With a `matrix` block, the approval covers every required cell of that run, and the park names how many cells (it runs once per cell). A journey without `spends` is unchanged.

`rerun` starts a new run of the same journey and leaves the source run as it was. It reuses `resolve` when HEAD, the journey command and the verify skill are unchanged, and `drive` too when the source's drive record is clean and bound to that HEAD and the `inputs` patterns are the same as the source's ([Input guard](#input-guard)); every other step runs again, the judge included. It refuses a source run that is still pending or running (exit 2), one whose journey's process group is still alive, a `maintain` run (exit 2; start a new one with `done-done maintain`), and any claim with a run waiting at its gate in the source's checkout (exit 2, as above). `--wait` (the default) waits for the new run and prints it; `--no-wait` returns at once, with exit 4 while the run is still running.

`abort` kills the runner's process group (a `maintain` run's agent calls run in it, so they stop too), then its journey's process group, and marks the run `cancelled`; `status` shows a cancelled run as failed (exit 1), with the step that was running marked `cancelled`. It exits 0 when it cancelled the run. A run that had already ended, or whose runner pid cannot be confirmed as this run's, is left alone and exits 1.

### Send a run to sign-off

```sh
done-done signoff [--run <run-id>]   # writes the message; never posts it
done-done signoff --post [--board <file>]   # posts it to the board and records the card on the run
done-done signoff --wait [--timeout <duration>]   # waits for the answer to that card and feeds it back to the run
npx -y sign-off-axi post --kind <gate|evidence> --from <file>   # the command signoff prints
```

`signoff` writes one message in the [sign-off contract v1](https://github.com/umeranjum17/sign-off/blob/main/docs/contract.md) shape. A run waiting at its gate gets a `gate` (`<run>/signoff-gate.json`): key `dd-gate-<run-id>`, the first finding as `about` (its evidence folder is stripped, so it names the capture file), `run` with `run_id` and `commit`, options `approve` (Approve) and `skip` (Skip the judge) on a spend gate, or `fix` (Fix first) and `skip` (Skip the judge) on the judge gate, and `recommend_value` `approve` on a spend gate, else `fix`. The board's answer is `done-done respond --action <value>`. A finished run with captures gets an `evidence` (`signoff-evidence.json` in the evidence folder of the run that made the captures, the source run for a rerun that reused its drive, the fix pass for a run `auto_fix.verify` fixed): key `dd-evidence-<run-id>`, the outcome as `about`, up to 12 PNG, JPEG, WebP, MP4 or WebM captures as `media` (paths relative to that folder) and `run` with `run_id`, `commit` and the four Checks lines (`repro` is the `done-done verify` command that made the run, at its commit, and on the fix branch when a fix pass made it). Both have `filer: done-done`. Every value is checked against the contract's limits first; one that breaks them (an outcome over 500 characters, a capture changed since the run) exits 2 and writes no file. done-done works the same without sign-off.

**Posting it (the opt-in).** Nothing is posted unless you ask for it: `done-done signoff` only writes the message and prints the post command. `done-done signoff --post` posts that one message; `signoff.post: true` in `.done-done.yaml` posts every run's message. done-done posts through `sign-off-axi` (the board's own CLI, `npm install -g sign-off-axi`); it never writes a board itself, and a missing `sign-off-axi` is a usage error, never a silent skip. `--board <file>` (or `signoff.board` in `.done-done.yaml`) names the board file; without it, sign-off-axi picks the nearest `.sign-off/` board. The card the board made is recorded on the run (`signoff.key`, `signoff.board`, `signoff.file`), so `done-done status --run <id>` shows the card the claim went to.

**The answer comes back.** `done-done signoff --wait` waits for the answer to that card (`--timeout`, 10m by default) and feeds it to the same run: a gate's `approve`, `skip` or `fix` does exactly what `done-done respond --action <value>` does, so an approved spend runs the journey and a fix or a skip ends the run fail. The answer is recorded on the run (`signoff.answer`) with the note the person wrote. An evidence card's verdict (Pass, Fail or Needs work) is recorded, not acted on: that run has already finished. Without the opt-in `--wait` only reads a card the run already posted; it never posts one.


### Keep the verify skill true

```sh
done-done maintain        # --no-wait, --wait (the default), or --foreground (for scripts)
```

`maintain` checks the repo's verify skill against the source in a run of kind `maintain`, in the same store as `verify`, so `status`, `attach`, `logs`, `abort` and `history` work on it. Its pass reads only: it never edits the skill, the product code or git, and it records HEAD, `git status --porcelain --untracked-files=all` and the content of each changed or untracked path (regular files are hashed with sha256 as they are read; symlinks are compared by target text and never read through) before and after; if they differ, the run is `blocked` with a `repo-changed` finding. Its steps:

- `locate`: the verify skill (`skill`, default `.agents/skills/done-done-verify-<app>`) must have a `SKILL.md`; with none, the run ends `blocked` and points at `done-done init`.
- `hygiene` (plain code): every local markdown link in the skill must resolve (`dead-link`); `features/README.md` must exist (`index`), list each `features/*.md` file (`unlisted`) and list it only once (`duplicate`).
- `source-wave`: one fresh reader per feature file, at the configured agent (`agent`, `agent_config`). Every reader except claude's gets no tools (pi `--no-tools`, opencode and acp with every tool denied); codex and gemini cannot read tool-less at all, so `maintain` never runs without a reader: an agent that cannot read tool-less, or that done-done cannot start, stops it before any run with exit 2 and the reason (use claude, opencode, pi or acp). Where readers run, plain code puts the feature file and the text of each tracked file it cites into the prompt, each file capped at 20,000 characters (a cut file is marked `[truncated after 20000 characters]` in the prompt, with no finding of its own) and all of a feature's cited text at 60,000 characters, with one `truncated` notice naming the feature and the cited files left out when any are dropped. Only claude readers get read-only tools in the repo (`--tools Read,Grep,Glob` with `--setting-sources ''` and `--strict-mcp-config`, so no user settings or MCP servers load): a live probe showed opencode reads through an in-repo symlink to an outside target, while claude refuses it. Each reader explains the feature from source and returns its drift (each statement the source contradicts, with the source file:line) and one live recipe. Readers run one after another; a run makes at most 30 recorded agent calls, each bounded by `agent_timeout`; a tool-less call that does not answer valid JSON is tried up to three times in all within its record, so a run starts at most 90 agent processes. A feature file longer than 20,000 characters is read only up to that cap, and a `truncated` notice names it; the notice is listed but does not make the result `drift`. A symlink on the skill path (the skill folder, its features folder, the index or a feature file) is a blocking `coverage` finding and is never read, so a committed link cannot send a file outside the repo to the agent; a skill reached through a symlinked ancestor is refused at `locate`. Readers cannot read outside the repo: claude runs without `--add-dir` or a permission bypass, so reads outside its working directory are refused.
- `reconcile`: the tool-less call names at most 500 recently changed paths, most recent first, and says how many older ones it left out (those get no `unmapped` check). Plain code checks each `path:line` the skill cites (`citation`) and each file:line a reader cites. A bare file name (`app.js:50`) is checked against the tracked files whose path ends with it, and the line must exist in one of them; no tracked match is a finding. A repo path (`src/app.js:50`) must be a tracked file too, so an untracked or ignored file is a citation finding in the skill and an unverified drift in a reader's answer. A bare name is a citation only when its extension is one that a tracked file has, so host:port text such as `api.example.com:8443` is ignored. A reader's drift cites files the same way, and its drift becomes a `drift` finding only when its citation exists, and unverified citations are listed under `unverified` in the run's status (and in the step log), with a count and the first few. An answer item in an unexpected shape, or a list field that is not a list, is listed there too and never trusted. One tool-less call merges the recipes into as few app states as it can and names files changed in the last 30 days (`git log`, outside the skill folder) that no feature covers; each one that is in that list becomes an `unmapped` finding. maintain gives no result without its readers: with no agent set it asks, as in [Agents](#agents). Gemini cannot be a reader yet: its no-tools mode is read-only plan mode, not tool-free, so `maintain` with gemini stops with exit 2 before any run.

The result is `clean` (no findings but notices, exit 0), `drift` (findings to fix by hand, or with `auto_fix`, exit 1), or `blocked` (no skill, a skill path that is a symlink or cannot be read, a reader that did not answer, more feature files than the call cap, or a repo that changed; exit 3). A blocked run still lists the findings from the plain checks it finished. `status` lists the findings (`--full` for all of them), each with an id, kind, file, line and what is wrong. Each agent call is recorded in `agents/<n>-<name>.json` in the run folder, without the prompt text; the readers' answers are in `logs/source-wave.log` and the merged recipes in `logs/reconcile.log`.

**Fix (`auto_fix`).** `auto_fix: { maintain: <n> }` (global or `.done-done.yaml`, merged step by step; the key and shape are no-mistakes' `auto_fix`) lets done-done fix a `drift` result up to n times; 0, the default, reports only. It needs the agent and the judge the user set, so with none set `maintain` asks in a terminal or stops with the command that saves the user's choice; the judge may be the fixer's own agent and model, in a fresh session. An `acp:<target>` agent cannot fix, since its tools are denied. Each attempt adds two steps:

- `triage`: one tool-less request to the judge (through the same BYOKit route that judges captures) with each `drift` finding, its feature file and about 20 lines of the cited source around the cited line: is the skill out of date, or may the product be wrong? Plain-code findings (`dead-link`, `index`, `unlisted`, `duplicate`, `citation`) and `unmapped` surfaces are skill gaps and are not asked. A finding the judge calls a product problem, or is not sure about, gets `action: ask-user` and ends the run `blocked`, with the reason starting `ask-user:`: the user decides, and maintain never edits product code.
- `fix`: the agent the user set gets the findings and edits the skill folder in a done-done worktree at HEAD (`<run>/fix`, detached), never in the user's checkout. A skill folder with uncommitted changes in the checkout is refused first, and so is any uncommitted change to a tracked file: the drift was found in the working tree, so a fix at HEAD would not match it; the run then ends `blocked` with a `dirty` finding that names the files (commit them, or set `auto_fix.maintain: 0`). Then plain code checks the attempt: any path changed outside the skill folder (tracked, new or ignored), a commit by the agent, or any change to the user's checkout ends the run `blocked`, and the attempt goes away with the worktree. Otherwise maintain runs its pass again in the worktree (records `agents/fix<k>-<n>-<name>.json`): clean ends the run `changed`: done-done commits the skill folder there and points a `done-done/maintain-<run-id>` branch at that one commit (your branch and checkout are untouched; `status` shows `fix` with the branch, commit, files and attempts; exit 0). Still `drift`: the next attempt starts from the new findings; when all n are used, the run is `blocked` with the findings that remain and no branch. The worktree is always removed; `logs --step fix` shows each attempt's summary, changed files and re-run result.

### Output

Every command prints one machine-readable result on stdout. By default it is [TOON](https://github.com/toon-format/spec) in the AXI convention (the shape `no-mistakes axi status` uses): scalar `key: value` lines, tabular arrays, and a `help` list that names the exact next command. `--json` prints the same result as JSON. `--full` lists every evidence file or finding; without it, lists longer than five rows are truncated and the count of dropped rows is reported (`evidence_omitted`, `findings_omitted`, `history_omitted` or `log_omitted`). `doctor` always lists every check: its rows (eight checks, nine with --probe, plus `tool_gate` when the agent is pi or codex) never truncate.

Running `done-done` with no subcommand prints the repo's config state (`config: present | missing | none`), its journeys, its run count (the runs `history` lists), whether `HEAD` has a valid receipt (`receipt: valid for HEAD <sha>`, or why not), when the proof is not fresh the journeys the change still needs (`affected`, see [Affected journeys](#affected-journeys)), and the next step; with a valid receipt that covers them the next step is to prove the next commit. `done-done --version` prints the version. Usage and config errors also print one result: the `command` that failed, an `error` field and a `help` line with the recovery command (for example `done-done init` when no config exists, or the command's valid flags after an unknown one).

`done-done --help` lists every command. `done-done <command> --help` (or `-h`) prints that command's usage lines and flags in the same shape for every command (plus the journey format for `init` and `run`, and the Checks block for `check` and `receipt`), and exits 0.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | pass |
| 1 | fail |
| 2 | usage or config error |
| 3 | inconclusive (could not be proven either way) |
| 4 | the run is still running, or a `verify` run waits at its gate (`verify`, `maintain --no-wait`, `rerun`, `status`, `respond`) |

`doctor` exits 2 when a required item (`git`, `config`, `evidence_root`, `real_product`, `core_journey`, `upgrade_journey`, `agent`, `judge`, and `probe` with `--probe`) is missing.

### Merge gate on the desktop

```sh
PR_BRANCH="$(gh pr view "$PR_URL" --json headRefName --jq .headRefName)"
done-done check --from "$PR_URL" --trusted-ref origin/main
done-done receipt --from - --trusted-ref origin/main --claim-id "$PR_BRANCH" < pr-body.md   # record the pass
done-done receipt --verify "$HEAD"                                   # re-verify later
```

Run `receipt --verify` with that head checked out and the evidence root in place (see below). `--trusted-ref` reads `.done-done.yaml` from that ref instead of the PR branch. This matters because repo keys can loosen the bar and journeys run commands. `check --from -` and `receipt --from -` read the `## Checks` block from stdin, so a script can pipe the pull request body straight in.

### CI gate

A hosted runner has no model and never gets a model key, so CI never runs `check`, `run` or `verify`. Proof runs on the desktop. CI runs one no-model command, `done-done gate`, which reads git objects only: no config, no judge, no key and no evidence files.

```sh
# on the desktop, after the proof passes for <head>
done-done receipt --from checks.md --claim-id "$BRANCH"        # writes <evidence root>/.done-done/receipts/<head>.json
mkdir -p .done-done-receipts && cp <that receipt> .done-done-receipts/
git add .done-done-receipts && git commit -m "chore: receipt for <head>" && git push

# in CI (checkout with fetch-depth: 0, so the receipt head is in history)
npx -y done-done-axi gate "$PR_HEAD_SHA"
```

The receipt is committed in a follow-up commit, because a receipt cannot sit inside the commit it proves (its hash would change). `gate [<head>] [--dir <folder>] [--pushed <time>]` prints `PASS` or `FAIL: <reason>` and exits 0, 1, or 2 on a usage error. It passes when a receipt in `.done-done-receipts/` (or `--dir`):

- is a well-formed pass from a judged run (the same shape `receipt --verify` requires, so its `runs` are not all code-only, see [Real-product evidence](#real-product-evidence), and carry a step record covering its claim, see [Step record](#step-record)) and is filed as `<its head>.json`;
- has a head that is `<head>` (default `HEAD`) or an ancestor of it, with every file changed since that head inside the receipts folder, so the proof still covers the code;
- was made no later than the push (`--pushed`, an ISO time; default the commit time of `<head>`), compared to the second.

A receipt whose runs were recorded before step records passes with `WARN: ...` lines after `PASS`. `gate` trusts the committed JSON: it does not re-hash the evidence, which only `receipt --verify` can do, on the machine that holds it. It says so by name and does not claim more.

### Where proof lives

Evidence, run records (`<root>/.done-done/runs/`), receipts (`<root>/.done-done/receipts/<head>.json`) and the reuse ledger (`<root>/.done-done/ledger`) all live in the evidence root. By default that is `~/.done-done/evidence/<app>`, outside the repo, so they outlive the checkout that captured them: any checkout of the same repo on the same machine (a fresh clone, a merge gate's checkout) with `<head>` checked out runs `done-done receipt --verify <head>` and finds the same receipt and files. A checkout of a later commit, such as the merge or squash commit on main, does not verify: the receipt is for `<head>` only.

- **Same machine** (a merge gate, a fresh clone): check out `<head>`, nothing else. Every checkout reads the same `app` from the committed `.done-done.yaml`, so it resolves the same evidence root. Keep `app` pinned (`init` writes it); without it the app is the directory name, which differs between clones. Receipts are named by the full head sha, which is the same in every clone, shallow or not, so no repo commit is needed in the key, and a receipt verifies only where that commit is checked out.
- **`evidence.root` inside the repo** (an older `root: .proof`): still works, but the evidence is gitignored and goes away with that checkout, so only that checkout can re-verify.

## Config

There are two files. Unknown keys are an error in both.

**Global:** `~/.done-done/config.yaml`. Override the location with `DONE_DONE_HOME`. `done-done init` writes it, commented and at these defaults, when there is none, and never overwrites it. The agent keys have the same names, meanings and scopes as no-mistakes' global config.

```yaml
# agent: opencode                     # claude, codex, opencode, pi, gemini or acp:<target>, set by you (init --agent) and unset until then; .done-done.yaml may override it
agent_config:                         # model and effort per agent; global only
  claude: { model: claude-haiku-5-5, effort: low }
  opencode: { model: opencode-go/muse-spark-1.3-contributor, effort: low }
  gemini: { model: flash-lite }       # gemini has no effort flag
  # codex: { model: <model> }         # codex and pi have no cheap default: they run their own until you set one
agent_args_override: {}               # extra CLI flags per native agent, e.g. claude: [--permission-mode, plan]; codex: [--add-dir, <folder>] lets a codex drive's recipe tool write there (see Drive by agent, Scope)
agent_path_override: {}               # a binary per native agent instead of PATH, e.g. claude: /opt/claude/bin/claude
acpx_path: acpx                       # the acpx bridge for acp:<target>: a name on PATH or an absolute path
agent_timeout: 30m                    # one agent call: 90s, 30m or 1h
auto_fix:                             # per step, as no-mistakes; .done-done.yaml may set it too
  maintain: 0                         # times the agent may fix the verify skill; 0 reports only
  verify: 0                           # times the agent may fix the product after a failed verify; 0 reports only
evidence:
  local_root: ~/.done-done/evidence   # evidence root for repos that set none (<local_root>/<app>)
judge:                                # done-done's own judge; check, receipt, verify and design always start it
  # route: claude-code                # claude-code, answerer:<agent> (opencode, pi, gemini) openai:key (reads OPENAI_API_KEY) or minimax:key (reads MINIMAX_API_KEY, claude-code fallback), set by you (`init --judge` saves the first three; a key route is set by hand) and unset until then
  model: ''                           # default: that agent's agent_config model, or openai-codex/gpt-6-luna for pi
  floor: 0.7                          # every judge's pick must reach this probability to count; below it the verdict is unsure (inconclusive), never a pass
  # env_file: ~/.config/done-done/judge.env  # KEY=value lines (a provider API key) handed to the judge for names your shell has not exported; the key stays in that file
```

An `agent_config` entry merges with the defaults field by field, so `claude: { model: claude-sonnet-5-5 }` keeps `effort: low`; the other maps merge entry by entry. `done-done doctor` shows which file set each agent setting.

**Project:** `<repo>/.done-done.yaml`.

| Key | Default |
|---|---|
| `app` | repo directory name |
| `skill` | `.agents/skills/done-done-verify-<app>` |
| `journeys.<name>.command` | none |
| `journeys.<name>.spends` | none; what a run of the journey spends, so `verify` waits for the user approval, see [Journeys that spend](#journeys-that-spend) |
| `journeys.<name>.core` | false; `true` marks the core user journey, see [Core journey and release path](#core-journey-and-release-path) |
| `journeys.<name>.upgrade` | false; `true` marks the upgrade-in-place journey, see [Core journey and release path](#core-journey-and-release-path) |
| `secrets.patterns`, `secrets.allow` | `{}` and `[]`; extra `<name>: <regex>` secret shapes and known-safe regexes, see [Secrets in the evidence](#secrets-in-the-evidence) |
| `journeys.<name>.timeout` | `30m`; a positive duration such as `90s` or `30m` (up to about 24 days), used by `verify` |
| `instance` | none; the app under test started per run, see [Run-instance harness](#run-instance-harness) |
| `matrix` | none, so each journey runs once; `theme`, `width`, `form` and `skip` set the [capture matrix](#capture-matrix) |
| `dom` | none; page-check records per capture, see [DOM assertions](#dom-assertions) |
| `inputs` | `[]`; repo-relative paths or globs the drive must leave alone, see [Input guard](#input-guard) |
| `base_ref` | none; a ref `verify` also drives, pairing its captures with the head's, see [Base-ref before](#base-ref-before) |
| `evidence.root` | `<local_root>/<app>`, outside the repo. A relative path is under the repo; an absolute path is used as-is |
| `evidence.allow_dirty` | `false` |
| `evidence.ignore_paths` | `[]` |
| `checks.fix_title` | `^(fix\|bugfix\|hotfix)\b`: titles that need a repro |
| `checks.upstream_catch_up` | `false`; `true` lets `lint` subtract a fork's upstream catch-up lines from the size count, see [Lint check](#lint-check) |
| `checks.generated_paths` | `[]`; globs `lint` counts as generated beside lockfiles, `vendor/`, `dist/` and `LICENSE`-type files, see [Lint check](#lint-check) |
| `checks.moved_from` | `false`; `true` lets `lint` subtract lines a PR moves from another repo of the same owner, see [Lint check](#lint-check) |
| `signoff.post` | `false`; `true` lets every `signoff` post its message to the sign-off board, see [Send a run to sign-off](#send-a-run-to-sign-off) |
| `signoff.board` | none; the board file to post to, else the nearest `.sign-off/` board sign-off-axi finds |
| `agent` | as in the global file; set here, it wins |
| `auto_fix.maintain` | as in the global file (`0`, report only); set here, it wins |
| `auto_fix.verify` | as in the global file (`0`, report only); set here, it wins |

**Precedence:** built-in defaults, then the global file, then the project file.

Global-only keys describe the machine. Project-only keys describe the project. Setting a global-only or project-only key in the wrong file is an error (exit 2), not something silently ignored.

