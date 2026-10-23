// Real hosted-agent proof: a never-released public npm bin gets a verify skill, maintain reads it,
// and affected maps a source change. No npm publication, registry lookup, judge or browser is needed.
// Run with `done-done run init-first-release`; the user's installed agent keeps its normal sign-in.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.cwd();
const CLI = process.env.DONE_DONE_TEST_CLI || join(ROOT, 'dist', 'cli.js');
const OUT = process.env.DONE_DONE_EVIDENCE_ROOT;
if (!OUT || !process.env.DONE_DONE_RUN_ID) throw new Error('run via done-done run init-first-release');
const tmp = mkdtempSync(join(tmpdir(), 'dd-first-release-'));
const repo = join(tmp, 'hello-umer');
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_CONFIG') && !['DONE_DONE_RUN_ID', 'DONE_DONE_EVIDENCE_ROOT'].includes(k)));
Object.assign(env, {
  DONE_DONE_HOME: join(tmp, 'done-done'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'sample', GIT_AUTHOR_EMAIL: 'sample@example.com',
  GIT_COMMITTER_NAME: 'sample', GIT_COMMITTER_EMAIL: 'sample@example.com',
});
const log = [];
const say = (s) => { log.push(s); console.error(s); };
const git = (...args) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' }).trim();
const dd = (code, ...args) => {
  const r = spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd: repo, env, encoding: 'utf8', maxBuffer: 32 << 20 });
  say(`$ done-done ${args.join(' ')}\n${r.stdout}${r.stderr}\nexit: ${r.status}`);
  assert.equal(r.status, code, r.error?.message || r.stdout + r.stderr);
  return JSON.parse(r.stdout);
};

try {
  mkdirSync(join(repo, 'bin'), { recursive: true });
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'hello-umer', version: '0.1.0', bin: { 'hello-umer': 'bin/cli.js' } }));
  const source = '#!/usr/bin/env node\n// No earlier release yet: this package has never been published.\n// Safe proof: node bin/cli.js prints a greeting; no files, accounts or network are used.\nconsole.log("Hello Umer");\n';
  writeFileSync(join(repo, 'bin', 'cli.js'), source, { mode: 0o755 });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'First-release CLI');
  say(`candidate HEAD: ${execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()}`);
  const init = dd(0, 'init', '--agent', process.env.DONE_DONE_JOURNEY_AGENT || 'claude', '--model', process.env.DONE_DONE_JOURNEY_MODEL || 'claude-haiku-5-5');
  assert.match(init.verify_skill, /^written by /);
  const skill = join(repo, '.agents', 'skills', 'done-done-verify-hello-umer');
  const body = readFileSync(join(skill, 'SKILL.md'), 'utf8');
  say(`generated SKILL.md:\n${body}`);
  assert.match(body, /Upgrade journey pending: no earlier release yet/);
  assert.doesNotMatch(readFileSync(join(skill, 'features', 'README.md'), 'utf8'), /\(upgrade journey\)/);
  git('add', '-A');
  git('commit', '-qm', 'Add verification skill');
  const base = git('rev-parse', 'HEAD');
  const maintained = dd(0, 'maintain', '--foreground');
  assert.equal(maintained.result, 'clean');
  writeFileSync(join(repo, 'bin', 'cli.js'), source.replace('Hello Umer', 'Welcome Umer'));
  git('commit', '-qam', 'Change greeting');
  const affected = dd(1, 'affected', base);
  assert.deepEqual(affected.changed, ['bin/cli.js']);
  assert.ok(affected.features?.length, 'no affected feature from the generated map');
  assert.equal(affected.unmapped, undefined);
  assert.equal(affected.fallback, undefined);
  const r = spawnSync(process.execPath, ['bin/cli.js'], { cwd: repo, env, encoding: 'utf8' });
  say(`$ node bin/cli.js\n${r.stdout}${r.stderr}\nexit: ${r.status}`);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'Welcome Umer\n');
  say('PASS: init wrote the skill with upgrade pending; maintain clean; affected maps the bin and requests fresh feature proof.');
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'steps.json'), JSON.stringify({
    target: { version: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version },
    start: 'a fresh never-released public npm bin package, no done-done config or verify skill',
    steps: ['init writes the verify skill with a hosted agent', 'maintain reads the generated skill and ends clean', 'change the bin source and run affected', 'run the changed bin'],
    result: 'init writes the skill with upgrade pending, maintain is clean, affected maps the changed bin to its feature and asks for fresh proof; the bin prints Welcome Umer',
  }));
} catch (err) {
  say(`FAIL: ${err.message}`);
  process.exitCode = 1;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'init-first-release.log'), log.join('\n') + '\n');
  rmSync(tmp, { recursive: true, force: true });
}
