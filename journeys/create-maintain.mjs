// create-maintain journey: the docs/example-create-maintain.md walkthrough, driven for real with the built CLI on the Pocket
// Notes sample: init has a hosted coding agent write the verify skill, a source change makes it drift, maintain finds the
// drift, fixes the skill with auto_fix and ends clean, then a browser journey is run, checked by the judge and receipted.
// Runs from the done-done repo root with DONE_DONE_EVIDENCE_ROOT and DONE_DONE_RUN_ID set by `done-done run create-maintain`.
// The agent is DONE_DONE_JOURNEY_AGENT / DONE_DONE_JOURNEY_MODEL (default opencode with a free MiniMax model); the judge is
// claude-code at haiku. Needs those CLIs signed in, network for `npm install`, and Chrome or Chromium. Exits nonzero on the first failure.
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = process.cwd();
const CLI = process.env.DONE_DONE_TEST_CLI || join(REPO, 'dist', 'cli.js');
const OUT = process.env.DONE_DONE_EVIDENCE_ROOT;
const RUN_ID = process.env.DONE_DONE_RUN_ID;
if (!OUT || !RUN_ID) {
  console.error('create-maintain: run via `done-done run create-maintain`');
  process.exit(2);
}
const AGENT = process.env.DONE_DONE_JOURNEY_AGENT || 'opencode';
const MODEL = process.env.DONE_DONE_JOURNEY_MODEL || 'openrouter/minimax/minimax-m3.1-flash:free';

const log = [];
const say = (s) => { log.push(s); console.error(s); };
const tmp = mkdtempSync(join(tmpdir(), 'dd-create-maintain-'));
const repo = join(tmp, 'pocket-notes');
const env = {
  ...process.env,
  DONE_DONE_HOME: join(tmp, 'home'),
  GIT_AUTHOR_NAME: 'sample', GIT_AUTHOR_EMAIL: 'sample@example.com',
  GIT_COMMITTER_NAME: 'sample', GIT_COMMITTER_EMAIL: 'sample@example.com',
};
for (const k of ['DONE_DONE_EVIDENCE_ROOT', 'DONE_DONE_RUN_ID']) delete env[k];

