#!/usr/bin/env node
// base-ref-verify journey: `done-done verify` with base_ref in a throwaway npm app whose build imports a locally installed package.
// Scenario 1: base_ref main is driven beside the head; the head and before captures both exist and the run record has no base.error.
// Scenario 2: base_install is a failing command; base.error names its cause and the head drive still writes its capture.
// Stub judge and stub agent (the agent must never start). No model, no network: npm installs only a local file: package.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const evidence = process.env.DONE_DONE_EVIDENCE_ROOT;
if (!evidence) throw new Error('missing DONE_DONE_EVIDENCE_ROOT');
const cli = join(process.cwd(), 'dist/cli.js');
const scratch = mkdtempSync(join(tmpdir(), 'base-ref-verify-'));
const ddHome = join(scratch, 'dd-home');
const bin = join(scratch, 'bin');
mkdirSync(ddHome, { recursive: true });
mkdirSync(bin, { recursive: true });
writeFileSync(join(scratch, 'gitconfig'), '');
writeFileSync(join(scratch, 'npmrc'), '');
// The children get the host PATH and locale only: no credentials, and no done-done, git or npm settings from this shell.
const host = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/TOKEN|SECRET|PASSWORD|KEY|CREDENTIAL|AUTH|^DONE_DONE_|^GIT_CONFIG|^npm_config_/i.test(k)));
const env = {
  ...host,
  HOME: scratch,
  DONE_DONE_HOME: ddHome,
  GIT_CONFIG_GLOBAL: join(scratch, 'gitconfig'),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Umer', GIT_AUTHOR_EMAIL: 'umer@example.com',
  GIT_COMMITTER_NAME: 'Umer', GIT_COMMITTER_EMAIL: 'umer@example.com',
  npm_config_cache: join(scratch, 'npm-cache'),
  npm_config_userconfig: join(scratch, 'npmrc'),
  npm_config_update_notifier: 'false',
  npm_config_fund: 'false',
  npm_config_audit: 'false',
};

// Stub judge: says every capture shows the outcome. Stub agent: review is off, so it must never start.
const verdict = { probabilities: { correct: 0.95, wrong: 0.03, unclear: 0.02 }, rationale: 'The capture shows the outcome.', personReason: 'The capture shows the outcome.', parts: [], covers: [] };
const judge = join(bin, 'judge-gemini');
writeFileSync(judge, `#!${process.execPath}\nconst input = require('node:fs').readFileSync(0, 'utf8');\nconst keys = [...new Set([...input.matchAll(/capture_\\d+/g)].map((m) => m[0]))];\nconst v = ${JSON.stringify(verdict)};\nprocess.stdout.write(JSON.stringify({ response: JSON.stringify(keys.length ? Object.fromEntries(keys.map((k) => [k, v])) : { relevance: v }) }));\n`, { mode: 0o755 });
const agent = join(bin, 'agent-opencode');
writeFileSync(agent, `#!${process.execPath}\nconsole.error('the agent must not start: review is off');\nprocess.exit(1);\n`, { mode: 0o755 });
writeFileSync(join(ddHome, 'config.yaml'), `agent: opencode\nreview_enabled: false\nagent_path_override: { opencode: ${JSON.stringify(agent)}, gemini: ${JSON.stringify(judge)} }\njudge:\n  route: answerer:gemini\n  model: stub-judge\n`);

const write = (dir, files) => {
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(join(dir, p, '..'), { recursive: true });
    writeFileSync(join(dir, p), text);
  }
};

// The journey: builds the app (which imports the installed package) and drives the built app; it writes its capture into the run folder.
const greet = [
  "import assert from 'node:assert/strict';",
  "import { execFileSync, spawnSync } from 'node:child_process';",
  "import { writeFileSync } from 'node:fs';",
  "import { join } from 'node:path';",
  "const build = spawnSync('npm', ['run', 'build'], { encoding: 'utf8' });",
  "if (build.status !== 0) throw new Error('npm run build failed: ' + build.stdout + build.stderr);",
  "const out = execFileSync(process.execPath, ['dist/app.js'], { encoding: 'utf8' });",
  "assert.match(out, /^BANNER-hello from /);",
  "const dir = process.env.DONE_DONE_EVIDENCE_ROOT;",
  "writeFileSync(join(dir, 'greet.txt'), out);",
  "writeFileSync(join(dir, 'steps.json'), JSON.stringify({ target: { version: '1' }, start: 'a fresh app with tiny-banner installed', steps: ['run the app that the build produced'], result: out.trim() }));",
  '',
].join('\n');

const mainFiles = {
  '.gitignore': 'node_modules/\ndist/\n.proof/\npackage-lock.json\n',
  '.done-done.yaml': 'app: base-ref-app\nevidence:\n  root: .proof\njourneys:\n  greet:\n    command: node journeys/greet.mjs\n',
  '.agents/skills/done-done-verify-base-ref-app/SKILL.md': '# base-ref-app\n\nLaunch: npm run build, then node dist/app.js\n',
  '.agents/skills/done-done-verify-base-ref-app/features/README.md': '# Features\n\n- [Greet](greet.md): run `done-done verify greet`\n',
  'package.json': JSON.stringify({ name: 'base-ref-app', private: true, type: 'module', scripts: { build: 'node build.mjs' }, dependencies: { 'tiny-banner': 'file:vendor/tiny-banner' } }, null, 2) + '\n',
  'build.mjs': "import { mkdirSync, writeFileSync } from 'node:fs';\nimport { banner } from 'tiny-banner';\nimport { greeting } from './src/greet.mjs';\nmkdirSync('dist', { recursive: true });\nwriteFileSync('dist/app.js', 'console.log(' + JSON.stringify(banner(greeting)) + ');\\n');\n",
  'vendor/tiny-banner/package.json': JSON.stringify({ name: 'tiny-banner', version: '1.0.0', type: 'module', main: 'index.js' }, null, 2) + '\n',
  'vendor/tiny-banner/index.js': "export const banner = (text) => 'BANNER-' + text;\n",
  'src/greet.mjs': "export const greeting = 'hello from base';\n",
  'journeys/greet.mjs': greet,
};
const headConfig = (extra) => `app: base-ref-app\nevidence:\n  root: .proof\nbase_ref: main\n${extra}journeys:\n  greet:\n    command: node journeys/greet.mjs\n`;

