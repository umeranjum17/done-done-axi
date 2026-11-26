#!/usr/bin/env node
// Affected journey selection proof: `done-done affected` follows shell sources, imports and path calls from a journey's command to a changed file,
// and sends an unknown file or a configured global file to the whole local tier, each with its reason.
// The shadow plan (`affected --shadow`) is checked on a synthetic 92-leaf owner fixture (core) plus a one-leaf owner (web) and a synthetic
// node_modules/.bin/jest: declared inputs pick each owner's tests, the runner reports one leaf, the other 91 are extras. Renames, deletions,
// glob members, a subprocess input the declaration restores, a missing runner, a report for another revision, JUnit parameter ids, retries
// and summary-only counts are each checked. On the same 92-leaf fixture the existing gate (`done-done affected main`, the control) is driven
// first and its result and wall time recorded; the shadow plan's wall time is recorded beside it. Budget is not measured. Synthetic fixtures only; no model, no network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const evidence = process.env.DONE_DONE_EVIDENCE_ROOT;
if (!evidence) throw new Error('missing DONE_DONE_EVIDENCE_ROOT');
const cli = join(process.cwd(), 'dist/cli.js');
const scratch = mkdtempSync(join(tmpdir(), 'affected-select-'));
const gitConfig = join(scratch, 'gitconfig');
writeFileSync(gitConfig, '');
const host = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_CONFIG')));
const env = { ...host, HOME: scratch, DONE_DONE_HOME: join(scratch, 'dd-home'), GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Umer', GIT_AUTHOR_EMAIL: 'umer@example.com', GIT_COMMITTER_NAME: 'Umer', GIT_COMMITTER_EMAIL: 'umer@example.com' };
delete env.DONE_DONE_DRIVE;
let log = '';
let controlRecord = null;
let shadowRecord = null;
const sh = (cwd, cmd, ...args) => {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
  if (r.status !== 0 && cmd === 'git') throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r;
};

// A tiny repo: app-check runs a shell script that sources a helper, which runs a node tool that imports a util and calls a fixture folder by path.
const files = {
  '.done-done.yaml': 'app: fixture\naffected:\n  global_paths: ["package.json"]\njourneys:\n  app-check:\n    command: sh scripts/run.sh\n    tier: ci\n  local-a:\n    command: node local/a.mjs\n    tier: local\n  local-b:\n    command: node local/b.mjs\n    tier: local\n',
  'scripts/run.sh': '. ./lib.sh\ncheck\n',
  'scripts/lib.sh': 'check() { node tools/check.mjs; }\n',
  'tools/check.mjs': "import { add } from './util.mjs';\nimport { readdirSync } from 'node:fs';\nconsole.log(add(1, 2), readdirSync('fixtures/data'));\n",
  'tools/util.mjs': 'export const add = (a, b) => a + b;\n',
  'fixtures/data/one.json': '{"a":1}\n',
  'local/a.mjs': 'console.log("a");\n',
  'local/b.mjs': 'console.log("b");\n',
  'notes/stray.txt': 'scratch\n',
  'package.json': '{"name":"fixture"}\n',
};

function select(name, change) {
  const dir = join(scratch, name);
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), text);
  }
  sh(dir, 'git', 'init', '-q', '-b', 'main');
  sh(dir, 'git', 'add', '-A');
  sh(dir, 'git', 'commit', '-qm', 'base');
  sh(dir, 'git', 'checkout', '-qb', 'feat');
  writeFileSync(join(dir, change), `${files[change]}// changed\n`);
  sh(dir, 'git', 'add', '-A');
  sh(dir, 'git', 'commit', '-qm', 'change');
  const r = sh(dir, 'node', cli, '--json', 'affected', 'main');
  log += `\n=== ${name}: done-done affected main after changing ${change} (exit ${r.status}) ===\n${r.stdout}${r.stderr}`;
  const out = JSON.parse(r.stdout);
  return out;
}

