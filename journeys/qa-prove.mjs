#!/usr/bin/env node
// QA proof loop: `done-done qa --prove` runs the covering journey through verify, fixes at most --max times and seals a receipt for the
// commit. Fixtures: a working change seals on the first run; a broken change is fixed on a done-done branch (stage fixed), and once that
// fix is merged it seals; a change a stub fixer cannot repair stops at --max with stage fail. Stub judge and fixer: no model, no spend.
// Shadow admission: one synthetic fixture repo runs receipt with check.red_before_green on, so shadowNewTests (src/newtests.ts) must record
// an assertion-failed candidate, no-proof rows for a missing symbol, an unsupported runner and a vacuous test. Timings are recorded.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const evidence = process.env.DONE_DONE_EVIDENCE_ROOT;
if (!evidence) throw new Error('missing DONE_DONE_EVIDENCE_ROOT');
const cli = join(process.cwd(), 'dist/cli.js');
const scratch = mkdtempSync(join(tmpdir(), 'qa-prove-'));
const bin = join(scratch, 'bin'), ddHome = join(scratch, 'dd-home');
mkdirSync(bin); mkdirSync(ddHome);
const gitConfig = join(scratch, 'gitconfig');
writeFileSync(gitConfig, '');
const host = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_CONFIG')));
const env = { ...host, HOME: scratch, DONE_DONE_HOME: ddHome, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Umer', GIT_AUTHOR_EMAIL: 'umer@example.com', GIT_COMMITTER_NAME: 'Umer', GIT_COMMITTER_EMAIL: 'umer@example.com' };
for (const k of ['DONE_DONE_DRIVE', 'DONE_DONE_RUN_ID', 'DONE_DONE_EVIDENCE_ROOT', 'CI']) delete env[k];

// The stub judge says every capture shows the outcome. The stub fixer (opencode) fixes `BUG` in src/cli.js, or with FIXER=noop only
// appends a comment, so the journey keeps failing; it logs each call.
const judge = join(bin, 'judge-gemini'), fixer = join(bin, 'opencode');
const verdict = { probabilities: { correct: 0.95, wrong: 0.03, unclear: 0.02 }, rationale: 'The capture shows the outcome.', personReason: 'The capture shows the outcome.', parts: [], covers: [] };
writeFileSync(judge, `#!${process.execPath}\nconst input = require('node:fs').readFileSync(0, 'utf8');\nconst keys = [...new Set([...input.matchAll(/capture_\\d+/g)].map((m) => m[0]))];\nconst v = ${JSON.stringify(verdict)};\nprocess.stdout.write(JSON.stringify({ response: JSON.stringify(keys.length ? Object.fromEntries(keys.map((k) => [k, v])) : { relevance: v }) }));\n`, { mode: 0o755 });
writeFileSync(fixer, `#!${process.execPath}\nconst fs = require('node:fs');\nconst args = process.argv.slice(2); const prompt = fs.readFileSync(args[args.indexOf('-f') + 1], 'utf8');\nif (prompt.includes('read-only reviewer')) { console.log(JSON.stringify({type:'text',part:{type:'text',text:JSON.stringify({findings:[]})}})); process.exit(0); }\nfs.appendFileSync(${JSON.stringify(join(scratch, 'fixer.calls'))}, 'call\\n');\nconst src = fs.readFileSync('src/cli.js', 'utf8');\nfs.writeFileSync('src/cli.js', fs.readFileSync(${JSON.stringify(join(scratch, 'fixer.mode'))}, 'utf8') === 'fix' ? src.replace('BUG', 'exported') : src + '// tried ' + Date.now() + '\\n');\nconsole.log(JSON.stringify({ type: 'text', part: { type: 'text', text: JSON.stringify({ summary: 'tried the export', blocker: '' }) } }));\n`, { mode: 0o755 });
writeFileSync(join(ddHome, 'config.yaml'), `agent: opencode\nagent_path_override: { opencode: ${JSON.stringify(fixer)}, gemini: ${JSON.stringify(judge)} }\njudge:\n  route: answerer:gemini\n  model: stub-judge\n`);

const script = `import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const out = execFileSync(process.execPath, ['src/cli.js', 'export'], { encoding: 'utf8' });
assert.equal(out, 'exported\\n');
writeFileSync(join(process.env.DONE_DONE_EVIDENCE_ROOT, 'export.txt'), out);
writeFileSync(join(process.env.DONE_DONE_EVIDENCE_ROOT, 'steps.json'), JSON.stringify({ target: { version: '1' }, start: 'fresh tool', steps: ['run tool export'], result: 'tool export prints exported' }));
`;
const CLI = (word) => `const cmd = process.argv[2];\nif (cmd === 'run') console.log('ran');\nif (cmd === 'export') console.log('${word}');\n`;

let log = '';
const run = (cwd, cmd, ...args) => {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
  if (cmd === 'git' && r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r;
};
const qa = (dir, label, expect) => {
  const r = run(dir, 'node', cli, '--json', 'qa', 'tool export command', 'main', '--prove', '--max', '2');
  log += `\n=== ${label}: done-done qa "tool export command" main --prove --max 2 (exit ${r.status}) ===\n${r.stdout}${r.stderr}`;
  const out = JSON.parse(r.stdout);
  if (out.stage !== expect.stage || r.status !== expect.exit) throw new Error(`${label}: wanted stage ${expect.stage} exit ${expect.exit}, got ${out.stage} exit ${r.status}`);
  return out;
};

// A tool repo whose journey already covers `export`, plus one committed change on a branch that makes `export` print `word`.
function repo(name, word) {
  const dir = join(scratch, name);
  const skill = join(dir, '.agents/skills/done-done-verify-tool');
  for (const d of ['src', 'journeys']) mkdirSync(join(dir, d), { recursive: true });
  mkdirSync(join(skill, 'features'), { recursive: true });
  writeFileSync(join(dir, '.done-done.yaml'), 'app: tool\nevidence:\n  root: .proof\njourneys:\n  tool-export:\n    command: node journeys/tool-export.mjs\n');
  writeFileSync(join(dir, '.gitignore'), '.proof/\n');
  writeFileSync(join(skill, 'SKILL.md'), '# Tool CLI\n\nLaunch: node src/cli.js run\n');
  writeFileSync(join(skill, 'features/README.md'), '# Features\n');
  writeFileSync(join(dir, 'journeys/tool-export.mjs'), script);
  writeFileSync(join(dir, 'src/cli.js'), CLI('x').replace("if (cmd === 'export') console.log('x');\n", ''));
  run(dir, 'git', 'init', '-q', '-b', 'main'); run(dir, 'git', 'add', '-A'); run(dir, 'git', 'commit', '-qm', 'base');
  run(dir, 'git', 'checkout', '-qb', 'feat');
  writeFileSync(join(dir, 'src/cli.js'), CLI(word));
  run(dir, 'git', 'add', '-A'); run(dir, 'git', 'commit', '-qm', 'tool export');
  return dir;
}
const calls = () => { try { return readFileSync(join(scratch, 'fixer.calls'), 'utf8').trim().split('\n').length; } catch { return 0; } };
const verifyHead = (dir) => JSON.parse(run(dir, 'node', cli, '--json', 'receipt', '--verify', 'HEAD').stdout);

// Shadow admission fixture (shadowNewTests in src/newtests.ts, run by receipt with check.red_before_green on). The base has a buggy add
// and no sub; the head fixes add, adds sub and four tests: add (fails on base by assertion), sub (missing symbol on base), vacuous (passes
// everywhere) and a declared shell test (unsupported runner). Only synthetic files; no model, no network.
const ADD_TEST = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add } from '../src/math.mjs';
test('add sums two numbers', () => { assert.equal(add(2, 3), 5); });
`;
const SUB_TEST = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sub } from '../src/math.mjs';
test('sub subtracts', () => { assert.equal(sub(5, 2), 3); });
`;
const VACUOUS_TEST = `import { test } from 'node:test';
test('checks nothing', () => {});
`;
const SHELL_TEST = `#!/bin/sh
grep -q 'a + b' src/math.mjs
`;
const SHADOW_CLI = `import { add } from './math.mjs';
const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'add') console.log(add(Number(a), Number(b)));
`;
const SHADOW_SUM = `import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const out = execFileSync(process.execPath, ['src/cli.mjs', 'add', '2', '3'], { encoding: 'utf8' });
assert.equal(out, '5\\n');
writeFileSync(join(process.env.DONE_DONE_EVIDENCE_ROOT, 'sum.txt'), out);
writeFileSync(join(process.env.DONE_DONE_EVIDENCE_ROOT, 'steps.json'), JSON.stringify({ target: { version: '1' }, start: 'a fresh shadow app', steps: ['run cli add 2 3'], result: out.trim() }));
`;
function shadowRepo() {
  const dir = join(scratch, 'shadow');
  for (const d of ['src', 'tests', 'journeys', '.agents/skills/done-done-verify-shadow/features']) mkdirSync(join(dir, d), { recursive: true });
  writeFileSync(join(dir, '.gitignore'), '.proof/\n');
  writeFileSync(join(dir, '.done-done.yaml'), 'app: shadow\nevidence:\n  root: .proof\ncheck:\n  red_before_green: true\njourneys:\n  sum:\n    command: node journeys/sum.mjs\n');
  writeFileSync(join(dir, '.agents/skills/done-done-verify-shadow/SKILL.md'), '# Shadow CLI\n\nLaunch: node src/cli.mjs add 2 3\n');
  writeFileSync(join(dir, '.agents/skills/done-done-verify-shadow/features/README.md'), '# Features\n');
  writeFileSync(join(dir, 'src/cli.mjs'), SHADOW_CLI);
  writeFileSync(join(dir, 'journeys/sum.mjs'), SHADOW_SUM);
  writeFileSync(join(dir, 'src/math.mjs'), 'export const add = (a, b) => a - b;\n');
  run(dir, 'git', 'init', '-q', '-b', 'main'); run(dir, 'git', 'add', '-A'); run(dir, 'git', 'commit', '-qm', 'base');
  run(dir, 'git', 'checkout', '-qb', 'feat');
  writeFileSync(join(dir, 'src/math.mjs'), 'export const add = (a, b) => a + b;\nexport const sub = (a, b) => a - b;\n');
  writeFileSync(join(dir, 'tests/add.test.mjs'), ADD_TEST);
  writeFileSync(join(dir, 'tests/sub.test.mjs'), SUB_TEST);
  writeFileSync(join(dir, 'tests/vacuous.test.mjs'), VACUOUS_TEST);
  writeFileSync(join(dir, 'tests/shell.test.sh'), SHELL_TEST);
  run(dir, 'git', 'add', '-A'); run(dir, 'git', 'commit', '-qm', 'feature: add sums, sub, and the new tests');
  return dir;
}
const cliRun = (dir, args) => {
  const t = Date.now();
  const r = spawnSync(process.execPath, [cli, ...args], { cwd: dir, env, encoding: 'utf8' });
  const ms = Date.now() - t;
  log += `\n=== shadow: done-done ${args.join(' ')} (exit ${r.status}, ${ms} ms) ===\n${r.stdout}${r.stderr}`;
  return { status: r.status, out: r.stdout, ms };
};
const findKey = (v, key) => {
  if (!v || typeof v !== 'object') return undefined;
  if (!Array.isArray(v) && key in v) return v[key];
  for (const c of Object.values(v)) { const f = findKey(c, key); if (f !== undefined) return f; }
  return undefined;
};
function shadowCheck() {
  const dir = shadowRepo();
  const baseSha = run(dir, 'git', 'rev-parse', 'main').stdout.trim();
  const headSha = run(dir, 'git', 'rev-parse', 'HEAD').stdout.trim();
  const ran = cliRun(dir, ['run', 'sum']);
  if (ran.status !== 0) throw new Error(`shadow: run sum failed: ${ran.out}`);
  const runId = /run_id:\s*"?([^\s"]+)"?/.exec(ran.out)?.[1];
  if (!runId) throw new Error(`shadow: could not parse run_id from: ${ran.out}`);
  const capture = join(dir, '.proof', runId, 'sum.txt');
  const rc = cliRun(dir, ['--json', 'receipt', '--new-test', 'tests/shell.test.sh', '--outcome', 'add sums two numbers', capture]);
  if (rc.status !== 0) throw new Error(`shadow: receipt exited ${rc.status}: ${rc.out}`);
  const admission = JSON.parse(rc.out).admission_shadow;
  if (!admission) throw new Error(`shadow: the receipt records no top-level admission_shadow: ${rc.out}`);
  assert.equal(admission.error, undefined, 'shadow: admission measured without error');
  assert.equal(admission.base, baseSha, 'shadow: admission names the base commit');
  assert.equal(admission.head, headSha, 'shadow: admission names the head commit');
  assert.deepEqual(admission.rows.map((r) => r.file).sort(), ['tests/add.test.mjs', 'tests/shell.test.sh', 'tests/sub.test.mjs', 'tests/vacuous.test.mjs'], 'shadow: discovered Node tests from the diff and the declared shell test');
  const rows = Object.fromEntries(admission.rows.map((r) => [r.file, r]));
  const want = {
    'tests/add.test.mjs': ['assertion-failed', /assertion failed on base/],
    'tests/sub.test.mjs': ['no-proof', /did not report an assertion failure/],
    'tests/vacuous.test.mjs': ['no-proof', /did not report an assertion failure/],
    'tests/shell.test.sh': ['no-proof', /does not expose structured assertion failures/],
  };
  for (const [file, [result, reason]] of Object.entries(want)) {
    assert.equal(rows[file].result, result, `shadow: ${file} wanted ${result}, got ${JSON.stringify(rows[file])}`);
    assert.match(rows[file].reason, reason, `shadow: ${file} reason`);
  }
  assert.equal(admission.assertion_failures, 1, 'shadow: one assertion-failed candidate');
  assert.equal(admission.no_proof, 3, 'shadow: three no-proof rows');
  return { admission, receipt: rc.out, timings: { run_ms: ran.ms, receipt_ms: rc.ms } };
}

