#!/usr/bin/env node
// Exercise review, its one fix, and the outside-answer gate in isolated fixture repositories.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const evidence = process.env.DONE_DONE_EVIDENCE_ROOT;
if (!evidence) throw new Error('missing DONE_DONE_EVIDENCE_ROOT');
const cli = join(process.cwd(), 'dist/cli.js');
const scratch = mkdtempSync(join(tmpdir(), 'review-fix-'));
const env = { ...process.env, HOME: scratch, DONE_DONE_HOME: join(scratch, 'home'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_AUTHOR_NAME: 'Umer', GIT_AUTHOR_EMAIL: 'umer@example.com', GIT_COMMITTER_NAME: 'Umer', GIT_COMMITTER_EMAIL: 'umer@example.com' };
delete env.DONE_DONE_DRIVE; delete env.DONE_DONE_EVIDENCE_ROOT;
mkdirSync(env.DONE_DONE_HOME);
const agent = join(scratch, 'agent');
writeFileSync(agent, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2); const prompt = fs.readFileSync(args[args.indexOf('-f') + 1], 'utf8');
let answer;
if (prompt.includes('Fix these review findings')) {
 const mode = fs.readFileSync(${JSON.stringify(join(scratch, 'mode'))}, 'utf8');
 fs.writeFileSync('app.js', mode === 'stuck' || mode === 'second-ask' ? 'export const value = 0;\\n// tried\\n' : 'export const value = 1;\\n'); answer = {summary:'fixed', blocker:''};
} else {
 const isCode = prompt.includes('Review the diff below for faults');
 const bad = prompt.includes('+export const value = 0;');
 const mode = fs.readFileSync(${JSON.stringify(join(scratch, 'mode'))}, 'utf8');
 const counter = ${JSON.stringify(join(scratch, 'reviews'))};
 const previous = Number(fs.existsSync(counter) ? fs.readFileSync(counter, 'utf8') : '0');
 const round = isCode ? previous + 1 : previous; if (isCode) fs.writeFileSync(counter, String(round));
 const answered = prompt.includes('Their answer:');
 const ask = mode === 'ask' || (mode === 'second-ask' && round === 2);
 const finding = isCode && !answered && (mode === 'second-ask' ? round === 1 || round === 2 : bad);
 answer = {findings: finding ? [{class:'bug', file:'app.js', line:1, what:'value is zero', why:'wrong value', action:ask?'to-ask':'to-fix', question:ask?'Should the value be one?':''}] : []};
}
console.log(JSON.stringify({type:'text',part:{type:'text',text:JSON.stringify(answer)}}));
`, { mode: 0o755 });
writeFileSync(join(env.DONE_DONE_HOME, 'config.yaml'), `agent: opencode\nagent_path_override: { opencode: ${JSON.stringify(agent)} }\n`);
const run = (dir, cmd, args) => spawnSync(cmd, args, { cwd: dir, env, encoding: 'utf8' });
const git = (dir, ...args) => { const r = run(dir, 'git', args); if (r.status) throw new Error(r.stderr); };
function fixture(name) {
 const dir = join(scratch, name); mkdirSync(dir); git(dir, 'init', '-q', '-b', 'main');
 writeFileSync(join(dir, 'app.js'), 'export const value = 2;\n'); git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'base');
 git(dir, 'checkout', '-qb', 'feature'); writeFileSync(join(dir, 'app.js'), 'export const value = 0;\n'); git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'feature'); return dir;
}
const invoke = (dir, ...args) => { const r = run(dir, 'node', [cli, '--json', ...args]); let out; try { out = JSON.parse(r.stdout); } catch { throw new Error(`${r.stderr}\n${r.stdout}`); } return { ...r, out }; };
let transcript = '';
try {
 writeFileSync(join(scratch, 'mode'), 'fix');
 const one = fixture('fix'); const fixed = invoke(one, 'review', 'main');
 transcript += `fix: ${fixed.stdout}\n${fixed.stderr}`;
 if (fixed.status !== 0 || fixed.out.result !== 'approved' || fixed.out.fix !== 'fix 1 of 1' || fixed.out.findings.length) throw new Error(`fixable finding did not reach approved after one fix: ${fixed.status} ${fixed.stdout} ${fixed.stderr}`);
 writeFileSync(join(scratch, 'mode'), 'ask');
 rmSync(join(scratch, 'reviews'), {force:true});
 const two = fixture('ask'); const parked = invoke(two, 'review', 'main');
 transcript += `ask: ${parked.stdout}\n${parked.stderr}`;
 if (parked.status !== 4 || parked.out.question !== 'Should the value be one?') throw new Error('review did not park with its question');
 const unanswered = invoke(two, 'respond', '--run', parked.out.run_id);
 if (unanswered.status !== 2 || readFileSync(join(two, 'app.js'), 'utf8') !== 'export const value = 0;\n') throw new Error('review continued without an outside answer');
 const status = invoke(two, 'status', '--run', parked.out.run_id); const report = invoke(two, 'report', '--run', parked.out.run_id);
 if (status.out.question !== parked.out.question || report.out.question !== parked.out.question) throw new Error('question missing from status or report');
 writeFileSync(join(scratch, 'mode'), 'fix');
 const answered = invoke(two, 'respond', '--run', parked.out.run_id, '--answer', 'Yes, use one.');
 transcript += `answer: ${answered.stdout}\n${answered.stderr}`;
 if (answered.status !== 0 || answered.out.result !== 'approved' || answered.out.fix !== 'fix 1 of 1' || answered.out.answer !== 'Yes, use one.') throw new Error('outside answer did not resume and approve');
 writeFileSync(join(scratch, 'mode'), 'second-ask'); rmSync(join(scratch, 'reviews'), {force:true});
 const four = fixture('second-ask'); const secondAsk = invoke(four, 'review', 'main');
 transcript += `second ask: ${secondAsk.stdout}\n${secondAsk.stderr}`;
 if (secondAsk.status !== 4 || secondAsk.out.result !== 'to-ask' || secondAsk.out.fix !== 'fix 1 of 1') throw new Error('second review did not park at the outside-answer gate');
 const secondAnswered = invoke(four, 'respond', '--run', secondAsk.out.run_id, '--answer', 'The value should be one.');
 transcript += `second answer: ${secondAnswered.stdout}\n${secondAnswered.stderr}`;
 if (secondAnswered.status !== 0 || secondAnswered.out.result !== 'approved' || secondAnswered.out.fix !== 'fix 1 of 1' || secondAnswered.out.answer !== 'The value should be one.') throw new Error('answer to the second-review ask did not trigger a read-only review');
 writeFileSync(join(scratch, 'mode'), 'stuck');
 const three = fixture('spent'); const spent = invoke(three, 'review', 'main');
 transcript += `spent: ${spent.stdout}\n${spent.stderr}`;
 if (spent.status !== 1 || spent.out.result !== 'spent' || spent.out.fix !== 'fix 1 of 1' || !spent.out.findings.length) throw new Error('remaining finding did not stop at the fix limit');
 writeFileSync(join(evidence, 'review-fix.txt'), transcript);
 writeFileSync(join(evidence, 'steps.json'), JSON.stringify({target:{version:JSON.parse(readFileSync('package.json','utf8')).version}, start:'isolated repositories contain committed review findings', steps:['review a fixable finding','answer an initial review question','answer a question raised by the second review'], result:'outside answers trigger fresh read-only reviews; the second ask resolves without a second fix'}, null, 2));
 console.log('review fix journey passed');
} finally { rmSync(scratch, {recursive:true, force:true}); }
