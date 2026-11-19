// End-to-end: a mise shim such as python3 resolves inside the sealed instance run as it does outside it.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'dist', 'cli.js');

// A throwaway repo whose instance command is the fake python3 shim; the host HOME holds a mise config or not.
function run({ hostConfig, trusted }) {
  const dir = mkdtempSync(join(tmpdir(), 'done-done-mise-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo');
  const bin = join(dir, 'bin');
  const home = join(dir, 'host-home');
  const config = join(home, '.config', 'mise', 'config.toml');
  mkdirSync(repo);
  mkdirSync(bin);
  mkdirSync(join(home, '.config', 'mise'), { recursive: true });
  if (hostConfig) writeFileSync(config, '[tools]\npython = "3"\n');
  copyFileSync(join(here, 'fixtures', 'mise-shim', 'python3.txt'), join(bin, 'python3'));
  chmodSync(join(bin, 'python3'), 0o755);
  writeFileSync(join(dir, 'gitconfig'), '');
  writeFileSync(join(repo, '.done-done.yaml'), 'app: mise-notes\nevidence:\n  root: .proof\ninstance:\n  command: python3 serve\n  ready:\n    url: ${DONE_DONE_BASE_URL}/\n  ready_timeout: 5s\njourneys:\n  tests:\n    command: mkdir -p $DONE_DONE_EVIDENCE_ROOT/$DONE_DONE_RUN_ID && echo ok > $DONE_DONE_EVIDENCE_ROOT/$DONE_DONE_RUN_ID/out.txt\n    core: true\n');
  writeFileSync(join(repo, '.gitignore'), '.proof/\n');
  const seen = join(dir, 'seen.txt');
  const host = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_CONFIG') && !k.startsWith('MISE_') && k !== 'XDG_CONFIG_HOME'));
  const env = { ...host, HOME: home, GITHUB_ACTIONS: 'false', GIT_CONFIG_GLOBAL: join(dir, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', DONE_DONE_HOME: join(dir, 'dd-home'), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com', PATH: `${bin}${delimiter}${process.env.PATH}`, FAKE_MISE_CONFIG: config, SHIM_SEEN: seen, ...(trusted && { MISE_TRUSTED_CONFIG_PATHS: trusted }) };
  const sh = (...a) => execFileSync('git', a, { cwd: repo, env, stdio: 'pipe' });
  sh('init', '-q', '-b', 'main');
  sh('add', '-A');
  sh('commit', '-qm', 'init');
  const r = spawnSync(process.execPath, [CLI, 'run', 'tests'], { cwd: repo, env, encoding: 'utf8' });
  const lines = existsSync(seen) ? readFileSync(seen, 'utf8').split('\n') : [];
  return { code: r.status, out: r.stdout + r.stderr, config, line: (k) => lines.find((l) => l.startsWith(`${k}=`))?.slice(k.length + 1) };
}

test('a mise shim python3 resolves inside the sealed instance run', () => {
  const r = run({ hostConfig: true });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.line('trusted'), r.config);
});

test('a caller-set MISE_TRUSTED_CONFIG_PATHS is kept and extended, not replaced', () => {
  const r = run({ hostConfig: true, trusted: '/somewhere/else' });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.line('trusted'), `/somewhere/else${delimiter}${r.config}`);
});

test('no mise config on the host leaves the mise env unchanged', () => {
  const r = run({ hostConfig: false });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.line('trusted'), '');
});
