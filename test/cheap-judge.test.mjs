// End-to-end: the built CLI judges one capture with judge.cheap_first on or off against stub agent CLIs
// (test/fixtures/cheap-judge/stub-judge), and the receipt's judge record lists every call it made.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { decode } from '@toon-format/toon';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'dist', 'cli.js');
const STUB = join(here, 'fixtures', 'cheap-judge', 'stub-judge');
const OUTCOME = 'the notes home screen renders';

function png(w, h) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])));
    return Buffer.concat([len, Buffer.from(type), data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([(x * 3) % 256, (y * 5) % 256, (x + y) % 256], y * (w * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// A repo whose one journey captures one screen, a global config whose judge is the gemini stub (the large model) and
// whose claude and opencode stubs are the cheap pair. verdicts: what each stub says, by agent.
function setup(cheapFirst, verdicts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cheap-judge-test-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo');
  const log = join(dir, 'calls.log');
  writeFileSync(log, '');
  writeFileSync(join(dir, 'gitconfig'), '');
  const host = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_CONFIG')));
  const env = { ...host, GITHUB_ACTIONS: 'false', GIT_CONFIG_GLOBAL: join(dir, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', DONE_DONE_HOME: join(dir, 'home'), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com', STUB_LOG: log };
  for (const agent of ['claude', 'opencode', 'gemini']) env[`STUB_${agent.toUpperCase()}`] = verdicts[agent] ?? 'correct';
  const bins = {};
  for (const agent of ['claude', 'opencode', 'gemini']) {
    bins[agent] = join(dir, `stub-${agent}`);
    writeFileSync(bins[agent], `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(STUB)} ${agent}\n`);
    chmodSync(bins[agent], 0o755);
  }
  mkdirSync(env.DONE_DONE_HOME, { recursive: true });
  writeFileSync(join(env.DONE_DONE_HOME, 'config.yaml'), `judge:\n  route: answerer:gemini\n  model: large-stub\n${cheapFirst === undefined ? '' : `  cheap_first: ${cheapFirst}\n`}agent_path_override: { claude: ${JSON.stringify(bins.claude)}, opencode: ${JSON.stringify(bins.opencode)}, gemini: ${JSON.stringify(bins.gemini)} }\n`);
  mkdirSync(repo);
  writeFileSync(join(repo, '.gitignore'), '.proof/\n');
  writeFileSync(join(repo, '.done-done.yaml'), 'app: notes\nevidence:\n  root: .proof\njourneys:\n  shots:\n    command: node make-shots.mjs ${RUN_ID}\n    core: true\n');
  writeFileSync(join(dir, 'screen.png'), png(200, 120));
  const steps = { target: { version: '1.0.0' }, start: 'a fresh notes app', steps: ['open the home screen'], result: OUTCOME };
  writeFileSync(join(repo, 'make-shots.mjs'), `import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';\nconst out = process.env.DONE_DONE_EVIDENCE_ROOT || '.proof/' + process.argv[2];\nmkdirSync(out, { recursive: true });\ncopyFileSync(${JSON.stringify(join(dir, 'screen.png'))}, out + '/home.png');\nwriteFileSync(out + '/steps.json', ${JSON.stringify(JSON.stringify(steps))});\n`);
  const sh = (...a) => execFileSync('git', a, { cwd: repo, env, stdio: 'pipe' });
  sh('init', '-q', '-b', 'main');
  sh('add', '-A');
  sh('commit', '-qm', 'init');
  const dd = (...args) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8' });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  // The receipt's judge record for the one capture, and the agents the stubs saw, in call order.
  const receipt = () => {
    const run = dd('run', 'shots');
    assert.equal(run.code, 0, run.out);
    const r = dd('receipt', '--outcome', OUTCOME, `.proof/${decode(run.out).run_id}/home.png`);
    assert.equal(r.code, 0, r.out);
    return { rec: JSON.parse(readFileSync(join(repo, decode(r.out).receipt), 'utf8')), seen: readFileSync(log, 'utf8').split('\n').filter(Boolean) };
  };
  return { receipt, dd, env };
}

test('both cheap judges agree: the large model is never called and the receipt lists two cheap calls', () => {
  const { rec, seen } = setup(true).receipt();
  assert.deepEqual(seen, ['claude', 'opencode'], 'only the cheap pair ran');
  assert.deepEqual(rec.judge.verdicts.map((v) => v.verdict), ['pass']);
  assert.deepEqual(rec.judge.calls.map((c) => c.tier), ['cheap', 'cheap']);
  assert.deepEqual(rec.judge.calls.map((c) => c.model), ['claude-haiku-5-5', 'opencode-go/muse-spark-1.3-contributor']);
});

test('cheap judges disagree: the large model is called once and its verdict wins', () => {
  const { rec, seen } = setup(true, { claude: 'wrong', opencode: 'correct', gemini: 'correct' }).receipt();
  assert.deepEqual(seen, ['claude', 'opencode', 'gemini']);
  assert.deepEqual(rec.judge.verdicts.map((v) => v.verdict), ['pass'], 'the large pass counts, not the cheap fail');
  assert.deepEqual([rec.judge.route, rec.judge.model], ['answerer:gemini', 'large-stub'], 'the receipt names the model that decided');
  assert.deepEqual(rec.judge.calls.map((c) => [c.model, c.tier]), [['claude-haiku-5-5', 'cheap'], ['opencode-go/muse-spark-1.3-contributor', 'cheap'], ['large-stub', 'large']]);
});

test('a large fail overrides a cheap pass after a disagreement', () => {
  const t = setup(true, { claude: 'correct', opencode: 'wrong', gemini: 'wrong' });
  const run = t.dd('run', 'shots');
  const r = t.dd('check', '--outcome', OUTCOME, `.proof/${decode(run.out).run_id}/home.png`);
  assert.equal(r.code, 1, r.out);
  assert.deepEqual(readFileSync(t.env.STUB_LOG, 'utf8').split('\n').filter(Boolean), ['claude', 'opencode', 'gemini']);
});

test('a backend that reports no usage records tokens as null, never 0', () => {
  const { rec } = setup(true).receipt();
  for (const call of rec.judge.calls) assert.deepEqual([call.tokens_in, call.tokens_out], [null, null]);
});

for (const [name, cheapFirst] of [['switched off', false], ['absent from the config', undefined]])
  test(`cheap_first ${name}: one call on the configured model, one row in the calls list`, () => {
    const { rec, seen } = setup(cheapFirst).receipt();
    assert.deepEqual(seen, ['gemini']);
    assert.deepEqual(rec.judge.calls, [{ model: 'large-stub', tokens_in: null, tokens_out: null, tier: 'large' }]);
  });
