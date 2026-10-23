// Real Git commits + the installed Claude Bash lifecycle commands; no agent, judge or credentials.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const CLI = resolve(process.env.DONE_DONE_TEST_CLI || 'dist/cli.js');
const OUT = process.env.DONE_DONE_EVIDENCE_ROOT;
if (!OUT) throw new Error('run via done-done run after-commit');
const tmp = mkdtempSync(join(tmpdir(), 'dd-after-commit-'));
let transcript = '';
try {
  const repo = join(tmp, 'repo'), bin = join(tmp, 'bin'), home = join(tmp, 'home'), evidence = join(tmp, 'evidence');
  for (const p of [repo, bin, home]) mkdirSync(p);
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: home, XDG_DATA_HOME: home, XDG_CACHE_HOME: home, TMPDIR: tmp, DONE_DONE_HOME: join(tmp, 'dd'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', PATH: `${bin}:${process.env.PATH}` };
  writeFileSync(join(bin, 'done-done'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(CLI)} "$@"\n`, { mode: 0o755 });
  const git = (...args) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' }).trim();
  const dd = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8' });
  git('init', '-qb', 'main'); git('config', 'user.name', 'Umer'); git('config', 'user.email', 'umer@example.test');
  const skill = '.agents/skills/done-done-verify-demo';
  mkdirSync(join(repo, skill, 'features'), { recursive: true });
  writeFileSync(join(repo, skill, 'SKILL.md'), '# Demo verification\n');
  writeFileSync(join(repo, skill, 'features/README.md'), '- [Greeting](greeting.md)\n');
  writeFileSync(join(repo, skill, 'features/greeting.md'), '# Greeting\nSource: app.mjs\nDrive: done-done run greeting\n');
  writeFileSync(join(repo, '.done-done.yaml'), `app: demo\nevidence:\n  root: ${JSON.stringify(evidence)}\njourneys:\n  core:\n    command: node drive.mjs core\n    core: true\n  greeting:\n    command: node drive.mjs greeting\n  unrelated:\n    command: node other.mjs\n`);
  writeFileSync(join(repo, 'app.mjs'), 'console.log("Hello Umer");\n');
  writeFileSync(join(repo, 'other.mjs'), 'throw new Error("unrelated journey must not run");\n');
  writeFileSync(join(repo, 'drive.mjs'), `import { execFileSync } from 'node:child_process'; import { writeFileSync } from 'node:fs'; import { join } from 'node:path';
const output = execFileSync(process.execPath, ['app.mjs'], { encoding: 'utf8' });
writeFileSync(join(process.env.DONE_DONE_EVIDENCE_ROOT, 'greeting.txt'), output);
writeFileSync(join(process.env.DONE_DONE_EVIDENCE_ROOT, 'steps.json'), JSON.stringify({ target: { version: 'fixture' }, start: 'Umer opens the greeting CLI', steps: ['node app.mjs'], result: output }));\n`);
  assert.equal(dd('init', '--hook', 'claude').status, 2, 'no agent is chosen');
  const settings = () => JSON.parse(readFileSync(join(repo, '.claude/settings.json'), 'utf8'));
  const session = settings().hooks.SessionStart;
  assert.deepEqual(Object.keys(settings().hooks), ['SessionStart'], 'plain --hook behaviour unchanged');
  assert.equal(dd('init', '--hook', 'claude', '--after-commit').status, 2);
  const installed = readFileSync(join(repo, '.claude/settings.json'), 'utf8');
  assert.equal(dd('init', '--hook', 'claude', '--after-commit').status, 2);
  assert.equal(readFileSync(join(repo, '.claude/settings.json'), 'utf8'), installed, 'idempotent');
  assert.deepEqual(settings().hooks.SessionStart, session);
  git('add', '.'); git('commit', '-qm', 'fixture');
  let id = 0;
  const hook = (event, toolId) => {
    const [{ matcher, hooks: [{ command }] }] = settings().hooks[event];
    assert.equal(matcher, 'Bash');
    const r = spawnSync('sh', ['-c', command], { cwd: repo, env, encoding: 'utf8', input: JSON.stringify({ session_id: 'fixture', tool_use_id: toolId, tool_name: 'Bash', hook_event_name: event }) });
    transcript += `$ ${event} ${toolId}\n${r.stdout}${r.stderr}exit ${r.status}\n`;
    assert.equal(r.status, 0, r.stdout + r.stderr);
  };
  const records = () => { try { return readdirSync(join(evidence, '.done-done/runs')).map((p) => JSON.parse(readFileSync(join(evidence, '.done-done/runs', p), 'utf8'))); } catch (e) { if (e.code === 'ENOENT') return []; throw e; } };
  const commit = (file, content) => {
    const toolId = `tool-${++id}`;
    hook('PreToolUse', toolId); writeFileSync(join(repo, file), content); git('add', file); git('commit', '-qm', file); hook('PostToolUse', toolId);
    hook('PostToolUse', toolId); // duplicate delivery must not rerun
    return git('rev-parse', 'HEAD');
  };
  const mapped = commit('app.mjs', 'console.log("Hello Umer, again");\n');
  assert.deepEqual(records().map((r) => r.journey), ['greeting']);
  const uncovered = commit('billing.mjs', 'console.log("New billing surface");\n');
  assert.deepEqual(records().map((r) => r.journey).sort(), ['core', 'greeting']);
  for (const r of records()) {
    assert.equal(r.commit, r.journey === 'core' ? uncovered : mapped); assert.equal(r.dirty, false); assert.equal(r.exit, 0); assert.ok(r.ended_at);
    assert.equal(readFileSync(join(evidence, r.files.find((f) => f.path.endsWith('greeting.txt')).path), 'utf8'), 'Hello Umer, again\n');
  }
  const proposal = readFileSync(join(evidence, '.done-done/proposals', `${uncovered}.md`), 'utf8');
  assert.match(proposal, /billing\.mjs/); assert.match(proposal, /Proposal only/); assert.match(proposal, /features\/README\.md/);
  assert.equal(git('status', '--porcelain'), '', 'proposal never edits the skill or checkout');
  hook('PreToolUse', 'no-commit'); hook('PostToolUse', 'no-commit');
  hook('PreToolUse', 'checkout'); git('checkout', '-q', mapped); hook('PostToolUse', 'checkout');
  assert.equal(records().length, 2, 'no commit and checkout do not run journeys');
  transcript += `PASS mapped commit ${mapped}: greeting sealed; uncovered commit ${uncovered}: core sealed and proposal only\n${proposal}`;
  mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, 'after-commit.log'), transcript);
  writeFileSync(join(OUT, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version }, start: 'isolated fixture Git repo; no agent or judge configured', steps: ['install SessionStart only; opt in to after-commit hooks', 'commit a greeting source change between the installed Bash hooks', 'commit an uncovered billing surface between those hooks', 'inspect sealed evidence records and proposal; replay duplicate, no-commit and checkout controls'], result: 'mapped commit reruns greeting; uncovered commit runs core and proposes a verify skill entry without editing it; each run is sealed at the correct clean commit' }));
  console.log('PASS after-commit: two real commits, two sealed runs, proposal-only gap and negative controls');
} finally { rmSync(tmp, { recursive: true, force: true }); }
