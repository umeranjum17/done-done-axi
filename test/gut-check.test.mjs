// End-to-end: `done-done receipt --new-test` with check.gut_check against throwaway git repos with a base commit and a head commit.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { decode } from '@toon-format/toon';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.js');

function png(w, h, seed = 0) {
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
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([(x * 3 + seed) % 256, (y * 5) % 256, (x + y) % 256], y * (w * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const CLAIM = 'home and settings render';
const STEPS = { target: { version: '1.0.0' }, start: 'a fresh notes app with no notes', steps: ['open the home screen', 'open settings'], result: CLAIM };
const PASSING = '{ correct: 0.95, wrong: 0.03, unclear: 0.02 }';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'gut-check');

// A repo whose base commit has only the journey and whose head commit adds the fixture project (a target and its checks);
// `check` is the config block under `check:`.
function fixture(check) {
  const dir = mkdtempSync(join(tmpdir(), 'done-done-gut-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  writeFileSync(join(dir, 'gitconfig'), '');
  const host = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_CONFIG') && k !== 'NODE_TEST_CONTEXT'));
  const judge = join(dir, 'judge-gemini');
  writeFileSync(judge, `#!${process.execPath}
const input = require('node:fs').readFileSync(0, 'utf8');
const keys = [...new Set([...input.matchAll(/capture_\\d+/g)].map((m) => m[0]))];
const relevance = { probabilities: ${PASSING}, rationale: 'ok', personReason: 'ok', parts: [], covers: [] };
process.stdout.write(JSON.stringify({ response: JSON.stringify(keys.length ? Object.fromEntries(keys.map((k) => [k, relevance])) : { relevance }) }));
`, { mode: 0o755 });
  mkdirSync(join(dir, 'home'));
  writeFileSync(join(dir, 'home', 'config.yaml'), `judge:\n  route: answerer:gemini\n  model: stub-judge\nagent_path_override: { gemini: ${JSON.stringify(judge)} }\n`);
  const env = { ...host, GITHUB_ACTIONS: 'false', GIT_CONFIG_GLOBAL: join(dir, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', DONE_DONE_HOME: join(dir, 'home'), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
  const sh = (...a) => execFileSync('git', a, { cwd: repo, env, stdio: 'pipe' });
  writeFileSync(join(dir, 'screen.png'), png(200, 120));
  writeFileSync(join(dir, 'screen2.png'), png(200, 120, 7));
  writeFileSync(join(repo, '.gitignore'), '.proof/\n');
  writeFileSync(join(repo, '.done-done.yaml'), `app: notes\nevidence:\n  root: .proof\njourneys:\n  shots:\n    command: node make-shots.mjs\n    core: true\n${check ? `check:\n${check}` : ''}`);
  writeFileSync(join(repo, 'make-shots.mjs'), `import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
const out = process.env.DONE_DONE_EVIDENCE_ROOT;
mkdirSync(out, { recursive: true });
copyFileSync(${JSON.stringify(join(dir, 'screen.png'))}, out + '/home.png');
copyFileSync(${JSON.stringify(join(dir, 'screen2.png'))}, out + '/settings.png');
writeFileSync(out + '/steps.json', JSON.stringify(${JSON.stringify(STEPS)}));
`);
  sh('init', '-q', '-b', 'main');
  sh('add', '-A');
  sh('commit', '-qm', 'base');
  cpSync(FIXTURE, repo, { recursive: true });
  sh('add', '-A');
  sh('commit', '-qm', 'head: the feature and its checks');
  const dd = (...args) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8' });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  const proof = () => {
    const run = dd('run', 'shots');
    assert.equal(run.code, 0, run.out);
    const id = decode(run.out).run_id;
    return [`.proof/${id}/home.png`, `.proof/${id}/settings.png`];
  };
  const receipt = (declared) => dd('receipt', '--outcome', CLAIM, ...declared.flatMap((f) => ['--new-test', f]), ...proof());
  const digest = (f) => createHash('sha256').update(readFileSync(join(repo, f))).digest('hex');
  return { repo, dd, receipt, digest, sh };
}

const ON = '  gut_check: true\n';

test('a test that only asserts its target exists passes against the stub: refused, naming the test and the target', () => {
  const t = fixture(ON);
  const r = t.receipt(['checks/exists-only.sh']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /checks\/exists-only\.sh/);
  assert.match(r.out, /still passes with lib\/greet\.sh stubbed/);
  assert.equal(decode(r.out).new_tests[0].gut, 'passed');
  assert.notEqual(t.dd('receipt', '--verify', 'HEAD').code, 0, 'no receipt was written');
});

test('a behaviour test fails against the stub and is receipted as caught', () => {
  const t = fixture(ON);
  const r = t.receipt(['checks/behaviour.sh']);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(decode(r.out).new_tests, [{ file: 'checks/behaviour.sh', gut: 'caught' }]);
});

test('with red before green also on, the row carries both', () => {
  const t = fixture(`  red_before_green: true\n${ON}`);
  const r = t.receipt(['checks/behaviour.sh']);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(decode(r.out).new_tests, [{ file: 'checks/behaviour.sh', base: 'red', head: 'green', gut: 'caught' }]);
});

test('a test with zero or two non-test targets is refused: gut check needs exactly one target', () => {
  const t = fixture(ON);
  for (const f of ['checks/no-target.sh', 'checks/two-targets.sh']) {
    const r = t.receipt([f]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /gut check needs exactly one target/);
    assert.equal(decode(r.out).new_tests.at(-1).gut, 'no single target');
  }
});

test('a javascript test that imports its target is stubbed with an empty module and caught', () => {
  const t = fixture(ON);
  writeFileSync(join(t.repo, 'lib/add.mjs'), 'export const add = (a, b) => a + b;\n');
  writeFileSync(join(t.repo, 'checks/add.check.mjs'), "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { add } from '../lib/add.mjs';\ntest('adds', () => assert.equal(add(1, 2), 3));\n");
  t.sh('add', '-A');
  t.sh('commit', '-qm', 'a js check');
  const r = t.receipt(['checks/add.check.mjs']);
  assert.equal(r.code, 0, r.out);
  assert.equal(decode(r.out).new_tests[0].gut, 'caught');
});

test('a test that exits 77 once the target is stubbed is skipped, not caught', () => {
  const t = fixture(ON);
  const r = t.receipt(['checks/skips-when-gutted.sh']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /skipped with lib\/greet\.sh stubbed; a skipped test is not a catch/);
});

test('the target is byte-identical after the run, whether it is refused, caught, or the run throws', () => {
  const t = fixture(ON);
  const before = t.digest('lib/greet.sh');
  t.receipt(['checks/exists-only.sh']);
  assert.equal(t.digest('lib/greet.sh'), before);
  t.receipt(['checks/behaviour.sh']);
  assert.equal(t.digest('lib/greet.sh'), before);
  const thrown = t.receipt(['checks/missing.sh']);
  assert.notEqual(thrown.code, 0, thrown.out);
  assert.equal(t.digest('lib/greet.sh'), before);
  assert.equal(t.sh('status', '--porcelain').toString(), '', 'the work tree is clean');
});

test('with the switch absent, --new-test is ignored with one warning line and nothing is gutted', () => {
  const t = fixture('');
  const r = t.receipt(['checks/exists-only.sh']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.out.split('\n').filter((l) => /--new-test ignored/.test(l)).length, 1);
});