let sealed, fixed, resealed, failed, shadow;
try {
  writeFileSync(join(scratch, 'fixer.mode'), 'fix');
  const ok = repo('working', 'exported');
  sealed = qa(ok, 'working change', { stage: 'sealed', exit: 0 });
  if (sealed.prove.fixes !== 0 || verifyHead(ok).result !== 'pass' || calls() !== 0) throw new Error('working change: wanted a receipt for HEAD from the first run and no fixer call');
  log += `-> working change: stage ${sealed.stage}, receipt for HEAD verifies pass, fixer calls ${calls()}\n`;

  const broken = repo('broken-fixable', 'BUG');
  fixed = qa(broken, 'broken change, fixable', { stage: 'fixed', exit: 1 });
  if (!fixed.prove.fix_branch || fixed.prove.fixes !== 1) throw new Error(`broken change: wanted one fix on a branch, got ${JSON.stringify(fixed.prove)}`);
  if (run(broken, 'git', 'status', '--porcelain').stdout.trim() || verifyHead(broken).result === 'pass') throw new Error('broken change: HEAD was sealed or the checkout changed');
  run(broken, 'git', 'merge', '-q', fixed.prove.fix_branch);
  resealed = qa(broken, 'broken change after merging the fix', { stage: 'sealed', exit: 0 });
  if (verifyHead(broken).result !== 'pass') throw new Error('merged fix: HEAD has no passing receipt');
  log += `-> broken change: stage ${fixed.stage} on ${fixed.prove.fix_branch}, HEAD unsealed; after the merge: stage ${resealed.stage}\n`;

  writeFileSync(join(scratch, 'fixer.mode'), 'noop');
  const before = calls();
  const stuck = repo('broken-stuck', 'BUG');
  failed = qa(stuck, 'broken change, fixer cannot repair', { stage: 'fail', exit: 1 });
  if (calls() - before !== 2 || failed.prove.fixes !== 2 || !/stopped at 2 of 2 fixes/.test(failed.prove.reason)) throw new Error(`stuck change: wanted a stop at 2 of 2, got ${calls() - before} fixer calls and ${JSON.stringify(failed.prove)}`);
  if (verifyHead(stuck).result === 'pass') throw new Error('stuck change: HEAD was sealed');
  log += `-> stuck change: stage ${failed.stage} after ${failed.prove.fixes} of ${failed.prove.max} fixes (${failed.prove.reason})\n`;

  shadow = shadowCheck();
  log += `-> shadow admission: ${shadow.admission.assertion_failures} assertion-failed candidate, ${shadow.admission.no_proof} no-proof; ${shadow.admission.rows.map((r) => `${r.file} ${r.result}`).join('; ')}; run ${shadow.timings.run_ms} ms, receipt ${shadow.timings.receipt_ms} ms\n`;
} catch (e) {
  console.error(log);
  throw e;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
writeFileSync(join(evidence, 'qa-prove.log'), log);
writeFileSync(join(evidence, 'admission.json'), JSON.stringify(shadow.admission, null, 2) + '\n');
writeFileSync(join(evidence, 'receipt-red-before-green.json'), shadow.receipt);
writeFileSync(join(evidence, 'timings.json'), JSON.stringify({ unit: 'ms', ...shadow.timings }, null, 2) + '\n');
writeFileSync(join(evidence, 'steps.json'), JSON.stringify({
  target: { version: JSON.parse(readFileSync('package.json', 'utf8')).version },
  start: 'throwaway tool repos whose journey covers a new `export` command, a stub judge and a stub fixer; each commits the change on a branch; a synthetic shadow repo with added Node tests and a declared shell test',
  steps: [
    'Run `done-done qa "tool export command" main --prove --max 2` on a working change',
    'Run it on a broken change a fixer can repair, merge the fix branch it names, then run it again',
    'Run it on a broken change the fixer cannot repair',
    'Run `done-done receipt --new-test tests/shell.test.sh` with check.red_before_green on a synthetic repo whose head adds three Node tests and one shell test, and read the admission record',
  ],
  result: 'the working change ends stage sealed with a receipt that verifies for HEAD; the repairable one ends stage fixed on a done-done branch and seals once merged; the unrepairable one stops at 2 of 2 fixes with stage fail and no receipt; the shadow admission records one assertion-failed candidate and three no-proof rows (missing symbol, unsupported runner, vacuous test)',
}, null, 2));
console.log(log);
