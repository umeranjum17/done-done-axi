// End-to-end: drives the built CLI against a throwaway git repo; check.preflight refuses a command that is not found before the run starts.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'dist', 'cli.js');
const FIXTURES = join(ROOT, 'test', 'fixtures', 'command-preflight');

// A repo whose journeys are `journeys` (name: command) and whose judge stub writes DD_MARKER when it is called.
function setup(journeys, preflight) {
  const dir = mkdtempSync(join(tmpdir(), 'done-done-preflight-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo');
  const marker = join(dir, 'judge-called');
  const judge = join(dir, 'judge-gemini');
  writeFileSync(join(dir, 'gitconfig'), '');
  mkdirSync(join(dir, 'home'));
  writeFileSync(judge, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'called');\nprocess.stdout.write(JSON.stringify({ response: '{}' }));\n`, { mode: 0o755 });
  writeFileSync(join(dir, 'home', 'config.yaml'), `judge:\n  route: answerer:gemini\n  model: stub-judge\nagent_path_override: { gemini: ${JSON.stringify(judge)} }\n`);
  mkdirSync(repo);
  cpSync(FIXTURES, join(repo, 'scripts'), { recursive: true });
  mkdirSync(join(repo, 'x'));
  const yaml = ['app: preflight', 'evidence:', '  root: .proof', ...(preflight === undefined ? [] : ['check:', `  preflight: ${preflight}`]), 'journeys:', ...Object.entries(journeys).flatMap(([n, c]) => [`  ${n}:`, `    command: ${JSON.stringify(c.command ?? c)}`, ...(c.tier ? [`    tier: ${c.tier}`, '    timeout: 30s'] : [])])].join('\n');
  writeFileSync(join(repo, '.done-done.yaml'), `${yaml}\n`);
  writeFileSync(join(repo, '.gitignore'), '.proof/\n');
  const env = { ...process.env, GITHUB_ACTIONS: 'false', GIT_CONFIG_GLOBAL: join(dir, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', DONE_DONE_HOME: join(dir, 'home'), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
  const git = (...a) => execFileSync('git', a, { cwd: repo, env, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'init');
  const dd = (...args) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8' });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  return { dd, marker };
}

// A run that passes the preflight is opened (it may still end red for writing no evidence, which is not what these cases test).
const started = (r) => !/command not found/.test(r.out) && /run_id/.test(r.out);

test('a command that is not found refuses run and verify before anything starts, naming the word and the journey', () => {
  const t = setup({ broken: 'nosuchtool --x' }, true);
  const run = t.dd('run', 'broken');
  assert.notEqual(run.code, 0, run.out);
  assert.match(run.out, /command not found: nosuchtool in broken/);
  assert.doesNotMatch(run.out, /run_id/, 'no run was opened');
  const verify = t.dd('verify', 'broken', '--outcome', 'it works', '--foreground');
  assert.notEqual(verify.code, 0, verify.out);
  assert.match(verify.out, /command not found: nosuchtool in broken/);
  assert.equal(existsSync(t.marker), false, 'the judge was never called');
});

test('builtins, plumbing and real binaries pass, and a word later in the command is checked too', () => {
  const t = setup({ ok: 'cd x && node -e 0', later: 'cd x && node -e 0 && nosuchtool', quoted: `node -e "console.log('a && nosuchtool')"` }, true);
  const ok = t.dd('run', 'ok');
  assert.ok(started(ok), ok.out);
  const later = t.dd('run', 'later');
  assert.match(later.out, /command not found: nosuchtool in later/);
  const quoted = t.dd('run', 'quoted');
  assert.ok(started(quoted), quoted.out);
});

test('a relative script passes when it is executable and refuses when it is not', () => {
  const t = setup({ yes: './scripts/runnable.sh', no: './scripts/not-executable.sh', missing: './scripts/gone.sh' }, true);
  assert.ok(started(t.dd('run', 'yes')));
  assert.match(t.dd('run', 'no').out, /command not found: \.\/scripts\/not-executable\.sh in no/);
  assert.match(t.dd('run', 'missing').out, /command not found: \.\/scripts\/gone\.sh in missing/);
});

test('env assignments and sh -c wrappers are read through', () => {
  const t = setup({ env: 'FOO=1 node -e 0', envbad: 'FOO=1 nosuchtool', shell: `sh -c 'FOO=1 node -e 0'`, shellbad: `sh -c 'FOO=1 nosuchtool'`, envwrap: 'env FOO=1 nosuchtool' }, true);
  assert.ok(started(t.dd('run', 'env')));
  assert.match(t.dd('run', 'envbad').out, /command not found: nosuchtool in envbad/);
  assert.ok(started(t.dd('run', 'shell')));
  assert.match(t.dd('run', 'shellbad').out, /command not found: nosuchtool in shellbad/);
  assert.match(t.dd('run', 'envwrap').out, /command not found: nosuchtool in envwrap/);
});

test('live checks are preflighted too', () => {
  const t = setup({ probe: { command: 'nosuchtool --live', tier: 'live' } }, true);
  const live = t.dd('run', '--tier', 'live');
  assert.notEqual(live.code, 0, live.out);
  assert.match(live.out, /command not found: nosuchtool in probe/);
});

test('with the switch off or absent the run starts and the shell reports the missing command later', () => {
  for (const preflight of [false, undefined]) {
    const t = setup({ broken: 'nosuchtool --x' }, preflight);
    const run = t.dd('run', 'broken');
    assert.notEqual(run.code, 0, run.out);
    assert.match(run.out, /run_id/, 'the run was opened and sealed');
    assert.match(run.out, /not found/);
    assert.doesNotMatch(run.out, /command not found: nosuchtool in broken: nothing ran/);
  }
});