const names = (out) => out.journeys.map((j) => j.name).sort().join(',');
const cases = [
  // Three hops: run.sh sources lib.sh, which runs check.mjs, which imports util.mjs.
  ['import-chain', 'tools/util.mjs', (o) => names(o) === 'app-check' && o.journeys[0].why.includes('scripts/run.sh -> scripts/lib.sh -> tools/check.mjs -> tools/util.mjs') && !o.fallback],
  ['path-call', 'fixtures/data/one.json', (o) => names(o) === 'app-check' && o.journeys[0].why.includes('tools/check.mjs -> fixtures/data/') && !o.fallback],
  ['unknown-file', 'notes/stray.txt', (o) => names(o) === 'local-a,local-b' && o.journeys.every((j) => j.why.includes('whole local tier') && j.why.includes('1 changed file is in no feature or journey')) && o.fallback.endsWith('so the whole local tier runs')],
  ['global-file', 'package.json', (o) => names(o) === 'local-a,local-b' && o.journeys.every((j) => j.why.includes('a global file changed (package.json)')) && o.fallback.includes('a global file changed')],
];

// ---- Shadow plans on a synthetic owner fixture. Everything is generated here and committed clean; no model is called.
const CORE = Array.from({ length: 92 }, (_, i) => `tests/core/leaf-${String(i).padStart(3, '0')}.test.mjs`);
const OWNERS = {
  core: { tests: ['tests/core/**/*.test.mjs'], inputs: ['src/core/**', 'src/shared.mjs', 'fixtures/core/**'] },
  web: { tests: ['tests/web/**/*.test.mjs'], inputs: ['src/web/**', 'src/shared.mjs'] },
};
// A synthetic runner: `--version` prints a version; `--findRelatedTests src/core/value.mjs --listTests --json` prints a JSON array
// with one core leaf; any other input prints an empty JSON array.
const FAKE_JEST = `#!${process.execPath}
const args = process.argv.slice(2);
if (args.includes('--version')) {
  process.stdout.write('29.7.0-synthetic\\n');
  process.exit(0);
}
const at = args.indexOf('--findRelatedTests');
const reported = at >= 0 && args[at + 1] === 'src/core/value.mjs' ? ['tests/core/leaf-000.test.mjs'] : [];
process.stdout.write(JSON.stringify(reported) + '\\n');
`;
// 93 JUnit leaves: leaf-000 has two parameterised cases (ids and an entity in the name), leaf-001 passes after two reruns,
// leaf-002 is skipped, the rest pass.
const JUNIT = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<testsuites>',
  '  <testsuite name="core" tests="93" failures="0" skipped="1">',
  '    <testcase id="leaf-000-p1" name="value adds [1, 2]" classname="core.leaf-000" file="tests/core/leaf-000.test.mjs"/>',
  '    <testcase id="leaf-000-p2" name="value adds [2, &amp; 3]" classname="core.leaf-000" file="tests/core/leaf-000.test.mjs"/>',
  '    <testcase id="leaf-001" name="flaky case" classname="core.leaf-001" file="tests/core/leaf-001.test.mjs"><rerunFailure message="retry 1"/><rerunFailure message="retry 2"/></testcase>',
  '    <testcase id="leaf-002" name="skipped case" classname="core.leaf-002" file="tests/core/leaf-002.test.mjs"><skipped/></testcase>',
  ...CORE.slice(3).map((file, i) => {
    const n = String(i + 3).padStart(3, '0');
    return `    <testcase id="leaf-${n}" name="case ${n}" classname="core.leaf-${n}" file="${file}"/>`;
  }),
  '  </testsuite>',
  '</testsuites>',
  '',
].join('\n');
// Summary-only: counts with no testcase leaves, so no leaf can be identified.
const SUMMARY = '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites><testsuite name="core" tests="93" failures="0"/></testsuites>\n';

const write = (dir, p, text) => {
  mkdirSync(dirname(join(dir, p)), { recursive: true });
  writeFileSync(join(dir, p), text, { mode: p.endsWith('/jest') ? 0o755 : 0o644 });
};

