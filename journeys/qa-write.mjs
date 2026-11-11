#!/usr/bin/env node
// QA writing proof: `done-done qa --write` adds one journey and config entry for a new command, adds nothing on a second run,
// and writes no file for a refactor. A stub agent answers `journey add`, so the proof needs no model and spends nothing.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const evidence = process.env.DONE_DONE_EVIDENCE_ROOT;
if (!evidence) throw new Error('missing DONE_DONE_EVIDENCE_ROOT');
const cli = join(process.cwd(), 'dist/cli.js');
const scratch = mkdtempSync(join(tmpdir(), 'qa-write-'));
const bin = join(scratch, 'bin'), ddHome = join(scratch, 'dd-home');
mkdirSync(bin); mkdirSync(ddHome);
const env = { ...process.env, HOME: scratch, DONE_DONE_HOME: ddHome, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Umer', GIT_AUTHOR_EMAIL: 'umer@example.com', GIT_COMMITTER_NAME: 'Umer', GIT_COMMITTER_EMAIL: 'umer@example.com' };
for (const k of ['DONE_DONE_DRIVE', 'DONE_DONE_RUN_ID', 'DONE_DONE_EVIDENCE_ROOT', 'CI']) delete env[k];

// The stub agent: the `claude` binary journey add runs, answering with a fixed journey for the new `export` command.
const script = `import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const out = execFileSync(process.execPath, ['src/cli.js', 'export'], { encoding: 'utf8' });
assert.equal(out, 'exported\\n');
writeFileSync(join(process.env.DONE_DONE_EVIDENCE_ROOT, 'export.txt'), out);
writeFileSync(join(process.env.DONE_DONE_EVIDENCE_ROOT, 'steps.json'), JSON.stringify({ target: { version: '1' }, start: 'fresh tool', steps: ['run tool export'], result: out }));
`;
const answer = { name: 'tool-export', title: 'Tool export', source: 'src/cli.js', script, checks: 'tool export prints exported.', spends: '', blocker: '' };
writeFileSync(join(bin, 'claude'), `#!${process.execPath}\nrequire('node:fs').readFileSync(0);\nprocess.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: '', structured_output: ${JSON.stringify(answer)} }));\n`, { mode: 0o755 });
writeFileSync(join(ddHome, 'config.yaml'), `agent: claude\nagent_path_override: { claude: ${JSON.stringify(join(bin, 'claude'))} }\n`);

let log = '';
const run = (cwd, cmd, ...args) => {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
  if (cmd === 'git' && r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r;
};
const qa = (dir, label, feature) => {
  const r = run(dir, 'node', cli, '--json', 'qa', feature, 'main', '--write');
  log += `\n=== ${label}: done-done qa "${feature}" main --write (exit ${r.status}) ===\n${r.stdout}${r.stderr}`;
  if (r.status !== 0) throw new Error(`${label}: qa --write exited ${r.status}`);
  return JSON.parse(r.stdout);
};
const files = (dir) => readdirSync(join(dir, 'journeys')).sort();
const journeys = (dir) => [...readFileSync(join(dir, '.done-done.yaml'), 'utf8').matchAll(/^ {2}([\w-]+):\s*$/gm)].map((m) => m[1]);

// A tool repo with a verify skill and no journeys, plus one committed change on a branch.
function repo(name, base, change) {
  const dir = join(scratch, name);
  const skill = join(dir, '.agents/skills/done-done-verify-tool');
  for (const d of ["src", "journeys", "test/fixtures"]) mkdirSync(join(dir, d), { recursive: true });
  mkdirSync(join(skill, "features"), { recursive: true });
  writeFileSync(join(dir, '.done-done.yaml'), 'app: tool\n');
  writeFileSync(join(skill, 'SKILL.md'), '# Tool CLI\n\nLaunch: node src/cli.js run\n');
  writeFileSync(join(skill, 'features/README.md'), '# Features\n');
  writeFileSync(join(dir, 'journeys/.keep'), '');
  writeFileSync(join(dir, 'src/cli.js'), "const cmd = process.argv[2];\nif (cmd === 'run') console.log('ran');\n");
  writeFileSync(join(dir, 'test/fixtures/sample.json'), '{"a":1}\n');
  run(dir, 'git', 'init', '-q', '-b', 'main'); run(dir, 'git', 'add', '-A'); run(dir, 'git', 'commit', '-qm', 'base');
  run(dir, 'git', 'checkout', '-qb', 'feat');
  change(dir);
  run(dir, 'git', 'add', '-A'); run(dir, 'git', 'commit', '-qm', 'change');
  return dir;
}

try {
  const cmd = repo('new-command', 0, (d) => writeFileSync(join(d, 'src/cli.js'), "const cmd = process.argv[2];\nif (cmd === 'run') console.log('ran');\nif (cmd === 'export') console.log('exported');\n"));
  const first = qa(cmd, 'new command', 'tool export command');
  if (first.stage !== 'writing' || first.write?.action !== 'add' || first.write.journey !== 'tool-export') throw new Error(`new command: wanted an added tool-export journey, got ${JSON.stringify(first.write)}`);
  if (!files(cmd).includes('tool-export.mjs') || files(cmd).length !== 2) throw new Error(`new command: wanted exactly one journey file, got ${files(cmd)}`);
  if (journeys(cmd).join() !== 'tool-export') throw new Error(`new command: wanted one config entry, got ${journeys(cmd)}`);
  run(cmd, 'git', 'add', '-A'); run(cmd, 'git', 'commit', '-qm', 'tool-export journey');
  const before = { files: files(cmd), config: readFileSync(join(cmd, '.done-done.yaml'), 'utf8') };
  const second = qa(cmd, 'second run', 'tool export command');
  if (second.write?.action !== 'none' || second.write.journey !== 'tool-export') throw new Error(`second run: wanted nothing written, got ${JSON.stringify(second.write)}`);
  if (files(cmd).join() !== before.files.join() || readFileSync(join(cmd, '.done-done.yaml'), 'utf8') !== before.config || run(cmd, 'git', 'status', '--porcelain').stdout.trim()) throw new Error('second run: files or config changed');
  log += `-> new command: ${first.write.action} ${first.write.journey}; second run: ${second.write.action} (${second.write.reason})\n`;

  const refactor = repo('refactor', 0, (d) => writeFileSync(join(d, 'test/fixtures/sample.json'), '{\n  "a": 1\n}\n'));
  const third = qa(refactor, 'refactor', 'tidy sample fixture');
  if (third.plan !== 'no-test' || third.write?.action !== 'none') throw new Error(`refactor: wanted no-test and nothing written, got ${JSON.stringify(third)}`);
  if (files(refactor).length !== 1 || journeys(refactor).length || run(refactor, 'git', 'status', '--porcelain').stdout.trim()) throw new Error('refactor: a file was written');
  log += `-> refactor: ${third.plan}, write ${third.write.action} (${third.write.reason})\n`;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
writeFileSync(join(evidence, 'qa-write.log'), log);
writeFileSync(join(evidence, 'steps.json'), JSON.stringify({
  target: { version: JSON.parse(readFileSync('package.json', 'utf8')).version },
  start: 'two throwaway tool repos with a verify skill and no journeys, a stub agent answering journey add; each commits one change on a branch',
  steps: [
    'Commit a new `tool export` command and run `done-done qa "tool export command" main --write`',
    'Commit the written journey and run the same qa --write again',
    'Commit a reformatted test fixture and run `done-done qa "tidy sample fixture" main --write`',
  ],
  result: 'the new command gets one journey file and one config entry; the second run writes nothing; the fixture refactor gets no file',
}, null, 2));
console.log(log);
