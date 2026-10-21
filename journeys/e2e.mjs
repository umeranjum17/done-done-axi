// e2e journey: drives the built CLI end to end against a throwaway fixture repo.
// Runs from the done-done repo root with DONE_DONE_EVIDENCE_ROOT and
// DONE_DONE_RUN_ID set by `done-done run e2e`. Follows the repo's own
// integrations/firstmate/brief-include.md contract: init, run, check, receipt.
// Writes e2e.log, the real-product rule's and affected's transcripts plus the fixture's captures into DONE_DONE_EVIDENCE_ROOT.
// Node stdlib only, plus Chrome or Chromium on PATH for the look journeys; exits nonzero on the first failure.
import { execFileSync, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { crc32 } from 'node:zlib';

const REPO = process.cwd();
const CLI = process.env.DONE_DONE_TEST_CLI || join(REPO, 'dist', 'cli.js');
const OUT = process.env.DONE_DONE_EVIDENCE_ROOT;
const RUN_ID = process.env.DONE_DONE_RUN_ID || process.argv[2];
if (!OUT || !RUN_ID) {
  console.error('e2e: DONE_DONE_EVIDENCE_ROOT and DONE_DONE_RUN_ID must be set (run via `done-done run e2e`)');
  process.exit(2);
}

const log = [];
const say = (s) => { log.push(s); console.error(s); };
const tmp = mkdtempSync(join(tmpdir(), 'dd-e2e-'));
const home = join(tmp, 'home');
const repo = join(tmp, 'repo');
mkdirSync(join(repo, 'src'), { recursive: true });
const env = {
  ...process.env,
  DONE_DONE_HOME: home,
  DONE_DONE_TEST_CLI: CLI,
  DONE_DONE_LOOK_FIXTURES: join(REPO, 'test', 'fixtures', 'look'),
  GIT_AUTHOR_NAME: 'e2e', GIT_AUTHOR_EMAIL: 'e2e@example.com',
  GIT_COMMITTER_NAME: 'e2e', GIT_COMMITTER_EMAIL: 'e2e@example.com',
};

try {
  // A real PNG with no binary deps (same shape test/cli.test.mjs uses).
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])));
    return Buffer.concat([len, Buffer.from(type), data, crc]);
  };
  const png = (seed) => {
    const w = 200, h = 120, raw = Buffer.alloc(h * (w * 3 + 1));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
      raw.set([(x * 3 + seed) % 256, (y * 5) % 256, (x + y) % 256], y * (w * 3 + 1) + 1 + x * 3);
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  };

  const drive = (code, ...args) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8' });
    say(`$ done-done ${args.join(' ')}\n${r.stdout}${r.stderr}\nexit: ${r.status}`);
    assert.equal(r.status, code, r.error?.message || r.stdout + r.stderr);
    return r.stdout;
  };
  const dd = (...args) => drive(0, ...args);
  const sh = (...a) => execFileSync('git', a, { cwd: repo, env, encoding: 'utf8' });

  // Fixture repo: minimal app with its own journeys. done-done gives no result without its judge, so the fixture's judge is a
  // stub (deterministic, never a model) that says each capture shows the outcome, and its agent a stub doctor finds but no
  // step here starts. The look journeys call the look step on a phone screen with a clipped card title and on the same
  // screen fixed.
  // The committed recipe names the CLI and the fixture pages through env, so it holds no path of this checkout.
  const look = (page) => `node "\${DONE_DONE_TEST_CLI:?}" look "\${DONE_DONE_LOOK_FIXTURES:?}/${page}.html" --out "$DONE_DONE_EVIDENCE_ROOT/${page}.png"`;
  const stub = (name, body) => (writeFileSync(join(tmp, name), `#!${process.execPath}\n${body}\n`, { mode: 0o755 }), join(tmp, name));
  // The coverage lists every judge reply carries: this one-part outcome names no part, so both are empty.
  const answer = JSON.stringify({ relevance: { probabilities: { correct: 0.95, wrong: 0.03, unclear: 0.02 }, rationale: 'It shows the outcome.', personReason: 'It shows the outcome.', parts: [], covers: [] } });
  const judge = stub('judge-gemini', `require('node:fs').readFileSync(0, 'utf8');\nprocess.stdout.write(JSON.stringify({ response: ${JSON.stringify(answer)} }));`);
  const agent = stub('agent-opencode', 'process.exit(1);');
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'config.yaml'), `agent: opencode\nagent_config:\n  opencode: { model: stub/agent }\njudge:\n  route: answerer:gemini\n  model: stub-judge\nagent_path_override: { opencode: ${JSON.stringify(agent)}, gemini: ${JSON.stringify(judge)} }\n`);
  writeFileSync(join(repo, '.done-done.yaml'), `app: fixture\njourneys:\n  shots:\n    command: node make-shots.mjs \${RUN_ID}\n    core: true\n${['clipped', 'fixed'].map((p) => `  look-${p}:\n    command: ${JSON.stringify(look(p))}\n`).join('')}`);
  // The screen is committed beside the recipe and named relative to it, so the fixture holds no absolute path.
  writeFileSync(join(repo, 'screen.png'), png(3));
  // The step record a journey writes beside its captures: target version, start state, user steps and the result a user sees.
  const shotsSteps = { target: { version: '1.0.0' }, start: 'a fresh fixture app', steps: ['open the home screen'], result: 'the fixture home screen renders' };
  writeFileSync(join(repo, 'make-shots.mjs'),
    `import { copyFileSync, writeFileSync } from 'node:fs';\nconst out = process.env.DONE_DONE_EVIDENCE_ROOT;\ncopyFileSync('screen.png', out + '/home.png');\nwriteFileSync(out + '/steps.json', ${JSON.stringify(JSON.stringify(shotsSteps))});\n`);
  writeFileSync(join(repo, 'src', 'app.js'), 'export const app = 1;\n');
  sh('init', '-q', '-b', 'main'); sh('add', '-A'); sh('commit', '-qm', 'init');
  const head = sh('rev-parse', 'HEAD').trim();
  say(`fixture HEAD: ${head}`);

  // A repo whose older init wrote .agents/skills/verify-<app> keeps working, and init moves it to done-done-verify-<app> once.
  const old = join(tmp, 'legacy');
  mkdirSync(join(old, '.agents', 'skills', 'verify-legacy'), { recursive: true });
  writeFileSync(join(old, '.done-done.yaml'), 'app: legacy\n');
  writeFileSync(join(old, '.agents', 'skills', 'verify-legacy', 'SKILL.md'), '---\nname: "verify-legacy"\n---\n\n# verify-legacy\n');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: old, env });
  const init = spawnSync(process.execPath, [CLI, 'init'], { cwd: old, env, encoding: 'utf8' });
  say(`$ done-done init   (in a repo with .agents/skills/verify-legacy)\n${init.stdout}${init.stderr}\nexit: ${init.status}`);
  assert.match(init.stdout, /skill_renamed: \.agents\/skills\/verify-legacy -> \.agents\/skills\/done-done-verify-legacy/);
  assert.deepEqual(readdirSync(join(old, '.agents', 'skills')), ['done-done-verify-legacy'], 'moved, no duplicate');
  assert.match(readFileSync(join(old, '.agents', 'skills', 'done-done-verify-legacy', 'SKILL.md'), 'utf8'), /name: "done-done-verify-legacy"/);

  // A config that names no core journey (the one flow a user cannot live without) fails doctor, with the fix command.
  const named = readFileSync(join(repo, '.done-done.yaml'), 'utf8');
  writeFileSync(join(repo, '.done-done.yaml'), named.replace('    core: true\n', ''));
  const noCore = JSON.parse(drive(2, '--json', 'doctor')).checks.find((c) => c.check === 'core_journey');
  assert.equal(noCore.status, 'missing');
  assert.match(noCore.fix, /done-done init --journey <name> --core -- /);
  writeFileSync(join(repo, '.done-done.yaml'), named);
  assert.equal(JSON.parse(dd('--json', 'doctor')).checks.find((c) => c.check === 'core_journey').detail, 'journey shots is the core user journey');
  const runOut = dd('run', 'shots');
  const runId = /run_id:\s*"?([^\s"]+)"?/.exec(runOut)?.[1];
  if (!runId) throw new Error('could not parse run_id from run output');
  assert.equal(JSON.parse(dd('--json', 'status', '--run', runId)).run_id, runId, 'status shows the run record that run printed');
  const shot = join(home, 'evidence', 'fixture', runId, 'home.png');
  dd('check', '--outcome', 'fixture home renders', shot);
  // Relative citations select the explicit base, never a same-named cwd file.
  const base = join(tmp, "citation base's captures");
  mkdirSync(base);
  copyFileSync(shot, join(base, 'home.png'));
  writeFileSync(join(repo, 'home.png'), 'wrong same-named file\n');
  drive(2, 'check', '--outcome', 'fixture home renders', 'home.png');
  const selected = JSON.parse(dd('--json', 'check', '--citation-base', base, '--outcome', 'fixture home renders', 'home.png'));
  assert.deepEqual(selected.evidence, [join(base, 'home.png')]);
  const follow = (result, source) => {
    const command = result.help[0].split(': ')[1]
      .replace('done-done ', `${JSON.stringify(process.execPath)} ${JSON.stringify(CLI)} `)
      .replace('<PR URL>', JSON.stringify(source));
    const output = execFileSync('sh', ['-c', command], { cwd: repo, env, encoding: 'utf8' });
    say(`$ ${command}\n${output}`);
    return output;
  };
  follow(selected);
  dd('check', '--citation-base', repo, '--outcome', 'fixture home renders', shot);
  drive(2, 'check', '--citation-base', base, '--outcome', 'fixture home renders', 'missing.png');
  writeFileSync(join(base, 'stray.log'), 'unrecorded output\n');
  drive(2, 'check', '--citation-base', base, '--outcome', 'fixture home renders', 'stray.log');
  const body = join(tmp, 'checks.md');
  writeFileSync(body, '## Checks\noutcome: fixture home renders\nrepro: n/a: no bug\nproof: done-done-verify-fixture - done-done run shots\nevidence: home.png\n');
  // Untracked counterfactual output must not change the caller's tracked identity.
  const from = JSON.parse(dd('--json', 'check', '--citation-base', base, '--from', body));
  follow(from);
  assert.match(dd('receipt', '--verify', head), /skill: done-done-verify-fixture/, 'the receipt names the verify skill that ran');
  sh('remote', 'add', 'origin', 'https://example.com/fixture.git');
  sh('update-ref', 'refs/remotes/origin/main', head);
  for (const args of [['--from', body], ['--outcome', 'fixture home renders', 'home.png']]) {
    const remote = JSON.parse(dd('--json', 'check', '--citation-base', base, ...args));
    follow(remote, body);
  }

  // affected: the journeys a change needs, from the verify skill's feature map, and exit 1 until a receipt for HEAD covers them.
  const affectedStart = log.length;
  const affected = (code, ...args) => JSON.parse(drive(code, '--json', 'affected', ...args));
  // HEAD's receipt runs shots, the core journey: with no earlier proof to diff from, the core journey is what HEAD needs.
  assert.equal(affected(0).result, 'fresh');
  sh('checkout', '-q', '-b', 'affected');
  const features = join(repo, '.agents', 'skills', 'done-done-verify-fixture', 'features');
  mkdirSync(features, { recursive: true });
  writeFileSync(join(features, 'README.md'), '# fixture features\n\n- [Home](home.md) (core journey): the home screen\n');
  writeFileSync(join(features, 'home.md'), '# Home\n\nSource: `src/app.js`. Drive: `done-done run shots`.\n');
  writeFileSync(join(repo, 'src', 'app.js'), 'export const app = 2;\n');
  sh('add', '.agents', 'src'); sh('commit', '-qm', 'home feature');
  const stale = affected(1);
  assert.equal(stale.result, 'stale', 'the receipt is for the commit before');
  assert.match(stale.base, /the last receipt/);
  assert.deepEqual(stale.journeys.map((j) => j.name), ['shots']);
  assert.match(stale.journeys[0].why, /feature home cites src\/app\.js/);
  assert.equal(stale.unmapped, undefined, 'every change is mapped');
  // A file no feature cites is uncertain: the core journey runs and the file is flagged for the feature map.
  writeFileSync(join(repo, 'src', 'billing.js'), 'export const bill = 1;\n');
  sh('add', 'src'); sh('commit', '-qm', 'billing');
  const unsure = affected(1);
  assert.deepEqual(unsure.unmapped, ['src/billing.js']);
  assert.match(unsure.fallback, /^uncertain: 1 changed file is in no feature or journey/);
  assert.match(unsure.help.at(-1), /Flag the gap: src\/billing\.js is in no feature or journey/);
  assert.match(drive(0), /This change needs fresh proof: done-done run shots/, 'bare done-done, what the session hooks run, names the journeys');
  // A fresh run of the journey it named, checked and receipted for the same claim, makes HEAD's proof fresh again.
  const again = /run_id:\s*"?([^\s"]+)"?/.exec(dd('run', 'shots'))[1];
  const againBody = join(tmp, 'affected-checks.md');
  writeFileSync(againBody, `## Checks\noutcome: fixture home renders\nrepro: n/a: no bug\nproof: done-done-verify-fixture - done-done run shots\nevidence: ${join(home, 'evidence', 'fixture', again, 'home.png')}\n`);
  dd('receipt', '--from', againBody, '--claim-id', 'main');
  const fresh = affected(0);
  assert.equal(fresh.result, 'fresh');
  assert.match(fresh.help.at(-1), /Flag the gap: src\/billing\.js/, 'a fresh receipt still flags the file no feature covers');
  // An explicit base reads the whole branch.
  assert.deepEqual(affected(0, 'main').journeys.map((j) => j.name), ['shots']);
  sh('checkout', '-q', 'main');
  const affectedLog = log.slice(affectedStart);

  // A look hit fails the journey that calls it, naming the element, kind and text; the fixed page passes.
  const lookRun = (page, code) => {
    const out = drive(code, 'run', `look-${page}`);
    const id = /run_id:\s*"?([^\s"]+)"?/.exec(out)?.[1];
    const capture = join(home, 'evidence', 'fixture', id, `${page}.png`);
    const record = JSON.parse(readFileSync(capture.replace(/\.png$/, '.dom.json'), 'utf8'));
    assert.deepEqual(readFileSync(capture).subarray(16, 24), Buffer.from([0, 0, 1, 134, 0, 0, 3, 76]), 'the capture is 390x844');
    return { out: log.at(-1), record, capture };
  };
  const clipped = lookRun('clipped', 1);
  assert.match(clipped.out, /clipped text: h3\.card-title \\?"Answered: the release notes are approved\\?" is cut by its own box/);
  assert.deepEqual(clipped.record.clipped_text.map((q) => q.element), ['h3.card-title']);
  const fixed = lookRun('fixed', 0);
  assert.deepEqual([fixed.record.clipped_text, fixed.record.cut_off, fixed.record.squashed_text, fixed.record.overflow], [[], [], [], false]);

  // The lint gate: a real claim passes; a claim naming a file that is not there fails with exit 1.
  const lintDir = join(tmp, 'lint');
  mkdirSync(lintDir);
  writeFileSync(join(lintDir, 'run.log'), 'lint evidence\n');
  const claim = (name, evidence) => { const f = join(lintDir, name); writeFileSync(f, `## Checks\noutcome: a user can lint a claim\nrepro: n/a: no bug\nproof: no verify skill - done-done lint\nevidence: ${evidence}\n`); return f; };
  assert.equal(drive(0, 'lint', claim('pass.md', 'run.log'), lintDir).trim(), 'PASS');
  assert.match(drive(1, 'lint', claim('fail.md', 'gone.log'), lintDir), /^FAIL: evidence file missing or empty/);

  // The optional lint size rules: a 1,100-line PR (200 lines already shipped upstream, 300 moved from a sibling repo) read through a stand-in gh
  // fails with both rules off (the default) and passes with either one on.
  const lines = (a, b) => Array.from({ length: b - a }, (_, i) => `const v${a + i} = ${a + i};`);
  const diff = (ls) => `diff --git a/lib/big.js b/lib/big.js\n--- /dev/null\n+++ b/lib/big.js\n${ls.map((l) => `+${l}`).join('\n')}\n`;
  const ghDir = join(tmp, 'gh');
  mkdirSync(ghDir);
  const stash = (name, text) => { writeFileSync(join(ghDir, name), text); return JSON.stringify(join(ghDir, name)); };
  const prBody = '## Checks\noutcome: a repo can switch on the lint size rules\nrepro: n/a: no bug\nproof: no verify skill - done-done lint\nevidence: not proven: fixture\n\nmoved-from: acme/lib@main lib/=src/\n';
  const pr = stash('pr.json', JSON.stringify({ author: { login: 'umer' }, title: 'feat: big', headRefOid: 'head1', baseRefOid: 'base1', headRefName: 'fm/big', files: [{ path: 'lib/big.js', additions: 1100 }], body: prBody }));
  writeFileSync(join(ghDir, 'gh'), `#!/bin/sh
case "$*" in
  "pr view"*) cat ${pr} ;;
  "pr diff"*) cat ${stash('pr.diff', diff(lines(0, 1100)))} ;;
  *"vnd.github.diff"*) cat ${stash('up.diff', diff(lines(0, 200)))} ;;
  *"vnd.github.raw"*"contents/src/big.js?ref=main") cat ${stash('src.js', lines(500, 800).join('\n') + '\n')} ;;
  *"compare/up:main...head1"*) echo mergebase ;;
  "api repos/acme/tool --jq"*) echo up:main ;;
  *) echo "unexpected gh $*" >&2; exit 1 ;;
esac
`, { mode: 0o755 });
  env.PATH = `${ghDir}:${env.PATH}`;
  const config = readFileSync(join(repo, '.done-done.yaml'), 'utf8').replace(/\n*$/, '\n');
  const bigPr = (checks, code = checks ? 0 : 1) => { writeFileSync(join(repo, '.done-done.yaml'), config + checks); return drive(code, 'lint', 'https://github.com/acme/tool/pull/7', lintDir); };
  assert.match(bigPr(''), /^FAIL: 1100 added non-generated lines/);
  assert.equal(bigPr('checks:\n  upstream_catch_up: true\n').trim(), 'PASS');
  assert.equal(bigPr('checks:\n  moved_from: true\n').trim(), 'PASS');
  // checks.generated_paths: the PR's one file, lib/big.js, is the repo's own generated file. Unset it counts (FAIL above); a glob that covers it passes, one that misses it still fails.
  assert.equal(bigPr('checks:\n  generated_paths: ["lib/**"]\n').trim(), 'PASS');
  assert.match(bigPr('checks:\n  generated_paths: ["gen/**"]\n', 1), /^FAIL: 1100 added non-generated lines/);
  writeFileSync(join(repo, '.done-done.yaml'), config);

  // The real-product rule: a test, typecheck or lint run proves the code checks pass, not that the product works.
  const realStart = log.length;
  // gate: the receipt keeps the run behind each capture, so gate refuses code-only proof from git objects alone.
  const receipt = JSON.parse(readFileSync(join(home, 'evidence', 'fixture', '.done-done', 'receipts', `${head}.json`), 'utf8'));
  say(`receipt runs: ${JSON.stringify(receipt.runs)}`);
  sh('checkout', '-q', '-b', 'gate', head);
  const gateOn = (rec) => {
    mkdirSync(join(repo, '.done-done-receipts'), { recursive: true });
    writeFileSync(join(repo, '.done-done-receipts', `${head}.json`), JSON.stringify(rec, null, 2));
    sh('add', '.done-done-receipts');
    sh('commit', '-qm', 'receipt');
  };
  gateOn(receipt);
  assert.equal(drive(0, 'gate').trim(), 'PASS');
  gateOn({ ...receipt, runs: receipt.runs.map((r) => ({ ...r, journey: 'check', command: 'yarn run check > check.log' })) });
  assert.match(drive(1, 'gate'), /^FAIL: receipt for .* is no real-product proof: every cited capture comes from a code-only run \(check\)/);
  sh('checkout', '-q', 'main');
  // init refuses a journey that only wraps the test script, and writes nothing.
  assert.match(drive(2, 'init', '--journey', 'check', '--', 'yarn run check > $DONE_DONE_EVIDENCE_ROOT/check.log'), /is code-only: a test, typecheck, lint or build run proves the code checks pass, not that the product works/);
  assert.equal(readFileSync(join(repo, '.done-done.yaml'), 'utf8'), config, 'init wrote nothing');
  // The step record: a wrapper script that only runs the unit suite and logs it cannot satisfy a pane claim, a real CLI transcript
  // still satisfies a CLI claim, and a run recorded before step records keeps working with a warning.
  const withSteps = (rec) => `import { writeFileSync } from 'node:fs';\nconst out = process.env.DONE_DONE_EVIDENCE_ROOT;\n${rec}writeFileSync(out + '/steps.json', JSON.stringify(steps));\n`;
  writeFileSync(join(repo, 'wrapper.mjs'), withSteps(`writeFileSync(out + '/suite.log', 'ok 42 tests passed\\n');\nconst steps = { target: { version: '1.0.0' }, start: 'the repo checkout', steps: ['ran the unit suite'], result: '42 tests passed' };\n`));
  writeFileSync(join(repo, 'fixture-cli.mjs'), withSteps(`writeFileSync(out + '/greet.txt', '$ fixture-cli greet\\nhello\\n');\nconst steps = { target: { version: '1.0.0' }, start: 'fixture-cli installed, no config', steps: ['run fixture-cli greet'], result: 'fixture-cli greet prints hello' };\n`));
  writeFileSync(join(repo, '.done-done.yaml'), `${config}  wrapper:\n    command: node wrapper.mjs\n  cli:\n    command: node fixture-cli.mjs\n`);
  sh('add', '-A');
  sh('commit', '-qm', 'wrapper and cli journeys');
  const wrapRun = /run_id:\s*"?([^\s"]+)"?/.exec(dd('run', 'wrapper'))[1];
  assert.match(drive(2, 'check', '--outcome', 'a user can attach to a pane and see its output', join(home, 'evidence', 'fixture', wrapRun, 'suite.log')), /no cited capture comes from a run whose step record covers the claim.*never mentions attach, pane/);
  const cliRun = /run_id:\s*"?([^\s"]+)"?/.exec(dd('run', 'cli'))[1];
  dd('check', '--outcome', 'fixture-cli greet prints hello', join(home, 'evidence', 'fixture', cliRun, 'greet.txt'));
  const recFile = join(home, 'evidence', 'fixture', '.done-done', 'runs', `${cliRun}.json`);
  const recorded = JSON.parse(readFileSync(recFile, 'utf8'));
  delete recorded.tool;
  delete recorded.steps;
  writeFileSync(recFile, JSON.stringify(recorded));
  assert.match(dd('check', '--outcome', 'fixture-cli greet prints hello', join(home, 'evidence', 'fixture', cliRun, 'greet.txt')), /warnings[\s\S]*recorded before step records/);
  writeFileSync(join(repo, '.done-done.yaml'), config);
  sh('add', '-A');
  sh('commit', '-qm', 'journeys restored');
  // A hand-written check journey still runs, but its log alone is no proof, and doctor flags it.
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { check: 'echo all 42 tests passed' } }));
  const checkJourney = '  check:\n    command: npm run check > $DONE_DONE_EVIDENCE_ROOT/check.log 2>&1\n';
  writeFileSync(join(repo, '.done-done.yaml'), config + checkJourney);
  sh('add', 'package.json', '.done-done.yaml');
  sh('commit', '-qm', 'check journey');
  assert.equal(JSON.parse(dd('--json', 'doctor')).checks.find((c) => c.check === 'real_product').status, 'warning', 'a code-only journey beside real ones is a warning');
  const checkRun = /run_id:\s*"?([^\s"]+)"?/.exec(dd('run', 'check'))[1];
  assert.match(drive(2, 'check', '--outcome', 'pane attach works', join(home, 'evidence', 'fixture', checkRun, 'check.log')), /every cited capture comes from a code-only run \(check\)/);
  // The config that shipped a broken app: only code-only journeys. doctor fails, and check refuses even a real capture.
  writeFileSync(join(repo, '.done-done.yaml'), `app: fixture\njourneys:\n${checkJourney}`);
  sh('commit', '-qam', 'only the check journey');
  const codeDoctor = JSON.parse(drive(2, '--json', 'doctor')).checks.find((c) => c.check === 'real_product');
  assert.deepEqual([codeDoctor.status, codeDoctor.detail], ['missing', 'every journey in .done-done.yaml is code-only (check): a test, typecheck, lint or build run proves the code checks pass, not that the product works']);
  const adhoc = /run_id:\s*"?([^\s"]+)"?/.exec(dd('run', '--', 'node make-shots.mjs'))[1];
  assert.match(drive(2, 'check', '--outcome', 'fixture home renders', join(home, 'evidence', 'fixture', adhoc, 'home.png')), /every journey in \.done-done\.yaml is code-only \(check\)/);
  const realProduct = log.slice(realStart);

  // Proof for the outer run: transcript plus the fixture's own captures.
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${RUN_ID}.log`), log.join('\n') + '\n');
  copyFileSync(shot, join(OUT, `${RUN_ID}.home.png`));
  writeFileSync(join(OUT, `${RUN_ID}.real-product.log`), realProduct.join('\n') + '\n');
  writeFileSync(join(OUT, `${RUN_ID}.affected.log`), affectedLog.join('\n') + '\n');
  for (const [page, r] of [['clipped', clipped], ['fixed', fixed]]) copyFileSync(r.capture, join(OUT, `${RUN_ID}.look-${page}.png`));
  // The step record of this run, beside its captures: what a user does with the built CLI and what the fixture shows at the end.
  writeFileSync(join(OUT, 'steps.json'), JSON.stringify({
    target: { version: JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version },
    start: 'the built done-done CLI and a fresh fixture repo with no run, receipt or evidence',
    steps: ['init a repo and record its journeys', 'run the core journey and check its capture', 'record a receipt and gate on it', 'refuse code-only proof', 'look at a clipped and a fixed screen', 'lint a PR claim'],
    result: 'the fixture home screen is checked and receipted, code-only proof is refused, and the clipped screen fails look where the fixed one passes',
  }));
  const names = readdirSync(OUT).sort();
  say(`evidence: ${names.join(', ')}`);
} catch (err) {
  try {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `${RUN_ID}.log`), [...log, `FAIL: ${err.message}`].join('\n') + '\n');
  } catch { /* keep the original error */ }
  console.error(`e2e FAIL: ${err.message}`);
  process.exit(1);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