function shadowBase({ jest = true, owners = OWNERS } = {}) {
  const base = {
    '.done-done.yaml': JSON.stringify({ app: 'fixture', affected: { owners }, journeys: { 'local-a': { command: 'node local/a.mjs', tier: 'local' }, 'local-b': { command: 'node local/b.mjs', tier: 'local' } } }, null, 2) + '\n',
    'local/a.mjs': 'console.log("a");\n',
    'local/b.mjs': 'console.log("b");\n',
    'src/core/value.mjs': 'export const value = 1;\n',
    'src/core/old.mjs': 'export const old = 1;\n',
    'src/core/gone.mjs': 'export const gone = 1;\n',
    'src/shared.mjs': 'export const shared = 1;\n',
    'src/web/page.mjs': 'export const page = 1;\n',
    'fixtures/core/data.json': '{"n":1}\n',
    'tests/web/home.test.mjs': 'export {};\n',
  };
  for (const p of CORE) base[p] = 'export {};\n';
  if (jest) base['node_modules/.bin/jest'] = FAKE_JEST;
  return base;
}

// A throwaway repo: a base commit on main, then one committed change on feat.
function shadowRepo(name, base, change) {
  const dir = join(scratch, name);
  for (const [p, text] of Object.entries(base)) write(dir, p, text);
  sh(dir, 'git', 'init', '-q', '-b', 'main');
  sh(dir, 'git', 'add', '-A');
  sh(dir, 'git', 'commit', '-qm', 'base');
  sh(dir, 'git', 'checkout', '-qb', 'feat');
  change(dir);
  sh(dir, 'git', 'add', '-A');
  sh(dir, 'git', 'commit', '-qm', 'change');
  return dir;
}

// Runs `affected main --shadow <plan>` (outside the repo, so the tree stays clean). Returns the CLI result and the plan path.
function shadowRun(dir, label, { report, head = 'HEAD' } = {}) {
  const plan = join(scratch, `${label}.plan.json`);
  const args = [cli, '--json', 'affected', 'main', '--shadow', plan];
  if (report) args.push('--report', report, '--report-head', head);
  const r = spawnSync('node', args, { cwd: dir, env, encoding: 'utf8' });
  log += `\n=== ${label}: done-done affected main --shadow (exit ${r.status}) ===\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`;
  return { r, plan };
}

