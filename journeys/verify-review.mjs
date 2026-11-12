#!/usr/bin/env node
// Drive verify's review, retry and skip paths in isolated repositories.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const evidence = process.env.DONE_DONE_EVIDENCE_ROOT;
if (!evidence) throw new Error('missing DONE_DONE_EVIDENCE_ROOT');
const cli = join(process.cwd(), 'dist/cli.js'), scratch = mkdtempSync(join(tmpdir(), 'verify-review-'));
const home = join(scratch, 'home'); mkdirSync(home);
const env = { ...process.env, HOME: scratch, DONE_DONE_HOME: home, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Umer', GIT_AUTHOR_EMAIL: 'umer@example.com', GIT_COMMITTER_NAME: 'Umer', GIT_COMMITTER_EMAIL: 'umer@example.com' };
for (const key of ['DONE_DONE_DRIVE', 'DONE_DONE_RUN_ID', 'DONE_DONE_EVIDENCE_ROOT', 'CI']) delete env[key];
const mode = join(scratch, 'mode'), agent = join(scratch, 'agent'), judge = join(scratch, 'judge');
writeFileSync(agent, `#!${process.execPath}
const fs = require('node:fs'), args = process.argv.slice(2), prompt = fs.readFileSync(args[args.indexOf('-f') + 1], 'utf8');
const mode = fs.readFileSync(${JSON.stringify(mode)}, 'utf8');
if (mode === 'stall') { console.error('quota limit'); process.exit(1); }
let answer;
if (prompt.includes('Fix these review findings')) { fs.writeFileSync('app.js', 'export const value = 1;\\n'); answer = {summary:'fixed',blocker:''}; }
else { const bad = prompt.includes('Review the diff below for faults') && prompt.includes('+export const value = 0;') && !prompt.includes('Their answer:'); answer = {findings: bad ? [{class:'bug',file:'app.js',line:1,what:'value is zero',why:'wrong value',action:mode === 'ask' ? 'to-ask' : 'to-fix',question:mode === 'ask' ? 'Is zero intended?' : ''}] : []}; }
console.log(JSON.stringify({type:'text',part:{type:'text',text:JSON.stringify(answer)}}));
`, { mode: 0o755 });
const verdict = { probabilities: { correct: 0.95, wrong: 0.03, unclear: 0.02 }, rationale: 'The capture shows the outcome.', personReason: 'The capture shows the outcome.', parts: [], covers: [] };
writeFileSync(judge, `#!${process.execPath}
const input = require('node:fs').readFileSync(0, 'utf8'); const keys = [...new Set([...input.matchAll(/capture_\\d+/g)].map(m=>m[0]))]; const v = ${JSON.stringify(verdict)};
process.stdout.write(JSON.stringify({response: JSON.stringify(keys.length ? Object.fromEntries(keys.map(k=>[k,v])) : {relevance:v})}));
`, {mode:0o755});
const config = (enabled = true) => writeFileSync(join(home, 'config.yaml'), `agent: opencode\nreview_enabled: ${enabled}\nagent_path_override: { opencode: ${JSON.stringify(agent)}, gemini: ${JSON.stringify(judge)} }\njudge: { route: 'answerer:gemini', model: stub-judge }\n`);
const call = (dir, cmd, args) => spawnSync(cmd, args, {cwd:dir, env, encoding:'utf8'});
const git = (dir, ...args) => { const r = call(dir, 'git', args); if (r.status) throw new Error(r.stderr); return r.stdout.trim(); };
const invoke = (dir, ...args) => { const r = call(dir, 'node', [cli, '--json', ...args]); try { return {...r, out:JSON.parse(r.stdout)}; } catch { throw new Error(`${r.stdout}\n${r.stderr}`); } };
function fixture(name, diff = true) {
 const dir = join(scratch,name); mkdirSync(dir); mkdirSync(join(dir,'journeys'));
 writeFileSync(join(dir,'.gitignore'), '.proof/\n');
 writeFileSync(join(dir,'.done-done.yaml'), 'app: fixture\nevidence: { root: .proof }\nsuite: { command: "node -e \\\"process.exit(0)\\\"" }\njourneys:\n  proof:\n    command: node journeys/proof.mjs\n');
 writeFileSync(join(dir,'journeys/proof.mjs'), `import {writeFileSync} from 'node:fs'; import {join} from 'node:path'; const dir=process.env.DONE_DONE_EVIDENCE_ROOT; writeFileSync(join(dir,'proof.txt'),'The product ran.\\n'); writeFileSync(join(dir,'steps.json'), JSON.stringify({target:{version:'1'},start:'fresh fixture',steps:['run fixture'],result:'the product ran'}));`);
 writeFileSync(join(dir,'app.js'), 'export const value = 2;\n'); git(dir,'init','-q','-b','main'); git(dir,'add','.'); git(dir,'commit','-qm','base');
 if (diff) { git(dir,'checkout','-qb','feature'); writeFileSync(join(dir,'app.js'),'export const value = 0;\n'); git(dir,'add','.'); git(dir,'commit','-qm','change'); }
 return dir;
}
let transcript = '';
try {
 config(); writeFileSync(mode,'fix'); const one = fixture('fix');
 const fixed = invoke(one,'verify','proof','--outcome','The product ran','--foreground'); transcript += fixed.stdout + fixed.stderr;
 if (fixed.status !== 0 || fixed.out.review?.state !== 'approved' || fixed.out.review.fixes !== 1) throw new Error(`fix did not approve: ${fixed.stdout} ${fixed.stderr}`);
 const receipt = JSON.parse(readFileSync(join(one,'.proof','.done-done','receipts',`${git(one,'rev-parse','HEAD')}.json`),'utf8'));
 if (receipt.review?.head !== receipt.head || receipt.review.state !== 'approved') throw new Error('receipt did not bind reviewed head');
 const events = readFileSync(join(home, 'runs', 'fixture', fixed.out.run_id, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
 const stages = events.filter(e => e.status === 'running').map(e => e.step);
 const firstReview = stages.indexOf('reviewing'), secondReview = stages.lastIndexOf('reviewing');
 if (stages.indexOf('judge') < 0 || firstReview < stages.indexOf('judge') || secondReview <= firstReview || !stages.slice(firstReview + 1, secondReview).includes('judge')) throw new Error(`missing judge/review loop: ${stages}`);
 const checkedReceipt = invoke(one, 'receipt', '--verify', 'HEAD');
 if (checkedReceipt.status !== 0 || checkedReceipt.out.review?.head !== receipt.head) throw new Error('receipt verification did not expose review');
 config(false); const disabled = fixture('disabled'); const off = invoke(disabled,'verify','proof','--outcome','The product ran','--foreground'); transcript += off.stdout + off.stderr;
 if (off.status !== 0 || off.out.review?.reason !== 'review disabled in global config') throw new Error(`disabled did not skip: ${off.stdout} ${off.stderr}`);
 config(); const empty = fixture('empty',false); const none = invoke(empty,'verify','proof','--outcome','The product ran','--foreground'); transcript += none.stdout + none.stderr;
 if (none.status !== 0 || none.out.review?.reason !== 'no diff') throw new Error(`empty did not skip: ${none.stdout} ${none.stderr}`);
 writeFileSync(mode,'ask'); const askRepo = fixture('ask'); const asked = invoke(askRepo,'verify','proof','--outcome','The product ran','--foreground'); transcript += asked.stdout + asked.stderr;
 if (asked.status !== 4 || asked.out.review?.question !== 'Is zero intended?') throw new Error('review question did not park');
 const answered = invoke(askRepo,'respond','--run',asked.out.run_id,'--answer','Zero is intended.'); transcript += answered.stdout + answered.stderr;
 if (answered.status !== 0 || answered.out.run_id !== asked.out.run_id || answered.out.review?.state !== 'approved') throw new Error(`answer did not resume: ${answered.stdout} ${answered.stderr}`);
 writeFileSync(mode,'stall'); const stalled = fixture('stalled'); const wait = invoke(stalled,'verify','proof','--outcome','The product ran','--foreground'); transcript += wait.stdout + wait.stderr;
 if (wait.status !== 4 || wait.out.review?.state !== 'stalled' || wait.out.receipt) throw new Error(`engine failure did not stall: ${wait.stdout} ${wait.stderr}`);
 writeFileSync(mode,'fix'); const resumed = invoke(stalled,'rerun','--run',wait.out.run_id,'--wait'); transcript += resumed.stdout + resumed.stderr;
 if (resumed.status !== 0 || resumed.out.run_id !== wait.out.run_id || resumed.out.review?.state !== 'approved') throw new Error(`retry did not resume: ${resumed.stdout} ${resumed.stderr}`);
 writeFileSync(join(evidence,'verify-review.txt'),transcript);
 writeFileSync(join(evidence,'steps.json'),JSON.stringify({target:{version:'1'},start:'isolated repositories and deterministic reviewers',steps:['verify a review finding and fix','verify with review disabled and no diff','retry a stalled review'],result:'one run seals the reviewed final head; skipped reviews record the reason and stalled reviews resume'},null,2));
 console.log('verify review journey passed');
} finally { rmSync(scratch,{recursive:true,force:true}); }
