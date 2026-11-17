// Real CLI journey with deterministic harness processes, including unavailable routes and terminal product failures.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const CLI = process.env.DONE_DONE_TEST_CLI || fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const out = process.env.DONE_DONE_EVIDENCE_ROOT; assert.ok(out, 'run via done-done run route-fallback');
const scratch = mkdtempSync(join(tmpdir(), 'dd-route-')), repo = join(scratch, 'repo'), home = join(scratch, 'home');
mkdirSync(repo); mkdirSync(home);
const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: home, XDG_DATA_HOME: home, XDG_CACHE_HOME: home, DONE_DONE_HOME: home, JG_TOOL_MODELS: join(scratch, 'tool-models.json'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Umer', GIT_AUTHOR_EMAIL: 'umer@example.com', GIT_COMMITTER_NAME: 'Umer', GIT_COMMITTER_EMAIL: 'umer@example.com' };
for (const k of Object.keys(env)) if (k.startsWith('DONE_DONE_') && k !== 'DONE_DONE_HOME' || k.startsWith('GIT_CONFIG_') && !['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'].includes(k)) delete env[k];
const journal = join(scratch, 'calls.jsonl'), transcript = [], paths = {};
for (const agent of ['opencode', 'codex', 'claude']) {
  paths[agent] = join(scratch, agent);
  writeFileSync(paths[agent], String.raw`#!${process.execPath}
const fs = require('node:fs'), args = process.argv.slice(2), agent = require('node:path').basename(process.argv[1]);
if (args.includes('debug')) { console.log(JSON.stringify({models:[{slug:'gpt-6-luna'},{slug:'gpt-6.1-terra'}]})); process.exit(0); }
const model = args[args.indexOf(agent === 'claude' ? '--model' : '-m')+1];
const prompt = fs.readFileSync(agent === 'opencode' ? args[args.indexOf('-f')+1] : 0,'utf8');
fs.appendFileSync(${JSON.stringify(journal)},JSON.stringify({agent,model,args})+'\n');
if (['quota','auth','missing','gpt-6-luna'].includes(model) || (model === 'gpt-6.1-terra' && process.env.DD_FAIL_TERRA)) { console.error({quota:'quota exceeded',auth:'Failed to authenticate',missing:'model not found','gpt-6-luna':'quota exceeded','gpt-6.1-terra':'quota exceeded'}[model]); process.exit(1); }
if (model === 'silent' || model === 'active') { if (model === 'active') console.error('working'); setTimeout(()=>{},10000); }
else if (model === 'malformed') console.log('invalid JSON');
else { const v = {probabilities:model === 'wrong'?{correct:0,wrong:1,unclear:0}:{correct:1,wrong:0,unclear:0},rationale:'Hello Umer is printed',personReason:'Hello Umer is printed',parts:['Hello Umer'],covers:[0]};
const answer = prompt.includes('Review the diff') || prompt.includes('Compare the docs below') ? {findings:[]} : {relevance:v};
console.log(JSON.stringify(agent === 'codex'?{type:'item.completed',item:{type:'agent_message',text:JSON.stringify(answer)}}:agent === 'claude'?{structured_output:answer}:{type:'text',part:{type:'text',text:JSON.stringify(answer)}})); }
`, { mode: 0o755 });
}
const calls = () => { try { return readFileSync(journal, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } };
const git = (...args) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' }).trim();
const dd = (code, ...args) => { const r = spawnSync(process.execPath, [CLI, '--json', ...args], { cwd: repo, env, encoding: 'utf8', timeout: 30000 }); transcript.push(`$ done-done ${args.join(' ')}\n${r.stdout}${r.stderr}\nexit: ${r.status}`); assert.equal(r.status, code, r.error?.message || r.stdout+r.stderr); return JSON.parse(r.stdout); };
const route = (model, harness = 'opencode', effort = 'low') => ({ harness, model, effort });
const config = (author, judge, extra = {}) => writeFileSync(join(home, 'config.yaml'), JSON.stringify({ agent_path_override: paths, routes: { author, judge }, agent_timeout: '1s', ...extra }));
const records = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? records(join(dir, e.name)) : e.name.endsWith('.json') ? [join(dir, e.name)] : []);
try {
  writeFileSync(join(repo, '.gitignore'), '.proof/\n');
  writeFileSync(join(repo, '.done-done.yaml'), 'app: route-fixture\nevidence: {root: .proof}\nsuite: {command: "true"}\njourneys:\n  greet:\n    command: node proof.mjs\n  broken:\n    command: node -e "process.exit(1)"\n');
  writeFileSync(join(repo, 'app.mjs'), 'console.log("Hello Umer");\n');
  writeFileSync(join(repo, 'proof.mjs'), `import {execFileSync} from 'node:child_process'; import {writeFileSync} from 'node:fs'; import {join} from 'node:path'; const d=process.env.DONE_DONE_EVIDENCE_ROOT; writeFileSync(join(d,'hello.txt'),execFileSync(process.execPath,['app.mjs'])); writeFileSync(join(d,'steps.json'),JSON.stringify({target:{version:'1'},start:'fresh greeting CLI',steps:['node app.mjs'],result:'Hello Umer is printed'}));`);
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-qm', 'base'); git('checkout', '-qb', 'feature');
  writeFileSync(join(repo, 'app.mjs'), 'console.log("Hello Umer"); // feature\n'); git('add', '.'); git('commit', '-qm', 'feature');
  config([route('pass')], [route('pass')]);
  const run = dd(0, 'run', 'greet'), capture = resolve(repo, run.evidence.find(p => p.endsWith('hello.txt')));
  const check = (code, label) => dd(code, 'check', '--outcome', `Hello Umer is printed (${label})`, capture);
  for (const failure of ['quota', 'auth', 'missing', 'silent']) {
    config([route(failure), route('pass', 'opencode', 'high')], [route(failure), route('pass', 'opencode', 'high')]);
    assert.equal(dd(0, 'review', 'main').route.model, 'pass'); const judged = check(0, failure);
    assert.equal(judged.judge.model, 'pass'); assert.equal(judged.judge.effort, 'high'); assert.match(judged.judge.detail, new RegExp(failure));
  }
  const summary = records(home).map(p => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; } }).find(r => r.route_attempts?.[0]?.model === 'quota');
  assert.deepEqual(summary.route_attempts.map(r => [r.model, r.ok, r.unavailable]), [['quota', false, true], ['pass', true, false]]);
  assert.equal(summary.selected.effort, 'high'); assert.ok(calls().some(c => c.model === 'pass' && c.args.includes('high')));
  config([route('quota')], [route('quota')]);
  writeFileSync(env.JG_TOOL_MODELS, JSON.stringify({ rules: ['author', 'judge'].map(kind => ({ tool: `done-done-${kind}`, use: [route('auth'), route('pass', 'opencode', 'high')] })) }));
  let start = calls().length; dd(0, 'review', 'main'); assert.equal(check(0, 'tool-models').judge.model, 'pass');
  assert.ok(calls().slice(start).every(c => c.model !== 'quota')); rmSync(env.JG_TOOL_MODELS);
  for (const failure of ['wrong', 'malformed', 'active']) {
    config([route(failure), route('pass')], [route(failure), route('pass')]); start = calls().length;
    check(failure === 'wrong' ? 1 : 2, failure);
    if (failure !== 'wrong') dd(3, 'review', 'main');
    assert.ok(calls().slice(start).length > 0); assert.ok(calls().slice(start).every(c => c.model === failure), 'terminal failure never launches fallback');
  }
  config([route('quota'), route('auth')], [route('quota'), route('auth')]); dd(3, 'review', 'main');
  const exhausted = check(2, 'exhausted'); assert.match(exhausted.error, /quota/); assert.match(exhausted.error, /auth/);
  config([route('quota')], [route('quota')]); start = calls().length; dd(1, 'run', 'broken'); assert.equal(calls().length, start);
  config([route('pass', 'claude'), route('pass')], [route('pass', 'claude'), route('pass')], {agent_path_override:{...paths,claude:join(scratch,'absent')}});
  dd(0, 'review', 'main'); assert.equal(check(0, 'missing binary').judge.route, 'answerer:opencode');
  writeFileSync(join(home,'config.yaml'), JSON.stringify({agent:'codex', agent_config:{codex:{model:'gpt-6-luna',effort:'low'}},agent_path_override:paths,agent_timeout:'1s'}));
  start = calls().length; dd(0,'review','main'); assert.deepEqual([...new Set(calls().slice(start).map(c=>c.model))], ['gpt-6-luna','gpt-6.1-terra']);
  env.DD_FAIL_TERRA = '1'; start = calls().length; dd(0,'review','main'); delete env.DD_FAIL_TERRA;
  assert.deepEqual([...new Set(calls().slice(start).map(c=>c.model))], ['gpt-6-luna','gpt-6.1-terra','claude-haiku-5-5']);
  transcript.push('PASS: YAML and tool-models author/judge fallback; quota, auth, missing model, missing binary and silent timeout; terminal wrong, malformed, active timeout and product failure; default Luna to Terra.');
} finally {
  writeFileSync(join(out,'route-fallback.log'), transcript.join('\n')+'\n');
  writeFileSync(join(out,'steps.json'), JSON.stringify({target:{version:JSON.parse(readFileSync(new URL('../package.json',import.meta.url))).version},start:'isolated greeting CLI and deterministic harness processes',steps:['capture the greeting','force primary route availability failures','check configured and tagged order and actual route records','reject terminal failures without fallback'],result:'author and judge availability fallbacks preserve product failures'}));
  rmSync(scratch, { recursive: true, force: true });
}
