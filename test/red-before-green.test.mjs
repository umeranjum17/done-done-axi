// End-to-end: `done-done receipt --new-test` against throwaway git repos with a base commit and a head commit.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

// A repo whose base commit has the journey and whose head commit adds feature.txt and the declared tests; `switchOn` sets the config key.
function fixture(switchOn, extraConfig = '') {
  const dir = mkdtempSync(join(tmpdir(), 'done-done-rbg-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  writeFileSync(join(dir, 'gitconfig'), '');
  const host = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_CONFIG')));
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
  writeFileSync(join(repo, '.done-done.yaml'), `app: notes\nevidence:\n  root: .proof\njourneys:\n  shots:\n    command: node make-shots.mjs\n    core: true\n${switchOn ? 'check:\n  red_before_green: true\n' + extraConfig : ''}`);
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
  const tests = {
    'test/always-passes.test.mjs': "import { test } from 'node:test';\ntest('one is one', () => {});\n",
    'test/needs-feature.sh': 'test -f feature.txt\n',
    'test/skips.sh': 'exit "${JG_TEST_SKIP_EXIT:-0}"\n',
    'test/fails-at-head.sh': 'exit 1\n',
    'test/notes.txt': 'no runner covers this\n',
  };
  mkdirSync(join(repo, 'test'));
  writeFileSync(join(repo, 'feature.txt'), 'the new behaviour\n');
  for (const [f, text] of Object.entries(tests)) writeFileSync(join(repo, f), text);
  sh('add', '-A');
  sh('commit', '-qm', 'head: the feature and its tests');
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
  const receipt = (declared, ...rest) => dd('receipt', '--outcome', CLAIM, ...declared.flatMap((f) => ['--new-test', f]), ...rest, ...proof());
  const stored = () => {
    const r = dd('receipt', '--verify', 'HEAD');
    assert.equal(r.code, 0, r.out);
    return r;
  };
  return { repo, dd, receipt, stored, env };
}

test('a declared test that already passes on the base refuses the receipt, naming the file', () => {
  const t = fixture(true);
  const r = t.receipt(['test/always-passes.test.mjs']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /test\/always-passes\.test\.mjs/);
  assert.match(r.out, /already passes on the base/);
  assert.equal(t.dd('receipt', '--verify', 'HEAD').code === 0, false, 'no receipt was written');
});

test('a declared test that fails on the base and passes at head is receipted as red', () => {
  const t = fixture(true);
  const r = t.receipt(['test/needs-feature.sh']);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(decode(r.out).new_tests, [{ file: 'test/needs-feature.sh', base: 'red', head: 'green' }]);
  assert.equal(t.stored().code, 0);
});

test('a test that exits 77 is skipped, never a pass; a head failure and an unknown runner refuse too', () => {
  const t = fixture(true);
  const skipped = t.receipt(['test/skips.sh']);
  assert.equal(skipped.code, 1, skipped.out);
  assert.match(skipped.out, /test\/skips\.sh: skipped/);
  const failing = t.receipt(['test/fails-at-head.sh']);
  assert.equal(failing.code, 1, failing.out);
  assert.match(failing.out, /fails at head/);
  const unknown = t.receipt(['test/notes.txt']);
  assert.equal(unknown.code, 1, unknown.out);
  assert.match(unknown.out, /no runner for test\/notes\.txt/);
});

test('check.test_run runs a file no built-in runner covers', () => {
  const t = fixture(true, "  test_run: 'sh -c \"test -f feature.txt\" # {file}'\n");
  const r = t.receipt(['test/notes.txt']);
  assert.equal(r.code, 0, r.out);
  assert.equal(decode(r.out).new_tests[0].base, 'red');
});

test('no --new-test leaves the receipt unchanged', () => {
  const t = fixture(true);
  const r = t.receipt([]);
  assert.equal(r.code, 0, r.out);
  assert.equal(decode(r.out).new_tests, undefined);
});

test('with the switch off, --new-test is ignored with one warning line', () => {
  const t = fixture(false);
  const r = t.receipt(['test/always-passes.test.mjs']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.out.split('\n').filter((l) => /--new-test ignored/.test(l)).length, 1);
  assert.equal(decode(r.out.split('\n').filter((l) => !/--new-test ignored/.test(l)).join('\n')).new_tests, undefined);
});