// Same, and returns the plan the CLI wrote; a CLI failure shows stdout as well as stderr.
function shadow(dir, label, opts) {
  const { r, plan } = shadowRun(dir, label, opts);
  assert.ok(existsSync(plan), `${label}: the shadow plan was not written (exit ${r.status})\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  return JSON.parse(readFileSync(plan, 'utf8'));
}

const picksOf = (plan, test) => plan.picks.filter((p) => p.test === test);
const pickedTests = (plan) => new Set(plan.picks.map((p) => p.test));
const queried = (plan, input) => plan.native.queries.find((q) => q.input === input);
const queriedFiles = (plan) => new Set(plan.native.queries.flatMap((q) => q.files));

try {
  for (const [name, change, ok] of cases) {
    const out = select(name, change);
    if (!ok(out)) throw new Error(`${name}: changing ${change} selected the wrong journeys: ${JSON.stringify(out.journeys)} fallback=${out.fallback}`);
    log += `-> ${name}: ${names(out)} (${out.journeys[0].why})\n`;
  }

  // 0. Before/control: the existing gate, `done-done affected main`, on the same 92-leaf fixture as step 1. This is the control run,
  // not a prior binary: it is the gate as it ships today. Its result and measured wall time are recorded.
  const owned = shadowRepo('shadow-owned', shadowBase(), (d) => write(d, 'src/core/value.mjs', 'export const value = 2;\n'));
  const ctlStart = performance.now();
  const ctl = spawnSync('node', [cli, '--json', 'affected', 'main'], { cwd: owned, env, encoding: 'utf8' });
  const ctlMs = Math.round(performance.now() - ctlStart);
  log += `\n=== control (existing gate, before): done-done affected main on the 92-leaf fixture (exit ${ctl.status}, wall ${ctlMs} ms) ===\nstdout:\n${ctl.stdout}\nstderr:\n${ctl.stderr}`;
  const ctlOut = JSON.parse(ctl.stdout);
  assert.equal(names(ctlOut), 'local-a,local-b', `control: the existing gate runs the whole local tier: ${ctl.stdout} ${ctl.stderr}`);
  assert.match(ctlOut.fallback, /in no feature or journey/, 'control: the fallback names the file in no feature or journey');
  controlRecord = { role: 'before/control: the existing gate, not a prior binary', command: 'done-done affected main', exit: ctl.status, selected: names(ctlOut), fallback: ctlOut.fallback, wall_ms: ctlMs };
  log += `-> control (before): existing gate selects ${names(ctlOut)} with fallback, wall ${ctlMs} ms\n`;

  // 1. A declared core input: all 92 core leaves are picked; the runner's one leaf is also a row, so 91 are extras.
  const shadowStart = performance.now();
  const p1 = shadow(owned, 'shadow-owned');
  const shadowMs = Math.round(performance.now() - shadowStart);
  assert.equal(p1.mode, 'shadow');
  assert.ok(p1.native.version, 'the runner reports a nonempty version');
  assert.equal(p1.complete, true, `shadow-owned should be complete: ${JSON.stringify(p1.fallback)}`);
  assert.equal(p1.fallback, null);
  assert.deepEqual(p1.unknown, []);
  assert.equal(pickedTests(p1).size, 92, 'all 92 core leaves are picked');
  assert.equal(p1.counts.selected, 92);
  assert.equal(p1.counts.extras, 91, 'exactly 91 extras');
  assert.equal([...pickedTests(p1)].filter((t) => !queriedFiles(p1).has(t)).length, 91);
  assert.ok(p1.picks.every((p) => p.owner === 'core' && p.input === 'src/core/value.mjs'));
  assert.equal(p1.picks.filter((p) => p.reason === 'declared input src/core/**').length, 92);
  assert.ok(picksOf(p1, 'tests/core/leaf-000.test.mjs').some((p) => p.reason === 'runner-reported file list'), 'the runner-reported leaf keeps its reason');
  shadowRecord = { role: 'after: the shadow plan', command: 'done-done affected main --shadow <plan.json>', complete: p1.complete, selected: p1.counts.selected, extras: p1.counts.extras, wall_ms: shadowMs };
  log += `-> shadow-owned: complete, 92 picked, 91 extras, wall ${shadowMs} ms\n`;

  // 2. A shared input declared by both owners selects both owners.
  const shared = shadowRepo('shadow-shared', shadowBase(), (d) => write(d, 'src/shared.mjs', 'export const shared = 2;\n'));
  const p2 = shadow(shared, 'shadow-shared');
  assert.equal(p2.complete, true, `shadow-shared should be complete: ${JSON.stringify(p2.fallback)}`);
  assert.deepEqual([...new Set(p2.picks.map((p) => p.owner))].sort(), ['core', 'web']);
  assert.equal(p2.counts.selected, 93, '92 core leaves and the web leaf');
  assert.ok(p2.picks.some((p) => p.test === 'tests/web/home.test.mjs' && p.owner === 'web' && p.reason === 'declared input src/shared.mjs'));
  log += '-> shadow-shared: core and web both selected, 93 tests\n';

  // 3. A nonempty Jest result misses a subprocess input (fixtures/core/data.json); the declaration restores all 92 leaves for it.
  const sub = shadowRepo('shadow-subprocess', shadowBase(), (d) => {
    write(d, 'src/core/value.mjs', 'export const value = 3;\n');
    write(d, 'fixtures/core/data.json', '{"n":2}\n');
  });
  const p3 = shadow(sub, 'shadow-subprocess');
  assert.equal(p3.complete, true, `shadow-subprocess should be complete: ${JSON.stringify(p3.fallback)}`);
  assert.equal(queried(p3, 'src/core/value.mjs').files.length, 1, 'jest result is nonempty');
  const dataQuery = queried(p3, 'fixtures/core/data.json');
  assert.ok(dataQuery, 'the runner was asked about the subprocess input');
  assert.deepEqual(dataQuery.files, [], 'jest misses the subprocess input');
  const restored = p3.picks.filter((p) => p.input === 'fixtures/core/data.json');
  assert.equal(new Set(restored.map((p) => p.test)).size, 92, 'the declaration restores all 92 leaves');
  assert.ok(restored.every((p) => p.owner === 'core' && p.reason === 'declared input fixtures/core/**'));
  assert.equal(p3.counts.selected, 92);
  log += '-> shadow-subprocess: jest misses fixtures/core/data.json, declaration restores 92 leaves\n';

  // 4. A rename (new path), a deletion and a glob member: each matches the declared glob and picks the core leaves.
  // The runner cannot query the deleted input, so the plan keeps the declared picks but is incomplete and falls back conservatively.
  const moved = shadowRepo('shadow-rename-delete-glob', shadowBase(), (d) => {
    mkdirSync(join(d, 'src/core/renamed'), { recursive: true });
    sh(d, 'git', 'mv', 'src/core/old.mjs', 'src/core/renamed/new.mjs');
    sh(d, 'git', 'rm', '-q', 'src/core/gone.mjs');
    write(d, 'src/core/deep/member.mjs', 'export const member = 1;\n');
  });
  const p4 = shadow(moved, 'shadow-rename-delete-glob');
  assert.equal(p4.complete, false, 'a deleted input requires conservative fallback');
  assert.ok(Array.isArray(p4.fallback) && p4.fallback.some((s) => s.includes('deleted input src/core/gone.mjs')), `fallback names the deleted input: ${JSON.stringify(p4.fallback)}`);
  assert.deepEqual(p4.unknown, []);
  for (const input of ['src/core/renamed/new.mjs', 'src/core/gone.mjs', 'src/core/deep/member.mjs']) {
    assert.ok(p4.picks.some((p) => p.input === input && p.owner === 'core' && p.reason === 'declared input src/core/**'), `${input} picks the core leaves`);
  }
  assert.equal(pickedTests(p4).size, 92, 'the deleted input retains its declared picks');
  log += '-> shadow-rename-delete-glob: renamed, deleted and glob-member inputs all picked; deletion forces fallback\n';

  // 5. Removing the core owner: its input has no owner, so the plan is incomplete and the affected run falls back to the whole local tier.
  const noOwner = shadowRepo('shadow-no-owner', shadowBase({ owners: { web: OWNERS.web } }), (d) => write(d, 'src/core/value.mjs', 'export const value = 2;\n'));
  const p5 = shadow(noOwner, 'shadow-no-owner');
  assert.equal(p5.complete, false);
  assert.ok(p5.unknown.includes('src/core/value.mjs'), 'the input has no declared owner');
  assert.ok(Array.isArray(p5.fallback) && p5.fallback.some((s) => s.includes('inputs without declared owners: src/core/value.mjs')), `fallback names the input: ${JSON.stringify(p5.fallback)}`);
  const fb = spawnSync('node', [cli, '--json', 'affected', 'main'], { cwd: noOwner, env, encoding: 'utf8' });
  log += `\n=== shadow-no-owner: done-done affected main (exit ${fb.status}) ===\n${fb.stdout}${fb.stderr}`;
  const fbOut = JSON.parse(fb.stdout);
  assert.equal(names(fbOut), 'local-a,local-b', 'without a core owner the whole local tier runs');
  assert.match(fbOut.fallback, /in no feature or journey/);
  log += '-> shadow-no-owner: incomplete plan, whole local tier fallback\n';

  // 5b. The core owner is declared at base and removed at head, while head changes src/core/value.mjs and the runner reports one core leaf.
  // The base declaration still picks the 92 core leaves; head has no owner for its tests, so the plan is incomplete and names the removal.
  const ownerRemoved = shadowRepo('shadow-owner-removed-at-head', shadowBase(), (d) => {
    write(d, '.done-done.yaml', JSON.stringify({ app: 'fixture', affected: { owners: { web: OWNERS.web } }, journeys: { 'local-a': { command: 'node local/a.mjs', tier: 'local' }, 'local-b': { command: 'node local/b.mjs', tier: 'local' } } }, null, 2) + '\n');
    write(d, 'src/core/value.mjs', 'export const value = 2;\n');
  });
  const p5b = shadow(ownerRemoved, 'shadow-owner-removed-at-head');
  assert.equal(p5b.complete, false, 'a core owner removed at head leaves the plan incomplete');
  assert.ok(Array.isArray(p5b.fallback) && p5b.fallback.some((s) => s.includes('declarations removed at head') || s.includes('head tests without owners')), `fallback names the removed head declaration or the head tests without owners: ${JSON.stringify(p5b.fallback)}`);
  const basePicks = p5b.picks.filter((p) => p.owner === 'core' && p.input === 'src/core/value.mjs' && p.reason === 'declared input src/core/**');
  assert.equal(new Set(basePicks.map((p) => p.test)).size, 92, 'the base-declared picks remain: all 92 core leaves');
  assert.ok(picksOf(p5b, 'tests/core/leaf-000.test.mjs').some((p) => p.reason === 'runner-reported file list'), 'the runner-reported leaf keeps its row');
  assert.equal(p5b.counts.selected, 92);
  assert.deepEqual(p5b.unknown, ['.done-done.yaml'], 'the changed configuration remains unknown');
  log += `-> shadow-owner-removed-at-head (actual): complete ${p5b.complete}; base-declared picks ${new Set(basePicks.map((p) => p.test)).size}; selected ${p5b.counts.selected}; fallback ${JSON.stringify(p5b.fallback)}\n`;

  // 6. No runner installed: the plan is written and incomplete, with the fallback naming the problem.
  const noJest = shadowRepo('shadow-no-runner', shadowBase({ jest: false }), (d) => write(d, 'src/core/value.mjs', 'export const value = 2;\n'));
  const p6 = shadow(noJest, 'shadow-no-runner');
  assert.equal(p6.complete, false);
  assert.ok(Array.isArray(p6.fallback) && p6.fallback.length > 0, 'the fallback names the unavailable runner');
  log += '-> shadow-no-runner: plan written, incomplete, fallback\n';

  // 7. A report for another revision (the base commit, not HEAD) is rejected: the CLI fails and writes no plan.
  const baseSha = sh(owned, 'git', 'rev-parse', 'main').stdout.trim();
  const junitPath = join(scratch, 'core.junit.xml');
  writeFileSync(junitPath, JUNIT);
  const w7 = shadowRun(owned, 'shadow-report-wrong-revision', { report: junitPath, head: baseSha });
  assert.notEqual(w7.r.status, 0, `a report for another revision must fail\nstdout: ${w7.r.stdout}\nstderr: ${w7.r.stderr}`);
  assert.equal(existsSync(w7.plan), false, 'no plan is written for a mismatched --report-head');
  assert.match(`${w7.r.stdout}\n${w7.r.stderr}`, /report-head does not match HEAD/, 'the refusal names --report-head');
  log += '-> shadow-report-wrong-revision: rejected by name, no plan written\n';

  // 8. A JUnit report at HEAD: parameter ids and entities are kept, retries counted, skipped leaves not attempted; the bytes are kept.
  const p8 = shadow(owned, 'shadow-report-junit', { report: junitPath, head: 'HEAD' });
  assert.equal(p8.complete, true, `the report at HEAD should keep the plan complete: ${JSON.stringify(p8.fallback)}`);
  assert.equal(p8.report.format, 'junit');
  assert.equal(p8.report.raw, JUNIT, 'the JUnit bytes are kept');
  assert.equal(p8.report.known, 93);
  assert.equal(p8.report.attempted, 92, 'the skipped leaf is not attempted');
  const leaf = (id) => p8.report.leaves.find((l) => l.id === id);
  assert.equal(leaf('leaf-000-p2').name, 'value adds [2, & 3]', 'the entity is decoded');
  assert.equal(leaf('leaf-000-p1').classname, 'core.leaf-000');
  assert.equal(leaf('leaf-001').retries, 2, 'two reruns are counted');
  assert.equal(leaf('leaf-001').status, 'passed');
  assert.equal(leaf('leaf-002').status, 'skipped');
  log += '-> shadow-report-junit: 93 leaves, 92 attempted, ids and retries kept\n';

  // 9. A summary-only report: the counts name no leaves, so the known and attempted counts stay unknown.
  const summaryPath = join(scratch, 'summary.junit.xml');
  writeFileSync(summaryPath, SUMMARY);
  const p9 = shadow(owned, 'shadow-report-summary', { report: summaryPath, head: 'HEAD' });
  assert.equal(p9.report.known, null, 'no leaves, so the count is unknown');
  assert.equal(p9.report.attempted, null);
  assert.deepEqual(p9.report.leaves, []);
  log += '-> shadow-report-summary: summary-only counts stay unknown\n';
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
log += '\nbudget: unmeasured (no budget was set or measured for either run)\n';
writeFileSync(join(evidence, 'affected-select.log'), log);
writeFileSync(join(evidence, 'timings.json'), JSON.stringify({ control: controlRecord, shadow: shadowRecord, budget: 'unmeasured' }, null, 2) + '\n');
writeFileSync(join(evidence, 'steps.json'), JSON.stringify({
  target: { version: JSON.parse(readFileSync('package.json', 'utf8')).version },
  start: 'four throwaway repos, each a base commit and one changed commit on a branch; app-check (tier ci) runs a shell script that sources a helper, which runs a node tool that imports a util and reads a fixture folder; local-a and local-b are tier local; shadow fixtures: a 92-leaf core owner and a one-leaf web owner with a synthetic node_modules/.bin/jest, all committed clean',
  steps: [
    'Change tools/util.mjs (three hops from the command) and run `done-done affected main`',
    'Change fixtures/data/one.json (read by path from the tool) and run `done-done affected main`',
    'Change notes/stray.txt (in no journey or feature) and run `done-done affected main`',
    'Change package.json (configured in affected.global_paths) and run `done-done affected main`',
    'Before/control: on the 92-leaf fixture with src/core/value.mjs changed, run the existing gate `done-done affected main` and record its selection and wall time (the gate as it ships, not a prior binary)',
    'Change src/core/value.mjs (declared by the core owner) and run `done-done affected main --shadow <plan.json>`: 92 leaves picked, 91 extras, wall time recorded',
    'Change src/shared.mjs (declared by both owners) and run the shadow plan: core and web both selected',
    'Change src/core/value.mjs and fixtures/core/data.json (a subprocess input the runner misses) and run the shadow plan: the declaration restores the 92 leaves',
    'Rename src/core/old.mjs, delete src/core/gone.mjs and add src/core/deep/member.mjs, then run the shadow plan: each matches the declared glob and keeps its picks, and the deletion forces a conservative fallback',
    'Remove the core owner and run the shadow plan and `done-done affected main`: the plan is incomplete and the whole local tier runs',
    'Base declares the core owner; at head remove it from affected.owners and change src/core/value.mjs, with the runner reporting one core leaf; run the shadow plan: the plan is incomplete, the fallback names the removed head declaration or head tests without owners, and the base-declared picks remain',
    'Remove node_modules/.bin/jest and run the shadow plan: the plan is written, incomplete, with the runner named',
    'Run the shadow plan with --report <junit.xml> --report-head <base commit>: the CLI rejects the mismatched head and writes no plan',
    'Run the shadow plan with the JUnit report at HEAD, then with a summary-only report: leaves, ids, retries and unknown counts are read from the plan',
  ],
  result: 'the source dependency selects app-check with its chain as the reason; the unknown file and the global file each select the whole local tier (local-a, local-b) with the reason; the existing gate (before/control) on the 92-leaf fixture selects the whole local tier (local-a, local-b) with the unowned-file fallback, with its wall time recorded in timings.json; the shadow plan picks 92 core leaves with 91 extras, with its wall time recorded beside the control; both owners on a shared input, the subprocess input restored by its declaration, a deleted input keeping its declared picks with an incomplete plan and fallback, a head that removes the base-declared core owner gives an incomplete plan that keeps its 92 base-declared picks, an incomplete plan with a named fallback when the owner or runner is gone, a report for another revision rejected with no plan, and JUnit leaves with ids, retries and skips; budget is unmeasured',
}, null, 2));
console.log(log);
