#!/usr/bin/env node
// Drive the real layer CLI on isolated fixtures; no hosted models or network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const evidence = process.env.DONE_DONE_EVIDENCE_ROOT;
if (!evidence) throw new Error('missing DONE_DONE_EVIDENCE_ROOT');
const cli = join(process.cwd(), 'dist/cli.js');
const scratch = mkdtempSync(join(tmpdir(), 'flaky-proof-'));
const log = [], clockFile = join(scratch, 'clock'), clock = join(scratch, 'clock.mjs');
const t0 = Date.parse('2026-11-22T00:00:00.000Z');
writeFileSync(clockFile, String(t0));
writeFileSync(clock, `import { mock } from 'node:test'; import { readFileSync } from 'node:fs'; mock.timers.enable({ apis: ['Date'], now: Number(readFileSync(process.env.FLAKE_CLOCK, 'utf8')) });\n`);
const fixtureScript = `import { readFileSync, writeFileSync } from 'node:fs'; import { join } from 'node:path';
const mode = readFileSync(process.env.FLAKE_MODE_FILE, 'utf8').trim();
let n = 0; try { n = Number(readFileSync(process.env.FLAKE_COUNTER, 'utf8')); } catch {}
writeFileSync(process.env.FLAKE_COUNTER, String(++n));
if (mode === 'slow') await new Promise(r => setTimeout(r, 2500));
if (mode === 'missing') process.exit(127);
const skipped = mode === 'skip', failed = mode === 'red' || (mode === 'flip' && n % 2 === 1);
if (process.env.DONE_DONE_JUNIT_REPORT) writeFileSync(process.env.DONE_DONE_JUNIT_REPORT, '<testsuites><testsuite><testcase id="leaf" name="total" classname="checkout" file="journeys/probe.test.mjs">' + (skipped ? '<skipped/>' : failed ? '<failure message="expected total 42"/>' : '') + '</testcase></testsuite></testsuites>');
if (!failed && !skipped && process.env.DONE_DONE_EVIDENCE_ROOT) {
 writeFileSync(join(process.env.DONE_DONE_EVIDENCE_ROOT, 'total.txt'), 'Total: 42\\n');
 writeFileSync(join(process.env.DONE_DONE_EVIDENCE_ROOT, 'steps.json'), JSON.stringify({target:{version:'1'},start:'checkout',steps:['read total'],result:'Total: 42'}));
}
process.exit(skipped ? 77 : failed ? 1 : 0);`;
const fixtures = [];
function fixture(name, critical = false) {
  const root = join(scratch, name), repo = join(root, 'repo'), ddHome = join(root, 'home'), proof = join(root, 'proof');
  for (const p of [repo, ddHome, proof, join(repo, 'journeys')]) mkdirSync(p, { recursive: true });
  const mode = join(root, 'mode'), counter = join(root, 'counter');
  writeFileSync(mode, 'flip'); writeFileSync(counter, '0');
  writeFileSync(join(repo, '.done-done.yaml'), `app: sample\nevidence: {root: ${JSON.stringify(proof)}}\ninputs: [journeys/probe.test.mjs]\njourneys:\n  flaky-check:\n    command: node --test journeys/probe.test.mjs\n    tier: ci\n    size: ci\n    timeout: 1s\n    intent: checkout\n    critical: ${critical}\n  product-proof:\n    command: node journeys/product.mjs\n    tier: nightly\n    size: local\n`);
  writeFileSync(join(repo, 'journeys/probe.test.mjs'), fixtureScript);
  writeFileSync(join(repo, 'journeys/product.mjs'), `import { writeFileSync } from 'node:fs'; import { join } from 'node:path'; const d = process.env.DONE_DONE_EVIDENCE_ROOT; writeFileSync(join(d, 'product.txt'), 'Checkout total: 42\\n'); writeFileSync(join(d, 'steps.json'), JSON.stringify({target:{version:'1'},start:'checkout',steps:['read the total'],result:'Checkout total: 42'}));\n`);
  const host = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DONE_DONE_') && !k.startsWith('GIT_CONFIG') && k !== 'JG_TOOL_MODELS' && k !== 'NODE_OPTIONS'));
  const env = { ...host, HOME: root, DONE_DONE_HOME: ddHome, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Umer', GIT_AUTHOR_EMAIL: 'umer@example.com', GIT_COMMITTER_NAME: 'Umer', GIT_COMMITTER_EMAIL: 'umer@example.com', JG_TOOL_MODELS: join(root, 'no-models.json'), FLAKE_MODE_FILE: mode, FLAKE_COUNTER: counter, FLAKE_CLOCK: clockFile, NODE_OPTIONS: `--import=${clock}` };
  const git = (...args) => { const r = spawnSync('git', args, { cwd: repo, env, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'fixture');
  const f = { root, repo, ddHome, proof, mode, counter, env, git }; fixtures.push(f); return f;
}
function layer(f, label, extra = {}, plan) {
  const args = [cli, 'verify', '--layer', 'fast', '--base', 'HEAD', '--budget', '10s', 'flaky-check', '--json'];
  if (plan) args.push('--plan', plan);
  const start = performance.now();
  const r = spawnSync(process.execPath, args, { cwd: f.repo, env: { ...f.env, ...extra }, encoding: 'utf8', timeout: 20000 });
  const elapsed = Math.round(performance.now() - start);
  let doc; try { doc = JSON.parse(r.stdout); } catch { throw new Error(`${label}: ${r.error?.message ?? ''}\n${r.stdout}\n${r.stderr}`); }
  log.push({ label, exit: r.status, elapsed_ms: elapsed, result: doc.result, error: doc.error, reason: doc.reason, flakes: doc.flakes, stderr: r.stderr });
  return { status: r.status, doc };
}
const reset = (f, mode = 'flip') => { writeFileSync(f.mode, mode); writeFileSync(f.counter, '0'); };
const records = (f, sub) => { const p = join(f.proof, '.done-done', 'flakes', sub); return existsSync(p) ? readdirSync(p).filter(n => n.endsWith('.json')).map(n => JSON.parse(readFileSync(join(p, n), 'utf8'))) : []; };
const states = (r) => r.doc.flakes?.map(x => x.state) ?? [];
try {
  // Preserve the original product journey and its warning assertion.
  const legacy = join(scratch, 'legacy'); cpSync('test/fixtures/flaky-test', legacy, { recursive: true });
  const legacyEnv = { ...process.env, HOME: scratch, DONE_DONE_HOME: join(scratch, 'legacy-home'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  delete legacyEnv.DONE_DONE_EVIDENCE_ROOT; delete legacyEnv.DONE_DONE_RUN_ID; delete legacyEnv.JG_TOOL_MODELS;
  for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=Umer', '-c', 'user.email=umer@example.com', 'commit', '-qm', 'fixture']]) assert.equal(spawnSync('git', args, { cwd: legacy, env: legacyEnv }).status, 0);
  const originalStart = performance.now();
  const original = spawnSync(process.execPath, [cli, 'run', 'flaky-check', '--json'], { cwd: legacy, env: legacyEnv, encoding: 'utf8' });
  assert.equal(original.status, 0); assert.deepEqual(JSON.parse(original.stdout).flaky, ['flaky-check']); assert.equal(original.stderr.split('\n').filter(x => x.startsWith('warning:')).length, 1);
  log.push({ label: 'legacy run', exit: original.status, elapsed_ms: Math.round(performance.now() - originalStart), result: JSON.parse(original.stdout).result, warnings: 1 });

  const f = fixture('normal');
  reset(f, 'red'); const red = layer(f, 'red/red'); assert.equal(red.status, 1); assert.deepEqual(states(red), []); assert.equal(records(f, 'tickets').length, 0);
  reset(f); const plan = join(f.root, 'replay.json');
  const first = layer(f, 'first reversal', {}, plan); assert.equal(first.status, 1); assert.deepEqual(states(first), ['suspected']);
  reset(f); const replay = layer(f, 'replay same episode', {}, plan); assert.equal(replay.status, 1); assert.deepEqual(states(replay), ['suspected']); assert.equal(readFileSync(f.counter, 'utf8'), '0', 'replay does not execute the check again');
  assert.equal(records(f, 'episodes').length, 2, 'red episode and one reversal despite replay');
  reset(f); const second = layer(f, 'second reversal shadow'); assert.equal(second.status, 1); assert.deepEqual(states(second), ['would-mute']);
  assert.equal(records(f, 'tickets').length, 1);
  const reversals = records(f, 'episodes').filter(e => e.attempts.length === 2 && e.attempts[1].code === 0);
  assert.equal(reversals.length, 2); assert.equal(reversals.reduce((n, e) => n + e.attempts.length, 0), 4);
  reset(f); const enforced = layer(f, 'confirmed mute', { DONE_DONE_FLAKE_ENFORCE: '1' }); assert.equal(enforced.status, 3); assert.deepEqual(states(enforced), ['muted']); assert.equal(readFileSync(f.counter, 'utf8'), '2');
  reset(f, 'red'); const stillRed = layer(f, 'confirmed red/red remains red', { DONE_DONE_FLAKE_ENFORCE: '1' }); assert.equal(stillRed.status, 1);
  reset(f); const changed = layer(f, 'changed environment', { FLAKE_EXTRA: 'changed', DONE_DONE_FLAKE_ENFORCE: '1' }); assert.equal(changed.status, 1); assert.deepEqual(states(changed), ['suspected']);
  for (const mode of ['skip', 'missing', 'slow']) { reset(f, mode); const r = layer(f, mode); assert.equal(r.status, 1); assert.deepEqual(states(r), []); }
  assert.equal(records(f, 'tickets').length, 1);
  const critical = fixture('critical', true);
  reset(critical); assert.deepEqual(states(layer(critical, 'critical suspicion', { DONE_DONE_FLAKE_ENFORCE: '1' })), ['suspected']);
  reset(critical); const required = layer(critical, 'sole critical remains required', { DONE_DONE_FLAKE_ENFORCE: '1' }); assert.equal(required.status, 1); assert.deepEqual(states(required), ['required']);
  writeFileSync(clockFile, String(t0 + 15 * 86400000)); reset(f);
  const expired = layer(f, 'expired mute escalates', { DONE_DONE_FLAKE_ENFORCE: '1' }); assert.equal(expired.status, 1); assert.deepEqual(states(expired), ['expired']);
  assert.equal(records(f, 'tickets').length, 1);
  // A synthetic pre-existing receipt uses a local stub judge only during setup. The three
  // recovery classifications must not call it (or any hosted model) themselves.
  writeFileSync(clockFile, String(t0));
  const repair = fixture('repair');
  reset(repair); assert.deepEqual(states(layer(repair, 'repair suspicion')), ['suspected']);
  reset(repair); assert.deepEqual(states(layer(repair, 'repair ticket')), ['would-mute']);
  const judge = join(repair.root, 'judge'), judgeCalls = join(repair.root, 'judge-calls');
  const verdict = { probabilities: { correct: 0.95, wrong: 0.03, unclear: 0.02 }, rationale: 'The capture shows the total.', personReason: 'The total is shown.', parts: [], covers: [] };
  writeFileSync(judge, `#!${process.execPath}\nconst fs = require('node:fs'); fs.appendFileSync(${JSON.stringify(judgeCalls)}, 'call\\n'); const s = fs.readFileSync(0, 'utf8'); const keys = [...new Set([...s.matchAll(/capture_\\d+/g)].map(m => m[0]))]; const v = ${JSON.stringify(verdict)}; process.stdout.write(JSON.stringify({response: JSON.stringify(keys.length ? Object.fromEntries(keys.map(k => [k,v])) : {relevance:v})}));\n`, { mode: 0o755 });
  writeFileSync(join(repair.ddHome, 'config.yaml'), `agent_path_override: {gemini: ${JSON.stringify(judge)}}\njudge: {route: 'answerer:gemini', model: stub}\n`);
  writeFileSync(join(repair.repo, 'journeys/probe.test.mjs'), fixtureScript + '\n// repaired fixture\n');
  repair.git('add', '.'); repair.git('commit', '-qm', 'verified repair'); reset(repair, 'pass');
  const dd = (...args) => { const r = spawnSync(process.execPath, [cli, ...args, '--json'], { cwd: repair.repo, env: repair.env, encoding: 'utf8', timeout: 20000 }); if (r.status !== 0) throw new Error(`receipt setup ${args.join(' ')}: ${r.stdout}\n${r.stderr}`); return JSON.parse(r.stdout); };
  const testRun = dd('run', 'flaky-check'), productRun = dd('run', 'product-proof');
  const testCapture = testRun.evidence.find(p => p.endsWith('total.txt')), productCapture = productRun.evidence.find(p => p.endsWith('product.txt'));
  assert.ok(testCapture && productCapture, 'both real CLI captures exist');
  dd('receipt', '--outcome', 'Total: 42 is printed', testCapture, productCapture);
  dd('receipt', '--verify', 'HEAD');
  const callsBefore = readFileSync(judgeCalls, 'utf8');
  for (let i = 0; i < 3; i++) {
    reset(repair, 'pass'); writeFileSync(clockFile, String(t0 + (i + 1) * 3600000));
    const recovered = layer(repair, `repair clean repetition ${i + 1}`);
    assert.equal(recovered.status, 3);
    assert.deepEqual(states(recovered), i === 2 ? ['restored'] : []);
  }
  assert.equal(readFileSync(judgeCalls, 'utf8'), callsBefore, 'quarantine and restoration make zero judge calls');
  assert.equal(readdirSync(join(repair.proof, '.done-done', 'flakes')).filter(n => n.startsWith('restored-')).length, 1);
  writeFileSync(join(evidence, 'flaky-quarantine.log'), JSON.stringify({ assertions: log, judge_calls_for_classification: 0 }, null, 2) + '\n');
  writeFileSync(join(evidence, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync('package.json', 'utf8')).version }, start: 'isolated synthetic repositories with a reported checkout leaf', steps: ['run the existing flaky journey', 'run repeated layer checks and replay', 'enable enforcement and test refusals, critical coverage and expiry', 'verify a repaired head and run three clean repetitions'], result: 'comparable reversals produce one repair ticket; shadow keeps the check blocking, enforcement mutes the eligible reversal and a verified repair restores it' }, null, 2));
} catch (e) { console.error(JSON.stringify(log, null, 2)); throw e; }
finally { rmSync(scratch, { recursive: true, force: true }); }
