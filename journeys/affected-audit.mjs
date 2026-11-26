#!/usr/bin/env node
// Selection audit proof: `done-done affected --audit <range>` finds a journey that failed at a receipted commit the feature map never
// selected, writes the file/journey pair to the feature that names the journey, prints recall, and then `affected` selects it.
// Also: advisory paired control records from `verify --layer fast` and `verify --layer release` on a synthetic repo (no model, no network).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const evidence = process.env.DONE_DONE_EVIDENCE_ROOT;
if (!evidence) throw new Error('missing DONE_DONE_EVIDENCE_ROOT');
const cli = join(process.cwd(), 'dist/cli.js');
const scratch = mkdtempSync(join(tmpdir(), 'affected-audit-'));
const gitConfig = join(scratch, 'gitconfig');
writeFileSync(gitConfig, '');
const host = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_CONFIG')));
const env = { ...host, HOME: scratch, DONE_DONE_HOME: join(scratch, 'dd-home'), GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Umer', GIT_AUTHOR_EMAIL: 'umer@example.com', GIT_COMMITTER_NAME: 'Umer', GIT_COMMITTER_EMAIL: 'umer@example.com' };
for (const k of ['DONE_DONE_DRIVE', 'DONE_DONE_RUN_ID', 'DONE_DONE_EVIDENCE_ROOT', 'CI']) delete env[k];
let log = '';
const dir = join(scratch, 'app');
const sh = (cmd, ...args) => {
  const r = spawnSync(cmd, args, { cwd: dir, env, encoding: 'utf8' });
  if (cmd === 'git' && r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r;
};
const dd = (...args) => {
  const r = sh('node', cli, '--json', ...args);
  log += `\n=== done-done ${args.join(' ')} (exit ${r.status}) ===\n${r.stdout}${r.stderr}`;
  return r;
};
const sig = (name) => `import { writeFileSync } from 'node:fs';\nimport { join } from 'node:path';\nwriteFileSync(join(process.env.DONE_DONE_EVIDENCE_ROOT, 'steps.json'), JSON.stringify({ target: { version: '1' }, start: 'fresh checkout', steps: ['run ${name}'], result: 'ok' }));\n`;

// Two journeys. shared.mjs is cited by the other-check feature only; app-check loads it by a computed path, so no static chain reaches it.
const files = {
  '.done-done.yaml': 'app: fixture\nevidence:\n  root: ../evidence\njourneys:\n  app-check:\n    command: node journeys/app.mjs\n  other-check:\n    command: node journeys/other.mjs\n',
  'journeys/app.mjs': `${sig('app-check')}await import(['./sha', 'red.mjs'].map((p, i) => (i ? p : new URL(p, import.meta.url).pathname.replace('/journeys/sha', '/tools/sha'))).join(''));\n`,
  'journeys/other.mjs': sig('other-check'),
  'tools/shared.mjs': 'export const ok = true;\n',
  '.agents/skills/done-done-verify-fixture/SKILL.md': '# Fixture\n\nLaunch: node journeys/app.mjs\n',
  '.agents/skills/done-done-verify-fixture/features/README.md': '# Features\n\n- [App](app.md) (core journey): the app\n- [Other](other.md): the other part\n',
  '.agents/skills/done-done-verify-fixture/features/app.md': '# App\n\nDrive: `done-done run app-check`.\n',
  '.agents/skills/done-done-verify-fixture/features/other.md': '# Other\n\nSource: tools/shared.mjs.\n\nDrive: `done-done run other-check`.\n',
};
try {
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), text);
  }
  sh('git', 'init', '-q', '-b', 'main'); sh('git', 'add', '-A'); sh('git', 'commit', '-qm', 'base');
  sh('git', 'checkout', '-qb', 'feat');
  // The change breaks app-check through the computed path; the map sends it to other-check only.
  writeFileSync(join(dir, 'tools/shared.mjs'), 'throw new Error("shared tool broke");\n');
  sh('git', 'add', '-A'); sh('git', 'commit', '-qm', 'break shared');
  const commit = sh('git', 'rev-parse', 'HEAD').stdout.trim();

  const names = (r) => JSON.parse(r.stdout).journeys.map((j) => j.name).sort().join(',');
  const before = names(dd('affected', 'main'));
  if (before !== 'other-check') throw new Error(`before the audit affected selected ${before}, not other-check`);

  // The full run: both journeys at the commit. app-check fails; other-check passes and gets the receipt.
  const failed = dd('run', 'app-check');
  if (failed.status === 0) throw new Error('app-check should fail at the broken commit');
  const passed = dd('run', 'other-check');
  const runId = JSON.parse(passed.stdout).run_id;
  if (!runId) throw new Error('other-check run has no run_id');
  const evid = join(scratch, 'evidence');
  mkdirSync(join(evid, '.done-done/receipts'), { recursive: true });
  const proof = join(evid, runId, 'steps.json');
  const sha256 = createHash('sha256').update(readFileSync(proof)).digest('hex');
  const rec = JSON.parse(readFileSync(join(evid, '.done-done/runs', `${runId}.json`), 'utf8'));
  writeFileSync(join(evid, '.done-done/receipts', `${commit}.json`), JSON.stringify({
    schema: 2, repo: dir, head: commit, tree: rec.tree, claim: 'other part works', result: 'pass', at: new Date().toISOString(),
    files: [{ path: `${runId}/steps.json`, sha256 }],
    runs: [{ run_id: runId, journey: 'other-check', command: rec.command, tool: rec.tool, steps: rec.steps }],
    judge: { route: 'stub', model: 'stub', independence: 'agent', author: null, verdicts: [{ path: `${runId}/steps.json`, sha256, verdict: 'pass' }] },
  }));

  const audit = dd('affected', '--audit', 'main..HEAD');
  const out = JSON.parse(audit.stdout);
  if (audit.status !== 0 || out.failures !== 1 || out.caught !== 0 || out.missed.length !== 1 || out.missed[0].journey !== 'app-check' || !out.missed[0].files.includes('tools/shared.mjs') || !out.recall.startsWith('0/1')) throw new Error(`audit did not find the one miss: ${audit.stdout}`);
  const feature = readFileSync(join(dir, '.agents/skills/done-done-verify-fixture/features/app.md'), 'utf8');
  if (!feature.includes('`tools/shared.mjs`') || !feature.includes('`run app-check`')) throw new Error(`the pair was not written to the app feature: ${feature}`);
  sh('git', 'add', '-A'); sh('git', 'commit', '-qm', 'map the audit miss');
  const after = names(dd('affected', 'main'));
  if (after !== 'app-check,other-check') throw new Error(`after the audit affected selected ${after}, not app-check,other-check`);
  const again = JSON.parse(dd('affected', '--audit', 'main..HEAD').stdout);

  if (sh('git', 'status', '--porcelain').stdout.trim()) throw new Error('a second audit changed the map again');
  log += `\n-> miss found: ${out.missed[0].journey} (${out.recall}); affected before: ${before}; after: ${after}; second audit missed ${again.missed.length}\n`;

  // Advisory paired control records: `verify --layer fast` then `verify --layer release` on a second synthetic repo. No model, no network.
  const LF = String.fromCharCode(10);
  const scrub = (s) => s.split(scratch).join('<scratch>');
  const layerLines = [];
  const lay = join(scratch, 'layer-app');
  const layerFiles = {
    '.gitignore': '.proof/' + LF,
    '.done-done.yaml': ['app: layer-app', 'evidence:', '  root: .proof', 'journeys:',
      '  fast-check:', '    command: node --test test/fast.test.mjs', '    tier: fast', '    size: ci',
      '  release-check:', '    command: node journeys/release.mjs', '    tier: release', '    size: ci',
      '  release-missing:', '    command: node journeys/missing.mjs', '    tier: release', '    size: ci',
      '  release-invalid:', '    command: node journeys/invalid.mjs', '    tier: release', '    size: ci'].join(LF) + LF,
    'test/fast.test.mjs': ["import { test } from 'node:test';", "test('fast layer passes', () => {});"].join(LF) + LF,
    'journeys/release.mjs': [
      "import { writeFileSync } from 'node:fs';",
      'const xml = `<testsuites><testsuite name="release" tests="1" failures="1"><testcase classname="test/greet.test.mjs" name="greets Umer"><failure message="expected Hello Umer">AssertionError: greeting</failure></testcase></testsuite></testsuites>`;',
      'if (process.env.DONE_DONE_JUNIT_REPORT) writeFileSync(process.env.DONE_DONE_JUNIT_REPORT, xml);',
      "console.error('AssertionError: greeting');",
      'process.exit(1);',
    ].join(LF) + LF,
    'journeys/missing.mjs': "console.error('AssertionError: greeting');" + LF + 'process.exit(1);' + LF,
    // A valid JUnit report with no named failure: the layer records no observation for it.
    'journeys/invalid.mjs': [
      "import { writeFileSync } from 'node:fs';",
      'const xml = `<testsuites><testsuite name="invalid" tests="1" failures="0"><testcase classname="test/greet.test.mjs" name="greets nobody"/></testsuite></testsuites>`;',
      'if (process.env.DONE_DONE_JUNIT_REPORT) writeFileSync(process.env.DONE_DONE_JUNIT_REPORT, xml);',
      'process.exit(1);',
    ].join(LF) + LF,
  };
  for (const [p, text] of Object.entries(layerFiles)) {
    mkdirSync(dirname(join(lay, p)), { recursive: true });
    writeFileSync(join(lay, p), text);
  }
  const lg = (...args) => {
    const r = spawnSync('git', args, { cwd: lay, env, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  lg('init', '-q', '-b', 'main'); lg('add', '-A'); lg('commit', '-qm', 'layer base');
  // Base and head are the same commit, so no changed file needs mapping and each layer's own selection is what is tested.
  const layerRun = (layer) => {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [cli, '--json', 'verify', '--layer', layer, '--base', 'HEAD'], { cwd: lay, env, encoding: 'utf8' });
    const wall = Date.now() - t0;
    layerLines.push(`=== verify --layer ${layer} --base HEAD (exit ${r.status}, wall ${wall} ms) ===` + LF + scrub(r.stdout + r.stderr));
    let out = {};
    try { out = JSON.parse(r.stdout); } catch { /* reported by the assertion below */ }
    // Without a plan the CLI error is the only evidence, so it is printed with the failure.
    assert.ok(out.plan, `verify --layer ${layer} wrote no plan (exit ${r.status}).\nstdout: ${scrub(r.stdout)}\nstderr: ${scrub(r.stderr)}`);
    return { status: r.status, wall, out, plan: JSON.parse(readFileSync(out.plan, 'utf8')) };
  };
  const readRows = (p) => readFileSync(p, 'utf8').split(LF).filter(Boolean).map((l) => JSON.parse(l));

  // Fast omits the release-tier journeys; its own record is complete and passes (shadow: inconclusive, never a pass).
  const fast = layerRun('fast');
  assert.equal(fast.status, 3, 'a passing fast layer is inconclusive, never a pass');
  assert.deepEqual(fast.plan.required, ['fast-check'], 'fast omits every release journey');
  assert.equal(fast.plan.control_comparison, undefined, 'fast writes no comparison');
  assert.equal(fast.plan.control.complete, true, 'the fast record is complete');

  // Release: the failing journey keeps its original red and its retry; both pair with the fast record.
  const release = layerRun('release');
  assert.equal(release.status, 1, 'a failed release layer exits 1');
  const cmp = release.plan.control_comparison;
  assert.equal(cmp.mode, 'advisory');
  assert.equal(cmp.paired, true, 'the fast record pairs with the release record');
  const rows = readRows(cmp.misses);
  assert.deepEqual(rows.map((r) => r.journey), ['release-check', 'release-check'], 'only the journey with a failed named assertion is observed, once per attempt');
  assert.deepEqual(rows.map((r) => r.retry), [false, true], 'the original red and its retry are both kept');
  for (const r of rows) {
    assert.equal(r.fast_run, fast.plan.control.run, 'fast run id');
    assert.equal(r.broad_run, release.plan.control.run, 'release run id');
    assert.equal(r.classification, 'unresolved-omission');
    assert.equal(r.base, fast.plan.base); assert.equal(r.head, fast.plan.head);
    assert.equal(r.base, release.plan.base); assert.equal(r.head, release.plan.head);
    assert.ok(r.assertion, 'a named assertion is recorded');
  }
  assert.equal(fast.plan.control.inputs, release.plan.control.inputs, 'same inputs');
  assert.equal(fast.plan.control.environment, release.plan.control.environment, 'same environment');

  // A missing matching fast record is unknown; missing or invalid reports teach nothing (shown by the rows above, which exclude them).
  const fastLayer = dirname(fast.out.plan);
  const hidden = join(scratch, 'hidden-fast-layer');
  renameSync(fastLayer, hidden);
  const unknown = layerRun('release');
  renameSync(hidden, fastLayer);
  assert.equal(unknown.status, 1);
  assert.equal(unknown.plan.control_comparison.paired, false, 'no fast record, nothing pairs');
  const unknownRows = readRows(unknown.plan.control_comparison.misses);
  assert.deepEqual(unknownRows.map((r) => [r.fast_run, r.classification]), [[null, 'unknown'], [null, 'unknown']], 'a missing fast record is unknown');

  // Fast behaves as before, and the change leaves the feature map and the tree alone.
  const fast2 = layerRun('fast');
  assert.deepEqual(fast2.plan.required, ['fast-check']);
  assert.equal(fast2.plan.control_comparison, undefined);
  assert.equal(lg('status', '--porcelain'), '', 'git status stays clean');

  const runs = [['fast', fast], ['release', release], ['release without a fast record', unknown], ['fast again', fast2]].map(([label, r]) => ({
    label, exit: r.status, wall_ms: r.wall, layer_duration_ms: r.plan.duration_ms, required: r.plan.required, outcomes: r.plan.outcomes,
  }));
  writeFileSync(join(evidence, 'layer-control.log'), scrub(layerLines.join(LF)) + LF);
  writeFileSync(join(evidence, 'layer-control.json'), scrub(JSON.stringify({ runs, misses: { paired: rows, unknown: unknownRows } }, null, 2)) + LF);
  log += `\n-> layer control: fast required ${fast.plan.required}; release observed ${rows.length} paired misses (retry ${rows.map((r) => r.retry)}) classified ${rows[0].classification}; without a fast record: ${unknownRows.map((r) => r.classification)}\n`;

  writeFileSync(join(evidence, 'affected-audit.log'), log);
  writeFileSync(join(evidence, 'steps.json'), JSON.stringify({
    target: { version: JSON.parse(readFileSync('package.json', 'utf8')).version },
    start: 'a throwaway repo with journeys app-check and other-check; a commit on a branch breaks app-check through a path no static chain reaches, and the feature map sends that file to other-check only; both journeys run at the commit and a receipt holds other-check; a second throwaway repo has a size ci fast journey (node --test test/fast.test.mjs) and release-tier journeys that fail',
    steps: [
      'Run `done-done affected main`: only other-check is selected',
      'Run `done-done affected --audit main..HEAD`: the failed app-check run at the receipted commit is a miss, recall 0/1, and tools/shared.mjs is written to the app feature',
      'Commit the map change and run `done-done affected main`: app-check is selected too',
      'Audit the same range again: nothing is added',
      'In a second repo, run `done-done verify --layer fast --base HEAD`: only fast-check is required',
      'Run `done-done verify --layer release --base HEAD`: the failed release-check assertion is recorded per attempt, original red and retry, with the fast and release run ids and unresolved-omission; missing and invalid reports record nothing',
      'Remove the fast record and run release again: the observations are unknown with no fast run id',
      'Run `done-done verify --layer fast --base HEAD` again: its required set is unchanged and git status is clean',
    ],
    result: `the audit found one miss (${out.recall}), mapped tools/shared.mjs to app-check, and affected then selected ${after}; the advisory layer records paired unresolved-omission observations for release-check (${rows.length}) and unknown ones without a fast record, and fast is unchanged`,
  }, null, 2));
  console.log(log);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
