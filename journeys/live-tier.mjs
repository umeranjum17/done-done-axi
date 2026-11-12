#!/usr/bin/env node
// Live tier proof (Q18): `done-done run --tier live` runs only the entries marked tier live, each bounded by its own timeout, with no
// agent or judge, and prints one row for each (name, green or red, seconds). A red entry exits 1 but is a result row. Entries not
// marked live are not run, and no verify, affected or run-as-proof path can pick a live entry. Runs the built CLI on the live-test fixture.
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from 'node:process';

const { DONE_DONE_EVIDENCE_ROOT: evidence } = env;
if (!evidence) throw new Error('missing DONE_DONE_EVIDENCE_ROOT');

const cli = join(process.cwd(), 'dist/cli.js');
const dir = mkdtempSync(join(tmpdir(), 'live-'));
const home = mkdtempSync(join(tmpdir(), 'live-home-'));
let log = '';
try {
  cpSync('test/fixtures/live-test', dir, { recursive: true });
  const gitConfig = join(home, 'gitconfig');
  writeFileSync(gitConfig, '');
  const host = Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('GIT_CONFIG')));
  // A throwaway done-done home with no agent and no judge set: a live run that tried to start either would stop.
  const base = { ...host, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1', DONE_DONE_EVIDENCE_ROOT: undefined, DONE_DONE_RUN_ID: undefined, DONE_DONE_HOME: home };
  const git = (...args) => spawnSync('git', ['-c', 'user.name=Umer', '-c', 'user.email=umer@example.com', ...args], { cwd: dir, env: base });
  git('init', '-q');
  git('add', '.');
  git('commit', '-qm', 'init');
  const dd = (...args) => {
    const started = Date.now();
    const r = spawnSync('node', [cli, ...args], { cwd: dir, encoding: 'utf8', env: base });
    const ms = Date.now() - started;
    log += `$ done-done ${args.join(' ')}\nexit ${r.status} in ${ms}ms\n${r.stdout}${r.stderr}\n`;
    return { ...r, ms };
  };

  // One red and one green live entry (and one that outlives its timeout): one row for each, inside the bound.
  const all = dd('run', '--tier', 'live', '--json');
  const doc = JSON.parse(all.stdout);
  assert.equal(all.status, 1, 'a red live entry exits non-zero');
  assert.equal(doc.result, 'red');
  assert.deepEqual(doc.rows.map((r) => [r.name, r.result]), [['home-answers', 'green'], ['lock-fresh', 'red'], ['load-ok', 'red']], 'one row for each live entry, in config order');
  assert.ok(doc.rows.every((r) => typeof r.seconds === 'number'), 'each row says its seconds');
  assert.match(doc.rows[1].reason, /^exit 3: the lock is older than its lease$/, 'a red row names its real cause');
  assert.match(doc.rows[2].reason, /^timed out after 1s/, 'an entry past its timeout is stopped and red');
  assert.equal(doc.bound_seconds, 21, 'the bound is the sum of the entry timeouts');
  assert.ok(all.ms < doc.bound_seconds * 1000, `the run ends inside its bound (${all.ms}ms)`);
  assert.ok(all.ms < 10_000, 'the sleeping entry was stopped at its own timeout, not run to its end');

  // Entries not marked live are not run; nothing is recorded as a run, so no evidence folder and no agent.
  assert.equal(existsSync(join(dir, 'proof-ran')), false, 'a tier local journey is not run');
  assert.equal(existsSync(join(dir, 'untiered-ran')), false, 'an untiered journey is not run');
  assert.equal(existsSync(join(home, 'evidence')), false, 'a live run records no evidence');

  // One live entry by name; the table form is what the fleet tick reads.
  const one = dd('run', '--tier', 'live', 'home-answers');
  assert.equal(one.status, 0, 'a green live run exits 0');
  assert.match(one.stdout, /^result: green$/m);
  assert.match(one.stdout, /^rows\[1\]\{name,result,seconds,reason\}:\n {2}home-answers,green,/m);
  assert.equal(dd('run', '--tier', 'live', 'proof').status, 2, 'a journey of another tier is refused as a live check');

  // A live entry is never proof: run, verify and affected never see it.
  const asProof = dd('run', 'lock-fresh');
  assert.equal(asProof.status, 2);
  assert.match(asProof.stdout, /is a live check \(tier live\), not proof: nothing ran/);
  assert.equal(dd('verify', 'lock-fresh', '--outcome', 'a live check proves a change').status, 2, 'verify refuses a live entry by name');
  writeFileSync(join(dir, 'probes', 'lock.sh'), 'echo "the lock is fresh"\n');
  git('commit', '-qam', 'change the live probe');
  const affected = dd('affected', 'HEAD~1', '--json');
  assert.ok(!/lock-fresh|home-answers|load-ok/.test(affected.stdout), 'a change to a live probe selects none of the live entries for proof');
  assert.deepEqual(JSON.parse(affected.stdout).journeys.map((j) => j.name), ['proof'], 'an uncovered file runs the local tier only');

  writeFileSync(join(evidence, 'live-tier.log'), log);
  writeFileSync(join(evidence, 'steps.json'), JSON.stringify({
    target: { version: JSON.parse(readFileSync('package.json', 'utf8')).version },
    start: 'live-test fixture: a green, a red and an over-timeout live entry, plus a tier local and an untiered journey',
    steps: ['Run done-done run --tier live', 'Check the rows, the bound and that the other journeys did not run', 'Run one live entry by name', 'Try a live entry through run and verify', 'Change a live probe and ask which journeys the change affects'],
    result: 'one row for each live entry (green, red with its cause, red stopped at its 1s timeout) inside the 21s bound and in about a second, a red entry exited 1, journeys not marked live did not run, and run, verify and affected never took a live entry as proof',
  }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}
