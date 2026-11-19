// End-to-end: a mise shim such as python3 resolves inside the sealed instance run, and inside every command path done-done spawns (run -- <cmd>, a journey, the suite step), as it does outside it.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'dist', 'cli.js');

// How each command path starts the fake python3 shim. `instance` starts it as the app under test; the others run it as the
// project's command, which writes its evidence only once the shim has run, so a refused shim fails the run.
const EVIDENCE = 'mkdir -p $DONE_DONE_EVIDENCE_ROOT/$DONE_DONE_RUN_ID && echo ok > $DONE_DONE_EVIDENCE_ROOT/$DONE_DONE_RUN_ID/out.txt';
const COMMAND = `python3 && ${EVIDENCE}`;

// A throwaway repo whose commands run the fake python3 shim; the host HOME holds a mise config or not.
function run({ hostConfig, trusted, path = 'instance' }) {
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
  // As a command the shim records its env and exits; only the instance path goes on to serve the port.
  const shim = readFileSync(join(here, 'fixtures', 'mise-shim', 'python3.txt'), 'utf8');
  writeFileSync(join(bin, 'python3'), path === 'instance' ? shim : shim.split('\n').filter((l) => !l.startsWith('exec node')).join('\n'));
  chmodSync(join(bin, 'python3'), 0o755);
  writeFileSync(join(dir, 'gitconfig'), '');
  writeFileSync(join(repo, '.done-done.yaml'), `app: mise-notes\nevidence:\n  root: .proof\n${path === 'instance' ? 'instance:\n  command: python3 serve\n  ready:\n    url: ${DONE_DONE_BASE_URL}/\n  ready_timeout: 5s\n' : ''}journeys:\n  tests:\n    command: ${path === 'journey' ? COMMAND : EVIDENCE}\n    core: true\n`);
  writeFileSync(join(repo, '.gitignore'), '.proof/\n');
  const seen = join(dir, 'seen.txt');
  const host = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_CONFIG') && !k.startsWith('MISE_') && k !== 'XDG_CONFIG_HOME'));
  const env = { ...host, HOME: home, GITHUB_ACTIONS: 'false', GIT_CONFIG_GLOBAL: join(dir, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', DONE_DONE_HOME: join(dir, 'dd-home'), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com', PATH: `${bin}${delimiter}${process.env.PATH}`, FAKE_MISE_CONFIG: config, SHIM_SEEN: seen, ...(trusted && { MISE_TRUSTED_CONFIG_PATHS: trusted }) };
  const sh = (...a) => execFileSync('git', a, { cwd: repo, env, stdio: 'pipe' });
  sh('init', '-q', '-b', 'main');
  sh('add', '-A');
  sh('commit', '-qm', 'init');
  // `run --` refuses an argument holding the literal $DONE_DONE_EVIDENCE_ROOT, so the command is a script kept beside the repo.
  const script = join(dir, 'command.sh');
  writeFileSync(script, `${COMMAND}\n`);
  // The suite step is run in-process by `check`, which needs a judged claim; its own function is called under the same env instead.
  const suite = `import('${join(here, '..', 'dist', 'suite.js')}').then(async (m) => { const r = await m.runSuite(${JSON.stringify(repo)}, ${JSON.stringify(join(dir, 'suite-evidence'))}, 'head', ${JSON.stringify('python3')}, '30s'); process.exit(r.exit); })`;
  const args = { instance: [CLI, 'run', 'tests'], journey: [CLI, 'run', 'tests'], command: [CLI, 'run', '--', 'sh', script], suite: ['-e', suite] }[path];
  const r = spawnSync(process.execPath, args, { cwd: repo, env, encoding: 'utf8' });
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

// The command paths: each spawns the project's own command in the host's real environment, so a shim that mise would refuse
// without the host's trust and folders (a command that swaps HOME, a private scratch) still resolves.
for (const path of ['command', 'journey', 'suite']) {
  test(`a mise shim python3 resolves inside the ${path} path`, () => {
    const r = run({ hostConfig: true, path });
    assert.equal(r.code, 0, r.out);
    assert.equal(r.line('trusted'), r.config);
  });
}

test('a caller-set MISE_TRUSTED_CONFIG_PATHS is kept and extended on the command path too', () => {
  const r = run({ hostConfig: true, trusted: '/somewhere/else', path: 'command' });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.line('trusted'), `/somewhere/else${delimiter}${r.config}`);
});
