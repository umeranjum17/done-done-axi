#!/usr/bin/env node
// Test value proof (Q12): `tests value` plants faults in scratch copies and marks each test. On the value-test fixture one
// test is real, one catches nothing (slop) and one catches what the faster real test catches (duplicate), and the work copy
// is byte-for-byte unchanged afterwards. Runs the built CLI.
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from 'node:process';

const { DONE_DONE_EVIDENCE_ROOT: evidence } = env;
if (!evidence) throw new Error('missing DONE_DONE_EVIDENCE_ROOT');

const cli = join(process.cwd(), 'dist/cli.js');
const dir = mkdtempSync(join(tmpdir(), 'value-'));
const home = mkdtempSync(join(tmpdir(), 'value-home-'));
let log = '';
try {
  cpSync('test/fixtures/value-test', dir, { recursive: true });
  const gitConfig = join(home, 'gitconfig');
  writeFileSync(gitConfig, '');
  const host = Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('GIT_CONFIG')));
  const base = { ...host, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1', HOME: home, PYTEST_DISABLE_PLUGIN_AUTOLOAD: '1', DONE_DONE_EVIDENCE_ROOT: undefined, DONE_DONE_RUN_ID: undefined, DONE_DONE_HOME: home };
  const sh = (cmd) => spawnSync('sh', ['-c', cmd], { cwd: dir, encoding: 'utf8', env: base }).stdout;
  sh('git init -q && git add . && git -c user.name=t -c user.email=t@t commit -q -m init');
  // every file's bytes, so "unchanged" means the sources and the tests are the same after the run
  const snapshot = () => sh('git ls-files -co --exclude-standard | sort | xargs sha256sum') + sh('git status --porcelain');
  const before = snapshot();
  const r = spawnSync('node', [cli, 'tests', 'value', '--json'], { cwd: dir, encoding: 'utf8', env: base });
  log += `$ done-done tests value --json\nexit ${r.status}\n${r.stdout}\n`;
  const doc = JSON.parse(r.stdout);
  const verdict = Object.fromEntries(doc.tests.map((t) => [t.test, t]));
  assert.equal(r.status, 1, 'slop and a duplicate fail the command');
  assert.equal(doc.faults.length, 2, 'the fixture source offers two faults');
  assert.equal(verdict.real.verdict, 'real');
  assert.equal(verdict.real.caught, 2);
  assert.equal(verdict.slop.verdict, 'slop');
  assert.equal(verdict.slop.caught, 0);
  assert.equal(verdict['slow-duplicate'].verdict, 'duplicate');
  assert.equal(verdict['slow-duplicate'].duplicate_of, 'real');
  assert.ok(verdict['slow-duplicate'].seconds > verdict.real.seconds, 'the duplicate is the slower one');
  assert.equal(snapshot(), before, 'the work copy is unchanged');
  log += `work copy unchanged: ${before.split('\n').length} lines of file hashes and git status match before and after\n`;

  // A separate synthetic repository keeps the production module fixed across all three test revisions.
  const lab = join(dir, 'shadow-lab');
  mkdirSync(join(lab, 'src'), { recursive: true });
  mkdirSync(join(lab, 'journeys'));
  mkdirSync(join(lab, 'bin'));
  mkdirSync(join(lab, 'tests'));
  const boundary = "export function category(n) { return n >= 10 ? 'high' : 'low'; }\nexport function unused(n) { return n >= 3 ? 'yes' : 'no'; }\n";
  const source = join(lab, 'src/boundary.mjs');
  const test = join(lab, 'journeys/check.mjs');
  const baseTest = "import assert from 'node:assert/strict'; import { category } from '../src/boundary.mjs'; assert.equal(category(9), 'low'); assert.equal(category(11), 'high');\n";
  writeFileSync(source, boundary);
  writeFileSync(join(lab, 'src/nativecalc.py'), 'def positive(n):\n    return n > 0\n');
  writeFileSync(join(lab, 'tests/test_native.py'), 'from nativecalc import positive\n\ndef test_positive():\n    assert positive(1)\n    assert not positive(-1)\n');
  writeFileSync(join(lab, 'pyproject.toml'), '[tool.mutmut]\nsource_paths = ["src/"]\npytest_add_cli_args_test_selection = ["tests/test_native.py"]\n');
  writeFileSync(join(lab, 'journeys/native-adapter.mjs'), `import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const inputs = JSON.parse(process.argv[3]);
if (process.argv[2] !== 'PYTHONPATH=src python -m pytest -q tests/test_native.py' || inputs.join() !== 'src/nativecalc.py') process.exit(9);
const run = spawnSync('mutmut', ['run', '--max-children', '1'], { encoding: 'utf8' });
if (run.status !== 0) { console.error(run.stdout, run.stderr); process.exit(run.status || 1); }
const results = spawnSync('mutmut', ['results', '--all', 'true'], { encoding: 'utf8' });
if (results.status !== 0) { console.error(results.stderr); process.exit(1); }
const mutants = results.stdout.split('\\n').flatMap(line => { const m = /^\\s*(.+?):\\s*(killed|survived|timeout|no tests)$/i.exec(line); return m ? [{ id: m[1], status: ({ killed: 'Killed', survived: 'Survived', timeout: 'Timeout', 'no tests': 'NoCoverage' })[m[2].toLowerCase()] }] : []; });
if (!mutants.length) { console.error(results.stdout, results.stderr); process.exit(1); }
writeFileSync('native-report.json', JSON.stringify({ files: { 'src/nativecalc.py': { mutants } } }));
`);
  writeFileSync(join(lab, 'src/other.mjs'), 'export const other = 1;\n');
  writeFileSync(test, baseTest);
  writeFileSync(join(lab, 'journeys/timeout.mjs'), 'setTimeout(() => {}, 20000);\n');
  writeFileSync(join(lab, 'journeys/red.mjs'), "console.error('clean failure'); process.exit(1);\n");
  writeFileSync(join(lab, 'journeys/wrapper.sh'), "#!/bin/sh\ncase $1 in first) echo missing-first >&2;; second) echo missing-second >&2;; esac\nexit 1\n");
  writeFileSync(join(lab, 'contract.txt'), 'Contract: Umer may export a report.\n');
  writeFileSync(join(lab, 'journeys/prose.sh'), "#!/bin/sh\ngrep -q 'Umer may export a report' contract.txt\n");
  writeFileSync(join(lab, 'bin/target.sh'), "#!/bin/sh\nprintf good\n");
  writeFileSync(join(lab, 'journeys/shell.sh'), "#!/bin/sh\n[ \"$(sh bin/target.sh)\" = good ]\n");
  writeFileSync(join(lab, '.done-done.yaml'), `app: lab
journeys:
  boundary:
    command: node journeys/check.mjs
  red:
    command: node journeys/red.mjs
  timeout:
    command: node journeys/timeout.mjs
    size: ci
  shell:
    command: sh journeys/shell.sh
  native:
    command: PYTHONPATH=src python -m pytest -q tests/test_native.py
  prose:
    command: sh journeys/prose.sh
  first:
    command: sh journeys/wrapper.sh first
  second:
    command: sh journeys/wrapper.sh second
affected:
  owners:
    boundary:
      tests: [journeys/check.mjs]
      inputs: [src/boundary.mjs]
    shell:
      tests: [journeys/shell.sh]
      inputs: [bin/target.sh]
    native:
      tests: [tests/test_native.py]
      inputs: [src/nativecalc.py]
hygiene:
  adapters:
    .py:
      command: 'node journeys/native-adapter.mjs "$DONE_DONE_HYGIENE_TEST" "$DONE_DONE_HYGIENE_INPUTS"'
      report: native-report.json
  shell_faults:
    - file: bin/target.sh
      was: 'printf good'
      now: 'printf bad'
      review: synthetic-reviewed-fault
`);
  const labRun = (args) => {
    const start = performance.now();
    const result = spawnSync('node', [cli, 'tests', 'value', ...args, '--shadow', '--faults', '100', '--json'], { cwd: lab, env: base, encoding: 'utf8', timeout: 300000 });
    log += `$ done-done tests value ${args.join(' ')} --shadow --faults 100 --json\nexit ${result.status}, ${Math.round(performance.now() - start)}ms\n${result.stdout}${result.stderr}\n`;
    assert.equal(result.status, 0, `shadow command: ${result.stderr} ${result.stdout}`);
    return JSON.parse(result.stdout);
  };
  const init = spawnSync('sh', ['-c', 'git init -q && git add . && git -c user.name=t -c user.email=t@t commit -q -m init'], { cwd: lab, env: base, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  const strykerAvailable = spawnSync('stryker', ['--version'], { cwd: lab, env: base, encoding: 'utf8' }).status === 0;
  const nativeAvailable = spawnSync('mutmut', ['--version'], { cwd: lab, env: base, encoding: 'utf8' }).status === 0;
  const rows = [];
  if (!strykerAvailable) log += 'not proven: StrykerJS is not installed on PATH\n';
  for (const withBoundary of strykerAvailable ? [false, true, false] : []) {
    writeFileSync(test, baseTest + (withBoundary ? "assert.equal(category(10), 'high');\n" : ''));
    const doc = labRun(['boundary']);
    const row = doc.findings[0];
    assert.notEqual(row.outcome, 'unknown', JSON.stringify(row));
    const mutant = row.mutants.find(m => m.replacement === 'n > 10');
    assert.ok(mutant, `missing boundary mutation: ${JSON.stringify(row.mutants)}`);
    rows.push(mutant.outcome);
    assert.ok(row.mutants.some(m => m.outcome === 'no coverage'), `missing uncovered mutant: ${JSON.stringify(row.mutants)}`);
    assert.equal(readFileSync(source, 'utf8'), boundary);
  }
  if (strykerAvailable) assert.deepEqual(rows, ['survivor', 'killed', 'survivor']);
  assert.equal(labRun(['red']).findings[0].outcome, 'clean-red');
  assert.equal(labRun(['timeout']).findings[0].outcome, 'timeout');
  const first = labRun(['first']).findings[0], second = labRun(['second']).findings[0];
  assert.equal(first.outcome, 'clean-red'); assert.match(first.detail, /missing-first/);
  assert.equal(second.outcome, 'clean-red'); assert.match(second.detail, /missing-second/);
  const prose = labRun(['prose']).findings[0];
  assert.equal(prose.outcome, 'unknown'); assert.match(prose.detail, /mapping/);
  assert.equal(labRun(['boundary', '--source', 'src/other.mjs']).findings[0].outcome, 'wrong target');
  if (nativeAvailable) {
    const native = labRun(['native']).findings[0];
    assert.ok(native.mutants.some(m => m.outcome === 'killed'), `native mutmut result: ${JSON.stringify(native)}`);
  } else log += 'not proven: mutmut is not installed on PATH\n';
  const shellBefore = readFileSync(join(lab, 'bin/target.sh'), 'utf8');
  const shellResult = labRun(['shell']);
  assert.equal(shellResult.shell_faults[0].outcome, 'killed');
  assert.equal(readFileSync(join(lab, 'bin/target.sh'), 'utf8'), shellBefore);
  log += `boundary outcomes: ${rows.length ? rows.join(' -> ') : 'not proven'}; a timeout, two wrapper failures and a valid prose contract distinguished; production and reviewed shell target unchanged\n`;

  writeFileSync(join(evidence, 'test-value.log'), log);
  writeFileSync(join(evidence, 'steps.json'), JSON.stringify({
    target: { version: JSON.parse(readFileSync('package.json', 'utf8')).version },
    start: 'Synthetic value fixtures with fixed JavaScript and shell sources, a native Python module, and journeys with assertions, wrapper failures and a prose contract.',
    steps: ['Run the original value fixture and compare work-copy hashes', 'Run shadow valuation with a boundary assertion absent, present, then absent', 'Drive clean failures, a timeout, wrong target, prose, native mutmut and a reviewed shell fault', 'Compare the production JavaScript and shell bytes'],
    result: `Clean failures, a timeout, wrong target and the shell fault were recorded with production bytes unchanged. Boundary transition: ${strykerAvailable ? rows.join(' -> ') : 'not proven: StrykerJS unavailable'}. Native mutation: ${nativeAvailable ? 'recorded' : 'not proven: mutmut unavailable'}.`,
  }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}
