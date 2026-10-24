#!/usr/bin/env node
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { accessSync, appendFileSync, closeSync, constants, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { basename, dirname, isAbsolute, join, matchesGlob, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { encode } from '@toon-format/toon';
import { Document, parseDocument } from 'yaml';
import { ACPX_INSTALL, agentChoices, agentPath, agentRun, askAgent, findBin, JUDGES, modelFor, noAgent, noJudge, notStartable, routeOf, selectAgent, selectFallback, selectJudge, toollessReason } from './agents.js';
import { AGENTS, CHEAP, INTERACTIONS, globalConfigText, home, inputPattern, isAgent, isJudgeRoute, loadConfig, parseDuration, tilde, UsageError } from './config.js';
import { backend, judge, judgeable, onPath, quote, screen } from './judge.js';
import { startInstance, stopInstance } from './instance.js';
import { attemptProblem, changedSince, commitFix, dirtyTracked, FIX_SCHEMA, inWorktree, maintainSteps, journeyProposal, named, pathspec, readerProblem, repoState, triage } from './maintain.js';
import { cellEnv, cellName, cellSuffix, hasMatrix, matrixManifest, splitMatrix } from './matrix.js';
import { design, interactions, KINDS } from './design.js';
import { checkMedia } from './media.js';
import { domIssues, domRecord, isDomRecord, lookIssues, SQUASHED_TEXT } from './dom.js';
import { lint } from './lint.js';
import { look } from './look.js';
import { scanSecrets } from './secrets.js';
import { mapChange } from './affected.js';
import { codeOnly, codeOnlyJourneys, configFault, MARK, namedJourney, releaseArtifacts, RULE, runsFault, STEPS_FILE, STEPS_SHAPE, stepRecordFault, stepsFault } from './proof.js';
const PASS = 0, FAIL = 1, USAGE = 2, INCONCLUSIVE = 3, WAITING = 4;
const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const PRE_RELEASE = /^[^+]*-/.test(VERSION);
const HELP_HEADER = `done-done ${VERSION}${PRE_RELEASE ? ' (pre-release)' : ''}`;
// The shape of a journey, so a new user or agent can write one without opening the reference.
// done-done sets DONE_DONE_EVIDENCE_ROOT (the run's own folder) and replaces ${RUN_ID}, so the example works for any evidence root.
const journeyExample = 'journeys: { smoke: { command: "<drive the core user journey on the real app> > $DONE_DONE_EVIDENCE_ROOT/${RUN_ID}.log", core: true } }';
const JOURNEYS_TEXT = `journeys (.done-done.yaml): the command runs with DONE_DONE_EVIDENCE_ROOT (this run's own new folder in the evidence
  root) and DONE_DONE_RUN_ID set, and \${RUN_ID} in it is replaced; it must write its files into that folder, e.g.
  ${journeyExample}
  or describe it in plain words and your agent writes the script: done-done journey add "<what a user does and sees>" (done-done journey --help has an example of add, enhance and improve)
  real product: a journey whose command only runs tests, typecheck, lint or a build (npm test, yarn run check, tsc, pytest, or a test or guard
  script such as bash tests/x.test.sh or node scripts/floor-guard.mjs) is code-only;
  init --journey refuses it, and check, receipt and gate refuse proof that comes only from code-only runs or a config of only code-only journeys
  step record: the journey also writes steps.json into $DONE_DONE_EVIDENCE_ROOT, shaped ${STEPS_SHAPE};
  check, receipt and gate refuse a claim that no cited run's step record covers (a run recorded before step records only warns)
  core (journeys.<name>.core: true): the core user journey, the one thing a user cannot live without, driven end to end on the real target
  (for a remote terminal: pair, open a pane, type, see the output); doctor requires one, here or as a "(core journey)" entry in the verify skill's feature map
  upgrade (journeys.<name>.upgrade: true): the release path users take: install the previous shipped version, upgrade over it in place, then drive the
  core journey; doctor requires one when a tracked file shows the app ships an installable artifact (an npm package with a bin, an Expo or Android app,
  Python console scripts, a Rust [[bin]], goreleaser, a systemd service), since a fresh install alone is no release proof
  spends (journeys.<name>.spends): what a run spends, e.g. "one live generation"; verify parks the journey until the user approves that run (respond --action approve)
  timeout (journeys.<name>.timeout): how long a verify run may drive the journey, e.g. 90s or 30m (default 30m); past it the journey is killed and the run is inconclusive
  matrix (.done-done.yaml): with theme, width or form axes the journey runs once per required cell with DONE_DONE_THEME, DONE_DONE_WIDTH, DONE_DONE_FORM and DONE_DONE_CELL (the capture name suffix) set; name each capture with its suffix, so every cell is captured or skipped with a reason`;
// A claim about how the product looks or what it outputs needs a comparison with the approved result.
const DESIGN_CLAIM = /\b(design(ed|s)?|redesign(ed)?|mock(up)?s?|prototype|approved)\b/i;
const CHECKS_TEXT = `Checks block (--from): the newest "## Checks" heading, then these four keys, each at the start of a line:
  outcome: <what a user can now do>
  repro: <command that failed before and passes now, or n/a; a fix PR needs one>
  proof: <the command or path that drove the real product; name the repo's done-done-verify-<app> skill, or say "no verify skill">
  evidence: <the evidence file paths, or "not proven: <cause>">
  approved_design (.done-done.yaml): a non-empty manifest of {screen, size: <width>x<height>, theme, mock: <repo PNG/JPEG>, capture: <unique filename>};
  every claim needs every listed live screen, paired with its mock and a passing design verdict; missing or unsure matches fail by screen/size/theme
  approved_requirements (.done-done.yaml): approved assets, color tokens and interactions as {kind: asset|color|interaction, name, capture, mock?}; skip one only with {kind, name, exclusion: <reason>}
  (reference images under design/, mocks/, approved/ or prototype/ must be listed or excluded; a design claim with no approved reference or base_ref baseline fails as not compared to approved result)
  interaction_checklist (.done-done.yaml, opt-in): map the six ids in skills/done-done/interaction-checklist.json to {captures: [<live PNG/JPEG filename>, ...]}
  or {not_applicable: <reason>}; detail-navigation, instant-state, destructive-undo, scroll-restoration, list-search, empty-next-step.
  check/receipt/verify report every item: pass only with judged real-product frames, not_applicable with a reason, otherwise flagged (exit 1).
  Omitted checklist: unchanged behavior; interaction_checklist: {} flags all six. Frames must be cited from sealed runs; static controls alone do not prove an interaction`;
const RUNS_TEXT = `runs: each verify or maintain run lives in $DONE_DONE_HOME/runs/<app>/<run-id> (run.json, events.jsonl, logs/<step>.log,
  agents/<n>-<name>.json for each agent call) and goes on when the command that started it ends;
  verify steps: resolve, drive, check, judge (always; skipped only after a failed check), triage and fix (only with auto_fix.verify above 0), gate, receipt, report;
  maintain steps: locate, hygiene, source-wave, reconcile, triage and fix (only with auto_fix.maintain above 0), report
  drive: the journey when there is one; else the author agent (agent: in config) drives one feature of the verify skill the way a user
  does and saves captures into the run's evidence folder; it may run commands and edit files only in the repo and that folder where
  its CLI can limit it (pi cannot), and a drive that changes a tracked file fails
  inputs (.done-done.yaml): repo-relative paths or globs the drive must leave alone (fixtures, data files);
  hashed before and after the drive; the check step fails naming each changed, appeared or
  disappeared path (never file contents), and the before/after hash lists go into the run record; no key: unchanged
  gate: a judge fail or unsure (or an agent drive with no judged capture) parks the run as awaiting_approval (exit 4); nothing moves it
  past the judge: respond --action fix ends it fail, with no receipt (skip ends it fail too, without the fix; approve answers only a spend gate)
  auto_fix: { verify: <n> } (config; 0, the default, reports only): the judge sorts each wrong screen (fix or ask; an ask, an unsure
  answer or a mixed result parks at the gate), then the agent the user set fixes the product in a done-done worktree with your
  ignored files copied in, and verify runs again there, up to n times. Result: changed (the fix on a done-done/verify-<run-id>
  branch, your HEAD still fails; exit 1) or blocked (dirty checkout, a guard, or every attempt used; exit 1)`;
const SIGNOFF_TEXT = `sign-off (.done-done.yaml): the board where the person answers. done-done writes the message (contract v1) and, with the opt-in, posts it:
  signoff.post: true lets every signoff post to the board; --post posts one run. Without it, signoff only writes the message and prints the post command.
  signoff.board names the board file (default: the nearest .sign-off/ board sign-off-axi finds); --board names it for one run.
  signoff --wait waits for the answer to the card that run posted (--timeout, default 10m) and feeds it back to that run: a gate's
  approve, skip or fix ends or resumes the run, exactly as done-done respond does. The card (its key and board) is recorded on the run,
  so status shows it. The board is sign-off's own: done-done posts through sign-off-axi and never edits a board.`;
const MAINTAIN_TEXT = `maintain reads the verify skill and the source; HEAD, git status and the content of changed files must be the same before and after.
  locate: the verify skill (.agents/skills/done-done-verify-<app>/SKILL.md); none: blocked, create it with done-done init
  hygiene: every local link in the skill resolves; features/README.md lists each features/*.md file once
  source-wave: one fresh read-only reader per feature file at the configured agent (agent, agent_config) explains it from source
  reconcile: each file:line the skill or a reader cites must exist (a bare file name matches a tracked file); one tool-less call
  merges the recipes and names recently changed source (git log, 30 days) that no feature covers. Result: clean (exit 0),
  drift with findings (exit 1), or blocked (no skill, a reader that did not answer, or a repo that changed; exit 3). maintain
  never runs without its agent: none set, or one that cannot start or cannot read with its tools off, stops it first (exit 2)
  auto_fix: { maintain: <n> } (config, as no-mistakes; 0, the default, reports only) lets done-done fix drift up to n times:
  triage: the judge the user set sorts each drift finding: the skill is out of date, or the product
  may be wrong; a product finding is ask-user, so the run ends blocked and the user decides (maintain never edits product code)
  fix: the agent the user set edits only the verify skill, in a done-done worktree at HEAD; a change outside the skill folder,
  a commit by the agent or a change to your checkout ends it blocked, and the worktree is dropped. maintain then runs again there.
  Result: changed (a clean re-run; one commit of the skill folder on a done-done/maintain-<run-id> branch, your branch and checkout
  untouched; exit 0), or blocked (ask-user findings, a guard, or every attempt used, with the findings that remain; no branch)`;
const DOCTOR_TEXT = `doctor changes nothing except the --probe call record (the agent itself may keep its own session files) and exits 0 when every required item is ok, 2 otherwise.
  required: git (inside a repository), config (a valid .done-done.yaml), evidence_root (writable), agent (the agent the user
  set and its model; missing when none is set, with the command that saves the user's choice), judge (the judge route is ready:
  for claude-code an executable claude binary and the judge kit, for answerer:<agent> that agent's CLI and the
  kit, for a key route (openai:key, minimax:key) its API key and the kit; doctor does not call the model; missing when none is set, with the command
  that saves the user's choice),
  core_journey (a journey with core: true that drives the product, or a "(core journey)" entry in the verify skill's features/README.md),
  upgrade_journey (when a tracked file shows the app ships an installable artifact, a journey with upgrade: true or an "(upgrade journey)" entry).
  also listed: verify_skill (.agents/skills/done-done-verify-<app>/), agent_settings (agent, model, effort,
  args, path and agent_timeout, each with the file it came from: the global config, .done-done.yaml or default),
  judge_choice (the judge, and how far it is from the author: another agent, another model, or session-only), ffprobe (video evidence only).
  --probe also asks the agent one JSON-schema question (one call at the agent's model: its cheap default where it has one, else its own; set agent_config.<agent>.model to choose; its record goes to
  $DONE_DONE_HOME/agents/) and then requires a valid answer.
  doctor lists every check; --full changes nothing. A missing verify_skill or ffprobe, or a warning, never fails it.`;
const CONFIG_TEXT = `config: ~/.done-done/config.yaml (global; DONE_DONE_HOME moves it) and .done-done.yaml (the repo), repo over global.
  agent (either file): claude, codex, opencode, pi, gemini or acp:<target>, set by the user (done-done init --agent); done-done never picks one.
  global only: agent_config.<agent>.{model,effort} (effort: minimal, low, medium, high, xhigh, max), agent_args_override.<agent>
  (extra flags), agent_path_override.<agent> (binary), acpx_path, agent_timeout (one agent call, default 30m; a streaming agent that prints nothing for 5m is stopped early),
  judge.account_command (optional shell command printing a Claude account pick; exported CLAUDE_CONFIG_DIR wins; failure stops the call),
  evidence.local_root, judge.{route,model,floor} (the judge and shared confidence floor, set by the user with
  init --judge; never picked). done-done doctor shows where each agent setting came from.`;
// One table drives `--help` and every `<command> --help`: each command's usage lines and the flags it takes.
const FLAGS = {
    '-- <command...>': 'run this command instead of a journey; ${RUN_ID} in it becomes the run id',
    '--journey <name>': 'record this command as a journey in .done-done.yaml; ${RUN_ID} in it becomes the run id',
    '--core': 'with --journey: mark it the core user journey (core: true), the one thing a user cannot live without, driven end to end on the real target',
    '--upgrade': 'with --journey: mark it the upgrade journey (upgrade: true): install the previous shipped version, upgrade over it in place, then drive the core journey',
    '--open': 'open a run for a hand- or agent-driven proof; prints its id and folder',
    '--close <run-id>': 'seal an open run and record the files in its folder',
    '--outcome "<claim>"': 'the outcome the evidence files prove; the files follow as arguments',
    '--from <file | - | PR URL>': 'read the claim from the newest "## Checks" block of a file, stdin or a PR body',
    '--trusted-ref <ref>': 'read .done-done.yaml from this git ref instead of the working tree (for scripts)',
    '--judge <route>': 'check with this judge for this call instead of judge.route (same form: claude-code, answerer:opencode, answerer:pi, answerer:gemini, openai:key or minimax:key); its model is that agent\'s default, or judge.model when the route is the configured one',
    '--citation-base <dir>': 'resolve evidence citations against this directory (default: cwd); absolute citations stay unchanged; does not change repo, config or run storage',
    '--claim-id <id>': 'the claim the evidence proves; evidence already used for another claim id is reuse (default: the current branch, or the PR branch with --from <PR URL>; required on a detached HEAD)',
    '--verify <head>': 'read-only: verify the receipt recorded for <head>',
    '--outcome "<what a user can now do>"': 'the outcome the run must prove',
    '--wait': 'wait until the run ends (the default)',
    '--no-wait': 'start the run and return at once (exit 4); read it later with done-done status',
    '--foreground': 'run every step in this process instead of a detached runner (for scripts)',
    '--run <run-id>': 'the run to show (default: the newest run of this checkout)',
    '--probe': 'ask the configured agent one JSON-schema question and require a valid answer (one call at the agent\'s model: its cheap default where it has one, else its own; set agent_config.<agent>.model to choose)',
    '--mock <screen>=<mock>': 'judge this screen next to its approved mock (repeat per screen; the screen is judged even when not listed)',
    '--mock <file>': 'with look: the approved design of this page (PNG or JPEG); the judge the user set compares the capture with it, as design --mock does, and a defect fails look',
    '--act <selector>': 'with look: click the element this CSS selector names, then require the page to change what a user can read (its text, elements or address) within 5s; repeat to click several in order; look measures and captures the page they leave',
    '--step <name>': 'the step log to show (verify: resolve, drive, check, judge, gate, receipt, report; maintain: locate, hygiene, source-wave, reconcile, triage, fix, report)',
    '--feature <name>': 'with no journey, the author agent drives this feature of the verify skill (features/<name>.md); default: the only feature, else the agent picks the one the outcome is about',
    '--action <approve|skip|fix>': 'at a spend gate, approve: spend and run the journey; skip: end the run with nothing spent. At the judge gate only fix or skip: fix ends it fail, then the product or the verify skill is fixed (done-done maintain checks it against the source); skip ends it fail without the fix',
    '--reason "<why>"': 'why (required for approve and skip at a spend gate); kept in the run with who answered',
    '--post': 'with signoff: post the message to the sign-off board through sign-off-axi and record the card on the run (the opt-in: without it, signoff only writes the message)',
    '--board <file>': 'with signoff: the board file to post to (default: the nearest .sign-off/ board sign-off-axi finds)',
    '--timeout <duration>': 'with signoff --wait: how long to wait for the answer (default 10m)',
    '--limit <n>': 'how many past runs to list (default all)',
    '--out <file.png>': 'where look writes the screenshot; its page-check record goes next to it as <file>.dom.json (default: look.png in $DONE_DONE_EVIDENCE_ROOT inside a journey, else in the current folder)',
    '--agent <agent>': 'the coding agent done-done starts (claude, codex, opencode, pi, gemini or acp:<target>), saved as agent in ~/.done-done/config.yaml; without it, init asks in a terminal',
    '--model <model>': 'with --agent: that agent\'s model, saved as agent_config.<agent>.model (opencode: provider/model)',
    '--judge <agent>': `the judge done-done starts (${JUDGES.join(' or ')}), saved as judge.route in ~/.done-done/config.yaml (any agent and model, the author's own too); without it, init asks in a terminal`,
    '--judge-model <model>': 'with --judge <agent>: the judge\'s model, saved as judge.model',
    '--before': 'record HEAD at PreToolUse; without it consume the matching PostToolUse event and capture the commit',
    '--after-commit': 'with --hook claude, opt in to Bash lifecycle hooks that rerun affected journeys after a commit and propose missing skill coverage (no agent or judge started)',
    '--hook <agent>': 'also add a SessionStart hook to .claude/settings.json (claude), .codex/hooks.json (codex) or .gemini/settings.json (gemini) that shows `done-done` to each session, or a plugin to .opencode/plugins (opencode) or an extension to .pi/extensions (pi) that adds it to the first message of each session (opt-in)',
};
// `more` is the reference text a command needs beyond its flags, shared with the top-level help.
const COMMANDS = {
    init: {
        usage: [
            ['done-done init', 'write a minimal .done-done.yaml (evidence lives outside the repo) and, when absent, a commented ~/.done-done/config.yaml'],
            ['done-done init', 'have the agent write .agents/skills/done-done-verify-<app> from this repo\'s own proof paths (never overwrites; no agent, no skill)'],
            ['done-done init --agent opencode --model opencode-go/muse-spark-1.3-contributor', 'set the coding agent done-done starts and its model (in a terminal, init asks when none is set)'],
            ['done-done init --judge pi --judge-model openai-codex/gpt-6-luna', 'set the judge done-done starts and its model (in a terminal, init asks when none is set)'],
            ['done-done init --hook claude', 'also show this repo\'s done-done state at each Claude Code session start'],
            ['done-done init --hook claude --after-commit', 'also opt in to rerun affected journeys after a Bash commit; propose missing coverage without editing the skill'],
            ['done-done init --hook codex', 'also show this repo\'s done-done state at each Codex session start'],
            ['done-done init --hook opencode', 'also add this repo\'s done-done state to the first message of each opencode session'],
            ['done-done init --hook pi', 'also add this repo\'s done-done state to the first prompt of each pi session'],
            ['done-done init --hook gemini', 'also show this repo\'s done-done state at each Gemini CLI session start'],
            ['done-done init --journey <name> -- <command...>', "record a journey's capture recipe in .done-done.yaml"],
            ['done-done init --journey <name> --core -- <command...>', 'record the core user journey: the one thing a user cannot live without, end to end on the real target'],
            ['done-done init --journey upgrade --upgrade -- <command...>', 'record the release path: install the previous shipped version, upgrade over it in place, drive the core journey'],
        ],
        flags: ['--agent <agent>', '--model <model>', '--judge <agent>', '--judge-model <model>', '--hook <agent>', '--after-commit', '--journey <name>', '--core', '--upgrade', '-- <command...>'],
        more: [JOURNEYS_TEXT, CONFIG_TEXT],
    },
    doctor: {
        usage: [
            ['done-done doctor', 'check this repo is worth driving: git, config, evidence root, skill, agent, judge, ffprobe'],
            ['done-done doctor --probe', 'also ask the configured agent one question to prove it answers'],
        ],
        flags: ['--probe'],
        more: [DOCTOR_TEXT, CONFIG_TEXT],
    },
    run: {
        usage: [
            ['done-done run [<journey>] [-- <command...>]', 'run a journey (or command) and record the evidence it writes'],
            ['done-done run --open [<journey>]', 'open a run for a hand- or agent-driven proof; prints its id and folder'],
            ['done-done run --close <run-id>', 'seal an open run'],
        ],
        flags: ['-- <command...>', '--open', '--close <run-id>'],
        more: [JOURNEYS_TEXT],
    },
    check: {
        usage: [
            ['done-done check --outcome "<claim>" <files...> [--claim-id <id>] [--trusted-ref <ref>] [--citation-base <dir>]', 'check evidence files against a claim'],
            ['done-done check --from <file | - | PR URL> [--claim-id <id>] [--trusted-ref <ref>] [--citation-base <dir>]', "check a claim's Checks block"],
            ['done-done check --judge answerer:pi --outcome "<claim>" <files...>', 'judge with this route for this call instead of judge.route'],
        ],
        flags: ['--outcome "<claim>"', '--from <file | - | PR URL>', '--judge <route>', '--claim-id <id>', '--trusted-ref <ref>', '--citation-base <dir>'],
        more: [CHECKS_TEXT],
    },
    receipt: {
        usage: [
            ['done-done receipt --outcome "<claim>" <files...> [--claim-id <id>] [--trusted-ref <ref>] [--citation-base <dir>]', 'record a passing check for HEAD'],
            ['done-done receipt --from <file | - | PR URL> [--claim-id <id>] [--trusted-ref <ref>] [--citation-base <dir>]', "record from a claim's Checks block"],
            ['done-done receipt --verify <head>', 'read-only: verify a recorded receipt'],
        ],
        flags: ['--outcome "<claim>"', '--from <file | - | PR URL>', '--claim-id <id>', '--trusted-ref <ref>', '--citation-base <dir>', '--verify <head>'],
        more: [CHECKS_TEXT],
    },
    verify: {
        usage: [
            ['done-done verify [<journey>] --outcome "<what a user can now do>" [--claim-id <id>]', 'drive the journey in a run that outlives this command, check its evidence, judge each capture and record a receipt'],
            ['done-done verify --outcome "<claim>" [--feature <name>]', 'with no journey, the author agent drives a verify skill feature and the judge the user set judges its captures'],
            ['done-done verify [<journey>] --outcome "<claim>" --no-wait | --wait | --foreground', 'return at once, wait until the run ends or waits at its gate (default), or run in this process'],
        ],
        flags: ['--outcome "<what a user can now do>"', '--feature <name>', '--claim-id <id>', '--wait', '--no-wait', '--foreground'],
        more: [RUNS_TEXT],
    },
    journey: {
        usage: [['done-done journey add "<description>"', 'use your configured agent to add a capture script, journey config and verify feature, print a diff summary, then run it once'], ['done-done journey enhance <name> ["<focus>"]', 'deepen one existing journey, preserve its checks and settings, print a diff summary, then run it once'], ['done-done journey improve <name> "<instruction>"', 'apply one specific instruction to an existing journey, print a diff summary, then run it once']],
        flags: [],
        more: [`examples (a greeting CLI; add names the journey from your words and prints that name):
  done-done journey add "greet Umer and check that Hello Umer is printed"
    writes journeys/greet-umer-prints-hello.mjs, its .done-done.yaml entry and a verify skill feature
  done-done journey enhance greet-umer-prints-hello "add checks for an empty name and an unknown command"
    keeps every existing check and adds the edge cases (leave out the focus for a general pass)
  done-done journey improve greet-umer-prints-hello "also check that greeting Zoë prints exactly Hello Zoë"
    makes only that one change
each prints the files it changed and runs the journey once as a dirty-tree trial; review the script like any code, commit it, then
  done-done run greet-umer-prints-hello records clean proof with no agent or model (CI can replay it)`, 'Run init first. Generation runs locally, never in CI, and uses only the agent you configured; it never chooses one. A journey that spends is saved but not run: use verify for approval.'],
    },
    maintain: {
        usage: [['done-done maintain [--no-wait | --wait | --foreground]', 'check the verify skill against the source in a run: links, index, cited file:line, one read-only reader per feature; with auto_fix.maintain, the agent fixes the skill on a done-done branch']],
        flags: ['--wait', '--no-wait', '--foreground'],
        more: [MAINTAIN_TEXT, RUNS_TEXT],
    },
    design: {
        usage: [['done-done design <screens...> [--mock <screen>=<mock>]', 'a judge looks at each PNG/JPEG screen, alone or next to its mock, and fails it on visual defects']],
        flags: ['--mock <screen>=<mock>'],
        more: [`design: one judge request per screen (the judge the user set); it fails a screen on any defect it names:
  ${Object.keys(KINDS).join(', ')}; capture each variant (dark, small width, large font) as its own screen; exit 0 every screen
  passed, 1 a screen failed, 3 none failed but one is unsure`],
    },
    look: {
        usage: [['done-done look <url> [--act <selector>]... [--mock <file>] [--out <file.png>]', 'open a page in headless Chrome at a phone viewport, click each action, capture it with its page-check record, and fail on any squashed, clipped or cut-off UI, an action that changes nothing, or a mismatch with the design']],
        flags: ['--act <selector>', '--mock <file>', '--out <file.png>'],
        more: [`look: one step a journey calls as its command or inside its script; with no --mock, no judge and no model. It measures horizontal
  overflow, squashed text, text clipped by its container and elements cut off by the left, right or top edge, writes the
  screenshot and its .dom.json record, and exits 1 naming each element, kind and text, 0 when there is none. Each --act is
  clicked and must change the page. With a look block in .done-done.yaml (the approved reference: tokens, max_control) it
  also fails on a control drawn as the browser's own and on one taller than max_control. A hit always fails: never wrap it
  in || true. Exit 3 when the only doubt is an unsure judge. Needs Chrome or Chromium (DONE_DONE_CHROME names the binary)`],
    },
    gate: {
        usage: [['done-done gate [<head>] [--dir <folder>] [--pushed <time>]', 'no-model check for a hosted runner: PASS or FAIL: <reason> for a receipt committed under .done-done-receipts/']],
        flags: ['--dir <folder>', '--pushed <time>'],
        more: [`gate: reads git objects only, so it needs no config, judge, model key or evidence files, and a hosted runner never runs check, run or verify.
  Copy the receipt that receipt wrote (<evidence root>/.done-done/receipts/<head>.json) into .done-done-receipts/ and commit it in a follow-up commit.
  PASS when a receipt there is a well-formed judged pass, its head is <head> (default HEAD) or an ancestor of it, every file changed since that head is
  inside the folder, and its time is not after the push (--pushed, default the commit time of <head>). It does not re-hash evidence: that is receipt --verify
  on the machine that holds it. Needs the history back to the receipt head (fetch-depth: 0). Exit 0 PASS, 1 FAIL, 2 usage error`],
    },
    lint: {
        usage: [['done-done lint <PR URL | report file> <evidence folder>', 'merge gate on a worker\'s claim: prints PASS, WARN: <reason> or FAIL: <reason>; the rules need no judge or model, and two optional size rules are config keys']],
        flags: [],
        more: [`lint: a deterministic gate that is on whenever you call it. The newest "## Checks" block of the PR body (gh pr view) or report file needs
  outcome:, repro:, proof: and evidence: lines. proof names a command or path, and the repo's done-done-verify-<app> skill, or says "no verify skill"
  when the repo (the current folder) has none; repro is not n/a on a fix PR. evidence names files in the evidence folder (or absolute):
  each exists, is non-empty and is newer than the folder itself; no two are byte-identical; at least one has a hash no other PR used
  (hash store lint.hashes in ~/.done-done, or $DONE_DONE_HOME). "evidence: not proven: <cause>" passes. A PR with 1,000 or more added
  non-generated lines fails (lockfiles, vendor/, dist/, LICENSE-type files, deletions and moved lines do not count); a bot PR passes.
  A PR URL whose diff changes a src/ file and no journeys/ file prints WARN instead of PASS (still exit 0): run the journey and commit it before the PR opens.
  In .done-done.yaml, checks.upstream_catch_up: true also drops a fork's upstream catch-up lines, and checks.moved_from: true drops lines
  a "moved-from: <owner>/<repo>@<ref> <dst>=<src>" body line says came from a repo of the same owner; both are off by default.
  checks.generated_paths: ["gen/**", "*.snap"] adds your own globs to the generated files above; the default is none.
  Every run is appended to lint.log next to the store. Exit 0 PASS or WARN, 1 FAIL, 2 usage error. Needs gh for a PR URL`],
    },
    'after-commit': {
        usage: [['done-done after-commit [--before]', 'Claude Bash lifecycle hook; reads its event on stdin and reruns affected journey commands after a commit']],
        flags: ['--before'],
        more: ['Install only by opting in: done-done init --hook claude --after-commit. No agent or judge is selected or started; uncovered files produce a proposal outside the skill.'],
    },
    affected: {
        usage: [['done-done affected [<base>]', "the journeys a change needs, from the verify skill's feature map and the paths it cites (the core journey when unsure); exit 1 until a receipt for HEAD covers them"]],
        flags: [],
        more: [`affected: model-free. The change is the diff from <base>, else from the newest receipt before HEAD (the commits since the last proof),
  else from the merge base with the default branch (origin/HEAD, origin/main, origin/master, main, master), plus uncommitted changes to tracked files;
  evidence.ignore_paths and .done-done-receipts/ need nothing. A journey is needed when its command runs a changed file; a feature
  (features/<name>.md) when it cites a changed file (a repo path, a markdown link, a folder written with a slash such as src/, or a bare
  file name) or is the changed file, and then each journey it names (run <journey>, or a file the journey's command runs); a feature
  that names no journey is driven by your agent (verify --feature <name>). A changed file nothing covers, or no base, is uncertain:
  the core journey is needed too (every journey when none is core), never less, and the file is flagged for the feature map.
  Result: fresh (exit 0) when the receipt for HEAD has a run of every needed journey and feature and nothing is uncommitted;
  stale (a receipt for an earlier commit, a receipt that misses a needed journey, or uncommitted changes) or missing (no receipt) exit 1`],
    },
    status: {
        usage: [['done-done status [--run <run-id>]', "show a run's steps, result, findings and next step"]],
        flags: ['--run <run-id>'],
        more: [RUNS_TEXT],
    },
    attach: {
        usage: [['done-done attach [--run <run-id>]', "stream a run's events until it ends, then show it"]],
        flags: ['--run <run-id>'],
        more: [RUNS_TEXT],
    },
    logs: {
        usage: [['done-done logs --step <name> [--run <run-id>] [--full]', 'show a step log (tail by default)']],
        flags: ['--step <name>', '--run <run-id>'],
        more: [RUNS_TEXT],
    },
    respond: {
        usage: [
            ['done-done respond [--run <run-id>] --action approve|skip --reason "<why>"', 'answer a spend gate: spend and run the journey, or end with nothing spent'],
            ['done-done respond [--run <run-id>] --action fix', 'end a run waiting at its judge gate as fail (nothing moves it past the judge)'],
        ],
        flags: ['--run <run-id>', '--action <approve|skip|fix>', '--reason "<why>"'],
        more: [RUNS_TEXT],
    },
    rerun: {
        usage: [['done-done rerun [--run <run-id>] [--wait | --no-wait]', 'run again from the failed step, reusing steps whose inputs did not change; the judge always runs; wait (default) or return at once (exit 4)']],
        flags: ['--run <run-id>', '--wait', '--no-wait'],
        more: [RUNS_TEXT],
    },
    abort: {
        usage: [['done-done abort [--run <run-id>]', 'stop a live run and its journey, and mark it cancelled']],
        flags: ['--run <run-id>'],
        more: [RUNS_TEXT],
    },
    signoff: {
        usage: [
            ['done-done signoff [--run <run-id>]', "write the run's sign-off message (contract v1): a gate for a run waiting at its gate, evidence for a finished run; without the opt-in it prints the post command and never posts"],
            ['done-done signoff --post [--board <file>]', 'post that message to the sign-off board through sign-off-axi and record the card on the run'],
            ['done-done signoff --wait [--timeout <duration>]', 'wait for the answer to the card this run posted and feed it back to that run'],
        ],
        flags: ['--run <run-id>', '--post', '--board <file>', '--wait', '--timeout <duration>'],
        more: [RUNS_TEXT, SIGNOFF_TEXT],
    },
    history: {
        usage: [['done-done history [--limit <n>]', 'list past runs, newest first']],
        flags: ['--limit <n>'],
        more: [RUNS_TEXT],
    },
};
const rows = (pairs, width = Math.max(...pairs.map(([a]) => a.length)) + 3) => pairs.map(([a, b]) => `  ${a}${' '.repeat(Math.max(3, width - a.length))}${b}`).join('\n');
const GLOBAL_TEXT = `global flags: --json (JSON instead of TOON), --full (do not truncate lists), --help (this command's usage), --version (bare version first; pre-release label on the next line when suffixed)
exit codes: 0 pass, 1 fail, 2 usage or config error, 3 inconclusive, 4 the run is still running or a verify run waits at its gate (verify, maintain, rerun, status, respond)`;
const USAGE_TEXT = `${HELP_HEADER}
install: npm install -g --prefix ~/.local done-done-axi (installs done-done-axi and done-done), or run npx -y done-done-axi <command>
usage:
${rows([['done-done', "show this repo's config state and the next step"], ...Object.values(COMMANDS).flatMap((c) => c.usage)], 46)}
${GLOBAL_TEXT}
judge: done-done's own agent, a fresh one on your own plan through BYOKit, says whether each PNG/JPEG capture shows
  the outcome; a wrong screen fails, an unsure answer is inconclusive. check, receipt, verify, rerun and design always start
  it, and there is no way to turn it off: a pass needs a judge pass on at least one capture. The judge is the one the user set
  (judge.route: claude-code; answerer:<agent> through the CLI of opencode, pi or gemini with every tool off; or a key route on your own API key: openai:key with
  judge.model, or minimax:key, which falls back to claude-code when its call fails), whichever agent and model the user picks; with none set, done-done asks in a
  terminal or stops (exit 2) with the command that saves it. A judge that fails or does not answer stops the command with its
  cause (exit 2), never a result.

${JOURNEYS_TEXT}
${CHECKS_TEXT}
${CONFIG_TEXT}

Results are printed as one TOON document (the AXI convention); pass --json for JSON.
Run \`done-done <command> --help\` for that command's flags.`;
function commandHelp(cmd) {
    const c = COMMANDS[cmd];
    const flags = c.flags.length ? rows(c.flags.map((f) => [f, FLAGS[f]])) : '  none';
    return [HELP_HEADER, `usage:\n${rows(c.usage)}`, `flags:\n${flags}`, ...c.more, GLOBAL_TEXT].join('\n');
}
// How many list rows a compact result shows before it reports the rest as omitted.
const COMPACT_LIST = 5;
let OUT = 'toon';
let FULL = false;
// One machine-readable result on stdout: TOON by default (the AXI convention), JSON with --json.
function emit(value) {
    process.stdout.write(`${OUT === 'json' ? JSON.stringify(value, null, 2) : encode(value)}\n`);
}
const emitted = (r) => (emit(r.result), r.code);
// Compact results cap long lists; --full returns every row.
function cap(items) {
    return FULL || items.length <= COMPACT_LIST ? { items, omitted: 0 } : { items: items.slice(0, COMPACT_LIST), omitted: items.length - COMPACT_LIST };
}
// A hint that names the exact command that moves the work forward, naming the journey when there is one.
const RECORD_REAL = "done-done init --journey <name> -- '<command that drives the real app and saves screenshots, a recording or its transcript into $DONE_DONE_EVIDENCE_ROOT>'";
const CORE_FIX = "Name the core user journey, the one thing a user cannot live without, driven end to end on the real target: done-done init --journey <name> --core -- '<command that drives it and saves its captures into $DONE_DONE_EVIDENCE_ROOT>'";
const UPGRADE_FIX = "Record the release path users take: done-done init --journey upgrade --upgrade -- '<command that installs the previous shipped version, upgrades over it in place, then drives the core journey>'";
// The verify skill's feature map, where a journey-less repo names its core and upgrade journeys; '' when there is none.
const featureMap = (repo, cfg) => repoText(join(repo, cfg.skill, 'features', 'README.md')) ?? '';
// What shows this repo ships an installable or upgradable artifact (src/proof.ts releaseArtifacts), from its tracked files.
function shipped(repo) {
    const files = execFileSync('git', ['ls-files', '-z'], { cwd: repo, encoding: 'utf8', maxBuffer: Infinity, stdio: ['ignore', 'pipe', 'pipe'] }).split('\0').filter(Boolean);
    return releaseArtifacts(files, (f) => repoText(join(repo, f)));
}
// The fixes for a core or upgrade journey this repo does not name yet, as doctor's rows ask for them.
const journeyAsks = (repo, cfg) => {
    const map = featureMap(repo, cfg);
    return [...(namedJourney('core', cfg.journeys, map) ? [] : [CORE_FIX]), ...(namedJourney('upgrade', cfg.journeys, map) || !shipped(repo).length ? [] : [UPGRADE_FIX])];
};
// A code-only journey is never named: its run is no proof.
function captureHint(cfg) {
    const code = codeOnlyJourneys(cfg.journeys);
    const names = Object.keys(cfg.journeys).filter((n) => !code.includes(n));
    if (names.length === 1)
        return `done-done run ${names[0]}`;
    if (names.length > 1)
        return `done-done run <journey> (${names.join(', ')})`;
    if (code.length)
        return `${RECORD_REAL} (${code.join(', ')} only run${code.length > 1 ? '' : 's'} code checks), commit, then done-done run <name>`;
    return 'done-done run -- <capture command>';
}
// The words after --, as the one shell command string a run executes. One word is already a whole command,
// so it stays verbatim (the documented `-- '<shell command>'` recipe); several words are argv, and each one
// is quoted so spaces and shell metacharacters inside a word survive the shell that runs the string.
const commandOf = (words) => (words.length === 1 ? words[0] : words.map(quote).join(' '));
// A path as the user should see it: repo-relative inside the repo, else with the home directory as ~.
const outside = (r) => r === '..' || r.startsWith(`..${sep}`) || isAbsolute(r);
const shown = (repo, p) => {
    const r = relative(repo, p);
    if (r && !outside(r))
        return r;
    if (!r)
        return '.';
    const rh = relative(homedir(), p);
    return rh && !outside(rh) ? `~${sep}${rh}` : p;
};
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
// `p` relative to `base` when it lies under it, else null.
function under(base, p) {
    const r = relative(base, p);
    return r && !outside(r) ? r : null;
}
// A path to pass back to done-done (an evidence file to cite, a folder to capture into): exact, so no shell
// needs to expand `~`. Repo-relative inside the repo, absolute outside it (the default evidence root).
const citable = (repo, p) => under(repo, p) ?? p;
function repoRoot() {
    try {
        return git(process.cwd(), 'rev-parse', '--show-toplevel');
    }
    catch {
        throw new UsageError('not inside a git repository');
    }
}
function head(repo) {
    return {
        commit: git(repo, 'rev-parse', 'HEAD'),
        tree: git(repo, 'rev-parse', 'HEAD^{tree}'),
        dirty: git(repo, 'status', '--porcelain', '--untracked-files=no') !== '',
    };
}
const recordsDir = (cfg) => join(cfg.evidence.root, '.done-done', 'runs');
// Each run captures into its own new folder in the evidence root. Every checkout of a repo shares that root,
// so a run records only its own folder and never claims a file another, overlapping run wrote.
const runDir = (cfg, runId) => join(cfg.evidence.root, runId);
// Every file in a run's folder, relative to the evidence root.
function captured(cfg, runId) {
    const dir = runDir(cfg, runId);
    if (!existsSync(dir))
        return [];
    return readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => relative(cfg.evidence.root, join(e.parentPath, e.name)));
}
function writeRecord(cfg, rec) {
    const path = join(recordsDir(cfg), `${rec.run_id}.json`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.tmp`, `${JSON.stringify(rec, null, 2)}\n`);
    renameSync(`${path}.tmp`, path);
    return path;
}
// The random suffix keeps two runs in the same second at one commit apart; mkdir without recursive refuses a reused id.
const newRunId = (commit) => `${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${commit.slice(0, 8)}-${randomBytes(3).toString('hex')}`;
function openRun(repo, cfg, journey, command, id) {
    const h = head(repo);
    const runId = id ?? newRunId(h.commit);
    mkdirSync(cfg.evidence.root, { recursive: true });
    mkdirSync(runDir(cfg, runId));
    return { schema: 1, run_id: runId, journey, command, ...h, started_at: new Date().toISOString(), ended_at: null, exit: null, files: [], tool: VERSION };
}
// The step record a run's journey (or driving agent) wrote beside its captures; it is a record, not a capture, so it is not a run file.
function readSteps(cfg, rec) {
    delete rec.steps;
    delete rec.steps_error;
    const file = join(runDir(cfg, rec.run_id), STEPS_FILE);
    if (!existsSync(file))
        return;
    try {
        const steps = JSON.parse(readFileSync(file, 'utf8'));
        const bad = stepRecordFault(steps);
        if (bad)
            rec.steps_error = bad;
        else
            rec.steps = steps;
    }
    catch (e) {
        rec.steps_error = `it is not JSON (${e.message})`;
    }
}
// The first line of a run's log that names a failure, trimmed: what a non-zero exit is about. Empty when none does.
function firstFailure(log) {
    if (!existsSync(log))
        return '';
    const line = readFileSync(log, 'utf8').split('\n').map((l) => l.replace(/\x1b\[[\d;]*m/g, '').trim()).find((l) => /\b(FAIL|FAILED|Error|failed|timed out)\b/.test(l));
    return line ? line.slice(0, 200) : '';
}
function closeRun(repo, cfg, rec, log) {
    const now = head(repo);
    readSteps(cfg, rec);
    rec.files = captured(cfg, rec.run_id)
        .filter((p) => basename(p) !== STEPS_FILE || dirname(p) !== rec.run_id)
        .sort()
        .map((p) => {
        const b = readFileSync(join(cfg.evidence.root, p));
        return { path: p, sha256: sha256(b), bytes: b.length };
    });
    rec.ended_at = new Date().toISOString();
    if (hasMatrix(cfg.matrix))
        rec.matrix = matrixManifest(cfg.matrix, rec.files.map((f) => f.path));
    const record = writeRecord(cfg, rec);
    const rel = (p) => citable(repo, join(cfg.evidence.root, p));
    let reason = '';
    if (now.commit !== rec.commit)
        reason = `HEAD moved from ${rec.commit} to ${now.commit} during the run; evidence is not tied to one commit`;
    else if (rec.exit !== null && rec.exit !== 0) {
        const failure = log ? firstFailure(log) : '';
        reason = `the run command exited ${rec.exit}${failure ? `: ${failure}` : ''}`;
    }
    else if (!rec.files.length)
        reason = `the run wrote no files into its folder ${shown(repo, runDir(cfg, rec.run_id))}; the command gets it as $DONE_DONE_EVIDENCE_ROOT and its run id as $DONE_DONE_RUN_ID (or \${RUN_ID} in the command)`;
    const evidence = FULL ? rec.files.map((f) => ({ path: rel(f.path), sha256: f.sha256, bytes: f.bytes })) : rec.files.map((f) => rel(f.path));
    const rows = cap(evidence);
    const result = {
        command: 'run',
        // A capture that ran is recorded, never a pass: only the judged check decides whether it proves anything.
        result: reason ? 'fail' : 'recorded',
        run_id: rec.run_id,
        commit: rec.commit,
        dirty: rec.dirty,
        files: rec.files.length,
        record: shown(repo, record),
    };
    if (reason)
        result.reason = reason;
    result.evidence = rows.items;
    if (rows.omitted)
        result.evidence_omitted = rows.omitted;
    if (rec.matrix)
        result.matrix = rec.matrix;
    result.help = [reason
            ? `Fix the capture, commit, then re-run: ${captureHint(cfg)}`
            : `Check this proof: done-done check --outcome "<what you proved>" ${rel(rec.files[0].path)}`];
    // A command that matches no repo-recorded journey cannot be re-run from the repo recipe.
    // A journey run expands ${RUN_ID} to the run id, so compare with the placeholder restored.
    if (rec.command) {
        const template = rec.command.replaceAll(rec.run_id, '${RUN_ID}');
        const recorded = Object.values(cfg.journeys).some((j) => j.command === template);
        if (!recorded)
            result.help.push(`this command's recipe is not in the repo (.done-done.yaml journeys); record it with: done-done init --journey <name> -- <command>`);
    }
    return { code: reason ? FAIL : PASS, result, reason };
}
async function cmdRun(argv) {
    const literal = argv.find((a) => /\$\{?DONE_DONE_EVIDENCE_ROOT\b/.test(a));
    if (literal)
        throw new UsageError(`the argument ${JSON.stringify(literal)} holds the literal text $DONE_DONE_EVIDENCE_ROOT: the shell did not expand it (single quotes?), so it would name a folder with that name. Use the env var inside the script, or double quotes`);
    const dash = argv.indexOf('--');
    const { values, positionals } = parseArgs({
        args: dash < 0 ? argv : argv.slice(0, dash),
        options: { open: { type: 'boolean' }, close: { type: 'string' } },
        allowPositionals: true,
    });
    const repo = repoRoot();
    const cfg = loadConfig(repo);
    if (values.close) {
        const path = join(recordsDir(cfg), `${values.close}.json`);
        if (!existsSync(path))
            throw new UsageError(`no open run ${values.close} (looked for ${shown(repo, path)})`);
        const rec = JSON.parse(readFileSync(path, 'utf8'));
        if (rec.ended_at)
            throw new UsageError(`run ${values.close} is already closed`);
        return emitted(closeRun(repo, cfg, rec));
    }
    const journey = positionals[0] ?? null;
    if (positionals.length > 1)
        throw new UsageError('run takes at most one journey name');
    const spends = journey ? cfg.journeys[journey]?.spends : undefined;
    if (spends)
        throw new UsageError(`journey ${journey} spends (${spends}), so run refuses it: nothing ran`, `Ask the user, then: done-done verify ${journey} --outcome "<what a user can now do>"`);
    let command = dash < 0 ? null : commandOf(argv.slice(dash + 1));
    if (journey && !command) {
        const j = cfg.journeys[journey];
        if (!j)
            throw new UsageError(`unknown journey ${journey}; .done-done.yaml defines: ${Object.keys(cfg.journeys).join(', ') || 'none'}`);
        command = j.command;
    }
    const rec = openRun(repo, cfg, journey, command);
    if (values.open) {
        if (command)
            throw new UsageError('--open takes no command; drive the proof, then run --close');
        writeRecord(cfg, rec);
        emit({
            command: 'run',
            result: 'open',
            run_id: rec.run_id,
            commit: rec.commit,
            evidence_root: citable(repo, runDir(cfg, rec.run_id)),
            help: [`Capture into evidence_root (this run's own folder), then seal the run: done-done run --close ${rec.run_id}`],
        });
        return PASS;
    }
    if (!command)
        throw new UsageError('run needs a journey, a command after --, or --open');
    const expanded = command.replaceAll('${RUN_ID}', rec.run_id);
    rec.command = expanded;
    // With an instance block the app starts first on its own port, so the recipe uses
    // $DONE_DONE_BASE_URL instead of a hard-coded port; without one this is today's behaviour.
    let inst;
    let scratch;
    const SIGS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    const reap = (sig) => {
        if (inst)
            stopInstance(inst.pgid);
        if (scratch)
            rmSync(scratch, { recursive: true, force: true });
        if (sig)
            process.kill(process.pid, sig);
    };
    if (cfg.instance) {
        scratch = mkdtempSync(join(tmpdir(), 'done-done-instance-'));
        try {
            inst = await startInstance(repo, cfg.instance, rec.run_id, scratch, process.env, join(runsRoot(cfg.app), rec.run_id, 'logs', 'instance.log'));
            for (const s of SIGS)
                process.once(s, reap);
        }
        catch (e) {
            rmSync(scratch, { recursive: true, force: true });
            rec.exit = 1;
            const closed = closeRun(repo, cfg, rec);
            return emitted({ code: closed.code, result: { ...closed.result, reason: `instance: ${e.message}` } });
        }
    }
    // With a matrix block the journey runs once per required cell with that cell in env.
    const matrix = hasMatrix(cfg.matrix) ? splitMatrix(cfg.matrix) : null;
    const failed = [];
    rec.exit = 0;
    // The run's log lives with its run store, never in the evidence folder the judge reads: a failure names its first failing line.
    const logFile = join(runsRoot(cfg.app), rec.run_id, 'logs', 'run.log');
    mkdirSync(dirname(logFile), { recursive: true });
    for (const cell of matrix?.required ?? [{}]) {
        // The journey's own stdout goes to our stderr, never our stdout: stdout carries only done-done's
        // result document (TOON or --json), so a noisy journey cannot break `run --json | JSON.parse`.
        const r = await new Promise((done) => {
            const child = spawn(expanded, {
                cwd: repo, shell: true, stdio: ['inherit', 'pipe', 'pipe'],
                env: { ...process.env, DONE_DONE_RUN_ID: rec.run_id, DONE_DONE_EVIDENCE_ROOT: runDir(cfg, rec.run_id), ...inst?.env, ...(matrix ? cellEnv(cell) : {}) },
            });
            for (const out of [child.stdout, child.stderr])
                out?.on('data', (b) => { process.stderr.write(b); appendFileSync(logFile, b); });
            child.on('error', () => done(null)).on('close', done);
        });
        const code = r ?? 1;
        if (code !== 0) {
            if (!failed.length)
                rec.exit = code;
            failed.push(`${cellName(cell)} (exit ${code})`);
        }
    }
    reap();
    const sealed = closeRun(repo, cfg, rec, logFile);
    if (matrix && failed.length)
        return emitted({ code: FAIL, result: { ...sealed.result, reason: `the run command failed for cell ${failed.join('; ')}` } });
    return emitted(sealed);
}
// The newest "## Checks" block: outcome, repro, proof and evidence lines.
function claimFromChecks(body, title, repo, cfg, out) {
    const blocks = [...body.matchAll(/^##\s*Checks\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/gm)];
    if (!blocks.length)
        return void out.push({ level: 'fail', why: 'no "## Checks" block' });
    const text = blocks[blocks.length - 1][1].replace(/^\s*```.*$/gm, '');
    const f = {};
    for (const m of text.matchAll(/^\s*(outcome|repro|proof|evidence)\s*:\s*(.*)$/gm))
        f[m[1]] = m[2].trim();
    const missing = ['outcome', 'repro', 'proof', 'evidence'].filter((k) => !f[k]);
    if (missing.length)
        return void out.push({ level: 'fail', why: `Checks block is missing ${missing.join(', ')}` });
    if (!/[/`]|\.\w+\b|\b(npm|pnpm|yarn|npx|node|bash|sh|python3?|cargo|go|gradle|make|adb|xcrun|done-done)\b/.test(f.proof))
        out.push({ level: 'fail', why: 'proof names no command or path' });
    const skill = cfg.skill.split('/').pop();
    let ran;
    if (existsSync(join(repo, cfg.skill))) {
        if (!f.proof.includes(skill))
            out.push({ level: 'fail', why: `proof does not name the project's verify skill ${skill}` });
        else
            ran = skill;
    }
    else if (!/verify-|no verify skill/i.test(f.proof))
        out.push({ level: 'fail', why: 'proof names no verify skill and does not say "no verify skill"' });
    if (/^n\/?a\b/i.test(f.repro) && new RegExp(cfg.checks.fix_title, 'i').test(title))
        out.push({ level: 'fail', why: 'a fix needs a repro, not n/a' });
    const np = f.evidence.match(/^not proven\s*:?\s*(.*)$/i);
    ran ??= f.proof.match(/[\w.-]*verify-[\w-]+/i)?.[0];
    if (np)
        return { outcome: f.outcome, files: [], title, notProven: np[1] || 'no cause given' };
    const files = f.evidence.split(/[\s,]+/).map((t) => t.replace(/^[`'"(]+|[`'"),.;]+$/g, '')).filter((t) => /\.\w{1,10}$/.test(t));
    if (!files.length)
        out.push({ level: 'fail', why: 'evidence names no files' });
    return { outcome: f.outcome, files, title, ...(ran && { skill: ran }) };
}
// A PR body also names its head branch, which is the claim a detached-HEAD checkout is checking.
function readSource(from) {
    if (from === '-')
        return { body: readFileSync(0, 'utf8') };
    if (/^https?:\/\//.test(from)) {
        const r = spawnSync('gh', ['pr', 'view', from, '--json', 'body,title,headRefName'], { encoding: 'utf8' });
        if (r.error || r.status !== 0)
            throw new UsageError(`gh pr view ${from} failed: ${(r.error?.message || r.stderr).trim()}`);
        const pr = JSON.parse(r.stdout);
        return { body: pr.body, title: pr.title, branch: pr.headRefName };
    }
    try {
        return { body: readFileSync(from, 'utf8') };
    }
    catch (e) {
        throw new UsageError(`cannot read ${from}: ${e.message}`);
    }
}
function loadRecords(cfg) {
    const dir = recordsDir(cfg);
    if (!existsSync(dir))
        return [];
    return readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(dir, n), 'utf8'))).filter((r) => r.ended_at);
}
// Run a check and return its result without printing it, so `check` and `receipt` share one path.
// The judge always runs: with no agent or judge set it asks (in a terminal) or stops before any result, and a judge that
// does not answer stops it with its cause. The plain checks are steps of the judged result, never a result alone.
// run: a verify run's folder (the judge's call records go to its agents/), its judge-step hook, and the checkout and config it checks.
async function runCheck(argv, run) {
    const { values, positionals } = parseArgs({
        args: argv,
        options: { outcome: { type: 'string' }, from: { type: 'string' }, judge: { type: 'string' }, 'claim-id': { type: 'string' }, 'trusted-ref': { type: 'string' }, 'citation-base': { type: 'string' } },
        allowPositionals: true,
    });
    if (values.judge !== undefined && !isJudgeRoute(values.judge))
        throw new UsageError(`--judge ${values.judge || '""'} is not a judge route; use claude-code, answerer:<agent> or a key route`, 'Same form as judge.route: claude-code, answerer:opencode, answerer:pi, answerer:gemini or openai:key');
    if (values['citation-base']?.trim() === '')
        throw new UsageError('--citation-base needs a non-empty directory');
    if (!!values.outcome === !!values.from)
        throw new UsageError('check needs exactly one of --outcome or --from');
    if (values.from && positionals.length)
        throw new UsageError('--from takes no file arguments; the Checks block names them');
    if (values['claim-id']?.trim() === '')
        throw new UsageError('--claim-id needs a non-empty id');
    const repo = run?.repo ?? repoRoot();
    let projectText = null;
    if (values['trusted-ref']) {
        try {
            projectText = git(repo, 'show', `${values['trusted-ref']}:.done-done.yaml`);
        }
        catch (e) {
            const msg = e.stderr ?? '';
            if (!/does not exist|exists on disk, but not in/.test(msg))
                throw new UsageError(`cannot read .done-done.yaml at ${values['trusted-ref']}: ${msg.trim()}`);
            projectText = '';
        }
    }
    const cfg = run?.cfg ?? loadConfig(repo, projectText);
    // --judge overrides judge.route for this call; a model set for the configured route is not the new route's, so it falls back to that agent's default.
    if (values.judge !== undefined && values.judge !== cfg.judge.route)
        cfg.judge = { ...cfg.judge, route: values.judge, model: '' };
    const now = head(repo);
    const findings = [];
    let claim;
    let prBranch;
    if (values.outcome) {
        if (!positionals.length)
            throw new UsageError('--outcome needs at least one evidence file');
        claim = { outcome: values.outcome, files: positionals, title: '' };
    }
    else {
        const src = readSource(values.from);
        prBranch = src.branch;
        // A local file or stdin has no PR title, so the HEAD commit subject is the title.
        const title = src.title ?? git(repo, 'log', '-1', '--format=%s');
        claim = claimFromChecks(src.body, title, repo, cfg, findings);
    }
    if (claim?.notProven)
        throw new UsageError(`check: the judge was not asked, so there is no verdict: not proven: ${claim.notProven}`, 'Capture real proof, replace "not proven:" with its files, and re-run this check');
    const files = (claim?.files ?? []).map((name) => values['citation-base'] === undefined ? name : resolve(values['citation-base'], name));
    const records = loadRecords(cfg);
    const seen = new Map();
    const hashes = [];
    const cited = [];
    const captures = [];
    // The run behind each cited capture, for the real-product rule and the receipt.
    const runs = new Map();
    const warnings = [];
    // base_ref: a capture in <run id>/before/ of a run that drove its base ref pairs with <run id>/<the same name>.
    const pairOf = (inRoot) => {
        const [id, dir, ...rest] = inRoot?.split(sep) ?? [];
        return dir === BEFORE && rest.length && records.some((r) => r.run_id === id && r.base) ? join(id, ...rest) : null;
    };
    const befores = new Map();
    const heads = [];
    // Citations are the paths `run` printed: repo-relative inside the repo, absolute outside it.
    // Resolve a relative citation against the repo root first, so a check from a subdirectory
    // finds the same evidence (a worker cwd once false-failed real proof as missing/ENOENT),
    // then against the caller's cwd, so a shell-relative path typed for this shell still works.
    const cite = (name) => {
        if (isAbsolute(name))
            return name;
        const atRoot = resolve(repo, name);
        if (existsSync(atRoot))
            return atRoot;
        const atCwd = resolve(name);
        return existsSync(atCwd) ? atCwd : atRoot;
    };
    for (const name of files) {
        const path = cite(name);
        let bytes;
        try {
            if (!statSync(path).isFile())
                throw new Error('not a regular file');
            bytes = readFileSync(path);
        }
        catch (e) {
            const atCwd = !isAbsolute(name) && resolve(name) !== path ? ` or ${resolve(name)}` : '';
            const missing = e.code !== 'ENOENT' ? undefined : under(cfg.evidence.root, path) === null ? 'checkout' : 'run';
            findings.push({ level: 'fail', why: `${name}: no such file (looked for ${path}${atCwd}${e.code ? `, ${e.code}` : ''})`, missing });
            continue;
        }
        const v = checkMedia(path, bytes);
        if (v.status !== 'ok')
            findings.push({ level: v.status === 'fail' ? 'fail' : 'inconclusive', why: `${name}: ${v.why}` });
        const hash = sha256(bytes);
        hashes.push(hash);
        cited.push({ path: receiptPath(repo, cfg, path), sha256: hash });
        // A page-check record is a capture's companion: two clean cells of one page write the same bytes, and the judge never reads one.
        const record = !!cfg.dom && isDomRecord(name);
        const inRoot = under(cfg.evidence.root, path);
        const pair = pairOf(inRoot);
        if (cfg.dom && !pair && ['png', 'jpeg', 'webp', 'gif', 'mp4', 'webm'].includes(v.type))
            for (const why of domIssues(cfg.dom, path, cfg.look))
                findings.push({ level: 'fail', why: `${name}: ${why}` });
        // A base capture may equal its head capture byte for byte: the pair's judge, not this check, says the screen did not change.
        if (seen.has(hash) && !record && !pair)
            findings.push({ level: 'fail', why: `${name}: byte-identical to ${seen.get(hash)}` });
        if (!pair)
            seen.set(hash, name);
        // A file in the evidence root is claimed by the record that lists its path; a copy elsewhere, by its bytes.
        const claims = records.filter((r) => r.files.some((f) => f.sha256 === hash && (inRoot === null || f.path === inRoot)));
        if (!claims.length && inRoot !== null) {
            const edited = records.filter((r) => r.files.some((f) => f.path === inRoot));
            if (edited.length) {
                findings.push({ level: 'fail', why: `${name}: changed after run ${edited.map((r) => r.run_id).join(', ')}` });
                continue;
            }
        }
        if (v.status === 'fail')
            continue;
        if (!claims.length) {
            findings.push({ level: 'inconclusive', why: `${name}: not in any done-done run record, so it is not tied to a commit` });
            continue;
        }
        // Identical bytes (a deterministic capture) are claimed by every run that wrote them; a run at the current commit is enough.
        // With none, records from before runs had their own folders can both claim one file; never guess which run wrote it.
        const atNow = claims.filter((r) => r.commit === now.commit);
        if (!atNow.length && claims.length > 1) {
            findings.push({ level: 'inconclusive', why: `${name}: claimed by more than one run (${claims.map((r) => r.run_id).join(', ')}), so it is not tied to one commit` });
            continue;
        }
        const rec = (atNow.length ? atNow : claims).reduce((a, b) => (b.started_at > a.started_at ? b : a));
        runs.set(rec.run_id, { run_id: rec.run_id, commit: rec.commit, journey: rec.journey, command: rec.command, ...(rec.feature && { feature: rec.feature }), ...(rec.tool && { tool: rec.tool }), ...(rec.steps && { steps: rec.steps }), ...(rec.steps_error && { steps_error: rec.steps_error }) });
        // Only a capture tied to a run record can reach the judge, so a stray cited file is never sent.
        const c = { name, bytes, sha256: hash, media: v };
        if (v.status === 'ok' && !record && pair)
            befores.set(pair, c);
        else if (v.status === 'ok' && !record) {
            captures.push(c);
            if (rec.base)
                heads.push([c, inRoot, rec]);
        }
        const kept = [];
        const stale = staleness(repo, cfg, rec.commit, now.commit, rec, kept);
        for (const w of kept)
            if (!warnings.includes(w))
                warnings.push(w);
        if (stale)
            findings.push({ level: 'fail', why: `${name}: ${stale} (run ${rec.run_id})` });
        if (rec.dirty && !cfg.evidence.allow_dirty)
            findings.push({ level: 'fail', why: `${name}: captured from a tree with uncommitted changes (run ${rec.run_id}); commit them, then capture again` });
        if (rec.exit !== null && rec.exit !== 0)
            findings.push({ level: 'fail', why: `${name}: its run command exited ${rec.exit} (run ${rec.run_id})` });
    }
    // The approved inventory is the contract, not the subset the claim happened to cite. Enforce it on every
    // claim when configured, so rewording a design-done/release outcome cannot bypass missing screens.
    const approved = cfg.approved_design.map(entry => ({ entry, live: captures.filter(c => screen(c) && basename(cite(c.name)) === entry.capture) }));
    const coverageFaults = [];
    for (const { entry: e, live } of approved) {
        const label = `${e.screen} / ${e.size} / ${e.theme}`;
        if (live.length !== 1)
            coverageFaults.push(`${label}: ${live.length ? 'ambiguous live captures' : 'no live capture'} (${e.capture})`);
        else if (`${live[0].media.w}x${live[0].media.h}` !== e.size)
            coverageFaults.push(`${label}: live capture is ${live[0].media.w}x${live[0].media.h}, not the approved size`);
    }
    // Approved assets, color tokens and interactions: each needs its own live capture, or an explicit exclusion with a reason.
    const requirements = cfg.approved_requirements.filter(r => r.capture).map(r => ({ r, live: captures.filter(c => screen(c) && basename(cite(c.name)) === r.capture) }));
    for (const { r, live } of requirements)
        if (live.length !== 1)
            coverageFaults.push(`${r.kind} ${r.name}: ${live.length ? 'ambiguous live captures' : 'no live capture'} (${r.capture})`);
    // Committed approved reference images (design/, mocks/ ...) that no manifest row or exclusion accounts for.
    const accounted = new Set([...cfg.approved_design.map(e => e.mock), ...cfg.approved_requirements.flatMap(r => [r.mock, r.kind === 'reference' ? r.name : undefined])]);
    const unlisted = claim ? git(repo, 'ls-files', '-z', '--', ':(icase)design*/**', ':(icase)mock*/**', ':(icase)approved*/**', ':(icase)prototype*/**').split('\0').filter(f => /\.(png|jpe?g)$/i.test(f) && !accounted.has(f)) : [];
    if (unlisted.length)
        coverageFaults.push(`approved reference material is not in the approved_design manifest: ${unlisted.join(', ')}; list each as an approved_design screen, an approved_requirements mock, or {kind: reference, name: <path>, exclusion: <reason>}`);
    // A design or output claim must be compared to the approved result (a manifest mock, or the base_ref baseline), not only rendered.
    const compared = approved.length > 0 || requirements.some(({ r }) => r.mock) || heads.some(([c]) => c.before);
    if (claim && !compared && DESIGN_CLAIM.test(claim.outcome))
        coverageFaults.push('not compared to approved result: the claim is about design or output but nothing is compared to an approved reference or a same-model baseline; add an approved_design manifest (or an approved_requirements row with a mock) or set base_ref, because render, fit and dark-mode checks alone do not prove it');
    for (const why of coverageFaults)
        findings.push({ level: 'fail', why: `approved design: ${why}` });
    // A head capture of a base_ref run with no base capture of its name is reported, then judged alone.
    for (const [c, inRoot, rec] of heads)
        if (!(c.before = befores.get(inRoot ?? '')))
            findings.push({ level: 'inconclusive', why: `${c.name}: no base capture to compare with: the drive at base_ref ${rec.base.ref} saved no ${join(BEFORE, inRoot ? relative(rec.run_id, inRoot) : c.name)}${rec.base.error ? ` (${rec.base.error})` : ''}`, file: c.name });
    // The capture matrix: every required cell needs a capture named with its suffix, never silently missing.
    if (hasMatrix(cfg.matrix))
        for (const c of matrixManifest(cfg.matrix, files.filter((f) => (!cfg.dom || !isDomRecord(f)) && !pairOf(under(cfg.evidence.root, cite(f))))).cells.filter((c) => !c.files.length))
            findings.push({ level: 'fail', why: `cell ${c.cell} has no capture: name one file *${c.suffix}* (journeys name captures with DONE_DONE_CELL)` });
    // Real product: a config of only code-only journeys, or captures that all come from code-only runs, are no proof.
    const codeConfig = configFault(cfg.journeys);
    if (codeConfig)
        findings.push({ level: 'fail', why: codeConfig });
    const codeRuns = runs.size ? runsFault([...runs.values()]) : null;
    if (codeRuns)
        findings.push({ level: 'fail', why: codeRuns });
    // The user steps behind the captures: a cited real run needs a step record covering the claim. Runs from before step records warn.
    if (claim && runs.size && !codeRuns) {
        const s = stepsFault([...runs.values()], claim.outcome);
        if (s.fault)
            findings.push({ level: 'fail', why: s.fault });
        if (s.warning)
            warnings.push(s.warning);
    }
    // Reuse: fail only when every cited file was already used for a different claim id. The ledger lives in the
    // evidence root next to the run records it guards: one per app (repo), shared by every checkout of it, never in git.
    const ledger = join(cfg.evidence.root, '.done-done', 'ledger');
    const given = values['claim-id']?.replace(/\s+/g, ' ').trim();
    // A detached HEAD (a worktree, a PR checkout) has no branch, so its claim is the commit it checks.
    const branch = git(repo, 'branch', '--show-current');
    const claimId = given || prBranch || branch || (claim ? now.commit : '');
    const idFrom = given ? '--claim-id' : prBranch ? 'the PR branch' : branch ? 'the current branch' : 'the detached HEAD commit';
    const used = new Map();
    if (existsSync(ledger))
        for (const line of readFileSync(ledger, 'utf8').split('\n')) {
            const [h, k] = [line.slice(0, 64), line.slice(65)];
            if (k)
                used.set(h, (used.get(h) ?? new Set()).add(k));
        }
    const others = (h) => [...(used.get(h) ?? [])].filter((k) => k !== claimId);
    if (hashes.length && hashes.every((h) => others(h).length))
        findings.push({ level: 'fail', why: `every evidence file was already used as proof of a different claim (claim id ${[...new Set(hashes.flatMap(others))].join(', ')}), not this one (claim id ${claimId}, from ${idFrom}); if it is the same claim, pass --claim-id with its id` });
    // A failed plain check is no verdict: the judge is not asked, so the check stops with every cause and no result.
    const failed = findings.filter((f) => f.level === 'fail');
    if (coverageFaults.length) {
        const rep = report(findings, files, { cfg, repo, claim: claim?.outcome, source: values.from, citationBase: values['citation-base'], warnings });
        return { ...rep, claim: claim?.outcome, files, cited, runs: [...runs.values()], head: now, findings, warnings };
    }
    if (failed.length || !claim) {
        const ctx = { cfg, repo, claim: claim?.outcome, source: values.from, citationBase: values['citation-base'] };
        throw new UsageError(`check: the judge was not asked, so there is no verdict: ${failed.map((f) => f.why).join('; ')}`, checkHelp(FAIL, findings, files, ctx)[0]);
    }
    let judgeBlock;
    let judgeLevel;
    if (!captures.some(judgeable))
        throw new UsageError(`check: the judge was not asked, so there is no verdict: ${[...findings.map((f) => f.why), 'no cited capture is one the judge reads (a PNG or JPEG screen, or a text capture, from a done-done run)'].join('; ')}`, 'Cite a screen or a text capture of the outcome from a done-done run, then re-run this check');
    // No result without the judge: once the plain checks pass, with none set it asks the user, or stops with the command that saves one.
    await withChoice('judge', cfg);
    run?.judging(findings.length ? INCONCLUSIVE : PASS, [...findings]);
    const author = () => (run?.author ? agentRun(cfg, run.author.agent, run.author.model) : judgeAuthor(cfg));
    const j = await judge(cfg, () => selectJudge(cfg, author()), claim.outcome, captures, run ? join(run.dir, 'agents') : join(home(), 'agents'), () => selectFallback(cfg, author()));
    // The judge's next step leads the help when its verdict decides the result.
    if (j.judged.some((r) => r.verdict === 'fail'))
        judgeLevel = 'fail';
    else if (!findings.length && j.judged.some((r) => r.verdict === 'unsure'))
        judgeLevel = 'inconclusive';
    const shots = new Set(captures.filter(screen).map((c) => c.name));
    for (const r of j.judged.filter((r) => r.verdict !== 'pass'))
        findings.push({ level: r.verdict === 'fail' ? 'fail' : 'inconclusive', why: `${r.path}: judge says ${r.verdict !== 'fail' ? 'unsure' : shots.has(r.path) ? 'wrong screen' : 'wrong output'}: ${r.reason}`, file: r.path, ...(r.seen && { seen: r.seen }) });
    for (const part of j.missing)
        findings.push({ level: 'inconclusive', why: `the outcome names ${part}, but no passing capture shows it: capture ${part} and cite that capture` });
    const rows = cap(j.judged);
    const { choice } = j;
    const judged = { ...(choice && { route: choice.route, model: choice.model, independence: choice.independence, author: choice.author.agent ? `${choice.author.agent} (model ${choice.author.model || 'none'})` : 'no agent set' }), ...(j.detail && { detail: j.detail }), judged: rows.items.map(({ sha256, ...r }) => r) };
    if (choice) {
        const byHash = new Map(captures.map((c) => [c.sha256, receiptPath(repo, cfg, cite(c.name))]));
        judgeBlock = { route: choice.route, model: choice.model, independence: choice.independence, author: choice.author, verdicts: j.judged.map((r) => ({ path: byHash.get(r.sha256), sha256: r.sha256, verdict: r.verdict, ...(r.seen && { seen: r.seen }) })) };
    }
    if (rows.omitted)
        judged.judged_omitted = rows.omitted;
    if (j.notJudged.length)
        judged.not_judged = j.notJudged;
    judged.note = 'PNG and JPEG screens and text captures (logs, JSON, CLI output) are judged; video and other files are not';
    const pairUp = (label, mockFile, live, size) => {
        const path = resolve(repo, mockFile);
        let committed;
        try {
            committed = execFileSync('git', ['show', `${values['trusted-ref'] ?? now.commit}:${relative(repo, path)}`], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
        }
        catch {
            throw new UsageError(`approved design: ${label}: approved mock is not committed: ${mockFile}`);
        }
        if (under(repo, realpathSync(path)) === null)
            throw new UsageError(`approved design: mock leaves the repo: ${mockFile}`);
        const mock = loadScreen(path);
        if (mock.sha256 !== sha256(committed))
            throw new UsageError(`approved design: approved mock differs from the committed reference: ${mockFile}`);
        if (size && `${mock.media.w}x${mock.media.h}` !== size)
            throw new UsageError(`approved design: ${label}: mock has the wrong pixel size`);
        return { ...live, mock };
    };
    const agentRecords = run ? join(run.dir, 'agents') : join(home(), 'agents');
    let matches = [];
    if (approved.length) {
        const pairs = approved.map(({ entry, live }) => pairUp(`${entry.screen} / ${entry.size} / ${entry.theme}`, entry.mock, live[0], entry.size));
        const verdicts = await design(cfg, choice, pairs, agentRecords);
        matches = verdicts.map((v, i) => {
            const { screen, size, theme } = approved[i].entry;
            if (v.verdict !== 'pass')
                findings.push({ level: 'fail', why: `approved design: ${screen} / ${size} / ${theme}: ${v.verdict === 'unsure' ? 'match not proven: ' + v.reason : v.defects.map(d => `${d.kind}: ${d.where}`).join('; ')}`, file: v.path });
            const mock = pairs[i].mock;
            const mockPath = receiptPath(repo, cfg, cite(mock.name));
            if (!cited.some(f => f.path === mockPath))
                cited.push({ path: mockPath, sha256: mock.sha256 });
            return { screen, size, theme, path: receiptPath(repo, cfg, cite(v.path)), sha256: pairs[i].sha256, mock: mockPath, mock_sha256: mock.sha256, verdict: v.verdict };
        });
        if (judgeBlock)
            judgeBlock.approved_design = matches;
    }
    const withMock = requirements.filter(({ r }) => r.mock);
    if (withMock.length) {
        const pairs = withMock.map(({ r, live }) => pairUp(`${r.kind} ${r.name}`, r.mock, live[0]));
        const verdicts = await design(cfg, choice, pairs, agentRecords);
        for (const [i, v] of verdicts.entries()) {
            const { r } = withMock[i];
            if (v.verdict !== 'pass')
                findings.push({ level: 'fail', why: `approved design: ${r.kind} ${r.name}: ${v.verdict === 'unsure' ? 'match not proven: ' + v.reason : v.defects.map(d => `${d.kind}: ${d.where}`).join('; ')}`, file: v.path });
        }
    }
    const touches = await interactions(cfg, choice, captures, agentRecords);
    for (const r of touches) {
        r.captures = r.captures.map(c => ({ ...c, path: receiptPath(repo, cfg, cite(c.path)) }));
        if (r.status === 'flagged')
            findings.push({ level: 'fail', why: `interaction checklist: ${r.id}: flagged: ${r.reason}` });
    }
    if (judgeBlock && touches.length)
        judgeBlock.interaction_checklist = touches;
    const rep = report(findings, files, { cfg, repo, claim: claim.outcome, source: values.from, citationBase: values['citation-base'], judge: judged, judgeLevel, warnings });
    if (touches.length)
        rep.result.interaction_checklist = touches;
    if (matches.length)
        rep.result.design = matches;
    const excluded = cfg.approved_requirements.filter(r => r.exclusion).map(({ kind, name, exclusion }) => ({ kind, name, exclusion }));
    if (excluded.length)
        rep.result.approved_exclusions = excluded;
    if (rep.code === PASS) {
        mkdirSync(dirname(ledger), { recursive: true });
        appendFileSync(ledger, hashes.filter((h) => !used.get(h)?.has(claimId)).map((h) => `${h} ${claimId}\n`).join(''));
    }
    return { code: rep.code, result: rep.result, judge: judged, judgeBlock, claim: claim?.outcome, skill: claim?.skill, files, cited, runs: [...runs.values()], head: now, findings, warnings };
}
async function cmdCheck(argv) {
    const r = await runCheck(argv);
    emit(r.result);
    return r.code;
}
const receiptsDir = (cfg) => join(cfg.evidence.root, '.done-done', 'receipts');
// A receipt names a cited file relative to the repo, or to an evidence root outside it under this prefix,
// so any checkout of the repo finds the same file.
const IN_EVIDENCE = '<evidence root>/';
function receiptPath(repo, cfg, p) {
    const inRepo = under(repo, p);
    if (inRepo !== null)
        return inRepo;
    const inRoot = under(cfg.evidence.root, p);
    return inRoot === null ? p : IN_EVIDENCE + inRoot;
}
function writeReceipt(cfg, rec) {
    const path = join(receiptsDir(cfg), `${rec.head}.json`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.tmp`, `${JSON.stringify(rec, null, 2)}\n`, { mode: 0o600 });
    renameSync(`${path}.tmp`, path);
    return path;
}
// Why a parsed receipt is not a well-formed passing one (a judge block that names its judge and passes only captures the receipt cites,
// and capture runs that are not all code-only), or null.
function receiptFault(rec, short) {
    if (!rec || typeof rec !== 'object' || rec.schema !== 2 || rec.result !== 'pass' || !Array.isArray(rec.files) || !rec.files.length)
        return `receipt for ${short} is malformed`;
    if (!rec.files.every((f) => f && typeof f === 'object' && typeof f.path === 'string' && typeof f.sha256 === 'string'))
        return `receipt for ${short} is malformed`;
    const j = rec.judge;
    const badJudge = !j || typeof j !== 'object' || typeof j.route !== 'string' || typeof j.model !== 'string' || !['agent', 'model', 'session-only'].includes(j.independence) || !Array.isArray(j.verdicts) || !j.verdicts.length
        || !j.verdicts.every((v) => v && v.verdict === 'pass' && rec.files.some((f) => f.path === v.path && f.sha256 === v.sha256));
    if (badJudge)
        return `receipt for ${short} has a malformed judge block`;
    if (j.approved_design !== undefined && (!Array.isArray(j.approved_design) || !j.approved_design.length || !j.approved_design.every(v => v && v.verdict === 'pass' && [v.screen, v.size, v.theme].every(s => typeof s === 'string' && s.trim()) && rec.files.some(f => f.path === v.path && f.sha256 === v.sha256) && rec.files.some(f => f.path === v.mock && f.sha256 === v.mock_sha256))))
        return `receipt for ${short} has a malformed approved-design verdict`;
    if (j.interaction_checklist !== undefined) {
        const rows = j.interaction_checklist;
        if (!Array.isArray(rows) || rows.length !== Object.keys(INTERACTIONS).length || new Set(rows.map(r => r?.id)).size !== rows.length || !rows.every(r => r && Object.hasOwn(INTERACTIONS, r.id) && typeof r.reason === 'string' && r.reason.trim() && Array.isArray(r.captures) && (r.status === 'not_applicable' ? !r.captures.length : r.status === 'pass' && r.captures.length && r.captures.every(c => c && rec.files.some(f => f.path === c.path && f.sha256 === c.sha256)))))
            return `receipt for ${short} has a malformed interaction-checklist verdict`;
    }
    const code = runsFault(rec.runs);
    if (code)
        return `receipt for ${short} is no real-product proof: ${code}`;
    const steps = stepsFault(rec.runs, rec.claim);
    return steps.fault ? `receipt for ${short} has no step record covering its claim: ${steps.fault}` : null;
}
// The warning a well-formed receipt still carries: its runs were recorded before step records.
const receiptWarning = (rec) => stepsFault(rec.runs, rec.claim).warning;
// Verify a recorded receipt for `headArg`, which may be a full sha or a ref (HEAD, a branch or a tag).
// Read-only, so a missing or changed record is a failure, not a usage error.
function verifyReceipt(repo, cfg, headArg) {
    let commit = headArg;
    try {
        commit = git(repo, 'rev-parse', '--verify', `${headArg}^{commit}`);
    }
    catch {
        // Unresolvable: keep the argument so the lookup below fails with the current "no receipt" shape.
    }
    const short = commit.slice(0, 12);
    const path = join(receiptsDir(cfg), `${commit}.json`);
    const fail = (reason) => ({ code: FAIL, result: { command: 'receipt', result: 'fail', head: commit, reason, help: ['Record a passing check for this head: done-done receipt --from <file|->'] } });
    if (!existsSync(path))
        return fail(`no receipt for ${short} in ${receiptsDir(cfg)}`);
    let rec;
    try {
        rec = JSON.parse(readFileSync(path, 'utf8'));
    }
    catch (e) {
        return fail(`receipt for ${short} is malformed (${e.message})`);
    }
    const fault = receiptFault(rec, short);
    if (fault)
        return fail(fault);
    const j = rec.judge;
    if (rec.head !== commit)
        return fail(`receipt records head ${String(rec.head).slice(0, 12)}, not ${short}`);
    const now = head(repo);
    if (now.commit !== commit)
        return fail(`HEAD is ${now.commit.slice(0, 12)}, not ${short}`);
    const records = loadRecords(cfg);
    const bad = [];
    for (const f of rec.files) {
        let bytes;
        try {
            bytes = readFileSync(f.path.startsWith(IN_EVIDENCE) ? join(cfg.evidence.root, f.path.slice(IN_EVIDENCE.length)) : resolve(repo, f.path));
        }
        catch (e) {
            bad.push(`${f.path}: no such file (looked for ${f.path.startsWith(IN_EVIDENCE) ? join(cfg.evidence.root, f.path.slice(IN_EVIDENCE.length)) : resolve(repo, f.path)}${e.code ? `, ${e.code}` : ''})`);
            continue;
        }
        if (sha256(bytes) !== f.sha256) {
            // The receipt names a path a run recorded: the file was edited after its run.
            const inRoot = f.path.startsWith(IN_EVIDENCE) ? f.path.slice(IN_EVIDENCE.length) : under(cfg.evidence.root, resolve(repo, f.path));
            const edited = inRoot !== null ? records.filter((r) => r.files.some((rf) => rf.path === inRoot)) : [];
            bad.push(edited.length ? `${f.path}: changed after run ${edited.map((r) => r.run_id).join(', ')} (hash changed)` : `${f.path}: hash changed`);
        }
    }
    if (bad.length)
        return fail(`cited evidence no longer matches the receipt: ${bad.join('; ')}`);
    return { code: PASS, result: { command: 'receipt', result: 'pass', head: commit, tree: rec.tree, claim: rec.claim, ...(rec.skill && { skill: rec.skill }), files: rec.files.length, at: rec.at, schema: rec.schema, judge: j, ...(receiptWarning(rec) && { warnings: [receiptWarning(rec)] }), help: ['This receipt is valid for this head.'] } };
}
async function cmdReceipt(argv) {
    const vi = argv.indexOf('--verify');
    let verifyHead = null;
    let rest = argv;
    if (vi >= 0) {
        verifyHead = argv[vi + 1] ?? null;
        if (!verifyHead || verifyHead.startsWith('--'))
            throw new UsageError('receipt --verify needs a head sha or ref');
        rest = [...argv.slice(0, vi), ...argv.slice(vi + 2)];
    }
    const repo = repoRoot();
    const cfg = loadConfig(repo);
    if (verifyHead) {
        if (rest.length)
            throw new UsageError('receipt --verify takes no other arguments');
        return emitted(verifyReceipt(repo, cfg, verifyHead));
    }
    if (!rest.length)
        throw new UsageError('receipt needs a claim (--outcome "<claim>" <files...> or --from <file|->) or --verify <head>');
    assertCleanForReceipt(repo);
    return emitted(recordReceipt(repo, cfg, await runCheck(rest)));
}
function assertCleanForReceipt(repo) {
    if (head(repo).dirty)
        throw new UsageError('receipt: tracked files have uncommitted changes, so no receipt was written; commit or revert them, then re-run receipt', 'Commit the tracked changes, then: done-done receipt --from <file|->');
}
// Write the receipt for a check that passed on a clean tree and cited evidence, or say why none was written.
function recordReceipt(repo, cfg, r) {
    if (r.code !== PASS || !r.judgeBlock)
        return { code: r.code === PASS ? INCONCLUSIVE : r.code, result: { ...r.result, command: 'receipt', reason: 'the check did not pass its judge, so no receipt was written' } };
    assertCleanForReceipt(repo);
    // A missing citation is not a verdict: the judge passed, but the receipt cannot bind it, so it stops like a judge error.
    if (!r.cited.length)
        throw new UsageError('receipt: the check cited no evidence files, so no receipt was written; a receipt must bind at least one cited evidence file', 'Cite real proof: done-done receipt --outcome "<claim>" <files...>');
    const rec = { schema: 2, repo: cfg.app, head: r.head.commit, tree: r.head.tree, claim: r.claim ?? '', ...(r.skill && { skill: r.skill }), result: 'pass', at: new Date().toISOString(), files: r.cited, runs: r.runs, judge: r.judgeBlock };
    const path = writeReceipt(cfg, rec);
    const result = { command: 'receipt', result: 'pass', head: r.head.commit, tree: r.head.tree, claim: rec.claim, ...(rec.skill && { skill: rec.skill }), files: rec.files.length, receipt: shown(repo, path), ...(r.warnings.length && { warnings: r.warnings }) };
    return { code: PASS, result: { ...result, ...(r.judge && { judge: r.judge }), help: [`Verify this receipt (merge gate): done-done receipt --verify ${r.head.commit}`] } };
}
// Why evidence from `from` no longer proves `to`, or '' if it still does.
function staleness(repo, cfg, from, to, run, warnings = []) {
    if (from === to)
        return '';
    let changed;
    try {
        changed = git(repo, 'diff', '--name-only', from, to).split('\n').filter(Boolean);
    }
    catch {
        return `evidence is for commit ${from.slice(0, 12)}, which is not in this repository`;
    }
    const outside = changed.filter((p) => !cfg.evidence.ignore_paths.some((g) => matchesGlob(p, g)));
    if (changed.length && !outside.length)
        return '';
    // A head change that touches no journey or feature the run covered leaves its proof valid; both commits are reported.
    const needs = outside.filter((p) => !p.startsWith(`${GATE_DIR}/`));
    if (run && (run.journey || run.feature) && needs.length) {
        const m = mapDiff(repo, cfg, needs, git(repo, 'ls-files', '-z').split('\0').filter(Boolean));
        if (!m.journeys.some((j) => j.name === run.journey) && !m.features.some((f) => f.name === run.feature)) {
            warnings.push(`run ${run.run_id} is for commit ${from.slice(0, 12)} and HEAD is ${to.slice(0, 12)}: its ${run.journey ? `journey ${run.journey}` : `feature ${run.feature}`} is untouched by the ${needs.length} changed file${needs.length === 1 ? '' : 's'} (done-done affected)`);
            return '';
        }
    }
    if (run && changed.length && !needs.length) {
        warnings.push(`run ${run.run_id} is for commit ${from.slice(0, 12)} and HEAD is ${to.slice(0, 12)}: only gate receipts changed`);
        return '';
    }
    return `evidence is for commit ${from.slice(0, 12)}, HEAD is ${to.slice(0, 12)}${outside.length ? ` (changed: ${outside.slice(0, 3).join(', ')}${outside.length > 3 ? ', ...' : ''})` : ''}`;
}
// Quote an argument only when a shell would split it.
const arg = (a) => (/^[\w./@:+-]+$/.test(a) ? a : `'${a.replaceAll("'", `'\\''`)}'`);
function checkHelp(code, findings, files, { cfg, repo, claim, source, citationBase, judgeLevel }) {
    if (judgeLevel === 'fail' && code === FAIL)
        return [`Capture the screen the outcome describes, then re-run this check: ${captureHint(cfg)}`];
    if (judgeLevel && code === INCONCLUSIVE)
        return ['Look at the capture yourself, or capture a clearer screen of the outcome and re-run this check'];
    if (code === PASS) {
        // The merge gate needs a PR on a remote; without one, a receipt records the pass locally.
        const citationArgs = citationBase === undefined ? '' : ` --citation-base ${arg(citationBase)}`;
        if (spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: repo }).status === 0)
            return [`Gate the merge on this proof: done-done check --from <PR URL> --trusted-ref origin/main${citationArgs}`];
        const claimArgs = source ? ['--from', source] : ['--outcome', claim ?? '', ...files];
        return [`Record this pass for HEAD: done-done receipt ${claimArgs.map(arg).join(' ')}${citationArgs}`];
    }
    const capture = captureHint(cfg);
    if (code === INCONCLUSIVE)
        return [`Capture this proof through a run so it is tied to a commit, then re-run this check: ${capture}`];
    // A named file outside this checkout is not lost: point at the folder that holds it first. Re-capture is for proof the run should have written here.
    const help = [];
    const absent = findings.filter((f) => f.missing === 'checkout').length;
    if (absent) {
        const form = source ? `done-done check --from ${arg(source)} --citation-base <dir>` : 'done-done check --outcome <claim> <files...> --citation-base <dir>';
        help.push(citationBase === undefined
            ? `${absent} named file${absent > 1 ? 's are' : ' is'} not in this checkout. If the evidence is in another folder, check against it: ${form}`
            : `${absent} named file${absent > 1 ? 's are' : ' is'} not under --citation-base ${arg(citationBase)} either: check the paths in the Checks block`);
    }
    if (findings.some((f) => f.why.includes('step record')))
        help.push(`Have the journey write ${STEPS_FILE} into $DONE_DONE_EVIDENCE_ROOT, shaped ${STEPS_SHAPE}, naming the steps and the result the claim is about; then re-run it (${captureHint(cfg)}) and cite the new files`);
    // Proof refused as code-only needs a journey that drives the product, not a re-capture of the same run.
    if (findings.some((f) => f.why.endsWith(RULE)))
        help.push(`Capture the real product: ${captureHint(cfg).startsWith('done-done init') ? captureHint(cfg) : `${captureHint(cfg)}, or ${RECORD_REAL}`}, then cite its files`);
    else if (findings.some((f) => f.level === 'fail' && f.missing !== 'checkout'))
        help.push(`Commit your change, re-capture with ${capture}, then check the new files`);
    return help;
}
function report(findings, files, ctx) {
    const code = findings.some((f) => f.level === 'fail') ? FAIL : findings.length ? INCONCLUSIVE : PASS;
    const result = {
        command: 'check',
        result: code === PASS ? 'pass' : code === FAIL ? 'fail' : 'inconclusive',
    };
    if (ctx.claim)
        result.claim = ctx.claim;
    if (ctx.source)
        result.source = ctx.source;
    if (files.length) {
        const ev = cap(files);
        result.files = files.length;
        result.evidence = ev.items;
        if (ev.omitted)
            result.evidence_omitted = ev.omitted;
    }
    if (ctx.judge)
        result.judge = ctx.judge;
    const rows = cap(findings.map((f) => ({ level: f.level, why: f.why, ...(f.seen && { seen: f.seen }) })));
    if (rows.items.length)
        result.findings = rows.items;
    if (rows.omitted)
        result.findings_omitted = rows.omitted;
    if (ctx.warnings?.length)
        result.warnings = ctx.warnings;
    result.help = checkHelp(code, findings, files, ctx);
    return { code, result };
}
const CLI_PATH = fileURLToPath(import.meta.url);
const HEARTBEAT_MS = 5_000;
// A run that never recorded its runner's pid this long after it was created has no runner.
const STALE_MS = 60_000;
const runsRoot = (app) => join(home(), 'runs', app);
const verifySteps = (cfg) => ['resolve', 'drive', 'check', 'judge', ...(cfg.auto_fix.verify ? ['triage', 'fix'] : []), 'gate', 'receipt', 'report'];
// Commands an agent drive must not run: they answer a gate, write a receipt or start a run that can write one.
const DRIVE_REFUSED = ['respond', 'receipt', 'verify', 'rerun', 'maintain', 'after-commit', 'journey'];
// One agent drive may launch the app, drive it and save captures; past this it is killed with everything it started.
const DRIVE_SCHEMA = {
    type: 'object',
    properties: { feature: { type: 'string' }, captures: { type: 'array', items: { type: 'string' } }, blocker: { type: 'string' } },
    required: ['feature', 'captures', 'blocker'],
};
const now = () => new Date().toISOString();
const errorText = (e) => (e.stderr || e.message || String(e)).trim();
const killGroup = (pgid) => {
    try {
        process.kill(-pgid, 'SIGKILL');
    }
    catch {
        // The group already exited.
    }
};
const createOnce = (path) => {
    try {
        writeFileSync(path, '', { flag: 'wx' });
        return true;
    }
    catch {
        return false;
    }
};
const evidenceOf = (repo, cfg, rec) => rec.files.map((f) => citable(repo, join(cfg.evidence.root, f.path)));
// Every run of an app, from any checkout of it. A run.json that cannot be read stops the command, never skipped silently.
const runsIn = (root) => (existsSync(root) ? readdirSync(root).filter((n) => existsSync(join(root, n, 'run.json'))).map((n) => {
    try {
        return loadRun(join(root, n));
    }
    catch (e) {
        throw new UsageError(`cannot read the run record ${join(root, n, 'run.json')}: ${e.message}`, `Fix or remove ${join(root, n)}, then run this again`);
    }
}) : []);
// Default run: the newest run of this checkout, as status does.
function pickId(root, repo, cmd, cfg, id) {
    const mine = runsIn(root).filter((r) => r.repo === repo);
    const found = id ?? mine.sort((a, b) => a.created.localeCompare(b.created)).pop()?.run_id;
    if (!found)
        throw new UsageError(`no runs for ${cfg.app} in this checkout yet`, `Start one: done-done verify ${Object.keys(cfg.journeys).length > 1 ? '<journey> ' : ''}--outcome "<what a user can now do>"`);
    if (!/^[\w-]+$/.test(found) || !existsSync(join(root, found, 'run.json')))
        throw new UsageError(`no run ${found} in ${root}`, `Show the newest run: done-done ${cmd}`);
    return found;
}
function skillHash(repo, cfg) {
    const dir = join(repo, cfg.skill);
    if (!existsSync(dir))
        return '';
    try {
        const files = readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name)).sort();
        const h = createHash('sha256');
        for (const f of files)
            h.update(readFileSync(f));
        return h.digest('hex');
    }
    catch {
        return '';
    }
}
// Every file the guard can see: tracked files plus untracked ones, git-ignored ones included.
function guardCandidates(at) {
    let listed;
    try {
        listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others'], { cwd: at, encoding: 'utf8', maxBuffer: Infinity, stdio: ['ignore', 'pipe', 'pipe'] });
    }
    catch (e) {
        throw new Error(`input guard: cannot list the repo files: ${e.message.split('\n')[0]}`);
    }
    return [...new Set(listed.split('\0').filter(Boolean))].sort();
}
// Node's matchesGlob skips dotfiles, so a watched glob matches them itself: '**' spans folders, '*' and '?' stay in one.
const GLOB_TOKEN = /(\*\*\/|\*\*|\*|\?|\{[^}]*\}|\[[^\]]*\])/;
const globEscape = (s) => s.replace(/[.+^$()|\\]/g, '\\$&');
function guardGlob(p) {
    const part = (t, i) => {
        if (i % 2 === 0)
            return globEscape(t);
        if (t === '**/')
            return '(?:.*/)?';
        if (t === '**')
            return '.*';
        if (t === '*')
            return '[^/]*';
        if (t === '?')
            return '[^/]';
        return t[0] === '{' ? `(?:${t.slice(1, -1).split(',').map(globEscape).join('|')})` : t;
    };
    return new RegExp(`^${p.split(GLOB_TOKEN).map(part).join('')}$`);
}
function guardSnapshot(at, patterns) {
    if (!patterns.length)
        return [];
    let candidates;
    const listed = () => (candidates ??= guardCandidates(at));
    let links;
    const folderLinks = () => (links ??= listed().filter((c) => lstatSync(join(at, c), { throwIfNoEntry: false })?.isSymbolicLink() && statSync(join(at, c), { throwIfNoEntry: false })?.isDirectory()));
    const paths = new Set();
    for (const raw of patterns) {
        const p = inputPattern(raw);
        const glob = /[*?{\[]/.test(p);
        const folder = !glob && existsSync(join(at, p)) && statSync(join(at, p)).isDirectory();
        if (glob || folder) {
            const base = glob ? p.slice(0, p.search(/[*?{\[]/)).replace(/\/[^/]*$/, '') : p;
            const link = folderLinks().find((s) => base === '' || s === base || s.startsWith(`${base}/`) || base.startsWith(`${s}/`));
            if (link)
                throw new Error(`input guard: ${p} reaches ${link}, a symlink to a folder`);
        }
        if (glob) {
            const re = guardGlob(p);
            for (const c of listed())
                if (c === p || c.startsWith(`${p}/`) || re.test(c))
                    paths.add(c);
        }
        else if (folder) {
            for (const c of listed())
                if (c.startsWith(`${p}/`))
                    paths.add(c);
        }
        else
            paths.add(p);
    }
    const root = realpathSync(at);
    return [...paths].sort().map((path) => {
        const full = join(at, path);
        const st = statSync(full, { throwIfNoEntry: false });
        if (!st)
            return { path, sha256: null };
        if (!st.isFile())
            throw new Error(`input guard: ${path} is not a plain file`);
        if (!realpathSync(full).startsWith(`${root}${sep}`))
            throw new Error(`input guard: ${path} links outside the repo`);
        try {
            return { path, sha256: sha256(readFileSync(full)) };
        }
        catch (e) {
            throw new Error(`input guard: cannot read ${path}: ${e.message.split('\n')[0]}`);
        }
    });
}
// Each difference names only its path, never file contents.
function guardDiff(before, after) {
    const a = new Map(after.map((f) => [f.path, f.sha256]));
    const b = new Map(before.map((f) => [f.path, f.sha256]));
    const out = [];
    const push = (path, verb) => out.push({ path, why: `${path}: ${verb} during the drive` });
    for (const [path, h] of b) {
        const g = a.get(path);
        if (h === null && g !== null && g !== undefined)
            push(path, 'appeared');
        else if (h !== null && g !== null && g !== undefined && g !== h)
            push(path, 'changed');
        else if (h !== null && (g === null || g === undefined))
            push(path, 'disappeared');
    }
    for (const [path, g] of a)
        if (g !== null && !b.has(path))
            push(path, 'appeared');
    return out.sort((x, y) => (x.why < y.why ? -1 : 1));
}
// The drive's input is the journey command, or for an agent drive the author agent and model that drove it.
function inputsOf(repo, cfg, journey, author) {
    const h = head(repo);
    const j = journey === null ? undefined : cfg.journeys[journey];
    const drive = journey === null ? `agent\n${author?.agent ?? ''}\n${author?.model ?? ''}` : `${j?.command ?? ''}\n${j?.timeout ?? '30m'}`;
    return { head: h.commit, journey: sha256(Buffer.from(drive)), skill: skillHash(repo, cfg) };
}
// The verify skill features an agent can drive: features/<name>.md, minus the index.
function skillFeatures(repo, cfg) {
    try {
        return readdirSync(join(repo, cfg.skill, 'features')).filter((n) => n.endsWith('.md') && n !== 'README.md').map((n) => n.slice(0, -3)).sort();
    }
    catch {
        return [];
    }
}
// Who drives a run with no journey: the author agent, which must be one done-done can let drive. A usage error now, never a
// failed run later. Returns the author and the feature to drive.
async function agentDrive(repo, cfg, feature) {
    const skill = join(cfg.skill, 'SKILL.md');
    if (!existsSync(join(repo, skill)))
        throw new UsageError(`verify needs a journey or a verify skill to drive the app, and this repo has neither (no ${skill})`, 'Scaffold the verify skill: done-done init, or record a journey: done-done init --journey <name> -- <command that drives the real app>');
    const features = skillFeatures(repo, cfg);
    const name = feature?.replace(/^features\//, '').replace(/\.md$/, '');
    if (name !== undefined && !features.includes(name))
        throw new UsageError(`no feature ${feature} in ${cfg.skill}/features; it has: ${features.join(', ') || 'none'}`, `Run: done-done verify --feature <${features.join('|') || 'name'}> --outcome "<what a user can now do>"`);
    // The author is the agent the user set; with none, ask (in a terminal) or stop with the command that saves the answer.
    await withChoice('agent', cfg);
    const a = selectAgent(cfg);
    if (!a.path)
        throw new UsageError(`verify needs an agent to drive the app: ${notStartable(a.agent, a.override)}`, `Install ${a.agent}, or save the agent the user chooses: done-done init --agent <agent> --model <model>; or record a journey: done-done init --journey <name> -- <command>`);
    if (a.agent.startsWith('acp:'))
        throw new UsageError(`${a.agent} cannot drive the app: done-done runs ACP agents with every tool denied`, `Set agent: to one of ${AGENTS.join(', ')}, or record a journey: done-done init --journey <name> -- <command>`);
    return { author: { agent: a.agent, model: a.model }, feature: name ?? (features.length === 1 ? features[0] : undefined) };
}
// The drive prompt: the claim, where the verify skill and its feature recipe are, and where captures go. The judge never sees it.
// With a verify skill and no journey, the next step can be an agent drive.
const driveHint = (repo, cfg) => existsSync(join(repo, cfg.skill, 'SKILL.md'))
    ? ['Have your coding agent drive a verify skill feature: done-done verify --outcome "<what a user can now do>" [--feature <name>]'] : [];
// The page-check record shape and how to collect it with chrome-devtools-axi, for the drive prompt.
const DOM_RECORD = '{"url": "<page url>", "overflow": <true when content is wider than the viewport>, "overflowing": ["<element>", ...], "console_errors": ["<message>", ...], "failed_requests": [{"url": "<url>", "status": <HTTP status, 0 when none>}], "squashed_text": [{"element": "<element>", "text": "<text>", "chars": <width in characters>, "lines": <n>, "words": <n>}]}'
    + `; with your browser tool (for example chrome-devtools-axi): overflow from eval "() => { const w = document.documentElement.clientWidth; return { overflow: document.documentElement.scrollWidth > w, overflowing: [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > w + 1).slice(0, 10).map((e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '')) } }", console errors from console --type error, failed requests (status 400 or more, or no response) from network, squashed_text from eval "${SQUASHED_TEXT}" exactly as written (in every frame, an embedded one too)`;
function drivePrompt(run, at, cfg, evidence, scratch, base = '') {
    const skill = join(at, cfg.skill);
    const recipe = run.feature ? `the feature recipe ${join(skill, 'features', `${run.feature}.md`)}` : `its feature map ${join(skill, 'features', 'README.md')}, then pick the one feature the outcome is about`;
    const inst = cfg.instance ? `\n\nThe app is already running at $DONE_DONE_BASE_URL (started by done-done on its own port with its own HOME; DONE_DONE_PORT is its port). Drive that instance: do not start your own server or hard-code a port.` : '';
    const matrix = hasMatrix(cfg.matrix) ? splitMatrix(cfg.matrix) : null;
    const cells = !matrix ? '' : `\n\nThe repo asks for every theme x width x form cell below: drive each cell (theme and width are the recipe's job) and save one PNG per cell whose file name holds its suffix, e.g. ${evidence}/home.<suffix>.png:\n${matrix.required.map((c) => `- ${cellName(c)}: *${cellSuffix(c)}*`).join('\n')}${matrix.skipped.length ? `\nSkipped (capture nothing for these):\n${matrix.skipped.map((s) => `- ${cellName(s.cell)} (${s.reason})`).join('\n')}` : ''}`;
    const dom = cfg.dom ? `\n\nThe repo checks each page: next to every capture write its page-check record, the capture's name with .dom.json for its extension (e.g. home.dom.json for home.png), as the verify skill's Evidence section says: ${DOM_RECORD}. Record what the page shows; never fix the page.` : '';
    const before = base ? `\n\nYour working directory is the base ref ${base}, before the change, so the outcome is not expected to hold here and that is no blocker: drive the same path and save the same screens under the same file names, showing them as they are before the change.` : '';
    return `You drive the real ${run.app} app the way a user does, to capture proof of one outcome. Someone else judges your captures.

Outcome to prove: ${run.claim}
${inst}${cells}${dom}${before}
1. Read the verify skill ${join(skill, 'SKILL.md')} (how to launch, check, drive, capture and clean up this app) and ${recipe}.
2. ${cfg.instance ? 'Drive that running instance' : 'Launch the app as the skill says, then drive'} that feature through the real user path, step by step as its recipe says.
   Never add steps or data to make the outcome look true: capture what that path shows, even when it contradicts the outcome.
3. Save PNG screenshots of what a user sees once the path is done (the resulting state the outcome is about) into ${evidence} (also in $DONE_DONE_EVIDENCE_ROOT); when the outcome shows in text (a CLI's output, a log or JSON), save that text there as a .txt, .log or .json file instead.
   The judge checks every capture there against the outcome, so a capture of an earlier step (such as an empty or half-filled form, or text from before the outcome) fails the drive: keep those in ${scratch}. Save nothing else there but the step record of step 4, and never edit a capture.
4. Write ${STEPS_FILE} into ${evidence} (also in $DONE_DONE_EVIDENCE_ROOT), the record of what you did, as JSON shaped ${STEPS_SHAPE}: the app version you drove (its package or build version, else the commit), the state it started from, each step a user takes in your own words, and what a user can see at the end. Write what you did, never what the outcome needs.
5. Stop everything you started.

Do not change any file in the repository. Do not run done-done: it refuses inside a drive, and done-done answers the run after you stop. Put logs and other scratch files in ${scratch} (also in $TMPDIR), never in /tmp.
Keep working until all five steps are done: your next message without a tool call ends the drive and must be the answer.
If you cannot launch the app or reach the feature, say why in blocker and save no capture.
Answer with feature (the feature file you drove, such as features/<name>.md), captures (the file names you saved) and blocker ("" when you drove it),
for example {"feature":"features/<name>.md","captures":["<name>.png"],"blocker":""}.`;
}
// base_ref: the same drive at the base ref, in a done-done worktree removed after, with the same run id, instance and matrix env;
// its captures go to the run folder's before/. A failed base drive is recorded, not the run's failure: the check reports each
// head capture it left without a pair.
const BEFORE = 'before';
async function driveBase(run, cfg, dir, rec, fix, drive) {
    const base = (rec.base = { ref: cfg.base_ref, commit: '' });
    const evidence = join(runDir(cfg, rec.run_id), BEFORE);
    const wt = join(dir, `${fix}base`);
    try {
        base.commit = git(run.repo, 'rev-parse', '--verify', '--end-of-options', `${cfg.base_ref}^{commit}`);
        mkdirSync(evidence, { recursive: true });
        const error = await inWorktree(run.repo, wt, async () => {
            if (!cfg.instance)
                return drive(wt, evidence, {});
            const inst = await startInstance(wt, cfg.instance, rec.run_id, join(dir, `${fix}base-tmp`), process.env, join(dir, 'logs', `${fix}base-instance.log`));
            run.runner.instance_pgid = inst.pgid;
            return drive(wt, evidence, inst.env).finally(() => stopInstance(inst.pgid));
        }, base.commit);
        if (error)
            Object.assign(base, { error });
    }
    catch (e) {
        Object.assign(base, { error: base.commit ? errorText(e) : `base_ref ${cfg.base_ref} names no commit in this repo` });
    }
}
function saveRun(dir, run) {
    run.updated = now();
    const tmp = join(dir, `run.json.${process.pid}.tmp`);
    writeFileSync(tmp, `${JSON.stringify(run, null, 2)}\n`);
    renameSync(tmp, join(dir, 'run.json'));
}
const loadRun = (dir) => JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
const logEvent = (dir, e) => appendFileSync(join(dir, 'events.jsonl'), `${JSON.stringify({ at: now(), ...e })}\n`);
const setStep = (dir, run, s, status, extra = {}) => {
    Object.assign(s, { status, [status === 'running' ? 'started' : 'ended']: now() }, extra);
    logEvent(dir, { step: s.name, status });
    saveRun(dir, run);
};
// End a run: steps it never reached are skipped, and the report step records the result.
function finishRun(dir, run, result, reason) {
    for (const s of run.steps)
        if (s.status === 'pending' && s.name !== 'report')
            s.status = 'skipped';
    const report = run.steps.find((s) => s.name === 'report');
    setStep(dir, run, report, 'running');
    Object.assign(run, { result, reason, status: 'completed' });
    setStep(dir, run, report, 'completed');
}
// A run's steps in its runner. verify: resolve the head, drive (the journey, or the author agent), check its evidence, judge,
// gate on a judge that did not pass, record a receipt, report; only the agent drive and the judge call a model.
// maintain (maintain.ts) reads the verify skill and the source.
async function runSteps(dir) {
    const run = loadRun(dir);
    if (run.status === 'cancelled')
        return;
    const started = now();
    // The lock refuses a second runner on this run; it stays, so a finished run is never run again.
    writeFileSync(join(dir, 'runner.lock'), `${process.pid} ${started}\n`, { flag: 'wx' });
    run.status = 'running';
    run.runner = { pid: process.pid, started, heartbeat: started };
    saveRun(dir, run);
    logEvent(dir, { status: 'running', pid: process.pid });
    const beat = setInterval(() => {
        run.runner.heartbeat = now();
        saveRun(dir, run);
    }, HEARTBEAT_MS);
    let step;
    // A fix's re-run (auto_fix.verify) is quiet: it leaves the run's steps as they are, and its step logs go to `quiet`.
    let quiet = null;
    const set = (s, status, extra = {}) => quiet ?? setStep(dir, run, s, status, extra);
    // A step that starts skips the earlier steps still pending (the judge after a failed check, a fix that was not needed).
    const begin = (name) => {
        for (const s of quiet ? [] : run.steps.slice(0, run.steps.findIndex((s) => s.name === name)))
            if (s.status === 'pending')
                s.status = 'skipped';
        return (set((step = run.steps.find((s) => s.name === name)), 'running'), step);
    };
    const log = (name, result) => quiet ? void (quiet[name] = result) : writeFileSync(join(dir, 'logs', `${name}.log`), `${encode(result)}\n`);
    const finish = (result, reason) => {
        step = run.steps.find((s) => s.name === 'report');
        finishRun(dir, run, result, reason);
    };
    try {
        const cfg = loadConfig(run.repo);
        const spawned = (pgid) => {
            run.runner.journey_pgid = pgid;
            saveRun(dir, run);
        };
        if (run.kind === 'maintain')
            return await maintainSteps(run, dir, cfg, { begin, set, log, finish, spawned });
        const done = (n) => run.steps.find((s) => s.name === n).status === 'completed';
        const journey = run.journey === null ? undefined : cfg.journeys[run.journey];
        const command = journey?.command;
        const timeout = journey?.timeout ?? '30m';
        const limit = parseDuration(timeout);
        const reused = done('resolve');
        if (reused)
            logEvent(dir, { step: 'resolve', status: 'completed', reused: true });
        else
            begin('resolve');
        if (run.journey !== null && !command)
            throw new Error(`journey ${run.journey} is not in .done-done.yaml`);
        if (limit === null)
            throw new Error(`journeys.${run.journey}.timeout must be a duration such as 30m or 90s, not ${timeout}`);
        if (!reused)
            set(step, 'completed');
        // A journey that spends real money or credits never runs until the user approved spending for this run.
        if (journey?.spends && !run.spend && !done('drive')) {
            const cells = hasMatrix(cfg.matrix) ? splitMatrix(cfg.matrix).required.length : 0;
            const what = `journey ${run.journey} spends (${journey.spends}), so it runs only once the user approves spending for this run` + (cells ? `; the approval covers every matrix cell, so it runs ${cells} times, once per cell` : '');
            run.gate = { findings: [{ id: 'spend-1', severity: 'warning', what, action: 'ask-user' }], cited: [], head: head(run.repo), spend: journey.spends };
            run.status = 'awaiting_approval';
            set((step = run.steps.find((s) => s.name === 'drive')), 'awaiting_approval', { findings: run.gate.findings });
            return;
        }
        // One drive, check and judge of the claim at `at`: the user's checkout, or (`fix` names the re-run) a fix worktree.
        // With auto_fix.verify, a product failure (a drive the product stopped, a screen the judge calls wrong) may be fixed.
        const tries = cfg.auto_fix.verify ?? 0;
        const pass = async (at, fix = '') => {
            const id = fix ? `${run.run_id}-${fix}` : run.run_id;
            const fail = (reason, fixable = [], result = 'fail') => ({ end: { result, reason: `drive: ${reason}` }, asks: [], fixable });
            const reusing = !fix && done('drive') && !!run.record;
            begin('drive');
            const guardBefore = reusing ? [] : guardSnapshot(at, cfg.inputs);
            const scanRun = (files) => scanSecrets([...files, join(dir, 'logs'), join(dir, 'agents')], cfg.secrets);
            const secretWhy = (l) => `${shown(run.repo, l.file)}:${l.line}: holds a secret (${l.pattern}); remove it, or allow a known-safe match with secrets.allow in .done-done.yaml`;
            const evidenceFiles = () => rec.files.map((f) => join(cfg.evidence.root, f.path));
            // Every failed drive is scanned too: a leak replaces the reason, so unscanned agent or instance text never echoes a secret, and a leaking log excerpt never reaches the fix agent.
            const failScanned = (reason, files, fixable = [], result = 'fail') => {
                const leak = scanRun(files)[0];
                return leak ? fail(`secrets: ${secretWhy(leak)}`) : fail(reason, fixable, result);
            };
            let rec;
            if (reusing) {
                rec = JSON.parse(readFileSync(run.record, 'utf8'));
                set(step, 'completed');
            }
            else if (run.journey === null) {
                // The author agent drives the feature in its own process group, so a timeout, an abort or a dead runner stops it
                // and the app it launched; a drive that changed tracked files would prove code that is not committed.
                const author = run.author;
                rec = { ...openRun(at, cfg, null, null, id), author };
                const evidence = runDir(cfg, rec.run_id);
                const tracked = () => sha256(execFileSync('git', ['diff', 'HEAD', '--binary'], { cwd: at, maxBuffer: Infinity, stdio: ['ignore', 'pipe', 'pipe'] }));
                const before = tracked();
                const scratch = join(dir, 'tmp');
                mkdirSync(scratch, { recursive: true });
                // With an instance block the app is already running at $DONE_DONE_BASE_URL; the drive uses it, never a fixed port.
                // The agent keeps its own HOME and XDG folders (its login lives there); only the app runs isolated.
                let instPort = {};
                if (cfg.instance) {
                    try {
                        const inst = await startInstance(at, cfg.instance, rec.run_id, scratch, process.env, join(dir, 'logs', `${fix}instance.log`));
                        run.runner.instance_pgid = inst.pgid;
                        saveRun(dir, run);
                        instPort = inst.env;
                    }
                    catch (e) {
                        set(step, 'failed');
                        return failScanned(`instance: ${e.message}`, []);
                    }
                }
                const drive = (where, evidence, env, base = '') => askAgent({
                    ...agentRun(cfg, author.agent, author.model), prompt: drivePrompt(run, where, cfg, evidence, scratch, base), schema: DRIVE_SCHEMA, cwd: where, tools: 'edit',
                    record: join(dir, 'agents', `${fix}${base ? 'base-' : ''}drive.json`), dirs: [evidence, scratch], env: { DONE_DONE_RUN_ID: rec.run_id, DONE_DONE_DRIVE: rec.run_id, DONE_DONE_EVIDENCE_ROOT: evidence, TMPDIR: scratch, ...env },
                    onSpawn: spawned,
                });
                const a = await drive(at, evidence, instPort);
                if (run.runner?.instance_pgid)
                    stopInstance(run.runner.instance_pgid);
                const answer = a.answer;
                const blocker = String(answer?.blocker ?? '').trim();
                rec.exit = a.ok && !blocker ? 0 : 1;
                const changed = tracked() !== before;
                if (cfg.base_ref && !rec.exit && !changed)
                    await driveBase(run, cfg, dir, rec, fix, async (where, evidence, env) => {
                        // The same drive: the head's verify skill, copied into the base worktree, where the agent may read it.
                        cpSync(join(at, cfg.skill), join(where, cfg.skill), { recursive: true, force: true });
                        const b = await drive(where, evidence, env, cfg.base_ref);
                        return b.ok ? String(b.answer?.blocker ?? '').trim() : `${author.agent} did not finish the drive: ${b.error}`;
                    });
                const picked = typeof answer?.feature === 'string' ? answer.feature.replace(/^.*features\//, '').replace(/\.md$/, '') : '';
                if (skillFeatures(at, cfg).includes(picked))
                    run.feature ??= picked;
                if (run.feature)
                    rec.feature = run.feature;
                const sealed = closeRun(at, cfg, rec);
                if (!fix)
                    run.record = join(recordsDir(cfg), `${rec.run_id}.json`);
                log('drive', { agent: author.agent, model: author.model, feature: run.feature ?? 'none', ...(a.ok ? { captures: answer?.captures, blocker } : { error: a.error }), record: a.record ?? a.recordError });
                const why = !a.ok ? `${author.agent} did not finish the drive: ${a.error}${a.record ? `; call record ${a.record}` : ''}`
                    : blocker ? `${author.agent} could not drive the feature: ${blocker}`
                        : changed ? `${author.agent} changed tracked files in the repo during the drive (see git status), so its captures are not of the committed code`
                            : sealed.code !== PASS ? sealed.reason : '';
                set(step, why ? 'failed' : 'completed', { exit: rec.exit, outputs: evidenceOf(run.repo, cfg, rec) });
                // Only a blocker says the product stopped the drive; a lost or bad answer is the agent's own failure.
                if (why)
                    return failScanned(why, evidenceFiles(), a.ok && blocker && !changed ? [{ kind: 'drive', file: `features/${run.feature || picked || 'README'}.md`, what: why }] : []);
            }
            else {
                rec = openRun(at, cfg, run.journey, command.replaceAll('${RUN_ID}', id), id);
                const logFile = join(dir, 'logs', `${fix}drive.log`);
                const fd = openSync(logFile, 'a');
                // With an instance block the app starts first on its own port; the journey talks to $DONE_DONE_BASE_URL.
                let instEnv = {};
                if (cfg.instance) {
                    try {
                        const scratch = join(dir, 'tmp');
                        mkdirSync(scratch, { recursive: true });
                        const inst = await startInstance(at, cfg.instance, rec.run_id, scratch, process.env, join(dir, 'logs', `${fix}instance.log`));
                        run.runner.instance_pgid = inst.pgid;
                        instEnv = inst.env;
                    }
                    catch (e) {
                        closeSync(fd);
                        set(step, 'failed');
                        return failScanned(`instance: ${e.message}`, []);
                    }
                }
                // With a matrix block the journey runs once per required cell with that cell in env.
                const matrix = hasMatrix(cfg.matrix) ? splitMatrix(cfg.matrix).required : null;
                const failed = [];
                rec.exit = 0;
                let timedOut = false;
                let running;
                // The timeout bounds the whole verify run's journey: it kills the cell running now and stops the loop.
                const timer = setTimeout(() => {
                    timedOut = true;
                    if (running)
                        killGroup(running);
                }, limit);
                for (const cell of matrix ?? [{}]) {
                    // An async child keeps the heartbeat going while the journey runs. The journey gets its own process group, so a
                    // timeout or a dead runner can kill it and everything it started.
                    const child = spawn(rec.command, { cwd: at, shell: true, detached: true, stdio: ['ignore', fd, fd], env: { ...process.env, DONE_DONE_RUN_ID: rec.run_id, DONE_DONE_EVIDENCE_ROOT: runDir(cfg, rec.run_id), ...instEnv, ...(matrix ? cellEnv(cell) : {}) } });
                    run.runner.journey_pgid = child.pid;
                    running = child.pid;
                    saveRun(dir, run);
                    const code = await new Promise((done) => child.on('close', (c) => done(c ?? 1)));
                    running = undefined;
                    if (timedOut) {
                        failed.push(`${cellName(cell)} (timed out after ${timeout})`);
                        if (!rec.exit)
                            rec.exit = 1;
                        break;
                    }
                    if (code !== 0) {
                        if (!rec.exit)
                            rec.exit = code;
                        failed.push(`${cellName(cell)} (exit ${code})`);
                    }
                }
                clearTimeout(timer);
                if (run.runner?.instance_pgid)
                    stopInstance(run.runner.instance_pgid);
                if (cfg.base_ref && !failed.length)
                    await driveBase(run, cfg, dir, rec, fix, async (where, evidence, env) => {
                        for (const cell of matrix ?? [{}]) {
                            const child = spawn(rec.command, { cwd: where, shell: true, detached: true, stdio: ['ignore', fd, fd], env: { ...process.env, DONE_DONE_RUN_ID: rec.run_id, DONE_DONE_EVIDENCE_ROOT: evidence, ...env, ...(matrix ? cellEnv(cell) : {}) } });
                            spawned(child.pid);
                            const timer = setTimeout(() => killGroup(child.pid), limit);
                            const code = await new Promise((done) => child.on('close', (c) => done(c ?? 1)));
                            clearTimeout(timer);
                            if (code)
                                return `the journey exited ${code} for cell ${cellName(cell)}`;
                        }
                        return '';
                    });
                closeSync(fd);
                const sealed = closeRun(at, cfg, rec);
                if (!fix)
                    run.record = join(recordsDir(cfg), `${rec.run_id}.json`);
                set(step, failed.length || sealed.code !== PASS ? 'failed' : 'completed', { exit: rec.exit, outputs: evidenceOf(run.repo, cfg, rec) });
                if (timedOut)
                    return failScanned(`journey timed out after ${timeout}`, evidenceFiles(), [], 'inconclusive');
                if (matrix && failed.length)
                    return failScanned(`the journey command failed for cell ${failed.join('; ')}`, evidenceFiles());
                if (sealed.code !== PASS)
                    return failScanned(sealed.reason, evidenceFiles(), tries && /^the run command exited/.test(sealed.reason) ? [{ kind: 'drive', file: run.journey, what: `the journey ${sealed.reason}; the end of its output:\n${readFileSync(logFile, 'utf8').slice(-2000)}` }] : []);
            }
            if (!reusing && cfg.inputs.length)
                run.guarded = { patterns: cfg.inputs, before: guardBefore, after: guardSnapshot(at, cfg.inputs) };
            begin('check');
            const files = evidenceFiles();
            // No secret may sit in the evidence or the run's logs: a hit fails the run naming the file, line and pattern, never the value.
            const leaks = scanRun(files).map((l) => ({ level: 'fail', why: secretWhy(l) }));
            if (leaks.length) {
                log('check', { result: 'fail', findings: leaks });
                set(step, 'failed', { exit: FAIL, findings: leaks });
                return { end: { result: 'fail', reason: `secrets: ${leaks[0].why}` }, asks: [], fixable: [] };
            }
            // The input guard: the drive must leave the watched inputs alone. A difference fails the check step,
            // naming each path but never file contents; the before/after hash lists stay in the run record.
            if (run.guarded) {
                const diffs = guardDiff(run.guarded.before, run.guarded.after);
                if (diffs.length) {
                    const findings = diffs.map((d) => ({ level: 'fail', why: d.why }));
                    set(step, 'failed', { exit: 1, findings });
                    log('check', { result: 'fail', findings });
                    return { end: { result: 'fail', reason: `check: input guard: ${diffs.map((d) => d.why).join('; ')}` }, asks: [], fixable: [] };
                }
            }
            // The check's own findings end the check step; the judge, when the check did not fail, is its own step.
            let checkFindings = 0;
            const judging = (code, findings) => {
                checkFindings = findings.length;
                set(step, code === PASS ? 'completed' : 'failed', { exit: code, findings });
                begin('judge');
            };
            // A fix worktree is detached, so it checks for the claim id of the user's branch.
            const claimId = run.claim_id ?? (fix ? git(run.repo, 'branch', '--show-current') : null);
            const checked = await runCheck(['--outcome', run.claim, ...files, ...(claimId ? ['--claim-id', claimId] : [])], { dir, judging, author: run.author, repo: at, cfg });
            const logged = { ...checked.result, findings: checked.findings };
            delete logged.findings_omitted;
            log('check', logged);
            const judgeRan = step.name === 'judge';
            const judgeFindings = judgeRan ? checked.findings.slice(checkFindings) : [];
            if (judgeRan) {
                log('judge', checked.judge);
                set(step, judgeFindings.length ? 'failed' : 'completed', { exit: judgeFindings.length ? checked.code : PASS, findings: judgeFindings });
            }
            else
                set(step, checked.code === PASS ? 'completed' : 'failed', { exit: checked.code, findings: checked.findings });
            // The gate: when the check itself is clean but the judge did not pass a capture (or read none, or not all of an agent's),
            // the run waits for the caller (respond), who can move it on but never make it a pass. The runner ends here.
            const clean = judgeRan && checkFindings === 0;
            const notJudged = clean && run.journey === null ? (checked.judge?.not_judged ?? []) : [];
            const asks = !clean ? [] : [...judgeFindings, ...notJudged.map((name) => ({ level: 'inconclusive', why: `${name}: the judge did not read this capture, and an agent drive passes only with a judge pass on every capture` }))];
            // With auto_fix.verify, screens the judge calls wrong (and nothing it was unsure of) are a product failure to fix.
            if (tries && asks.length && asks.every((f) => f.level === 'fail'))
                return { checked, end: { result: 'fail', reason: `judge: ${asks[0].why}` }, asks: [], fixable: wrongScreens(asks) };
            if (asks.length)
                return { checked, asks, fixable: [] };
            if (checked.code !== PASS)
                return { checked, end: { result: checked.code === FAIL ? 'fail' : 'inconclusive', reason: `${judgeFindings.length ? 'judge' : 'check'}: ${(judgeFindings[0] ?? checked.findings[0])?.why ?? 'did not pass'}` }, asks: [], fixable: [] };
            return { checked, asks: [], fixable: [] };
        };
        const h = { begin, set, log, spawned };
        let p = await pass(run.repo);
        let fixed = false;
        // auto_fix.verify: the judge sorts the product failures first (an ask parks the run at the gate); then a checkout with
        // uncommitted tracked changes is never fixed, since the fix starts from the committed head.
        if (tries && p.end && p.fixable.length && journey?.spends)
            p.end = { ...p.end, reason: `${p.end.reason}; auto_fix.verify does not re-run a spends journey` };
        if (tries && p.end && p.fixable.length && !journey?.spends) {
            const sorted = await sortJudged(run, cfg, failures(p.fixable), join(dir, 'agents', 'triage.json'), h);
            if (sorted.length)
                p = { checked: p.checked, asks: sorted, fixable: [] };
            else {
                const dirty = dirtyTracked(run.repo);
                if (dirty.length) {
                    run.findings = failures(p.fixable);
                    return finish('blocked', `dirty: uncommitted changes to tracked files (${named(dirty)}), so done-done does not fix this run (${p.end.reason}); commit them, or set auto_fix: { verify: 0 }, then run again`);
                }
                const f = await fixVerify(run, cfg, dir, p, tries, h, async (at, fix) => { const logs = (quiet = {}); const fixStep = step; try {
                    return { ...(await pass(at, fix)), logs };
                }
                finally {
                    quiet = null;
                    step = fixStep;
                } });
                if ('blocked' in f)
                    return finish('blocked', `fix: ${f.blocked}`);
                p = f;
                fixed = true;
            }
        }
        if (p.asks.length) {
            // auto_fix.verify never fixes a mixed result (wrong screens and unsure ones): the judge sorts the wrong ones, then all park.
            const wrong = p.asks.filter((f) => f.level === 'fail');
            if (tries && wrong.length && wrong.length < p.asks.length) {
                const sorted = await sortJudged(run, cfg, failures(wrongScreens(wrong)), join(dir, 'agents', `triage${fixed ? '-gate' : ''}.json`), h, true);
                p.asks = [...sorted, ...p.asks.filter((f) => f.level !== 'fail')];
            }
            begin('gate');
            const findings = p.asks.map((f, i) => ({ id: `gate-${i + 1}`, severity: f.level === 'fail' ? 'error' : 'warning', what: f.why, action: 'ask-user' }));
            const checked = p.checked;
            run.gate = { findings, cited: checked.cited, head: { commit: checked.head.commit, tree: checked.head.tree }, ...(checked.judgeBlock && { judge: checked.judgeBlock }) };
            run.status = 'awaiting_approval';
            set(step, 'awaiting_approval', { findings });
            return;
        }
        if (p.end)
            return finish(p.end.result, p.end.reason);
        begin('receipt');
        const receipt = recordReceipt(run.repo, cfg, { ...p.checked, ...(run.journey === null && existsSync(join(run.repo, cfg.skill)) && { skill: basename(cfg.skill) }) });
        log('receipt', receipt.result);
        run.receipt = receipt.result.receipt;
        set(step, receipt.code === PASS ? 'completed' : 'failed', { exit: receipt.code });
        if (receipt.code !== PASS)
            return finish('fail', `receipt: ${receipt.result.reason}`);
        finish(fixed ? 'changed' : 'pass', fixed ? `your HEAD failed; the fix passes, on ${run.fix.branch}` : undefined);
    }
    catch (e) {
        for (const s of run.steps)
            if (s.status === 'pending')
                s.status = 'skipped';
        const name = step?.name ?? 'setup';
        const text = errorText(e);
        Object.assign(run, { status: 'failed', reason: text.startsWith(`${name}:`) ? text : `${name}: ${text}`, ...(e instanceof UsageError && { stopped: true }) });
        if (step)
            set(step, 'failed');
        else {
            logEvent(dir, { status: 'failed' });
            saveRun(dir, run);
        }
    }
    finally {
        clearInterval(beat);
    }
}
const failures = (list) => list.map((f, i) => ({ id: `F${i + 1}`, ...f }));
const wrongScreens = (asks) => asks.map((f) => ({ kind: 'judge', file: f.file ?? '', what: f.why }));
// What a verify fix never changes: the verify skill, .done-done.yaml, tests, test-runner configs and the checkout's copied ignored files. Other files a
// journey runs are not guarded, so review the fix branch.
const TEST_FILE = /(^|\/)(test|tests|__tests__|e2e|spec)\/|\.(test|spec)\.[^/]*$|_test\.(go|py)$|(^|\/)test_[^/]*\.py$|(^|\/)((playwright|jest|vitest|cypress)\.config\.[^/]*|cypress\.json)$/;
// The judge's question for a screen it called wrong: the claim is the truth unless it looks wrong or needs a decision.
const VERIFY_TRIAGE = {
    question: 'is a screen the judge called wrong for an outcome claim: the claim says what a user can now do, and the screen did not show it. Which side should change? The claim is the truth unless it looks wrong, ambiguous or in need of a product decision.',
    options: {
        fix: 'The product clearly misses a clear claim, so the product code should change to make the outcome hold.',
        ask: 'The claim may be wrong, is ambiguous, or the change needs a product decision, so a person must decide.',
        unclear: 'The text cannot settle which side should change.',
    },
    fix: 'fix',
};
// The judge the user set sorts the judge's failures before each fix: [] sends them all to the fixer;
// with any ask (or unsure answer), or `park`, every judge failure goes to the gate with its class. A judge that does not
// answer throws, so the run fails with the cause.
async function sortJudged(run, cfg, open, record, h, park = false) {
    const judged = open.filter((f) => f.kind === 'judge');
    if (!judged.length)
        return [];
    const step = h.begin('triage');
    const choice = selectJudge(cfg, selectAgent(cfg));
    const asks = await triage(cfg, choice, judged, VERIFY_TRIAGE, { app: cfg.app, outcome: run.claim, findings: judged }, record);
    h.log('triage', { judge: { route: choice.route, model: choice.model, independence: choice.independence }, ask_user: asks });
    h.set(step, 'completed');
    if (!(asks.length || park))
        return [];
    return judged.map((f) => ({ level: 'fail', why: `${(asks.find((x) => x.id === f.id) ?? f).what}; triage: ${asks.some((x) => x.id === f.id) ? 'ask' : 'fix'}`, file: f.file }));
}
// auto_fix.verify: the user's agent fixes product code in a done-done worktree at the verified head, done-done commits it and
// `again` verifies there, up to `tries` times; a pass or a gate keeps a done-done/verify-<run-id> branch, never the user's.
async function fixVerify(run, cfg, dir, first, tries, h, again) {
    const fixStep = h.begin('fix');
    const repo = run.repo;
    const skill = relative(repo, join(repo, cfg.skill));
    const agent = selectAgent(cfg);
    // done-done's own folders in the repo (an evidence root, DONE_DONE_HOME): a re-run writes there, so they are never the user's checkout.
    const own = [cfg.evidence.root, home()].map((p) => under(repo, p)).filter((p) => p !== null);
    const checkout = repoState(repo, own);
    const ignored = git(repo, 'ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory', ...pathspec(own)).split('\0').filter(Boolean);
    const carried = (p) => ignored.some((c) => p === c || (c.endsWith('/') && p.startsWith(c)));
    const off = (p) => p === '.done-done.yaml' || p.startsWith(`${skill}/`) || TEST_FILE.test(p) || carried(p);
    const wt = join(dir, 'fix');
    const scratch = join(dir, 'tmp');
    const rounds = [];
    let open = failures(first.fixable);
    const record = JSON.parse(readFileSync(run.record, 'utf8'));
    // The checkout's ignored state (node_modules, .env.local) is copied, never linked, into the worktree, and copied again over
    // whatever the fixer did to it before each re-run, so the re-run sees the fix commit with the user's own ignored files.
    // ponytail: a full copy each round (a clone where the file system can); a huge node_modules on ext4 is slow, link read-only if it bites.
    const carry = () => {
        git(wt, 'clean', '-fdqX');
        for (const p of ignored) {
            try {
                cpSync(join(repo, p), join(wt, p), { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
            }
            catch (e) {
                return `copy of your ignored ${p} into the fix worktree failed: ${errorText(e)}`;
            }
        }
    };
    const attempts = async (start) => {
        let base = start;
        const copied = carry();
        if (copied)
            return (h.set(fixStep, 'failed'), run.findings = open, { blocked: copied });
        for (let k = 1; k <= tries; k++) {
            const step = h.begin('fix');
            const round = { attempt: k, failures: open };
            rounds.push(round);
            const close = (status) => (h.log('fix', { agent: agent.agent, model: agent.model, worktree: wt, rounds }), h.set(step, status));
            const blocked = (reason, findings = open) => (Object.assign(round, { blocked: reason }), close('failed'), (run.findings = findings), { blocked: reason });
            const drive = run.journey === null ? `It drove the verify skill feature ${skill}/features/${run.feature ?? '<the one the outcome is about>'}.md the way a user does (${skill}/SKILL.md says how the app is launched).` : `It drove the app with this journey command: ${cfg.journeys[run.journey]?.command}`;
            const prompt = `You fix the ${cfg.app} app in this checkout, your working directory. done-done verify drove the real app to prove the outcome below, and it failed.
${drive}

Outcome to prove: ${run.claim}

Failures (JSON): ${JSON.stringify(open)}

Change the product's code so the outcome holds when a user takes that path. Never change the verify skill (${skill}/), .done-done.yaml, a test file (test/, tests/, __tests__/, e2e/, spec/, *.test.*, *.spec.*, *_test.go, *_test.py, test_*.py) or a test-runner config, and never make the outcome only look true. Do not commit, and do not run done-done. Put scratch files in ${scratch} (also in $TMPDIR).

Answer with summary (what you changed, in one line) and blocker ("" when you fixed it, else why you could not).`;
            mkdirSync(scratch, { recursive: true });
            // A re-run's edits and new files are not the fixer's to commit. Ignored ones (a build) stay.
            git(wt, 'reset', '-q', '--hard');
            git(wt, 'clean', '-fdq');
            const a = await askAgent({ ...agent, prompt, schema: FIX_SCHEMA, cwd: wt, tools: 'edit', record: join(dir, 'agents', `fix-${k}.json`), dirs: [scratch], env: { DONE_DONE_DRIVE: run.run_id, TMPDIR: scratch }, onSpawn: h.spawned });
            Object.assign(round, { record: a.record ?? a.recordError, ...(a.ok ? { summary: a.answer?.summary, blocker: a.answer?.blocker } : { error: a.error }) });
            // The diff guard: product code only, in the worktree only; anything else drops the attempt with the worktree.
            const changed = (round.changed = changedSince(wt, base, false));
            const problem = attemptProblem(repo, checkout, wt, base, agent.agent, a, changed, changed.filter(off), 'the verify skill, .done-done.yaml, a test file, a test-runner config or a copied ignored file of your checkout, which a fix never changes', 'the product', own);
            if (problem)
                return blocked(problem);
            if (!changed.length)
                return blocked(`${agent.agent} changed nothing`);
            const made = commitFix(wt, base, `fix: done-done verify fixes ${run.claim.slice(0, 60)}`, ['.']);
            if (typeof made === 'string')
                return blocked(made);
            if (made.files.some(off))
                return blocked('the commit holds the verify skill, .done-done.yaml, a test file, a test-runner config or a copied ignored file (a commit hook added them), so no branch is made');
            base = round.commit = made.commit;
            run.fix = { commit: made.commit, record: join(recordsDir(cfg), `${run.run_id}-fix${k}.json`) };
            // Verify again at the fix commit; its records are named fix<k>-, and the judge sorts its failures before the next fix.
            const recopied = carry();
            if (recopied)
                return blocked(recopied);
            const next = await again(wt, `fix${k}`);
            round.rerun = { result: next.end?.result ?? (next.asks.length ? 'gate' : 'pass'), reason: next.end?.reason, ...next.logs };
            if (next.end && !next.fixable.length)
                return blocked(`the re-run after attempt ${k} did not pass: ${next.end.reason}`, []);
            const sorted = next.end ? await sortJudged(run, cfg, failures(next.fixable), join(dir, 'agents', `triage-fix${k}.json`), h).catch((e) => { close('failed'); throw e; }) : [];
            if (!next.end || sorted.length) {
                run.fix.branch = `done-done/verify-${run.run_id}`;
                git(repo, 'branch', run.fix.branch, made.commit);
                close('completed');
                return sorted.length ? { checked: next.checked, asks: sorted, fixable: [] } : next;
            }
            open = failures(next.fixable);
            close('completed');
        }
        run.findings = open;
        return { blocked: `auto_fix.verify allows ${tries} ${tries === 1 ? 'attempt' : 'attempts'}, and the re-run still fails after them` };
    };
    return inWorktree(repo, wt, async (start) => {
        try {
            return await attempts(start);
        }
        finally {
            git(wt, 'clean', '-fdqX');
        }
    }, record.commit);
}
// EPERM: the pid is alive but not ours to signal. A pid reused by another process still reads as alive: the known limit of a pid check.
const alive = (pid) => {
    try {
        return process.kill(pid, 0);
    }
    catch (e) {
        return e.code === 'EPERM';
    }
};
const runnerGone = (run) => (run.runner ? !alive(run.runner.pid) : Date.now() - Date.parse(run.created) > STALE_MS);
const isOurRunner = (pid, dir) => {
    const r = spawnSync('ps', ['-p', String(pid), '-o', 'args='], { encoding: 'utf8' });
    return r.status === 0 && r.stdout.includes(`__runner ${dir}`);
};
const shownStatus = (run) => ((run.status === 'pending' || run.status === 'running') && runnerGone(run) ? 'failed' : run.status);
const reapJourney = (dir, run) => {
    if (run.runner?.journey_pgid && createOnce(join(dir, 'journey.killed')))
        killGroup(run.runner.journey_pgid);
    if (run.runner?.instance_pgid && createOnce(join(dir, 'instance.killed')))
        killGroup(run.runner.instance_pgid);
};
// The exit code a run's state means: 0 pass, 1 fail, 2 stopped, 3 inconclusive, 4 still running or waiting at its gate.
const runCode = (run, status) => status === 'pending' || status === 'running' || status === 'awaiting_approval' ? WAITING
    : run.stopped && status === 'failed' ? USAGE
        : status === 'cancelled' || status === 'failed' || run.result === 'fail' || run.result === 'drift' || (run.kind === 'verify' && (run.result === 'changed' || run.result === 'blocked')) ? FAIL
            : run.result === 'inconclusive' || run.result === 'blocked' ? INCONCLUSIVE
                : PASS;
// One run as status shows it. A run still marked running whose runner is gone is shown as failed at its step.
// `gone`: the caller saw its runner child exit, which also covers a runner that died before it wrote its pid.
function showRun(dir, cfg, command, gone = false) {
    const run = loadRun(dir);
    const rec = run.record ? JSON.parse(readFileSync(run.record, 'utf8')) : undefined;
    const at = run.steps.find((s) => s.status === 'running' || s.status === 'awaiting_approval') ?? run.steps.find((s) => s.status === 'pending');
    let { status, reason } = run;
    const open = status === 'pending' || status === 'running';
    if (open && (gone || runnerGone(run))) {
        status = 'failed';
        const beat = run.runner && Math.round((Date.now() - Date.parse(run.runner.heartbeat)) / 1000);
        reason = `the runner died at step ${at?.name}${run.runner ? ` (pid ${run.runner.pid}, last heartbeat ${beat}s ago)` : ' before it started'}`;
        reapJourney(dir, run);
    }
    const code = runCode(run, status);
    const drive = run.journey ?? (run.feature ? `--feature ${arg(run.feature)}` : '');
    const again = run.kind === 'maintain' ? 'done-done maintain' : `done-done verify ${drive ? `${drive} ` : ''}--outcome ${arg(run.claim)}${run.claim_id ? ` --claim-id ${arg(run.claim_id)}` : ''}`;
    const findings = cap(run.findings ?? []);
    const ev = cap(rec ? evidenceOf(run.repo, cfg, rec) : []);
    const result = { command, run_id: run.run_id, kind: run.kind, status };
    if (code === WAITING)
        result.step = at?.name;
    if (run.result && status === 'completed')
        result.result = run.result;
    if (reason)
        result.reason = reason;
    Object.assign(result, {
        ...(run.kind === 'verify' && { claim: run.claim, journey: run.journey }),
        ...(run.kind === 'verify' && run.journey === null && { feature: run.feature ?? 'picked by the agent', author: run.author && `${run.author.agent} (model ${run.author.model || 'its own default'})` }),
        repo: run.repo, ...(rec && { head: rec.commit }),
        steps: run.steps.map((s) => ({ name: s.name, status: s === at && (status === 'failed' || (status === 'cancelled' && (s.status === 'running' || s.status === 'awaiting_approval'))) ? status : s.status })),
    });
    if (status === 'awaiting_approval' && run.gate)
        result.findings = run.gate.findings;
    if (run.response)
        result.response = run.response;
    if (run.spend)
        result.spend = run.spend;
    if (run.signoff)
        result.signoff = run.signoff;
    if (ev.items.length)
        result.evidence = ev.items;
    if (ev.omitted)
        result.evidence_omitted = ev.omitted;
    if (rec?.matrix)
        result.matrix = rec.matrix;
    if (run.receipt)
        result.receipt = run.receipt;
    if (run.fix)
        result.fix = run.fix;
    if (run.git_status)
        result.git_status = run.git_status;
    if (findings.items.length)
        result.findings = findings.items;
    if (findings.omitted)
        result.findings_omitted = findings.omitted;
    const unverified = cap(run.unverified ?? []);
    if (unverified.items.length)
        result.unverified = unverified.items;
    if (unverified.omitted)
        result.unverified_omitted = unverified.omitted;
    result.run = shown(run.repo, dir);
    const id = run.run_id;
    result.help =
        status === 'awaiting_approval' && run.gate?.spend ? [
            `Ask the user whether to spend ${run.gate.spend} on this run; never decide it for them. Their yes runs the journey:`,
            `done-done respond --run ${id} --action approve --reason "<who approved the spend>"`,
            `Their no: done-done respond --run ${id} --action skip --reason "<why they said no>"   (ends fail, nothing spent)`,
        ]
            : status === 'awaiting_approval' ? [
                'The judge did not pass this run, and nothing moves a run past its judge. Read the findings and look at the captures (evidence above), then end it:',
                `done-done respond --run ${id} --action fix   (ends fail; fix the product, or the verify skill's recipe (done-done maintain checks it against the source), commit, then: done-done rerun --run ${id})`,
            ]
                : code === WAITING ? [`The run goes on without this command; read it later: done-done status --run ${run.run_id}`]
                    : run.kind === 'verify' && /^fix:/.test(run.reason ?? '') ? [`Read what each fix attempt did: done-done logs --step fix --run ${id}`, `Fix the product by hand, commit, then run again: ${again}`]
                        : run.result === 'changed' ? [`Review the fix on its own branch (your branch is untouched): git show ${run.fix.branch}`, `Take it: git merge ${run.fix.branch}, or drop it: git branch -D ${run.fix.branch}`]
                            : run.kind === 'maintain' && status === 'completed' ? (run.result === 'clean' ? [`The verify skill matches the source; read the readers' recipes: done-done logs --step reconcile --run ${run.run_id}`]
                                : run.result === 'drift' ? [`Fix the findings in ${cfg.skill} (--full lists them all), commit, then run again: ${again}`, `Or let done-done's agent fix them on a branch: set auto_fix: { maintain: 2 } in .done-done.yaml, then run again: ${again}`]
                                    : /^ask-user:/.test(run.reason ?? '') ? ['Ask the user about each ask-user finding: is the product or the skill wrong? Never decide it for them', `Product wrong: fix the product (maintain never edits product code). Skill wrong: fix ${cfg.skill}, commit, then run again: ${again}`]
                                        : /^fix:/.test(run.reason ?? '') ? [`Read what each fix attempt did: done-done logs --step fix --run ${run.run_id}`, `Fix the findings in ${cfg.skill} by hand, commit, then run again: ${again}`]
                                            : /^locate: no verify skill/.test(run.reason ?? '') ? ['Create the verify skill: done-done init']
                                                : /^locate:/.test(run.reason ?? '') ? [`Make ${cfg.skill} a real folder inside the repository (not a link), commit, then run again: ${again}`]
                                                    : [`Read the step logs in ${shown(run.repo, join(dir, 'logs'))}`, `Fix the cause, then run again: ${again}`])
                                : code === PASS ? [`Verify this receipt (merge gate): done-done receipt --verify ${rec.commit}`]
                                    : status === 'cancelled' ? [...(run.kind === 'maintain' ? [] : [`Start again from the failed step: done-done rerun --run ${run.run_id}`]), `List past runs: done-done history`]
                                        : [`Read the step logs in ${shown(run.repo, join(dir, 'logs'))}`, ...(run.kind === 'maintain' ? [] : [`Fix the cause, commit, then run again from the failed step: done-done rerun --run ${run.run_id}`]), `Or start a new run: ${again}`];
    emit(result);
    return code;
}
// A progress line on stderr every 60s (DONE_DONE_HEARTBEAT_MS overrides) naming the running step, so a caller that kills silent commands does not.
function heartbeat(dir) {
    const t = setInterval(() => {
        const run = loadRun(dir);
        process.stderr.write(`done-done: run ${run.run_id} still ${run.status}, step ${run.steps.find((s) => s.status === 'running')?.name ?? 'between steps'}\n`);
    }, Number(process.env.DONE_DONE_HEARTBEAT_MS) || 60_000);
    return () => clearInterval(t);
}
async function waitRun(dir, pid) {
    const stop = heartbeat(dir);
    try {
        while (['pending', 'running'].includes(loadRun(dir).status) && alive(pid))
            await new Promise((r) => setTimeout(r, 200));
    }
    finally {
        stop();
    }
}
// The judge a command will start: the user's agent and judge, asked for when unset.
async function preflightJudge(cfg, needsAgent = true) {
    if (needsAgent)
        await withChoice('agent', cfg);
    await withChoice('judge', cfg);
    return selectJudge(cfg, judgeAuthor(cfg));
}
function judgeAuthor(cfg) {
    return cfg.agent ? selectAgent(cfg) : NO_AUTHOR;
}
const NO_AUTHOR = { agent: '', model: '' };
// A run waiting at its gate is the user's call, so a new verify or rerun is refused until the user answers that run or it is
// aborted: starting another would go around its gate. Only a run of this checkout counts, keyed by its claim id, else the branch it
// started on; a run with neither (recorded by an older build) blocks every new run in this checkout.
function refuseParked(cfg, repo, claim) {
    const parked = runsIn(runsRoot(cfg.app)).filter((r) => {
        const key = r.claim_id ?? r.branch;
        return r.kind === 'verify' && r.status === 'awaiting_approval' && r.repo === repo && (key === claim || key === undefined);
    }).map((r) => r.run_id);
    if (!parked.length)
        return;
    const id = parked[0];
    throw new UsageError(`run ${parked.join(', ')} waiting at its gate for the user's answer blocks this run, which would go around that gate`, `Show the user its findings and captures (done-done status --run ${id}), then answer with their choice: done-done respond --run ${id} --action fix (approve|skip --reason "<why>" at a spend gate), or stop it: done-done abort --run ${id}`);
}
// Before a verify starts: its judge, plus the agent when it drives (no journey) or fixes (auto_fix.verify, an agent that can edit).
async function preflightVerify(cfg, agentDrives) {
    if (agentDrives || cfg.auto_fix.verify)
        await withChoice('agent', cfg);
    if (cfg.auto_fix.verify && cfg.agent.startsWith('acp:'))
        throw new UsageError(`${cfg.agent} cannot fix the product: done-done runs ACP agents with every tool denied`, `Set auto_fix.verify: 0 to report only, or set agent: to one of ${AGENTS.join(', ')}`);
    await preflightJudge(cfg, false);
}
async function cmdVerify(argv) {
    const { values, positionals } = parseArgs({
        args: argv,
        options: { outcome: { type: 'string' }, feature: { type: 'string' }, 'claim-id': { type: 'string' }, wait: { type: 'boolean' }, 'no-wait': { type: 'boolean' }, foreground: { type: 'boolean' } },
        allowPositionals: true,
    });
    if (!values.outcome?.trim())
        throw new UsageError('verify needs --outcome "<what a user can now do>"');
    if (positionals.length > 1)
        throw new UsageError('verify takes at most one journey name');
    if (positionals.length && values.feature !== undefined)
        throw new UsageError('pass a journey or --feature, not both: a journey drives by its command, --feature by the author agent');
    if ([values.wait, values['no-wait'], values.foreground].filter(Boolean).length > 1)
        throw new UsageError('pass only one of --wait, --no-wait and --foreground');
    const repo = repoRoot();
    const cfg = loadConfig(repo);
    const names = Object.keys(cfg.journeys);
    // A named journey, or the only one, drives by its command; with --feature or no journey at all, the author agent drives.
    const journey = positionals[0] ?? (names.length === 1 && values.feature === undefined ? names[0] : null);
    if (journey === null && names.length > 1 && values.feature === undefined)
        throw new UsageError(`verify needs a journey name or --feature; .done-done.yaml defines: ${names.join(', ')}`, `Run: done-done verify <${names.join('|')}> --outcome "<what a user can now do>"`);
    if (journey !== null && !cfg.journeys[journey])
        throw new UsageError(`unknown journey ${journey}; .done-done.yaml defines: ${names.join(', ') || 'none'}`);
    if (values['claim-id']?.trim() === '')
        throw new UsageError('--claim-id needs a non-empty id');
    const branch = git(repo, 'branch', '--show-current');
    if (!values['claim-id'] && !branch)
        throw new UsageError('HEAD is detached, so no branch names this claim; pass --claim-id <id>');
    refuseParked(cfg, repo, values['claim-id'] ?? branch);
    const drive = journey === null ? await agentDrive(repo, cfg, values.feature) : undefined;
    // verify always runs the judge the user set, the author's own agent and model included; the judge is settled here, so a
    // run never fails later for one it never had.
    await preflightVerify(cfg, journey === null);
    const id = newRunId(git(repo, 'rev-parse', 'HEAD'));
    const dir = join(runsRoot(cfg.app), id);
    mkdirSync(join(dir, 'logs'), { recursive: true });
    const created = now();
    const run = {
        schema: 2, run_id: id, kind: 'verify', app: cfg.app, repo, journey, ...drive, claim: values.outcome, claim_id: values['claim-id'] ?? null, branch, status: 'pending',
        steps: verifySteps(cfg).map((name) => ({ name, status: 'pending' })), created, updated: created,
        inputs: inputsOf(repo, cfg, journey, drive?.author),
    };
    saveRun(dir, run);
    logEvent(dir, { status: 'pending' });
    return launch(dir, cfg, 'verify', values);
}
// Run the steps in this process (--foreground), or in a detached runner with no pipe back to this process, so the
// runner goes on when this command or its shell ends; --wait (the default) holds this command until the run ends.
// Start the run's runner and wait for it to end; the caller shows the run.
async function startRunner(dir, how) {
    if (how.foreground) {
        const stop = heartbeat(dir);
        try {
            await runSteps(dir);
        }
        finally {
            stop();
        }
        return { gone: false };
    }
    const fd = openSync(join(dir, 'logs', 'runner.log'), 'a');
    const child = spawn(process.execPath, [CLI_PATH, '__runner', dir], { cwd: loadRun(dir).repo, detached: true, stdio: ['ignore', fd, fd] });
    child.unref();
    closeSync(fd);
    if (!how['no-wait'])
        await waitRun(dir, child.pid);
    return { gone: !alive(child.pid) };
}
async function launch(dir, cfg, command, how) {
    const { gone } = await startRunner(dir, how);
    return showRun(dir, cfg, command, gone);
}
async function cmdMaintain(argv) {
    const { values } = parseArgs({ args: argv, options: { wait: { type: 'boolean' }, 'no-wait': { type: 'boolean' }, foreground: { type: 'boolean' } } });
    if ([values.wait, values['no-wait'], values.foreground].filter(Boolean).length > 1)
        throw new UsageError('pass only one of --wait, --no-wait and --foreground');
    const repo = repoRoot();
    const cfg = loadConfig(repo);
    await withChoice('agent', cfg);
    // maintain never reports without its agent: one that cannot start or cannot read stops it here, before any run.
    const why = readerProblem(selectAgent(cfg));
    if (why)
        throw new UsageError(`maintain: ${why.replace(/^source-wave: /, '')}`, 'Install the agent or ask the user for another and save it: done-done init --agent <agent>');
    // auto_fix: the agent the user set fixes the skill and the judge the user set triages, so both are set now.
    if (cfg.auto_fix.maintain) {
        if (cfg.agent.startsWith('acp:'))
            throw new UsageError(`${cfg.agent} cannot fix the verify skill: done-done runs ACP agents with every tool denied`, `Set auto_fix.maintain: 0 to report only, or set agent: to one of ${AGENTS.join(', ')}`);
        await preflightJudge(cfg);
    }
    const id = newRunId(git(repo, 'rev-parse', 'HEAD'));
    const dir = join(runsRoot(cfg.app), id);
    mkdirSync(join(dir, 'logs'), { recursive: true });
    const created = now();
    const steps = ['locate', 'hygiene', 'source-wave', 'reconcile', ...(cfg.auto_fix.maintain ? ['triage', 'fix'] : []), 'report'].map((name) => ({ name, status: 'pending' }));
    saveRun(dir, { schema: 2, run_id: id, kind: 'maintain', app: cfg.app, repo, claim_id: null, status: 'pending', steps, created, updated: created });
    logEvent(dir, { status: 'pending' });
    return launch(dir, cfg, 'maintain', values);
}
// `run` writes an evidence record, not a verify run: status shows it too, so the run id that `run` printed resolves here.
function showRecord(repo, cfg, rec) {
    const rel = (p) => citable(repo, join(cfg.evidence.root, p));
    const evidence = FULL ? rec.files.map((f) => ({ path: rel(f.path), sha256: f.sha256, bytes: f.bytes })) : rec.files.map((f) => rel(f.path));
    const rows = cap(evidence);
    emit({
        command: 'status',
        run_id: rec.run_id,
        commit: rec.commit,
        dirty: rec.dirty,
        files: rec.files.length,
        record: shown(repo, join(recordsDir(cfg), `${rec.run_id}.json`)),
        evidence: rows.items,
        ...(rows.omitted && { evidence_omitted: rows.omitted }),
        help: [rec.files.length ? `Check this proof: done-done check --outcome "<what you proved>" ${rel(rec.files[0].path)}` : `Read the run's folder: ${shown(repo, runDir(cfg, rec.run_id))}`],
    });
    return PASS;
}
function cmdStatus(argv) {
    const { values } = parseArgs({ args: argv, options: { run: { type: 'string' } } });
    const repo = repoRoot();
    const cfg = loadConfig(repo);
    const root = runsRoot(cfg.app);
    const verify = values.run ? /^[\w-]+$/.test(values.run) && existsSync(join(root, values.run, 'run.json')) : runsIn(root).some((r) => r.repo === repo);
    const rec = verify ? undefined : loadRecords(cfg).filter((r) => !values.run || r.run_id === values.run).sort((a, b) => a.started_at.localeCompare(b.started_at)).pop();
    if (rec)
        return showRecord(repo, cfg, rec);
    return showRun(join(root, pickId(root, repo, 'status', cfg, values.run)), cfg, 'status');
}
async function cmdAttach(argv) {
    const { values } = parseArgs({ args: argv, options: { run: { type: 'string' } } });
    const repo = repoRoot();
    const cfg = loadConfig(repo);
    const dir = join(runsRoot(cfg.app), pickId(runsRoot(cfg.app), repo, 'attach', cfg, values.run));
    let shown = 0;
    for (;;) {
        const run = loadRun(dir);
        const gone = runnerGone(run);
        const lines = existsSync(join(dir, 'events.jsonl')) ? readFileSync(join(dir, 'events.jsonl'), 'utf8').split('\n').slice(0, -1) : [];
        for (; shown < lines.length; shown++)
            process.stderr.write(`${lines[shown]}\n`);
        if (['completed', 'failed', 'cancelled', 'awaiting_approval'].includes(run.status))
            break;
        if (gone)
            break;
        await new Promise((r) => setTimeout(r, 200));
    }
    return showRun(dir, cfg, 'attach');
}
function cmdLogs(argv) {
    const { values } = parseArgs({ args: argv, options: { step: { type: 'string' }, run: { type: 'string' } } });
    if (!values.step?.trim())
        throw new UsageError('logs needs --step <name>', 'Run: done-done logs --step <drive|check|receipt> [--run <run-id>]');
    const repo = repoRoot();
    const cfg = loadConfig(repo);
    const id = pickId(runsRoot(cfg.app), repo, 'logs', cfg, values.run);
    const run = loadRun(join(runsRoot(cfg.app), id));
    if (!run.steps.some((s) => s.name === values.step))
        throw new UsageError(`unknown step ${values.step}; this run has: ${run.steps.map((s) => s.name).join(', ')}`, `Read the run: done-done status --run ${id}`);
    const file = join(runsRoot(cfg.app), id, 'logs', `${values.step}.log`);
    if (!existsSync(file))
        throw new UsageError(`no log for step ${values.step} yet`, `Read the run: done-done status --run ${id}`);
    const text = readFileSync(file, 'utf8');
    const all = text === '' ? [] : text.replace(/\n$/, '').split('\n');
    const items = FULL || all.length <= 50 ? all : all.slice(-50);
    emit({ command: 'logs', run_id: id, step: values.step, lines: items.length, log: items, ...(all.length > items.length && { log_omitted: all.length - items.length }), help: FULL ? [`Read the run: done-done status --run ${id}`] : [`Read the full log: done-done logs --step ${values.step} --run ${id} --full`] });
    return PASS;
}
const drivesClean = (record, head) => {
    try {
        const rec = record && JSON.parse(readFileSync(record, 'utf8'));
        return !!rec && rec.dirty === false && rec.commit === head;
    }
    catch {
        return false;
    }
};
async function cmdRerun(argv) {
    const { values } = parseArgs({ args: argv, options: { run: { type: 'string' }, wait: { type: 'boolean' }, 'no-wait': { type: 'boolean' } } });
    if (values.wait && values['no-wait'])
        throw new UsageError('pass only one of --wait and --no-wait');
    const repo = repoRoot();
    const cfg = loadConfig(repo);
    const root = runsRoot(cfg.app);
    const srcId = pickId(root, repo, 'rerun', cfg, values.run);
    const src = loadRun(join(root, srcId));
    if (src.kind === 'maintain')
        throw new UsageError(`run ${srcId} is a maintain run, which cannot be rerun`, 'Start a new one: done-done maintain');
    const open = shownStatus(src);
    if (open === 'pending' || open === 'running')
        throw new UsageError(`run ${srcId} is still ${open}, so it cannot be rerun while its runner lives`, `Read it: done-done status --run ${srcId}; stop it first: done-done abort --run ${srcId}`);
    const group = src.runner?.journey_pgid ?? src.runner?.instance_pgid;
    if (['pending', 'running'].includes(src.status) && group && alive(-group))
        throw new UsageError(`the journey of run ${srcId} is still running, so it cannot be rerun yet`, `Read it: done-done status --run ${srcId}`);
    // The rerun keeps its source's claim and branch, so the gate it is checked against is the source's.
    refuseParked(cfg, src.repo, src.claim_id ?? src.branch);
    // A source run with no journey is driven again by the author agent config names now; schema 2 runs before PR 4 always had a journey.
    const journey = src.journey ?? null;
    const drive = journey === null ? await agentDrive(src.repo, cfg, src.feature) : undefined;
    const srcCfg = loadConfig(src.repo);
    const inputs = inputsOf(src.repo, srcCfg, journey, drive?.author);
    const same = !!src.inputs && ['head', 'journey', 'skill'].every((k) => src.inputs[k] === inputs[k]);
    // A reused drive keeps the guard it ran under, so it is only reused when the watched inputs are the same ones.
    const driveReuse = same && drivesClean(src.record, src.inputs?.head) && JSON.stringify(src.guarded?.patterns ?? []) === JSON.stringify(srcCfg.inputs);
    const reused = (name) => (name === 'resolve' && same) || (name === 'drive' && driveReuse);
    // A rerun always judges, whatever its source run did. A missing or forbidden judge is a usage error here too.
    await preflightVerify(cfg, src.journey === null);
    const id = newRunId(git(repo, 'rev-parse', 'HEAD'));
    const dir = join(root, id);
    mkdirSync(join(dir, 'logs'), { recursive: true });
    const steps = verifySteps(cfg).map((name) => {
        const s = src.steps.find((x) => x.name === name);
        return s && reused(name) && s.status === 'completed' ? { ...s } : { name, status: 'pending' };
    });
    const created = now();
    const run = { schema: 2, run_id: id, kind: src.kind, app: cfg.app, repo: src.repo, journey, ...drive, claim: src.claim, claim_id: src.claim_id, branch: src.branch, status: 'pending', inputs, steps, created, updated: created, ...(driveReuse && src.record && { record: src.record }), ...(driveReuse && src.guarded && { guarded: src.guarded }) };
    saveRun(dir, run);
    for (const s of steps) {
        const f = join(root, srcId, 'logs', `${s.name}.log`);
        if (s.status === 'completed' && existsSync(f))
            writeFileSync(join(dir, 'logs', `${s.name}.log`), readFileSync(f));
    }
    logEvent(dir, { status: 'pending', rerun_of: srcId, reused: steps.filter((s) => s.status === 'completed').map((s) => s.name) });
    return launch(dir, cfg, 'rerun', values);
}
async function waitGone(pid) {
    for (let i = 0; i < 25 && alive(pid); i++)
        await new Promise((r) => setTimeout(r, 200));
}
async function cmdAbort(argv) {
    const { values } = parseArgs({ args: argv, options: { run: { type: 'string' } } });
    const repo = repoRoot();
    const cfg = loadConfig(repo);
    const id = pickId(runsRoot(cfg.app), repo, 'abort', cfg, values.run);
    const dir = join(runsRoot(cfg.app), id);
    const startAgain = (r) => (r.kind === 'maintain' ? [] : [`Start again: done-done rerun --run ${id}`]);
    const closed = (r, status = shownStatus(r)) => {
        if (status === 'pending' || status === 'running' || status === 'awaiting_approval')
            return false;
        emit({ command: 'abort', run_id: id, status, reason: `run ${id} is already ${status}`, help: [`List past runs: done-done history`, ...startAgain(r)] });
        return true;
    };
    const latest = loadRun(dir);
    if (['pending', 'running'].includes(latest.status) && runnerGone(latest))
        reapJourney(dir, latest);
    if (closed(latest))
        return FAIL;
    // A run waiting at its gate has no runner left; the respond lock keeps abort and respond from both closing it.
    const gated = latest.status === 'awaiting_approval';
    const answering = () => {
        emit({ command: 'abort', run_id: id, status: latest.status, reason: `run ${id} is being answered at its gate, so it was not cancelled`, help: [`Read the run: done-done status --run ${id}`] });
        return FAIL;
    };
    if (gated && !createOnce(join(dir, 'respond.lock')))
        return answering();
    const read = () => { try {
        return loadRun(dir);
    }
    catch (e) {
        if (gated)
            rmSync(join(dir, 'respond.lock'), { force: true });
        throw e;
    } };
    const current = read();
    if (gated && current.status !== 'awaiting_approval') {
        rmSync(join(dir, 'respond.lock'), { force: true });
        return answering();
    }
    if (!gated && current.runner && !isOurRunner(current.runner.pid, dir)) {
        emit({ command: 'abort', run_id: id, status: current.status, reason: `could not confirm pid ${current.runner.pid} is this run's runner, so nothing was killed or cancelled`, help: [`Read the run: done-done status --run ${id}`] });
        return FAIL;
    }
    if (!gated && current.runner) {
        try {
            process.kill(-current.runner.pid, 'SIGKILL');
        }
        catch {
            try {
                process.kill(current.runner.pid, 'SIGKILL');
            }
            catch { /* exited since the check */ }
        }
        await waitGone(current.runner.pid);
    }
    const after = read();
    if (closed(after, after.status))
        return FAIL;
    try {
        reapJourney(dir, after);
        after.status = 'cancelled';
        after.reason = 'aborted';
        logEvent(dir, { status: 'cancelled' });
        saveRun(dir, after);
    }
    catch (e) {
        if (gated)
            rmSync(join(dir, 'respond.lock'), { force: true });
        throw e;
    }
    emit({ command: 'abort', run_id: id, status: 'cancelled', reason: after.reason, help: [`Read the run: done-done status --run ${id}`, ...startAgain(after)] });
    return PASS;
}
// Who answered a gate: the git user of this checkout, else the login name.
function answeredBy(repo) {
    try {
        return git(repo, 'config', 'user.name') || userInfo().username;
    }
    catch {
        return userInfo().username;
    }
}
// Answer a run waiting at its gate. At a spend gate, approve runs the journey and skip ends the run with nothing spent. At
// the judge gate only fix and skip answer: fix ends the run fail (the product or the verify skill is fixed next, and the run
// goes again), skip ends it fail too, without the fix. Nothing moves a run past its judge, so approve never answers it and
// no receipt is ever written without a judge pass. The runner has exited, so this command finishes the run; the respond
// lock lets only one answer (or an abort) close it.
// A sign-off board answer and a terminal answer both come through here, so they change the run the same way.
async function answerGate(dir, id, action, reason, by) {
    const notAtGate = (r) => new UsageError(`run ${id} is not waiting at its gate (it is ${r.status === 'awaiting_approval' ? 'being answered' : shownStatus(r)})`, `Read it: done-done status --run ${id}`);
    if (!createOnce(join(dir, 'respond.lock')))
        throw notAtGate(loadRun(dir));
    try {
        const run = loadRun(dir);
        if (run.status !== 'awaiting_approval' || !run.gate)
            throw notAtGate(run);
        if (run.gate.spend && action === 'fix')
            throw new UsageError(`run ${id} is at a spend gate, which takes --action approve or skip`, `Run: done-done respond --run ${id} --action approve|skip --reason "<why>"`);
        if (!run.gate.spend && action === 'approve')
            throw new UsageError(`run ${id} is at its judge gate, which takes only --action fix or skip: done-done never moves a run past its judge, and writes no receipt without a judge pass`, `Run: done-done respond --run ${id} --action fix, then fix the product or the verify skill's recipe, commit, and run again`);
        if (action !== 'fix' && !reason)
            throw new UsageError(`respond --action ${action} needs --reason "<why>": the spend answer is recorded with who and why`, `Run: done-done respond --run ${id} --action ${action} --reason "<why>"`);
        const gate = run.steps.find((s) => s.name === 'gate');
        run.response = { action, by, ...(reason && { reason }), at: now() };
        logEvent(dir, { step: 'gate', response: action, by, ...(reason && { reason }) });
        // The spend gate: approve runs the journey in a new runner; skip ends the run with nothing spent.
        if (run.gate.spend) {
            const drive = run.steps.find((s) => s.name === 'drive');
            if (action !== 'approve') {
                setStep(dir, run, drive, 'failed');
                finishRun(dir, run, 'fail', `gate: ${by} chose ${action}: the journey was not run, so nothing was spent`);
                return { gone: false };
            }
            Object.assign(run, { spend: { by, reason, at: run.response.at }, status: 'pending', gate: undefined, response: undefined, runner: undefined });
            setStep(dir, run, drive, 'pending');
            for (const lock of ['runner.lock', 'respond.lock'])
                rmSync(join(dir, lock));
            return await startRunner(dir, {});
        }
        setStep(dir, run, gate, 'failed');
        finishRun(dir, run, 'fail', `gate: ${by} chose ${action}: ${reason || run.gate.findings[0].what}`);
        return { gone: false };
    }
    catch (e) {
        rmSync(join(dir, 'respond.lock'), { force: true });
        throw e;
    }
}
// Answer a run waiting at its gate, from the terminal.
async function cmdRespond(argv) {
    const { values } = parseArgs({ args: argv, options: { run: { type: 'string' }, action: { type: 'string' }, reason: { type: 'string' } } });
    const action = values.action;
    if (action !== 'approve' && action !== 'skip' && action !== 'fix')
        throw new UsageError('respond needs --action approve, skip or fix', 'Run: done-done respond --run <run-id> --action <approve|skip|fix> [--reason "<why>"]');
    const reason = values.reason?.replace(/\s+/g, ' ').trim() ?? '';
    const repo = repoRoot();
    const cfg = loadConfig(repo);
    const root = runsRoot(cfg.app);
    const id = pickId(root, repo, 'respond', cfg, values.run);
    const dir = join(root, id);
    const answered = await answerGate(dir, id, action, reason, answeredBy(repo));
    return showRun(dir, cfg, 'respond', answered.gone);
}
// The sign-off board's own CLI (github.com/umeranjum17/sign-off): done-done posts through it and never edits a board.
// It prints one document: `field: value` lines, a table and a help list.
function signoffRun(args, cwd) {
    const r = spawnSync('sign-off-axi', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    if (r.error?.code === 'ENOENT')
        throw new UsageError('sign-off-axi is not on PATH, so nothing was posted', 'Install the board CLI: npm install -g sign-off-axi, then run this again');
    return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
// One field of that document: the value of the first line that starts with `name:`.
const signoffField = (out, name) => {
    const line = out.split('\n').find((l) => l.startsWith(`${name}:`));
    if (!line)
        return '';
    const raw = line.slice(name.length + 1).trim();
    return raw.startsWith('"') && raw.endsWith('"') && raw.length > 1 ? raw.slice(1, -1) : raw;
};
// Its help line: the value of the first `help[n]:` line.
const signoffHelp = (out) => {
    const line = out.split('\n').find((l) => l.startsWith('help['));
    if (!line)
        return '';
    const raw = line.slice(line.indexOf(':') + 1).trim();
    return raw.startsWith('"') && raw.endsWith('"') && raw.length > 1 ? raw.slice(1, -1) : raw;
};
// Post the message to the board and read back the card it made.
function postToBoard(cwd, board, kind, file, key) {
    const { code, out } = signoffRun(['post', ...(board ? [board] : []), '--kind', kind, '--from', file], cwd);
    if (code !== 0)
        throw new UsageError(signoffField(out, 'error') || `sign-off-axi post ended with exit ${code}`, signoffHelp(out) || 'Read it: sign-off-axi post --help');
    const shown = out.split('\n').some((l) => { const t = l.trim(); return t === key || t.startsWith(`${key},`) || t.startsWith(`${key} `); });
    if (!shown)
        throw new UsageError(`sign-off-axi posted without the card ${key}, so the run has no sign-off card`, 'Read the board: sign-off-axi list');
    return { board: signoffField(out, 'board') || board, key };
}
// Wait for the answer to a card on the board and read it back.
function waitForAnswer(cwd, board, key, seconds) {
    const { code, out } = signoffRun(['wait', ...(board ? [board] : []), '--key', key, '--json', '--timeout', String(seconds)], cwd);
    if (code !== 0)
        throw new UsageError(signoffField(out, 'error') || `sign-off-axi wait ended with exit ${code}`, signoffHelp(out) || `Wait again: done-done signoff --wait`);
    let answers;
    try {
        answers = JSON.parse(out);
    }
    catch {
        throw new UsageError(`sign-off-axi wait printed no answer for the card ${key}`, `Read it: sign-off-axi answers --key ${key}`);
    }
    const answer = answers[key];
    if (!answer)
        throw new UsageError(`the board card ${key} has no answer`, `Read it: sign-off-axi answers --key ${key}`);
    return { value: answer.answer, ...(answer.label && { label: answer.label }), ...(answer.at && { at: answer.at }), ...(answer.note && { note: answer.note }) };
}
// sign-off's communication contract v1 (github.com/umeranjum17/sign-off, docs/contract.md): done-done sends `gate` and
// `evidence`, schema 1. Each value is checked against the contract's limits first, so a run that cannot make a valid
// message writes no file. Without the opt-in done-done never posts it: sign-off is the user's choice, so the help line
// names the post command. With the opt-in (--post, or signoff.post in .done-done.yaml) done-done posts it through
// sign-off-axi, records the card on the run and can wait for the answer to feed back to that run.
// The contract fixes a gate's options: approve (Approve), skip (Skip the judge) and fix (Fix first), and it takes two or
// three of them. A spend gate answers approve or skip; a judge gate answers fix or skip, never approve: nothing moves a
// run past its judge.
const GATE_LABELS = { approve: 'Approve', skip: 'Skip the judge', fix: 'Fix first' };
async function cmdSignoff(argv) {
    const { values } = parseArgs({ args: argv, options: { run: { type: 'string' }, post: { type: 'boolean' }, board: { type: 'string' }, wait: { type: 'boolean' }, timeout: { type: 'string' } } });
    const repo = repoRoot();
    const cfg = loadConfig(repo);
    const root = runsRoot(cfg.app);
    const id = pickId(root, repo, 'signoff', cfg, values.run);
    const dir = join(root, id);
    let run = loadRun(dir);
    const refuse = (what, help) => { throw new UsageError(`run ${id} cannot make a valid sign-off message, so no file was written: ${what}`, help); };
    const text = (field, v, max, help = `Read it: done-done status --run ${id}`) => {
        const n = [...v].length;
        if (!/\S/.test(v) || n > max)
            refuse(`${field} is ${n} characters, and the contract takes 1-${max}`, help);
        if (/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]|\p{Cs}/u.test(v))
            refuse(`${field} holds a control character or half of a character`, help);
        return v;
    };
    // At most 116 characters, so dd-evidence-<run id> is still a key-set id (1-128).
    const runRef = (commit) => /^[A-Za-z0-9._-]{1,116}$/.test(id) && /^[0-9a-f]{40}$/.test(commit) ? { run_id: id, commit } : refuse(`run_id ${id} or commit ${commit} is not in the contract's shape`, 'Start a new run: done-done verify --outcome "<what a user can now do>"');
    const drove = run.journey ?? run.feature ?? 'agent drive';
    // A finding names the folder that captured it (this run's, a -fixN pass's or a reused source run's), so the message
    // names the capture file alone: strip any <evidence root>/<one run folder>/ prefix.
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const bare = (s) => s.replaceAll(new RegExp(`${esc(cfg.evidence.root)}${esc(sep)}[^${esc(sep)}]+${esc(sep)}`, 'g'), '');
    // The board: the one the user names (--board, or signoff.board), else the nearest .sign-off/ board sign-off-axi finds.
    const boardName = values.board ?? cfg.signoff.board;
    const board = boardName ? resolve(repo, tilde(boardName)) : '';
    // The opt-in: --post posts this run, signoff.post in .done-done.yaml posts every run. Without it nothing is posted.
    const posts = values.post === true || cfg.signoff.post;
    // Wait for the answer to the card this run posted and feed it back to that run.
    const awaitCard = async (card) => {
        const limit = parseDuration(values.timeout ?? '10m');
        if (limit === null)
            throw new UsageError(`--timeout ${values.timeout} is not a duration such as 90s, 10m or 1h`, 'Run: done-done signoff --wait --timeout 10m');
        const answer = waitForAnswer(repo, board || tilde(card.board), card.key, Math.round(limit / 1000));
        card.answer = { value: answer.value, ...(answer.label && { label: answer.label }), ...(answer.at && { at: answer.at }), ...(answer.note && { note: answer.note }) };
        run = loadRun(dir);
        run.signoff = card;
        saveRun(dir, run);
        logEvent(dir, { step: 'signoff', answered: card.key, answer: answer.value });
        if (card.kind === 'gate') {
            const action = answer.value;
            if (action !== 'approve' && action !== 'skip' && action !== 'fix')
                throw new UsageError(`the board card ${card.key} was answered ${action}, which is not an action of done-done respond`, `Read it: done-done status --run ${id}`);
            const reason = answer.note?.replace(/\s+/g, ' ').trim() || `answered ${action} on the sign-off board card ${card.key}`;
            await answerGate(dir, id, action, reason, answeredBy(repo));
        }
        run = loadRun(dir);
        emit({
            command: 'signoff', run_id: id, kind: card.kind, file: card.file, board: card.board,
            card: { key: card.key, at: card.at }, answer: card.answer,
            run: { status: shownStatus(run), ...(run.result && { result: run.result }), ...(run.reason && { reason: run.reason }) },
            help: [`Read the run: done-done status --run ${id}`],
        });
        return runCode(run, shownStatus(run));
    };
    // Without the opt-in, --wait only reads the card the run already posted; it never posts one.
    if (values.wait && !posts) {
        if (!run.signoff)
            throw new UsageError(`run ${id} has no sign-off card, so there is no answer to wait for`, `Post it first: done-done signoff --post --run ${id}`);
        return await awaitCard(run.signoff);
    }
    let msg, file;
    if (run.kind === 'verify' && run.status === 'awaiting_approval' && run.gate) {
        const { findings, spend, head } = run.gate;
        const more = findings.length > 1 ? ` (and ${findings.length - 1} more)` : '';
        msg = {
            contract: 1, kind: 'gate', schema: 1, key: `dd-gate-${id}`, filer: 'done-done',
            title: text('title', spend ? `Spend ${spend} on the ${cfg.app} ${drove} run?` : `End the ${cfg.app} ${drove} run its judge did not pass, to fix it?`, 160),
            about: text('about', `${bare(findings[0].what)}${more}`, 500), run: runRef(head.commit),
            // The contract's gate vocabulary: a spend gate takes approve or skip, a judge gate fix or skip, and nothing else.
            options: (spend ? ['approve', 'skip'] : ['fix', 'skip']).map((value) => ({ value, label: GATE_LABELS[value] })),
            recommend_value: spend ? 'approve' : 'fix', close: 'done',
        };
        file = join(root, id, 'signoff-gate.json');
    }
    else if (run.kind === 'verify' && run.status === 'completed' && run.record) {
        // A run auto_fix.verify fixed proves the fix pass, never the first failing pass: the receipt is bound to the fix commit.
        const fixed = run.result === 'changed' && run.fix?.record ? run.fix : undefined;
        // The message sits in the folder of the run that made the captures (a rerun that reused its drive sends its source's),
        // so each media path is relative to it and stays inside it.
        const again = `Capture it again: done-done rerun --run ${id}`;
        let rec, folder;
        try {
            rec = JSON.parse(readFileSync(fixed?.record ?? run.record, 'utf8'));
        }
        catch {
            return refuse('its run record is missing or unreadable', again);
        }
        try {
            folder = realpathSync(runDir(cfg, rec.run_id));
        }
        catch {
            return refuse('its run folder is missing', again);
        }
        if (!under(realpathSync(cfg.evidence.root), folder))
            refuse(`its run folder ${rec.run_id} is outside the evidence root`, again);
        const names = rec.files.map((f) => {
            let p, bytes;
            try {
                p = realpathSync(join(cfg.evidence.root, f.path));
                bytes = readFileSync(p);
            }
            catch {
                return refuse(`${f.path} is missing`, again);
            }
            if (!under(folder, p) || sha256(bytes) !== f.sha256)
                refuse(`${f.path} left the run folder or changed after the run`, again);
            return { name: relative(folder, p), media: /\.(png|jpe?g|webp|mp4|webm)$/i.test(p) && f.bytes <= 50_000_000 };
        });
        if (!names.length)
            refuse('the run recorded no captures, so it has no evidence to send', `Read it: done-done status --run ${id}`);
        const media = names.filter((f) => f.media).slice(0, 12).map((f) => f.name);
        const shown = names.slice(0, 12).map((f) => f.name).join(', ') + (names.length > 12 ? `, and ${names.length - 12} more in the run folder` : '');
        const redo = 'Start a run whose --outcome fits: done-done verify --outcome "<what a user can now do>"';
        msg = {
            contract: 1, kind: 'evidence', schema: 1, key: `dd-evidence-${id}`, filer: 'done-done',
            title: text('title', `${cfg.app} ${drove}: verify ${run.result}`, 160), about: text('about (the outcome)', run.claim, 500, redo),
            ...(media.length && { media }),
            run: {
                ...runRef(rec.commit), outcome: text('outcome', run.claim, 1000, redo),
                repro: text('repro', [`done-done verify`, run.journey ?? (run.feature && `--feature ${run.feature}`), `--outcome "${run.claim}" at ${rec.commit}`].filter(Boolean).join(' ') + (fixed?.branch ? ` on branch ${fixed.branch}` : ''), 1000, redo),
                proof: text('proof', `${existsSync(join(repo, cfg.skill)) ? basename(cfg.skill) : 'no verify skill'}: done-done verify ${drove}, run ${id}: ${run.result}${run.reason ? ` (${run.reason})` : ''}`, 1000),
                evidence: text('evidence', shown, 1000),
            },
        };
        file = join(folder, 'signoff-evidence.json');
    }
    else
        return refuse(`it is ${shownStatus(run)}${run.kind === 'verify' ? '' : ` (a ${run.kind} run)`}; signoff writes a gate for a verify run waiting at its gate, or evidence for a finished verify run`, `Read it: done-done status --run ${id}`);
    writeFileSync(file, `${JSON.stringify(msg, null, 2)}\n`);
    const at = citable(repo, file);
    if (!posts) {
        emit({ command: 'signoff', run_id: id, kind: msg.kind, file: at, help: [`Post it to the sign-off board with sign-off-axi (done-done prepares the run; sign-off-axi posts): npx -y sign-off-axi post --kind ${msg.kind} --from ${arg(at)}`] });
        return PASS;
    }
    // Post it through the board's own CLI and record the card it made, so the claim traces to the run and its card.
    const posted = postToBoard(repo, board, String(msg.kind), at, String(msg.key));
    const card = { key: posted.key, kind: msg.kind, board: posted.board, file: at, at: now() };
    run.signoff = card;
    saveRun(dir, run);
    logEvent(dir, { step: 'signoff', posted: card.key, kind: card.kind });
    if (values.wait)
        return await awaitCard(card);
    emit({
        command: 'signoff', run_id: id, kind: card.kind, file: at, board: card.board,
        card: { key: card.key, at: card.at },
        help: [`Wait for the answer: done-done signoff --wait --run ${id}`, `Read the card: sign-off-axi answers --key ${card.key}`],
    });
    return PASS;
}
function runsOf(repo, cfg) {
    return runsIn(runsRoot(cfg.app)).filter((r) => r.repo === repo).sort((a, b) => b.created.localeCompare(a.created));
}
function cmdHistory(argv) {
    const { values } = parseArgs({ args: argv, options: { limit: { type: 'string' } } });
    if (values.limit !== undefined && (!/^\d+$/.test(values.limit) || Number(values.limit) <= 0))
        throw new UsageError('--limit needs a positive integer', 'Run: done-done history --limit <n>');
    const n = values.limit === undefined ? Infinity : Number(values.limit);
    const repo = repoRoot();
    const cfg = loadConfig(repo);
    const matched = runsOf(repo, cfg).slice(0, n);
    const rows = cap(matched.map((r) => ({ run_id: r.run_id, kind: r.kind, status: shownStatus(r), ...(r.result && { result: r.result }), ...(r.kind === 'verify' && { claim: r.claim, journey: r.journey }), created: r.created })));
    emit({ command: 'history', runs: matched.length, history: rows.items, ...(rows.omitted && { history_omitted: rows.omitted }), help: rows.items.length ? [`Read the newest run: done-done status --run ${rows.items[0].run_id}`] : ['Start one: done-done verify --outcome "<what a user can now do>"'] });
    return PASS;
}
// Append `<rel>/` to .gitignore unless git already ignores it. Never rewrites existing bytes.
function ensureIgnored(repo, rel) {
    const entry = `${rel.replace(/\/+$/, '')}/`;
    if (spawnSync('git', ['check-ignore', '--no-index', '-q', '--', entry], { cwd: repo }).status === 0)
        return false;
    const file = join(repo, '.gitignore');
    if (!existsSync(file)) {
        writeFileSync(file, `${entry}\n`);
        return true;
    }
    const text = readFileSync(file, 'utf8');
    appendFileSync(file, `${text && !text.endsWith('\n') ? '\n' : ''}${entry}\n`);
    return true;
}
const STR = { type: 'string' };
const SCAFFOLD_SCHEMA = {
    type: 'object',
    properties: {
        surface: STR,
        first_release: { type: 'boolean' },
        launch: { type: 'object', properties: { steps: STR, source: STR, safe: { type: 'boolean' }, why: STR }, required: ['steps', 'source', 'safe', 'why'], additionalProperties: false },
        ready: STR,
        harness: STR,
        observe: STR,
        isolate: STR,
        features: { type: 'array', minItems: 1, items: { type: 'object', properties: { title: STR, reach: STR, drive: STR, source: STR, capture: { type: 'string', enum: ['screenshot', 'text'] }, core: { type: 'boolean' }, upgrade: { type: 'boolean' } }, required: ['title', 'reach', 'drive', 'source', 'capture', 'core', 'upgrade'], additionalProperties: false } },
    },
    required: ['surface', 'first_release', 'launch', 'ready', 'harness', 'observe', 'isolate', 'features'],
    additionalProperties: false,
};
const NO_EDIT = 'The drive changes no repo file: note findings in the run\'s report; after the drive, run done-done maintain to see what drifted, then fix the skill';
const MAX_FEATURES = 5;
const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'feature';
// The agent's text as one sentence: its own final period is dropped so the template adds exactly one.
const clause = (s) => s.trim().replace(/\.+$/, '');
// A cited path as the tracked file list spells it: no leading ./ and no :line suffix.
const cited = (s) => s.trim().replace(/^\.\//, '').replace(/:\d+(-\d+)?$/, '');
// ponytail: the agent sees at most CONTEXT_CHARS of file text, each file cut at FILE_CHARS, ranked by path only
// (manifests, proof scripts, source); the prompt names what was left out. Rank by content when a repo needs more.
const CONTEXT_CHARS = 150_000;
const FILE_CHARS = 20_000;
const LISTED = 500;
const MANIFEST = /^(readme(\.\w+)?|package\.json|makefile|justfile|procfile|pyproject\.toml|cargo\.toml|go\.mod|docker-compose\.ya?ml|dockerfile|\.done-done\.yaml)$/i;
const SECRET = /(^|\/)\.env(\.[^/]*)?$|secret|credential|token|password|\.(pem|key|p12)$/i;
const DOCKERFILE = /(^|\/)dockerfile(\.[^/]*)?$/i;
const PROOF = /(^|[/._-])(scripts?|verify|e2e|smoke|proof|stub|fake|demo)([/._-]|$)/i;
const SOURCE_FILE = /\.([cm]?[jt]sx?|py|go|rb|rs|php|sh|vue|svelte|html|css|java|kt|swift|c|h|cpp|cs|dart|scala|ex)$/;
const DATA_FILE = /\.(json|ya?ml|md)$/i;
// A tracked regular file's text, or undefined for a symlink, a binary, a file over 1 MB or one that cannot be read.
function repoText(p) {
    try {
        const st = lstatSync(p);
        if (!st.isFile() || st.size > 1 << 20)
            return undefined;
        const text = readFileSync(p, 'utf8');
        return text.includes('\0') ? undefined : text;
    }
    catch {
        return undefined;
    }
}
// The repo as the agent sees it: the tracked file list (without the skill folder) and the text of the files that
// say how the app starts and how the repo proves it.
function repoContext(repo, skill) {
    const listed = execFileSync('git', ['ls-files', '-z'], { cwd: repo, encoding: 'utf8', maxBuffer: Infinity, stdio: ['ignore', 'pipe', 'pipe'] });
    const own = `${skill.replace(/\\/g, '/').replace(/\/+$/, '')}/`;
    const files = listed.split('\0').filter((f) => f && !f.startsWith(own));
    const rank = (f) => (MANIFEST.test(f) ? 0 : DATA_FILE.test(f) ? 3 : PROOF.test(f) || /(^|\/)bin\//.test(f) || DOCKERFILE.test(f) ? 1 : SOURCE_FILE.test(f) ? 2 : 3);
    const shown = (f) => !SECRET.test(f) && rank(f) < 3;
    let total = 0;
    const parts = [];
    const read = new Set();
    const left = [];
    for (const f of files.filter(shown).sort((a, b) => rank(a) - rank(b))) {
        const body = total < CONTEXT_CHARS ? repoText(join(repo, f)) : undefined;
        const kept = body === undefined ? undefined : body.length > FILE_CHARS ? `${body.slice(0, FILE_CHARS)}\n[truncated after ${FILE_CHARS} characters]` : body;
        if (kept === undefined || total + kept.length > CONTEXT_CHARS) {
            left.push(f);
            continue;
        }
        total += kept.length;
        read.add(f);
        parts.push(`File ${f}:\n${kept}`);
    }
    const list = `Tracked files (${files.length}${files.length > LISTED ? `, the first ${LISTED} shown` : ''}): ${files.slice(0, LISTED).join(', ') || 'none'}`;
    const out = left.length ? `\n\n[left out: ${left.length} files cannot be read or pass the ${CONTEXT_CHARS}-character cap: ${left.slice(0, 20).join(', ')}${left.length > 20 ? `, +${left.length - 20} more` : ''}]` : '';
    return { files: new Set(files), read, text: `${list}\n\n${parts.join('\n\n')}${out}` };
}
function scaffoldPrompt(cfg, context, toolless, ships) {
    return `You write the verify skill for the app ${cfg.app}, which \`done-done init\` saves at ${cfg.skill}: how an agent launches this repo's app safely, drives it the way a user does, and captures proof that it works. Do not edit, create or delete any file, and do not run the app or any command.
${toolless ? "You have no tools: the repo's tracked file list and the text of its key files are below, and they are all you can read." : 'The repository is your working directory: read the files below first, then any other file you need.'} Use only what the repo shows: never invent a command, path, flag, route or label. Never open a secret-looking file: a .env or .env.* file, a path whose name contains secret, credential, token or password, or a *.pem, *.key or *.p12 file. Never write a secret value into steps or why; name the environment variable instead.

A proof drives the running product the way a user does: a test suite, typecheck, lint or build (npm test, yarn run check, tsc, pytest, go test) only checks the code, so it is never a launch, a drive or the proof, even when the repo's own checks use it.
- launch: how to start the app for a proof. Prefer the repo's own proof path: a verify, e2e, smoke or demo script, or a journey in .done-done.yaml, that runs the app with a stub, fake or demo engine and its own state (a temporary HOME or data folder), the way the repo proves itself; copy its exact command and environment flags. {steps: the exact command on one line, with every environment flag, whose first command runs source (or passes it to an interpreter such as bash, node or npx tsx), source: the repo file they come from (for a .done-done.yaml journey, the script or file that journey runs, never .done-done.yaml itself), safe: true only when these steps use a stub or demo mode or isolated state, so no real account, paid service or the owner's own state is touched, why: what makes it safe, or when safe is false what it would touch}. When the repo has no such path, give the closest launch with safe false; never present a command that uses real accounts or the owner's own state (for example a start script that runs the real engine) as safe.
- surface: what a user drives: web UI, CLI, API/service, desktop app or other.
- ready: the check that shows the launched app is ready to drive (a URL that answers, a line it prints, an exit code).
- harness: what drives it: a browser tool, a terminal (tmux or PTY), curl, or a shell.
- observe: the proof to capture: screenshots of the resulting state, terminal transcripts and exit codes, response bodies, files written.
- isolate: how each run keeps its own instance and state, and never drives a session or account the user owns.
- features: up to ${MAX_FEATURES} things a user does with the app, the most important first, each {title, reach: how a user gets there, drive: the concrete steps through the repo's real handles (the command and its arguments, the route, the page label, the journey name), source: the repo file that shows the feature, capture: screenshot for a screen, text for output, core, upgrade}.
- first_release: true only when the repo explicitly says no earlier release yet; false when an earlier version shipped or you cannot tell. This records upgrade proof as pending, never as passed. Do not invent a previous version or an upgrade drive when none exists.
- core: true on exactly one feature, listed first: the core user journey, the one thing a user cannot live without, driven end to end on the real target the way a user does it (for a remote terminal app: pair, open a pane, type, see the output), never a part of it or a setting. Every other feature has core false.
${ships.length ? `- upgrade: this app ships an installable or upgradable artifact (${ships.slice(0, 3).join('; ')}), so users get each release by upgrading over the version they have. Set upgrade true on one feature whose drive installs the previous shipped version, upgrades over it in place the way a user does (install the new APK over the old one, update the host or CLI package in place), then drives the core journey; a fresh install alone is no release proof. It may be the core feature itself when its drive does all of that. Exception: when first_release is true, upgrade may be false on every feature; the skill will record the upgrade journey as pending until there is a published version to upgrade from.` : '- upgrade: false on every feature: no tracked file shows the app ships an installable or upgradable artifact.'}
Each source is one path exactly as the tracked file list spells it, with no other words (scripts/verify/drive.sh, never a list or a note); launch.source may be empty only when safe is false.

${context}`;
}
// Why an answer cannot be rendered into the skill, or '' when it can. A citation must be a tracked file the agent was
// shown: shown is every tracked file for claude, which reads the repo itself, and the text plain code gave a tool-less agent.
function scaffoldProblem(a, tracked, shown, ships) {
    const s = a;
    const text = (v) => typeof v === 'string' && clause(v) !== '';
    const citation = (p) => {
        const c = cited(p);
        if (!tracked.has(c))
            return `cites ${c}, which is not a tracked file`;
        if (SECRET.test(c))
            return `cites ${c}, a secret-looking file, which can not be a source`;
        return shown.has(c) ? '' : `cites ${c}, whose text is not in the prompt`;
    };
    for (const k of ['surface', 'ready', 'harness', 'observe', 'isolate'])
        if (!text(s[k]))
            return `missing ${k}`;
    if (!s.launch || typeof s.launch !== 'object' || !text(s.launch.steps) || !text(s.launch.why) || typeof s.launch.safe !== 'boolean' || typeof s.launch.source !== 'string')
        return 'missing launch steps, source, safe or why';
    const launchCite = cited(s.launch.source) ? citation(s.launch.source) : '';
    if (launchCite)
        return `the launch ${launchCite}`;
    if (codeOnly(s.launch.steps))
        return `the launch ${s.launch.steps.trim()} is code-only: ${RULE}`;
    if (!Array.isArray(s.features) || !s.features.length)
        return 'has no features';
    for (const f of s.features) {
        if (!f || typeof f !== 'object' || !text(f.title) || !text(f.reach) || !text(f.drive) || !text(f.source) || !['screenshot', 'text'].includes(f.capture) || typeof f.core !== 'boolean' || typeof f.upgrade !== 'boolean')
            return 'has a feature without a title, reach, drive, source, capture, core or upgrade';
        const why = citation(f.source);
        if (why)
            return `the feature "${f.title}" ${why}`;
        if (codeOnly(f.drive))
            return `the feature "${f.title}" drive ${f.drive.trim()} is code-only: ${RULE}`;
    }
    // The skill lists the first MAX_FEATURES, so the core and upgrade features must be among them.
    const kept = s.features.slice(0, MAX_FEATURES);
    const cores = kept.filter((f) => f.core).length;
    if (cores !== 1)
        return `names ${cores} core journeys among its first ${MAX_FEATURES} features, and the skill needs exactly one: the one thing a user cannot live without, end to end on the real target`;
    if (ships.length && !kept.some((f) => f.upgrade) && s.first_release !== true)
        return `names no upgrade journey, and the app ships an installable artifact (${ships.slice(0, 3).join('; ')}): a fresh install alone is no release proof`;
    return '';
}
function verifySkillMd(app, agent, s, isolated, features, omitted, ships) {
    const name = `done-done-verify-${app}`;
    const source = cited(s.launch.source);
    const launch = isolated
        ? `${s.launch.steps.trim()}\n\nSafe: ${clause(s.launch.why)} (from \`${source}\`).`
        : `Not isolated: ${clause(s.launch.why)}. The launch below is not shown to use a stub or demo engine with its own state, so it may use real accounts or the owner's own state. ${NO_EDIT}.\n\n${s.launch.steps.trim()}${source ? `\n\nFrom \`${source}\`.` : ''}`;
    const core = features.find((f) => f.core);
    const upgrade = features.find((f) => f.upgrade);
    const link = (f) => `[${f.title}](features/${f.slug}.md)`;
    const found = [
        ...features.map((f) => `- [${f.title}](features/${f.slug}.md)${marks(f)}: ${clause(f.reach)} (\`${cited(f.source)}\`)`),
        ...(omitted ? [`- ${omitted} more found and not listed; add them by hand or run maintain later.`] : []),
    ];
    return `---
name: ${JSON.stringify(name)}
description: ${JSON.stringify(`Drive the ${app} ${s.surface} the way a user does and capture proof it works. Use when proving a ${app} change, capturing evidence, or keeping the feature map honest.`)}
---

# ${name}

Written by \`done-done init\` through ${agent} from this repo's own files (surface: ${s.surface}). ${NO_EDIT}.

## Launch

${launch}

Ready: ${clause(s.ready)}. Tear down what you started; never kill by process name.
Isolation: ${clause(s.isolate)}.
When the repo's .done-done.yaml has an instance block, done-done already runs the app at $DONE_DONE_BASE_URL (its own port and HOME): BASE is then that URL, never a hard-coded port.

## Drive

Harness: ${clause(s.harness)}. Drive through the repo's real handles that each feature file names:

${found.join('\n')}

## Core journey

${link(core)} is the core user journey: the one thing a user cannot live without. A proof that the app works drives it end to end on the real target; a proof of another feature alone does not show the app works.
${ships.length ? `\n## Release proof\n\nThis app ships an installable artifact (${ships.slice(0, 3).join('; ')}), and users get a release by upgrading over the version they have. ${upgrade ? `${link(upgrade)} is the release proof: install the previous shipped version, upgrade over it in place, then drive the core journey. A fresh install alone is no release proof.` : 'Upgrade journey pending: no earlier release yet. Before the next release, install the first published version, upgrade over it in place, then drive the core journey. This is not upgrade proof; doctor still reports the missing upgrade journey until one is named.'}\n` : ''}
## Evidence

What to capture: ${clause(s.observe)}. Exercise the real user path, not internal setters; done-done's judge checks every capture in the run folder against the outcome, so save only captures of the resulting state there and keep any of earlier steps outside it; verify side effects alongside what is visible. Evidence goes to the run folder \`done-done run\` prints.

## Cleanup

Stop the instances this run started and remove scratch state. Evidence survives cleanup: never delete the run folder.
`;
}
function verifyFeatureMd(app, s, f) {
    const capture = f.capture === 'screenshot' ? `screenshot the resulting page to $DONE_DONE_EVIDENCE_ROOT/${f.slug}.png` : `save the output and exit status to $DONE_DONE_EVIDENCE_ROOT/${f.slug}.txt`;
    const drive = clause(f.drive);
    return `# ${f.title}\n\nPart of the ${app} verification map. Source: \`${cited(f.source)}\`.\n\n## How to get to it (user POV)\n\n${clause(f.reach)}.\n\n## Driving it\n\nHarness: ${clause(s.harness)}.\n\n1. Launch the app as SKILL.md says and wait until it is ready.\n2. ${drive[0].toUpperCase()}${drive.slice(1)}.\n3. Capture: ${capture}, as SKILL.md's Evidence section says.\n4. Stop what you started.\n\n${NO_EDIT}.\n`;
}
// Generation is read-only, like init. Only plain code writes the returned recipe; subsequent runs need no agent.
async function cmdJourney(argv) {
    const { positionals } = parseArgs({ args: argv, allowPositionals: true });
    const action = positionals[0], improve = action === 'improve', named = action === 'enhance' || improve;
    if ((!named && (action !== 'add' || positionals.length !== 2)) || (named && ![2, 3].includes(positionals.length)) || !positionals[1]?.trim() || positionals[2] === '' || (improve && !positionals[2]?.trim()))
        throw new UsageError('Use: done-done journey add "<description>" | done-done journey enhance <name> ["<focus>"] | done-done journey improve <name> "<instruction>"');
    const request = named ? positionals[2]?.trim() || 'Add steps, edge cases, boundary sizes and states, and stronger checks on this path.' : positionals[1];
    const label = improve ? 'Improved' : 'Enhanced';
    if (process.env.CI)
        throw new UsageError(`journey ${action} uses an agent to generate repo changes; run it locally, review and commit them, then run the saved journey in CI`);
    const repo = repoRoot(), cfg = loadConfig(repo);
    const config = join(repo, '.done-done.yaml'), index = join(repo, cfg.skill, 'features/README.md');
    if (![config, join(repo, cfg.skill, 'SKILL.md'), index].every(existsSync))
        throw new UsageError(`journey ${action} needs the project config and verify feature map`, 'Run: done-done init');
    const inside = under(repo, index);
    if (!inside || cfg.skill.split(/[\\/]/).includes('..'))
        throw new UsageError(`journey ${action} needs a verify skill inside the repo`);
    const safePath = (p) => { if (symlinkOnPath(repo, p))
        throw new UsageError(`${shown(repo, p)} is reached through a symlink; nothing written`); };
    for (const p of [config, index, join(repo, cfg.skill, 'SKILL.md'), join(repo, 'journeys')])
        safePath(p);
    const name = named ? positionals[1] : '';
    if (named && !Object.hasOwn(cfg.journeys, name))
        throw new UsageError(`unknown journey ${name}; nothing written`);
    if (named && !/^[a-z0-9][a-z0-9-]{0,59}$/.test(name))
        throw new UsageError(`${action} needs a lowercase kebab-case journey name`);
    const priorScript = join(repo, 'journeys', `${name}.mjs`), priorFeature = join(dirname(index), `${name}.md`);
    if (named) {
        for (const p of [priorScript, priorFeature])
            safePath(p);
        if (existsSync(priorScript) && (cfg.journeys[name].command !== `node journeys/${name}.mjs` || Object.entries(cfg.journeys).some(([n, j]) => n !== name && j.command.includes(`journeys/${name}.mjs`))))
            throw new UsageError(`${shown(repo, priorScript)} is not exclusive to this journey; nothing written`);
        if (existsSync(priorFeature) && !readFileSync(priorFeature, 'utf8').includes(`done-done run ${name}`))
            throw new UsageError(`${shown(repo, priorFeature)} does not name this journey; nothing written`);
    }
    const agent = selectAgent(cfg), toolless = agent.agent !== 'claude';
    if (!agent.path)
        throw new UsageError(notStartable(agent.agent, agent.override));
    if (toolless && toollessReason(agent.agent))
        throw new UsageError(toollessReason(agent.agent), 'Use an agent supported by init: done-done init --agent <agent> --model <model>');
    const before = repoState(repo);
    const context = repoContext(repo, cfg.skill);
    const fields = ['name', 'title', 'source', 'script', 'checks', 'spends', 'blocker'];
    const schema = { type: 'object', properties: Object.fromEntries(fields.map(k => [k, STR])), required: fields, additionalProperties: false };
    const record = join(home(), 'agents', `journey-${action}-${randomBytes(8).toString('hex')}.json`);
    const goal = named ? `${improve ? 'Improve' : 'Enhance'} ONLY the existing journey ${JSON.stringify(name)}. Keep that exact name. ${improve ? 'Instruction' : 'Focus'}: ${JSON.stringify(request)}.
Preserve every existing drive step and assertion; ${improve ? 'apply only this specific instruction, without unrelated expansion' : 'add concrete deeper coverage on this same path'}, not another journey. Respect existing spend restrictions, timeout, role and matrix settings. Return the COMPLETE replacement script, not a patch.
Existing journey: ${JSON.stringify(cfg.journeys[name])}
Existing script:\n${repoText(priorScript)}\nExisting feature:\n${repoText(priorFeature)}` : `Add ONE journey for this user request: ${JSON.stringify(request)}.`;
    const a = await askAgent({ ...agent, cwd: repo, tools: toolless ? 'none' : 'read', record, schema, prompt: `${goal}
Read only; never edit files, run commands or drive the app during generation. Use only the real handles in the supplied repository source. Never open secret-looking files or include secret values. Return blocker with the real cause if this cannot be driven safely; leave blocker empty otherwise.
Return name (lowercase kebab-case), title, source (one tracked non-secret file shown below), script (a complete Node ESM capture script), checks (the concrete assertions and expected user-visible result), spends (empty unless it uses a paid service or sends/posts externally), blocker. Empty spends/blocker means a zero-character JSON string, not a string containing quote characters. Generation cost itself is not a journey spend.
Return script as source text, not JSON.stringify(source). After the JSON response is decoded, JavaScript statements must have actual newline separators, not literal backslash-n sequences. Do not double-escape the source.
The script runs from the repo root as node journeys/<name>.mjs. Drive the REAL app the way a user does, not tests, typechecks, lint or builds. Use isolated temporary state and clean up only what the script started. Use Umer for demo data. No installed app state or real accounts. Reuse existing proof handles where possible.
The saved script MUST be deterministic and self-contained: no agents, model calls, done-done verify, generation or Firstmate dependency at runtime. Use node:assert/strict to check actual output/side effects; a failed check must exit nonzero. Write captures of the actual resulting state into process.env.DONE_DONE_EVIDENCE_ROOT, never invented output. Write steps.json there (${STEPS_SHAPE}) from the actual drive. Honour DONE_DONE_BASE_URL and matrix env when configured; screenshot/page-check records for visual flows. Do not embed absolute checkout paths.
Existing verify skill:\n${repoText(join(repo, cfg.skill, 'SKILL.md'))}\nFeature map:\n${repoText(index)}\n\n${context.text}` });
    if (repoState(repo) !== before)
        throw new UsageError('the repo changed during generation; no recipe was written; review the changes before retrying');
    if (!a.ok)
        throw new UsageError(`${agent.agent} did not generate a journey: ${a.error}; record ${a.record ?? record}`);
    const s = a.answer;
    for (const field of ['blocker', 'spends'])
        if (!/[\p{L}\p{N}]/u.test(s[field]))
            s[field] = '';
    if (s.blocker.trim())
        throw new UsageError(`journey ${action} blocked: ${s.blocker}`);
    if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(s.name) || s.name === 'readme')
        throw new UsageError('the agent returned an invalid journey name');
    if (named ? s.name !== name : Object.hasOwn(cfg.journeys, s.name))
        throw new UsageError(named ? 'the agent renamed the journey; nothing written' : `journey ${s.name} already exists; nothing written`);
    if (!s.title.trim() || !s.checks.trim() || !s.script.includes('DONE_DONE_EVIDENCE_ROOT'))
        throw new UsageError('the agent returned no title, checks or capture script; nothing written');
    if (absoluteInside(s.script, repo))
        throw new UsageError('the agent embedded an absolute checkout path; nothing written');
    if (!context.files.has(s.source) || SECRET.test(s.source) || (toolless && !context.read.has(s.source)))
        throw new UsageError(`the agent cited an unavailable source: ${s.source}; nothing written`);
    // Parse, never execute, before touching any project file.
    try {
        execFileSync(process.execPath, ['--check', '--input-type=module'], { input: s.script, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    }
    catch (e) {
        throw new UsageError(`the agent returned invalid JavaScript; nothing written: ${String(e.stderr || e.message).trim()}`, `Review the generator answer: ${a.record ?? record}`);
    }
    const script = join(repo, 'journeys', `${s.name}.mjs`), feature = join(dirname(index), `${s.name}.md`);
    for (const p of [script, feature]) {
        safePath(p);
        if (!named && existsSync(p))
            throw new UsageError(`${shown(repo, p)} already exists; nothing written`);
    }
    const originalConfig = readFileSync(config, 'utf8'), originalIndex = readFileSync(index, 'utf8');
    const doc = parseDocument(originalConfig);
    if (doc.get('journeys') == null)
        doc.set('journeys', doc.createNode({}));
    if (!named)
        doc.setIn(['journeys', s.name], doc.createNode({}));
    doc.setIn(['journeys', s.name, 'command'], `node journeys/${s.name}.mjs`);
    if (s.spends.trim())
        doc.setIn(['journeys', s.name, 'spends'], [cfg.journeys[s.name]?.spends, s.spends.trim()].filter(Boolean).join('; '));
    if (named) {
        const command = doc.getIn(['journeys', s.name, 'command'], true);
        command.commentBefore = [command.commentBefore, ` ${label} ${improve ? 'instruction' : 'focus'}: ${JSON.stringify(request)}`].filter(Boolean).join('\n');
    }
    const nextConfig = doc.toString({ lineWidth: 0 });
    loadConfig(repo, nextConfig);
    const featureText = `# ${s.title}\n\nRequest: ${request}\n\nSource: \`${s.source}\`, \`journeys/${s.name}.mjs\`.\n\n## Drive and capture\n\nRun \`done-done run ${s.name}\`. The committed script drives the app, checks the result and writes captures and steps.json into $DONE_DONE_EVIDENCE_ROOT.\n\n## Checks\n\n${s.checks}\n`;
    const nextFeature = named && existsSync(feature) ? `${readFileSync(feature, 'utf8').trimEnd()}\n\n## ${label} coverage\n\n${improve ? 'Instruction' : 'Focus'}: ${request}\n\nSource: \`${s.source}\`.\n\n${s.checks}\n` : featureText;
    const nextIndex = named && originalIndex.includes(`](${s.name}.md)`) ? originalIndex : `${originalIndex.trimEnd()}\n- [${s.title}](${s.name}.md): run \`done-done run ${s.name}\`\n`;
    const files = new Map([[script, `${s.script.trim()}\n`], [feature, nextFeature], [index, nextIndex], [config, nextConfig]]);
    const originals = new Map([...files.keys()].map(p => [p, existsSync(p) ? readFileSync(p, 'utf8') : null]));
    const written = [];
    try {
        for (const [p, text] of files) {
            mkdirSync(dirname(p), { recursive: true });
            const fd = openSync(p, originals.get(p) === null ? 'wx' : 'w');
            written.push(p);
            try {
                writeFileSync(fd, text);
            }
            finally {
                closeSync(fd);
            }
        }
    }
    catch (e) {
        for (const p of written.reverse()) {
            const original = originals.get(p);
            if (original !== null)
                writeFileSync(p, original);
            else
                rmSync(p);
        }
        throw e;
    }
    process.stderr.write(`${named ? label : 'Added'} journey ${s.name} through ${agent.agent}. Review these repo changes:\n${git(repo, 'diff', '--stat', '--', ...[...files.keys()].map(p => relative(repo, p)))}\n${[script, feature].filter(p => originals.get(p) === null).map(p => ` ${relative(repo, p)} | ${files.get(p).split('\n').length - 1} new lines`).join('\n')}\nThe first run is a dirty-tree trial, not clean proof. Review and commit, then: done-done run ${s.name}\n`);
    return cmdRun([s.name]);
}
// An entry's role marks, the text doctor reads (src/proof.ts namedJourney).
const marks = (f) => `${f.core ? ` ${MARK.core}` : ''}${f.upgrade ? ` ${MARK.upgrade}` : ''}`;
function verifyFeaturesMd(app, features, omitted) {
    const index = features.map((f) => `- [${f.title}](${f.slug}.md)${marks(f)}: ${clause(f.reach)}`).join('\n');
    const more = omitted ? `\n\n${omitted} more found and not listed; add them by hand or run maintain later.` : '';
    return `# ${app} features\n\nThe repo's maintained verification map; a proof that drives one entry point is incomplete when this lists others.\n\n${index}${more}\n`;
}
// The first existing component on the way from the repo to `p` that is a symlink, if any: a cloned repo's symlink
// would redirect the scaffold's writes out of the repo.
function symlinkOnPath(repo, p) {
    let cur = repo;
    for (const part of relative(repo, p).split(sep)) {
        cur = join(cur, part);
        try {
            if (lstatSync(cur).isSymbolicLink())
                return cur;
        }
        catch {
            return undefined;
        }
    }
    return undefined;
}
// An older init wrote verify-<app>; with no `skill:` set, init moves that folder to the prefixed name once, and says so.
// A prefixed folder that already exists wins, and the old one is left alone.
function renameLegacySkill(repo, cfg) {
    const old = `.agents/skills/verify-${cfg.app}`;
    if (cfg.from.skill || cfg.skill !== old)
        return undefined;
    const next = `.agents/skills/done-done-verify-${cfg.app}`;
    if (existsSync(join(repo, next)) || symlinkOnPath(repo, join(repo, old)) !== undefined)
        return undefined;
    renameSync(join(repo, old), join(repo, next));
    const md = join(repo, next, 'SKILL.md');
    if (existsSync(md))
        writeFileSync(md, readFileSync(md, 'utf8').replace(`name: verify-${cfg.app}`, `name: done-done-verify-${cfg.app}`).replace(`name: "verify-${cfg.app}"`, `name: "done-done-verify-${cfg.app}"`));
    cfg.skill = next;
    return `${old} -> ${next}`;
}
const SCAFFOLD_HELP = 'The verify skill was not written: fix the cause verify_skill names, then re-run: done-done init';
// All-or-nothing: when any target (SKILL.md, features/README.md, a features file) exists as a file or directory,
// nothing is written and the paths are named; otherwise every file is written into a temp dir inside the skill's
// parent and moved into place, so a failed write leaves no partial skill. SKILL.md is moved last, so it marks a
// finished scaffold. The skill folder is checked for symlinks before the agent is asked, and every target before
// the first write. failed: the agent or the write failed, so init fails and the user fixes the cause.
async function scaffoldVerify(repo, cfg) {
    const dir = join(repo, cfg.skill);
    const linked = (ps) => ps.map((p) => symlinkOnPath(repo, p)).find((l) => l !== undefined);
    const skipLink = (link) => ({ status: `skipped, ${shown(repo, link)} is a symlink; write it by hand or remove the link` });
    const blocked = (ps) => ({ status: `skipped: ${ps.map((p) => shown(repo, p)).join(', ')} already exist; delete the skill folder to regenerate` });
    let link = linked([join(dir, 'features', 'README.md'), join(dir, 'SKILL.md')]);
    if (link !== undefined)
        return skipLink(link);
    if (existsSync(join(dir, 'SKILL.md')))
        return blocked([join(dir, 'SKILL.md')]);
    if (existsSync(join(dir, 'features', 'README.md')))
        return blocked([join(dir, 'features', 'README.md')]);
    // No agent: init's agent row already asks the user to set one.
    if (!cfg.agent)
        return { status: 'not written: no agent is set, and the agent writes the verify skill' };
    const agent = selectAgent(cfg);
    // As in maintain, only claude reads the repo with its own tools; every other agent gets the files from plain code.
    const toolless = agent.agent !== 'claude';
    if (toolless && toollessReason(agent.agent))
        return { status: `not written: ${toollessReason(agent.agent)}; set the verify skill agent to claude, codex, opencode, pi or acp with done-done init --agent <agent> --model <model>`, failed: true };
    const context = repoContext(repo, cfg.skill);
    // Every schema-valid answer cites tracked files, so with none there is nothing to ask for.
    if (!context.files.size)
        return { status: "not written: the repo has no tracked files to cite; commit the repo's files, then re-run init", failed: true };
    const record = join(home(), 'agents', `init-${new Date().toISOString().replace(/[:.]/g, '-')}-${agent.agent.replace(/[^\w-]/g, '-')}.json`);
    const ships = shipped(repo);
    const a = await askAgent({ ...agent, prompt: scaffoldPrompt(cfg, context.text, toolless, ships), schema: SCAFFOLD_SCHEMA, cwd: repo, tools: toolless ? 'none' : 'read', record });
    const where = a.record ? `; record ${a.record}` : a.recordError ? `; the call record could not be written: ${a.recordError}` : '';
    if (!a.ok)
        return { status: `not written: ${agent.agent} did not answer: ${a.error}; done-done doctor --probe checks the agent${where}`, failed: true };
    const problem = scaffoldProblem(a.answer, context.files, toolless ? context.read : context.files, ships);
    if (problem)
        return { status: `not written: ${agent.agent}'s answer is unusable: ${problem}${where}`, failed: true };
    const s = a.answer;
    const source = cited(s.launch.source);
    const isolated = s.launch.safe && source !== '' && !MANIFEST.test(basename(source));
    const features = [];
    for (const f of s.features.slice(0, MAX_FEATURES)) {
        let n = slug(f.title);
        for (let i = 2; n === 'readme' || features.some((g) => g.slug === n); i++)
            n = `${slug(f.title)}-${i}`;
        features.push({ ...f, slug: n });
    }
    const omitted = s.features.length - features.length;
    const files = new Map([[join('features', 'README.md'), verifyFeaturesMd(cfg.app, features, omitted)]]);
    for (const f of features)
        files.set(join('features', `${f.slug}.md`), verifyFeatureMd(cfg.app, s, f));
    files.set('SKILL.md', verifySkillMd(cfg.app, agent.agent, s, isolated, features, omitted, ships));
    const targets = [...files].map(([rel, body]) => ({ rel, p: join(dir, rel), body }));
    link = linked(targets.map(({ p }) => p));
    if (link !== undefined)
        return skipLink(link);
    const parent = dirname(dir);
    let tmp;
    const moved = [];
    const made = [];
    const mk = (d) => {
        const missing = [];
        for (let c = d; !existsSync(c); c = dirname(c))
            missing.unshift(c);
        made.push(...missing);
        mkdirSync(d, { recursive: true });
    };
    const undo = () => {
        for (const p of [...moved, ...(tmp ? [tmp] : [])]) {
            try {
                rmSync(p, { recursive: true, force: true });
            }
            catch { }
        }
        for (const d of made.reverse()) {
            try {
                rmdirSync(d);
            }
            catch { }
        }
    };
    try {
        mk(parent);
        tmp = mkdtempSync(join(parent, `${basename(dir)}.tmp-`));
        for (const { rel, body } of targets) {
            mkdirSync(dirname(join(tmp, rel)), { recursive: true });
            writeFileSync(join(tmp, rel), body);
        }
        const have = targets.filter(({ p }) => existsSync(p)).map(({ p }) => p);
        if (have.length) {
            undo();
            return blocked(have);
        }
        for (const { rel, p } of targets) {
            mk(dirname(p));
            renameSync(join(tmp, rel), p);
            moved.push(p);
        }
    }
    catch (e) {
        undo();
        return { status: `not written: the verify skill could not be written (${e.message}); nothing was left behind, so fix the cause and re-run init`, failed: true };
    }
    try {
        rmSync(tmp, { recursive: true, force: true });
    }
    catch { }
    return { status: `written by ${agent.agent}${isolated ? '' : '; its launch is not isolated, so read Launch before a drive'}` };
}
// The session-start hook `init --hook <agent>` adds; the agent shows its stdout to the session.
// Without done-done on PATH it prints nothing and exits 0, so it never breaks a session.
// Claude Code reads it from the repo's .claude/settings.json, Codex from the repo's .codex/hooks.json
// (project scope; Codex docs: <repo>/.codex/hooks.json, SessionStart, matcher omitted matches every start).
const HOOK_COMMAND = 'command -v done-done >/dev/null && done-done || true';
const COMMIT_BEFORE = 'if command -v done-done >/dev/null; then done-done after-commit --before; fi';
const COMMIT_AFTER = 'if command -v done-done >/dev/null; then done-done after-commit; fi';
// Gemini CLI reads a SessionStart hook from the repo's .gemini/settings.json (its hooks reference) but shows plain
// stdout only to the person, so the state goes to the model as JSON hookSpecificOutput.additionalContext.
// done-done runs on node, so node is on PATH whenever done-done is.
const GEMINI_HOOK = `command -v done-done >/dev/null && done-done 2>/dev/null | node -e 'process.stdin.setEncoding("utf8");let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>s.trim()&&process.stdout.write(JSON.stringify({hookSpecificOutput:{additionalContext:s.trim()}})))' || true`;
// A repo settings file with a SessionStart hook running `command` merged in, keeping every other key and hook; no text when it is already there.
function sessionStartSettings(repo, rel, command, agent, afterCommit = false) {
    const file = join(repo, rel);
    const bad = (why) => new UsageError(`${rel} ${why}`, `Fix ${rel}, then re-run: done-done init --hook ${agent}`);
    const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
    let settings = {};
    if (existsSync(file)) {
        try {
            settings = JSON.parse(readFileSync(file, 'utf8'));
        }
        catch (e) {
            throw bad(`is not valid JSON (${e.message})`);
        }
    }
    if (!isObject(settings))
        throw bad('is not a JSON object');
    if (settings.hooks !== undefined && !isObject(settings.hooks))
        throw bad('has "hooks" that is not an object');
    let changed = false;
    for (const [event, cmd] of [['SessionStart', command], ...(afterCommit ? [['PreToolUse', COMMIT_BEFORE], ['PostToolUse', COMMIT_AFTER]] : [])]) {
        const hooks = settings.hooks?.[event] ?? [];
        if (!Array.isArray(hooks))
            throw bad(`has "hooks.${event}" that is not a list`);
        if (hooks.some((m) => Array.isArray(m?.hooks) && m.hooks.some((h) => h?.command === cmd)))
            continue;
        settings.hooks = { ...settings.hooks, [event]: [...hooks, { ...(event !== 'SessionStart' && { matcher: 'Bash' }), hooks: [{ type: 'command', command: cmd, ...(event !== 'SessionStart' && { timeout: 600 }) }] }] };
        changed = true;
    }
    return { file, ...(changed && { text: `${JSON.stringify(settings, null, 2)}\n` }) };
}
// A file init owns outright: written once, unchanged when identical, never overwritten when someone else's.
function ownedFile(repo, rel, text, agent) {
    const file = join(repo, rel);
    if (!existsSync(file))
        return { file, text };
    if (readFileSync(file, 'utf8') === text)
        return { file };
    throw new UsageError(`${rel} already exists with other content, so init will not overwrite it`, `Delete ${rel}, then re-run: done-done init --hook ${agent}`);
}
// The opencode session plugin `init --hook opencode` adds: a project-scope file in
// .opencode/plugins/ (auto-loaded; the home config is never touched) whose chat.message
// hook runs the session command below on the first message of each session and appends
// the bare `done-done` state to the message parts. The appended part carries the prt_ id
// plus the session id from the hook input and the message id from the hook output (opencode
// passes no messageID to the hook), because opencode validates every
// part before save and drops the whole first message when one is invalid. Without
// done-done on PATH it appends nothing and never throws, so it never breaks a session.
function opencodePlugin(repo) {
    const text = `// Written by \`done-done init --hook opencode\`: shows this repo's bare \`done-done\`
// state to each opencode session. On the first message of a session the chat.message
// hook runs \`${HOOK_COMMAND}\` and appends its output to the message parts.
// Without done-done on PATH it appends nothing and never throws, so it never breaks
// a session. Other files in .opencode/plugins/ are untouched; delete this file to opt out.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";

const COMMAND = "${HOOK_COMMAND}";

const seen = new Set();
const firstMessage = (sessionID) => {
  if (seen.has(sessionID)) return false;
  seen.add(sessionID);
  return true;
};

const run = (cwd) => new Promise((resolve) => {
  execFile("sh", ["-c", COMMAND], { cwd, encoding: "utf8", timeout: 30000 }, (error, stdout) => resolve(error ? "" : stdout.trim()));
});

export const DoneDonePlugin = async ({ directory }) => {
  return {
    "chat.message": async (input, output) => {
      if (!firstMessage(input.sessionID)) return;
      const state = await run(directory);
      if (state) output.parts.push({ id: \`prt_\${randomUUID()}\`, messageID: output.message.id, sessionID: input.sessionID, type: "text", text: state });
    },
  };
};
`;
    return ownedFile(repo, '.opencode/plugins/done-done.js', text, 'opencode');
}
// The pi extension `init --hook pi` adds: a project-scope file in .pi/extensions/ (pi loads it once the project
// is trusted; its extensions.md) whose before_agent_start handler runs the session command on the first prompt of
// each session and adds the bare `done-done` state as a message the model reads. Without done-done on PATH it adds
// nothing and never throws, so it never breaks a session.
function piExtension(repo) {
    const text = `// Written by \`done-done init --hook pi\`: shows this repo's bare \`done-done\`
// state to each pi session. On the first prompt of a session the before_agent_start
// handler runs \`${HOOK_COMMAND}\` and adds its output as a message.
// Without done-done on PATH it adds nothing and never throws, so it never breaks
// a session. Other files in .pi/extensions/ are untouched; delete this file to opt out.
import { execFile } from "node:child_process";

const COMMAND = "${HOOK_COMMAND}";

const run = (cwd) => new Promise((resolve) => {
  execFile("sh", ["-c", COMMAND], { cwd, encoding: "utf8", timeout: 30000 }, (error, stdout) => resolve(error ? "" : stdout.trim()));
});

export default function doneDone(pi) {
  let shown = false;
  pi.on("session_start", () => {
    shown = false;
  });
  pi.on("before_agent_start", async (_event, ctx) => {
    if (shown) return;
    shown = true;
    const state = await run(ctx.cwd);
    if (state) return { message: { customType: "done-done", content: state, display: true } };
  });
}
`;
    return ownedFile(repo, '.pi/extensions/done-done.js', text, 'pi');
}
// What `init --hook <agent>` writes, the init output key that names it, and what a session then gets.
const HOOKS = {
    claude: { make: (repo) => sessionStartSettings(repo, '.claude/settings.json', HOOK_COMMAND, 'claude'), rel: '.claude/settings.json', key: 'claude_hook', gets: 'each Claude Code session in this repo then starts with `done-done` output' },
    codex: { make: (repo) => sessionStartSettings(repo, '.codex/hooks.json', HOOK_COMMAND, 'codex'), rel: '.codex/hooks.json', key: 'codex_hook', gets: 'each Codex session in this repo then starts with `done-done` output' },
    opencode: { make: opencodePlugin, rel: '.opencode/plugins/done-done.js', key: 'opencode_plugin', gets: 'the first message of each opencode session in this repo then gets `done-done` output added' },
    pi: { make: piExtension, rel: '.pi/extensions/done-done.js', key: 'pi_extension', gets: 'the first prompt of each pi session in this repo (once you trust the project in pi) then gets `done-done` output added' },
    gemini: { make: (repo) => sessionStartSettings(repo, '.gemini/settings.json', GEMINI_HOOK, 'gemini'), rel: '.gemini/settings.json', key: 'gemini_hook', gets: 'each Gemini CLI session in this repo (a trusted folder) then starts with `done-done` output' },
};
// The commented global config, once: every global key at its default, for the user to edit.
function writeGlobal() {
    const file = join(home(), 'config.yaml');
    if (existsSync(file))
        return 'unchanged';
    mkdirSync(home(), { recursive: true });
    writeFileSync(`${file}.tmp`, globalConfigText());
    renameSync(`${file}.tmp`, file);
    return `written ${file}`;
}
// The user's agent choice, checked before anything is written.
function checkChoice(agent, model) {
    if (!isAgent(agent))
        throw new UsageError(`done-done cannot start ${agent}; it starts ${agentChoices().join(', ')}`, noAgent().help);
    if (agent === 'opencode' && model && !model.includes('/'))
        throw new UsageError(`--model ${model}: an opencode model is provider/model, e.g. ${CHEAP.opencode.model}`);
}
const ACP_TARGET = 'acp:<target>';
// Save the user's agent or judge (and model) in the global config, in place, keeping its comments and every other key.
function saveChoice(kind, { agent, model }) {
    const file = join(home(), 'config.yaml');
    let text = readFileSync(file, 'utf8');
    if (kind === 'agent') {
        const example = /^# agent: .*$/m;
        if (!parseDocument(text).has('agent'))
            text = example.test(text) ? text.replace(example, `agent: ${agent}`) : text.replace(/^(?=[a-z_]+:)/m, `agent: ${agent}\n`);
    }
    const doc = parseDocument(text);
    if (kind === 'agent') {
        doc.set('agent', doc.createNode(agent));
        if (model)
            doc.setIn(['agent_config', agent, 'model'], model);
    }
    else {
        if (!doc.get('judge'))
            doc.set('judge', doc.createNode({}));
        doc.setIn(['judge', 'route'], routeOf(agent));
        if (model)
            doc.setIn(['judge', 'model'], model);
        else
            doc.deleteIn(['judge', 'model']);
    }
    writeFileSync(`${file}.tmp`, doc.toString({ lineWidth: 0 }));
    renameSync(`${file}.tmp`, file);
    return `${kind === 'agent' ? agent : routeOf(agent)}${model ? ` (model ${model})` : ''} saved to ${file}`;
}
// Why a typed model is not one opencode lists, or '' when it is listed or unchecked (only opencode is checked; pi's list comes back cut short on a pipe).
function unknownModel(agent, model, cfg) {
    if (agent !== 'opencode')
        return '';
    const bin = agentPath(agent, cfg);
    if (!bin) {
        process.stderr.write(`${model} is saved unchecked because ${agent} is not on PATH; run 'done-done doctor --probe' to check it\n`);
        return '';
    }
    const r = spawnSync(bin, ['models'], { encoding: 'utf8', timeout: 30_000 });
    if (r.status !== 0) {
        process.stderr.write(`${agent} models failed (${(r.error?.message || r.stderr || `exit ${r.status}`).trim().split('\n').at(-1)}), so ${model} is saved unchecked\n`);
        return '';
    }
    // opencode prints one provider/model per line.
    return r.stdout.split('\n').map((l) => l.trim()).includes(model) ? '' : `${model} is not a model ${agent} lists (${agent} models)`;
}
const interactive = () => !!process.stdin.isTTY && !!process.stderr.isTTY;
const missing = (kind) => (kind === 'agent' ? noAgent() : noJudge());
// In a terminal the user picks the agent (or the judge) and its model from a list; done-done never picks for them.
async function pick(kind, cfg) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    // Lines are read in order, so an answer typed while done-done checks a model list is kept, not dropped.
    // ponytail: each pick has its own interface, so answers typed ahead past the agent list into the judge list are dropped; share one interface if that matters.
    const lines = rl[Symbol.asyncIterator]();
    const ask = async (q) => {
        rl.setPrompt(q);
        rl.prompt();
        const line = await lines.next();
        if (line.done)
            throw new Error('the terminal closed');
        return line.value.trim();
    };
    try {
        const menu = kind === 'agent' ? [...AGENTS, ACP_TARGET] : JUDGES;
        const label = (a) => (a === ACP_TARGET ? `${a} (an agent your acpx bridge starts)` : a);
        const head = kind === 'agent' ? 'done-done starts a coding agent you choose, and none is set. Agents:' : 'done-done judges each capture with an agent you choose, and none is set. Judges:';
        process.stderr.write(`${head}\n${menu.map((a, i) => `  ${i + 1}) ${label(a)}\n`).join('')}`);
        for (;;) {
            let agent = '';
            while (!agent) {
                const said = await ask(`${kind} [1-${menu.length}]: `);
                const n = Number(said);
                if (!Number.isInteger(n) || n < 1 || n > menu.length) {
                    process.stderr.write(`${said || 'nothing'} is not on the list; type a number from 1 to ${menu.length}\n`);
                    continue;
                }
                agent = menu[n - 1];
                if (agent !== ACP_TARGET)
                    continue;
                const target = await ask('acp target, e.g. claude-code: ');
                agent = isAgent(`acp:${target}`) ? `acp:${target}` : '';
                if (!agent)
                    process.stderr.write(`${target || 'nothing'} is not an acp target name; pick again\n`);
            }
            const cheap = CHEAP[agent]?.model;
            const who = kind === 'agent' ? agent : `the ${agent} judge`;
            const typed = kind === 'judge' && !cheap;
            const example = agent === 'opencode' ? ' as provider/model' : '';
            if (typed)
                process.stderr.write(`${who} has no cheap model, so type its model name${example}:\n`);
            else
                process.stderr.write(`Models for ${who}:\n  1) ${cheap ? `${cheap} (cheap)` : `${agent}'s own default`}\n  2) another (type its name${example})\n`);
            let model;
            while (model === undefined) {
                const n = typed ? '2' : await ask('model [1-2]: ');
                if (n === '1')
                    model = cheap ?? '';
                else if (n === '2')
                    while (model === undefined) {
                        const typedModel = await ask('model: ');
                        const why = !typedModel ? 'no model typed' : agent === 'opencode' && !typedModel.includes('/') ? `${typedModel} is not provider/model` : unknownModel(agent, typedModel, cfg);
                        if (why)
                            process.stderr.write(`${why}; type it again\n`);
                        else {
                            model = typedModel;
                            if (agent !== 'opencode')
                                process.stderr.write(`the model was not checked because ${agent} has no model list; run 'done-done doctor --probe' to check it\n`);
                        }
                    }
                else
                    process.stderr.write(`${n || 'nothing'} is not 1 or 2\n`);
            }
            if (kind === 'agent')
                return { agent, model };
            try {
                checkJudge(cfg, agent, model);
                return { agent, model };
            }
            catch (e) {
                if (!(e instanceof UsageError))
                    throw e;
                process.stderr.write(`${e.message}\n`);
            }
        }
    }
    catch {
        throw missing(kind); // the terminal closed before an answer
    }
    finally {
        rl.close();
    }
}
// A command that starts the agent or the judge needs the one the user set. With none, it asks in a terminal and saves
// the answer; anywhere else it stops with the ask error, so a calling agent asks its user instead of picking.
async function withChoice(kind, cfg) {
    if (kind === 'agent' ? cfg.agent : cfg.judge.route)
        return;
    if (!interactive())
        throw missing(kind);
    const choice = await pick(kind, cfg);
    writeGlobal();
    process.stderr.write(`${saveChoice(kind, choice)}\n`);
    if (kind === 'agent') {
        cfg.agent = choice.agent;
        if (choice.model)
            cfg.agent_config[choice.agent] = { ...cfg.agent_config[choice.agent], model: choice.model };
    }
    else {
        cfg.judge.route = routeOf(choice.agent);
        cfg.judge.model = choice.model;
    }
}
// The user's judge choice, checked before anything is written: an agent done-done can judge through, with a model.
function checkJudge(cfg, agent, model) {
    if (!JUDGES.includes(agent))
        throw new UsageError(`done-done cannot judge through ${agent}; it judges through ${JUDGES.join(', ')}`, noJudge().help);
    if (agent === 'opencode' && model && !model.includes('/'))
        throw new UsageError(`--judge-model ${model}: an opencode model is provider/model, e.g. ${CHEAP.opencode.model}`);
    if (!model && !modelFor(cfg, agent))
        throw new UsageError(`judge: ${agent} has no default model, so a judge needs one`, `Save the judge with its model: done-done init --judge ${agent} --judge-model <model>`);
}
const commitFirst = (skill) => `.done-done.yaml and ${skill} before your first capture: check refuses proof from a tree with uncommitted changes`;
// An absolute path inside the repo in a recipe: the recipe is committed, so it would name this checkout only.
const absoluteInside = (command, repo) => [...command.matchAll(/(?:^|[\s"'=])(\/[^\s"'`;|&<>]*)/g)].map((m) => m[1]).find((p) => p === repo || p.startsWith(`${repo}/`));
async function cmdInit(argv) {
    const dash = argv.indexOf('--');
    const { values } = parseArgs({
        args: dash < 0 ? argv : argv.slice(0, dash),
        options: { agent: { type: 'string' }, model: { type: 'string' }, judge: { type: 'string' }, 'judge-model': { type: 'string' }, hook: { type: 'string' }, 'after-commit': { type: 'boolean' }, journey: { type: 'string' }, core: { type: 'boolean' }, upgrade: { type: 'boolean' } },
        allowPositionals: false,
    });
    const parts = dash < 0 ? [] : argv.slice(dash + 1);
    const journey = values.journey ?? null;
    if (values.hook !== undefined && !Object.hasOwn(HOOKS, values.hook))
        throw new UsageError(`--hook ${values.hook} is not supported; the supported values are ${Object.keys(HOOKS).join(', ')}`, `Run: done-done init --hook <${Object.keys(HOOKS).join('|')}>`);
    if (values['after-commit'] && values.hook !== 'claude')
        throw new UsageError('--after-commit needs --hook claude', 'Run: done-done init --hook claude --after-commit');
    if (values.model !== undefined && values.agent === undefined)
        throw new UsageError('--model needs --agent', `Run: done-done init --agent <agent> --model ${values.model}`);
    if (values.agent !== undefined)
        checkChoice(values.agent, values.model ?? '');
    if (values['judge-model'] !== undefined && values.judge === undefined)
        throw new UsageError('--judge-model needs --judge', `Run: done-done init --judge <agent> --judge-model ${values['judge-model']}`);
    if (journey === null && parts.length)
        throw new UsageError('init needs --journey <name> to record a command after --');
    if (journey === null && (values.core || values.upgrade))
        throw new UsageError(`--${values.core ? 'core' : 'upgrade'} marks the journey init records, so it needs --journey <name> and a command after --`, `Run: done-done init --journey <name> --${values.core ? 'core' : 'upgrade'} -- '<command>'`);
    if (journey !== null && !parts.some((p) => p.trim()))
        throw new UsageError(`init --journey ${journey} needs a command after --`);
    if (journey !== null && !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(journey))
        throw new UsageError(`invalid journey name ${journey}; use letters, digits, - or _`);
    if (journey !== null && codeOnly(commandOf(parts)))
        throw new UsageError(`init --journey ${journey}: ${commandOf(parts)} is code-only: ${RULE}, so check and gate never count its run as proof; nothing was written`, `Record a command that drives the real app, CLI or site the way a user does and saves screenshots, a recording or its transcript into $DONE_DONE_EVIDENCE_ROOT: done-done init --journey ${journey} -- '<that command>'`);
    // Only the judge named: that is a machine setting, so it changes the global config alone, in any directory.
    if (values.judge !== undefined && values.agent === undefined && values.hook === undefined && journey === null) {
        const cfg = loadConfig(process.cwd());
        const choice = { agent: values.judge, model: values['judge-model'] ?? (cfg.judge.route === routeOf(values.judge) ? cfg.judge.model : '') };
        checkJudge(cfg, choice.agent, choice.model);
        const globalConfig = writeGlobal();
        emit({ command: 'init', result: 'pass', global_config: globalConfig, judge: saveChoice('judge', choice), help: ['Set up a repo: cd <your app> && done-done init'] });
        return PASS;
    }
    const repo = repoRoot();
    const file = join(repo, '.done-done.yaml');
    const existed = existsSync(file);
    const cfg = loadConfig(repo); // validates the existing project config; malformed -> exit 2, no writes
    if (cfg.skill.split(/[\\/]/).includes('..'))
        throw new UsageError(`verify skill ${cfg.skill} has a .. segment; use a path inside the repo`, 'Set skill to a repo-relative path in .done-done.yaml');
    const renamed = renameLegacySkill(repo, cfg);
    const spec = values.hook === undefined ? undefined : HOOKS[values.hook];
    const hook = values['after-commit'] ? sessionStartSettings(repo, '.claude/settings.json', HOOK_COMMAND, 'claude', true) : spec?.make(repo); // validated before any write
    // The agent: --agent, else with none set the user's pick in a terminal (asked before any write); never done-done's.
    const choice = values.agent !== undefined ? { agent: values.agent, model: values.model ?? '' } : !cfg.agent && interactive() ? await pick('agent', cfg) : undefined;
    if (choice)
        cfg.agent_config[choice.agent] = { ...cfg.agent_config[choice.agent], ...(choice.model && { model: choice.model }) };
    // The judge likewise: --judge, else with none set the user's pick in a terminal; checked that done-done can judge through it.
    const judgeChoice = values.judge !== undefined ? { agent: values.judge, model: values['judge-model'] ?? (cfg.judge.route === routeOf(values.judge) ? cfg.judge.model : '') } : !cfg.judge.route && interactive() ? await pick('judge', { ...cfg, agent: choice?.agent ?? cfg.agent }) : undefined;
    if (judgeChoice)
        checkJudge({ ...cfg, agent: choice?.agent ?? cfg.agent }, judgeChoice.agent, judgeChoice.model);
    const writeAgent = () => {
        if (choice) {
            const saved = saveChoice('agent', choice);
            const overridden = cfg.from.agent === 'repo' && cfg.agent !== choice.agent;
            return { out: { agent: overridden ? `${saved}; .done-done.yaml overrides it with ${cfg.agent}` : saved }, help: [], code: PASS };
        }
        if (cfg.agent)
            return { out: { agent: `unchanged (${cfg.agent})` }, help: [], code: PASS };
        return { out: { agent: 'not set' }, help: [`${noAgent().message}. ${noAgent().help}`], code: USAGE };
    };
    // A judge not set is not an init failure, since init gives no result: every command that does asks for it first.
    const writeJudge = () => judgeChoice ? { out: { judge: saveChoice('judge', judgeChoice) }, help: [] }
        : cfg.judge.route ? { out: { judge: `unchanged (${cfg.judge.route})` }, help: [] }
            : { out: { judge: 'not set' }, help: [`${noJudge().message}. ${noJudge().help}`] };
    // Written last on both paths, after the config; init reports it as <agent>_hook (or the plugin/extension key).
    const writeHook = () => {
        if (!spec || !hook)
            return { out: {}, help: [] };
        if (hook.text) {
            mkdirSync(dirname(hook.file), { recursive: true });
            writeFileSync(`${hook.file}.tmp`, hook.text);
            renameSync(`${hook.file}.tmp`, hook.file);
        }
        return { out: { [spec.key]: hook.text ? `added to ${spec.rel}` : 'unchanged' }, help: hook.text ? [`Commit ${spec.rel}: ${spec.gets} (it needs done-done on PATH)`] : [] };
    };
    if (journey !== null) {
        // Record the capture recipe in the repo so any checkout can re-run the proof.
        // The command is built once, the same way `run --` builds it, so the recipe re-runs exactly; ${RUN_ID} in it becomes the run id.
        const command = commandOf(parts);
        const inside = absoluteInside(command, repo);
        if (inside)
            throw new UsageError(`init --journey ${journey}: ${inside} is an absolute path inside this repo, and the recipe is committed to .done-done.yaml, so other checkouts cannot run it`, `Name it relative to the repo, e.g.: done-done init --journey ${journey} -- ${command.replaceAll(inside, relative(repo, inside) || '.')}`);
        const doc = existed ? parseDocument(readFileSync(file, 'utf8')) : new Document({ app: cfg.app });
        const top = (doc.toJS() ?? {});
        if (typeof top !== 'object' || Array.isArray(top))
            throw new UsageError(`${file}: top level must be a mapping`);
        const journeys = top.journeys ?? {};
        if (typeof journeys !== 'object' || Array.isArray(journeys))
            throw new UsageError(`${file}: journeys must be a mapping`);
        if (top.journeys == null)
            doc.set('journeys', doc.createNode({}));
        doc.setIn(['journeys', journey, 'command'], command);
        for (const role of ['core', 'upgrade'])
            if (values[role])
                doc.setIn(['journeys', journey, role], true);
        writeFileSync(`${file}.tmp`, doc.toString({ lineWidth: 0 }));
        renameSync(`${file}.tmp`, file);
        const fresh = loadConfig(repo);
        const rel = under(repo, fresh.evidence.root);
        const added = !!rel && ensureIgnored(repo, rel);
        const root = shown(repo, fresh.evidence.root);
        const check = 'done-done check --outcome "<what you proved>" <files it recorded>';
        const globalConfig = writeGlobal();
        const ag = writeAgent();
        const jg = writeJudge();
        const verify = await scaffoldVerify(repo, loadConfig(repo));
        const agentHook = writeHook();
        const code = ag.code !== PASS ? ag.code : verify.failed ? FAIL : PASS;
        emit({
            command: 'init',
            result: code === PASS ? 'pass' : 'fail',
            config: existed ? 'updated' : 'written',
            global_config: globalConfig,
            ...ag.out,
            ...jg.out,
            journey,
            app: fresh.app,
            evidence_root: root,
            gitignore: added ? `added ${rel.replace(/\/+$/, '')}/` : 'unchanged',
            ...(renamed && { skill_renamed: renamed }),
            verify_skill: verify.status,
            ...agentHook.out,
            help: [`Capture proof: done-done run ${journey}, then: ${check}`, ...journeyAsks(repo, fresh), ...agentHook.help, ...ag.help, ...jg.help, ...(verify.failed ? [SCAFFOLD_HELP] : []), `Commit ${commitFirst(fresh.skill)}`],
        });
        return code;
    }
    if (!existed) {
        // No evidence.root: proof goes to <local_root>/<app>, outside the repo, so it outlives this checkout.
        // The pinned app name is what lets every checkout of the repo find the same evidence and receipts.
        const body = `# done-done project config. \`done-done init\` never overwrites this file.
# The app name finds this repo's evidence and receipts from every checkout.
app: ${JSON.stringify(cfg.app)}
# This repo's coding agent, over agent in ~/.done-done/config.yaml (model, effort and the other agent settings stay there).
# agent: opencode
`;
        writeFileSync(`${file}.tmp`, body);
        renameSync(`${file}.tmp`, file);
    }
    // An evidence root inside the repo (an older config's `root: .proof`) stays out of git.
    const rel = under(repo, cfg.evidence.root);
    const added = !!rel && ensureIgnored(repo, rel);
    const root = shown(repo, cfg.evidence.root);
    const check = 'done-done check --outcome "<what you proved>" <files it recorded>';
    const globalConfig = writeGlobal();
    const ag = writeAgent();
    const jg = writeJudge();
    const verify = await scaffoldVerify(repo, loadConfig(repo));
    const agentHook = writeHook();
    const code = ag.code !== PASS ? ag.code : verify.failed ? FAIL : PASS;
    emit({
        command: 'init',
        result: code === PASS ? 'pass' : 'fail',
        config: existed ? 'unchanged' : 'written',
        global_config: globalConfig,
        ...ag.out,
        ...jg.out,
        app: cfg.app,
        evidence_root: root,
        gitignore: added ? `added ${rel.replace(/\/+$/, '')}/` : 'unchanged',
        ...(renamed && { skill_renamed: renamed }),
        verify_skill: verify.status,
        ...agentHook.out,
        help: [
            ...(Object.keys(cfg.journeys).length
                ? [`Capture proof: ${captureHint(cfg)}, then: ${check}`]
                : [`Add a journey that drives the real app and saves proof under $DONE_DONE_EVIDENCE_ROOT (each run's own folder in ${root}), e.g. ${journeyExample}`, `Then commit, run \`done-done run smoke\`, and: ${check}`]),
            ...journeyAsks(repo, loadConfig(repo)),
            ...agentHook.help,
            ...ag.help,
            ...jg.help,
            ...(verify.failed ? [SCAFFOLD_HELP] : []),
            `Commit ${commitFirst(cfg.skill)}`,
        ],
    });
    return code;
}
// The exact next command for a usage or config error, so an agent can recover without reading --help.
function errorHelp(msg, cmd) {
    if (/not inside a git repository/.test(msg))
        return ['Run done-done from inside a git repository'];
    if (/unknown journey|run needs a journey/.test(msg))
        return ['Run `done-done` to list journeys, or capture a one-off proof: done-done run -- <command>'];
    if (cmd && /Unknown option|Unexpected argument|argument missing/.test(msg))
        return [`Valid flags for ${cmd}: ${COMMANDS[cmd].flags.join(', ') || 'none'}. Run \`done-done ${cmd} --help\` for its usage`];
    // Config errors name their file (.done-done.yaml or the global config.yaml); init never rewrites one, so fixing it is the way out.
    if (/\.done-done\.yaml|config\.yaml:/.test(msg))
        return [`Fix the config file named above, then re-run: done-done${cmd ? ` ${cmd}` : ''}`];
    if (!cmd)
        return ['Run `done-done --help` for every command and flag'];
    return [`Run \`done-done ${cmd} --help\` for its usage and flags`];
}
// Whether `p` could hold evidence without writing anything: the nearest existing
// ancestor must be a writable directory. Read-only, so doctor creates nothing.
function writableDir(p) {
    let cur = p;
    for (;;) {
        try {
            if (!statSync(cur).isDirectory())
                return false;
            accessSync(cur, constants.W_OK | constants.X_OK);
            return true;
        }
        catch (e) {
            if (e.code !== 'ENOENT')
                return false;
            const parent = dirname(cur);
            if (parent === cur)
                return false;
            cur = parent;
        }
    }
}
const PROBE_SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
// A tool-less probe starts in seconds; an agent silent for this long is stuck, so doctor says why instead of waiting the agent_timeout.
const PROBE_IDLE_MS = 30_000;
const unknownRow = (check, detail = 'unknown without a valid config', fix = '') => ({ check, status: 'missing', detail, fix });
// Each effective setting of the agent and the file it came from: the global config, the repo's .done-done.yaml, or the built-in default.
function agentSettings(cfg, agent) {
    const rh = relative(homedir(), join(home(), 'config.yaml'));
    const globalFile = outside(rh) ? join(home(), 'config.yaml') : `~${sep}${rh}`;
    const where = (key) => ({ global: globalFile, repo: '.done-done.yaml' })[cfg.from[key]] ?? 'default';
    const c = cfg.agent_config[agent] ?? {};
    const acp = agent.startsWith('acp:');
    const pathKey = acp ? 'acpx_path' : `agent_path_override.${agent}`;
    const args = cfg.agent_args_override[agent] ?? [];
    return [
        `agent ${cfg.agent} (${where('agent')})`,
        `model ${c.model || 'the CLI\'s own'} (${where(`agent_config.${agent}.model`)})`,
        `effort ${c.effort || 'the CLI\'s own'} (${where(`agent_config.${agent}.effort`)})`,
        `args ${args.length ? `${args.length} set` : 'none'} (${where(`agent_args_override.${agent}`)})`,
        `path ${acp ? cfg.acpx_path : cfg.agent_path_override[agent] || `${agent} on PATH`} (${where(pathKey)})`,
        `agent_timeout ${cfg.agent_timeout} (${where('agent_timeout')})`,
    ].join('; ');
}
const modelPhrase = (agent, model) => (model ? `model ${model}` : `its own default model; set agent_config.${agent}.model to choose one`);
// Is this repo worth driving: git, a valid config, a writable evidence root, the agent and the judge are
// required; the verify skill and ffprobe are listed but never fail it.
// doctor changes nothing except the --probe call record (the agent itself may keep its own session files): a missing repo or config is a finding, never a crash.
async function cmdDoctor(argv) {
    let values;
    try {
        ({ values } = parseArgs({ args: argv, options: { probe: { type: 'boolean' } }, allowPositionals: false }));
    }
    catch (e) {
        throw new UsageError(e.message, 'Run `done-done doctor` (or `done-done doctor --probe`) with no other arguments');
    }
    let repo = null;
    try {
        repo = git(process.cwd(), 'rev-parse', '--show-toplevel');
    }
    catch {
        repo = null;
    }
    const checks = [];
    checks.push(repo
        ? { check: 'git', status: 'ok', detail: `inside a git repository at ${repo}`, fix: '' }
        : { check: 'git', status: 'missing', detail: 'not inside a git repository', fix: 'Run done-done from inside a git repository' });
    let cfg = null;
    if (!repo) {
        checks.push({ check: 'config', status: 'missing', detail: 'unknown without a git repository', fix: 'Run done-done from inside a git repository' });
    }
    else {
        try {
            cfg = loadConfig(repo);
            if (existsSync(join(repo, '.done-done.yaml'))) {
                checks.push({ check: 'config', status: 'ok', detail: `.done-done.yaml is valid (app ${cfg.app})`, fix: '' });
            }
            else {
                checks.push({ check: 'config', status: 'missing', detail: 'no .done-done.yaml', fix: 'Run `done-done init` to write a minimal .done-done.yaml' });
            }
        }
        catch (e) {
            checks.push({ check: 'config', status: 'missing', detail: e.message, fix: 'Fix the config file named above, then re-run: done-done doctor' });
        }
    }
    if (!cfg || !repo) {
        checks.push(unknownRow('evidence_root'));
    }
    else if (writableDir(cfg.evidence.root)) {
        checks.push({ check: 'evidence_root', status: 'ok', detail: `writable: ${shown(repo, cfg.evidence.root)}`, fix: '' });
    }
    else {
        checks.push({ check: 'evidence_root', status: 'missing', detail: `not writable: ${shown(repo, cfg.evidence.root)}`, fix: `Make ${cfg.evidence.root} writable, or set evidence.root to a writable folder in .done-done.yaml` });
    }
    if (!cfg || !repo) {
        checks.push(unknownRow('verify_skill'));
    }
    else {
        const dir = join(repo, cfg.skill);
        const skillFile = join(dir, 'SKILL.md');
        if (existsSync(skillFile))
            checks.push({ check: 'verify_skill', status: 'ok', detail: `present at ${shown(repo, skillFile)}`, fix: '' });
        else
            checks.push({
                check: 'verify_skill',
                status: 'missing',
                detail: `no ${shown(repo, skillFile)}; checks still pass with "no verify skill"`,
                fix: `Write ${shown(repo, skillFile)} describing how to drive this app (a later done-done init will scaffold it)`,
            });
    }
    // A repo file that exists but is invalid makes the agent unknown; the global config alone resolves it only when there is no repo file.
    const repoFileInvalid = !cfg && !!repo && existsSync(join(repo, '.done-done.yaml'));
    let agentCfg = cfg;
    let agentError = '';
    if (!agentCfg && !repoFileInvalid) {
        try {
            agentCfg = loadConfig(repo ?? process.cwd(), '');
        }
        catch (e) {
            agentError = e.message;
        }
    }
    const agent = agentCfg?.agent ? selectAgent(agentCfg) : null;
    // An acp:<target> agent is missing when its acpx bridge is: say which, and how to install it.
    const acpx = agent?.agent.startsWith('acp:') ? findBin(agentCfg.acpx_path) : undefined;
    const override = agent && agentCfg.agent_path_override[agent.agent];
    const notFound = acpx !== undefined ? `${agent.agent} needs acpx, the ACP bridge, which is not startable (${acpx ? `${acpx} does not run` : isAbsolute(agentCfg.acpx_path) ? `acpx_path ${agentCfg.acpx_path} is not an executable file` : 'not on PATH'})`
        : notStartable(agent?.agent ?? '', override || '');
    const askFix = `ask the user which agent to use and save it: done-done init --agent <agent> --model <model>`;
    const installFix = acpx === undefined ? `Install ${agent?.agent}, or ${askFix}` : ACPX_INSTALL;
    if (repoFileInvalid) {
        checks.push(unknownRow('agent'));
    }
    else if (!agentCfg) {
        checks.push({ check: 'agent', status: 'missing', detail: agentError, fix: 'Fix the config file named above, then re-run: done-done doctor' });
    }
    else if (!agent) {
        checks.push({ check: 'agent', status: 'missing', detail: noAgent().message, fix: noAgent().help });
    }
    else {
        const what = `${agent.agent} (${modelPhrase(agent.agent, agent.model)}; from config)`;
        checks.push(!agent.path
            ? { check: 'agent', status: 'missing', detail: `${what}: ${notFound}`, fix: installFix }
            : { check: 'agent', status: 'ok', detail: `${what} at ${agent.path}`, fix: '' });
        if (agent.agent === 'pi')
            checks.push({ check: 'tool_gate', status: 'warning', detail: 'pi has no permission gate: every pi tool runs without approval', fix: '' });
        // codex's sandbox covers its shell too, so a drive's recipe tool writes only where the drive may.
        if (agent.agent === 'codex')
            checks.push({ check: 'tool_gate', status: 'warning', detail: "codex's drive sandbox lets its commands write only the repo, the run's evidence and scratch folders, $TMPDIR and /tmp; a tool that writes elsewhere needs its folder added with agent_args_override.codex: [--add-dir, <folder>] (see docs/reference.md, Drive by agent)", fix: '' });
    }
    // The judge the user set (judge.route).
    let choice;
    let choiceError;
    if (cfg)
        try {
            choice = selectJudge(cfg, judgeAuthor(cfg));
        }
        catch (e) {
            choiceError = e;
        }
    const choiceRow = (check) => ({ check, status: 'missing', detail: choiceError.message, fix: choiceError.help ?? 'Fix the judge config, then re-run: done-done doctor' });
    if (!cfg) {
        checks.push(unknownRow('judge'));
    }
    else if (!choice) {
        checks.push(choiceRow('judge'));
    }
    else {
        try {
            const { detail } = await backend(cfg, choice);
            checks.push({ check: 'judge', status: 'ok', detail: `${choice.route} (model ${choice.model}): ${detail}; doctor does not call the model`, fix: '' });
        }
        catch (e) {
            checks.push({ check: 'judge', status: 'missing', detail: e.message, fix: e.help ?? 'Re-run done-done doctor after fixing the error above' });
        }
    }
    const ffprobe = onPath('ffprobe');
    checks.push(ffprobe
        ? { check: 'ffprobe', status: 'ok', detail: `found at ${ffprobe}`, fix: '' }
        : { check: 'ffprobe', status: 'missing', detail: 'no ffprobe on PATH; video evidence is unverified, never a pass', fix: 'Install ffprobe (ffmpeg) to verify video evidence' });
    // How far the judge is from the author: shown, never refused, since the user's choice runs whatever it is.
    if (!cfg || !agent) {
        checks.push(unknownRow('judge_choice', cfg && agentCfg ? 'unknown until the agent is set' : undefined));
    }
    else if (!choice) {
        checks.push(choiceRow('judge_choice'));
    }
    else {
        const apart = { agent: 'a different agent from the author', model: 'the author\'s agent at a different model', 'session-only': 'the author\'s agent and model in a fresh session (session-only independence)' }[choice.independence];
        checks.push({ check: 'judge_choice', status: 'ok', detail: `${choice.route} (model ${choice.model}; from config) judges the author ${choice.author.agent} (model ${choice.author.model || 'none'}): ${apart}`, fix: '' });
    }
    if (values.probe && !agent)
        checks.push(unknownRow('probe'));
    if (values.probe && agent) {
        const record = join(home(), 'agents', `probe-${new Date().toISOString().replace(/[:.]/g, '-')}-${agent.agent}.json`);
        const probe = !agent.path ? { ok: false, error: notFound, fix: installFix }
            : await askAgent({ ...agent, prompt: 'This is a connectivity probe from done-done doctor. Use no tools. Answer with ok set to true.', schema: PROBE_SCHEMA, cwd: repo ?? process.cwd(), tools: 'none', record, idleMs: PROBE_IDLE_MS });
        checks.push(probe.ok && probe.answer?.ok === true
            ? { check: 'probe', status: 'ok', detail: `${agent.agent} (${modelPhrase(agent.agent, agent.model)}) answered the schema question; ${probe.recordError ? `the call record could not be written: ${probe.recordError}` : `record ${record}`}`, fix: '' }
            : { check: 'probe', status: 'missing', detail: `${agent.agent} did not answer: ${probe.error ?? `answer ${JSON.stringify(probe.answer)}`}${probe.record ? `; record ${record}` : ''}${probe.recordError ? `; the call record could not be written: ${probe.recordError}` : ''}`, fix: probe.fix ?? `${probe.stderr ? `${agent.agent} stderr: ${probe.stderr}. ` : ''}Check that ${agent.agent} is signed in${agent.model ? ` and can use model ${agent.model}` : ''}, or set agent_config.${agent.agent}.model` });
    }
    if (agent)
        checks.push({ check: 'agent_settings', status: 'ok', detail: agentSettings(agentCfg, agent.agent), fix: '' });
    // Real product: a journey that only runs code checks is no proof, so a config of only those can never pass check or gate.
    if (!cfg || !repo) {
        checks.push(unknownRow('real_product'));
    }
    else {
        const names = Object.keys(cfg.journeys);
        const code = codeOnlyJourneys(cfg.journeys);
        const fix = `Record a journey that drives the real app and saves screenshots, a recording or its transcript into $DONE_DONE_EVIDENCE_ROOT: done-done init --journey <name> -- '<command>'; then delete ${code.join(', ')} from .done-done.yaml`;
        checks.push(configFault(cfg.journeys) ? { check: 'real_product', status: 'missing', detail: configFault(cfg.journeys), fix }
            : code.length ? { check: 'real_product', status: 'warning', detail: `${code.join(', ')} ${code.length > 1 ? 'are' : 'is'} code-only (${RULE}): proof only from ${code.length > 1 ? 'them' : 'it'} is refused; ${names.filter((n) => !code.includes(n)).join(', ')} drive${names.length - code.length > 1 ? '' : 's'} the product`, fix: `Cite captures from the journeys that drive the product; delete ${code.join(', ')} from .done-done.yaml if it is not needed` }
                : { check: 'real_product', status: 'ok', detail: names.length ? `${names.join(', ')} drive${names.length > 1 ? '' : 's'} the product` : 'no journeys: verify has the agent drive the verify skill\'s features', fix: '' });
    }
    // The core journey and, for an app that ships an installable artifact, the upgrade-in-place journey: named in config or the feature map.
    if (!cfg || !repo) {
        checks.push(unknownRow('core_journey'), unknownRow('upgrade_journey'));
    }
    else {
        const map = featureMap(repo, cfg);
        const core = namedJourney('core', cfg.journeys, map);
        checks.push(core
            ? { check: 'core_journey', status: 'ok', detail: `${core} is the core user journey`, fix: '' }
            : { check: 'core_journey', status: 'missing', detail: `no core user journey is named: a journey with core: true that drives the product, or a ${MARK.core} entry in ${cfg.skill}/features/README.md`, fix: CORE_FIX });
        const ships = shipped(repo);
        const upgrade = namedJourney('upgrade', cfg.journeys, map);
        checks.push(!ships.length
            ? { check: 'upgrade_journey', status: 'ok', detail: 'no tracked file shows an installable or upgradable artifact, so no upgrade journey is needed', fix: '' }
            : upgrade
                ? { check: 'upgrade_journey', status: 'ok', detail: `${upgrade} upgrades in place (the app ships ${ships.slice(0, 3).join('; ')})`, fix: '' }
                : { check: 'upgrade_journey', status: 'missing', detail: `the app ships an installable artifact (${ships.slice(0, 3).join('; ')}${ships.length > 3 ? `; +${ships.length - 3} more` : ''}) and no upgrade journey is named: a fresh install alone is no release proof`, fix: UPGRADE_FIX });
    }
    const required = ['git', 'config', 'evidence_root', 'real_product', 'core_journey', 'upgrade_journey', 'agent', 'judge', ...(values.probe ? ['probe'] : [])];
    const missingRequired = checks.filter((c) => c.status === 'missing' && required.includes(c.check));
    const result = { command: 'doctor', result: missingRequired.length ? 'fail' : 'pass', checks };
    // Several missing items can share one fix (set up the config once); name each fix only once.
    const fixes = [...new Set(missingRequired.map((c) => c.fix).filter(Boolean))];
    if (cfg && repo) {
        const names = Object.keys(cfg.journeys);
        const check = '`done-done check --outcome "<what you proved>" <files it recorded>`';
        result.help = missingRequired.length
            ? fixes
            : names.length
                ? [`Capture proof with \`done-done run ${names[0]}\`, then check it with ${check}`]
                : [...driveHint(repo, cfg), `Add a journey to .done-done.yaml (${journeyExample}), commit, then \`done-done run smoke\` and ${check}`];
    }
    else {
        result.help = fixes;
    }
    emit(result);
    return missingRequired.length ? USAGE : PASS;
}
// The look step: one page measured, with its actions clicked, against the project's look reference and the --mock design.
async function cmdLook(argv) {
    const { values, positionals } = parseArgs({ args: argv, options: { out: { type: 'string' }, mock: { type: 'string' }, act: { type: 'string', multiple: true } }, allowPositionals: true });
    if (positionals.length !== 1)
        throw new UsageError('look needs one page URL', 'Re-run with the page to check: done-done look <url>');
    // A path to a page on disk opens as its file:// URL.
    const url = !/^[a-z][\w+.-]*:/i.test(positionals[0]) && existsSync(positionals[0]) ? pathToFileURL(resolve(positionals[0])).href : positionals[0];
    const capture = resolve(values.out ?? join(process.env.DONE_DONE_EVIDENCE_ROOT || '.', 'look.png'));
    if (!capture.endsWith('.png'))
        throw new UsageError(`--out ${values.out} must be a .png file`);
    const cfg = loadConfig(repoOrCwd());
    // The mock and the judge are checked before Chrome starts, so a bad one costs no capture.
    const mock = values.mock === undefined ? undefined : loadScreen(values.mock);
    const choice = mock && (await preflightJudge(cfg, false));
    mkdirSync(dirname(capture), { recursive: true });
    const record = await look(url, capture, 390, 844, values.act ?? []);
    const hits = lookIssues(record, cfg.look);
    const [judged] = mock && choice ? await design(cfg, choice, [{ ...loadScreen(capture), mock }], join(home(), 'agents')) : [];
    for (const d of judged?.defects ?? [])
        hits.push(`${url} differs from the approved design ${values.mock}: ${d.kind}: ${d.where}`);
    const code = hits.length ? FAIL : judged?.verdict === 'unsure' ? INCONCLUSIVE : PASS;
    const shown = cap(hits);
    const again = `done-done look ${[positionals[0], ...(values.act ?? []).flatMap((a) => ['--act', a]), ...(values.mock ? ['--mock', values.mock] : []), ...(values.out ? ['--out', values.out] : [])].map(quote).join(' ')}`;
    emit({
        command: 'look',
        // look measures the layout; it gives no verdict on the outcome, which only the judged check does.
        result: code === FAIL ? 'fail' : code === INCONCLUSIVE ? 'inconclusive' : 'clean',
        url,
        viewport: '390x844',
        capture,
        record: domRecord(capture),
        ...(cfg.look && { reference: { ...cfg.look, ...(values.mock && { mock: values.mock }) } }),
        ...(judged && { judge: { route: choice.route, model: choice.model, verdict: judged.verdict, ...(judged.reason && { reason: judged.reason }), ...(judged.cached && { cached: true }) } }),
        hits: shown.items,
        ...(shown.omitted && { hits_omitted: shown.omitted }),
        help: code === FAIL ? [`Fix each element or action named above so it fits the 390 px wide screen, the design and its reference, then re-run: ${again}`]
            : code === INCONCLUSIVE ? [`The judge is unsure the page matches ${values.mock}: look at both yourself, then re-run: ${again}`]
                : ['No squashed, clipped or cut-off UI on this page; look at the capture to check the rest'],
    });
    return code;
}
// The folder of a branch where a receipt copied from the evidence root is committed, for `gate`.
const GATE_DIR = '.done-done-receipts';
// The reason no committed receipt vouches for `tip`, or null when one does. Reads git objects only: no config, no judge, no evidence files.
function gateFault(repo, tip, dir, pushed, warnings) {
    const short = tip.slice(0, 12);
    const names = git(repo, '-c', 'core.quotepath=off', 'ls-tree', '-r', '--name-only', tip, '--', dir).split('\n').filter((n) => n.endsWith('.json'));
    if (!names.length)
        return `no receipt in ${dir}/ at ${short}`;
    const reasons = [];
    for (const name of names) {
        const why = (() => {
            let rec;
            try {
                rec = JSON.parse(git(repo, 'show', `${tip}:${name}`));
            }
            catch (e) {
                return `${name} is malformed (${e.message})`;
            }
            const fault = receiptFault(rec, basename(name));
            if (fault)
                return fault;
            if (name !== `${dir}/${rec.head}.json`)
                return `${name} does not name its own head ${String(rec.head).slice(0, 12)}`;
            try {
                git(repo, 'merge-base', '--is-ancestor', rec.head, tip);
            }
            catch {
                return `receipt head ${rec.head.slice(0, 12)} is not ${short} or an ancestor of it (a shallow checkout needs full history)`;
            }
            const outside = git(repo, '-c', 'core.quotepath=off', 'diff', '--name-only', rec.head, tip).split('\n').filter((n) => n && !n.startsWith(`${dir}/`));
            if (outside.length)
                return `${named(outside)} changed after receipt head ${rec.head.slice(0, 12)}, so its proof no longer covers ${short}`;
            const at = Date.parse(rec.at);
            if (!(Math.floor(at / 1000) <= Math.floor(pushed / 1000)))
                return `receipt time ${rec.at} is not before the push (${new Date(pushed).toISOString()})`;
            const warn = receiptWarning(rec);
            if (warn)
                warnings.push(warn);
            return null;
        })();
        if (!why)
            return null;
        reasons.push(why);
    }
    return reasons.join('; ');
}
// `done-done gate`: the no-model check a hosted runner can run. A receipt committed under GATE_DIR vouches for the head.
function cmdGate(argv) {
    const { values, positionals } = parseArgs({ args: argv, options: { dir: { type: 'string' }, pushed: { type: 'string' } }, allowPositionals: true });
    if (positionals.length > 1)
        throw new UsageError('gate takes at most one head', 'Re-run as: done-done gate [<head>] [--dir <folder>] [--pushed <time>]');
    const repo = repoRoot();
    let tip;
    try {
        tip = git(repo, 'rev-parse', '--verify', `${positionals[0] ?? 'HEAD'}^{commit}`);
    }
    catch {
        throw new UsageError(`gate: ${positionals[0]} is not a commit in this checkout`, 'Pass the pull request head sha, or run it in a checkout of that head');
    }
    const pushed = values.pushed === undefined ? Number(git(repo, 'log', '-1', '--format=%ct', tip)) * 1000 : Date.parse(values.pushed);
    if (Number.isNaN(pushed))
        throw new UsageError(`gate: --pushed ${values.pushed} is not a time`, 'Pass an ISO time such as 2026-10-20T09:05:56Z');
    const warnings = [];
    const why = gateFault(repo, tip, (values.dir ?? GATE_DIR).replace(/\/+$/, ''), pushed, warnings);
    console.log(why === null ? ['PASS', ...warnings.map((w) => `WARN: ${w}`)].join('\n') : `FAIL: ${why}`);
    return why === null ? PASS : FAIL;
}
function cmdLint(argv) {
    const { positionals } = parseArgs({ args: argv, allowPositionals: true });
    if (positionals.length !== 2)
        throw new UsageError('lint needs a PR URL or report file, then the evidence folder', 'Re-run as: done-done lint <PR URL | report file> <evidence folder>');
    const { checks } = loadConfig(process.cwd());
    const v = lint(positionals[0], positionals[1], home(), checks);
    console.log(!v.ok ? `FAIL: ${v.why}` : v.warn ? `WARN: ${v.warn}` : 'PASS');
    return v.ok ? PASS : FAIL;
}
// A screen or mock file for the design judge.
function loadScreen(name) {
    let bytes;
    try {
        bytes = readFileSync(name);
    }
    catch (e) {
        throw new UsageError(`${name}: cannot read (${e.code ?? e.message})`, 'Pass screen and mock files that exist');
    }
    return { name, bytes, sha256: sha256(bytes), media: checkMedia(name, bytes) };
}
function repoOrCwd() {
    try {
        return repoRoot();
    }
    catch {
        return process.cwd();
    }
}
async function cmdDesign(argv) {
    const { values, positionals } = parseArgs({ args: argv, options: { mock: { type: 'string', multiple: true } }, allowPositionals: true });
    const mocks = new Map();
    for (const m of values.mock ?? []) {
        const at = m.indexOf('=');
        if (at < 1 || at === m.length - 1)
            throw new UsageError(`--mock ${m} must be <screen>=<mock>`, 'Re-run with --mock <screen file>=<mock file>');
        mocks.set(resolve(m.slice(0, at)), m.slice(at + 1));
    }
    const names = [...new Set([...positionals, ...[...mocks.keys()].filter((p) => !positionals.some((n) => resolve(n) === p))])];
    if (!names.length)
        throw new UsageError('design needs at least one screen file', 'Re-run with the screens to check: done-done design <screens...>');
    const screens = names.map((n) => ({ ...loadScreen(n), ...(mocks.has(resolve(n)) && { mock: loadScreen(mocks.get(resolve(n))) }) }));
    const cfg = loadConfig(repoOrCwd());
    const choice = await preflightJudge(cfg, false);
    const judged = await design(cfg, choice, screens, join(home(), 'agents'));
    const count = (v) => judged.filter((j) => j.verdict === v).length;
    const code = count('fail') ? FAIL : count('unsure') ? INCONCLUSIVE : PASS;
    const order = ['fail', 'unsure', 'pass'];
    const rows = cap([...judged].sort((a, b) => order.indexOf(a.verdict) - order.indexOf(b.verdict)));
    const again = `done-done design ${names.map(quote).join(' ')}${[...values.mock ?? []].map((m) => ` --mock ${quote(m)}`).join('')}`;
    emit({
        command: 'design',
        result: code === PASS ? 'pass' : code === FAIL ? 'fail' : 'inconclusive',
        judge: { route: choice.route, model: choice.model, independence: choice.independence, author: choice.author.agent ? `${choice.author.agent} (model ${choice.author.model || 'none'})` : 'no agent set' },
        counts: { pass: count('pass'), fail: count('fail'), unsure: count('unsure') },
        screens: rows.items,
        ...(rows.omitted && { screens_omitted: rows.omitted }),
        help: code === PASS ? ['Every screen passed the design check'] : code === FAIL ? [`Fix each defect named above, capture the screens again, then re-run: ${again}`] : [`Look at the unsure screens yourself, or capture them as PNG and re-run: ${again}`],
    });
    return code;
}
// The receipts in the evidence root that are well-formed passes filed under their own head, by head.
function receiptsByHead(cfg) {
    const dir = receiptsDir(cfg);
    const found = new Map();
    for (const name of existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.json')) : []) {
        try {
            const rec = JSON.parse(readFileSync(join(dir, name), 'utf8'));
            if (!receiptFault(rec, name) && name === `${rec.head}.json`)
                found.set(rec.head, rec);
        }
        catch {
            // A receipt that cannot be read vouches for nothing; receipt --verify names its fault.
        }
    }
    return found;
}
// The default branch to diff a change against, as the Firstmate merge gate picks it: origin/HEAD, else origin/main or
// origin/master, else the local main or master. '' when there is none.
function defaultBranch(repo) {
    try {
        return git(repo, 'symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD');
    }
    catch {
        return ['origin/main', 'origin/master', 'main', 'master'].find((r) => spawnSync('git', ['rev-parse', '-q', '--verify', `${r}^{commit}`], { cwd: repo, stdio: 'ignore' }).status === 0) ?? '';
    }
}
const isAncestor = (repo, a, b) => spawnSync('git', ['merge-base', '--is-ancestor', a, b], { cwd: repo, stdio: 'ignore' }).status === 0;
// The journeys and features `changed` needs (src/affected.ts), from the verify skill at the working tree.
function mapDiff(repo, cfg, changed, tracked, noBase) {
    const featDir = join(repo, cfg.skill, 'features');
    const features = Object.fromEntries(skillFeatures(repo, cfg).map((n) => [n, repoText(join(featDir, `${n}.md`)) ?? '']));
    const coreLine = featureMap(repo, cfg).split('\n').find((l) => /^\s*[-*] /.test(l) && l.includes(MARK.core));
    return mapChange({ changed, tracked, journeys: cfg.journeys, skill: cfg.skill, features, coreFeature: coreLine?.match(/\]\(([^)#]+)\.md\)/)?.[1], noBase });
}
// Which journeys the change needs (src/affected.ts) and whether HEAD's proof covers them. The change is read from `baseArg`,
// else from the newest receipt before HEAD (the commits since the last proof), else from the merge base with the default
// branch; with none, the mapping is uncertain and the core journey is needed.
function affectedOf(repo, cfg, baseArg) {
    const now = head(repo);
    const receipts = receiptsByHead(cfg);
    let base = null;
    if (baseArg !== undefined) {
        try {
            base = { commit: git(repo, 'rev-parse', '--verify', `${baseArg}^{commit}`), from: baseArg };
        }
        catch {
            throw new UsageError(`affected: ${baseArg} is not a commit in this checkout`, 'Pass a branch, tag or commit: done-done affected [<base>]');
        }
    }
    else {
        // ponytail: one git call per receipt to find the ones before HEAD; index receipts by commit when a repo keeps thousands.
        const older = [...receipts.keys()].filter((h) => h !== now.commit && isAncestor(repo, h, now.commit));
        const nearest = older.find((h) => older.every((o) => isAncestor(repo, o, h)));
        const ref = nearest ? '' : defaultBranch(repo);
        const mb = ref ? spawnSync('git', ['merge-base', ref, 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim() : '';
        if (nearest)
            base = { commit: nearest, from: `the last receipt, for ${nearest.slice(0, 12)}` };
        else if (mb && mb !== now.commit)
            base = { commit: mb, from: `the merge base with ${ref}` };
    }
    const list = (...a) => git(repo, ...a).split('\0').filter(Boolean);
    const tracked = list('ls-files', '-z');
    // ignore_paths and committed gate receipts need no journey.
    const counts = (p) => !p.startsWith(`${GATE_DIR}/`) && !cfg.evidence.ignore_paths.some((g) => matchesGlob(p, g));
    // Untracked files are no part of the change until added, as everywhere else in done-done.
    const uncommitted = list('diff', '--name-only', '--no-renames', '-z', 'HEAD').filter(counts);
    const changed = [...new Set([...(base ? list('diff', '--name-only', '--no-renames', '-z', base.commit, 'HEAD').filter(counts) : []), ...uncommitted])];
    const m = mapDiff(repo, cfg, changed, tracked, base ? undefined : 'no receipt before HEAD and no default branch to diff against');
    const needed = [...m.journeys.map((j) => j.name), ...m.features.map((f) => `feature ${f.name}`)];
    // Proof: a valid receipt for HEAD whose runs include every journey and feature the change needs, with nothing uncommitted.
    const verified = verifyReceipt(repo, cfg, 'HEAD');
    const runs = verified.code === PASS ? receipts.get(now.commit)?.runs ?? [] : [];
    const covered = (n) => n.startsWith('feature ') ? runs.some((r) => r.feature === n.slice(8)) : runs.some((r) => r.journey === n || r.command === cfg.journeys[n].command.replaceAll('${RUN_ID}', r.run_id));
    const missing = verified.code === PASS && !uncommitted.length ? needed.filter((n) => !covered(n)) : needed;
    const stale = base && receipts.has(base.commit) ? base.commit : null;
    const proof = verified.code !== PASS ? stale ? `stale: the receipt is for ${stale.slice(0, 12)}, and HEAD is ${now.commit.slice(0, 12)}` : `missing: ${verified.result.reason}`
        : uncommitted.length ? `stale: uncommitted changes (${named(uncommitted)}); proof counts only from a commit`
            : missing.length ? `stale: the receipt for HEAD has no run of ${missing.join(', ')}`
                : 'fresh';
    return { now, base, changed, m, proof, missing };
}
// `done-done affected [<base>]`: the journeys a change needs, and exit 1 until a receipt for HEAD covers them.
function cmdAffected(argv) {
    const { positionals } = parseArgs({ args: argv, allowPositionals: true });
    if (positionals.length > 1)
        throw new UsageError('affected takes at most one base', 'Re-run as: done-done affected [<base>]');
    const repo = repoRoot();
    const cfg = loadConfig(repo);
    const a = affectedOf(repo, cfg, positionals[0]);
    const fresh = a.proof === 'fresh';
    const changed = cap(a.changed);
    const why = (w) => (FULL || w.length <= 3 ? w.join('; ') : `${w.slice(0, 3).join('; ')}; +${w.length - 3} more (--full lists them)`);
    const drive = [
        ...a.m.journeys.filter((j) => a.missing.includes(j.name)).map((j) => `done-done run ${j.name}`),
        ...a.m.features.filter((f) => a.missing.includes(`feature ${f.name}`)).map((f) => `done-done verify --feature ${f.name} --outcome "<what a user can now do>"`),
    ];
    emit({
        command: 'affected',
        result: fresh ? 'fresh' : a.proof.split(':')[0],
        head: a.now.commit,
        base: a.base ? `${a.base.commit.slice(0, 12)} (${a.base.from})` : 'none',
        proof: a.proof,
        changed: changed.items,
        ...(changed.omitted && { changed_omitted: changed.omitted }),
        journeys: a.m.journeys.map((j) => ({ name: j.name, why: why(j.why) })),
        ...(a.m.features.length && { features: a.m.features.map((f) => ({ name: f.name, drive: 'verify --feature', why: why(f.why) })) }),
        ...(a.m.unmapped.length && { unmapped: a.m.unmapped }),
        ...(a.m.fallback && { fallback: `${a.m.fallback}, so the core journey runs too` }),
        help: [
            ...(fresh
                ? [`The receipt for HEAD covers every journey this change needs (${[...a.m.journeys.map((j) => j.name), ...a.m.features.map((f) => f.name)].join(', ') || 'none'})`]
                : [
                    ...(a.proof.startsWith('stale: uncommitted') ? ['Commit the change first: proof counts only from a commit'] : []),
                    ...(drive.length ? [`Capture fresh proof: ${drive.join(' && ')}`] : ['No journey needs a new run: re-run check and receipt for HEAD citing the evidence that still counts']),
                    'Then check it and record the receipt: done-done receipt --from <the PR URL or checks.md>',
                ]),
            // A fresh receipt does not close the gap: the feature map still misses these files.
            ...(a.m.unmapped.length ? [`Flag the gap: ${named(a.m.unmapped)} ${a.m.unmapped.length === 1 ? 'is' : 'are'} in no feature or journey; add ${a.m.unmapped.length === 1 ? 'it' : 'them'} to the feature file that drives ${a.m.unmapped.length === 1 ? 'it' : 'them'} in ${cfg.skill}/features (done-done maintain reports what no feature covers), or record a journey: done-done init --journey <name> -- <command>`] : []),
        ],
    });
    return fresh ? PASS : FAIL;
}
// Claude's opt-in Bash lifecycle hook compares HEAD before/after the exact tool call, not shell command text.
async function cmdAfterCommit(argv) {
    const { values } = parseArgs({ args: argv, options: { before: { type: 'boolean' } } });
    let event;
    try {
        event = JSON.parse(readFileSync(0, 'utf8'));
    }
    catch (e) {
        throw new UsageError(`after-commit needs a Claude hook JSON event: ${e.message}`);
    }
    if (event?.tool_name !== 'Bash')
        return PASS;
    if (typeof event.tool_use_id !== 'string' || !event.tool_use_id || typeof event.session_id !== 'string' || !event.session_id)
        throw new UsageError('after-commit needs session_id and tool_use_id');
    if (event.hook_event_name !== (values.before ? 'PreToolUse' : 'PostToolUse'))
        throw new UsageError('after-commit: hook event does not match --before');
    const repo = repoRoot(), cfg = loadConfig(repo);
    const state = join(home(), 'hooks', `${sha256(Buffer.from(JSON.stringify([repo, event.session_id, event.tool_use_id])))}.json`);
    const current = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: repo, encoding: 'utf8' });
    if (values.before) {
        mkdirSync(dirname(state), { recursive: true });
        writeFileSync(state, JSON.stringify({ commit: current.status === 0 ? current.stdout.trim() : null }));
        return PASS;
    }
    if (!existsSync(state))
        return PASS; // no paired start, or this event was already handled
    const before = JSON.parse(readFileSync(state, 'utf8')).commit;
    rmSync(state);
    if (current.status !== 0)
        return PASS;
    const h = head(repo);
    if (before === h.commit || !/^commit(?:\s|:)/.test(git(repo, 'reflog', '-1', '--format=%gs')))
        return PASS;
    if (h.dirty)
        throw new UsageError('after-commit: tracked changes remain; commit them before capturing proof', 'Run the affected journeys from a clean commit: done-done affected');
    const changed = git(repo, ...(before ? ['diff', '--name-only', '--no-renames', '-z', before, 'HEAD'] : ['diff-tree', '--root', '--no-commit-id', '-r', '--name-only', '-z', 'HEAD'])).split('\0').filter((p) => p && !p.startsWith(`${GATE_DIR}/`) && !cfg.evidence.ignore_paths.some((g) => matchesGlob(p, g)));
    const m = mapDiff(repo, cfg, changed, git(repo, 'ls-files', '-z').split('\0').filter(Boolean));
    let proposal;
    if (m.unmapped.length) {
        proposal = join(cfg.evidence.root, '.done-done', 'proposals', `${h.commit}.md`);
        mkdirSync(dirname(proposal), { recursive: true });
        writeFileSync(proposal, journeyProposal(cfg.skill, h.commit, m.unmapped, m.journeys.map((j) => j.name)));
    }
    emit({ command: 'after-commit', head: h.commit, journeys: m.journeys.map((j) => j.name), features: m.features.map((f) => f.name), ...(proposal && { proposal: citable(repo, proposal) }), help: ['Proposal only: review and apply it yourself; no verify skill file was changed. Runs capture evidence, not a judged pass or receipt.'] });
    let code = PASS;
    for (const j of m.journeys) {
        if (head(repo).commit !== h.commit)
            throw new UsageError('after-commit: HEAD moved before the next journey; stopped');
        const result = await cmdRun([j.name]);
        if (result !== PASS)
            code = result;
    }
    if (m.features.length || (!m.journeys.length && m.fallback)) {
        emit({ command: 'after-commit', result: 'needs-recipe', help: ['No command can drive these features automatically. Record a real journey with done-done init --journey <name> -- <command>, or ask the user to choose an agent and outcome for done-done verify --feature <name>.'] });
        return INCONCLUSIVE;
    }
    return code;
}
// Bare `done-done`: orient a new user or agent with the config state and the next step.
function cmdBare() {
    let repo;
    try {
        repo = repoRoot();
    }
    catch {
        emit({ command: 'done-done', config: 'none', help: ['Run done-done inside a git repository, then `done-done init` to set up proof'] });
        return PASS;
    }
    if (!existsSync(join(repo, '.done-done.yaml'))) {
        emit({ command: 'done-done', config: 'missing', help: ['Run `done-done init` to write a minimal .done-done.yaml'] });
        return PASS;
    }
    const cfg = loadConfig(repo);
    const journeys = Object.keys(cfg.journeys);
    const result = {
        command: 'done-done',
        config: 'present',
        app: cfg.app,
        evidence_root: shown(repo, cfg.evidence.root),
        journeys,
        runs: runsOf(repo, cfg).length,
    };
    const check = '`done-done check --outcome "<what you proved>" <files it recorded>`';
    const receipt = verifyReceipt(repo, cfg, 'HEAD');
    result.receipt = receipt.code === PASS ? `valid for HEAD ${String(receipt.result.head).slice(0, 12)}` : receipt.result.reason ?? receipt.result.result;
    // The journeys this change still needs (done-done affected), so a session hook shows them with no extra call.
    let needs = [];
    try {
        const a = affectedOf(repo, cfg);
        if (a.proof !== 'fresh') {
            needs = a.missing;
            result.affected = { proof: a.proof, needs };
        }
    }
    catch (e) {
        result.affected = `not read: ${(e.stderr || e.message).trim()}`;
    }
    const runs = needs.filter((n) => !n.startsWith('feature ')).map((n) => `done-done run ${n}`);
    result.help = runs.length
        ? [`This change needs fresh proof: ${runs.join(' && ')} (done-done affected says why), then check it with ${check}`]
        : receipt.code === PASS
            ? [`HEAD has a valid receipt for "${receipt.result.claim}"; prove the next commit with done-done verify --outcome "<what a user can now do>"`]
            : journeys.length
                ? [`Capture proof with \`done-done run ${journeys[0]}\`, then check it with ${check}`]
                : [...driveHint(repo, cfg), `Add a journey to .done-done.yaml (${journeyExample}), commit, then \`done-done run smoke\` and ${check}`];
    emit(result);
    return PASS;
}
async function main(argv) {
    const dash = argv.indexOf('--');
    const head = dash < 0 ? argv : argv.slice(0, dash);
    const kept = [];
    for (const a of head) {
        if (a === '--json')
            OUT = 'json';
        else if (a === '--full')
            FULL = true;
        else
            kept.push(a);
    }
    const [cmd, ...rest] = [...kept, ...(dash < 0 ? [] : argv.slice(dash))];
    const sub = Object.hasOwn(COMMANDS, cmd) ? cmd : undefined;
    if (sub && (kept.includes('--help') || kept.includes('-h'))) {
        console.log(commandHelp(sub));
        return PASS;
    }
    try {
        if (process.env.DONE_DONE_DRIVE && DRIVE_REFUSED.includes(cmd))
            throw new UsageError(`${cmd} refuses to run inside an agent drive (DONE_DONE_DRIVE is set), so the agent does not answer its own gate, write a receipt or start a run by accident; this guards against accidents and is not a sandbox`, 'Stop the drive and report what you captured; done-done answers the run and writes the receipt');
        if (cmd === 'init')
            return await cmdInit(rest);
        if (cmd === 'journey')
            return await cmdJourney(rest);
        if (cmd === 'doctor')
            return await cmdDoctor(rest);
        if (cmd === 'run')
            return await cmdRun(rest);
        if (cmd === 'check')
            return await cmdCheck(rest);
        if (cmd === 'receipt')
            return await cmdReceipt(rest);
        if (cmd === 'verify')
            return await cmdVerify(rest);
        if (cmd === 'maintain')
            return await cmdMaintain(rest);
        if (cmd === 'design')
            return await cmdDesign(rest);
        if (cmd === 'look')
            return await cmdLook(rest);
        if (cmd === 'lint')
            return cmdLint(rest);
        if (cmd === 'gate')
            return cmdGate(rest);
        if (cmd === 'affected')
            return cmdAffected(rest);
        if (cmd === 'after-commit')
            return await cmdAfterCommit(rest);
        if (cmd === 'status')
            return cmdStatus(rest);
        if (cmd === 'attach')
            return await cmdAttach(rest);
        if (cmd === 'logs')
            return cmdLogs(rest);
        if (cmd === 'rerun')
            return await cmdRerun(rest);
        if (cmd === 'abort')
            return cmdAbort(rest);
        if (cmd === 'respond')
            return await cmdRespond(rest);
        if (cmd === 'history')
            return cmdHistory(rest);
        if (cmd === 'signoff')
            return await cmdSignoff(rest);
        if (cmd === '__runner') {
            await runSteps(rest[0]);
            return PASS;
        }
        if (cmd === '--version') {
            console.log(VERSION + (PRE_RELEASE ? '\npre-release' : ''));
            return PASS;
        }
        if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
            console.log(USAGE_TEXT);
            return PASS;
        }
        if (cmd === undefined)
            return cmdBare();
        throw new UsageError(`unknown command ${cmd}`);
    }
    catch (e) {
        const msg = String(e.stderr || e.message || e).trim();
        emit({ command: sub ?? 'done-done', error: msg, help: e instanceof UsageError && e.help ? [e.help] : errorHelp(msg, sub) });
        return USAGE;
    }
}
process.exitCode = await main(process.argv.slice(2));
