#!/usr/bin/env node
// Affected journey selection proof: `done-done affected` follows shell sources, imports and path calls from a journey's command to a changed file,
// and sends an unknown file or a configured global file to the whole local tier, each with its reason.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const evidence = process.env.DONE_DONE_EVIDENCE_ROOT;
if (!evidence) throw new Error('missing DONE_DONE_EVIDENCE_ROOT');
const cli = join(process.cwd(), 'dist/cli.js');
const scratch = mkdtempSync(join(tmpdir(), 'affected-select-'));
const env = { ...process.env, HOME: scratch, DONE_DONE_HOME: join(scratch, 'dd-home'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Umer', GIT_AUTHOR_EMAIL: 'umer@example.com', GIT_COMMITTER_NAME: 'Umer', GIT_COMMITTER_EMAIL: 'umer@example.com' };
delete env.DONE_DONE_DRIVE;
let log = '';
const sh = (cwd, cmd, ...args) => {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
  if (r.status !== 0 && cmd === 'git') throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r;
};

// A tiny repo: app-check runs a shell script that sources a helper, which runs a node tool that imports a util and calls a fixture folder by path.
const files = {
  '.done-done.yaml': 'app: fixture\naffected:\n  global_paths: ["package.json"]\njourneys:\n  app-check:\n    command: sh scripts/run.sh\n    tier: ci\n  local-a:\n    command: node local/a.mjs\n    tier: local\n  local-b:\n    command: node local/b.mjs\n    tier: local\n',
  'scripts/run.sh': '. ./lib.sh\ncheck\n',
  'scripts/lib.sh': 'check() { node tools/check.mjs; }\n',
  'tools/check.mjs': "import { add } from './util.mjs';\nimport { readdirSync } from 'node:fs';\nconsole.log(add(1, 2), readdirSync('fixtures/data'));\n",
  'tools/util.mjs': 'export const add = (a, b) => a + b;\n',
  'fixtures/data/one.json': '{"a":1}\n',
  'local/a.mjs': 'console.log("a");\n',
  'local/b.mjs': 'console.log("b");\n',
  'notes/stray.txt': 'scratch\n',
  'package.json': '{"name":"fixture"}\n',
};

function select(name, change) {
  const dir = join(scratch, name);
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), text);
  }
  sh(dir, 'git', 'init', '-q', '-b', 'main');
  sh(dir, 'git', 'add', '-A');
  sh(dir, 'git', 'commit', '-qm', 'base');
  sh(dir, 'git', 'checkout', '-qb', 'feat');
  writeFileSync(join(dir, change), `${files[change]}// changed\n`);
  sh(dir, 'git', 'add', '-A');
  sh(dir, 'git', 'commit', '-qm', 'change');
  const r = sh(dir, 'node', cli, '--json', 'affected', 'main');
  log += `\n=== ${name}: done-done affected main after changing ${change} (exit ${r.status}) ===\n${r.stdout}${r.stderr}`;
  const out = JSON.parse(r.stdout);
  return out;
}

const names = (out) => out.journeys.map((j) => j.name).sort().join(',');
const cases = [
  // Three hops: run.sh sources lib.sh, which runs check.mjs, which imports util.mjs.
  ['import-chain', 'tools/util.mjs', (o) => names(o) === 'app-check' && o.journeys[0].why.includes('scripts/run.sh -> scripts/lib.sh -> tools/check.mjs -> tools/util.mjs') && !o.fallback],
  ['path-call', 'fixtures/data/one.json', (o) => names(o) === 'app-check' && o.journeys[0].why.includes('tools/check.mjs -> fixtures/data/') && !o.fallback],
  ['unknown-file', 'notes/stray.txt', (o) => names(o) === 'local-a,local-b' && o.journeys.every((j) => j.why.includes('whole local tier') && j.why.includes('1 changed file is in no feature or journey')) && o.fallback.endsWith('so the whole local tier runs')],
  ['global-file', 'package.json', (o) => names(o) === 'local-a,local-b' && o.journeys.every((j) => j.why.includes('a global file changed (package.json)')) && o.fallback.includes('a global file changed')],
];
try {
  for (const [name, change, ok] of cases) {
    const out = select(name, change);
    if (!ok(out)) throw new Error(`${name}: changing ${change} selected the wrong journeys: ${JSON.stringify(out.journeys)} fallback=${out.fallback}`);
    log += `-> ${name}: ${names(out)} (${out.journeys[0].why})\n`;
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
writeFileSync(join(evidence, 'affected-select.log'), log);
writeFileSync(join(evidence, 'steps.json'), JSON.stringify({
  target: { version: JSON.parse(readFileSync('package.json', 'utf8')).version },
  start: 'four throwaway repos, each a base commit and one changed commit on a branch; app-check (tier ci) runs a shell script that sources a helper, which runs a node tool that imports a util and reads a fixture folder; local-a and local-b are tier local',
  steps: [
    'Change tools/util.mjs (three hops from the command) and run `done-done affected main`',
    'Change fixtures/data/one.json (read by path from the tool) and run `done-done affected main`',
    'Change notes/stray.txt (in no journey or feature) and run `done-done affected main`',
    'Change package.json (configured in affected.global_paths) and run `done-done affected main`',
  ],
  result: 'the source dependency selects app-check with its chain as the reason; the unknown file and the global file each select the whole local tier (local-a, local-b) with the reason',
}, null, 2));
console.log(log);