let log = '';
const run = (label, cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
  log += `\n=== ${label} (exit ${r.status}) ===\n${r.stdout}${r.stderr}`;
  return r;
};
const git = (repo, ...args) => {
  const r = spawnSync('git', args, { cwd: repo, env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

// main holds the app with the installed package; feat changes the greeting and sets base_ref (and optionally base_install).
function buildRepo(name, extra) {
  const repo = join(scratch, name);
  write(repo, mainFiles);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base app');
  const install = run(`${name}: npm install of the file: package`, 'npm', ['install'], repo);
  assert.equal(install.status, 0, `npm install failed: ${install.stderr}`);
  assert.match(readFileSync(join(repo, 'node_modules/tiny-banner/index.js'), 'utf8'), /BANNER-/, 'the package is installed');
  git(repo, 'checkout', '-qb', 'feat');
  write(repo, { 'src/greet.mjs': "export const greeting = 'hello from head';\n", '.done-done.yaml': headConfig(extra) });
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'feature: greet from head');
  return repo;
}

// One `done-done verify greet` with base_ref; returns its exit, run folder and run record.
function verify(name, repo) {
  const r = run(`${name}: done-done verify greet`, process.execPath, [cli, '--json', 'verify', 'greet', '--outcome', 'the app greets from the head with the installed package', '--foreground'], repo);
  let out;
  try {
    out = JSON.parse(r.stdout);
  } catch {
    throw new Error(`verify printed no JSON (exit ${r.status}): ${r.stdout}${r.stderr}`);
  }
  const runDir = join(repo, '.proof', out.run_id);
  const record = JSON.parse(readFileSync(join(repo, '.proof', '.done-done', 'runs', `${out.run_id}.json`), 'utf8'));
  return { status: r.status, runDir, record };
}

try {
  // Scenario 1: the base ref is driven beside the head.
  const pair = buildRepo('pair', '');
  const ok = verify('pair', pair);
  assert.equal(ok.status, 0, `verify with base_ref should exit 0\n${log}`);
  assert.equal(ok.record.base?.ref, 'main');
  assert.match(ok.record.base?.commit ?? '', /^[0-9a-f]{40}$/, 'the base commit is recorded');
  assert.equal(ok.record.base?.error, undefined, 'base.error is absent');
  const headCapture = readFileSync(join(ok.runDir, 'greet.txt'), 'utf8');
  const baseCapture = readFileSync(join(ok.runDir, 'before', 'greet.txt'), 'utf8');
  assert.equal(headCapture, 'BANNER-hello from head\n', 'the head capture');
  assert.equal(baseCapture, 'BANNER-hello from base\n', 'the before capture');

  // Scenario 2: a failing base install names its cause; the head drive still writes its capture.
  const broken = buildRepo('install-fails', 'base_install: "echo cause-marker-47 >&2; exit 3"\n');
  const failed = verify('install-fails', broken);
  const cause = failed.record.base?.error ?? '';
  assert.match(cause, /base install \(echo cause-marker-47 >&2; exit 3\) failed: exit 3: cause-marker-47/, `base.error names the cause: ${cause}`);
  assert.equal(readFileSync(join(failed.runDir, 'greet.txt'), 'utf8'), 'BANNER-hello from head\n', 'the head drive still wrote its capture');
  assert.equal(existsSync(join(failed.runDir, 'before', 'greet.txt')), false, 'no base capture was written');

  // Captures of the resulting state, and the step record, into the evidence root.
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  mkdirSync(join(evidence, 'before'), { recursive: true });
  writeFileSync(join(evidence, 'greet.txt'), headCapture);
  writeFileSync(join(evidence, 'before', 'greet.txt'), baseCapture);
  writeFileSync(join(evidence, 'base-error.txt'), `${cause}\n`);
  writeFileSync(join(evidence, 'base-ref-verify.log'), log);
  writeFileSync(join(evidence, 'steps.json'), JSON.stringify({
    target: { version: pkg.version },
    start: 'a throwaway npm app whose build imports a locally installed package; feat changes the greeting and main is base_ref',
    steps: [
      'commit a throwaway npm app whose build imports the installed tiny-banner package, on main',
      'change the greeting on feat, set base_ref to main, and run done-done verify greet',
      'read the run record: base ref main, no base.error, and the head and before greet.txt captures',
      'set base_install to a failing command, run done-done verify greet again, and read base.error',
    ],
    result: 'the head and before captures both exist and base.error is absent; with the failing base_install, base.error reads the install failure with its cause (cause-marker-47) and the head capture still exists',
  }, null, 2) + '\n');
  console.log(log);
} catch (e) {
  console.error(log);
  throw e;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
