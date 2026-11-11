#!/usr/bin/env node
// Minimum journey scope: `done-done verify --journeys <list> --named-by <who>` drives only the journeys the caller names. A three-journey
// fixture, a one-journey list: that journey runs, the receipt records the list, who named it and the two journeys not run (both selected
// by `affected`), and `affected` still exits 1 because the receipt does not cover them. Stub judge: no model, no spend.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const evidence = process.env.DONE_DONE_EVIDENCE_ROOT;
if (!evidence) throw new Error('missing DONE_DONE_EVIDENCE_ROOT');
const cli = join(process.cwd(), 'dist/cli.js');
const scratch = mkdtempSync(join(tmpdir(), 'minimum-scope-'));
const bin = join(scratch, 'bin'), ddHome = join(scratch, 'dd-home');
mkdirSync(bin); mkdirSync(ddHome);
const env = { ...process.env, HOME: scratch, DONE_DONE_HOME: ddHome, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Umer', GIT_AUTHOR_EMAIL: 'umer@example.com', GIT_COMMITTER_NAME: 'Umer', GIT_COMMITTER_EMAIL: 'umer@example.com' };

// The stub judge says every capture shows the outcome.
const judge = join(bin, 'judge-gemini');
const verdict = { probabilities: { correct: 0.95, wrong: 0.03, unclear: 0.02 }, rationale: 'The capture shows the outcome.', personReason: 'The capture shows the outcome.', parts: [], covers: [] };
writeFileSync(judge, `#!${process.execPath}\nconst input = require('node:fs').readFileSync(0, 'utf8');\nconst keys = [...new Set([...input.matchAll(/capture_\\d+/g)].map((m) => m[0]))];\nconst v = ${JSON.stringify(verdict)};\nprocess.stdout.write(JSON.stringify({ response: JSON.stringify(keys.length ? Object.fromEntries(keys.map((k) => [k, v])) : { relevance: v }) }));\n`, { mode: 0o755 });
writeFileSync(join(ddHome, 'config.yaml'), `agent_path_override: { gemini: ${JSON.stringify(judge)} }\njudge:\n  route: answerer:gemini\n  model: stub-judge\n`);
// Three journeys that all run the one file this commit changes, so `affected` selects all three.
const driver = `import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { greet } from '../src/app.js';
const name = process.argv[2];
const out = greet(name);
assert.equal(out, 'hello ' + name);
writeFileSync(join(process.env.DONE_DONE_EVIDENCE_ROOT, name + '.txt'), out + '\\n');
writeFileSync(join(process.env.DONE_DONE_EVIDENCE_ROOT, 'steps.json'), JSON.stringify({ target: { version: '1' }, start: 'fresh app', steps: ['greet ' + name], result: 'greet prints hello ' + name }));
`;
const dir = join(scratch, 'app');
const skill = join(dir, '.agents/skills/done-done-verify-app');
for (const d of ['src', 'journeys']) mkdirSync(join(dir, d), { recursive: true });
mkdirSync(join(skill, 'features'), { recursive: true });
const names = ['greet-ann', 'greet-bob', 'greet-cy'];
writeFileSync(join(dir, '.done-done.yaml'), `app: app\nevidence:\n  root: .proof\njourneys:\n${names.map((n) => `  ${n}:\n    command: node journeys/drive.mjs ${n}\n`).join('')}`);
writeFileSync(join(dir, '.gitignore'), '.proof/\n');
writeFileSync(join(skill, 'SKILL.md'), '# App\n\nLaunch: node journeys/drive.mjs <name>\n');
writeFileSync(join(skill, 'features/README.md'), '# Features\n');
writeFileSync(join(dir, 'journeys/drive.mjs'), driver);
writeFileSync(join(dir, 'src/app.js'), "export const greet = (n) => 'hello ' + n;\n");
let log = '';
const run = (cmd, ...args) => {
  const r = spawnSync(cmd, args, { cwd: dir, env, encoding: 'utf8' });
  if (cmd === 'git' && r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r;
};
const dd = (label, ...args) => {
  const r = run('node', cli, '--json', ...args);
  log += `\n=== ${label}: done-done ${args.join(' ')} (exit ${r.status}) ===\n${r.stdout}${r.stderr}`;
  return { status: r.status, out: r.stdout.trim().startsWith('{') ? JSON.parse(r.stdout) : {} };
};
try {
  run('git', 'init', '-q', '-b', 'main'); run('git', 'add', '-A'); run('git', 'commit', '-qm', 'base');
  run('git', 'checkout', '-qb', 'feat');
  writeFileSync(join(dir, 'src/app.js'), "export const greet = (n) => 'hello ' + n; // reworded\n");
  run('git', 'add', '-A'); run('git', 'commit', '-qm', 'reword greet');

  const before = dd('affected before any proof', 'affected', 'main');
  const selected = (before.out.journeys ?? []).map((j) => j.name).sort();
  if (before.status !== 1 || selected.join() !== names.join()) throw new Error(`affected before: wanted exit 1 and ${names}, got exit ${before.status} and ${selected}`);

  const v = dd('verify with a one-journey list', 'verify', '--journeys', 'greet-ann', '--named-by', 'Umer', '--outcome', 'greet says hello to Ann', '--foreground');
  if (v.status !== 0) throw new Error(`verify: wanted exit 0, got ${v.status}`);
  const rec = dd('receipt for HEAD', 'receipt', '--verify', 'HEAD');
  const s = rec.out.scope;
  if (rec.status !== 0 || !s || s.minimum.join() !== 'greet-ann' || s.named_by !== 'Umer' || s.not_run.join() !== 'greet-bob,greet-cy' || s.omitted_affected.join() !== 'greet-bob,greet-cy') throw new Error(`receipt scope wrong: ${JSON.stringify(rec.out)}`);
  const proof = join(dir, '.proof');
  const written = readdirSync(proof).flatMap((r) => (statSync(join(proof, r)).isDirectory() ? readdirSync(join(proof, r)) : [])).filter((f) => f.startsWith('greet-'));
  if (written.join() !== 'greet-ann.txt') throw new Error(`wanted only greet-ann.txt captured, got ${written}`);

  const after = dd('affected after the minimum proof', 'affected', 'main');
  if (after.status !== 1 || !/greet-bob/.test(after.out.proof) || !/greet-cy/.test(after.out.proof) || /greet-ann/.test(after.out.proof)) throw new Error(`affected after: wanted exit 1 naming greet-bob and greet-cy, got exit ${after.status}: ${after.out.proof}`);

  const two = dd('a two-journey list is refused', 'verify', '--journeys', 'greet-ann,greet-bob', '--outcome', 'x', '--foreground');
  const unknown = dd('an unknown journey is refused', 'verify', '--journeys', 'greet-zed', '--outcome', 'x', '--foreground');
  if (two.status !== 2 || unknown.status !== 2) throw new Error(`wanted usage errors (2) for a two-journey and an unknown list, got ${two.status} and ${unknown.status}`);
  log += `-> list [greet-ann] named by ${s.named_by}: ran 1, not run ${s.not_run.join(', ')}; affected still exits ${after.status} (${after.out.proof})\n`;
} catch (e) {
  console.error(log);
  throw e;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
writeFileSync(join(evidence, 'minimum-scope.log'), log);
writeFileSync(join(evidence, 'steps.json'), JSON.stringify({
  target: { version: JSON.parse(readFileSync('package.json', 'utf8')).version },
  start: 'a throwaway app with three journeys that all run the changed file, a stub judge, one committed change on a branch',
  steps: [
    'Run `done-done affected main`: it selects all three journeys and exits 1',
    'Run `done-done verify --journeys greet-ann --named-by Umer`: only greet-ann runs',
    'Read `done-done receipt --verify HEAD`: scope lists greet-ann, who named it and the two journeys not run',
    'Run `done-done affected main` again: it still exits 1 naming the two journeys not run',
  ],
  result: 'the one-journey list ran one journey; the receipt records minimum scope, Umer, and greet-bob and greet-cy as not run and affected-but-omitted; affected exits 1',
}, null, 2));
console.log(log);