const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: repo, env, encoding: 'utf8', ...opts });
const git = (...a) => { const r = sh('git', a); assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`); return r.stdout; };
// One done-done call, as JSON; its exit code must be one of `codes`.
const dd = (codes, ...args) => {
  const r = sh('node', [CLI, ...args, '--json'], { maxBuffer: 64 << 20 });
  say(`$ done-done ${args.join(' ')}   (exit ${r.status})`);
  assert.ok(codes.includes(r.status), `done-done ${args.join(' ')} exited ${r.status}: ${r.stdout}${r.stderr}`.slice(0, 1500));
  return JSON.parse(r.stdout);
};
const findings = (m) => (m.findings ?? []).forEach((f) => say(`  ${f.kind}: ${f.what}`.slice(0, 300)));

try {
  // 1 the sample, a plain git repo with no done-done in it
  cpSync(join(REPO, 'docs', 'examples', 'pocket-notes'), repo, { recursive: true });
  git('init', '-q', '-b', 'main');
  const npm = sh('npm', ['install', '--no-audit', '--no-fund']);
  assert.equal(npm.status, 0, `npm install: ${npm.stderr}`);
  git('add', '-A');
  git('commit', '-qm', 'Pocket Notes');

  // 2 init: the agent writes the verify skill from the repo's own files
  const init = dd([0], 'init', '--agent', AGENT, '--model', MODEL, '--judge', 'claude', '--judge-model', 'claude-haiku-5-5');
  say(`init: ${init.result}; verify_skill: ${init.verify_skill}`);
  assert.match(String(init.verify_skill), /^written/, 'init wrote no verify skill');
  git('add', '-A');
  git('commit', '-qm', 'Add done-done and its verify skill');

  // 3 a source change the skill does not know about
  sh('sed', ['-i', 's#/health#/healthz#', 'server.mjs']);
  sh('sed', ['-i', 's#Write a note#Type a note#; s#>Add note<#>Save note<#', 'public/index.html']);
  git('commit', '-qam', 'Rename Add to Save, health to /healthz');
  say('source change: button Add note -> Save note, placeholder Write a note -> Type a note, health route /health -> /healthz');

  // 4 maintain: drift, then the fix on a branch, then clean
  const drift = dd([1], 'maintain', '--foreground');
  say(`maintain: ${drift.result} (${drift.reason})`);
  findings(drift);
  assert.equal(drift.result, 'drift');
  assert.ok((drift.findings ?? []).some((f) => f.kind === 'drift'), 'maintain reported no drift finding');
  writeFileSync(join(repo, '.done-done.yaml'), `${readFileSync(join(repo, '.done-done.yaml'), 'utf8')}auto_fix:\n  maintain: 2\n`);
  git('commit', '-qam', 'Allow maintain two fix attempts');
  // A hosted model can leave a fix unsure (the judge then asks the user, exit 3): each try is logged, three at most.
  let fixed;
  for (let k = 1; k <= 3; k++) {
    fixed = dd([0, 3], 'maintain', '--foreground');
    say(`maintain with auto_fix, try ${k}: ${fixed.result} (${fixed.reason})${fixed.fix ? `; fix branch ${fixed.fix.branch}, files ${fixed.fix.files?.join(', ')}` : ''}`);
    findings(fixed);
    if (fixed.result === 'changed') break;
  }
  assert.equal(fixed.result, 'changed');
  git('merge', '-q', '--ff-only', fixed.fix.branch);
  const clean = dd([0], 'maintain', '--foreground');
  say(`maintain after merging the fix: ${clean.result}`);
  assert.equal(clean.result, 'clean');

  // 5 a real journey in a browser, judged
  writeFileSync(join(repo, '.done-done.yaml'), `${readFileSync(join(repo, '.done-done.yaml'), 'utf8')}instance:
  command: PORT=$DONE_DONE_PORT NOTES_DATA=$TMPDIR node server.mjs
  ready: { url: http://127.0.0.1:$DONE_DONE_PORT/healthz }
journeys:
  add-note:
    command: node scripts/prove-core.mjs
    core: true
`);
  git('commit', '-qam', 'Add the core journey');
  const ran = dd([0], 'run', 'add-note');
  say(`run add-note: ${ran.result}; ${ran.evidence}`);
  const shot = [].concat(ran.evidence).find((p) => String(p).endsWith('note-listed.png'));
  assert.ok(shot, 'the journey saved no screenshot');
  const claim = 'a user can type a note, press Save note, and see it in the list';
  const checked = dd([0], 'check', '--outcome', claim, shot);
  say(`check: ${checked.result}; judge ${checked.judge?.route} ${checked.judge?.model}: ${checked.judge?.judged?.[0]?.reason}`);
  assert.equal(checked.result, 'pass');
  const receipt = dd([0], 'receipt', '--outcome', claim, shot);
  say(`receipt: ${receipt.result}`);
  assert.equal(receipt.result, 'pass');

  mkdirSync(OUT, { recursive: true });
  const transcript = log.join('\n') + '\n';
  writeFileSync(join(OUT, `${RUN_ID}.log`), transcript);
  writeFileSync(join(OUT, `${RUN_ID}.real-product.log`), transcript);
  // The step record: what a user does with the built CLI and what ends up true.
  writeFileSync(join(OUT, 'steps.json'), JSON.stringify({
    target: { version: JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version },
    start: 'a fresh clone of the Pocket Notes sample app with no done-done config, verify skill, run or evidence',
    steps: [
      'init has the coding agent write the verify skill',
      'change the app source: rename the button, the placeholder and the health route',
      'maintain reports the verify skill drift',
      'maintain with auto_fix fixes the skill on a branch and the fix is merged',
      'maintain ends clean',
      'run the add-note journey in a real browser',
      'check passes the screenshot and receipt records it',
    ],
    result: 'the verify skill was created, its drift after a source change was found and fixed, maintain ends clean, and the judge passes the screenshot of the real add-note journey',
  }));
} catch (err) {
  try {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `${RUN_ID}.log`), [...log, `FAIL: ${err.message}`].join('\n') + '\n');
  } catch { /* keep the original error */ }
  console.error(`create-maintain FAIL: ${err.message}`);
  process.exit(1);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
