#!/usr/bin/env node
// Test size proof (Q11): an over-bound ci journey is stopped as slow, a large journey with no reason fails lint, a large
// journey is night-only, and `tests measure` reports five timings per test. Runs the built CLI on the size-test fixture.
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from 'node:process';

const { DONE_DONE_EVIDENCE_ROOT: evidence } = env;
if (!evidence) throw new Error('missing DONE_DONE_EVIDENCE_ROOT');

const cli = join(process.cwd(), 'dist/cli.js');
const dir = mkdtempSync(join(tmpdir(), 'size-'));
const home = mkdtempSync(join(tmpdir(), 'size-home-'));
let log = '';
try {
  cpSync('test/fixtures/size-test', dir, { recursive: true });
  const gitConfig = join(home, 'gitconfig');
  writeFileSync(gitConfig, '');
  const host = Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('GIT_CONFIG')));
  const base = { ...host, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1', DONE_DONE_EVIDENCE_ROOT: undefined, DONE_DONE_RUN_ID: undefined, DONE_DONE_HOME: home };
  spawnSync('sh', ['-c', 'git init -q && git add . && git -c user.name=t -c user.email=t@t commit -q -m init'], { cwd: dir, env: base });
  const dd = (...args) => {
    const r = spawnSync('node', [cli, ...args], { cwd: dir, encoding: 'utf8', env: base });
    log += `$ done-done ${args.join(' ')}\nexit ${r.status}\n${r.stdout}${r.stderr.split('\n').filter((l) => l.includes('error')).join('\n')}\n\n`;
    return r;
  };

  const slow = dd('run', 'over-bound', '--json');
  const slowDoc = JSON.parse(slow.stdout);
  assert.equal(slow.status, 1, 'an over-bound journey fails the run');
  assert.equal(slowDoc.slow, true);
  assert.match(slowDoc.reason, /is slow: it ran past its ci bound of 15s and was stopped/);

  writeFileSync(join(dir, 'report.md'), '## Checks\noutcome: sizes are enforced\nrepro: n/a: no bug\nproof: no verify skill - done-done lint\nevidence: not proven: fixture\n');
  mkdirSync(join(dir, 'ev'));
  const lintBad = dd('lint', 'report.md', 'ev');
  assert.equal(lintBad.status, 1);
  assert.match(lintBad.stdout, /FAIL: test sizes: journey large-no-reason is large and has no reason/);

  assert.equal(dd('run', 'large-no-reason').status, 2, 'a large journey is refused without --night');

  const measure = dd('tests', 'measure', 'quick', '--json');
  const m = JSON.parse(measure.stdout);
  assert.equal(measure.status, 0);
  assert.equal(m.measured.length, 1);
  assert.equal(m.measured[0].runs.length, 5, 'five results for the test');
  assert.ok(m.measured[0].runs.every((r) => r.result === 'ok'));

  copyFileSync(join(dir, 'large-ok.yaml'), join(dir, '.done-done.yaml'));
  assert.match(dd('lint', 'report.md', 'ev').stdout, /^PASS/, 'a large journey with a reason passes lint');

  writeFileSync(join(evidence, 'size-bounds.log'), log);
  writeFileSync(join(evidence, 'steps.json'), JSON.stringify({
    target: { version: JSON.parse(readFileSync('package.json', 'utf8')).version },
    start: 'size-test fixture: a ci journey that sleeps 60s, a large journey with no reason, a quick ci journey',
    steps: ['Run the over-bound ci journey', 'Lint a repo whose large journey has no reason', 'Run the large journey without --night', 'Measure the quick journey', 'Lint again once the large journey has a reason'],
    result: 'the over-bound journey was stopped as slow at 15s, lint failed the reasonless large journey by name, the large journey was refused without --night, measure reported five timings, and lint passed once the reason was added',
  }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}
