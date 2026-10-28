// End-to-end: output-quality evals. Drives the built CLI against throwaway git repos; the user's agent and judge are stubs, never a model.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { decode } from '@toon-format/toon';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'dist', 'cli.js');
const toon = (r) => decode(r.out);
const STEPS = { target: { version: '1.0.0' }, start: 'a fresh helper', steps: ['paste a posting', 'read the rewrite'], result: 'the helper rewrites a posting' };
const BLOCK = 'evals:\n  enabled: true\n  prompts: evals/prompts.jsonl\n  rubric: evals/rubric.md\n  app: { command: node app.mjs }\n  baseline: { model: stub-judge }\n';

// The stub judge (a gemini binary through agent_path_override): answers the baseline, the pairwise question and the capture question.
// DD_EVAL_APP picks who wins (win, lose or tie); the app's answer is the one that starts with the helper's `Job title:` field.
function stubJudge(dir) {
  const bin = join(dir, 'judge-gemini');
  writeFileSync(bin, `#!${process.execPath}
const fs = require('node:fs');
const input = fs.readFileSync(0, 'utf8');
if (process.env.DD_EVAL_LOG) fs.appendFileSync(process.env.DD_EVAL_LOG, 'x\\n');
const reply = (v) => process.stdout.write(JSON.stringify({ response: JSON.stringify(v) }));
if (/You are judging two answers/.test(input)) {
  const part = (l) => (input.match(new RegExp('Answer ' + l + ':\\\\n<<<\\\\n([\\\\s\\\\S]*?)\\\\n>>>')) || [])[1] || '';
  const appIsA = part('A').includes('Job title:');
  const mode = process.env.DD_EVAL_APP || 'win';
  const crit = input.match(/every criterion \\(([^)]*)\\)/)[1].split(', ');
  const sc = (n) => Object.fromEntries(crit.map((c) => [c, n]));
  const [app, base] = mode === 'win' ? [0.9, 0.4] : mode === 'lose' ? [0.2, 0.8] : [0.6, 0.6];
  reply({ scores_a: sc(appIsA ? app : base), scores_b: sc(appIsA ? base : app), winner: mode === 'tie' ? 'tie' : (mode === 'win') === appIsA ? 'A' : 'B', reason: 'judge says ' + mode });
} else if (/Answer the request below/.test(input)) reply({ output: 'a plain answer' });
else {
  const rel = { probabilities: { correct: 0.95, wrong: 0.03, unclear: 0.02 }, rationale: 'It shows the outcome.', personReason: 'It shows the outcome.', parts: [], covers: [] };
  const keys = [...new Set([...input.matchAll(/capture_\\d+/g)].map((m) => m[0]))];
  reply(keys.length ? Object.fromEntries(keys.map((k) => [k, rel])) : { relevance: rel });
}
`, { mode: 0o755 });
  return bin;
}

// A throwaway git repo holding `files`, the user's global config (a stub judge, the claude agent) and an env that never touches the machine's.
function repoOf(files) {
  const dir = mkdtempSync(join(tmpdir(), 'dd-evals-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo');
  const bins = join(dir, 'bin');
  mkdirSync(bins);
  writeFileSync(join(dir, 'gitconfig'), '');
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_CONFIG'))), GIT_CONFIG_GLOBAL: join(dir, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', DONE_DONE_HOME: join(dir, 'home'), JOB_HELPER_STUB: '1', DD_EVAL_LOG: join(dir, 'calls'), PATH: `${bins}:${process.env.PATH}`, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
  mkdirSync(env.DONE_DONE_HOME);
  writeFileSync(join(env.DONE_DONE_HOME, 'config.yaml'), `agent: claude\njudge:\n  route: answerer:gemini\n  model: stub-judge\nagent_path_override: { gemini: ${JSON.stringify(stubJudge(dir))} }\n`);
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, f)), { recursive: true });
    writeFileSync(join(repo, f), body);
  }
  const sh = (...a) => execFileSync('git', a, { cwd: repo, env, stdio: 'pipe' });
  sh('init', '-q', '-b', 'main');
  const dd = (...args) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8' });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  const commit = (msg = 'work') => { sh('add', '-A'); sh('commit', '-qm', msg); return sh('rev-parse', 'HEAD').toString().trim(); };
  const calls = () => (existsSync(env.DD_EVAL_LOG) ? readFileSync(env.DD_EVAL_LOG, 'utf8').trim().split('\n').length : 0);
  return { dir, repo, bins, env, sh, dd, commit, calls };
}

