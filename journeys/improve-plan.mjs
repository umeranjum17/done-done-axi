#!/usr/bin/env node
// Test improvement plan proof (Q13): `tests improve --plan-only` on the improve-test fixture proposes keep for the real test,
// drop for the slop test and the slower duplicate, move for a real test sized local that fits ci, names the untested
// isBig line as a gap, and leaves git status clean. The fixture also tracks a directory symlink to its own parent: the scratch copies
// carry it as a link, so the plan is unchanged. Runs the built CLI.
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from 'node:process';

const { DONE_DONE_EVIDENCE_ROOT: evidence } = env;
if (!evidence) throw new Error('missing DONE_DONE_EVIDENCE_ROOT');

const cli = join(process.cwd(), 'dist/cli.js');
const dir = mkdtempSync(join(tmpdir(), 'improve-'));
const home = mkdtempSync(join(tmpdir(), 'improve-home-'));
let log = '';
try {
  cpSync('test/fixtures/improve-test', dir, { recursive: true });
  mkdirSync(join(dir, 'skills'));
  symlinkSync('..', join(dir, 'skills', 'parent-link'));
  const gitConfig = join(home, 'gitconfig');
  writeFileSync(gitConfig, '');
  const host = Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('GIT_CONFIG')));
  const base = { ...host, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1', DONE_DONE_EVIDENCE_ROOT: undefined, DONE_DONE_RUN_ID: undefined, DONE_DONE_HOME: home };
  const sh = (cmd) => spawnSync('sh', ['-c', cmd], { cwd: dir, encoding: 'utf8', env: base }).stdout;
  sh('git init -q && git add . && git -c user.name=t -c user.email=t@t commit -q -m init');
  assert.equal(sh('git status --porcelain'), '', 'the fixture starts clean');
  const r = spawnSync('node', [cli, 'tests', 'improve', '--plan-only', '--json'], { cwd: dir, encoding: 'utf8', env: base });
  log += `$ done-done tests improve --plan-only --json\nexit ${r.status}\n${r.stdout}\n`;
  const doc = JSON.parse(r.stdout);
  const row = Object.fromEntries(doc.rows.map((x) => [x.test, x]));
  assert.equal(r.status, 0, 'a proposal exits 0');
  assert.equal(doc.stage, 'proposed');
  assert.deepEqual(doc.inventory.sort(), ['local-check', 'real', 'slop', 'slow-duplicate']);
  assert.equal(row.real.action, 'keep');
  assert.equal(row.slop.action, 'drop');
  assert.equal(row['slow-duplicate'].action, 'drop');
  assert.match(row['slow-duplicate'].why, /real/);
  assert.equal(row['local-check'].action, 'move');
  assert.equal(row['local-check'].to, 'ci');
  assert.equal(doc.gaps.length, 1, 'one fault is caught by no test');
  assert.equal(doc.gaps[0].file, 'src/math.mjs');
  assert.equal(doc.gaps[0].line, 3);
  assert.equal(sh('git status --porcelain'), '', 'git status is clean after the plan');
  log += 'git status --porcelain is empty after the plan\n';

  writeFileSync(join(evidence, 'test-improve.log'), log);
  writeFileSync(join(evidence, 'steps.json'), JSON.stringify({
    target: { version: JSON.parse(readFileSync('package.json', 'utf8')).version },
    start: 'improve-test fixture plus a tracked directory symlink to its parent: math.mjs with add, isEven and an untested isBig; tests real, slop, slow-duplicate (ci/ci/local) and local-check (local, but fast)',
    steps: ['Commit the fixture and check git status is clean', 'Run done-done tests improve --plan-only', 'Read each row and the gaps', 'Check git status again'],
    result: 'stage proposed: real keep, slop drop, slow-duplicate drop (duplicate of real), local-check move to ci, gap at src/math.mjs:3, and git status stays clean',
  }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}
