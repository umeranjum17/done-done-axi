#!/usr/bin/env node
// QA proof loop: `done-done qa --prove` runs the covering journey through verify, fixes at most --max times and seals a receipt for the
// commit. Fixtures: a working change seals on the first run; a broken change is fixed on a done-done branch (stage fixed), and once that
// fix is merged it seals; a change a stub fixer cannot repair stops at --max with stage fail. Stub judge and fixer: no model, no spend.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const evidence = process.env.DONE_DONE_EVIDENCE_ROOT;
if (!evidence) throw new Error('missing DONE_DONE_EVIDENCE_ROOT');
const cli = join(process.cwd(), 'dist/cli.js');
const scratch = mkdtempSync(join(tmpdir(), 'qa-prove-'));
const bin = join(scratch, 'bin'), ddHome = join(scratch, 'dd-home');
mkdirSync(bin); mkdirSync(ddHome);
const env = { ...process.env, HOME: scratch, DONE_DONE_HOME: ddHome, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Umer', GIT_AUTHOR_EMAIL: 'umer@example.com', GIT_COMMITTER_NAME: 'Umer', GIT_COMMITTER_EMAIL: 'umer@example.com' };
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

let sealed, fixed, resealed, failed;
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
} catch (e) {
  console.error(log);
  throw e;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
writeFileSync(join(evidence, 'qa-prove.log'), log);
writeFileSync(join(evidence, 'steps.json'), JSON.stringify({
  target: { version: JSON.parse(readFileSync('package.json', 'utf8')).version },
  start: 'throwaway tool repos whose journey covers a new `export` command, a stub judge and a stub fixer; each commits the change on a branch',
  steps: [
    'Run `done-done qa "tool export command" main --prove --max 2` on a working change',
    'Run it on a broken change a fixer can repair, merge the fix branch it names, then run it again',
    'Run it on a broken change the fixer cannot repair',
  ],
  result: 'the working change ends stage sealed with a receipt that verifies for HEAD; the repairable one ends stage fixed on a done-done branch and seals once merged; the unrepairable one stops at 2 of 2 fixes with stage fail and no receipt',
}, null, 2));
console.log(log);
