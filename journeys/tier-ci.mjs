#!/usr/bin/env node
// Preserve the tier filtering proof and add isolated synthetic coverage for tests shadow --deadline.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { env } from 'node:process';

const evidence = env.DONE_DONE_EVIDENCE_ROOT;
if (!evidence) throw new Error('missing DONE_DONE_EVIDENCE_ROOT');
const cli = join(process.cwd(), 'dist/cli.js');
const scratch = mkdtempSync(join(tmpdir(), 'tier-ci-'));
const fixture = join(scratch, 'tier-test');
const synthetic = join(scratch, 'shadow-deadline');
const gitConfig = join(scratch, 'gitconfig');
writeFileSync(gitConfig, '');
const host = Object.fromEntries(Object.entries(env).filter(([k]) => !/TOKEN|SECRET|PASSWORD|KEY|CREDENTIAL|AUTH|^DONE_DONE_|^GIT_CONFIG/i.test(k)));
const fixtureEnv = { ...host, DONE_DONE_HOME: join(scratch, 'done-home'), DONE_DONE_EVIDENCE_ROOT: join(scratch, 'fixture-evidence'), DONE_DONE_RUN_ID: '', GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Umer', GIT_AUTHOR_EMAIL: 'umer@example.com', GIT_COMMITTER_NAME: 'Umer', GIT_COMMITTER_EMAIL: 'umer@example.com' };
let output = '';
const record = (desc, cmd, result) => {
  const text = `\n=== ${desc} ===\nCommand: ${cmd.join(' ')}\nExit: ${result.status}\nOutput: ${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  output += text + '\n';
  console.error(text);
};
const run = (desc, cwd, cmd, expectSuccess = true, extraEnv = {}) => {
  const r = spawnSync(cmd[0], cmd.slice(1), { cwd, env: { ...fixtureEnv, GITHUB_ACTIONS: 'true', ...extraEnv }, encoding: 'utf8', shell: false });
  record(desc, cmd, r);
  if (expectSuccess) assert.equal(r.status, 0, `${desc} failed: ${r.stdout}${r.stderr}`);
  else assert.notEqual(r.status, 0, `${desc} should have failed but succeeded`);
  return r;
};
const initRepo = (dir) => {
  for (const args of [['init', '-q', '-b', 'main'], ['add', '-A'], ['commit', '-q', '-m', 'init']]) {
    const r = spawnSync('git', args, { cwd: dir, env: fixtureEnv, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  }
};

try {
  mkdirSync(fixture, { recursive: true });
  cpSync(join(process.cwd(), 'test/fixtures/tier-test/.done-done.yaml'), join(fixture, '.done-done.yaml'));
  const fixtureGit = spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: fixture, env: fixtureEnv, encoding: 'utf8' });
  assert.equal(fixtureGit.status, 0, fixtureGit.stderr);
  for (const args of [['add', '.done-done.yaml'], ['commit', '-q', '-m', 'init']]) {
    const r = spawnSync('git', args, { cwd: fixture, env: fixtureEnv, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  }

  // Existing tier assertions remain intact.
  const r1 = run('CI mode runs tier ci', fixture, ['node', cli, 'run', 'fast-check']);
  assert.ok(r1.stdout.includes('result: recorded'), 'fast-check did not record');
  const r2 = run('CI mode rejects tier integration', fixture, ['node', cli, 'run', 'integration-test'], false);
  assert.ok((r2.stdout + r2.stderr).includes('has tier integration, not ci'), 'wrong error message');
  const r3 = run('Explicit --tier ci', fixture, ['node', cli, 'run', '--tier', 'ci', 'slow-check']);
  assert.ok(r3.stdout.includes('result: recorded'), 'slow-check did not record');

  // Synthetic journeys sleep independently. One child is delayed; its grandchild ignores TERM.
  mkdirSync(synthetic, { recursive: true });
  const journal = join(synthetic, 'shadow.jsonl');
  const delayed = join(synthetic, 'delayed.mjs');
  const resistant = join(synthetic, 'resistant.mjs');
  writeFileSync(delayed, `import { appendFileSync } from 'node:fs';\nconst log = ${JSON.stringify(journal)};\nappendFileSync(log, JSON.stringify({ kind: 'child-start', name: 'delayed', pid: process.pid }) + '\\n');\nawait new Promise(r => setTimeout(r, 1500));\nappendFileSync(log, JSON.stringify({ kind: 'child-finished', name: 'delayed' }) + '\\n');\n`);
  writeFileSync(resistant, `import { spawn } from 'node:child_process';\nimport { appendFileSync } from 'node:fs';\nconst log = ${JSON.stringify(journal)};\nconst child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{}); setInterval(()=>{},1000)'], { stdio: 'ignore' });\nappendFileSync(log, JSON.stringify({ kind: 'grandchild-start', pid: child.pid }) + '\\n');\nprocess.on('SIGTERM', () => {});\nsetTimeout(() => process.exit(0), 3000);\n`);
  writeFileSync(join(synthetic, '.done-done.yaml'), `app: shadow-deadline-fixture\nevidence:\n  root: .proof\njourneys:\n  delayed-child:\n    command: node ${JSON.stringify(delayed)}\n    tier: ci\n    timeout: 5s\n  resistant-child:\n    command: node ${JSON.stringify(resistant)}\n    tier: ci\n    timeout: 5s\n`);
  initRepo(synthetic);

  const timings = [];
  const timed = (label, args, expected = 0) => {
    const start = process.hrtime.bigint();
    const r = spawnSync(process.execPath, [cli, ...args], { cwd: synthetic, env: { ...fixtureEnv, GITHUB_ACTIONS: 'false', DONE_DONE_EVIDENCE_ROOT: '', DONE_DONE_RUN_ID: '', DONE_DONE_SHADOW_TIMING: journal }, encoding: 'utf8', timeout: 8000 });
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    record(label, [process.execPath, cli, ...args], r);
    assert.equal(r.status, expected, `${label}: expected exit ${expected}, got ${r.status}: ${r.stdout}${r.stderr}`);
    timings.push({ label, elapsed_ms: elapsedMs, exit: r.status });
    return r;
  };
  const failed = timed('shared deadline stops synthetic shadow batch', ['tests', 'shadow', '--deadline', '2s', 'delayed-child', 'resistant-child'], 1);
  assert.match(failed.stdout + failed.stderr, /deadline|unfinished|interrupted/i, 'deadline failure is reported');
  assert.ok(existsSync(journal), 'synthetic children created their journal');
  const journalRows = readFileSync(journal, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  assert.ok(journalRows.some((row) => row.kind === 'child-start' && row.name === 'delayed'), 'journal records delayed child start');
  assert.ok(!journalRows.some((row) => row.kind === 'child-finished' && row.name === 'delayed'), 'delayed child was stopped before completing');
  assert.ok(journalRows.some((row) => row.kind === 'grandchild-start'), 'journal records TERM-resistant grandchild');
  const batchExit = journalRows.find((row) => row.kind === 'batch_exit');
  assert.equal(batchExit?.status, 'failed', 'deadline never produces a passing batch');
  assert.deepEqual([...batchExit.unfinished_leaves].sort(), ['delayed-child', 'resistant-child']);
  assert.ok(batchExit.duration_ms < 2000, 'batch ends within its deadline');
  const pids = journalRows.filter((row) => Number.isInteger(row.pid)).map((row) => row.pid);
  for (const pid of pids) {
    const probe = spawnSync('kill', ['-0', String(pid)], { encoding: 'utf8' });
    assert.notEqual(probe.status, 0, `child process ${pid} survived batch cleanup`);
  }

  // A short successful batch and budget validation boundaries.
  writeFileSync(join(synthetic, 'quick.mjs'), `await new Promise(r => setTimeout(r, 10));\nconsole.log('quick child complete');\n`);
  writeFileSync(join(synthetic, '.done-done.yaml'), `app: shadow-deadline-fixture\nevidence:\n  root: .proof\njourneys:\n  quick-one:\n    command: node ${JSON.stringify(join(synthetic, 'quick.mjs'))}\n    tier: ci\n    timeout: 2s\n  quick-two:\n    command: node ${JSON.stringify(join(synthetic, 'quick.mjs'))}\n    tier: ci\n    timeout: 2s\n`);
  timed('baseline short shadow batch without deadline', ['tests', 'shadow', 'quick-one', 'quick-two']);
  const success = timed('successful short shadow batch with deadline', ['tests', 'shadow', '--deadline', '2s', 'quick-one', 'quick-two']);
  assert.match(success.stdout + success.stderr, /quick-one|quick-two|pass|complete/i, 'successful batch reports its child results');
  const invalid = timed('invalid shadow deadline budget', ['tests', 'shadow', '--deadline', 'nonsense', 'quick-one'], 2);
  assert.match(invalid.stdout + invalid.stderr, /deadline|duration|invalid/i, 'invalid budget is rejected');
  const over = timed('shadow deadline over 300 seconds', ['tests', 'shadow', '--deadline', '301s', 'quick-one'], 2);
  assert.match(over.stdout + over.stderr, /300|deadline|duration/i, 'budget above 300 seconds is rejected');

  // The real verify runner starts its instance, readiness probe and suite in separate process groups.
  // Run each beneath the same shadow deadline and check that none of those groups survives it.
  mkdirSync(fixtureEnv.DONE_DONE_HOME, { recursive: true });
  const judge = join(scratch, 'judge');
  writeFileSync(judge, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  writeFileSync(join(fixtureEnv.DONE_DONE_HOME, 'config.yaml'), `review_enabled: false\nagent_path_override: { gemini: ${JSON.stringify(judge)} }\njudge: { route: 'answerer:gemini', model: 'fixture' }\n`);
  const verifyRepos = [];
  for (const kind of ['instance', 'suite']) {
    const repo = join(scratch, `verify-${kind}`), pidsFile = join(repo, 'pids.jsonl');
    mkdirSync(repo, { recursive: true });
    const sleeper = (name) => `const fs = require('node:fs');\nconst { spawn } = require('node:child_process');\nconst child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{}); setInterval(()=>{},1000)'], { stdio: 'ignore' });\nfs.appendFileSync(${JSON.stringify(pidsFile)}, JSON.stringify({ name: ${JSON.stringify(name)}, pid: process.pid, child: child.pid }) + '\\n');\nprocess.on('SIGTERM',()=>{}); setInterval(()=>{},1000);\n`;
    writeFileSync(join(repo, 'instance.cjs'), sleeper('instance'));
    writeFileSync(join(repo, 'ready.cjs'), sleeper('readiness'));
    writeFileSync(join(repo, 'suite.cjs'), sleeper('suite'));
    writeFileSync(join(repo, 'proof.cjs'), `const fs = require('node:fs'), p = require('node:path'), d = process.env.DONE_DONE_EVIDENCE_ROOT;\nfs.writeFileSync(p.join(d,'result.txt'),'fixture succeeded\\n');\nfs.writeFileSync(p.join(d,'steps.json'),JSON.stringify({target:{version:'1'},start:'a fixture',steps:['run the fixture'],result:'fixture succeeded'}));\n`);
    const setup = kind === 'instance' ? 'instance:\n  command: node instance.cjs\n  ready: { command: node ready.cjs }\n  ready_timeout: 10s\n' : 'suite: { command: node suite.cjs, timeout: 10s }\n';
    writeFileSync(join(repo, '.done-done.yaml'), `app: nested-${kind}\nevidence: { root: .proof }\n${setup}journeys:\n  proof: { command: node proof.cjs, timeout: 8s }\n`);
    initRepo(repo);
    verifyRepos.push({ kind, repo, pidsFile });
  }
  for (const { kind, repo, pidsFile } of verifyRepos) {
    const command = `cd ${JSON.stringify(repo)} && ${JSON.stringify(process.execPath)} ${JSON.stringify(cli)} verify proof --outcome 'fixture succeeded' --wait`;
    writeFileSync(join(synthetic, '.done-done.yaml'), `app: shadow-deadline-fixture\njourneys:\n  nested: { command: ${JSON.stringify(command)}, tier: ci }\n`);
    timed(`deadline stops nested verify ${kind}`, ['tests', 'shadow', '--deadline', '3s', 'nested'], 1);
    const started = readFileSync(pidsFile, 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(started.some((row) => row.name === kind), `${kind} really started`);
    if (kind === 'instance') assert.ok(started.some((row) => row.name === 'readiness'), 'readiness really started');
    for (const row of started) for (const pid of [row.pid, row.child]) {
      const probe = spawnSync('kill', ['-0', String(pid)], { encoding: 'utf8' });
      assert.notEqual(probe.status, 0, `${kind} process ${pid} survived`);
    }
    assert.ok(!existsSync(join(repo, '.proof', '.done-done', 'receipts')), 'interrupted verify has no receipt');
  }

  const layerRepo = join(scratch, 'layers'), marker = join(scratch, 'layer-markers'), failNight = join(scratch, 'fail-night');
  mkdirSync(join(layerRepo, 'test'), { recursive: true });
  writeFileSync(join(layerRepo, 'test', 'quick.test.mjs'), `import { test } from 'node:test';\ntest('quick', () => {});\n`);
  writeFileSync(join(layerRepo, 'nightly.cjs'), `const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(marker)},'nightly\\n');if(fs.existsSync(${JSON.stringify(failNight)}))process.exit(1);\n`);
  writeFileSync(join(layerRepo, 'opaque.cjs'), `require('node:fs').appendFileSync(${JSON.stringify(marker)},'opaque\\n');\n`);
  writeFileSync(join(layerRepo, 'live.cjs'), `require('node:fs').appendFileSync(${JSON.stringify(marker)},'live\\n');\n`);
  writeFileSync(join(layerRepo, '.done-done.yaml'), `app: layer-fixture\njourneys:\n  fast-good: { command: 'node --test test/quick.test.mjs', tier: ci, size: ci, core: true }\n  nightly: { command: 'node nightly.cjs', tier: nightly, size: large, reason: 'broad coverage' }\n  opaque: { command: 'node opaque.cjs', tier: manual, size: ci }\n  live-check: { command: 'node live.cjs', tier: live, timeout: 5s }\n`);
  initRepo(layerRepo);
  const layer = (label, args, expected) => {
    const r = spawnSync(process.execPath, [cli, 'verify', ...args], { cwd: layerRepo, env: { ...fixtureEnv, GITHUB_ACTIONS: 'false' }, encoding: 'utf8', timeout: 8000 });
    record(label, [process.execPath, cli, 'verify', ...args], r);
    assert.equal(r.status, expected, `${label}: ${r.stdout}${r.stderr}`);
    return r;
  };
  const nightlyRefusal = layer('fast refuses a named nightly journey', ['--layer', 'fast', '--base', 'HEAD', 'nightly'], 2);
  assert.match(nightlyRefusal.stdout + nightlyRefusal.stderr, /nightly|cannot run in fast/);
  const opaqueRefusal = layer('fast refuses an opaque command', ['--layer', 'fast', '--base', 'HEAD', 'opaque'], 2);
  assert.match(opaqueRefusal.stdout + opaqueRefusal.stderr, /opaque/);
  const fastPlan = join(scratch, 'fast-plan.json');
  layer('fast shadow runs eligible checks', ['--layer', 'fast', '--base', 'HEAD', '--budget', '3s', '--plan', fastPlan], 3);
  const fast = JSON.parse(readFileSync(fastPlan, 'utf8'));
  assert.deepEqual(fast.required, ['fast-good']);
  assert.ok(Date.parse(fast.submitted_at) <= Date.parse(fast.execution_started_at));
  assert.equal(fast.queue_started_at, null);
  assert.equal(fast.checks_complete, true);
  assert.equal(fast.complete, false, 'shadow checks never grant a receipt');
  assert.ok(!existsSync(marker), 'fast did not run nightly or live work');
  layer('resuming fast preserves the original deadline and allowance', ['--layer', 'fast', '--base', 'HEAD', '--budget', '3s', '--plan', fastPlan], 3);
  const resumedFast = JSON.parse(readFileSync(fastPlan, 'utf8'));
  assert.equal(resumedFast.deadline_monotonic_ns, fast.deadline_monotonic_ns);
  assert.deepEqual(resumedFast.model_budget, fast.model_budget);
  resumedFast.deadline_monotonic_ns = (process.hrtime.bigint() - 1n).toString();
  writeFileSync(fastPlan, JSON.stringify(resumedFast));
  layer('an expired plan cannot renew its deadline', ['--layer', 'fast', '--base', 'HEAD', '--budget', '3s', '--plan', fastPlan], 2);
  assert.equal(JSON.parse(readFileSync(fastPlan, 'utf8')).deadline_monotonic_ns, resumedFast.deadline_monotonic_ns);
  layer('fast rejects a budget over the pilot ceiling', ['--layer', 'fast', '--base', 'HEAD', '--budget', '301s'], 2);
  const releasePlan = join(scratch, 'release-plan.json');
  layer('release requires all configured outcomes', ['--layer', 'release', '--base', 'HEAD', '--budget', '4s', '--plan', releasePlan], 3);
  const release = JSON.parse(readFileSync(releasePlan, 'utf8'));
  assert.deepEqual([...release.required].sort(), ['fast-good', 'live-check', 'nightly', 'opaque']);
  assert.equal(release.checks_complete, true);
  assert.equal(release.complete, false);
  assert.equal(release.full_batch_samples, 1);
  assert.ok(release.full_batch_p95_ms > 0);
  assert.match(readFileSync(marker, 'utf8'), /nightly/);
  assert.match(readFileSync(marker, 'utf8'), /live/);
  writeFileSync(failNight, 'fail');
  const nightPlan = join(scratch, 'night-plan.json');
  layer('nightly remains incomplete on one failed outcome', ['--layer', 'nightly', '--base', 'HEAD', '--budget', '4s', '--plan', nightPlan], 1);
  const night = JSON.parse(readFileSync(nightPlan, 'utf8'));
  assert.equal(night.checks_complete, false);
  assert.equal(night.complete, false);
  assert.equal(night.full_batch_samples, 1, 'a finished failed full batch is timed too');
  assert.ok(night.outcomes.some((row) => row.name === 'nightly' && row.status === 'failed'));
  const layerGit = (...args) => {
    const r = spawnSync('git', args, { cwd: layerRepo, env: fixtureEnv, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const beforeTestChange = layerGit('rev-parse', 'HEAD');
  writeFileSync(join(layerRepo, 'test', 'quick.test.mjs'), `import { test } from 'node:test';\ntest('quick changed', () => {});\n`);
  layerGit('add', 'test/quick.test.mjs'); layerGit('commit', '-q', '-m', 'change test');
  layer('fast covers a named changed test', ['--layer', 'fast', '--base', beforeTestChange, '--budget', '3s'], 3);
  const beforeUnknown = layerGit('rev-parse', 'HEAD');
  writeFileSync(join(layerRepo, 'unmapped.txt'), 'unmapped change\n');
  layerGit('add', 'unmapped.txt'); layerGit('commit', '-q', '-m', 'unknown change');
  const unknown = layer('fast refuses an unmapped change', ['--layer', 'fast', '--base', beforeUnknown, '--budget', '3s'], 2);
  assert.match(unknown.stdout + unknown.stderr, /unmapped/);
  const spendRepo = join(scratch, 'layer-spend'), spendMarker = join(scratch, 'spending-live-ran');
  mkdirSync(spendRepo, { recursive: true });
  writeFileSync(join(spendRepo, 'live.cjs'), `require('node:fs').writeFileSync(${JSON.stringify(spendMarker)},'ran');\n`);
  writeFileSync(join(spendRepo, '.done-done.yaml'), `app: layer-spend\njourneys:\n  live-spend: { command: 'node live.cjs', tier: live, timeout: 5s, spends: 'credits' }\n`);
  initRepo(spendRepo);
  const spendRun = spawnSync(process.execPath, [cli, 'verify', '--layer', 'release', '--base', 'HEAD', '--budget', '3s'], { cwd: spendRepo, env: fixtureEnv, encoding: 'utf8', timeout: 8000 });
  assert.equal(spendRun.status, 2, `spending live check must be refused: ${spendRun.stdout}${spendRun.stderr}`);
  assert.ok(!existsSync(spendMarker), 'spending live check did not start');
  const timedRepo = join(scratch, 'layer-timeout'), instanceFixture = verifyRepos.find((row) => row.kind === 'instance');
  mkdirSync(timedRepo, { recursive: true });
  writeFileSync(instanceFixture.pidsFile, '');
  const nestedCommand = `cd ${JSON.stringify(instanceFixture.repo)} && ${JSON.stringify(process.execPath)} ${JSON.stringify(cli)} verify proof --outcome 'fixture succeeded' --wait`;
  writeFileSync(join(timedRepo, '.done-done.yaml'), `app: layer-timeout\njourneys:\n  nested: { command: ${JSON.stringify(nestedCommand)}, tier: nightly, timeout: 10s }\n`);
  initRepo(timedRepo);
  const timeoutPlan = join(scratch, 'timeout-plan.json');
  const layerStart = process.hrtime.bigint();
  const timeoutRun = spawnSync(process.execPath, [cli, 'verify', '--layer', 'release', '--base', 'HEAD', '--budget', '3s', '--plan', timeoutPlan], { cwd: timedRepo, env: { ...fixtureEnv, GITHUB_ACTIONS: 'false' }, encoding: 'utf8', timeout: 8000 });
  const timeoutMs = Number(process.hrtime.bigint() - layerStart) / 1e6;
  record('layer parent stops nested readiness before its deadline', [process.execPath, cli, 'verify', '--layer', 'release', '--base', 'HEAD', '--budget', '3s'], timeoutRun);
  assert.notEqual(timeoutRun.status, 0);
  assert.ok(timeoutMs < 3000, `layer parent exceeded budget: ${timeoutMs}ms`);
  const timedPlan = JSON.parse(readFileSync(timeoutPlan, 'utf8'));
  assert.equal(timedPlan.complete, false);
  assert.ok(timedPlan.unfinished.includes('nested'));
  const timedPids = readFileSync(instanceFixture.pidsFile, 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(timedPids.some((row) => row.name === 'readiness'));
  for (const row of timedPids) for (const pid of [row.pid, row.child]) assert.notEqual(spawnSync('kill', ['-0', String(pid)]).status, 0, `layer process ${pid} survived`);
  const slowBin = join(scratch, 'slow-bin'), slowPid = join(scratch, 'slow-git.pid');
  mkdirSync(slowBin, { recursive: true });
  writeFileSync(join(slowBin, 'git'), `#!/bin/sh\nprintf '%s\\n' "$$" > ${JSON.stringify(slowPid)}\nsleep 5\n`, { mode: 0o755 });
  const setupStart = process.hrtime.bigint();
  const slowSetup = spawnSync(process.execPath, [cli, 'verify', '--layer', 'fast', '--base', 'HEAD', '--budget', '2s'], { cwd: layerRepo, env: { ...fixtureEnv, PATH: `${slowBin}:${fixtureEnv.PATH}`, GITHUB_ACTIONS: 'false' }, encoding: 'utf8', timeout: 5000 });
  const setupMs = Number(process.hrtime.bigint() - setupStart) / 1e6;
  assert.notEqual(slowSetup.status, 0, 'stalled setup is incomplete');
  assert.ok(setupMs < 2000, `stalled setup exceeded the parent deadline: ${setupMs}ms`);
  assert.ok(existsSync(slowPid), 'the fake git setup actually started');
  assert.notEqual(spawnSync('kill', ['-0', readFileSync(slowPid, 'utf8').trim()]).status, 0, 'stalled setup process is gone');
  output += `Stalled git setup was stopped by its parent in ${Math.round(setupMs)}ms.\n`;
  const aggregateRepo = join(scratch, 'aggregate'), aggregatePids = join(scratch, 'aggregate-pids.jsonl');
  mkdirSync(join(aggregateRepo, 'test'), { recursive: true });
  for (const name of ['a', 'b']) writeFileSync(join(aggregateRepo, 'test', `${name}.test.mjs`), `import {test} from 'node:test';import {appendFileSync} from 'node:fs';test('${name}',async()=>{appendFileSync(${JSON.stringify(aggregatePids)},JSON.stringify({pid:process.pid})+'\\n');await new Promise(r=>setTimeout(r,4000));});\n`);
  writeFileSync(join(aggregateRepo, '.done-done.yaml'), `app: aggregate\njourneys:\n  a: { command: 'node --test test/a.test.mjs', tier: ci, size: ci }\n  b: { command: 'node --test test/b.test.mjs', tier: ci, size: ci }\n`);
  initRepo(aggregateRepo);
  const aggregatePlan = join(scratch, 'aggregate-plan.json');
  const aggregateStart = process.hrtime.bigint();
  const aggregate = spawnSync(process.execPath, [cli, 'verify', '--layer', 'fast', '--base', 'HEAD', '--budget', '3s', '--plan', aggregatePlan], { cwd: aggregateRepo, env: fixtureEnv, encoding: 'utf8', timeout: 8000 });
  const aggregateMs = Number(process.hrtime.bigint() - aggregateStart) / 1e6;
  assert.notEqual(aggregate.status, 0);
  assert.ok(aggregateMs < 3000, `aggregate exceeded the parent budget: ${aggregateMs}ms`);
  const aggregateState = JSON.parse(readFileSync(aggregatePlan, 'utf8'));
  assert.equal(aggregateState.complete, false);
  assert.deepEqual([...aggregateState.unfinished].sort(), ['a', 'b']);
  const aggregateChildren = readFileSync(aggregatePids, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(aggregateChildren.length, 2);
  for (const row of aggregateChildren) assert.notEqual(spawnSync('kill', ['-0', String(row.pid)]).status, 0, `aggregate child ${row.pid} survived`);
  output += `Two individually legal children remained unfinished under one aggregate deadline (${Math.round(aggregateMs)}ms).\n`;
  output += '\nLayer shadow: fast refused nightly and opaque work; release ran every configured outcome; nightly stayed incomplete on failure.\n';

  // Exercise the actual OpenAI judge boundary with a synthetic fetch transport. It records endpoint names only.
  const providerRepo = join(scratch, 'provider'), events = join(scratch, 'provider-events.jsonl');
  mkdirSync(providerRepo, { recursive: true });
  writeFileSync(join(providerRepo, 'proof.cjs'), `const fs=require('node:fs'),p=require('node:path'),d=process.env.DONE_DONE_EVIDENCE_ROOT;fs.writeFileSync(p.join(d,'result.txt'),'fixture succeeded\\n');fs.writeFileSync(p.join(d,'steps.json'),JSON.stringify({target:{version:'1'},start:'a fixture',steps:['run the fixture'],result:'fixture succeeded'}));\n`);
  writeFileSync(join(providerRepo, '.done-done.yaml'), `app: provider-fixture\nevidence: { root: .proof }\nsuite: { command: 'true' }\njourneys:\n  proof: { command: node proof.cjs, timeout: 8s }\n`);
  initRepo(providerRepo);
  writeFileSync(join(fixtureEnv.DONE_DONE_HOME, 'config.yaml'), `review_enabled: false\njudge: { route: 'openai:key', model: 'fixture-model' }\n`);
  const loader = join(scratch, 'provider-loader.mjs');
  writeFileSync(loader, `import { appendFileSync } from 'node:fs';\nglobalThis.fetch = async (url, init) => {\n const endpoint = new URL(String(url)).pathname;\n const body = JSON.parse(init.body);\n appendFileSync(process.env.FIXTURE_EVENTS, JSON.stringify({endpoint, output_limit: body.max_output_tokens ?? null}) + '\\n');\n if (endpoint.endsWith('/input_tokens')) return new Response(JSON.stringify({input_tokens:100}), {status:200});\n if (process.env.FIXTURE_HOLD === '1') await new Promise(r => setTimeout(r,30000));\n const keys = Object.keys(body.text.format.schema.properties);\n const answers = Object.fromEntries(keys.map(k => [k,{pick:'correct',probabilities:{correct:0.99,wrong:0.005,unclear:0.005},rationale:'The text shows the result.',personReason:'The text shows the result.'}]));\n return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(answers)}]}]}), {status:200});\n};\n`);
  const newPlan = (name) => {
    const path = join(scratch, name);
    writeFileSync(path, JSON.stringify({ boot_id: readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(), deadline_monotonic_ns: (process.hrtime.bigint() + 30_000_000_000n).toString(), model_budget: { limit: 5300, slots: { cheap: null, large: null }, attempts: [] } }));
    return path;
  };
  const plan = newPlan('plan.json');
  const providerEnv = { ...fixtureEnv, DONE_DONE_LAYER_PLAN: plan, OPENAI_API_KEY: 'fixture-only', FIXTURE_EVENTS: events, FIXTURE_HOLD: '1', NODE_OPTIONS: `--import=${loader}` };
  const args = [cli, 'verify', 'proof', '--outcome', 'fixture succeeded', '--foreground'];
  const first = spawn(process.execPath, args, { cwd: providerRepo, env: providerEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let providerOutput = '';
  for (const stream of [first.stdout, first.stderr]) stream.on('data', (b) => { providerOutput = (providerOutput + b).slice(-8000); });
  const exited = new Promise((resolve) => first.once('close', resolve));
  try {
    const until = Date.now() + 8000;
    while ((!existsSync(events) || !readFileSync(events, 'utf8').includes('"endpoint":"/v1/responses"')) && Date.now() < until && first.exitCode === null) await new Promise(r => setTimeout(r, 20));
    assert.ok(existsSync(events) && readFileSync(events, 'utf8').includes('"endpoint":"/v1/responses"'), `first bounded provider request started: ${providerOutput}`);
    const concurrent = spawnSync(process.execPath, args, { cwd: providerRepo, env: providerEnv, encoding: 'utf8', timeout: 8000 });
    assert.notEqual(concurrent.status, 0, 'concurrent provider attempt is refused');
    first.kill('SIGKILL');
    await exited;
    const restarted = spawnSync(process.execPath, args, { cwd: providerRepo, env: providerEnv, encoding: 'utf8', timeout: 8000 });
    assert.notEqual(restarted.status, 0, 'interrupted provider attempt cannot renew its reservation');
    const calls = readFileSync(events, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(calls.map((c) => c.endpoint), ['/v1/responses/input_tokens', '/v1/responses']);
    assert.equal(calls[1].output_limit, 300, 'provider output is capped');
    const budget = JSON.parse(readFileSync(plan, 'utf8')).model_budget;
    assert.equal(budget.attempts.length, 1);
    assert.equal(budget.attempts[0].reserved, 3300);
    assert.equal(budget.attempts[0].input_tokens, null);
    assert.equal(budget.attempts[0].output_tokens, null);
    assert.equal(budget.slots.cheap, null, 'unused final slot is preserved');
    output += '\nProvider reservation: one count and one capped dispatch; concurrent and restarted attempts refused; unknown usage retains 3300.\n';
  } finally {
    if (first.exitCode === null && first.signalCode === null) first.kill('SIGKILL');
    await exited;
  }
  const completedPlan = newPlan('completed-plan.json'), completedEvents = join(scratch, 'completed-events.jsonl');
  const completed = spawnSync(process.execPath, [cli, 'verify', 'proof', '--outcome', 'fixture succeeded once', '--foreground'], { cwd: providerRepo, env: { ...providerEnv, DONE_DONE_LAYER_PLAN: completedPlan, FIXTURE_EVENTS: completedEvents, FIXTURE_HOLD: '0' }, encoding: 'utf8', timeout: 8000 });
  assert.notEqual(completed.status, 0, 'a shadow layer cannot issue an individual receipt');
  assert.match(completed.stdout + completed.stderr, /shadow layer outcomes cannot issue a receipt/);
  assert.ok(!existsSync(join(providerRepo, '.proof', '.done-done', 'receipts')), 'passing nested proof cannot publish a partial receipt');
  const completedBudget = JSON.parse(readFileSync(completedPlan, 'utf8')).model_budget;
  assert.equal(completedBudget.attempts.length, 1);
  assert.equal(completedBudget.attempts[0].reserved, 3300);
  assert.equal(completedBudget.attempts[0].input_tokens, null);
  assert.equal(completedBudget.attempts[0].output_tokens, null);
  const expiredPlan = newPlan('expired-plan.json'), expiredEvents = join(scratch, 'expired-events.jsonl');
  const expiredState = JSON.parse(readFileSync(expiredPlan, 'utf8'));
  expiredState.deadline_monotonic_ns = (process.hrtime.bigint() - 1n).toString();
  writeFileSync(expiredPlan, JSON.stringify(expiredState));
  const expired = spawnSync(process.execPath, [cli, 'verify', 'proof', '--outcome', 'fixture deadline expired', '--foreground'], { cwd: providerRepo, env: { ...providerEnv, DONE_DONE_LAYER_PLAN: expiredPlan, FIXTURE_EVENTS: expiredEvents, FIXTURE_HOLD: '0' }, encoding: 'utf8', timeout: 8000 });
  assert.notEqual(expired.status, 0, 'expired deadline refuses a provider call');
  assert.ok(!existsSync(expiredEvents), 'deadline decision made zero provider calls');
  const unboundedPlan = newPlan('unbounded-plan.json'), agentMarker = join(scratch, 'unbounded-agent-ran');
  writeFileSync(judge, `#!/bin/sh\nprintf ran > ${JSON.stringify(agentMarker)}\nexit 0\n`, { mode: 0o755 });
  writeFileSync(join(fixtureEnv.DONE_DONE_HOME, 'config.yaml'), `review_enabled: false\nagent_path_override: { gemini: ${JSON.stringify(judge)} }\njudge: { route: 'answerer:gemini', model: 'fixture' }\n`);
  const unbounded = spawnSync(process.execPath, [cli, 'verify', 'proof', '--outcome', 'fixture unsupported route', '--foreground'], { cwd: providerRepo, env: { ...fixtureEnv, DONE_DONE_LAYER_PLAN: unboundedPlan }, encoding: 'utf8', timeout: 8000 });
  assert.notEqual(unbounded.status, 0, 'an unbounded CLI provider is refused');
  assert.ok(!existsSync(agentMarker), 'unbounded provider was never started');
  const protectedBudget = JSON.parse(readFileSync(unboundedPlan, 'utf8')).model_budget;
  assert.deepEqual(protectedBudget.slots, { cheap: null, large: null });
  assert.equal(protectedBudget.attempts.length, 0);
  output += 'A completed request with missing usage keeps its full reservation; an expired deadline makes zero provider calls.\n';

  output += `\nScenario timings (ms; baseline and deadline use the same quick journeys): ${JSON.stringify(timings)}\nReal-project full-batch P95: unmeasured, sample count: 0; synthetic fixture samples are reported in their layer plans.\n✓ Existing tier assertions passed\n✓ Shadow deadline batch, cleanup, success and budget checks passed\n✓ No model or network calls made\n`;
  mkdirSync(evidence, { recursive: true });
  writeFileSync(join(evidence, 'tier-ci.log'), output);
  writeFileSync(join(evidence, 'steps.json'), JSON.stringify({
    target: { version: JSON.parse(readFileSync('package.json', 'utf8')).version },
    start: 'a copied tier-test fixture and isolated synthetic shadow CLI repository',
    steps: [
      'Initialize the copied tier-test fixture as a git repo',
      'Run fast-check in CI mode (GITHUB_ACTIONS=true) and verify it records',
      'Attempt integration-test in CI mode and verify the integration tier is rejected',
      'Run slow-check with --tier ci and verify it records',
      'Create temporary synthetic delayed and TERM-resistant child journeys and run tests shadow --deadline with a short shared budget',
      'Inspect the actual journal for started and unfinished work and check recorded child processes are gone',
      'Run a successful short shadow batch, then try invalid and over-300-second budgets',
      'Run nested verify with a hanging instance and readiness probe, then with a hanging suite, and check all their recorded processes are gone',
      'Exercise a bounded synthetic provider request, concurrent and restarted attempts, missing usage, and an expired deadline',
      'Drive fast, release and nightly shadow layers through refusal, complete coverage and an incomplete failure',
      'Stop two individually legal fast tests at one aggregate deadline and confirm their processes are gone',
    ],
    result: 'CI tier filtering retains its prior behavior; synthetic shadow batches stop at a shared deadline with unfinished work journaled and children cleaned up, including detached instance, readiness and suite groups; provider reservations survive interruption and missing usage',
  }, null, 2) + '\n');
  console.error('\n✓ All tier CI and shadow deadline checks passed');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
