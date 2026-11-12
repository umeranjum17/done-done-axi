#!/usr/bin/env node
// Test plan apply proof (Q14): on the improve-test fixture, `tests improve --apply` refuses a plan that would drop the only test
// catching a fault, writes nothing for it, then applies the drop class (slop and slow-duplicate) and the move class on their own,
// keeps every fault the plan said was caught, measures a shorter summed time, and a gap-filling journey added through the normal
// `journey add` writer closes the one gap. A stub agent answers `journey add`, so the proof needs no model and spends nothing.
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from 'node:process';

const { DONE_DONE_EVIDENCE_ROOT: evidence } = env;
if (!evidence) throw new Error('missing DONE_DONE_EVIDENCE_ROOT');

const cli = join(process.cwd(), 'dist/cli.js');
const scratch = mkdtempSync(join(tmpdir(), 'apply-'));
const dir = join(scratch, 'repo'), bin = join(scratch, 'bin'), ddHome = join(scratch, 'dd-home'), plans = join(scratch, 'plans');
for (const d of [bin, ddHome, plans]) mkdirSync(d);
let log = '';
try {
  cpSync('test/fixtures/improve-test', dir, { recursive: true });
  const skill = join(dir, '.agents/skills/done-done-verify-improve-test');
  mkdirSync(join(skill, 'features'), { recursive: true });
  writeFileSync(join(skill, 'SKILL.md'), '# Math tool\n\nLaunch: node src/math.mjs\n');
  writeFileSync(join(skill, 'features/README.md'), '# Features\n');

  // The stub agent: the `claude` binary journey add runs, answering with a journey that drives the untested isBig line.
  const script = `import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isBig } from '../src/math.mjs';
assert.equal(isBig(100), true);
assert.equal(isBig(99), false);
writeFileSync(join(process.env.DONE_DONE_EVIDENCE_ROOT, 'is-big.txt'), 'isBig(100) true, isBig(99) false\\n');
writeFileSync(join(process.env.DONE_DONE_EVIDENCE_ROOT, 'steps.json'), JSON.stringify({ target: { version: '1' }, start: 'math tool', steps: ['call isBig at the threshold'], result: 'isBig(100) true, isBig(99) false' }));
`;
  const answer = { name: 'is-big', title: 'Big numbers', source: 'src/math.mjs', script, checks: 'isBig is true from 100.', spends: '', blocker: '' };
  writeFileSync(join(bin, 'claude'), `#!${process.execPath}\nrequire('node:fs').readFileSync(0);\nprocess.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: '', structured_output: ${JSON.stringify(answer)} }));\n`, { mode: 0o755 });
  writeFileSync(join(ddHome, 'config.yaml'), `agent: claude\nagent_path_override: { claude: ${JSON.stringify(join(bin, 'claude'))} }\n`);

  const gitConfig = join(scratch, 'gitconfig');
  writeFileSync(gitConfig, '');
  const host = Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('GIT_CONFIG')));
  const base = { ...host, HOME: scratch, DONE_DONE_HOME: ddHome, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Umer', GIT_AUTHOR_EMAIL: 'umer@example.com', GIT_COMMITTER_NAME: 'Umer', GIT_COMMITTER_EMAIL: 'umer@example.com' };
  for (const k of ['DONE_DONE_DRIVE', 'DONE_DONE_RUN_ID', 'DONE_DONE_EVIDENCE_ROOT', 'CI']) delete base[k];
  const sh = (cmd) => spawnSync('sh', ['-c', cmd], { cwd: dir, encoding: 'utf8', env: base }).stdout;
  const dd = (label, ...args) => {
    const r = spawnSync('node', [cli, ...args, '--json'], { cwd: dir, encoding: 'utf8', env: base });
    log += `\n=== ${label}: done-done ${args.join(' ')} (exit ${r.status}) ===\n${r.stdout}${r.stderr}`;
    return { status: r.status, doc: JSON.parse(r.stdout) };
  };
  const commit = (msg) => sh(`git add -A && git commit -q -m ${JSON.stringify(msg)}`);
  const journeys = () => [...readFileSync(join(dir, '.done-done.yaml'), 'utf8').matchAll(/^ {2}([\w-]+):\s*$/gm)].map((m) => m[1]).sort();
  sh('git init -q -b main'); commit('init');
  assert.equal(sh('git status --porcelain'), '', 'the fixture starts clean');

  const proposal = dd('plan', 'tests', 'improve', '--plan-only');
  assert.equal(proposal.status, 0);
  const planFile = join(plans, 'plan.json');
  writeFileSync(planFile, JSON.stringify(proposal.doc));
  const row = Object.fromEntries(proposal.doc.rows.map((x) => [x.test, x]));
  assert.equal(row.slop.action, 'drop'); assert.equal(row['slow-duplicate'].action, 'drop'); assert.equal(row['local-check'].action, 'move');
  assert.equal(proposal.doc.gaps.length, 1);

  // A plan that also drops `real` would leave the add and isEven faults caught by no test: refused, nothing written.
  const greedy = structuredClone(proposal.doc);
  greedy.rows.find((x) => x.test === 'real').action = 'drop';
  const greedyFile = join(plans, 'greedy.json');
  writeFileSync(greedyFile, JSON.stringify(greedy));
  const refused = dd('greedy plan', 'tests', 'improve', '--apply', 'drop', '--plan', greedyFile);
  assert.equal(refused.status, 1, 'a plan losing fault coverage is refused');
  assert.equal(refused.doc.stage, 'refused');
  assert.match(refused.doc.refused, /coverage lost/);
  assert.match(refused.doc.refused, /src\/math\.mjs/);
  assert.equal(sh('git status --porcelain'), '', 'a refused plan writes nothing');
  log += 'git status --porcelain is empty after the refused plan\n';

  // The drop class: two redundant tests go, every fault the plan said was caught is still caught, the summed time falls.
  const dropped = dd('drop class', 'tests', 'improve', '--apply', 'drop', '--plan', planFile);
  assert.equal(dropped.status, 0);
  assert.equal(dropped.doc.stage, 'applied');
  assert.deepEqual(dropped.doc.tests.sort(), ['slop', 'slow-duplicate']);
  assert.ok(dropped.doc.seconds.after < dropped.doc.seconds.before, `time falls: ${JSON.stringify(dropped.doc.seconds)}`);
  assert.ok(dropped.doc.lines > 0 && dropped.doc.lines <= 300);
  assert.deepEqual(journeys(), ['local-check', 'real']);
  assert.ok(!existsSync(join(dir, 'tests/slop.mjs')) && !existsSync(join(dir, 'tests/slow-duplicate.mjs')), 'the dropped scripts are deleted');
  assert.ok(existsSync(join(dir, 'tests/real.mjs')), 'the kept script stays');
  commit('drop two redundant tests');
  log += `-> drop class: ${dropped.doc.tests.join(', ')} removed; ${dropped.doc.seconds.before}s -> ${dropped.doc.seconds.after}s\n`;

  // The move class is its own change set, from a fresh plan.
  const second = dd('plan after drop', 'tests', 'improve', '--plan-only');
  writeFileSync(planFile, JSON.stringify(second.doc));
  const moved = dd('move class', 'tests', 'improve', '--apply', 'move', '--plan', planFile);
  assert.equal(moved.status, 0);
  assert.deepEqual(moved.doc.tests, ['local-check']);
  assert.match(readFileSync(join(dir, '.done-done.yaml'), 'utf8'), /local-check:\n {4}command: node tests\/local-check\.mjs\n {4}size: ci/);
  commit('move local-check to ci');

  // The gap goes to normal QA writing: journey add writes a journey for isBig, and the next plan has no gap.
  const added = spawnSync('node', [cli, 'journey', 'add', 'isBig is true from 100'], { cwd: dir, encoding: 'utf8', env: base });
  log += `\n=== fill the gap: done-done journey add (exit ${added.status}) ===\n${added.stdout}${added.stderr}`;
  assert.equal(added.status, 0, `journey add wrote the gap-filling journey: ${added.stderr}${added.stdout}`);
  assert.ok(journeys().includes('is-big'));
  commit('is-big journey');
  const after = dd('plan after gap fill', 'tests', 'improve', '--plan-only');
  assert.equal(after.doc.gaps.length, 0, 'the gap is closed');
  assert.equal(Object.fromEntries(after.doc.rows.map((x) => [x.test, x.action]))['is-big'], 'keep');

  writeFileSync(join(evidence, 'test-apply.log'), log);
  writeFileSync(join(evidence, 'steps.json'), JSON.stringify({
    target: { version: JSON.parse(readFileSync('package.json', 'utf8')).version },
    start: 'improve-test fixture committed clean: real, slop, slow-duplicate and local-check tests with one untested isBig line',
    steps: ['Save the proposal', 'Apply a plan that also drops real and see it refused', 'Apply the drop class', 'Apply the move class', 'Add a journey for the gap through journey add', 'Plan again'],
    result: `refused coverage loss with a clean tree; dropped slop and slow-duplicate (${dropped.doc.seconds.before}s to ${dropped.doc.seconds.after}s); moved local-check to ci; is-big closes the gap`,
  }, null, 2));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
