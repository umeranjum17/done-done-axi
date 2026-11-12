#!/usr/bin/env node
// Registered script proof (Q6): `journey improve` rewrites a journey whose command runs a registered test script
// (`node test/export.test.mjs`) in place, keep the command, update the hash so lint passes, and name the file.
// A stub agent answers, so the proof needs no model and spends nothing.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const evidence = process.env.DONE_DONE_EVIDENCE_ROOT;
if (!evidence) throw new Error('missing DONE_DONE_EVIDENCE_ROOT');
const cli = join(process.cwd(), 'dist/cli.js');
const scratch = mkdtempSync(join(tmpdir(), 'registered-script-'));
const bin = join(scratch, 'bin'), ddHome = join(scratch, 'dd-home'), repo = join(scratch, 'tool'), proof = join(scratch, 'proof');
for (const d of [bin, ddHome, join(repo, 'src'), join(repo, 'test'), join(repo, '.agents/skills/done-done-verify-tool/features'), proof]) mkdirSync(d, { recursive: true });
const gitConfig = join(scratch, 'gitconfig');
writeFileSync(gitConfig, '');
const host = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_CONFIG')));
const env = { ...host, HOME: scratch, DONE_DONE_HOME: ddHome, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Umer', GIT_AUTHOR_EMAIL: 'umer@example.com', GIT_COMMITTER_NAME: 'Umer', GIT_COMMITTER_EMAIL: 'Umer@example.com' };
for (const k of ['DONE_DONE_DRIVE', 'DONE_DONE_RUN_ID', 'DONE_DONE_EVIDENCE_ROOT', 'CI']) delete env[k];
const sh = (cmd, ...args) => spawnSync(cmd, args, { cwd: repo, env, encoding: 'utf8' });
const git = (...a) => { const r = sh('git', ...a); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
let log = '';
const dd = (code, ...args) => {
  const r = sh(process.execPath, cli, ...args);
  log += `$ done-done ${args.join(' ')}\n${r.stdout}${r.stderr}exit ${r.status}\n\n`;
  assert.equal(r.status, code, `done-done ${args.join(' ')}: ${r.stdout}${r.stderr}`);
  return r;
};

const entry = 'test/export.test.mjs';
const body = (extra) => `import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cli } from '../src/cli.js';
const out = cli('run');
assert.equal(out, 'ran\\n');${extra}
writeFileSync(join(process.env.DONE_DONE_EVIDENCE_ROOT, 'run.txt'), out);
`;
const extra = "\nassert.equal(cli('export'), 'exported\\n');";
const answer = (script) => ({ name: 'tool-run', title: 'Tool run', source: 'src/cli.js', script, checks: 'tool run prints ran; tool export prints exported.', spends: '', blocker: '' });
const stub = (script) => writeFileSync(join(bin, 'claude'), `#!${process.execPath}\nrequire('node:fs').readFileSync(0);\nprocess.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: '', structured_output: ${JSON.stringify(answer(script))} }));\n`, { mode: 0o755 });

try {
  writeFileSync(join(ddHome, 'config.yaml'), `agent: claude\nagent_path_override: { claude: ${JSON.stringify(join(bin, 'claude'))} }\n`);
  writeFileSync(join(repo, '.done-done.yaml'), `app: tool\nevidence:\n  root: ${JSON.stringify(proof)}\njourneys:\n  tool-run:\n    command: node ${entry}\n`);
  writeFileSync(join(repo, '.agents/skills/done-done-verify-tool/SKILL.md'), '# Tool CLI\n\nLaunch: node src/cli.js run\n');
  writeFileSync(join(repo, '.agents/skills/done-done-verify-tool/features/README.md'), '# Features\n- [Tool run](tool-run.md): run `done-done run tool-run`\n');
  writeFileSync(join(repo, '.agents/skills/done-done-verify-tool/features/tool-run.md'), '# Tool run\n\nSource: `src/cli.js`. Run `done-done run tool-run`.\n');
  writeFileSync(join(repo, 'src/cli.js'), "export const cli = (cmd) => {\n  if (cmd === 'run') return 'ran\\n';\n  if (cmd === 'export') return 'exported\\n';\n};\n");
  writeFileSync(join(repo, entry), body(''));
  git('init', '-q', '-b', 'main'); git('add', '-A'); git('commit', '-qm', 'base');
  // inventory record is run-only, so the registered entry is committed with its hash directly
  const sha = createHash('sha256').update(readFileSync(join(repo, entry))).digest('hex');
  writeFileSync(join(repo, '.done-done-inventory.json'), JSON.stringify({ [entry]: { owner: 'tool-run', sha256: sha } }));
  const report = join(scratch, 'report.md');
  writeFileSync(report, '## Checks\noutcome: a registered script is updated through journey improve\nrepro: n/a: no bug\nproof: done-done-verify-tool: done-done run tool-run\nevidence: not proven: fixture\n');
  git('add', '-A'); git('commit', '-qm', 'register the test script');
  const lint = () => dd(0, 'lint', report, proof);

  stub(body(extra));
  const improved = dd(0, '--json', 'journey', 'improve', 'tool-run', 'also check that tool export prints exported');
  assert.equal(JSON.parse(improved.stdout).dirty, true);
  assert.ok(improved.stderr.startsWith(`Stage writing: ${entry}\n`), 'the run shows writing and names the registered script');
  assert.match(readFileSync(join(repo, entry), 'utf8'), /'export'/, 'the registered script was rewritten in place');
  assert.match(readFileSync(join(repo, '.done-done.yaml'), 'utf8'), /command:[\s\S]*node test\/export\.test\.mjs\n/, 'the command is kept');
  assert.throws(() => readFileSync(join(repo, 'journeys/tool-run.mjs')), 'no second script is written');
  const after = JSON.parse(readFileSync(join(repo, '.done-done-inventory.json'), 'utf8'))[entry].sha256;
  assert.equal(after, createHash('sha256').update(readFileSync(join(repo, entry))).digest('hex'), 'the hash follows the rewritten script');
  lint();
  git('add', '-A'); git('commit', '-qm', 'improve registered script');

  mkdirSync(evidence, { recursive: true });
  writeFileSync(join(evidence, 'registered-script.log'), log);
  writeFileSync(join(evidence, 'steps.json'), JSON.stringify({
    target: { version: JSON.parse(readFileSync('package.json', 'utf8')).version },
    start: 'a throwaway repo whose journey runs the registered test script test/export.test.mjs, with a stub agent',
    steps: ['run done-done journey improve on the journey', 'run done-done lint'],
    result: `improve rewrote ${entry} in place, kept the command and updated the hash, lint passed; the run showed Stage writing and named it`,
  }, null, 2));
  console.log(log);
} finally {
  if (!process.env.KEEP) rmSync(scratch, { recursive: true, force: true });
}
