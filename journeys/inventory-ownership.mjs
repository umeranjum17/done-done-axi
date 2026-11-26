// inventory-ownership journey: the real `done-done lint`, `done-done inventory` and `done-done run` on throwaway repos.
// It preserves the ownership checks and drives intent inventory through declarations, aliases, parameter cases, ceilings,
// critical caps, documented increases, competing additions, shadow mode, native Playwright reports and distinct refusals. No model or network.
import { execFileSync, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const CLI = join(process.cwd(), 'dist', 'cli.js');
const OUT = process.env.DONE_DONE_EVIDENCE_ROOT;
if (!OUT) { console.error('inventory-ownership: run via `done-done run inventory-ownership`'); process.exit(2); }

const tmp = mkdtempSync(join(tmpdir(), 'dd-inventory-'));
try {
  const repo = join(tmp, 'repo'), evidence = join(tmp, 'evidence'), report = join(tmp, 'report.md');
  mkdirSync(join(repo, 'journeys'), { recursive: true });
  mkdirSync(join(repo, 'test'));
  mkdirSync(evidence);
  const gitConfig = join(tmp, 'gitconfig');
  writeFileSync(gitConfig, '');
  const host = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_CONFIG')));
  const env = { ...host, DONE_DONE_HOME: join(tmp, 'home'), GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Umer', GIT_AUTHOR_EMAIL: 'umer@example.com', GIT_COMMITTER_NAME: 'Umer', GIT_COMMITTER_EMAIL: 'umer@example.com' };
  delete env.DONE_DONE_RUN_ID;
  const git = (...a) => execFileSync('git', a, { cwd: repo, env, stdio: 'pipe', encoding: 'utf8' });
  const dd = (...a) => spawnSync(process.execPath, [CLI, ...a], { cwd: repo, env, encoding: 'utf8' });
  const sha = (p) => createHash('sha256').update(readFileSync(join(repo, p))).digest('hex');

  writeFileSync(join(repo, '.done-done.yaml'), `app: notes\nevidence:\n  root: ${JSON.stringify(join(tmp, 'proof'))}\njourneys:\n  smoke:\n    command: node journeys/smoke.mjs\n`);
  writeFileSync(join(repo, 'journeys/smoke.mjs'), "console.log('smoke');\n");
  writeFileSync(join(repo, 'test/notes.test.mjs'), "console.log('notes');\n");
  // The edit a journey command makes to the script it owns, then the record of its new hash.
  writeFileSync(join(repo, 'edit.mjs'), "import { appendFileSync, writeFileSync } from 'node:fs';\nimport { spawnSync } from 'node:child_process';\nappendFileSync('journeys/smoke.mjs', \"console.log('smoke, one more step');\\n\");\nconst r = spawnSync(process.argv[2], ['inventory', 'record', 'journeys/smoke.mjs'], { stdio: 'inherit' });\nwriteFileSync(process.env.DONE_DONE_EVIDENCE_ROOT + '/edited.txt', 'edited journeys/smoke.mjs');\nprocess.exit(r.status);\n");
  appendFileSync(join(repo, '.done-done.yaml'), `  edit-owned:\n    command: node edit.mjs ${JSON.stringify(join(tmp, 'dd'))}\n`);
  writeFileSync(join(tmp, 'dd'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(CLI)} "$@"\n`, { mode: 0o755 });
  writeFileSync(join(repo, '.done-done-inventory.json'), JSON.stringify({
    'journeys/smoke.mjs': { owner: 'smoke', sha256: sha('journeys/smoke.mjs'), leaves: [{ id: 'smoke-display', intent: 'welcome' }] },
    'test/notes.test.mjs': { owner: 'notes-suite', sha256: sha('test/notes.test.mjs') },
  }));
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'init');
  writeFileSync(report, '## Checks\noutcome: test ownership and intent limits are enforced\nrepro: n/a: no bug\nproof: no verify skill - done-done lint\nevidence: not proven: fixture\n');

  const log = [];
  const step = (title, r, code, expect) => {
    const out = (r.stdout + r.stderr).trim();
    log.push(`$ ${title}\n${out}\nexit ${r.status}\n`);
    assert.equal(r.status, code, `${title}\n${out}`);
    if (expect) assert.match(out, expect, title);
    return out;
  };
  const lint = () => dd('lint', report, evidence);
  const setIntentInventory = (rows) => {
    const inv = JSON.parse(readFileSync(join(repo, '.done-done-inventory.json'), 'utf8'));
    inv['test/notes.test.mjs'] = { owner: 'notes-suite', sha256: sha('test/notes.test.mjs'), leaves: rows.map((r, i) => ({ id: r.id ?? `case-${i + 1}`, intent: r.intent, ...(r.critical ? { critical: true } : {}) })) };
    writeFileSync(join(repo, '.done-done-inventory.json'), JSON.stringify(inv, null, 2) + '\n');
  };
  const setPolicy = ({ mode = 'enforce', ceiling = 3, critical = 2, aliases = {}, increases = [], native = false } = {}) => {
    const text = `app: notes\nevidence:\n  root: ${JSON.stringify(join(tmp, 'proof'))}\nintents:\n  mode: ${mode}\n  ceiling: ${ceiling}\n  critical_ceiling: ${critical}\n  native: ${native}\n${Object.keys(aliases).length ? `  aliases:\n${Object.entries(aliases).map(([a, b]) => `    ${a}: ${b}`).join('\n')}\n` : ''}${increases.length ? `  increases:\n${increases.map((r) => `    - intent: ${r.intent}\n      gap: ${JSON.stringify(r.gap)}\n      review: ${JSON.stringify(r.review)}`).join('\n')}\n` : ''}journeys:\n  smoke:\n    command: node journeys/smoke.mjs\n  edit-owned:\n    command: node edit.mjs ${JSON.stringify(join(tmp, 'dd'))}\n    intent: welcome\n`;
    writeFileSync(join(repo, '.done-done.yaml'), text);
  };
  const ownedBaseline = () => ({
    'journeys/smoke.mjs': { owner: 'smoke', sha256: sha('journeys/smoke.mjs'), leaves: [{ id: 'smoke-display', intent: 'welcome' }] },
    'test/notes.test.mjs': { owner: 'notes-suite', sha256: sha('test/notes.test.mjs'), leaves: [] },
  });
  const invSummary = () => {
    const r = dd('--json', 'inventory');
    const out = r.stdout + r.stderr;
    log.push(`$ done-done inventory --json\n${out.trim()}\nexit ${r.status}\n`);
    assert.equal(r.status, 0, out);
    return JSON.parse(r.stdout);
  };

  // Existing ownership proof: preserve each original step and assertion.
  step('done-done lint (every test file owned)', lint(), 0, /^PASS$/);
  writeFileSync(join(repo, 'test/stray.test.mjs'), "console.log('stray');\n");
  step('done-done lint (new test/stray.test.mjs, no owner)', lint(), 1, /^FAIL: test inventory: test\/stray\.test\.mjs: test file has no owner entry/);
  rmSync(join(repo, 'test/stray.test.mjs'));
  appendFileSync(join(repo, 'journeys/smoke.mjs'), "console.log('smoke, one more step');\n");
  step('done-done lint (journeys/smoke.mjs edited by hand)', lint(), 1, /^FAIL: test inventory: journeys\/smoke\.mjs: owned by smoke but edited outside a done-done run/);
  step('done-done inventory record journeys/smoke.mjs (by hand, no run)', dd('inventory', 'record', 'journeys/smoke.mjs'), 2, /only works inside a done-done run/);
  git('checkout', '--', 'journeys/smoke.mjs');
  step('done-done run edit-owned (journey command makes the same edit)', dd('run', 'edit-owned'), 0, /recorded\[1\]: journeys\/smoke\.mjs/);
  assert.match(readFileSync(join(repo, 'journeys/smoke.mjs'), 'utf8'), /one more step/, 'the journey command made the edit');
  step('done-done lint (same edit, made by the journey command)', lint(), 0, /^PASS$/);
  step('done-done inventory', dd('inventory'), 0, /owned: 2/);

  // Three declarations can represent two canonical intents: aliases collapse, while parameter cases remain declarations.
  writeFileSync(join(repo, 'journeys/smoke.mjs'), "console.log('smoke');\n");
  writeFileSync(join(repo, 'test/notes.test.mjs'), "console.log('notes');\n");
  writeFileSync(join(repo, '.done-done-inventory.json'), JSON.stringify(ownedBaseline(), null, 2) + '\n');
  setPolicy({ ceiling: 3, critical: 2, aliases: { greeting: 'welcome' } });
  setIntentInventory([{ id: 'welcome-basic', intent: 'welcome' }, { id: 'welcome-empty', intent: 'greeting' }, { id: 'notes-save', intent: 'save-note' }]);
  git('add', '-A'); git('commit', '-qm', 'intent policy and three declared cases');
  const summary = invSummary();
  assert.deepEqual(summary.intents.counts, { declarations: 5, intents: 2, critical: 0 }, `declaration and canonical intent counts: ${JSON.stringify(summary)}`);
  step('done-done lint (three declarations, two canonical intents)', lint(), 0, /^PASS$/);
  // The later budget owner may request exactly one advisory batch only after proof and with a free cheap slot.
  setIntentInventory([{ id: 'welcome-basic', intent: 'greeting' }, { id: 'notes-save', intent: 'save-note' }, { id: 'notes-search', intent: 'search-note' }]);
  const { intentAdvisory } = await import(pathToFileURL(join(process.cwd(), 'dist/inventory.js')).href);
  assert.equal(intentAdvisory(repo, false, true), null, 'no batch before final proof');
  assert.equal(intentAdvisory(repo, true, false), null, 'no batch without a cheap slot');
  const advisory = intentAdvisory(repo, true, true);
  assert.deepEqual(advisory, { kind: 'intent-ambiguity', pairs: [{ left: 'save-note', right: 'search-note' }] });
  log.push(`$ intent advisory (final proof and free cheap slot)\n${JSON.stringify(advisory)}\nexit 0\n`);
  setIntentInventory([{ id: 'welcome-basic', intent: 'welcome' }, { id: 'welcome-empty', intent: 'greeting' }, { id: 'notes-save', intent: 'save-note' }]);
  appendFileSync(join(repo, '.done-done.yaml'), '  unseen:\n    command: echo unseen\n');
  step('done-done lint (unowned command has no intent)', lint(), 1, /journey unseen: no intent declaration/);
  setPolicy({ ceiling: 3, critical: 2, aliases: { greeting: 'welcome' } });

  // A fourth refused declaration must add a fourth distinct canonical intent; alias parameter cases stay separate rows.
  setIntentInventory([{ id: 'welcome-basic', intent: 'welcome' }, { id: 'welcome-empty', intent: 'greeting' }, { id: 'notes-save', intent: 'save-note' }, { id: 'search-note', intent: 'search-note' }, { id: 'export-note', intent: 'export-note' }]);
  git('add', '-A'); git('commit', '-qm', 'fourth distinct intent');
  const fourth = step('done-done lint (four distinct intents exceed ceiling 3)', lint(), 1, /intent ceiling 3 exceeded: 4 distinct intents/);
  assert.match(fourth, /test inventory/, 'the refusal is from inventory lint');
  setIntentInventory([{ id: 'welcome-basic', intent: 'welcome' }, { id: 'welcome-empty', intent: 'greeting' }, { id: 'welcome-parameter', intent: 'greeting' }, { id: 'notes-save', intent: 'save-note' }]);
  git('add', '-A'); git('commit', '-qm', 'separate aliased parameter declarations');
  const parameterSummary = invSummary();
  assert.equal(parameterSummary.intents.counts.declarations, 6, 'aliased parameter cases remain separate declarations');
  assert.equal(parameterSummary.intents.counts.intents, 2, 'aliases and parameter cases count only distinct canonical intents');
  step('done-done lint (four declarations remain within two canonical intents)', lint(), 0, /^PASS$/);

  // Enforce mode requires intent leaves for every owned file, including the smoke journey.
  setIntentInventory([{ id: 'welcome-basic', intent: 'welcome' }, { id: 'notes-save', intent: 'save-note' }]);
  const noSmoke = JSON.parse(readFileSync(join(repo, '.done-done-inventory.json'), 'utf8'));
  delete noSmoke['journeys/smoke.mjs'].leaves;
  writeFileSync(join(repo, '.done-done-inventory.json'), JSON.stringify(noSmoke, null, 2) + '\n');
  git('add', '-A'); git('commit', '-qm', 'remove smoke intent leaves');
  step('done-done lint (enforce requires intent leaves for owned smoke journey)', lint(), 1, /journeys\/smoke\.mjs: no intent leaves recorded/);
  setIntentInventory([{ id: 'welcome-basic', intent: 'welcome' }, { id: 'notes-save', intent: 'save-note' }]);
  const invWithSmoke = JSON.parse(readFileSync(join(repo, '.done-done-inventory.json'), 'utf8'));
  invWithSmoke['journeys/smoke.mjs'].leaves = [{ id: 'smoke-display', intent: 'welcome' }];
  writeFileSync(join(repo, '.done-done-inventory.json'), JSON.stringify(invWithSmoke, null, 2) + '\n');
  git('add', '-A'); git('commit', '-qm', 'add smoke intent leaf');
  step('done-done lint (all owned files have intent leaves)', lint(), 0, /^PASS$/);
  invWithSmoke['journeys/smoke.mjs'].leaves.push({ id: 'smoke-unrelated', intent: 'other-outcome' });
  writeFileSync(join(repo, '.done-done-inventory.json'), JSON.stringify(invWithSmoke, null, 2) + '\n');
  step('done-done lint (one journey has two intents)', lint(), 1, /journey smoke has 2 distinct intents/);
  invWithSmoke['journeys/smoke.mjs'].leaves.pop();
  writeFileSync(join(repo, '.done-done-inventory.json'), JSON.stringify(invWithSmoke, null, 2) + '\n');

  // Restore three declarations, then independently prove the critical ceiling and its documented increase rule.
  setIntentInventory([{ id: 'welcome-basic', intent: 'welcome', critical: true }, { id: 'notes-save', intent: 'save-note', critical: true }, { id: 'notes-search', intent: 'search-note', critical: true }]);
  const criticalInventory = JSON.parse(readFileSync(join(repo, '.done-done-inventory.json'), 'utf8'));
  criticalInventory['journeys/smoke.mjs'].leaves = [{ id: 'smoke-display', intent: 'welcome' }];
  writeFileSync(join(repo, '.done-done-inventory.json'), JSON.stringify(criticalInventory, null, 2) + '\n');
  git('add', '-A'); git('commit', '-qm', 'three critical intents');
  step('done-done lint (critical ceiling is independent)', lint(), 1, /critical intent ceiling 2 exceeded: 3 distinct critical intents/);
  setPolicy({ ceiling: 3, critical: 3 });
  git('add', '.done-done.yaml'); git('commit', '-qm', 'raise critical cap without documentation');
  step('done-done lint (critical cap increase requires documentation)', lint(), 1, /cap increase needs a separate documented coverage gap and review for each newly critical intent/);

  // Add a prior committed policy so a legitimate cap increase is checked against its actual parent.
  setIntentInventory([{ id: 'welcome-basic', intent: 'welcome', critical: true }, { id: 'notes-save', intent: 'save-note', critical: true }]);
  const cleanCritical = JSON.parse(readFileSync(join(repo, '.done-done-inventory.json'), 'utf8'));
  cleanCritical['journeys/smoke.mjs'].leaves = [{ id: 'smoke-display', intent: 'welcome' }];
  writeFileSync(join(repo, '.done-done-inventory.json'), JSON.stringify(cleanCritical, null, 2) + '\n');
  setPolicy({ ceiling: 3, critical: 2 });
  git('add', '-A'); git('commit', '-qm', 'baseline caps and two critical intents');
  setIntentInventory([{ id: 'welcome-basic', intent: 'welcome', critical: true }, { id: 'notes-save', intent: 'save-note', critical: true }, { id: 'notes-search', intent: 'search-note', critical: true }]);
  const increasedCritical = JSON.parse(readFileSync(join(repo, '.done-done-inventory.json'), 'utf8'));
  increasedCritical['journeys/smoke.mjs'].leaves = [{ id: 'smoke-display', intent: 'welcome' }];
  writeFileSync(join(repo, '.done-done-inventory.json'), JSON.stringify(increasedCritical, null, 2) + '\n');
  setPolicy({ ceiling: 3, critical: 3, increases: [{ intent: 'search-note', gap: 'search has no existing critical coverage', review: 'Umer approved review INV-104' }] });
  git('add', '-A'); git('commit', '-qm', 'document critical coverage cap increase');
  step('done-done lint (documented critical cap increase)', lint(), 0, /^PASS$/);

  // An increase approval is required only when the candidate policy actually raises a parent cap.
  setPolicy({ ceiling: 3, critical: 3, increases: [{ intent: 'unrelated', gap: 'no linked coverage', review: 'Umer approved review INV-105' }] });
  git('add', '.done-done.yaml'); git('commit', '-qm', 'unmatched approval with unchanged caps');
  step('done-done lint (unchanged caps do not validate increase approvals)', lint(), 0, /^PASS$/);

  // Shadow mode reports inventory errors without turning them into a lint refusal.
  setPolicy({ mode: 'shadow', ceiling: 2, critical: 2 });
  git('add', '.done-done.yaml'); git('commit', '-qm', 'shadow policy');
  const shadow = step('done-done lint (shadow intent inventory)', lint(), 0, /^PASS$/);
  assert.match(shadow, /^PASS$/);
  const shadowSummary = invSummary();
  assert.equal(shadowSummary.intents.mode, 'shadow');
  assert.ok(Array.isArray(shadowSummary.intents.errors) && shadowSummary.intents.errors.some((e) => /intent ceiling/.test(e)), `shadow inventory exposes the overage: ${JSON.stringify(shadowSummary)}`);

  // Competing additions are in separate inventory entries, so their text changes merge into the candidate.
  setPolicy({ mode: 'enforce', ceiling: 3, critical: 2 });
  setIntentInventory([{ id: 'welcome', intent: 'welcome' }, { id: 'save', intent: 'save-note' }]);
  writeFileSync(join(repo, 'test/other.test.mjs'), "console.log('other');\n");
  const branchBaseInventory = JSON.parse(readFileSync(join(repo, '.done-done-inventory.json'), 'utf8'));
  branchBaseInventory['test/other.test.mjs'] = { owner: 'other-suite', sha256: sha('test/other.test.mjs'), leaves: [{ id: 'other-welcome', intent: 'welcome' }] };
  branchBaseInventory['journeys/smoke.mjs'].leaves = [{ id: 'smoke-display', intent: 'welcome' }];
  branchBaseInventory['test/notes.test.mjs'].leaves = [{ id: 'welcome', intent: 'welcome' }, { id: 'save', intent: 'save-note' }];
  writeFileSync(join(repo, '.done-done-inventory.json'), JSON.stringify(branchBaseInventory, null, 2) + '\n');
  git('add', '-A'); git('commit', '-qm', 'merge base with two intents');
  const base = git('rev-parse', 'HEAD').trim();
  git('checkout', '-qb', 'feature-a');
  const addA = JSON.parse(readFileSync(join(repo, '.done-done-inventory.json'), 'utf8'));
  addA['test/notes.test.mjs'].leaves.push({ id: 'search-a', intent: 'search-note' });
  writeFileSync(join(repo, '.done-done-inventory.json'), JSON.stringify(addA, null, 2) + '\n');
  git('add', '-A'); git('commit', '-qm', 'feature a adds search');
  step('done-done lint (first addition fits alone)', lint(), 0, /^PASS$/);
  const a = git('rev-parse', 'HEAD').trim();
  git('checkout', '-q', base);
  git('checkout', '-qb', 'feature-b');
  const addB = JSON.parse(readFileSync(join(repo, '.done-done-inventory.json'), 'utf8'));
  addB['test/other.test.mjs'].leaves.push({ id: 'export-b', intent: 'export-note' });
  writeFileSync(join(repo, '.done-done-inventory.json'), JSON.stringify(addB, null, 2) + '\n');
  git('add', '-A'); git('commit', '-qm', 'feature b adds export');
  step('done-done lint (second addition fits alone)', lint(), 0, /^PASS$/);
  const b = git('rev-parse', 'HEAD').trim();
  git('checkout', '-q', 'feature-a');
  git('merge', '--no-commit', '--no-ff', 'feature-b');
  const merged = step('done-done lint (merged competing additions)', lint(), 1, /intent ceiling 3 exceeded/);
  assert.match(merged, /4 distinct intents/, 'merged candidate counts both branch additions');
  git('merge', '--abort');
  assert.notEqual(a, b);

  // Native Playwright mode consumes real reporter JSON; tags and parameterized cases become intent declarations.
  setPolicy({ mode: 'enforce', ceiling: 3, critical: 2, native: true });
  const pw = join(repo, 'node_modules', '.bin');
  mkdirSync(pw, { recursive: true });
  const playwright = join(pw, 'playwright');
  writeFileSync(playwright, `#!${process.execPath}\nconst args = process.argv.slice(2);\nif (args[0] !== 'test' || args[1] !== '--list' || args[2] !== '--reporter=json') process.exit(9);\nprocess.stdout.write(JSON.stringify({ config: {}, errors: [], suites: [{ title: 'inventory.spec.mjs', file: 'test/inventory.spec.mjs', specs: [], suites: [{ title: 'notes', file: 'test/inventory.spec.mjs', specs: [{ title: 'saves note', id: 'native-1', file: 'test/inventory.spec.mjs', line: 4, tags: ['@intent:save-note'], tests: [{ projectName: 'chromium', annotations: [], results: [] }] }, { title: 'saves note with text', id: 'native-2', file: 'test/inventory.spec.mjs', line: 8, tags: ['@intent:save-note'], tests: [{ projectName: 'chromium', annotations: [], results: [] }] }, { title: 'searches notes', id: 'native-3', file: 'test/inventory.spec.mjs', line: 12, tags: ['@intent:search-note'], tests: [{ projectName: 'chromium', annotations: [], results: [] }] }] }] }] }));\n`, { mode: 0o755 });
  writeFileSync(join(repo, 'test/inventory.spec.mjs'), "// native Playwright inventory fixture\n");
  const nativeInv = JSON.parse(readFileSync(join(repo, '.done-done-inventory.json'), 'utf8'));
  delete nativeInv['test/other.test.mjs'];
  rmSync(join(repo, 'test/other.test.mjs'));
  nativeInv['journeys/smoke.mjs'].leaves = [{ id: 'smoke-display', intent: 'welcome' }];
  nativeInv['test/inventory.spec.mjs'] = { owner: 'playwright-suite', sha256: sha('test/inventory.spec.mjs') };
  delete nativeInv['test/notes.test.mjs'];
  rmSync(join(repo, 'test/notes.test.mjs'));
  writeFileSync(join(repo, '.done-done-inventory.json'), JSON.stringify(nativeInv, null, 2) + '\n');
  git('add', '-A'); git('commit', '-qm', 'enable native Playwright intent report');
  const nativeSummary = invSummary();
  assert.equal(nativeSummary.intents.counts.declarations, 5, `native reporter declares three cases: ${JSON.stringify(nativeSummary)}`);
  assert.equal(nativeSummary.intents.counts.intents, 3, `native tags collapse to two distinct intents: ${JSON.stringify(nativeSummary)}`);
  assert.deepEqual(nativeSummary.intents.declarations.filter((d) => d.file === 'test/inventory.spec.mjs').map((d) => d.intents), [['save-note'], ['save-note'], ['search-note']]);
  step('done-done lint (native Playwright reporter tags and parameter cases)', lint(), 0, /^PASS$/);

  // Final distinct refusals: invalid identifier, alias cycle (exit 2), and malformed intent leaf.
  setPolicy({ ceiling: 3, critical: 2, native: false, aliases: { welcome: 'save-note', greeting: 'search-note' } });
  const malformedBase = JSON.parse(readFileSync(join(repo, '.done-done-inventory.json'), 'utf8'));
  delete malformedBase['test/inventory.spec.mjs'];
  rmSync(join(repo, 'test/inventory.spec.mjs'));
  writeFileSync(join(repo, 'test/notes.test.mjs'), "console.log('notes');\n");
  malformedBase['test/notes.test.mjs'] = { owner: 'notes-suite', sha256: sha('test/notes.test.mjs'), leaves: [{ id: 'bad-id', intent: 'bad intent' }] };
  writeFileSync(join(repo, '.done-done-inventory.json'), JSON.stringify(malformedBase, null, 2) + '\n');
  writeFileSync(join(repo, 'test/notes.test.mjs'), "console.log('notes');\n");
  malformedBase['test/notes.test.mjs'].sha256 = sha('test/notes.test.mjs');
  writeFileSync(join(repo, '.done-done-inventory.json'), JSON.stringify(malformedBase, null, 2) + '\n');
  git('add', '-A'); git('commit', '-qm', 'malformed intent declaration');
  step('done-done lint (invalid intent identifier)', lint(), 1, /must map each path to|invalid|intent/i);
  const cycleInv = JSON.parse(readFileSync(join(repo, '.done-done-inventory.json'), 'utf8'));
  cycleInv['test/notes.test.mjs'].leaves = [{ id: 'welcome', intent: 'welcome', critical: true }, { id: 'save', intent: 'save-note' }, { id: 'search', intent: 'search-note' }];
  writeFileSync(join(repo, '.done-done-inventory.json'), JSON.stringify(cycleInv, null, 2) + '\n');
  setPolicy({ ceiling: 3, critical: 2, aliases: { welcome: 'save-note', 'save-note': 'welcome' } });
  git('add', '-A'); git('commit', '-qm', 'cyclic aliases');
  step('done-done inventory (alias cycle refusal)', dd('--json', 'inventory'), 2, /intent alias cycle/);

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'inventory-ownership.log'), log.join('\n'));
  writeFileSync(join(OUT, 'steps.json'), JSON.stringify({
    target: { version: JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version },
    start: 'a throwaway git repo with two owned test files, then a committed intent policy and deterministic local CLI calls',
    steps: [
      'lint with every test file owned, add a stray test file, and lint again',
      'hand-edit an owned journey script, attempt a hand inventory record, then make the same edit through done-done run and lint',
      'record declarations across aliases and parameter cases; inspect summary.intents and verify declaration and canonical counts',
      'request one ambiguous-intent batch only after final proof and with a free cheap slot',
      'refuse a fourth distinct canonical intent while allowing a fourth declaration that aliases an existing intent',
      'check enforce mode leaves on every owned file including smoke; exercise the independent critical ceiling and a documented increase',
      'merge competing additions stored in separate inventory entries and lint the merged candidate',
      'run native Playwright JSON list discovery and inspect its @intent tags and parameter case declarations',
      'switch to shadow mode and inspect reported errors; check alias-cycle usage failure exits 2',
    ],
    result: 'ownership checks remain enforced; inventory JSON reports canonical intents under summary.intents; aliases reduce distinct intent counts while parameter cases remain declarations; enforcement requires leaves for every owned file; native Playwright tags and cases are counted; merged branch additions exceed the ceiling; critical caps and documented increases are enforced only when raised; alias cycles exit 2',
  }, null, 2));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
