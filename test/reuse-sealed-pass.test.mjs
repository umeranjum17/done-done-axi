// End-to-end: check.reuse_pass makes a run that repeats a sealed PASS name that run instead of driving again.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { decode } from '@toon-format/toon';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'dist', 'cli.js');
const COMMAND = 'node counted.mjs ${RUN_ID}';

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])));
  return Buffer.concat([len, Buffer.from(type), data, crc]);
};
function screen() {
  const [w, h] = [200, 120];
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([(x * 3) % 256, (y * 5) % 256, (x + y) % 256], y * (w * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// A throwaway repo with one journey, a stub judge (never a model) and a counter file the journey appends to.
function setup(reuse = true) {
  const dir = mkdtempSync(join(tmpdir(), 'done-done-reuse-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  writeFileSync(join(dir, 'gitconfig'), '');
  const judge = join(dir, 'judge-gemini');
  const answer = { relevance: { probabilities: { correct: 0.95, wrong: 0.03, unclear: 0.02 }, rationale: 'The screen shows the outcome.', personReason: 'The screen shows the outcome.', parts: [], covers: [] } };
  writeFileSync(judge, `#!${process.execPath}\nconst input = require('node:fs').readFileSync(0, 'utf8');\nconst keys = [...new Set([...input.matchAll(/capture_\\d+/g)].map((m) => m[0]))];\nconst one = ${JSON.stringify(answer.relevance)};\nprocess.stdout.write(JSON.stringify({ response: JSON.stringify(keys.length ? Object.fromEntries(keys.map((k) => [k, one])) : ${JSON.stringify(answer)}) }));\n`, { mode: 0o755 });
  mkdirSync(join(dir, 'home'));
  writeFileSync(join(dir, 'home', 'config.yaml'), `judge:\n  route: answerer:gemini\n  model: stub-judge\nagent_path_override: { gemini: ${JSON.stringify(judge)} }\n`);
  writeFileSync(join(dir, 'screen.png'), screen());
  const counter = join(dir, 'counter.txt');
  writeFileSync(counter, '');
  const host = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_CONFIG')));
  const env = { ...host, GITHUB_ACTIONS: 'false', GIT_CONFIG_GLOBAL: join(dir, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', DONE_DONE_HOME: join(dir, 'home'), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com', COUNTER_FILE: counter, SCREEN_PNG: join(dir, 'screen.png') };
  copyFileSync(join(here, 'fixtures', 'reuse-sealed-pass', 'counted.mjs.txt'), join(repo, 'counted.mjs'));
  writeFileSync(join(repo, 'app.txt'), 'one\n');
  const config = (on) => `app: reuse-notes\nevidence:\n  root: .proof\ncheck:\n  reuse_pass: ${on}\njourneys:\n  counted:\n    command: ${COMMAND}\n    core: true\n`;
  writeFileSync(join(repo, '.done-done.yaml'), config(reuse));
  writeFileSync(join(repo, '.gitignore'), '.proof/\n');
  const sh = (...a) => execFileSync('git', a, { cwd: repo, env, stdio: 'pipe' });
  sh('init', '-q', '-b', 'main');
  sh('add', '-A');
  sh('commit', '-qm', 'init');
  const dd = (...args) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8' });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  const runs = () => readFileSync(counter, 'utf8').split('\n').filter(Boolean).length;
  // The first run drives the journey, and its capture is judged into a sealed PASS receipt at HEAD.
  const sealed = () => {
    const r = dd('run', 'counted');
    assert.equal(r.code, 0, r.out);
    const first = decode(r.out);
    const file = join(repo, '.proof', first.run_id, 'home.png');
    const receipt = dd('receipt', '--outcome', 'home renders', file);
    assert.equal(receipt.code, 0, receipt.out);
    return first.run_id;
  };
  return { dir, repo, sh, dd, runs, sealed, config };
}

test('the same tree, journey and command after a sealed PASS does not run again and names the sealed run', () => {
  const t = setup();
  const id = t.sealed();
  assert.equal(t.runs(), 1);
  const again = t.dd('run', 'counted');
  assert.equal(again.code, 0, again.out);
  assert.equal(t.runs(), 1, 'the journey did not run a second time');
  const out = decode(again.out);
  assert.equal(out.result, 'reused');
  assert.equal(out.reused_from, id);
  assert.match(again.out, /reused/);
  const record = JSON.parse(readFileSync(join(t.repo, '.proof', '.done-done', 'runs', `${out.run_id}.json`), 'utf8'));
  assert.equal(record.reused_from, id);
  assert.equal(record.exit, 0);
  const verified = t.dd('verify', 'counted', '--outcome', 'home renders');
  assert.equal(verified.code, 0, verified.out);
  assert.equal(t.runs(), 1, 'verify reused it too, with no judge or driver');
  assert.equal(decode(verified.out).reused_from, id);
});

test('a different tree runs again', () => {
  const t = setup();
  t.sealed();
  writeFileSync(join(t.repo, 'app.txt'), 'two\n');
  t.sh('commit', '-qam', 'change a file');
  assert.equal(t.dd('run', 'counted').code, 0);
  assert.equal(t.runs(), 2);
});

test('a different command text runs again', () => {
  const t = setup();
  t.sealed();
  const other = t.dd('run', 'counted', '--', 'node counted.mjs ${RUN_ID} other');
  assert.equal(other.code, 0, other.out);
  assert.equal(t.runs(), 2);
});

test('a dirty work tree runs again', () => {
  const t = setup();
  t.sealed();
  writeFileSync(join(t.repo, 'app.txt'), 'edited, not committed\n');
  assert.equal(t.dd('run', 'counted').code, 0);
  assert.equal(t.runs(), 2);
});

test('an unsealed or failed earlier run runs again', () => {
  const unsealed = setup();
  const id = unsealed.sealed();
  writeFileSync(join(unsealed.repo, '.proof', id, 'home.png'), 'edited after the seal');
  assert.equal(unsealed.dd('run', 'counted').code, 0);
  assert.equal(unsealed.runs(), 2, 'a receipt whose evidence hash no longer matches reuses nothing');
  const failed = setup();
  const first = failed.sealed();
  const path = join(failed.repo, '.proof', '.done-done', 'runs', `${first}.json`);
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), exit: 1 }));
  assert.equal(failed.dd('run', 'counted').code, 0);
  assert.equal(failed.runs(), 2, 'a run record that did not exit 0 reuses nothing');
  const none = setup();
  assert.equal(none.dd('run', 'counted').code, 0);
  assert.equal(none.dd('run', 'counted').code, 0);
  assert.equal(none.runs(), 2, 'with no receipt at all, nothing is reused');
});

test('switched off, a run runs again', () => {
  const t = setup(false);
  t.sealed();
  assert.equal(t.dd('run', 'counted').code, 0);
  assert.equal(t.runs(), 2);
  writeFileSync(join(t.repo, '.done-done.yaml'), t.config(true).replace('check:\n  reuse_pass: true\n', ''));
  t.sh('commit', '-qam', 'key removed');
  t.sealed();
  assert.equal(t.dd('run', 'counted').code, 0);
  assert.equal(t.runs(), 4, 'an absent key is off');
});
