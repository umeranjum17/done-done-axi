// Drive real run/check/receipt commands with deterministic provider adapters, not a hosted model.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CLI = resolve(process.env.DONE_DONE_TEST_CLI || 'dist/cli.js');
const OUT = process.env.DONE_DONE_EVIDENCE_ROOT;
const old = process.env.DONE_DONE_EXPECT_OLD === '1';
const tmp = mkdtempSync(join(tmpdir(), 'dd-parts-'));
const repo = join(tmp, 'repo'), home = join(tmp, 'home');
const outcome = 'desktop click marker, phone landscape fit, phone portrait fit, phone tap and phone pinch zoom are shown';
const parts = ['desktop click', 'phone landscape', 'phone portrait', 'phone tap', 'phone pinch zoom'];
const variants = [parts, ['desktop click marker', 'phone landscape fit', 'phone portrait fit', 'phone tap', 'phone pinch zoom'], ['desktop client click', 'phone landscape fitted', 'phone portrait fitted', 'phone tap', 'pinch zoom'], ['desktop marker', 'landscape fit', 'portrait fit', 'phone tapping', 'phone zoom'], ['desktop client marker', 'landscape fitted', 'portrait fitted', 'tap', 'pinch zoom']];
const transcript = [];
const env = { ...process.env, DONE_DONE_HOME: home, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_COUNT: '0', GIT_AUTHOR_NAME: 'Umer', GIT_AUTHOR_EMAIL: 'umer@example.test', GIT_COMMITTER_NAME: 'Umer', GIT_COMMITTER_EMAIL: 'umer@example.test' };
const run = (...args) => {
  const r = spawnSync(process.execPath, [CLI, '--json', ...args], { cwd: repo, env, encoding: 'utf8' });
  transcript.push(`$ done-done ${args.join(' ')}\n${r.stdout}${r.stderr}\nexit: ${r.status}`);
  assert.ifError(r.error);
  return { code: r.status, value: JSON.parse(r.stdout) };
};
const expect = (code, ...args) => { const r = run(...args); assert.equal(r.code, code, transcript.at(-1)); return r.value; };
try {
  mkdirSync(repo); mkdirSync(home);
  const calls = join(tmp, 'calls.jsonl');
  const adapter = join(tmp, 'gemini');
  writeFileSync(adapter, `#!${process.execPath}
const fs = require('node:fs');
const prompt = fs.readFileSync(0, 'utf8');
fs.appendFileSync(${JSON.stringify(calls)}, 'call\\n');
if (process.env.PARTS_REFUSE) { console.error('fixture context limit: cannot fit the whole request'); process.exit(1); }
const variants = ${JSON.stringify(variants)};
const keys = [...new Set([...prompt.matchAll(/capture_\\d+/g)].map(m => m[0]))];
const answer = Object.fromEntries(keys.map((k, i) => [k, { probabilities: { correct: 0.95, wrong: 0.03, unclear: 0.02 }, rationale: 'The capture shows part ' + i, personReason: 'The capture shows its part.', parts: variants[i], covers: process.env.PARTS_MISSING && i === 4 ? [] : [i] }]));
process.stdout.write(JSON.stringify(process.argv.includes('--output-format') ? { type: 'result', subtype: 'success', is_error: false, structured_output: answer } : { response: JSON.stringify(answer) }));
`, { mode: 0o755 });
  const config = (route) => writeFileSync(join(home, 'config.yaml'), `agent: claude\njudge:\n  route: ${route}\n  model: fixture-parts\nagent_path_override: { gemini: ${JSON.stringify(adapter)}, claude: ${JSON.stringify(adapter)} }\n`);
  config('answerer:gemini');
  writeFileSync(join(repo, '.done-done.yaml'), 'app: shared-parts\njourneys:\n  captures:\n    command: node capture.mjs\n    core: true\n');
  writeFileSync(join(repo, 'capture.mjs'), `import { writeFileSync } from 'node:fs';
const out = process.env.DONE_DONE_EVIDENCE_ROOT;
for (let i = 0; i < 5; i++) writeFileSync(out + '/part-' + i + '.json', JSON.stringify({ part: i, result: ${JSON.stringify(outcome)} }));
writeFileSync(out + '/steps.json', JSON.stringify({ target: { version: '1.0.0' }, start: 'five independent result records', steps: ['capture all five results'], result: ${JSON.stringify(outcome)} }));
`);
  const git = (...args) => execFileSync('git', args, { cwd: repo, env, stdio: 'pipe' });
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-qm', 'fixture');
  const captured = expect(0, 'run', 'captures');
  const files = captured.evidence;
  assert.equal(files.length, 5, 'the public run seals all five captures');
  const check = () => run('check', '--outcome', outcome, ...files);
  const cache = join(home, 'runs', 'shared-parts', 'judge');
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  mkdirSync(cache, { recursive: true });
  for (const [i, file] of files.entries()) {
    const key = sha(JSON.stringify([9, sha(readFileSync(file)), outcome, 'answerer:gemini', 'fixture-parts', 0.7]));
    writeFileSync(join(cache, key + '.json'), JSON.stringify({ verdict: 'pass', reason: 'old independent call', parts: variants[i], covers: [i] }));
  }
  const count = () => readFileSync(calls, 'utf8').trim().split('\n').length;
  const first = check();
  assert.equal(first.code, old ? 3 : 0, transcript.at(-1));
  assert.deepEqual(first.value.judge.judged.map(r => r.verdict), Array(5).fill('pass'));
  assert.equal(count(), 1, 'five capture questions in one call; old per-capture entries are not combined');
  assert.ok(first.value.judge.judged.every(r => !r.cached));
  const cached = check();
  assert.equal(cached.code, old ? 3 : 0);
  assert.ok(cached.value.judge.judged.every(r => r.cached));
  assert.equal(count(), 1, 'full-set cache is reused');
  if (!old) expect(0, 'receipt', '--outcome', outcome, ...files);
  const batchOutcome = outcome + ' old batch';
  const batchKey = sha(JSON.stringify([9, files.map(f => [sha(readFileSync(f)), null]), batchOutcome, 'answerer:gemini', 'fixture-parts', 0.7]));
  writeFileSync(join(cache, batchKey + '.json'), JSON.stringify({ judged: first.value.judge.judged, missing: ['phone landscape fitted'] }));
  const oldBatch = run('check', '--outcome', batchOutcome, ...files);
  assert.equal(oldBatch.code, old ? 3 : 0, transcript.at(-1));
  assert.ok(oldBatch.value.judge.judged.every(r => r.cached === old));
  env.PARTS_MISSING = '1';
  expect(3, 'check', '--outcome', outcome + ' missing', ...files);
  delete env.PARTS_MISSING;
  env.PARTS_REFUSE = '1';
  const refused = run('check', '--outcome', outcome + ' too large', ...files);
  assert.equal(refused.code, 2);
  assert.equal(refused.value.result, undefined, 'one-call refusal is not partial proof');
  assert.match(refused.value.error, /cannot fit the whole request/);
  delete env.PARTS_REFUSE;

  config('claude-code');
  const claude = run('check', '--outcome', outcome + ' claude', ...files);
  assert.equal(claude.code, old ? 3 : 0, transcript.at(-1));
  assert.deepEqual(claude.value.judge.judged.map(r => r.verdict), Array(5).fill('pass'));

  // The public key route has no answer fields and deliberately does not enforce parts.
  const fetchStub = join(tmp, 'fetch.mjs');
  const requests = join(tmp, 'requests.jsonl');
  writeFileSync(fetchStub, `import { appendFileSync } from 'node:fs';
globalThis.fetch = async (_url, init) => {
  appendFileSync(${JSON.stringify(requests)}, 'call\\n');
  const body = JSON.parse(init.body);
  if (body.tools) {
    const variants = ${JSON.stringify(variants)};
    const input = Object.fromEntries(Object.keys(body.tools[0].input_schema.properties).map((k, i) => [k, { probabilities: { correct: 0.95, wrong: 0.03, unclear: 0.02 }, pick: 'correct', rationale: 'The capture shows its part.', personReason: 'Result present.', parts: variants[i], covers: [i] }]));
    return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'decisions', input }], usage: { input_tokens: 1, output_tokens: 1 } }), { headers: { 'content-type': 'application/json' } });
  }
  const text = JSON.stringify({ relevance: { probabilities: { correct: 0.95, wrong: 0.03, unclear: 0.02 }, pick: 'correct', rationale: 'The capture shows its result.', personReason: 'The result is present.' } });
  return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }), { headers: { 'content-type': 'application/json' } });
};
`);
  config('openai:key');
  env.OPENAI_API_KEY = 'fixture-not-a-secret';
  env.NODE_OPTIONS = `--import=${pathToFileURL(fetchStub)}`;
  expect(0, 'check', '--outcome', outcome, ...files);
  assert.equal(readFileSync(requests, 'utf8').trim().split('\n').length, 5);
  const keyCached = check();
  assert.equal(keyCached.code, 0);
  assert.ok(keyCached.value.judge.judged.every(r => r.cached));

  // Simulate version-9 per-capture entries from older independent calls. New versions must miss them.
  const legacyOutcome = outcome + ' legacy';
  for (const [i, file] of files.entries()) {
    const key = sha(JSON.stringify([9, sha(readFileSync(file)), legacyOutcome, 'openai:key', 'fixture-parts', 0.7]));
    writeFileSync(join(cache, key + '.json'), JSON.stringify({ verdict: 'pass', reason: 'old independent call', parts: variants[i], covers: [i] }));
  }
  const legacy = run('check', '--outcome', legacyOutcome, ...files);
  assert.equal(legacy.code, old ? 3 : 0, transcript.at(-1));
  assert.ok(legacy.value.judge.judged.every(r => r.cached === old));
  config('minimax:key');
  env.MINIMAX_API_KEY = 'fixture-not-a-secret';
  const mini = run('check', '--outcome', outcome + ' minimax', ...files);
  assert.equal(mini.code, old ? 3 : 0, transcript.at(-1));
  assert.deepEqual(mini.value.judge.judged.map(r => r.verdict), Array(5).fill('pass'));
  console.log(`PASS: five differently-worded lists on answerer:gemini, claude-code and minimax:key; batch ${old ? 'inconclusive (reproduced)' : 'pass'}; full-set cache; missing part inconclusive; oversized request error; openai:key five calls/no parts; legacy cache ${old ? 'inconclusive (reproduced)' : 'invalidated'}`);
} finally {
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, 'shared-parts.log'), transcript.join('\n\n') + '\n');
    writeFileSync(join(OUT, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version }, start: 'isolated git fixture and deterministic provider adapters', steps: ['run captures', 'check five differently-worded part lists', 'repeat cached check', 'check missing coverage and refused request', 'check openai key route and legacy caches'], result: 'five-part aggregation uses shared positions; missing coverage stays inconclusive; legacy cache is invalidated' }));
  }
  rmSync(tmp, { recursive: true, force: true });
}
