#!/usr/bin/env node
// Test value proof (Q12): `tests value` plants faults in scratch copies and marks each test. On the value-test fixture one
// test is real, one catches nothing (slop) and one catches what the faster real test catches (duplicate), and the work copy
// is byte-for-byte unchanged afterwards. Runs the built CLI.
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from 'node:process';

const { DONE_DONE_EVIDENCE_ROOT: evidence } = env;
if (!evidence) throw new Error('missing DONE_DONE_EVIDENCE_ROOT');

const cli = join(process.cwd(), 'dist/cli.js');
const dir = mkdtempSync(join(tmpdir(), 'value-'));
const home = mkdtempSync(join(tmpdir(), 'value-home-'));
let log = '';
try {
  cpSync('test/fixtures/value-test', dir, { recursive: true });
  const gitConfig = join(home, 'gitconfig');
  writeFileSync(gitConfig, '');
  const host = Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('GIT_CONFIG')));
  const base = { ...host, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1', DONE_DONE_EVIDENCE_ROOT: undefined, DONE_DONE_RUN_ID: undefined, DONE_DONE_HOME: home };
  const sh = (cmd) => spawnSync('sh', ['-c', cmd], { cwd: dir, encoding: 'utf8', env: base }).stdout;
  sh('git init -q && git add . && git -c user.name=t -c user.email=t@t commit -q -m init');
  // every file's bytes, so "unchanged" means the sources and the tests are the same after the run
  const snapshot = () => sh('git ls-files -co --exclude-standard | sort | xargs sha256sum') + sh('git status --porcelain');
  const before = snapshot();
  const r = spawnSync('node', [cli, 'tests', 'value', '--json'], { cwd: dir, encoding: 'utf8', env: base });
  log += `$ done-done tests value --json\nexit ${r.status}\n${r.stdout}\n`;
  const doc = JSON.parse(r.stdout);
  const verdict = Object.fromEntries(doc.tests.map((t) => [t.test, t]));
  assert.equal(r.status, 1, 'slop and a duplicate fail the command');
  assert.equal(doc.faults.length, 2, 'the fixture source offers two faults');
  assert.equal(verdict.real.verdict, 'real');
  assert.equal(verdict.real.caught, 2);
  assert.equal(verdict.slop.verdict, 'slop');
  assert.equal(verdict.slop.caught, 0);
  assert.equal(verdict['slow-duplicate'].verdict, 'duplicate');
  assert.equal(verdict['slow-duplicate'].duplicate_of, 'real');
  assert.ok(verdict['slow-duplicate'].seconds > verdict.real.seconds, 'the duplicate is the slower one');
  assert.equal(snapshot(), before, 'the work copy is unchanged');
  log += `work copy unchanged: ${before.split('\n').length} lines of file hashes and git status match before and after\n`;

  writeFileSync(join(evidence, 'test-value.log'), log);
  writeFileSync(join(evidence, 'steps.json'), JSON.stringify({
    target: { version: JSON.parse(readFileSync('package.json', 'utf8')).version },
    start: 'value-test fixture: a source file with two plantable faults and three tests: real, slop (asserts nothing), slow-duplicate (the real assertions after a 1.5s wait)',
    steps: ['Snapshot the work copy', 'Run done-done tests value', 'Read each test verdict', 'Snapshot the work copy again'],
    result: 'real caught both faults and stayed real, slop caught none and was marked slop, slow-duplicate caught the same faults slower and was marked duplicate of real, and the work copy is unchanged',
  }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}
