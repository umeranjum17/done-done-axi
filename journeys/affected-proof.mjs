#!/usr/bin/env node
// Affected-file proof: `done-done verify --affected-by <files> --extends <head>` drives only the journeys the named files affect and
// writes a receipt that extends a prior one. A throwaway app with two local-tier journeys (each imports its own source file), a
// feature commit with a prior receipt, then two rebases: one brings in a change to one journey's source (one journey runs), one
// brings in a file no journey covers (the whole local tier runs). Review stays on with a reviewer that records any call: none is made.
// Stub judge: no model, no spend.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const evidence = process.env.DONE_DONE_EVIDENCE_ROOT;
if (!evidence) throw new Error('missing DONE_DONE_EVIDENCE_ROOT');
const cli = join(process.cwd(), 'dist/cli.js');
const scratch = mkdtempSync(join(tmpdir(), 'affected-proof-'));
const bin = join(scratch, 'bin'), ddHome = join(scratch, 'dd-home'), called = join(scratch, 'reviewer-called');
mkdirSync(bin); mkdirSync(ddHome);
const gitConfig = join(scratch, 'gitconfig');
writeFileSync(gitConfig, '');
const host = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_CONFIG') && !k.startsWith('DONE_DONE_')));
const env = { ...host, HOME: scratch, DONE_DONE_HOME: ddHome, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Umer', GIT_AUTHOR_EMAIL: 'umer@example.com', GIT_COMMITTER_NAME: 'Umer', GIT_COMMITTER_EMAIL: 'umer@example.com' };

// The stub judge says every capture shows the outcome. The reviewer stub only records that it was started, and fails.
const judge = join(bin, 'judge-gemini'), reviewer = join(bin, 'reviewer');
const verdict = { probabilities: { correct: 0.95, wrong: 0.03, unclear: 0.02 }, rationale: 'The capture shows the outcome.', personReason: 'The capture shows the outcome.', parts: [], covers: [] };
writeFileSync(judge, `#!${process.execPath}\nconst input = require('node:fs').readFileSync(0, 'utf8');\nconst keys = [...new Set([...input.matchAll(/capture_\\d+/g)].map((m) => m[0]))];\nconst v = ${JSON.stringify(verdict)};\nprocess.stdout.write(JSON.stringify({ response: JSON.stringify(keys.length ? Object.fromEntries(keys.map((k) => [k, v])) : { relevance: v }) }));\n`, { mode: 0o755 });
writeFileSync(reviewer, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(called)}, 'started\\n');\nconsole.error('a reviewer must not start');\nprocess.exit(1);\n`, { mode: 0o755 });
const config = (review) => writeFileSync(join(ddHome, 'config.yaml'), `agent: opencode\nreview_enabled: ${review}\nagent_path_override: { opencode: ${JSON.stringify(reviewer)}, gemini: ${JSON.stringify(judge)} }\njudge:\n  route: answerer:gemini\n  model: stub-judge\n`);

const dir = join(scratch, 'app');
const skill = join(dir, '.agents/skills/done-done-verify-app');
for (const d of ['src', 'journeys', 'docs']) mkdirSync(join(dir, d), { recursive: true });
mkdirSync(join(skill, 'features'), { recursive: true });
const people = ['ann', 'bob'];
writeFileSync(join(dir, '.done-done.yaml'), `app: app\nevidence:\n  root: .proof\njourneys:\n${people.map((n) => `  greet-${n}:\n    command: node journeys/${n}.mjs\n    tier: local\n`).join('')}`);
writeFileSync(join(dir, '.gitignore'), '.proof/\n');
writeFileSync(join(skill, 'SKILL.md'), '# App\n\nLaunch: node journeys/<name>.mjs\n');
writeFileSync(join(skill, 'features/README.md'), '# Features\n');
const driver = (n) => `import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { greet } from '../src/${n}.js';
const out = greet();
assert.equal(out.startsWith('hello ${n}'), true);
writeFileSync(join(process.env.DONE_DONE_EVIDENCE_ROOT, '${n}.txt'), out + '\\n');
writeFileSync(join(process.env.DONE_DONE_EVIDENCE_ROOT, 'steps.json'), JSON.stringify({ target: { version: '1' }, start: 'fresh app', steps: ['greet ${n}'], result: out }));
`;
for (const n of people) {
  writeFileSync(join(dir, `journeys/${n}.mjs`), driver(n));
  writeFileSync(join(dir, `src/${n}.js`), `export const greet = () => 'hello ${n}';\n`);
}
let log = '';
const run = (cmd, ...args) => {
  const r = spawnSync(cmd, args, { cwd: dir, env, encoding: 'utf8' });
  if (cmd === 'git' && r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r;
};
const git = (...args) => run('git', ...args).stdout.trim();
const dd = (label, ...args) => {
  const r = run('node', cli, '--json', ...args);
  log += `\n=== ${label}: done-done ${args.join(' ')} (exit ${r.status}) ===\n${r.stdout}${r.stderr}`;
  return { status: r.status, out: r.stdout.trim().startsWith('{') ? JSON.parse(r.stdout) : {} };
};
const must = (ok, what) => { if (!ok) throw new Error(what); };
const receiptFile = (head) => join(dir, '.proof/.done-done/receipts', `${head}.json`);
const captured = () => readdirSync(join(dir, '.proof')).flatMap((r) => (statSync(join(dir, '.proof', r)).isDirectory() ? readdirSync(join(dir, '.proof', r)) : [])).filter((f) => /^(ann|bob)\.txt$/.test(f)).sort();
try {
  git('init', '-q', '-b', 'main'); git('add', '-A'); git('commit', '-qm', 'base');
  git('checkout', '-qb', 'feat');
  writeFileSync(join(dir, 'src/ann.js'), "export const greet = () => 'hello ann, welcome';\n");
  git('add', '-A'); git('commit', '-qm', 'feature: reword ann');
  const before = git('rev-parse', 'HEAD');

  // The prior receipt: the feature commit, proved by a plain verify (review off, so no reviewer is needed to make it).
  config(false);
  const prior = dd('prior receipt at the feature head', 'verify', 'greet-ann', '--outcome', 'ann is greeted', '--foreground');
  must(prior.status === 0 && existsSync(receiptFile(before)), `prior verify: wanted exit 0 and a receipt, got exit ${prior.status}`);
  config(true);

  // Rebase 1: main moved and changed bob's source. The named file reaches one journey, so one runs.
  git('checkout', '-q', 'main');
  writeFileSync(join(dir, 'src/bob.js'), "export const greet = () => 'hello bob, welcome';\n");
  git('add', '-A'); git('commit', '-qm', 'upstream: reword bob');
  git('checkout', '-q', 'feat'); git('rebase', '-q', 'main');
  const rebased = git('rev-parse', 'HEAD');
  must(rebased !== before, 'the rebase should move the head');
  const one = dd('affected-by the file that changed upstream', 'verify', '--affected-by', 'src/bob.js', '--extends', before, '--outcome', 'bob is greeted', '--foreground');
  must(one.status === 0, `affected-by one journey: wanted exit 0, got ${one.status}`);
  must(captured().join() === 'ann.txt,bob.txt', `wanted ann.txt (prior run) and bob.txt, got ${captured()}`);
  const r1 = JSON.parse(readFileSync(receiptFile(rebased), 'utf8'));
  const priorHash = createHash('sha256').update(readFileSync(receiptFile(before))).digest('hex');
  must(r1.affected.journeys.join() === 'greet-bob' && r1.affected.ran.join() === 'greet-bob' && r1.affected.files.join() === 'src/bob.js', `receipt journeys wrong: ${JSON.stringify(r1.affected)}`);
  must(r1.affected.extends.head === before && r1.affected.extends.sha256 === priorHash && r1.affected.review === 'not run again', `receipt does not link the prior receipt: ${JSON.stringify(r1.affected)}`);
  must(r1.review.state === 'skipped' && /not run again/.test(r1.review.reason), `review record wrong: ${JSON.stringify(r1.review)}`);
  must(r1.runs.length === 1 && r1.runs[0].journey === 'greet-bob', `receipt runs wrong: ${JSON.stringify(r1.runs)}`);
  const v1 = dd('verify the extended receipt', 'receipt', '--verify', 'HEAD');
  must(v1.status === 0 && v1.out.affected?.extends?.head === before, `receipt --verify: ${JSON.stringify(v1.out)}`);

  // Rebase 2: main moved again with a file no journey covers. Unsure means more: the whole local tier runs, both journeys, one receipt.
  git('checkout', '-q', 'main');
  writeFileSync(join(dir, 'docs/NOTES.md'), '# Notes\n');
  git('add', '-A'); git('commit', '-qm', 'upstream: notes');
  git('checkout', '-q', 'feat'); git('rebase', '-q', 'main');
  const second = git('rev-parse', 'HEAD');
  const all = dd('affected-by a file no journey covers', 'verify', '--affected-by', 'docs/NOTES.md', '--extends', rebased, '--outcome', 'the app still greets', '--foreground');
  must(all.status === 0, `affected-by an uncovered file: wanted exit 0, got ${all.status}`);
  const r2 = JSON.parse(readFileSync(receiptFile(second), 'utf8'));
  must(r2.affected.journeys.join() === 'greet-ann,greet-bob' && r2.affected.ran.join() === 'greet-ann,greet-bob', `local tier not run: ${JSON.stringify(r2.affected)}`);
  must(r2.runs.map((r) => r.journey).sort().join() === 'greet-ann,greet-bob' && ['ann.txt', 'bob.txt'].every((n) => r2.files.some((f) => f.path.endsWith(`/${n}`))), `one receipt should hold both runs: ${JSON.stringify(r2.runs)}`);
  must(r2.affected.extends.head === rebased, `second receipt does not link the first: ${JSON.stringify(r2.affected)}`);
  const v2 = dd('verify the local-tier receipt', 'receipt', '--verify', 'HEAD');
  must(v2.status === 0 && v2.out.affected?.ran?.length === 2, `receipt --verify: ${JSON.stringify(v2.out)}`);
  must(!existsSync(called), 'a reviewer was started');

  // Refusals, and a changed prior receipt breaks the link.
  const mixed = dd('--affected-by with --journeys is refused', 'verify', '--journeys', 'greet-ann', '--affected-by', 'src/bob.js', '--outcome', 'x', '--foreground');
  const lone = dd('--extends alone is refused', 'verify', 'greet-ann', '--extends', before, '--outcome', 'x', '--foreground');
  const self = dd('--extends HEAD is refused', 'verify', '--affected-by', 'src/bob.js', '--extends', 'HEAD', '--outcome', 'x', '--foreground');
  const unknown = dd('--extends a commit with no receipt is refused', 'verify', '--affected-by', 'src/bob.js', '--extends', git('rev-parse', 'main'), '--outcome', 'x', '--foreground');
  must([mixed, lone, self, unknown].every((r) => r.status === 2), `wanted usage errors (2), got ${[mixed, lone, self, unknown].map((r) => r.status)}`);
  const kept = readFileSync(receiptFile(rebased));
  writeFileSync(receiptFile(rebased), `${kept.toString('utf8').trim()}\n\n`);
  const broken = dd('a changed prior receipt breaks the link', 'receipt', '--verify', 'HEAD');
  must(broken.status === 1 && /whose file changed since/.test(broken.out.reason ?? ''), `changed prior: ${JSON.stringify(broken.out)}`);
  writeFileSync(receiptFile(rebased), kept);
  log += `-> rebase 1: ${r1.affected.journeys} ran, extends ${before.slice(0, 12)}; rebase 2: ${r2.affected.ran} ran, extends ${rebased.slice(0, 12)}; reviewer started: ${existsSync(called)}\n`;
} catch (e) {
  console.error(log);
  throw e;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
writeFileSync(join(evidence, 'affected-proof.log'), log);
writeFileSync(join(evidence, 'steps.json'), JSON.stringify({
  target: { version: JSON.parse(readFileSync('package.json', 'utf8')).version },
  start: 'a throwaway app with two local-tier journeys, a feature commit with a receipt, a stub judge and a reviewer stub that records any start',
  steps: [
    'Rebase the feature onto a main that changed one journey source; run `done-done verify --affected-by src/bob.js --extends <prior head>`: one journey runs',
    'Read `done-done receipt --verify HEAD`: the receipt names the prior receipt, the file, the journey and that no review ran again',
    'Rebase onto a main that added a file no journey covers; run `verify --affected-by docs/NOTES.md`: the whole local tier runs, in one receipt',
    'Try the refused forms and change the prior receipt: usage errors, and the link fails to verify',
  ],
  result: 'one affected journey ran for the covered file and the whole local tier for the uncovered one; each receipt links its prior receipt; no reviewer started',
}, null, 2));
console.log(log);
