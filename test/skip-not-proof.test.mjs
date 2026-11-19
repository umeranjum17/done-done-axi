// End-to-end: check.skip_is_not_proof runs test commands with JG_TEST_SKIP_EXIT=77 and records exit 77 as skipped, never a pass.
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
const COMMAND = 'node testcmd.mjs';

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])));
  return Buffer.concat([len, Buffer.from(type), data, crc]);
};
function screen(shift = 0) {
  const [w, h] = [200, 120];
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([(x * 3 + shift) % 256, (y * 5) % 256, (x + y) % 256], y * (w * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// A throwaway repo with one journey (the fixture test command), a stub judge (never a model) and a file the command appends its env to.
function setup(on, matrix = false) {
  const dir = mkdtempSync(join(tmpdir(), 'done-done-skip-'));
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
  writeFileSync(join(dir, 'screen-400w.png'), screen(40));
  writeFileSync(join(dir, 'screen-800w.png'), screen(90));
  const envFile = join(dir, 'env.txt');
  writeFileSync(envFile, '');
  const host = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_CONFIG') && k !== 'JG_TEST_SKIP_EXIT'));
  const env = { ...host, GITHUB_ACTIONS: 'false', GIT_CONFIG_GLOBAL: join(dir, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', DONE_DONE_HOME: join(dir, 'home'), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com', ENV_FILE: envFile, SCREEN_PNG: join(dir, 'screen.png'), SCREEN_PNG_400w: join(dir, 'screen-400w.png'), SCREEN_PNG_800w: join(dir, 'screen-800w.png') };
  copyFileSync(join(here, 'fixtures', 'skip-not-proof', 'testcmd.mjs.txt'), join(repo, 'testcmd.mjs'));
  writeFileSync(join(repo, 'app.txt'), 'one\n');
  const switchLine = on === null ? '' : `check:\n  skip_is_not_proof: ${on}\n`;
  const matrixLines = matrix ? 'matrix:\n  width: [400, 800]\n' : '';
  writeFileSync(join(repo, '.done-done.yaml'), `app: skip-notes\nevidence:\n  root: .proof\n${switchLine}${matrixLines}journeys:\n  tests:\n    command: ${COMMAND}\n    core: true\n`);
  writeFileSync(join(repo, '.gitignore'), '.proof/\n');
  const sh = (...a) => execFileSync('git', a, { cwd: repo, env, stdio: 'pipe' });
  sh('init', '-q', '-b', 'main');
  sh('add', '-A');
  sh('commit', '-qm', 'init');
  const dd = (extra, ...args) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env: { ...env, ...extra }, encoding: 'utf8' });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  const seen = () => readFileSync(envFile, 'utf8').split('\n').filter(Boolean);
  const receipt = (runId, ...names) => dd({}, 'receipt', '--outcome', 'home renders', ...names.map((n) => join(repo, '.proof', runId, n)));
  return { repo, dd, seen, receipt };
}

test('with the switch on the test command gets JG_TEST_SKIP_EXIT=77; off or absent it gets nothing', () => {
  for (const [on, want] of [[true, '77'], [false, 'unset'], [null, 'unset']]) {
    const t = setup(on);
    const r = t.dd({}, 'run', 'tests');
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(t.seen(), [want], `switch ${on}`);
  }
});

test('an exit 77 is skipped, not a pass: the run is not recorded as proof and no receipt cites it', () => {
  const t = setup(true);
  const r = t.dd({ EXIT_ALL: '77' }, 'run', 'tests');
  assert.notEqual(r.code, 0, r.out);
  const out = decode(r.out);
  assert.equal(out.result, 'skipped');
  assert.match(out.reason, /every test skipped/);
  assert.deepEqual(out.skipped, ['default']);
  assert.equal(t.seen().length, 1, 'a skip is not retried as a flaky failure');
  const receipt = t.receipt(out.run_id, 'home.png');
  assert.notEqual(receipt.code, 0, receipt.out);
  assert.match(receipt.out, /a skip is not proof/);
});

test('a journey with one skipped cell and one passing cell keeps its receipt and lists the skip', () => {
  const t = setup(true, true);
  const r = t.dd({ SKIP_CELL: '800w' }, 'run', 'tests');
  assert.equal(r.code, 0, r.out);
  const out = decode(r.out);
  assert.equal(out.result, 'recorded');
  assert.deepEqual(out.skipped, ['width=800']);
  const record = JSON.parse(readFileSync(join(t.repo, '.proof', '.done-done', 'runs', `${out.run_id}.json`), 'utf8'));
  assert.deepEqual(record.skipped, ['width=800']);
  const receipt = t.receipt(out.run_id, 'home.400w.png', 'home.800w.png');
  assert.equal(receipt.code, 0, receipt.out);
});

test('with the switch off an exit 77 is a failure as before, and records no skip', () => {
  for (const on of [false, null]) {
    const t = setup(on);
    const r = t.dd({ EXIT_ALL: '77' }, 'run', 'tests');
    assert.notEqual(r.code, 0, r.out);
    const out = decode(r.out);
    assert.equal(out.result, 'fail');
    assert.match(out.reason, /exited 77/);
    assert.equal(out.skipped, undefined);
  }
});
