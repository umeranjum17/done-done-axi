// upgrade journey: the release path users take. Installs the last published done-done-axi from npm into a throwaway
// prefix, lets that version write its config and a repo's .done-done.yaml, installs this checkout's package over it in
// place (npm install -g of the packed tree), then drives the core journey (journeys/e2e.mjs) with the upgraded binary.
// Runs from the done-done repo root with DONE_DONE_EVIDENCE_ROOT and DONE_DONE_RUN_ID set by `done-done run upgrade`.
// Needs npm and the npm registry; writes upgrade.log plus everything e2e.mjs writes into DONE_DONE_EVIDENCE_ROOT.
import { execFileSync, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = process.cwd();
const OUT = process.env.DONE_DONE_EVIDENCE_ROOT;
if (!OUT || !(process.env.DONE_DONE_RUN_ID || process.argv[2])) {
  console.error('upgrade: DONE_DONE_EVIDENCE_ROOT and DONE_DONE_RUN_ID must be set (run via `done-done run upgrade`)');
  process.exit(2);
}
const log = [];
const say = (s) => { log.push(s); console.error(s); };
const tmp = mkdtempSync(join(tmpdir(), 'dd-upgrade-'));
const prefix = join(tmp, 'prefix');
const home = join(tmp, 'home');
const repo = join(tmp, 'repo');
const env = { ...process.env, DONE_DONE_HOME: home, npm_config_prefix: prefix, npm_config_cache: join(tmp, 'npm-cache'), npm_config_update_notifier: 'false', GIT_AUTHOR_NAME: 'e2e', GIT_AUTHOR_EMAIL: 'e2e@example.com', GIT_COMMITTER_NAME: 'e2e', GIT_COMMITTER_EMAIL: 'e2e@example.com' };
const run = (cmd, args, cwd = tmp) => {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
  say(`$ ${[cmd, ...args].join(' ')}\n${r.stdout}${r.stderr}\nexit: ${r.status}`);
  assert.equal(r.status, 0, r.error?.message || r.stdout + r.stderr);
  return r.stdout.trim();
};
const installed = join(prefix, 'bin', 'done-done');

let code = 1;
try {
  const current = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version;
  // The previous shipped version: the newest published one that is not this checkout's.
  const previous = JSON.parse(run('npm', ['view', 'done-done-axi', 'versions', '--json'])).filter((v) => /^\d+\.\d+\.\d+$/.test(v) && v !== current).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).at(-1);
  run('npm', ['install', '-g', `done-done-axi@${previous}`]);
  assert.equal(run(installed, ['--version']), previous, 'the previous release is what the user has');
  // The previous version sets up a repo the way a user did: its config and .done-done.yaml stay across the upgrade.
  mkdirSync(repo);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo, env });
  // No agent is set here, so init exits 2 after writing the config; the config is what the upgrade must keep.
  const init = spawnSync(installed, ['init', '--journey', 'home', '--', 'echo', 'home'], { cwd: repo, env, encoding: 'utf8' });
  say(`$ done-done init --journey home -- echo home   (done-done ${previous})\n${init.stdout}${init.stderr}\nexit: ${init.status}`);
  const before = readFileSync(join(repo, '.done-done.yaml'), 'utf8');
  // Upgrade in place: this checkout's package over the installed one, as `npm install -g done-done-axi@latest` does.
  const tarball = join(tmp, run('npm', ['pack', '--silent', '--pack-destination', tmp, REPO]).split('\n').at(-1));
  run('npm', ['install', '-g', tarball]);
  assert.equal(run(installed, ['--version']), current, 'the upgrade replaced the previous release in place');
  assert.equal(readFileSync(join(repo, '.done-done.yaml'), 'utf8'), before, 'the upgrade kept the repo config the previous release wrote');
  const doctor = JSON.parse(spawnSync(installed, ['--json', 'doctor'], { cwd: repo, env, encoding: 'utf8' }).stdout);
  assert.equal(doctor.checks.find((c) => c.check === 'config').status, 'ok', 'the upgraded release reads the config the previous release wrote');
  say(`doctor after the upgrade: ${doctor.checks.map((c) => `${c.check} ${c.status}`).join(', ')}`);
  // The core journey, driven with the upgraded binary.
  const cli = join(prefix, 'lib', 'node_modules', 'done-done-axi', 'dist', 'cli.js');
  const e2e = spawnSync(process.execPath, [join(REPO, 'journeys', 'e2e.mjs')], { cwd: REPO, env: { ...process.env, DONE_DONE_TEST_CLI: cli }, encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] });
  assert.equal(e2e.status, 0, 'the core journey passes on the upgraded install');
  say(`upgrade ${previous} -> ${current} in place, then the core journey (e2e) with ${cli}: pass`);
  // This run's step record, over the one the core journey wrote: the version upgraded to, and the state it started from.
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'steps.json'), JSON.stringify({
    target: { version: current },
    start: `done-done-axi ${previous} installed from npm, with its config and a repo .done-done.yaml written by that version`,
    steps: [`install this checkout over ${previous} in place`, 'run the core journey with the upgraded binary'],
    result: `done-done-axi ${current} runs the core journey after the upgrade in place`,
  }));
  code = 0;
} catch (e) {
  say(`FAIL: ${e.message}`);
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'upgrade.log'), `${log.join('\n')}\n`);
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(code);
