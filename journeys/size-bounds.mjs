#!/usr/bin/env node
// Test size proof (Q11): an over-bound ci journey is stopped as slow, a large journey with no reason fails lint, a large
// journey is night-only, and `tests measure` reports five timings per test. Runs the built CLI on the size-test fixture.
// Also: `tests shadow` runs five isolated synthetic journeys together (journal and retained outputs), an isolated child
// batch is interrupted, and one synthetic journey is checked through a local stub judge (one failed attempt, a cache hit with
// no new call, missing usage as null) and a local synthetic direct API route whose fetch is stubbed (no network). Nothing
// here reaches an external service or spends.
import { spawn, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from 'node:process';
import { pathToFileURL } from 'node:url';

const { DONE_DONE_EVIDENCE_ROOT: evidence } = env;
if (!evidence) throw new Error('missing DONE_DONE_EVIDENCE_ROOT');

const cli = join(process.cwd(), 'dist/cli.js');
const dir = mkdtempSync(join(tmpdir(), 'size-'));
const home = mkdtempSync(join(tmpdir(), 'size-home-'));
const shadowDir = mkdtempSync(join(tmpdir(), 'size-shadow-'));
const shadowHome = mkdtempSync(join(tmpdir(), 'size-shadow-home-'));
const shadowOut = mkdtempSync(join(tmpdir(), 'size-shadow-out-'));
const directHome = mkdtempSync(join(tmpdir(), 'size-direct-home-'));
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

  // Shadow batch: five isolated synthetic journeys in their own throwaway repo, with a stub judge (no model, no network).
  const names = ['s1', 's2', 's3', 's4', 's5'];
  const verdict = { probabilities: { correct: 0.95, wrong: 0.03, unclear: 0.02 }, rationale: 'The text shows the outcome.', personReason: 'The text shows the outcome.', parts: [], covers: [] };
  const synth = [
    "import { existsSync, writeFileSync } from 'node:fs';",
    'const name = process.argv[2];',
    'const out = process.env.DONE_DONE_EVIDENCE_ROOT;',
    "if (name === 's3' && !existsSync(process.env.SYNTH_MARK)) { writeFileSync(process.env.SYNTH_MARK, '1'); process.exit(1); }",
    "writeFileSync(out + '/' + name + '.txt', name + ' ok for Umer\\n');",
    "writeFileSync(out + '/steps.json', JSON.stringify({ target: { version: '1.0.0' }, start: 'a synthetic repo with no app', steps: ['run ' + name], result: name + ' ok for Umer' }));",
    "if (name === 's4') process.exit(1);",
    '',
  ].join('\n');
  const judgeBin = join(shadowHome, 'judge-gemini');
  writeFileSync(judgeBin, [
    `#!${process.execPath}`,
    "const fs = require('node:fs');",
    "const input = fs.readFileSync(0, 'utf8');",
    "const failed = !fs.existsSync(process.env.SYNTH_FAIL_MARK);",
    "if (failed) fs.writeFileSync(process.env.SYNTH_FAIL_MARK, '1');",
    "fs.appendFileSync(process.env.SYNTH_CALLS, (failed ? 'fail' : 'ok') + '\\n');",
    "if (failed) { console.error('provider failed once'); process.exit(1); }",
    "const keys = [...new Set([...input.matchAll(/capture_\\d+/g)].map((m) => m[0]))];",
    `const v = ${JSON.stringify(verdict)};`,
    "process.stdout.write(JSON.stringify({ response: JSON.stringify(keys.length ? Object.fromEntries(keys.map((k) => [k, v])) : { relevance: v }) }));",
    '',
  ].join('\n'), { mode: 0o755 });
  writeFileSync(join(shadowHome, 'config.yaml'), `judge:\n  route: answerer:gemini\n  model: stub-judge\nagent_path_override: { gemini: ${JSON.stringify(judgeBin)} }\n`);
  writeFileSync(join(shadowDir, '.gitignore'), '.proof/\n');
  writeFileSync(join(shadowDir, 'synth.mjs'), synth);
  writeFileSync(join(shadowDir, 'hold.mjs'), 'setTimeout(() => {}, 4000);\n');
  writeFileSync(join(shadowDir, '.done-done.yaml'), `app: shadow\nevidence:\n  root: .proof\njourneys:\n${names.map((n) => `  ${n}:\n    command: node synth.mjs ${n}\n`).join('')}  hold:\n    command: node hold.mjs\n`);
  const journal = join(shadowHome, 'shadow.jsonl');
  const shadowEnv = {
    ...base,
    DONE_DONE_HOME: shadowHome,
    DONE_DONE_SHADOW_TIMING: journal,
    DONE_DONE_SHADOW_EVIDENCE: shadowOut,
    SYNTH_MARK: join(shadowHome, 's3-attempted'),
    SYNTH_FAIL_MARK: join(shadowHome, 'judge-failed-once'),
    SYNTH_CALLS: join(shadowHome, 'judge-calls'),
    SYNTH_KEY: 'synthetic-credential-47',
  };
  const sg = (...a) => { const r = spawnSync('git', a, { cwd: shadowDir, env: shadowEnv, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
  sg('init', '-q', '-b', 'main');
  sg('add', '-A');
  sg('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  const sdd = (...args) => {
    const r = spawnSync(process.execPath, [cli, ...args], { cwd: shadowDir, env: shadowEnv, encoding: 'utf8' });
    log += `$ done-done ${args.join(' ')}\nexit ${r.status}\n${r.stdout}${r.stderr.split('\n').filter((l) => l.includes('error')).join('\n')}\n\n`;
    return r;
  };
  const readRows = (file) => readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

  const batch = sdd('tests', 'shadow', ...names, '--json');
  assert.doesNotThrow(() => JSON.parse(batch.stdout), 'the shadow batch prints JSON');
  const kept = readdirSync(shadowOut, { recursive: true }).map(String);
  for (const n of ['s1', 's2', 's4', 's5']) assert.ok(kept.some((f) => f.includes(n)), `the output of ${n} is retained`);

  // The batch journal alone, before any judge call: batch_exit wall time, five exit rows, retries, queue origin, unfinished leaves.
  const batchRows = readRows(journal);
  const batchExits = batchRows.filter((r) => r.kind === 'batch_exit');
  assert.equal(batchExits.length, 1, 'one batch_exit row');
  const wall = batchExits[0].duration_ms;
  assert.ok(typeof wall === 'number' && wall > 0, 'batch_exit records the batch wall duration_ms');
  assert.deepEqual(batchExits[0].target_ms, [120000, 300000], 'target_ms is the batch target, not a child duration');
  assert.match(batchExits[0].usage_known_over_attempted, /^\d+\/\d+$/, 'known over attempted usage is a string count');
  assert.deepEqual(batchExits[0].unfinished_leaves, [], 'a finished batch has no unfinished leaves');
  assert.equal(batchRows.some((r) => r.kind === 'batch_interrupted'), false, 'a finished batch is not interrupted');
  const exits = batchRows.filter((r) => r.kind === 'exit');
  assert.deepEqual(exits.map((r) => r.leaf_id).sort(), names, 'five exit rows, one per journey');
  for (const r of exits) {
    assert.ok(r.start_offset_ms >= 0 && r.end_offset_ms >= r.start_offset_ms, `${r.leaf_id} offsets are ordered`);
    assert.ok(r.end_offset_ms <= wall, `${r.leaf_id} ends within the batch wall duration`);
    assert.ok(r.duration_ms <= wall, `${r.leaf_id} ran no longer than the batch wall`);
  }
  assert.ok(Math.max(...exits.map((r) => r.end_offset_ms)) <= wall, 'the five exits reconcile with the monotonic batch wall duration');
  const rowsOf = (k) => batchRows.filter((r) => r.kind === k);
  assert.equal(rowsOf('admission').length, 5);
  assert.ok([...rowsOf('admission'), ...exits].every((r) => r.queue_source === null), 'queue_source is null when unavailable');
  assert.ok(rowsOf('start').length === 5 && rowsOf('start').every((r) => r.queue_ms === null), 'queue_ms is null when unavailable');
  assert.deepEqual(rowsOf('retry_start').map((r) => r.leaf_id).sort(), ['s3', 's4'], 'only s3 and s4 retried');
  const retryExit = Object.fromEntries(rowsOf('retry_exit').map((r) => [r.leaf_id, r.status]));
  assert.deepEqual(retryExit, { s3: 'passed', s4: 'failed' }, 'the s3 retry passed and the s4 retry failed');
  assert.equal(exits.find((r) => r.leaf_id === 's3').result_status, 'passed');
  assert.equal(exits.find((r) => r.leaf_id === 's4').result_status, 'failed');
  assert.equal(batchExits[0].status, 'failed', 'the batch fails with s4');

  // Interrupted batch in an isolated child: SIGTERM mid-run journals batch_interrupted naming the unfinished leaf.
  const interruptJournal = join(shadowHome, 'interrupt.jsonl');
  const child = spawn(process.execPath, [cli, 'tests', 'shadow', 'hold', 's2', '--json'], { cwd: shadowDir, env: { ...shadowEnv, DONE_DONE_SHADOW_TIMING: interruptJournal }, stdio: 'ignore' });
  const closed = new Promise((r) => child.on('close', (code, signal) => r(signal)));
  for (let i = 0; i < 100 && !(existsSync(interruptJournal) && readRows(interruptJournal).some((r) => r.kind === 'exit' && r.leaf_id === 's2')); i++) await new Promise((r) => setTimeout(r, 100));
  child.kill('SIGTERM');
  assert.equal(await closed, 'SIGTERM', 'the isolated child ended by the signal');
  const cut = readRows(interruptJournal).filter((r) => r.kind === 'batch_interrupted');
  assert.equal(cut.length, 1, 'one batch_interrupted row');
  assert.deepEqual(cut[0].unfinished_leaves, ['hold']);
  assert.equal(cut[0].signal, 'SIGTERM');
  assert.ok(cut[0].duration_ms > 0);

  // One synthetic journey, checked through the stub judge: a failed attempt, a pass, then a cache hit.
  const first = sdd('--json', 'run', 's1');
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const cite = join(shadowDir, '.proof', JSON.parse(first.stdout).run_id, 's1.txt');
  const outcome = 'PROMPT-MARKER-91 s1 ok for Umer';
  const calls = () => (existsSync(shadowEnv.SYNTH_CALLS) ? readFileSync(shadowEnv.SYNTH_CALLS, 'utf8').trim().split('\n').filter(Boolean) : []);
  const attempts = () => readRows(journal).filter((r) => r.kind === 'provider_attempt' && r.run_id !== batchExits[0].run_id);
  sdd('--json', 'check', '--outcome', outcome, cite);
  assert.ok(calls().length >= 1, 'the stub judge was asked');
  assert.equal(calls().filter((c) => c === 'fail').length, 1, 'the failed provider attempt happened exactly once');
  const pass = sdd('--json', 'check', '--outcome', outcome, cite);
  assert.equal(pass.status, 0, pass.stdout + pass.stderr);
  const afterPass = calls().length;
  const attemptsAfterPass = attempts().length;
  assert.equal(attempts().filter((r) => r.terminal_status === 'failed').length, 1, 'the failed CLI dispatch is journaled exactly once');
  const cached = sdd('--json', 'check', '--outcome', outcome, cite);
  assert.equal(cached.status, 0, cached.stdout + cached.stderr);
  assert.equal(calls().length, afterPass, 'a cache hit makes no new provider call');
  assert.equal(attempts().length, attemptsAfterPass, 'a cache hit journals no new provider attempt');
  assert.ok(readRows(journal).some((r) => r.cache_hit === true), 'the cache hit is journaled');

  // Local synthetic direct API dispatch: a key route whose global fetch is a local stub that always fails (no network).
  const directJournal = join(directHome, 'direct.jsonl');
  writeFileSync(join(directHome, 'nofetch.mjs'), "globalThis.fetch = async () => { throw new Error('synthetic direct dispatch failure'); };\n");
  writeFileSync(join(directHome, 'config.yaml'), 'judge:\n  route: minimax:key\n  model: stub-direct\n');
  const directEnv = { ...shadowEnv, DONE_DONE_HOME: directHome, DONE_DONE_SHADOW_TIMING: directJournal, MINIMAX_API_KEY: 'synthetic-credential-47', NODE_OPTIONS: `--import ${pathToFileURL(join(directHome, 'nofetch.mjs')).href}` };
  const direct = spawnSync(process.execPath, [cli, '--json', 'check', '--outcome', outcome, cite], { cwd: shadowDir, env: directEnv, encoding: 'utf8' });
  log += `$ done-done --json check (direct minimax:key, stubbed fetch)\nexit ${direct.status}\n${direct.stdout}\n\n`;
  assert.notEqual(direct.status, 0, 'a failed direct dispatch never passes');
  assert.ok(existsSync(directJournal), 'the direct dispatch was journaled');
  const directRows = readRows(directJournal).filter((r) => r.kind === 'provider_attempt');
  assert.ok(directRows.length >= 1 && directRows.every((r) => String(r.route_model_version).startsWith('minimax:key:')), 'direct provider attempts are journaled');
  assert.ok(directRows.every((r) => r.input_tokens_or_null === null && r.output_tokens_or_null === null && r.usage_source === null), 'direct rows without usage record null tokens');

  // The journal, read once after every shadow drive.
  copyFileSync(journal, join(evidence, 'size-shadow.jsonl'));
  copyFileSync(directJournal, join(evidence, 'size-direct.jsonl'));
  copyFileSync(interruptJournal, join(evidence, 'size-interrupt.jsonl'));
  const records = readRows(journal);
  const text = JSON.stringify(records);
  for (const n of names) {
    assert.ok(text.includes(n), `the journal records ${n}`);
    assert.ok(records.some((r) => r.kind === 'exit' && r.leaf_id === n), `the journal records an exit for ${n}`);
  }
  const noUsage = records.filter((r) => r.kind === 'provider_attempt' && r.usage_source === null);
  assert.ok(noUsage.length > 0, 'provider attempts without usage exist');
  assert.ok(noUsage.every((r) => r.input_tokens_or_null === null && r.output_tokens_or_null === null), 'missing usage is null, never zero');
  for (const secret of ['PROMPT-MARKER-91', 'synthetic-credential-47']) {
    for (const t of [text, JSON.stringify(readRows(directJournal)), JSON.stringify(readRows(interruptJournal))]) assert.ok(!t.includes(secret), `a journal holds no ${secret}`);
  }

  // Known and attempted counts: the batch names its five journeys.
  const batchDoc = JSON.parse(batch.stdout);
  assert.ok(JSON.stringify(batchDoc).includes('s5'), 'the batch output names its journeys');

  log += `-> shadow journal records: ${records.length}; judge calls: ${calls().join(',')}; direct attempts: ${directRows.length}; interrupted unfinished: ${cut[0].unfinished_leaves}\n`;

  writeFileSync(join(evidence, 'size-bounds.log'), log);
  writeFileSync(join(evidence, 'steps.json'), JSON.stringify({
    target: { version: JSON.parse(readFileSync('package.json', 'utf8')).version },
    start: 'size-test fixture: a ci journey that sleeps 60s, a large journey with no reason, a quick ci journey',
    steps: [
      'Run the over-bound ci journey',
      'Lint a repo whose large journey has no reason',
      'Run the large journey without --night',
      'Measure the quick journey',
      'Lint again once the large journey has a reason',
      'Run five synthetic journeys together with done-done tests shadow and read the journal and retained outputs',
      'Interrupt an isolated child batch and read its batch_interrupted row',
      'Run a synthetic journey and check its text capture through a stub judge: one failed attempt, a pass, then a cache hit',
      'Check the same capture through a direct key route whose fetch is a local failing stub',
    ],
    result: 'the over-bound journey was stopped as slow at 15s, lint failed the reasonless large journey by name, the large journey was refused without --night, measure reported five timings, and lint passed once the reason was added; the shadow batch journaled five exit rows within the batch_exit wall duration with null queue origin, a passed s3 retry and a failed s4 retry; an interrupted child journaled its unfinished leaf; the one failed CLI dispatch was journaled once, the cache hit made no new call, the direct dispatch failure and missing usage were null, and no prompt or credential was journaled',
  }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  rmSync(shadowDir, { recursive: true, force: true });
  rmSync(shadowHome, { recursive: true, force: true });
  rmSync(shadowOut, { recursive: true, force: true });
  rmSync(directHome, { recursive: true, force: true });
}