// The job-helper example as its own repo, with a journey that proves it ran and the evals block on.
function jobRepo(extra = '') {
  const files = { '.gitignore': '.proof/\n', '.done-done.yaml': `app: job-helper\nevidence:\n  root: .proof\njourneys:\n  shots:\n    command: node journey.mjs\n    core: true\n${BLOCK}${extra}`,
    'journey.mjs': `import { execFileSync } from 'node:child_process';\nimport { writeFileSync } from 'node:fs';\nconst out = process.env.DONE_DONE_EVIDENCE_ROOT;\nwriteFileSync(out + '/rewrite.txt', execFileSync('node', ['app.mjs'], { input: 'Title: Barista\\nLocation: Leeds\\nPay: 11.50\\nApply: jobs@example.com' }));\nwriteFileSync(out + '/steps.json', JSON.stringify(${JSON.stringify(STEPS)}));\n` };
  const t = repoOf(files);
  cpSync(join(ROOT, 'docs/examples/job-helper'), t.repo, { recursive: true, filter: (s) => !s.endsWith('README.md') || s.includes('evals') });
  t.commit('init');
  return t;
}

// The claude agent init asks: a stub that answers with `proposal` as its structured output.
const agentStub = (t, proposal) => writeFileSync(join(t.bins, 'claude'), `#!${process.execPath}\nrequire('node:fs').readFileSync(0, 'utf8');\nprocess.stdout.write(JSON.stringify({ type: 'result', is_error: false, structured_output: ${JSON.stringify(proposal)} }));\n`, { mode: 0o755 });
const proposal = (source = 'src/index.js') => ({
  app_command: 'node src/index.js', app_command_source: source,
  prompts: Array.from({ length: 12 }, (_, i) => ({ id: `case-${i}`, input: `question ${i}`, source: 'README.md' })),
  rubric: [{ criterion: 'accuracy', description: 'states only true things' }, { criterion: 'tone', description: 'plain and kind' }],
});
const aiFiles = { 'package.json': '{"name":"qa","dependencies":{"openai":"^4.0.0"}}\n', 'src/index.js': 'console.log("hi");\n', 'README.md': '# qa\nAsk a question.\n' };

