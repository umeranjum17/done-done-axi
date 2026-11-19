// End-to-end: with check.count_false_refusals, `report false-refusals` counts a FAIL followed by a PASS on one tree, per check.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { decode } from '@toon-format/toon';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'dist', 'cli.js');

// A throwaway repo with two checks that run the same flip script; each run picks its outcome with FLIP.
function setup(switchLine = '  count_false_refusals: true\n') {
  const dir = mkdtempSync(join(tmpdir(), 'done-done-false-refusals-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  writeFileSync(join(dir, 'gitconfig'), '');
  mkdirSync(join(dir, 'home'));
  const host = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_CONFIG')));
  const env = { ...host, GITHUB_ACTIONS: 'false', GIT_CONFIG_GLOBAL: join(dir, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', DONE_DONE_HOME: join(dir, 'home'), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
  copyFileSync(join(here, 'fixtures', 'false-refusals', 'flip.mjs.txt'), join(repo, 'flip.mjs'));
  writeFileSync(join(repo, 'app.txt'), 'one\n');
  writeFileSync(join(repo, '.done-done.yaml'), `app: refusal-notes\nevidence:\n  root: .proof\n${switchLine ? `check:\n${switchLine}` : ''}journeys:\n  alpha:\n    command: node flip.mjs\n    core: true\n  beta:\n    command: node flip.mjs\n`);
  writeFileSync(join(repo, '.gitignore'), '.proof/\n');
  const sh = (...a) => execFileSync('git', a, { cwd: repo, env, stdio: 'pipe' });
  sh('init', '-q', '-b', 'main');
  sh('add', '-A');
  sh('commit', '-qm', 'init');
  const dd = (extra, ...args) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env: { ...env, ...extra }, encoding: 'utf8' });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  const drive = (check, outcome) => dd({ FLIP: outcome }, 'run', check);
  const report = () => {
    const r = dd({}, 'report', 'false-refusals', '--json');
    assert.equal(r.code, 0, r.out);
    return JSON.parse(r.out);
  };
  const change = (text) => {
    writeFileSync(join(repo, 'app.txt'), text);
    sh('commit', '-qam', 'change a file');
  };
  return { drive, report, change, dd };
}
const row = (out, check) => out.checks.find((c) => c.check === check);

test('a FAIL then a PASS on one tree is a false refusal for that check only', () => {
  const t = setup();
  assert.equal(t.drive('alpha', 'fail').code, 1);
  assert.equal(t.drive('alpha', 'pass').code, 0);
  assert.equal(t.drive('beta', 'pass').code, 0);
  const out = t.report();
  assert.equal(out.switch, 'on');
  assert.equal(row(out, 'alpha').false_refusals, 1);
  assert.equal(row(out, 'alpha').catches, 0);
  assert.equal(row(out, 'beta').false_refusals, 0);
  assert.equal(out.false_refusals, 1);
});

test('a FAIL and a PASS on different trees is no false refusal', () => {
  const t = setup();
  assert.equal(t.drive('alpha', 'fail').code, 1);
  t.change('two\n');
  assert.equal(t.drive('alpha', 'pass').code, 0);
  const out = t.report();
  assert.equal(row(out, 'alpha').false_refusals, 0);
  assert.equal(row(out, 'alpha').catches, 1);
});

test('a FAIL with no later PASS is a catch, and the ratio is catches to false refusals', () => {
  const t = setup();
  assert.equal(t.drive('alpha', 'fail').code, 1);
  assert.equal(t.drive('beta', 'fail').code, 1);
  assert.equal(t.drive('beta', 'pass').code, 0);
  const out = t.report();
  assert.equal(row(out, 'alpha').catches, 1);
  assert.equal(row(out, 'alpha').false_refusals, 0);
  assert.equal(row(out, 'beta').false_refusals, 1);
  assert.equal(out.catches, 1);
  assert.equal(out.catches_to_false, '1:1');
  const text = t.dd({}, 'report', 'false-refusals');
  assert.equal(text.code, 0, text.out);
  assert.match(text.out, /alpha/);
  assert.equal(decode(text.out).false_refusals, 1);
});

test('with the switch off or absent the report says so and counts nothing', () => {
  for (const line of ['  count_false_refusals: false\n', '']) {
    const t = setup(line);
    t.drive('alpha', 'fail');
    t.drive('alpha', 'pass');
    const out = t.report();
    assert.equal(out.switch, 'off');
    assert.equal(out.checks, undefined);
    assert.equal(out.false_refusals, undefined);
    assert.match(out.help.join(' '), /check\.count_false_refusals/);
  }
});
