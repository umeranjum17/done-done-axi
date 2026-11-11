#!/usr/bin/env node
// QA planning proof: `done-done qa` plans a journey for a new user-visible command and marks a fixture refactor and an internal change no-test.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const evidence = process.env.DONE_DONE_EVIDENCE_ROOT;
if (!evidence) throw new Error('missing DONE_DONE_EVIDENCE_ROOT');
const cli = join(process.cwd(), 'dist/cli.js');
const scratch = mkdtempSync(join(tmpdir(), 'qa-plan-'));
const env = { ...process.env, HOME: scratch, DONE_DONE_HOME: join(scratch, 'dd-home'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Umer', GIT_AUTHOR_EMAIL: 'umer@example.com', GIT_COMMITTER_NAME: 'Umer', GIT_COMMITTER_EMAIL: 'umer@example.com' };
delete env.DONE_DONE_DRIVE;
let log = '';
const sh = (cwd, cmd, ...args) => {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
  if (r.status !== 0 && cmd === 'git') throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r;
};

// A tiny tool repo with a CLI, a fixture and a journey; each case commits one change on a branch and plans it.
function plan(name, feature, change) {
  const dir = join(scratch, name);
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'test/fixtures'), { recursive: true });
  writeFileSync(join(dir, '.done-done.yaml'), `app: ${name}\njourneys:\n  smoke:\n    command: node src/cli.js\n`);
  writeFileSync(join(dir, 'src/cli.js'), "export const usage = { usage: [['tool run', 'run it']] };\nif (cmd === 'run') run();\n");
  writeFileSync(join(dir, 'src/util.js'), 'export const add = (a, b) => a + b;\n');
  writeFileSync(join(dir, 'test/fixtures/sample.json'), '{"a":1}\n');
  sh(dir, 'git', 'init', '-q', '-b', 'main');
  sh(dir, 'git', 'add', '-A');
  sh(dir, 'git', 'commit', '-qm', 'base');
  sh(dir, 'git', 'checkout', '-qb', 'feat');
  change(dir);
  sh(dir, 'git', 'add', '-A');
  sh(dir, 'git', 'commit', '-qm', 'change');
  const r = sh(dir, 'node', cli, '--json', 'qa', feature, 'main');
  log += `\n=== ${name}: done-done qa "${feature}" main (exit ${r.status}) ===\n${r.stdout}${r.stderr}`;
  if (r.status !== 0) throw new Error(`${name}: qa exited ${r.status}`);
  const out = JSON.parse(r.stdout);
  const record = JSON.parse(readFileSync(out.record.startsWith('/') ? out.record : join(dir, out.record), 'utf8'));
  if (out.stage !== 'planned' || record.stage !== 'planned' || !out.reason || record.reason !== out.reason) throw new Error(`${name}: stage planned and the reason were not recorded`);
  return out;
}

const cases = [
  ['new-command', 'tool export command', (d) => writeFileSync(join(d, 'src/cli.js'), "export const usage = { usage: [['tool run', 'run it'], ['tool export', 'export it']] };\nif (cmd === 'run') run();\nif (cmd === 'export') exportIt();\n"), 'journey'],
  ['fixture-refactor', 'tidy sample fixture', (d) => writeFileSync(join(d, 'test/fixtures/sample.json'), '{\n  "a": 1\n}\n'), 'no-test'],
  ['internal-change', 'rename add helper internals', (d) => writeFileSync(join(d, 'src/util.js'), 'export const add = (x, y) => x + y;\n'), 'no-test'],
];
try {
  for (const [name, feature, change, want] of cases) {
    const out = plan(name, feature, change);
    if (out.plan !== want) throw new Error(`${name}: planned ${out.plan}, wanted ${want}: ${out.reason}`);
    if (want === 'journey' && !out.journeys?.includes('smoke')) throw new Error(`${name}: the plan names no journey to run`);
    log += `-> ${name}: ${out.plan} (${out.reason})\n`;
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
writeFileSync(join(evidence, 'qa-plan.log'), log);
writeFileSync(join(evidence, 'steps.json'), JSON.stringify({
  target: { version: JSON.parse(readFileSync('package.json', 'utf8')).version },
  start: 'three throwaway repos, each a base commit and one changed commit on a branch',
  steps: [
    'Commit a new `tool export` command (usage row and dispatch) and run `done-done qa "tool export command" main`',
    'Commit a reformatted test fixture and run `done-done qa "tidy sample fixture" main`',
    'Commit a renamed internal helper and run `done-done qa "rename add helper internals" main`',
  ],
  result: 'the new command is planned as a journey naming smoke; the fixture refactor and the internal change are no-test; each plan records stage planned and its reason',
}, null, 2));
console.log(log);