test('init scaffolds the evals for an AI-output app from the agent\'s proposal, and --no-evals, --evals and a bad proposal behave', () => {
  const t = repoOf(aiFiles);
  t.commit('init');
  agentStub(t, proposal());
  // The verify skill is not this test's subject; a skill folder already there stops that agent call.
  mkdirSync(join(t.repo, '.agents/skills/done-done-verify-repo'), { recursive: true });
  writeFileSync(join(t.repo, '.agents/skills/done-done-verify-repo/SKILL.md'), '# repo\n');
  const r = t.dd('init');
  assert.equal(r.code, 0, r.out);
  assert.match(toon(r).evals, /^on \(AI-output app: a model provider SDK in package\.json\); wrote evals\/prompts\.jsonl, evals\/rubric\.md, evals\/README\.md and an evals block: 12 prompts/);
  const lines = readFileSync(join(t.repo, 'evals/prompts.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 12);
  assert.deepEqual(Object.keys(lines[0]), ['id', 'input']);
  assert.match(readFileSync(join(t.repo, 'evals/rubric.md'), 'utf8'), /^- accuracy: states only true things$/m);
  const cfg = parse(readFileSync(join(t.repo, '.done-done.yaml'), 'utf8'));
  assert.deepEqual(cfg.evals, { enabled: true, prompts: 'evals/prompts.jsonl', rubric: 'evals/rubric.md', app: { command: 'node src/index.js' }, baseline: { model: 'stub-judge' }, bar: { min_win_rate: 0.7, min_score: 0.75 } });
  assert.equal(t.dd('history').code, 0, 'the written block is a valid config');
  assert.match(toon(t.dd('init')).evals, /^unchanged \(evals\.enabled is true/, 'a second init keeps the block');
  // --no-evals on a detected app records the choice; the two flags contradict; --evals forces on for a non-AI repo.
  const off = repoOf(aiFiles);
  off.commit('init');
  assert.match(toon(off.dd('init', '--no-evals')).evals, /--no-evals recorded evals\.enabled: false/);
  assert.equal(parse(readFileSync(join(off.repo, '.done-done.yaml'), 'utf8')).evals.enabled, false);
  assert.equal(off.dd('init', '--evals', '--no-evals').code, 2);
  const forced = repoOf({ 'src/index.js': 'console.log(1);\n', 'README.md': '# x\n' });
  forced.commit('init');
  agentStub(forced, proposal());
  assert.match(toon(forced.dd('init', '--evals')).evals, /^on \(not an AI-output app/);
  // A proposal citing an untracked file is refused whole: exit 1, no files, no block.
  const bad = repoOf(aiFiles);
  bad.commit('init');
  agentStub(bad, proposal('src/missing.js'));
  const fail = bad.dd('init');
  assert.equal(fail.code, 1, fail.out);
  assert.match(toon(fail).evals, /^not written: claude's proposal is unusable: app_command_source cites src\/missing\.js, which is not a tracked file/);
  assert.equal(existsSync(join(bad.repo, 'evals')), false);
  assert.equal(parse(readFileSync(join(bad.repo, '.done-done.yaml'), 'utf8')).evals, undefined);
});

test('eval runs the full set against a stub judge: sealed results.jsonl and a one-page report, exit 0 pass, 1 fail, 2 error', () => {
  const t = jobRepo();
  const pass = t.dd('eval');
  assert.equal(pass.code, 0, pass.out);
  const o = toon(pass);
  assert.deepEqual([o.result, o.prompts, o.win_rate, o.model_calls], ['pass', '12 of 12', 1, 24]);
  assert.equal(t.calls(), 24, 'one baseline call and one judge call per prompt, and no more');
  const dir = join(t.repo, o.report.replace(/\/report\.md$/, ''));
  const rows = readFileSync(join(dir, 'results.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 12);
  for (const k of ['id', 'input', 'app_output', 'baseline_output', 'scores', 'winner', 'reason', 'commit', 'run_id']) assert.ok(k in rows[0], k);
  assert.deepEqual([rows[0].winner, rows[0].baseline_output, rows[0].scores.facts], ['app', 'a plain answer', 0.9]);
  assert.ok(rows.some((r, i) => i % 2 && r.winner === 'app'), 'the app wins from either side of the pair');
  const report = readFileSync(join(dir, 'report.md'), 'utf8');
  for (const part of ['# job-helper evals: PASS', 'win rate at least 70%', 'prompts: 12 of 12', 'win rate vs baseline: 100%', 'mean score: 0.90', '- facts: 0.90', `commit: ${t.sh('rev-parse', 'HEAD').toString().trim()}`, 'judge: answerer:gemini stub-judge', 'model calls: 24', 'none']) assert.ok(report.includes(part), `${part}\n${report}`);
  // The app loses: exit 1, and the report names the failing prompts with the judge's reason.
  t.env.DD_EVAL_APP = 'lose';
  const fail = t.dd('eval');
  assert.equal(fail.code, 1, fail.out);
  assert.match(readFileSync(join(t.repo, toon(fail).report), 'utf8'), /# job-helper evals: FAIL[\s\S]*- barista-basic \(baseline\): judge says lose/);
  // A crashing app command is a lost prompt, not a skipped one.
  t.env.DD_EVAL_APP = 'win';
  writeFileSync(join(t.repo, '.done-done.yaml'), readFileSync(join(t.repo, '.done-done.yaml'), 'utf8').replace('  app: { command: node app.mjs }', '  app: { command: "echo boom >&2; exit 3" }'));
  t.commit('break the app');
  const crash = t.dd('eval');
  assert.equal(crash.code, 1, crash.out);
  assert.match(readFileSync(join(t.repo, toon(crash).report), 'utf8'), /barista-basic \(baseline\): app failed: exited 3: boom/);
  // No judge set: exit 2 with the command that sets one, and nothing is run.
  writeFileSync(join(t.env.DONE_DONE_HOME, 'config.yaml'), 'agent: claude\n');
  const none = t.dd('eval');
  assert.equal(none.code, 2, none.out);
  assert.match(none.out, /init --judge/);
});

test('check and receipt refuse without a passing eval at this commit, record `evals: pass <run>`, and gate enforces it from the receipt', () => {
  const t = jobRepo();
  const prove = () => {
    const run = t.dd('run', 'shots');
    assert.equal(run.code, 0, run.out);
    return t.dd('receipt', '--outcome', 'the helper rewrites a posting', `.proof/${toon(run).run_id}/rewrite.txt`);
  };
  const missing = prove();
  assert.equal(missing.code, 2, missing.out);
  assert.match(missing.out, /evals are on \(evals\.enabled\) and no full eval run exists/);
  assert.match(missing.out, /done-done eval/, 'the exact next command');
  t.env.DD_EVAL_APP = 'lose';
  assert.equal(t.dd('eval').code, 1);
  const failing = prove();
  assert.equal(failing.code, 2, failing.out);
  assert.match(failing.out, /newest eval run \S+ for \S+ failed \(win rate 0, mean score 0\.2/);
  t.env.DD_EVAL_APP = 'win';
  const ev = t.dd('eval');
  assert.equal(ev.code, 0, ev.out);
  const ok = prove();
  assert.equal(ok.code, 0, ok.out);
  assert.equal(toon(ok).evals, `pass ${toon(ev).run_id}`);
  const head = t.sh('rev-parse', 'HEAD').toString().trim();
  const file = join(t.repo, '.proof', '.done-done', 'receipts', `${head}.json`);
  const rec = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(rec.evals, `pass ${toon(ev).run_id}`);
  assert.equal(t.dd('receipt', '--verify', head).code, 0);
  // The model-free gate: the receipt committed under .done-done-receipts/ passes, and the same receipt without its evals line fails.
  const gate = (body) => {
    mkdirSync(join(t.repo, '.done-done-receipts'), { recursive: true });
    writeFileSync(join(t.repo, '.done-done-receipts', `${head}.json`), JSON.stringify(body));
    t.commit('receipt');
    return t.dd('gate');
  };
  const { evals, ...bare } = rec;
  const refused = gate(bare);
  assert.equal(refused.code, 1, refused.out);
  assert.match(refused.out, /FAIL: .*records no evals line, and evals\.enabled is true.*done-done eval/);
  const passed = gate(rec);
  assert.equal(passed.code, 0, passed.out);
});

// init's verify skill: an AI-output app also gets 3 to 6 proposed behaviour journeys; any other repo's skill and agent call are unchanged.
const scaffold = (over = {}) => ({
  surface: 'CLI', first_release: false,
  launch: { steps: 'node src/index.js', source: 'src/index.js', safe: true, why: 'the stub mode of src/index.js with no key' },
  ready: 'the command exits 0', harness: 'a terminal', observe: 'terminal transcripts', isolate: 'each run uses its own folder',
  features: [{ title: 'Ask a question', reach: 'the ask command', drive: 'run node src/index.js ask hello', source: 'src/index.js', capture: 'text', core: true, upgrade: false }],
  ...over,
});
const journey = (n, source = 'README.md') => ({ title: `Case ${n}`, user_does: `ask question ${n} in the app's own words`, user_sees: `a plain answer to question ${n}`, source });
// Logs the prompt and the schema the agent was given, so a test can read what init asked.
const spyAgent = (t, answer) => writeFileSync(join(t.bins, 'claude'), `#!${process.execPath}\nconst fs = require('node:fs');\nfs.appendFileSync(${JSON.stringify(join(t.bins, 'calls.jsonl'))}, JSON.stringify({ args: process.argv.slice(2), stdin: fs.readFileSync(0, 'utf8') }) + '\\n');\nprocess.stdout.write(JSON.stringify({ type: 'result', is_error: false, structured_output: ${JSON.stringify(answer)} }));\n`, { mode: 0o755 });
const asked = (t) => readFileSync(join(t.bins, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const skillOf = (t) => readFileSync(join(t.repo, '.agents/skills/done-done-verify-repo/SKILL.md'), 'utf8');

test('init proposes behaviour journeys for an AI-output app, each accepted or dropped by the user, and changes nothing for other apps', () => {
  const ai = repoOf(aiFiles);
  ai.commit('init');
  spyAgent(ai, scaffold({ behaviour: [journey(1), journey(2), journey(3, 'src/index.js')] }));
  const r = ai.dd('init', '--no-evals');
  assert.equal(r.code, 0, r.out);
  assert.match(toon(r).verify_skill, /^written by claude; proposed 3 behaviour journeys \(AI-output app: a model provider SDK in package\.json\)/);
  const [call] = asked(ai);
  assert.match(call.stdin, /behaviour: this app's output is a model's \(a model provider SDK in package\.json\), so also propose 3 to 6 basic behaviour journeys/);
  assert.ok(call.args.some((a) => a.includes('"behaviour"')), 'the schema asks for behaviour');
  const body = skillOf(ai);
  assert.match(body, /^## Behaviour journeys \(proposed\)\n/m);
  assert.match(body, /graded by the judge the user chose; never pick a judge/);
  assert.equal(body.match(/^  Accept: `done-done journey add '/gm).length, 3, 'every journey carries its accept command');
  assert.match(body, /- Case 1: ask question 1 in the app's own words\. Expect: a plain answer to question 1\. \(`README\.md`\)\n  Accept: `done-done journey add 'Case 1: ask question 1 in the app'\\''s own words; expect a plain answer to question 1'`/);
  const featureMap = readFileSync(join(ai.repo, '.agents/skills/done-done-verify-repo/features/README.md'), 'utf8');
  assert.doesNotMatch(featureMap, /Case 1/, 'a proposal is not in the feature map until accepted');
  // Dropping a journey is deleting its two lines; the skill still passes maintain.
  assert.equal(parse(readFileSync(join(ai.repo, '.done-done.yaml'), 'utf8')).journeys?.['case-1'], undefined, 'nothing is added to the config unaccepted');

  // A proposal outside 3 to 6 journeys, or citing an untracked file, writes no skill.
  for (const [behaviour, why] of [[[journey(1), journey(2)], /has 2 behaviour journeys/], [[journey(1), journey(2), journey(3, 'src/gone.js')], /src\/gone\.js, which is not a tracked file/]]) {
    const bad = repoOf(aiFiles);
    bad.commit('init');
    spyAgent(bad, scaffold({ behaviour }));
    const f = bad.dd('init', '--no-evals');
    assert.equal(f.code, 1, f.out);
    assert.match(toon(f).verify_skill, why);
    assert.equal(existsSync(join(bad.repo, '.agents/skills/done-done-verify-repo')), false);
  }

  // A CLI repo: no behaviour in the prompt or schema, and no section in the skill.
  const cli = repoOf({ 'package.json': '{"private":true,"bin":{"t":"bin/t.js"},"dependencies":{"commander":"^12"}}\n', 'bin/t.js': 'import { program } from "commander";\n', 'src/index.js': 'console.log(1);\n' });
  cli.commit('init');
  spyAgent(cli, scaffold());
  const c = cli.dd('init');
  assert.equal(c.code, 0, c.out);
  assert.equal(toon(c).verify_skill, 'written by claude');
  const [plain] = asked(cli);
  assert.doesNotMatch(plain.stdin, /behaviour/);
  assert.ok(!plain.args.some((a) => a.includes('behaviour')), 'the schema is unchanged');
  assert.doesNotMatch(skillOf(cli), /Behaviour journeys|journey add/);
});
