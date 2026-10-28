// End-to-end: drives the built CLI against throwaway git repos with fictional fixtures.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, cpSync, mkdirSync, mkdtempSync, existsSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { parse, parseDocument } from 'yaml';
import { decode } from '@toon-format/toon';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.js');

// CLI results default to TOON; parse that (the AXI convention) or JSON with --json.
const toon = (r) => decode(r.out);
const json = (r) => JSON.parse(r.out);


function png(w, h, pixel, colour = 2) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])));
    return Buffer.concat([len, Buffer.from(type), data, crc]);
  };
  const channels = colour === 6 ? 4 : 3;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = colour;
  const raw = Buffer.alloc(h * (w * channels + 1));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) raw.set(pixel(x, y), y * (w * channels + 1) + 1 + x * channels);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const screen = (seed = 0) => png(200, 120, (x, y) => [(x * 3 + seed) % 256, (y * 5) % 256, (x + y) % 256]);
const blank = () => png(200, 120, () => [250, 250, 250]);

// The step record a fixture journey writes beside its captures (steps.json): what the check reads a claim against.
const STEPS = { target: { version: '1.0.0' }, start: 'a fresh notes app with no notes', steps: ['open the home screen', 'open settings'], result: 'home and settings render' };
// The script a fixture journey runs (or imports) to write its step record: it restates the outcome a call claims (DD_OUTCOME).
const STEPS_MJS = `import { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.DONE_DONE_EVIDENCE_ROOT + '/steps.json', JSON.stringify({ ...${JSON.stringify(STEPS)}, result: process.env.DD_OUTCOME || ${JSON.stringify(STEPS.result)} }));\n`;
// The step record of a hand-driven run, for an outcome.
const stepsOf = (result) => JSON.stringify({ ...STEPS, result });
const JUDGED = 'app: notes\nevidence:\n  root: .proof\n  ignore_paths: ["docs/**"]\njourneys:\n  shots:\n    command: node make-shots.mjs ${RUN_ID}\n    core: true\n';
// done-done gives no result without its judge, so every repo starts with a stub judge (never a model): a gemini stub
// through agent_path_override that says each capture shows the outcome. A test about the judge writes its own config,
// and judgeYaml(env) adds the stub back; a gemini-agent test names it through pi, so the agent stays its own binary.
const JUDGE_CONFIG = (bin, via = 'gemini') => `judge:\n  route: answerer:${via}\n  model: stub-judge\nagent_path_override: { ${via}: ${JSON.stringify(bin)} }\n`;
const judgeYaml = (env, via) => JUDGE_CONFIG(env.DD_STUB_JUDGE, via);
function stubJudge(dir, probabilities = { correct: 0.95, wrong: 0.03, unclear: 0.02 }) {
  const bin = join(dir, 'judge-gemini');
  const answer = JSON.stringify({ relevance: { probabilities, rationale: 'The screen shows the outcome.', personReason: 'The screen shows the outcome.', parts: [], covers: [] } });
  writeFileSync(bin, `#!${process.execPath}
const input = require('node:fs').readFileSync(0, 'utf8');
const base = ${JSON.stringify(answer)};
const keys = [...new Set([...input.matchAll(/capture_\\d+/g)].map((m) => m[0]))];
const value = keys.length ? Object.fromEntries(keys.map((k) => [k, JSON.parse(base).relevance])) : JSON.parse(base);
process.stdout.write(JSON.stringify({ response: JSON.stringify(value) }));
`, { mode: 0o755 });
  return bin;
}
const withStubJudge = (env, dir) => {
  env.DD_STUB_JUDGE = stubJudge(dir);
  mkdirSync(env.DONE_DONE_HOME, { recursive: true });
  writeFileSync(join(env.DONE_DONE_HOME, 'config.yaml'), judgeYaml(env));
};
function setup(projectYaml = JUDGED) {
  const dir = mkdtempSync(join(tmpdir(), 'done-done-test-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo');
  // The fixture never inherits the machine's git config or hooks: GIT_CONFIG_* env (it can set core.hooksPath) is dropped, and the global config is an empty file in the fixture.
  writeFileSync(join(dir, 'gitconfig'), '');
  const host = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_CONFIG')));
  const env = { ...host, GIT_CONFIG_GLOBAL: join(dir, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', DONE_DONE_HOME: join(dir, 'home'), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
  withStubJudge(env, dir);
  mkdirSync(join(repo, 'src'), { recursive: true });
  mkdirSync(join(repo, 'docs'));
  writeFileSync(join(repo, '.gitignore'), '.proof/\n');
  writeFileSync(join(repo, '.done-done.yaml'), projectYaml);
  writeFileSync(join(repo, 'src', 'app.js'), 'export const app = 1;\n');
  writeFileSync(join(repo, 'docs', 'guide.md'), '# guide\n');
  writeFileSync(join(dir, 'screen.png'), screen());
  writeFileSync(join(dir, 'screen2.png'), screen(7));
  writeFileSync(join(repo, 'steps.mjs'), STEPS_MJS);
  writeFileSync(
    join(repo, 'make-shots.mjs'),
    `import './steps.mjs';\nimport { copyFileSync, mkdirSync } from 'node:fs';\nconst out = '.proof/' + process.argv[2];\nmkdirSync(out, { recursive: true });\ncopyFileSync(${JSON.stringify(join(dir, 'screen.png'))}, out + '/home.png');\ncopyFileSync(${JSON.stringify(join(dir, 'screen2.png'))}, out + '/settings.png');\n`,
  );
  const sh = (...a) => execFileSync('git', a, { cwd: repo, env, stdio: 'pipe' });
  sh('init', '-q', '-b', 'main');
  sh('add', '-A');
  sh('commit', '-qm', 'init');
  // The fixture journey's step record restates the outcome a call claims (DD_OUTCOME), the way a journey written for that claim would.
  const dd = (...args) => {
    const at = args.indexOf('--outcome');
    if (at >= 0) env.DD_OUTCOME = args[at + 1];
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8' });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  const ddin = (input, ...args) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8', input });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  const head = () => sh('rev-parse', 'HEAD').toString().trim();
  const shots = (...outcomes) => {
    if (outcomes.length) env.DD_OUTCOME = outcomes.join('; ');
    const r = dd('run', 'shots');
    assert.equal(r.code, 0, r.out);
    const id = toon(r).run_id;
    return { id, files: [`.proof/${id}/home.png`, `.proof/${id}/settings.png`] };
  };
  return { dir, repo, env, sh, dd, ddin, head, shots };
}

test('approved design coverage: real CLI names a missing screen, then passes the complete contract', () => {
  const t = setup();
  const r = spawnSync(process.execPath, [join(dirname(CLI), '..', 'journeys', 'approved-design.mjs')], {
    env: { ...t.env, DONE_DONE_EVIDENCE_ROOT: join(t.dir, 'evidence') }, encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('check and receipt refuse proof from code-only journeys: a test, typecheck or lint log is not the product', () => {
  // The config that shipped a broken app: a journey that wraps the repo's check script, whose log says the code checks pass.
  const checkJourney = '  check:\n    command: npm run check > $DONE_DONE_EVIDENCE_ROOT/check.log 2>&1\n';
  const { repo, sh, dd, shots } = setup(`${JUDGED}${checkJourney}`);
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { check: 'echo all 42 tests passed' } }));
  sh('add', '-A');
  sh('commit', '-qm', 'check script');
  const run = dd('run', 'check');
  assert.equal(run.code, 0, run.out);
  const [log] = toon(run).evidence;
  const refused = dd('check', '--outcome', 'pane attach works', log);
  assert.equal(refused.code, 2, refused.out);
  assert.match(refused.out, /the judge was not asked.*every cited capture comes from a code-only run \(check\): a test, typecheck, lint or build run proves the code checks pass, not that the product works/);
  assert.match(refused.out, /done-done run shots/, 'the help names the journey that drives the product, never the code-only one');
  assert.equal(dd('receipt', '--outcome', 'pane attach works', log).code, 2, 'no receipt for code-only proof');
  // Beside captures of the real product the log is fine: the screens carry the proof.
  const { files } = shots('home and settings render');
  assert.equal(dd('check', '--outcome', 'home and settings render', ...files, log).code, 0);
  // A config whose journeys are all code-only is refused whatever it cites, naming them.
  writeFileSync(join(repo, '.done-done.yaml'), `app: notes\nevidence:\n  root: .proof\njourneys:\n${checkJourney}`);
  sh('commit', '-qam', 'only the check journey');
  const adhoc = dd('run', '--', 'node make-shots.mjs ${RUN_ID}');
  assert.equal(adhoc.code, 0, adhoc.out);
  const config = dd('check', '--outcome', 'home and settings render', ...toon(adhoc).evidence);
  assert.equal(config.code, 2, config.out);
  assert.match(config.out, /every journey in \.done-done\.yaml is code-only \(check\)/);
  assert.match(config.out, /done-done init --journey <name> -- '<command that drives the real app/, 'the help says how to record a real journey');
});

// A journey script that drives something, saves one capture and writes its step record (or none, or a broken one).
const driver = (capture, text, steps) => `import { writeFileSync } from 'node:fs';\nconst out = process.env.DONE_DONE_EVIDENCE_ROOT;\nwriteFileSync(out + '/${capture}', ${JSON.stringify(text)});\n${steps === undefined ? '' : `writeFileSync(out + '/steps.json', ${JSON.stringify(typeof steps === 'string' ? steps : JSON.stringify(steps))});\n`}`;

test('a claim needs a well-formed step record, never one that matches its words', () => {
  const journeys = {
    // A script that only runs the unit suite and logs it: not code-only by its name, so only its step record says what it did.
    wrapper: driver('suite.log', 'ok 42 tests passed\n', { target: { version: '1.0.0' }, start: 'the repo checkout', steps: ['ran the unit suite'], result: '42 tests passed' }),
    cli: driver('greet.txt', '$ notes greet\nhello\n', { target: { version: '1.0.0' }, start: 'notes installed with no config', steps: ['run notes greet'], result: 'notes greet prints hello' }),
    bare: driver('bare.txt', 'hello\n'),
    broken: driver('broken.txt', 'hello\n', { target: { version: '1.0.0' }, start: 'a fresh notes app', steps: [], result: 'notes greet prints hello' }),
    garbled: driver('garbled.txt', 'hello\n', '{not json'),
  };
  const { repo, sh, dd } = setup(`${JUDGED}${Object.keys(journeys).map((j) => `  ${j}:\n    command: node ${j}.mjs\n`).join('')}`);
  for (const [j, code] of Object.entries(journeys)) writeFileSync(join(repo, `${j}.mjs`), code);
  sh('add', '-A');
  sh('commit', '-qm', 'journeys');
  const version = JSON.parse(readFileSync(join(CLI, '..', '..', 'package.json'), 'utf8')).version;
  const ran = (j, capture) => {
    const r = dd('run', j);
    assert.equal(r.code, 0, r.out);
    const d = toon(r);
    assert.deepEqual(d.evidence.map((f) => basename(f)), [capture], 'the step record is a record, not a capture');
    return { id: d.run_id, file: d.evidence[0] };
  };
  const recordOf = (id) => JSON.parse(readFileSync(join(repo, '.proof', '.done-done', 'runs', `${id}.json`), 'utf8'));

  // The run record carries the steps, the target version and the done-done version that recorded it, beside the captures.
  const cli = ran('cli', 'greet.txt');
  assert.deepEqual(recordOf(cli.id).steps, { target: { version: '1.0.0' }, start: 'notes installed with no config', steps: ['run notes greet'], result: 'notes greet prints hello' });
  assert.equal(recordOf(cli.id).tool, version);
  assert.equal(existsSync(join(repo, '.proof', cli.id, 'steps.json')), true, 'the file stays beside the captures');
  // A real CLI transcript whose record names the command and its output proves a CLI claim.
  const pass = dd('check', '--outcome', 'notes greet prints hello', cli.file);
  assert.equal(pass.code, 0, pass.out);
  assert.equal(toon(pass).warnings, undefined);

  // A wrapped test log: its honest record says it ran the unit suite. The record's prose is never matched to the claim's, so a
  // claim about a pane reaches the judge, which decides whether the log shows one. The record itself stays required below.
  const wrapper = ran('wrapper', 'suite.log');
  const wrapped = dd('check', '--outcome', 'a user can attach to a pane and see its output', wrapper.file);
  assert.equal(wrapped.code, 0, wrapped.out);
  assert.deepEqual(toon(wrapped).judge.judged.map((r) => r.verdict), ['pass'], 'the judge is asked, and it decides');
  assert.equal(dd('receipt', '--outcome', 'a user can attach to a pane and see its output', wrapper.file).code, 0, 'and the claim can be receipted');
  assert.equal(dd('check', '--outcome', 'the unit suite passes with 42 tests', wrapper.file).code, 0);

  // A run with no step record, an invalid one, or one with a step list that is empty is refused, with the cause.
  const bare = dd('check', '--outcome', 'notes greet prints hello', ran('bare', 'bare.txt').file);
  assert.equal(bare.code, 2, bare.out);
  assert.match(bare.out, /run \S+ has no step record \(steps\.json beside its captures\)/);
  const broken = dd('check', '--outcome', 'notes greet prints hello', ran('broken', 'broken.txt').file);
  assert.match(broken.out, /step record steps\.json is invalid: steps must be a non-empty list of strings/);
  const garbled = ran('garbled', 'garbled.txt');
  assert.match(dd('check', '--outcome', 'notes greet prints hello', garbled.file).out, /step record steps\.json is invalid: it is not JSON/);
  assert.match(recordOf(garbled.id).steps_error, /^it is not JSON/);

  // A real capture whose record covers the claim carries the claim beside a log that has none.
  assert.equal(dd('check', '--outcome', 'notes greet prints hello', cli.file, wrapper.file).code, 0);

  // A run recorded before step records (no tool, no steps) keeps working, with a warning rather than a silent pass.
  const path = join(repo, '.proof', '.done-done', 'runs', `${cli.id}.json`);
  const old = recordOf(cli.id);
  delete old.tool;
  delete old.steps;
  writeFileSync(path, JSON.stringify(old));
  const warned = dd('check', '--outcome', 'notes greet prints hello', cli.file);
  assert.equal(warned.code, 0, warned.out);
  assert.match(toon(warned).warnings[0], new RegExp(`run ${cli.id} was recorded before step records.*re-run the journey so it writes steps\\.json`));
});

test('a fresh run of the real journey passes the check', () => {
  const { dd, shots } = setup();
  const { files } = shots();
  const r = dd('check', '--outcome', 'home and settings render', ...files);
  assert.equal(r.code, 0, r.out);
  const d = toon(r);
  assert.equal(d.result, 'pass');
  assert.equal(d.files, 2);
  assert.deepEqual(d.evidence, files);
});

test('empty, truncated, blank, tiny and mislabelled images fail with the reason', () => {
  const { repo, dd, shots } = setup();
  const { id, files } = shots();
  const p = (n) => join(repo, '.proof', id, n);
  const good = readFileSync(p('home.png'));
  const cases = {
    'empty.png': [Buffer.alloc(0), /empty \(0 bytes\)/],
    'cut.png': [good.subarray(0, good.length - 20), /png truncated/],
    'blank.png': [blank(), /blank frame/],
    'tiny.png': [png(16, 16, (x) => [x * 16, 0, 0]), /smaller than 64x64/],
    'shot.jpg': [good, /named \.jpg but the bytes are png/],
    'notes.json': [Buffer.from('{oops'), /json does not parse/],
  };
  for (const [name, [bytes, why]] of Object.entries(cases)) {
    writeFileSync(p(name), bytes);
    const r = dd('check', '--outcome', `case ${name}`, `.proof/${id}/${name}`);
    assert.equal(r.code, 2, `${name}: ${r.out}`);
    assert.match(r.out, why, name);
  }
  assert.equal(dd('check', '--outcome', 'x', files[0], files[0]).code, 2, 'byte-identical files in one claim');
});

test('evidence goes stale when HEAD moves past code, but not past ignored paths', () => {
  const { repo, sh, dd, shots } = setup();
  const { files } = shots('still fresh', 'stale now');
  sh('commit', '-q', '--allow-empty', '-m', 'empty');
  assert.equal(dd('check', '--outcome', 'still fresh', ...files).code, 2, 'an empty diff is not "only ignored paths"');
  writeFileSync(join(repo, 'docs', 'guide.md'), '# guide v2\n');
  sh('commit', '-qam', 'docs only');
  assert.equal(dd('check', '--outcome', 'still fresh', ...files).code, 0, 'a diff of only ignored paths keeps evidence fresh');
  writeFileSync(join(repo, 'src', 'app.js'), 'export const app = 2;\n');
  sh('commit', '-qam', 'code');
  const r = dd('check', '--outcome', 'stale now', ...files);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /evidence is for commit \w+, HEAD is \w+ \(changed: src\/app\.js\)/);
});

test('files outside any run record stop before the judge; a failed or dirty run fails', () => {
  const { dir, repo, dd } = setup('app: notes\nevidence:\n  root: .proof\njourneys:\n  broken:\n    command: node make-shots.mjs ${RUN_ID} && echo FAIL notes.test.js timed out && exit 4\n');
  const r = dd('check', '--outcome', 'hand made', join(dir, 'screen.png'));
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /the judge was not asked, so there is no verdict: .*not in any done-done run record/);
  const none = dd('run', '--', 'true');
  assert.equal(none.code, 1, none.out);
  assert.equal(toon(none).reason.split(';')[0], `the run wrote no files into its folder .proof/${toon(none).run_id}`, 'the reason names the run folder repo-relative');
  const lit = dd('run', '--', 'node', 'make-shots.mjs', '$DONE_DONE_EVIDENCE_ROOT/x.png');
  assert.equal(lit.code, 2, lit.out);
  assert.match(lit.out, /literal text \$DONE_DONE_EVIDENCE_ROOT.*env var inside the script, or double quotes/);
  const run = dd('run', 'broken');
  assert.equal(run.code, 1, run.out);
  assert.match(run.out, /exited 4/);
  assert.match(run.out, /reason: "the run command exited 4: FAIL notes\.test\.js timed out"/, 'the reason names the first failing line of the journey output');
  const id = run.out.match(/run_id: (\S+)/)[1];
  assert.match(dd('check', '--outcome', 'broken run', `.proof/${id}/home.png`).out, /its run command exited 4/);
  writeFileSync(join(repo, 'src', 'app.js'), 'export const app = 3;\n');
  const dirty = dd('run', '--', 'node make-shots.mjs ${RUN_ID}');
  assert.equal(dirty.code, 0, dirty.out);
  const d = dd('check', '--outcome', 'dirty', `.proof/${toon(dirty).run_id}/settings.png`);
  assert.equal(d.code, 2, d.out);
  assert.match(d.out, /uncommitted changes/);
});

test('open and close a hand-driven run', () => {
  const { dir, repo, dd, head } = setup();
  const open = dd('run', '--open');
  assert.equal(open.code, 0, open.out);
  const { run_id: id, evidence_root: folder } = toon(open);
  assert.equal(folder, `.proof/${id}`, 'a hand-driven run captures into its own folder');
  writeFileSync(join(repo, folder, 'cli.log'), '$ notes add milk\nadded: milk\nexit 0\n');
  writeFileSync(join(repo, folder, 'steps.json'), stepsOf('notes add works'));
  const close = dd('run', '--close', id);
  assert.equal(close.code, 0, close.out);
  assert.equal(dd('check', '--outcome', 'notes add works', `${folder}/cli.log`).code, 0);
  const base = join(dir, 'citations');
  mkdirSync(base);
  cpSync(join(repo, folder, 'cli.log'), join(base, 'cli.log'));
  writeFileSync(join(repo, 'cli.log'), 'wrong same-named output\n');
  assert.equal(dd('check', '--outcome', 'notes add works', 'cli.log').code, 2, 'default still reads cwd, not the citation base');
  const checked = dd('--json', 'check', '--citation-base', base, '--outcome', 'notes add works', 'cli.log');
  assert.equal(checked.code, 0, checked.out);
  assert.deepEqual(json(checked).evidence, [join(base, 'cli.log')]);
  assert.equal(dd('check', '--citation-base', base, '--outcome', 'notes add works', join(repo, folder, 'cli.log')).code, 0, 'absolute citations stay absolute');
  const missing = dd('check', '--citation-base', base, '--outcome', 'notes add works', 'missing.log');
  assert.equal(missing.code, 2, missing.out);
  assert.match(missing.out, /ENOENT/);
  writeFileSync(join(base, 'stray.log'), 'unrecorded output\n');
  assert.equal(dd('check', '--citation-base', base, '--outcome', 'notes add works', 'stray.log').code, 2, 'base does not bypass provenance');
  const body = join(dir, 'checks.md');
  writeFileSync(body, '## Checks\noutcome: notes add works\nrepro: n/a: no bug\nproof: no verify skill - done-done run --open\nevidence: cli.log\n');
  const receipt = dd('receipt', '--citation-base', base, '--from', body);
  assert.equal(receipt.code, 0, receipt.out);
  assert.equal(dd('receipt', '--verify', head()).code, 0, 'receipt stays bound to caller repo/head and original run store');
  assert.equal(dd('check', '--citation-base', '', '--outcome', 'x', 'cli.log').code, 2);
});

test('the same evidence cannot prove a second, different claim', () => {
  const { dd, sh, shots, repo, env } = setup();
  const { files } = shots();
  assert.equal(dd('check', '--outcome', 'home renders', ...files).code, 0);
  assert.equal(dd('check', '--outcome', 'home renders', ...files).code, 0, 're-checking the same claim is fine');
  const reworded = dd('check', '--outcome', 'home and settings render', ...files);
  assert.equal(reworded.code, 0, `rewording the claim on the same branch is not reuse: ${reworded.out}`);
  assert.ok(existsSync(join(repo, '.proof', '.done-done', 'ledger')), 'the ledger lives in the evidence root');
  assert.ok(!existsSync(join(env.DONE_DONE_HOME, 'hashes')), 'no machine-wide ledger');
  sh('checkout', '-qb', 'checkout-flow');
  const r = dd('check', '--outcome', 'checkout works', ...files);
  assert.equal(r.code, 2, r.out);
  assert.match(toon(r).error, /already used as proof of a different claim \(claim id main\), not this one \(claim id checkout-flow, from the current branch\)/);
  assert.equal(dd('check', '--claim-id', 'main', '--outcome', 'home renders', ...files).code, 0, '--claim-id names the claim');
  sh('checkout', '-q', '--detach');
  // A detached HEAD has no branch, so its claim is its commit: this evidence was already used under other claims.
  const detached = dd('check', '--outcome', 'home renders', ...files);
  assert.equal(detached.code, 2, detached.out);
  assert.match(toon(detached).error, /already used as proof of a different claim \(claim id main\), not this one \(claim id [0-9a-f]{40}, from the detached HEAD commit\)/);
  assert.equal(dd('check', '--claim-id', 'main', '--outcome', 'home and settings render', ...files).code, 0, 'a detached HEAD names its claim with --claim-id');
  assert.equal(dd('check', '--claim-id', ' ', '--outcome', 'x', ...files).code, 2, 'an empty claim id is a usage error');
});

test('Checks block: form rules, not-proven and trusted config', () => {
  const { repo, sh, dd, shots } = setup();
  const { files } = shots();
  const write = (body) => writeFileSync(join(repo, '..', 'pr.md'), body);
  write(`# PR\n\n## Checks\noutcome: home renders\nrepro: n/a: no bug\nproof: no verify skill - \`done-done run shots\`\nevidence: ${files.join(', ')}\n`);
  assert.equal(dd('check', '--from', '../pr.md').code, 0);
  write('## Checks\noutcome: x\nproof: y\n');
  assert.match(dd('check', '--from', '../pr.md').out, /missing repro, evidence/);
  write('## Checks\noutcome: x\nrepro: n/a\nproof: no verify skill - `done-done run shots`\nevidence: not proven: no device here\n');
  const np = dd('check', '--from', '../pr.md');
  assert.equal(np.code, 2, np.out);
  assert.match(toon(np).error, /^check: the judge was not asked, so there is no verdict: not proven: no device here/);
  // "not proven" is never a pass: the old allowance is a config error, even from a trusted ref.
  writeFileSync(join(repo, '.done-done.yaml'), 'app: notes\nevidence:\n  root: .proof\nchecks:\n  not_proven: allow\n');
  sh('commit', '-qam', 'allow not proven');
  const gone = dd('check', '--from', '../pr.md', '--trusted-ref', 'HEAD');
  assert.equal(gone.code, 2, gone.out);
  assert.match(toon(gone).error, /checks\.not_proven is gone: done-done never gives a result without its judge/);
  writeFileSync(join(repo, '.done-done.yaml'), JUDGED);
  sh('commit', '-qam', 'drop the allowance');
  mkdirSync(join(repo, '.agents', 'skills', 'done-done-verify-notes'), { recursive: true });
  write(`## Checks\noutcome: x\nrepro: n/a\nproof: \`done-done run shots\`\nevidence: ${files[0]}\n`);
  assert.match(dd('check', '--from', '../pr.md').out, /does not name the project's verify skill done-done-verify-notes/);
  // A local file has no PR title, so the HEAD commit subject is its title, and a fix still needs a repro.
  sh('commit', '-q', '--allow-empty', '-m', 'fix: home crash'); assert.match(dd('check', '--from', '../pr.md').out, /a fix needs a repro, not n\/a/);
  sh('commit', '-q', '--allow-empty', '-m', 'docs: home'); assert.doesNotMatch(dd('check', '--from', '../pr.md').out, /a fix needs a repro/);
});

test('config is strict and scoped', () => {
  const { dir, repo, dd } = setup();
  const bad = (yaml) => {
    writeFileSync(join(repo, '.done-done.yaml'), yaml);
    return dd('check', '--outcome', 'x', 'a.png');
  };
  assert.match(bad('evidnce:\n  root: x\n').out, /unknown key evidnce/);
  assert.equal(bad('evidence:\n  local_root: /x\n').code, 2);
  assert.match(bad('evidence:\n  local_root: /x\n').out, /may only be set in the global config/);
  assert.match(bad('evidence:\n  allow_dirty: "yes"\n').out, /must be a boolean/);
  writeFileSync(join(repo, '.done-done.yaml'), 'app: notes\n');
  mkdirSync(join(dir, 'home'), { recursive: true });
  writeFileSync(join(dir, 'home', 'config.yaml'), 'app: other\n');
  const r = dd('check', '--outcome', 'x', 'a.png');
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /app may only be set in the project/);
});

test('videos are probed for real frames', { skip: spawnSync('ffmpeg', ['-version']).error && 'ffmpeg not installed' }, () => {
  const { repo, dd } = setup('app: notes\nevidence:\n  root: .proof\n');
  const open = dd('run', '--open');
  const id = toon(open).run_id;
  writeFileSync(join(repo, '.proof', id, 'steps.json'), stepsOf('clip plays'));
  const out = join(repo, '.proof', id, 'clip.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=128x96:rate=10', '-t', '1', '-pix_fmt', 'yuv420p', out]);
  const full = readFileSync(out);
  writeFileSync(join(repo, '.proof', id, 'cut.mp4'), full.subarray(0, Math.floor(full.length / 2)));
  assert.equal(dd('run', '--close', id).code, 0);
  // A video that decodes is still no pass on its own: the judge reads no video, so nothing judged shows the outcome.
  const clip = dd('check', '--outcome', 'clip plays', `.proof/${id}/clip.mp4`);
  assert.equal(clip.code, 2, clip.out);
  assert.match(clip.out, /the judge was not asked, so there is no verdict: .*no cited capture is one the judge reads/);
  const cut = dd('check', '--outcome', 'cut clip', `.proof/${id}/cut.mp4`);
  assert.equal(cut.code, 2, cut.out);
  assert.match(cut.out, /does not decode/);

  // A still and an explicitly extracted recording frame prove different named parts of one claim.
  // done-done probes the recording; it must not silently extract or judge additional frames.
  const j = judgeSetup(CORRECT);
  const outcome = 'changed.png shows the Changed state; clip-frame.png shows the next screen from clip.mp4';
  j.stub(CORRECT, true, [], [], '', { parts: ['Changed', 'next screen'], shows: { 'changed.png': { covers: [0] }, 'clip-frame.png': { parts: ['NEXT', 'CHANGED'], covers: [1] } } });
  const opened = toon(j.dd('run', '--open')).run_id;
  const folder = `.proof/${opened}`;
  const root = join(j.repo, folder);
  writeFileSync(join(root, 'changed.png'), screen(7));
  cpSync(out, join(root, 'clip.mp4'));
  execFileSync('ffmpeg', ['-v', 'error', '-i', join(root, 'clip.mp4'), '-frames:v', '1', join(root, 'clip-frame.png')]);
  writeFileSync(join(root, 'steps.json'), stepsOf(outcome));
  assert.equal(j.dd('run', '--close', opened).code, 0);
  const files = ['changed.png', 'clip-frame.png', 'clip.mp4'].map(n => `${folder}/${n}`);
  const checked = j.dd('check', '--outcome', outcome, ...files);
  assert.equal(checked.code, 0, checked.out);
  assert.deepEqual(toon(checked).judge.not_judged, [files[2]]);
  assert.equal(j.calls().length, 2);
  for (const [i, call] of j.calls().entries()) {
    assert.equal(call.images, 1, 'another citation must not reach this model context');
    assert.equal(call.state[`capture_${i}`].name, basename(files[i]));
    assert.equal(Object.keys(call.state).filter(k => /^capture_/.test(k)).length, 1);
    const data = JSON.parse(call.prompt.split('BEGIN DATA (JSON)\n')[1].split('\nEND DATA')[0]);
    assert.deepEqual(data.questions[`capture_${i}`].images, [i ? 'capture_1__clip-frame' : 'capture_0__changed']);
  }
  assert.deepEqual(j.calls()[1].state.shared_parts, ['Changed', 'next screen']);
  assert.deepEqual(toon(checked).judge.judged.map(r => [r.parts, r.covers]), [[['Changed', 'next screen'], [0]], [['Changed', 'next screen'], [1]]], 'later labels cannot redefine shared coverage positions');
  assert.equal(j.dd('check', '--outcome', outcome, ...files).code, 0);
  assert.equal(j.calls().length, 2, 'the exact named set is cached');
  j.stub(CORRECT, true, [], [], '', { parts: ['Changed', 'next screen'], shows: { 'changed.png': { covers: [0] } } });
  const missing = j.dd('check', '--outcome', outcome + ' missing', ...files);
  assert.equal(missing.code, 3, missing.out);
  assert.match(missing.out, /next screen/);
  j.stub(CORRECT, true, [], [], '', { parts: ['Changed', 'next screen'], shows: { 'changed.png': { covers: [0] }, 'clip-frame.png': { parts: ['redefined'], covers: [2] } } });
  const invalid = j.dd('check', '--outcome', outcome + ' invalid', ...files);
  assert.equal(invalid.code, 2, invalid.out);
  assert.match(toon(invalid).error, /no parts and covers lists for capture_1/);
  assert.equal(toon(invalid).result, undefined, 'invalid shared positions are not partial proof');
  const callsBeforeSwap = j.calls().length;

  // Identical bytes in identical argument order, but their names now assign them to the wrong parts.
  const swapped = toon(j.dd('run', '--open')).run_id;
  const swappedFolder = `.proof/${swapped}`;
  cpSync(join(root, 'changed.png'), join(j.repo, swappedFolder, 'clip-frame.png'));
  cpSync(join(root, 'clip-frame.png'), join(j.repo, swappedFolder, 'changed.png'));
  cpSync(join(root, 'clip.mp4'), join(j.repo, swappedFolder, 'clip.mp4'));
  writeFileSync(join(j.repo, swappedFolder, 'steps.json'), stepsOf(outcome));
  assert.equal(j.dd('run', '--close', swapped).code, 0);
  j.stub({ correct: 0.02, wrong: 0.96, unclear: 0.02 });
  const wrong = j.dd('check', '--outcome', outcome, ...['clip-frame.png', 'changed.png', 'clip.mp4'].map(n => `${swappedFolder}/${n}`));
  assert.equal(wrong.code, 1, wrong.out);
  assert.equal(j.calls().length, callsBeforeSwap + 2, 'renaming cannot reuse the true set verdict or its old paths');
  assert.ok(toon(wrong).judge.judged.every(r => r.path.startsWith(swappedFolder) && !r.cached));

  const single = j.dd('check', '--outcome', outcome, files[0]);
  assert.equal(single.code, 1, single.out);
  assert.equal(j.calls().at(-1).state.name, basename(files[0]), 'single-image checks retain the cited name too');

  // No partial/cached pass when isolation would exceed the request budget.
  const cap = toon(j.dd('run', '--open')).run_id;
  const many = Array.from({ length: 11 }, (_, i) => `.proof/${cap}/part-${i}.png`);
  for (const [i, file] of many.entries()) writeFileSync(join(j.repo, file), screen(20 + i));
  writeFileSync(join(j.repo, '.proof', cap, 'steps.json'), stepsOf(outcome));
  assert.equal(j.dd('run', '--close', cap).code, 0);
  const count = j.calls().length;
  const refused = j.dd('check', '--outcome', outcome, ...many);
  assert.equal(refused.code, 2, refused.out);
  assert.match(toon(refused).error, /at most 10 captures/);
  assert.equal(toon(refused).result, undefined);
  assert.equal(j.calls().length, count, 'oversized isolated checks ask no model');
});

test('receipt records a passing check for the head, then verifies', () => {
  const { repo, dd, head, shots } = setup();
  const { files } = shots();
  const h = head();
  const r = dd('receipt', '--outcome', 'home and settings render', ...files);
  assert.equal(r.code, 0, r.out);
  const d = toon(r);
  assert.equal(d.result, 'pass');
  assert.equal(d.head, h);
  assert.equal(d.files, 2);
  const rec = JSON.parse(readFileSync(join(repo, d.receipt), 'utf8'));
  assert.equal(rec.schema, 2, 'every receipt carries the judge that passed it');
  assert.deepEqual([rec.judge.route, rec.judge.verdicts.map((x) => x.verdict)], ['answerer:gemini', ['pass', 'pass']]);
  assert.equal(rec.head, h);
  assert.match(rec.tree, /^[0-9a-f]{40,64}$/);
  assert.equal(rec.claim, 'home and settings render');
  assert.equal(rec.result, 'pass');
  assert.ok(rec.at && rec.repo, 'the record carries a timestamp and the repo');
  assert.equal(rec.files.length, 2);
  assert.ok(rec.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)), 'every cited file carries its sha256');
  const v = dd('receipt', '--verify', h);
  assert.equal(v.code, 0, v.out);
  assert.equal(toon(v).result, 'pass');
});

// A bare git repo with no done-done config yet, for exercising `init`.
function bareRepo(dirName = 'repo') {
  const dir = mkdtempSync(join(tmpdir(), 'done-done-init-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, dirName);
  const env = { ...process.env, DONE_DONE_HOME: join(dir, 'home'), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
  mkdirSync(repo, { recursive: true });
  const sh = (...a) => execFileSync('git', a, { cwd: repo, env, stdio: 'pipe' });
  sh('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'app.js'), 'export const app = 1;\n');
  sh('add', '-A');
  sh('commit', '-qm', 'init');
  const dd = (...args) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8' });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  return { dir, repo, env, sh, dd };
}

// The gate's judge: an opencode stub that logs each call, named by path so every done-done call in the test uses it.
function gateJudge(env, probabilities) {
  const s = stubAgents(env, JSON.stringify({ relevance: { probabilities, rationale: 'The list shows the notes.', personReason: 'The list shows the notes.', parts: [], covers: [] } }));
  writeFileSync(join(env.DONE_DONE_HOME, 'config.yaml'), `agent: claude\njudge:\n  route: answerer:opencode\nagent_path_override: { opencode: ${JSON.stringify(join(s.bin, 'opencode'))} }\n`);
  symlinkSync(process.execPath, join(s.bin, 'node'));
  return { ...s, env: { ...s.env, PATH: `${s.env.PATH}:/usr/bin:/bin` } };
}

test('the Firstmate merge gate passes fresh proof with a receipt, and refuses a missing receipt, stale proof or another PR head', () => {
  const { dir, repo, env, sh, dd, head, shots } = setup();
  // The default branch's rules are stricter than the branch's: a "feat" title needs a repro there.
  const yaml = readFileSync(join(repo, '.done-done.yaml'), 'utf8');
  writeFileSync(join(repo, '.done-done.yaml'), `${yaml}checks:\n  fix_title: "^feat"\n`);
  sh('commit', '-qam', 'strict rules');
  sh('update-ref', 'refs/remotes/origin/main', 'HEAD');
  sh('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  writeFileSync(join(repo, '.done-done.yaml'), yaml);
  sh('commit', '-qam', 'branch rules');
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'done-done'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(CLI)} "$@"\n`, { mode: 0o755 });
  // A stand-in `gh` that answers `gh pr view <url>` with the PR's head commit or its title and body.
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\ncase "$*" in *headRefOid*) cat ${JSON.stringify(join(dir, 'pr-head'))} ;; *) cat ${JSON.stringify(join(dir, 'pr.json'))} ;; esac\n`, { mode: 0o755 });
  const fm = join(dir, 'fm');
  const judged = gateJudge(env, CORRECT);
  const gate = (pr) => {
    const r = spawnSync(join(dirname(CLI), '..', 'integrations', 'firstmate', 'merge-gate'), ['t1', repo, head(), pr], {
      encoding: 'utf8', env: { ...judged.env, FM_HOME: fm, PATH: `${bin}:${judged.env.PATH}` },
    });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  const { files } = shots();
  const checks = `## Checks\noutcome: home and settings render\nrepro: n/a: no bug\nproof: no verify skill - \`done-done run shots\`\nevidence: ${files.join(', ')}\n`;
  mkdirSync(join(fm, 'data', 't1'), { recursive: true });
  writeFileSync(join(fm, 'data', 't1', 'checks.md'), checks);
  const missing = gate('-');
  assert.equal(missing.code, 1, missing.out);
  assert.match(missing.out, /result: pass[\s\S]*no receipt for/, 'the check passes, then the missing receipt refuses');
  assert.equal(dd('receipt', '--from', join(fm, 'data', 't1', 'checks.md')).code, 0);
  const pass = gate('-');
  assert.equal(pass.code, 0, pass.out);
  assert.match(pass.out, /This receipt is valid for this head/);
  assert.ok(judged.calls().length && judged.calls().every((c) => c.agent === 'opencode'), 'the gate judges each capture');
  const pr = (title, prHead) => {
    writeFileSync(join(dir, 'pr.json'), JSON.stringify({ title, body: checks }));
    writeFileSync(join(dir, 'pr-head'), `${prHead}\n`);
    return gate('https://github.com/example/notes/pull/1');
  };
  const prPass = pr('docs: settings', head());
  assert.equal(prPass.code, 0, prPass.out);
  const strict = pr('feat: settings', head());
  assert.equal(strict.code, 2, strict.out);
  assert.match(strict.out, /a fix needs a repro/, 'the rules come from the default branch, not the PR');
  const moved = pr('docs: settings', 'f'.repeat(40));
  assert.equal(moved.code, 1, moved.out);
  assert.match(moved.out, /is at f{40}, not /);
  writeFileSync(join(repo, 'src', 'app.js'), 'export const app = 2;\n');
  sh('commit', '-qam', 'change the app');
  const stale = gate('-');
  assert.equal(stale.code, 2, stale.out);
  assert.match(stale.out, /evidence is for commit/);
  assert.doesNotMatch(stale.out, /command: receipt/, 'a failed check refuses before the receipt is read');
});

for (const remote of [true, false]) test(`the Firstmate merge gate reads a local-only task's rules from the default branch${remote ? '' : ' (local main in a repo with no remote)'}, not the task branch`, () => {
  const { dir, repo, env, sh, dd, head, shots } = setup();
  if (remote) {
    sh('update-ref', 'refs/remotes/origin/main', 'HEAD');
    sh('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  } else sh('checkout', '-qb', 'fm/t2');
  // The task branch ignores src/ so its own stale evidence would pass; the default branch does not.
  writeFileSync(join(repo, '.done-done.yaml'), 'app: notes\nevidence:\n  root: .proof\n  ignore_paths: ["docs/**", "src/**"]\njourneys:\n  shots:\n    command: node make-shots.mjs ${RUN_ID}\n');
  sh('commit', '-qam', 'branch loosens ignore_paths');
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'done-done'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(CLI)} "$@"\n`, { mode: 0o755 });
  const fm = join(dir, 'fm');
  const judged = gateJudge(env, CORRECT);
  const gate = () => {
    const r = spawnSync(join(dirname(CLI), '..', 'integrations', 'firstmate', 'merge-gate'), ['t2', repo, head(), '-'], {
      encoding: 'utf8', env: { ...judged.env, FM_HOME: fm, PATH: `${bin}:${judged.env.PATH}` },
    });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  const { files } = shots();
  const checks = `## Checks\noutcome: home and settings render\nrepro: n/a: no bug\nproof: no verify skill - \`done-done run shots\`\nevidence: ${files.join(', ')}\n`;
  mkdirSync(join(fm, 'data', 't2'), { recursive: true });
  writeFileSync(join(fm, 'data', 't2', 'checks.md'), checks);
  assert.equal(dd('receipt', '--from', join(fm, 'data', 't2', 'checks.md')).code, 0);
  assert.equal(gate().code, 0, 'fresh proof passes');
  writeFileSync(join(repo, 'src', 'app.js'), 'export const app = 2;\n');
  sh('commit', '-qam', 'change the app');
  const stale = gate();
  assert.equal(stale.code, 2, stale.out);
  assert.match(stale.out, /evidence is for commit/, 'the default branch\'s ignore_paths do not cover src/, so the change makes the proof stale');
});

test('init writes a minimal config that keeps evidence outside the repo, and is idempotent', () => {
  const { dir, repo, dd } = bareRepo();
  const r = dd('init');
  assert.equal(r.code, 2, r.out);
  const d = toon(r);
  assert.equal(d.command, 'init');
  assert.equal(d.result, 'fail');
  assert.equal(d.agent, 'not set', 'a non-terminal init with no agent writes the config and stops with the ask');
  assert.match(d.help.join('\n'), /no agent is set: ask the user which agent to use/);
  assert.equal(d.config, 'written');
  assert.equal(d.gitignore, 'unchanged', 'nothing to ignore: the evidence root is outside the repo');
  assert.match(d.help.join('\n'), /journeys: .*done-done run smoke/s, 'the next step shows a journey, then the run');
  const yml = join(repo, '.done-done.yaml');
  assert.deepEqual(parse(readFileSync(yml, 'utf8')), { app: 'repo' }, 'the app is pinned and no in-repo evidence root is set');
  assert.ok(!existsSync(join(repo, '.gitignore')), 'no .gitignore is written');
  assert.match(d.evidence_root, /evidence[/\\]repo$/, 'init names the out-of-repo evidence root');
  const globalYml = join(dir, 'home', 'config.yaml');
  assert.equal(d.global_config, `written ${globalYml}`);
  const globalText = readFileSync(globalYml, 'utf8');
  const g = parse(globalText);
  assert.deepEqual(Object.keys(g), ['agent_config', 'agent_args_override', 'agent_path_override', 'acpx_path', 'agent_timeout', 'auto_fix', 'evidence', 'judge'], 'every global key, named as in no-mistakes where the meaning is the same');
  assert.deepEqual([g.agent, g.agent_config.claude, g.agent_config.opencode, g.agent_timeout], [undefined, { model: 'claude-haiku-5-5', effort: 'low' }, { model: 'opencode-go/muse-spark-1.3-contributor', effort: 'low' }, '30m'], 'no agent key until the user picks one, and the cheap defaults');
  for (const key of Object.keys(g)) assert.match(globalText, new RegExp(`# .*\\n${key}:`), `${key} has a comment`);
  assert.equal(g.agent_config.codex, undefined, 'codex has no cheap default, so init writes no codex model');
  const before = readFileSync(yml);
  const again = dd('init');
  assert.equal(again.code, 2, again.out);
  assert.equal(toon(again).config, 'unchanged');
  assert.equal(toon(again).global_config, 'unchanged');
  assert.equal(readFileSync(globalYml, 'utf8'), globalText, 'init never overwrites the global config');
  assert.equal(toon(again).gitignore, 'unchanged');
  assert.deepEqual(json(dd('init', '--json')), toon(again), '--json is the same result as JSON');
  assert.deepEqual(readFileSync(yml), before, 'repeat init preserves the config');
});

test('after-commit opt-in drives actual Bash hooks around mapped and uncovered fixture commits', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'dd-commit-e2e-'));
  try {
    const r = spawnSync(process.execPath, [CLI, 'run', 'after-commit', '--json'], { cwd: dirname(dirname(CLI)), env: { ...process.env, DONE_DONE_HOME: join(tmp, 'home') }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const record = JSON.parse(r.stdout);
    assert.equal(record.result, 'recorded');
    assert.match(readFileSync(record.evidence[0], 'utf8'), /PASS mapped commit .*: greeting sealed; uncovered commit .*: core sealed and proposal only/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('init --hook claude adds a SessionStart hook that shows the bare state, merges, and never duplicates', () => {
  const { dir, repo, env, dd } = bareRepo();
  const settings = join(repo, '.claude', 'settings.json');
  const r = dd('init', '--hook', 'claude');
  assert.equal(r.code, 2, r.out);
  assert.equal(toon(r).claude_hook, 'added to .claude/settings.json');
  const hooks = JSON.parse(readFileSync(settings, 'utf8')).hooks.SessionStart;
  assert.equal(hooks.length, 1);
  const { command } = hooks[0].hooks[0];
  // Run the hook as Claude Code does: through a shell, from the repo, with done-done on PATH and without it.
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'done-done'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(CLI)} "$@"\n`, { mode: 0o755 });
  const hook = (path) => spawnSync('/bin/sh', ['-c', command], { cwd: repo, env: { ...env, PATH: path }, encoding: 'utf8' });
  const on = hook(`${bin}:${env.PATH}`);
  assert.equal(on.status, 0, on.stderr);
  assert.equal(on.stdout, dd().out, 'the hook prints the bare done-done state');
  assert.equal(toon({ out: on.stdout }).config, 'present');
  const off = hook(join(dir, 'empty'));
  assert.deepEqual([off.status, off.stdout, off.stderr], [0, '', ''], 'without done-done on PATH the hook is silent and exits 0');
  const before = readFileSync(settings);
  assert.equal(toon(dd('init', '--hook', 'claude')).claude_hook, 'unchanged');
  assert.deepEqual(readFileSync(settings), before, 'a second run adds no duplicate');
  // An existing settings file keeps its other keys and hooks.
  const other = { permissions: { allow: ['Bash(npm test)'] }, hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'echo hi' }] }], Stop: [{ hooks: [{ type: 'command', command: 'echo bye' }] }] } };
  const two = bareRepo();
  mkdirSync(join(two.repo, '.claude'));
  writeFileSync(join(two.repo, '.claude', 'settings.json'), JSON.stringify(other));
  assert.equal(two.dd('init', '--hook', 'claude').code, 2);
  const merged = JSON.parse(readFileSync(join(two.repo, '.claude', 'settings.json'), 'utf8'));
  assert.deepEqual(merged, { ...other, hooks: { ...other.hooks, SessionStart: [...other.hooks.SessionStart, hooks[0]] } }, 'both hooks and every other key are kept');
  // Another agent is a usage error naming the supported values; a malformed settings file is left untouched.
  const bad = two.dd('init', '--hook', 'cursor');
  assert.equal(bad.code, 2, bad.out);
  assert.match(toon(bad).error, /supported values are claude, codex, opencode/);
  writeFileSync(join(two.repo, '.claude', 'settings.json'), '{ nope');
  const broken = two.dd('init', '--hook', 'claude');
  assert.equal(broken.code, 2, broken.out);
  assert.match(toon(broken).help[0], /Fix \.claude\/settings\.json/);
  assert.equal(readFileSync(join(two.repo, '.claude', 'settings.json'), 'utf8'), '{ nope');
  // --hook with --journey records the journey and still adds the hook.
  const three = bareRepo();
  const both = three.dd('init', '--journey', 'smoke', '--hook', 'claude', '--', 'echo hi');
  assert.equal(both.code, 2, both.out);
  assert.deepEqual([toon(both).journey, toon(both).claude_hook], ['smoke', 'added to .claude/settings.json']);
  assert.match(toon(both).help.join('\n'), /Commit \.claude\/settings\.json/);
  assert.deepEqual(JSON.parse(readFileSync(join(three.repo, '.claude', 'settings.json'), 'utf8')).hooks.SessionStart, hooks);
});

test('init --journey records the capture recipe and the journey re-runs from any checkout', () => {
  const { dir, repo, env, sh, dd } = bareRepo();
  const r = dd('init', '--journey', 'smoke', '--', 'echo added: milk > $DONE_DONE_EVIDENCE_ROOT/${RUN_ID}.log');
  assert.equal(r.code, 2, r.out);
  assert.equal(toon(r).config, 'written');
  assert.equal(toon(r).journey, 'smoke');
  assert.equal(parse(readFileSync(join(repo, '.done-done.yaml'), 'utf8')).journeys.smoke.command, 'echo added: milk > $DONE_DONE_EVIDENCE_ROOT/${RUN_ID}.log', 'the ${RUN_ID} placeholder is stored verbatim');
  sh('add', '-A');
  sh('commit', '-qm', 'config');
  const run = dd('run', 'smoke');
  assert.equal(run.code, 0, run.out);
  assert.ok(!toon(run).help.join('\n').includes('not in the repo'), 'a recorded journey run carries no outside-repo hint');
  const { run_id: id } = toon(run);
  const [log] = toon(run).evidence;
  assert.equal(log, join(dir, 'home', 'evidence', 'repo', id, `${id}.log`));
  // A second checkout re-runs the proof from only the repo recipe.
  const lane2 = join(dir, 'lane2');
  execFileSync('git', ['clone', '-q', repo, lane2]);
  const in2 = spawnSync(process.execPath, [CLI, 'run', 'smoke'], { cwd: lane2, env, encoding: 'utf8' });
  assert.equal(in2.status, 0, in2.stdout + in2.stderr);
  assert.ok(!(in2.stdout + in2.stderr).includes('not in the repo'), 'the recipe travels with the repo');
  // Re-recording the journey updates the stored command.
  assert.equal(dd('init', '--journey', 'smoke', '--', 'echo added: eggs > $DONE_DONE_EVIDENCE_ROOT/${RUN_ID}.log').code, 2);
  assert.equal(parse(readFileSync(join(repo, '.done-done.yaml'), 'utf8')).journeys.smoke.command, 'echo added: eggs > $DONE_DONE_EVIDENCE_ROOT/${RUN_ID}.log');
  assert.equal(dd('init', '--journey', 'smoke').code, 2, 'a journey with no command after -- is a usage error');
});

// Fixture repos for init's verify-skill scaffold: a CLI tool, and a repo whose own proof drives a stub engine with
// its own state (scripts/verify/drive.sh, run by a .done-done.yaml journey) while `npm start` runs the real engine.
function shapeRepo(kind, name) {
  const dir = mkdtempSync(join(tmpdir(), 'done-done-shape-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, name);
  const env = { ...process.env, DONE_DONE_HOME: join(dir, 'home'), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
  mkdirSync(repo, { recursive: true });
  if (kind === 'proof') {
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name, scripts: { start: 'node engine.js' } }));
    writeFileSync(join(repo, 'engine.js'), "const home = process.env.ENGINE_HOME ?? require('node:os').homedir();\nconst engine = process.env.ENGINE === 'stub' ? 'stub' : 'real';\nconsole.log(engine, home, process.argv.slice(2).join(' '));\n");
    mkdirSync(join(repo, 'scripts', 'verify'), { recursive: true });
    writeFileSync(join(repo, 'scripts', 'verify', 'drive.sh'), '#!/bin/sh\n# The proof drive: a stub engine and a throwaway state folder.\nENGINE=stub ENGINE_HOME="$(mktemp -d)" node engine.js "$@"\n', { mode: 0o755 });
    writeFileSync(join(repo, '.done-done.yaml'), `app: ${name}\njourneys:\n  add:\n    command: scripts/verify/drive.sh add milk > $DONE_DONE_EVIDENCE_ROOT/\${RUN_ID}.log\n`);
    writeFileSync(join(repo, 'README.md'), `# ${name}\n\nnpm start runs the engine on your own account.\n`);
  } else {
    // private packages need no upgrade journey; kind 'shipped' has a public installable bin.
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name, ...(kind !== 'shipped' && { private: true }), bin: { [name]: 'bin/cli.js' }, dependencies: { commander: '^12.0.0' } }));
    mkdirSync(join(repo, 'bin'));
    writeFileSync(join(repo, 'bin', 'cli.js'), `#!/usr/bin/env node\nprogram.command('add').command('list');\n`);
    writeFileSync(join(repo, 'README.md'), '# notes\n');
  }
  const sh = (...a) => execFileSync('git', a, { cwd: repo, env, stdio: 'pipe' });
  sh('init', '-q', '-b', 'main');
  sh('add', '-A');
  sh('commit', '-qm', 'init');
  const dd = (...args) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8' });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  return { dir, repo, env, dd, sh };
}

// The stub agent's answer for init's scaffold call. It also carries maintain's keys, so one stub answers both.
// A feature without core or upgrade gets core on the first one only and upgrade on none, as the schema requires both.
const scaffoldAnswer = (over = {}) => JSON.stringify(withRoles({
  surface: 'CLI',
  first_release: false,
  launch: { steps: 'ENGINE=stub ENGINE_HOME="$(mktemp -d)" scripts/verify/drive.sh up', source: 'scripts/verify/drive.sh', safe: true, why: 'the stub engine with a throwaway ENGINE_HOME, as scripts/verify/drive.sh runs it.' },
  ready: 'the command exits 0',
  harness: 'a terminal (tmux or PTY)',
  observe: 'terminal transcripts and exit codes',
  isolate: 'each run gets its own ENGINE_HOME from mktemp',
  features: [{ title: 'Add a note', reach: 'the add command', drive: 'run scripts/verify/drive.sh add milk', source: 'scripts/verify/drive.sh', capture: 'text' }],
  drift: [], recipe: 'run it', recipes: [], missing: [],
  ...over,
}));
const withRoles = (a) => (Array.isArray(a.features) ? { ...a, features: a.features.map((f, i) => (f && typeof f === 'object' ? { core: i === 0, upgrade: false, ...f } : f)) } : a);

const featureFiles = (skillDir) => readdirSync(join(skillDir, 'features')).sort();
// A hand-written verify skill, so an init test about config never asks the agent to write one.
const keepSkill = (repo, app) => {
  mkdirSync(join(repo, '.agents', 'skills', `done-done-verify-${app}`), { recursive: true });
  writeFileSync(join(repo, '.agents', 'skills', `done-done-verify-${app}`, 'SKILL.md'), `# done-done-verify-${app}\n`);
};

test('journey add, enhance and improve generate reviewable recipes, run the app, and replay without an agent', () => {
  const { repo, env, sh } = setup('app: notes\n');
  delete env.CI;
  const skill = join(repo, '.agents/skills/done-done-verify-notes');
  mkdirSync(join(skill, 'features'), { recursive: true });
  writeFileSync(join(skill, 'SKILL.md'), '# Notes CLI\n');
  writeFileSync(join(skill, 'features/README.md'), '# Features\n');
  writeFileSync(join(repo, 'app.mjs'), 'console.log("Hello " + (process.argv[2] ?? "Umer"));\n');
  sh('add', '-A'); sh('commit', '-qm', 'fixture app');
  const script = `import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const out = execFileSync(process.execPath, ['app.mjs'], { encoding: 'utf8' });
assert.equal(out, 'Hello Umer\\n');
writeFileSync(join(process.env.DONE_DONE_EVIDENCE_ROOT, 'greeting.txt'), out);
writeFileSync(join(process.env.DONE_DONE_EVIDENCE_ROOT, 'steps.json'), JSON.stringify({ target: {version: '1'}, start: 'fresh CLI', steps: ['run the greeting command'], result: out }));
`;
  const answer = { name: 'greet-umer', title: 'Greet Umer', source: 'app.mjs', script, checks: 'Greeting equals Hello Umer.', spends: '""', blocker: '`' };
  let s = stubAgents(env, JSON.stringify(answer));
  const run = (extra, ...args) => spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd: repo, env: { ...s.env, PATH: `${s.env.PATH}:${process.env.PATH}`, ...extra }, encoding: 'utf8' });
  const add = (...args) => run({}, 'journey', 'add', ...args);
  const r = add('greet Umer');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const trial = JSON.parse(r.stdout);
  assert.equal(JSON.parse(readFileSync(trial.record.replace(/^~(?=\/)/, homedir()), 'utf8')).journey, answer.name);
  assert.equal(trial.dirty, true, 'trial never masquerades as clean proof');
  assert.match(r.stderr, /Review these repo changes:[\s\S]*greet-umer.mjs.*new lines/);
  assert.equal(readFileSync(join(repo, 'journeys/greet-umer.mjs'), 'utf8'), script);
  assert.match(readFileSync(join(skill, 'features/README.md'), 'utf8'), /\[Greet Umer\]\(greet-umer.md\)/);
  assert.match(readFileSync(join(skill, 'features/greet-umer.md'), 'utf8'), /Greeting equals Hello Umer/);
  assert.equal(parse(readFileSync(join(repo, '.done-done.yaml'), 'utf8')).journeys['greet-umer'].command, 'node journeys/greet-umer.mjs');
  sh('add', '-A'); sh('commit', '-qm', 'generated recipe');
  const global = join(env.DONE_DONE_HOME, 'config.yaml');
  const configured = readFileSync(global, 'utf8');
  writeFileSync(global, '');
  const replay = run({}, 'run', answer.name);
  assert.equal(replay.status, 0, replay.stdout + replay.stderr);
  assert.equal(JSON.parse(replay.stdout).dirty, false);
  assert.equal(s.calls().length, 1, 'replay never starts a model');
  assert.equal(add('another greeting').status, 2, 'no agent is never auto-selected');
  writeFileSync(global, configured);
  assert.equal(add('another greeting').status, 2, 'existing journey is not overwritten');
  assert.equal(run({ CI: 'true' }, 'journey', 'add', 'greet Umer').status, 2);
  const before = sh('status', '--porcelain').toString();
  assert.equal(before, '', 'refusals leave the project unchanged');
  const enhance = (...args) => run({}, 'journey', 'enhance', ...args);
  const calls = s.calls().length;
  assert.equal(enhance('missing').status, 2);
  assert.equal(run({ CI: 'true' }, 'journey', 'enhance', answer.name).status, 2);
  writeFileSync(global, '');
  assert.equal(enhance(answer.name).status, 2, 'enhance never selects an agent');
  writeFileSync(global, configured);
  assert.equal(s.calls().length, calls, 'refusals never generate');
  const doc = parseDocument(readFileSync(join(repo, '.done-done.yaml'), 'utf8'));
  doc.setIn(['journeys', answer.name, 'core'], true);
  doc.setIn(['journeys', answer.name, 'timeout'], '45s');
  doc.setIn(['journeys', 'other'], { command: 'node app.mjs Other' });
  writeFileSync(join(repo, '.done-done.yaml'), doc.toString());
  sh('commit', '-qam', 'Keep journey roles and sibling');
  const deeper = script.replace("writeFileSync(join(process.env.DONE_DONE_EVIDENCE_ROOT, 'greeting.txt'), out);", `const edge = execFileSync(process.execPath, ['app.mjs', ''], { encoding: 'utf8' });
assert.equal(edge, 'Hello \\n');
writeFileSync(join(process.env.DONE_DONE_EVIDENCE_ROOT, 'greeting.txt'), out + edge);`);
  const focus = 'also check an empty name';
  s = stubAgents(env, JSON.stringify({ ...answer, script: deeper, checks: 'Preserve Hello Umer and check empty name gives Hello.' }));
  const e = enhance(answer.name, focus);
  assert.equal(e.status, 0, e.stdout + e.stderr);
  assert.equal(JSON.parse(e.stdout).dirty, true);
  assert.match(e.stderr, /Enhanced journey greet-umer[\s\S]*Review these repo changes:[\s\S]*greet-umer.mjs/);
  assert.match(s.calls()[0].stdin, /Enhance ONLY[\s\S]*also check an empty name[\s\S]*Preserve every existing drive step/);
  assert.ok(s.calls()[0].stdin.includes(script.trim()), 'existing script reaches the generator');
  const yaml = readFileSync(join(repo, '.done-done.yaml'), 'utf8');
  assert.match(yaml, /Enhanced focus: "also check an empty name"/);
  assert.deepEqual(parse(yaml).journeys[answer.name], { command: 'node journeys/greet-umer.mjs', core: true, timeout: '45s' });
  assert.deepEqual(parse(yaml).journeys.other, { command: 'node app.mjs Other' });
  assert.equal(readFileSync(join(skill, 'features/README.md'), 'utf8').match(/greet-umer.md/g).length, 1);
  const feature = readFileSync(join(skill, 'features/greet-umer.md'), 'utf8');
  assert.match(feature, /Greeting equals Hello Umer[\s\S]*Enhanced coverage[\s\S]*empty name/);
  sh('add', '-A'); sh('commit', '-qm', 'Enhance greeting journey');
  writeFileSync(global, '');
  const clean = run({ CI: 'true' }, 'run', answer.name);
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.equal(JSON.parse(clean.stdout).dirty, false);
  assert.equal(s.calls().length, 1, 'enhanced replay never generates');
  const improve = (...args) => run({}, 'journey', 'improve', ...args);
  const instruction = 'also assert the exact Unicode greeting for Zoë';
  for (const args of [[], [answer.name], [answer.name, '   '], [answer.name, instruction, 'extra'], ['missing', instruction]]) {
    assert.equal(improve(...args).status, 2, 'improve requires one named journey and a nonblank instruction');
  }
  assert.equal(improve(answer.name, instruction).status, 2, 'improve never selects an agent');
  writeFileSync(global, configured);
  assert.equal(run({ CI: 'true' }, 'journey', 'improve', answer.name, instruction).status, 2);
  assert.equal(s.calls().length, 1, 'invalid requests and CI never generate');
  const improved = deeper.replace("writeFileSync(join(process.env.DONE_DONE_EVIDENCE_ROOT, 'greeting.txt'), out + edge);", `const unicode = execFileSync(process.execPath, ['app.mjs', 'Zoë'], { encoding: 'utf8' });
assert.equal(unicode, 'Hello Zoë\\n');
writeFileSync(join(process.env.DONE_DONE_EVIDENCE_ROOT, 'greeting.txt'), out + edge + unicode);`);
  s = stubAgents(env, JSON.stringify({ ...answer, script: improved, checks: 'Keep greeting and empty name checks; Unicode greeting is exactly Hello Zoë.' }));
  const i = improve(answer.name, instruction);
  assert.equal(i.status, 0, i.stdout + i.stderr);
  assert.equal(JSON.parse(i.stdout).dirty, true);
  assert.match(i.stderr, /Improved journey greet-umer[\s\S]*Review these repo changes:[\s\S]*greet-umer.mjs/);
  assert.match(s.calls()[0].stdin, /Improve ONLY[\s\S]*exact Unicode greeting[\s\S]*apply only this specific instruction/);
  assert.ok(s.calls()[0].stdin.includes(deeper.trim()), 'improve receives the enhanced script');
  const improvedYaml = readFileSync(join(repo, '.done-done.yaml'), 'utf8');
  assert.match(improvedYaml, /Enhanced focus:[\s\S]*Improved instruction:/);
  assert.deepEqual(parse(improvedYaml), parse(yaml), 'settings and sibling are preserved');
  assert.ok(readFileSync(join(skill, 'features/greet-umer.md'), 'utf8').startsWith(feature), 'previous checks stay in the feature');
  assert.match(readFileSync(join(skill, 'features/greet-umer.md'), 'utf8'), /Improved coverage[\s\S]*Instruction: also assert the exact Unicode greeting/);
  assert.equal(readFileSync(join(skill, 'features/README.md'), 'utf8').match(/greet-umer.md/g).length, 1);
  sh('add', '-A'); sh('commit', '-qm', 'Improve Unicode check');
  writeFileSync(global, '');
  const improvedReplay = run({ CI: 'true' }, 'run', answer.name);
  assert.equal(improvedReplay.status, 0, improvedReplay.stdout + improvedReplay.stderr);
  assert.equal(JSON.parse(improvedReplay.stdout).dirty, false);
  const capture = JSON.parse(improvedReplay.stdout).evidence.find(p => p.endsWith('greeting.txt'));
  assert.match(readFileSync(capture, 'utf8'), /Hello Umer\nHello \nHello Zoë\n/);
  assert.equal(s.calls().length, 1, 'improved replay never generates');
  writeFileSync(join(repo, 'app.mjs'), 'console.log("Hello " + (process.argv[2] ?? "Umer").normalize("NFD"));\n');
  const unicodeFailure = run({}, 'run', answer.name);
  assert.equal(unicodeFailure.status, 1, unicodeFailure.stdout + unicodeFailure.stderr);
  assert.match(unicodeFailure.stderr, /AssertionError/, 'only the new Unicode assertion fails');
  writeFileSync(join(repo, 'app.mjs'), 'console.log("Hello " + (process.argv[2] ?? "Umer"));\n');
  writeFileSync(global, configured);
  s = stubAgents(env, JSON.stringify({ ...answer, name: 'renamed' }));
  assert.equal(improve(answer.name, instruction).status, 2, 'improve cannot rename');
  assert.equal(sh('status', '--porcelain').toString(), '', 'invalid improvement writes nothing');
  assert.equal(enhance(answer.name).status, 2, 'enhance cannot rename');
  assert.match(s.calls().at(-1).stdin, /boundary sizes and states/);
  assert.equal(sh('status', '--porcelain').toString(), '', 'bad answer writes nothing');
  // Spend restrictions survive even when generation returns an empty spends field.
  writeFileSync(join(repo, '.done-done.yaml'), yaml.replace('timeout: 45s', 'timeout: 45s\n    spends: one paid call'));
  s = stubAgents(env, JSON.stringify({ ...answer, script: deeper }));
  const paid = improve(answer.name, instruction);
  assert.equal(paid.status, 2, paid.stdout + paid.stderr);
  assert.match(paid.stdout + paid.stderr, /spends \(one paid call\)/);
  assert.equal(parse(readFileSync(join(repo, '.done-done.yaml'), 'utf8')).journeys[answer.name].spends, 'one paid call');
  writeFileSync(join(repo, '.done-done.yaml'), yaml);
  // Only the newly added edge is broken: the original greeting still passes.
  writeFileSync(join(repo, 'app.mjs'), 'console.log("Hello " + (process.argv[2] || "Umer"));\n');
  const failure = run({}, 'run', answer.name);
  assert.equal(failure.status, 1, failure.stdout + failure.stderr);
  assert.match(failure.stderr, /AssertionError/);
  // A hand-recorded command also gains a static recipe without touching its old source.
  writeFileSync(join(repo, 'app.mjs'), 'console.log("Hello " + (process.argv[2] ?? "Umer"));\n');
  s = stubAgents(env, JSON.stringify({ ...answer, name: 'other', script: deeper }));
  const custom = enhance('other', focus);
  assert.equal(custom.status, 0, custom.stdout + custom.stderr);
  assert.equal(parse(readFileSync(join(repo, '.done-done.yaml'), 'utf8')).journeys.other.command, 'node journeys/other.mjs');
  assert.match(readFileSync(join(skill, 'features/other.md'), 'utf8'), /Run `done-done run other`/);
  // Reproduce the hosted producer: double-escaped source has literal backslash-n separators.
  // Native --check failure must retain its SyntaxError, not throw on Buffer stderr.
  s = stubAgents(env, JSON.stringify({ ...answer, script: script.replaceAll('\n', '\\n') }));
  const beforeInvalid = sh('diff').toString();
  const invalid = improve(answer.name, 'a malformed recipe');
  assert.equal(invalid.status, 2, invalid.stdout + invalid.stderr);
  assert.match(JSON.parse(invalid.stdout).error, /invalid JavaScript[\s\S]*SyntaxError/);
  assert.doesNotMatch(invalid.stderr, /trim is not a function/);
  assert.equal(sh('diff').toString(), beforeInvalid, 'native syntax rejection leaves config and skill untouched');
  assert.equal(existsSync(join(repo, 'journeys/bad-script.mjs')), false);
  s = stubAgents(env, JSON.stringify({ ...answer, blocker: '需要 approval' }));
  const blocked = improve(answer.name, instruction);
  assert.equal(blocked.status, 2, blocked.stdout + blocked.stderr);
  assert.match(JSON.parse(blocked.stdout).error, /blocked: 需要 approval/);
  assert.equal(sh('diff').toString(), beforeInvalid, 'a real blocker still prevents all writes');
});

test("init has the agent write the verify skill from the repo's own proof path, not the start script", () => {
  const { repo, env, sh } = shapeRepo('proof', 'notes');
  const s = stubAgents(env, scaffoldAnswer());
  const r = doctorIn(repo, s.env, 'init');
  assert.equal(r.code, 0, r.out);
  assert.equal(toon(r).verify_skill, 'written by claude');
  const [call] = s.calls();
  assert.equal(call.cwd, repo, 'claude reads the repo with its read tools');
  assert.match(call.stdin, /File scripts\/verify\/drive\.sh:\n#!\/bin\/sh\n# The proof drive/, "the agent is given the repo's own proof script");
  assert.match(call.stdin, /File \.done-done\.yaml:\n.*\n {2}add:\n {4}command: scripts\/verify\/drive\.sh add milk/s, 'and its journeys');
  const dir = join(repo, '.agents', 'skills', 'done-done-verify-notes');
  const body = readFileSync(join(dir, 'SKILL.md'), 'utf8');
  assert.match(body, /^## Launch\n\nENGINE=stub ENGINE_HOME="\$\(mktemp -d\)" scripts\/verify\/drive\.sh up\n\nSafe: the stub engine .* runs it \(from `scripts\/verify\/drive\.sh`\)\.$/m, 'Launch is the stub engine with its own state');
  assert.doesNotMatch(body, /npm start/, 'never the start script that runs the real engine');
  assert.match(body, /^- \[Add a note\]\(features\/add-a-note\.md\) \(core journey\): the add command \(`scripts\/verify\/drive\.sh`\)$/m, 'Drive names the real handle and marks the core journey');
  assert.match(body, /^## Core journey\n\n\[Add a note\]\(features\/add-a-note\.md\) is the core user journey: the one thing a user cannot live without\./m, 'the skill names the core journey');
  assert.doesNotMatch(body, /## Release proof/, 'a repo that ships no installable artifact needs no upgrade journey');
  assert.match(call.stdin, /core: true on exactly one feature, listed first: the core user journey/, 'the init prompt asks for the core journey');
  assert.deepEqual(featureFiles(dir), ['README.md', 'add-a-note.md']);
  assert.match(readFileSync(join(dir, 'features', 'add-a-note.md'), 'utf8'), /^2\. Run scripts\/verify\/drive\.sh add milk\.\n3\. Capture: save the output and exit status to \$DONE_DONE_EVIDENCE_ROOT\/add-a-note\.txt,/m);
  const before = body;
  assert.match(toon(doctorIn(repo, s.env, 'init')).verify_skill, /^skipped: \.agents\/skills\/done-done-verify-notes\/SKILL\.md already exist; delete the skill folder to regenerate$/, 'a finished skill is named, never overwritten');
  assert.equal(readFileSync(join(dir, 'SKILL.md'), 'utf8'), before, 're-run is idempotent');
  assert.equal(s.calls().length, 1, 're-run asks the agent nothing');
  sh('add', '-A');
  sh('commit', '-qm', 'skill');
  const m = doctorIn(repo, s.env, 'maintain', '--foreground');
  assert.deepEqual([m.code, toon(m).result, toon(m).findings?.length ?? 0], [0, 'clean', 0], `the written skill passes maintain: ${m.out}`);
});

test('init has the agent name the core journey and, for a CLI users install, an upgrade-in-place journey, and refuses an answer without them', () => {
  const { repo, env } = shapeRepo('shipped', 'notes');
  const launch = { steps: 'node bin/cli.js add milk', source: '', safe: false, why: 'bin/cli.js keeps its notes in your own HOME' };
  const add = { title: 'Add a note', reach: 'the add command', drive: 'run node bin/cli.js add milk', source: 'bin/cli.js', capture: 'text' };
  const list = { title: 'List notes', reach: 'the list command', drive: 'run node bin/cli.js list', source: 'bin/cli.js', capture: 'text' };
  const tryInit = (features) => {
    const s = stubAgents(env, scaffoldAnswer({ launch, features }));
    const r = doctorIn(repo, s.env, 'init');
    return { r, prompt: s.calls()[0].stdin };
  };
  // A fresh install alone is no release proof: an answer with no upgrade journey writes no skill.
  const fresh = tryInit([add, list]);
  assert.equal(fresh.r.code, 1, fresh.r.out);
  assert.equal(toon(fresh.r).verify_skill.split('; record ')[0], "not written: claude's answer is unusable: names no upgrade journey, and the app ships an installable artifact (package.json: an npm package with a bin users install): a fresh install alone is no release proof");
  assert.match(fresh.prompt, /- upgrade: this app ships an installable or upgradable artifact \(package\.json: an npm package with a bin users install\), so users get each release by upgrading over the version they have\. Set upgrade true on one feature whose drive installs the previous shipped version, upgrades over it in place/, 'the init prompt requires the upgrade journey');
  assert.match(toon(fresh.r).help.join('\n'), /done-done init --journey upgrade --upgrade -- /, 'init asks for the upgrade journey too');
  // Exactly one core journey: none, or two, is refused.
  assert.match(toon(tryInit([{ ...add, core: false, upgrade: true }, list]).r).verify_skill, /unusable: names 0 core journeys among its first 5 features, and the skill needs exactly one: the one thing a user cannot live without, end to end on the real target/);
  assert.match(toon(tryInit([add, { ...list, core: true, upgrade: true }]).r).verify_skill, /unusable: names 2 core journeys/);
  const upgrade = { title: 'Upgrade in place', reach: 'npm install -g over the last release', drive: 'install the previous release with npm install -g notes@previous, then npm install -g . over it, then run node bin/cli.js add milk', source: 'bin/cli.js', capture: 'text', upgrade: true };
  const ok = tryInit([add, list, upgrade]);
  assert.equal(ok.r.code, 0, ok.r.out);
  const dir = join(repo, '.agents', 'skills', 'done-done-verify-notes');
  const body = readFileSync(join(dir, 'SKILL.md'), 'utf8');
  assert.match(body, /^## Release proof\n\nThis app ships an installable artifact \(package\.json: an npm package with a bin users install\), and users get a release by upgrading over the version they have\. \[Upgrade in place\]\(features\/upgrade-in-place\.md\) is the release proof: install the previous shipped version, upgrade over it in place, then drive the core journey\. A fresh install alone is no release proof\.$/m);
  const map = readFileSync(join(dir, 'features', 'README.md'), 'utf8');
  assert.match(map, /^- \[Add a note\]\(add-a-note\.md\) \(core journey\): the add command$/m);
  assert.match(map, /^- \[Upgrade in place\]\(upgrade-in-place\.md\) \(upgrade journey\): npm install -g over the last release$/m);
  // doctor reads the marks init wrote: both journeys are named, no config change needed.
  const d = toon(doctorIn(repo, ok.r.env ?? env, 'doctor'));
  assert.equal(d.checks.find((c) => c.check === 'core_journey').detail, 'feature map entry [Add a note](add-a-note.md) is the core user journey');
  assert.match(d.checks.find((c) => c.check === 'upgrade_journey').detail, /^feature map entry \[Upgrade in place\]\(upgrade-in-place\.md\) upgrades in place/);
});

test('first-release npm bin init writes a skill, maintain reads it and affected maps a source change', () => {
  const { repo, env, sh } = shapeRepo('shipped', 'hello-umer');
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'hello-umer', version: '0.1.0', bin: { 'hello-umer': 'bin/cli.js' } }));
  writeFileSync(join(repo, 'bin', 'cli.js'), '#!/usr/bin/env node\n// No earlier release yet. This is the first release.\nconsole.log("Hello Umer");\n');
  sh('add', '-A');
  sh('commit', '-qm', 'First-release CLI');
  const s = stubAgents(env, scaffoldAnswer({
    first_release: true,
    launch: { steps: 'node bin/cli.js', source: 'bin/cli.js', safe: true, why: 'prints a greeting without reading or writing user state' },
    features: [{ title: 'Greet Umer', reach: 'the hello-umer command', drive: 'run node bin/cli.js and see Hello Umer', source: 'bin/cli.js', capture: 'text' }],
  }));
  const init = doctorIn(repo, s.env, 'init');
  assert.equal(init.code, 0, init.out);
  assert.equal(toon(init).verify_skill, 'written by claude');
  assert.match(s.calls()[0].stdin, /first_release: true only when the repo explicitly says no earlier release yet/);
  const skill = join(repo, '.agents', 'skills', 'done-done-verify-hello-umer');
  assert.match(readFileSync(join(skill, 'SKILL.md'), 'utf8'), /Upgrade journey pending: no earlier release yet\. Before the next release, install the first published version, upgrade over it in place, then drive the core journey\./);
  assert.doesNotMatch(readFileSync(join(skill, 'features', 'README.md'), 'utf8'), /\(upgrade journey\)/, 'pending is not a fabricated upgrade proof');
  sh('add', '-A');
  sh('commit', '-qm', 'Add verification skill');
  const base = sh('rev-parse', 'HEAD').toString().trim();
  const m = doctorIn(repo, s.env, 'maintain', '--foreground');
  assert.deepEqual([m.code, toon(m).result, toon(m).findings?.length ?? 0], [0, 'clean', 0], m.out);
  writeFileSync(join(repo, 'bin', 'cli.js'), '#!/usr/bin/env node\nconsole.log("Welcome Umer");\n');
  sh('commit', '-qam', 'Change greeting');
  const changed = doctorIn(repo, s.env, 'affected', base);
  assert.equal(changed.code, 1, changed.out); // correctly asks for fresh proof, not a setup failure
  const a = toon(changed);
  assert.deepEqual(a.changed, ['bin/cli.js']);
  assert.deepEqual(a.features.map((f) => f.name), ['greet-umer']);
  assert.equal(a.unmapped, undefined, 'the generated feature map covers the changed bin');
  assert.equal(a.fallback, undefined, 'no uncertain fallback from a missing map');
  assert.match(a.help.join('\n'), /done-done verify --feature greet-umer/);
  assert.equal(spawnSync(process.execPath, ['bin/cli.js'], { cwd: repo, env: s.env, encoding: 'utf8' }).stdout, 'Welcome Umer\n');
  const d = toon(doctorIn(repo, s.env, 'doctor'));
  assert.equal(d.checks.find((c) => c.check === 'core_journey').status, 'ok');
  assert.equal(d.checks.find((c) => c.check === 'upgrade_journey').status, 'missing', 'first-release scaffolding never claims an upgrade was proven');
});

test('init --no-skill writes the config with no agent call, and a second run is a no-op', () => {
  const { repo, env } = shapeRepo('proof', 'notes');
  const s = stubAgents(env, 'error'); // an agent that would fail: --no-skill must never ask it
  const skill = join(repo, '.agents', 'skills', 'done-done-verify-notes');
  const global = join(env.DONE_DONE_HOME, 'config.yaml');
  const project = join(repo, '.done-done.yaml');
  const args = ['init', '--no-skill', '--agent', 'claude', '--model', 'stub-model', '--judge', 'answerer:opencode', '--judge-model', 'opencode-go/x'];
  const r = doctorIn(repo, s.env, ...args);
  assert.equal(r.code, 0, r.out);
  const o = toon(r);
  assert.equal(o.verify_skill, 'skipped (--no-skill)');
  assert.equal(o.config, 'unchanged');
  assert.doesNotMatch(o.help.join(' '), /verify-notes/, 'the help asks for no commit of a skill that was never written');
  assert.equal(existsSync(skill), false, 'no verify skill');
  assert.equal(s.calls().length, 0, 'the agent is never started');
  const g = parse(readFileSync(global, 'utf8'));
  assert.deepEqual([g.agent, g.agent_config.claude.model, g.judge.route, g.judge.model], ['claude', 'stub-model', 'answerer:opencode', 'opencode-go/x']);
  // Idempotent: the same call again writes no file and still exits 0.
  const before = [global, project].map((f) => ({ f, text: readFileSync(f, 'utf8'), mtime: statSync(f).mtimeMs }));
  const again = doctorIn(repo, s.env, ...args);
  assert.equal(again.code, 0, again.out);
  assert.deepEqual([toon(again).config, toon(again).global_config, toon(again).verify_skill], ['unchanged', 'unchanged', 'skipped (--no-skill)']);
  for (const b of before) assert.deepEqual([readFileSync(b.f, 'utf8'), statSync(b.f).mtimeMs], [b.text, b.mtime], `${b.f} is untouched`);
  assert.equal(s.calls().length, 0);
  // With no agent set it keeps today's exit 2.
  writeFileSync(global, 'judge:\n  route: answerer:opencode\n  model: opencode-go/x\n');
  const none = doctorIn(repo, s.env, 'init', '--no-skill');
  assert.equal(none.code, 2, none.out);
  assert.equal(toon(none).agent, 'not set');
});

test('a repo set up by init captures, checks and receipts real evidence that outlives the checkout', () => {
  const { dir, repo, env, sh, dd } = bareRepo();
  withStubJudge(env, dir);
  const init = dd('init');
  assert.equal(init.code, 2);
  // Follow init's hint as printed: its example journey, placeholder filled in, becomes the config.
  const example = toon(init).help[0].match(/journeys: \{.*\} \}/)[0].replace('<drive the core user journey on the real app>', 'cp steps.src.json $DONE_DONE_EVIDENCE_ROOT/steps.json && echo added: milk');
  appendFileSync(join(repo, '.done-done.yaml'), `${example}\n`);
  writeFileSync(join(repo, 'steps.src.json'), stepsOf('notes add works'));
  sh('add', '-A');
  sh('commit', '-qm', 'config');
  const r = dd('run', 'smoke');
  assert.equal(r.code, 0, r.out);
  const [log] = toon(r).evidence;
  const { run_id: id } = toon(r);
  assert.equal(log, join(dir, 'home', 'evidence', 'repo', id, `${id}.log`), 'evidence lands outside the repo, in the run\'s own folder');
  assert.equal(dd('check', '--outcome', 'notes add works', log).code, 0);
  assert.equal(dd('check', '--outcome', 'gone', `${log}-missing.log`).code, 2, 'a missing file stops the check');
  const h = sh('rev-parse', 'HEAD').toString().trim();
  assert.equal(dd('receipt', '--outcome', 'notes add works', log).code, 0);
  // The worker's checkout goes away; a fresh clone elsewhere (a merge gate) re-verifies the same proof.
  const clone = join(dir, 'merge-gate');
  execFileSync('git', ['clone', '-q', repo, clone]);
  rmSync(repo, { recursive: true, force: true });
  const inClone = (e, ...args) => {
    const x = spawnSync(process.execPath, [CLI, ...args], { cwd: clone, env: e, encoding: 'utf8' });
    return { code: x.status, out: x.stdout + x.stderr };
  };
  const v = inClone(env, 'receipt', '--verify', h);
  assert.equal(v.code, 0, v.out);
  // A restored evidence root under a different DONE_DONE_HOME verifies too.
  const ciHome = join(dir, 'ci-home');
  cpSync(join(dir, 'home', 'evidence'), join(ciHome, 'evidence'), { recursive: true });
  assert.equal(inClone({ ...env, DONE_DONE_HOME: ciHome }, 'receipt', '--verify', h).code, 0, 'a restored evidence root verifies');
  writeFileSync(join(ciHome, 'evidence', 'repo', id, basename(log)), 'added: eggs\n');
  const tampered = inClone({ ...env, DONE_DONE_HOME: ciHome }, 'receipt', '--verify', h);
  assert.equal(tampered.code, 1, tampered.out);
  assert.match(tampered.out, /hash changed/);
  writeFileSync(join(clone, 'app.js'), 'export const app = 2;\n');
  execFileSync('git', ['commit', '-qam', 'code'], { cwd: clone, env });
  const stale = inClone(env, 'check', '--outcome', 'notes add works', log);
  assert.equal(stale.code, 2, stale.out);
  assert.match(stale.out, /evidence is for commit/);
  assert.equal(toon(stale).help[0], 'Commit your change, re-capture with done-done run smoke, then check the new files', 'evidence is ignored, so the hint never says to commit it');
});

test('overlapping runs from two checkouts sharing the evidence root never claim each other\'s files', () => {
  const { dir, repo, env, sh, dd } = bareRepo();
  withStubJudge(env, dir);
  assert.equal(dd('init').code, 2);
  writeFileSync(join(repo, 'steps.mjs'), STEPS_MJS);
  sh('add', '-A');
  sh('commit', '-qm', 'config');
  const lane2 = join(dir, 'lane2');
  execFileSync('git', ['clone', '-q', repo, lane2]);
  writeFileSync(join(lane2, 'app.js'), 'export const app = 2;\n');
  execFileSync('git', ['commit', '-qam', 'lane 2 work'], { cwd: lane2, env });
  const in2 = (...args) => {
    const x = spawnSync(process.execPath, [CLI, ...args], { cwd: lane2, env, encoding: 'utf8' });
    return { code: x.status, out: x.stdout + x.stderr };
  };
  // Lane 1 holds a run open while lane 2 runs a failing capture and a passing one into the same root.
  const open = toon(dd('run', '--open'));
  const failed = in2('run', '--', `node -e "require('fs').writeFileSync(process.env.DONE_DONE_EVIDENCE_ROOT + '/b.log', 'broken'); process.exit(1)"`);
  assert.equal(failed.code, 1, failed.out);
  const passed = in2('run', '--', `node -e "require('fs').writeFileSync(process.env.DONE_DONE_EVIDENCE_ROOT + '/c.log', 'added: milk')" && DD_OUTCOME="notes add works" node steps.mjs`);
  assert.equal(passed.code, 0, passed.out);
  writeFileSync(join(open.evidence_root, 'a.log'), 'added: milk\n');
  writeFileSync(join(open.evidence_root, 'steps.json'), stepsOf('notes add works'));
  const closed = dd('run', '--close', open.run_id);
  assert.deepEqual(toon(closed).evidence, [join(open.evidence_root, 'a.log')], 'lane 1 records only its own folder');
  // The failed run's file cannot pass through lane 1's successful record.
  const fromFailed = dd('check', '--outcome', 'notes add works', toon(failed).evidence[0]);
  assert.equal(fromFailed.code, 2, fromFailed.out);
  assert.match(fromFailed.out, /its run command exited 1/);
  // Byte-identical captures in both lanes: each lane's own file passes, tied to its own commit.
  assert.equal(in2('check', '--outcome', 'notes add works', toon(passed).evidence[0]).code, 0, 'lane 2 is not stale through lane 1');
  assert.equal(dd('check', '--outcome', 'notes add works', join(open.evidence_root, 'a.log')).code, 0, 'lane 1 is not stale through lane 2');
});

test('a result is one TOON document by default, and --json is the same data as JSON', () => {
  const { dd, shots } = setup();
  const { files } = shots();
  const r = dd('check', '--outcome', 'home renders', ...files);
  assert.equal(r.code, 0, r.out);
  const d = toon(r); // decode() throws unless stdout is exactly one TOON document
  assert.equal(d.command, 'check');
  assert.equal(d.result, 'pass');
  assert.equal(d.files, 2);
  const j = dd('check', '--json', '--outcome', 'home renders', ...files);
  assert.equal(j.code, 0, j.out);
  // The second check reads the judge's verdicts from its cache; everything else is the same data.
  const uncached = (x) => ({ ...x, judge: { ...x.judge, judged: x.judge.judged.map(({ cached, ...r }) => r) } });
  assert.deepEqual(uncached(json(j)), uncached(d));
});

// A repo with a journey that blocks until the test releases it, so a verify run can be caught mid-step.
function slowRepo() {
  const t = setup();
  const release = join(t.dir, 'release');
  writeFileSync(
    join(t.repo, 'slow.mjs'),
    `import './steps.mjs';\nimport { copyFileSync, existsSync, mkdirSync } from 'node:fs';\nconst out = '.proof/' + process.argv[2];\nmkdirSync(out, { recursive: true });\nwhile (!existsSync(${JSON.stringify(release)})) await new Promise((r) => setTimeout(r, 50));\ncopyFileSync(${JSON.stringify(join(t.dir, 'screen.png'))}, out + '/home.png');\ncopyFileSync(${JSON.stringify(join(t.dir, 'screen2.png'))}, out + '/settings.png');\n`,
  );
  appendFileSync(join(t.repo, '.done-done.yaml'), '  slow:\n    command: node slow.mjs ${RUN_ID}\n  broken:\n    command: node -e "process.exit(3)"\n');
  t.sh('add', '-A');
  t.sh('commit', '-qm', 'journeys');
  const runs = join(t.env.DONE_DONE_HOME, 'runs', 'notes');
  // Wait for the newest run to reach `step` running, and return its record.
  const runningAt = async (step) => {
    for (let i = 0; i < 200; i++) {
      const id = existsSync(runs) && readdirSync(runs).sort().pop();
      const run = id && existsSync(join(runs, id, 'run.json')) && JSON.parse(readFileSync(join(runs, id, 'run.json'), 'utf8'));
      if (run?.runner?.journey_pgid && run.steps.find((s) => s.name === step).status === 'running') return run;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.fail(`no run reached step ${step}`);
  };
  const settled = async () => {
    for (let i = 0; i < 200; i++) {
      const r = t.dd('status');
      if (r.code !== 4) return r;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.fail('the run never ended');
  };
  return { ...t, release, runs, runningAt, settled };
}

test('verify goes on in a detached runner after the calling shell is killed, and status shows the pass', async () => {
  const { repo, env, release, runs, runningAt, settled } = slowRepo();
  const shell = spawn('sh', ['-c', `${JSON.stringify(process.execPath)} ${JSON.stringify(CLI)} verify slow --outcome 'home and settings render'`], { cwd: repo, env, detached: true, stdio: 'ignore' });
  const run = await runningAt('drive');
  assert.equal(run.schema, 2);
  assert.equal(run.status, 'running');
  process.kill(-shell.pid, 'SIGKILL');
  await new Promise((r) => shell.on('exit', r));
  assert.ok(existsSync(join(runs, run.run_id, 'events.jsonl')));
  writeFileSync(release, '');
  const r = await settled();
  assert.equal(r.code, 0, r.out);
  const s = toon(r);
  assert.equal(s.run_id, run.run_id);
  assert.equal(s.result, 'pass');
  assert.deepEqual(s.steps.map((x) => [x.name, x.status]), [['resolve', 'completed'], ['drive', 'completed'], ['check', 'completed'], ['judge', 'completed'], ['gate', 'skipped'], ['receipt', 'completed'], ['report', 'completed']], 'the judge always runs');
  assert.deepEqual(s.evidence, [`.proof/${run.run_id}/home.png`, `.proof/${run.run_id}/settings.png`]);
  assert.match(s.help[0], /done-done receipt --verify [0-9a-f]{40}$/);
  assert.ok(existsSync(join(repo, s.receipt)), 'the runner recorded a receipt');
  assert.ok(existsSync(join(runs, run.run_id, 'logs', 'check.log')));
});

// Resolves true once the process group is gone, false if it outlives the poll.
async function groupGone(pgid) {
  for (let i = 0; i < 100; i++) {
    try {
      process.kill(-pgid, 0);
    } catch {
      return true;
    }
    await new Promise((res) => setTimeout(res, 50));
  }
  return false;
}

test('a journey past its timeout is killed and the run ends inconclusive', async () => {
  const { repo, dd, env } = setup();
  appendFileSync(join(repo, '.done-done.yaml'), '  hang:\n    command: node -e "setInterval(() => {}, 1000)"\n    timeout: 2s\n');
  const r = dd('verify', 'hang', '--outcome', 'the app starts', '--foreground');
  assert.equal(r.code, 3, r.out);
  const s = toon(r);
  assert.equal(s.result, 'inconclusive');
  assert.equal(s.reason, 'drive: journey timed out after 2s');
  assert.deepEqual(s.steps.map((x) => x.status), ['completed', 'failed', 'skipped', 'skipped', 'skipped', 'skipped', 'completed']);
  const pgid = JSON.parse(readFileSync(join(env.DONE_DONE_HOME, 'runs', 'notes', s.run_id, 'run.json'), 'utf8')).runner.journey_pgid;
  assert.ok(await groupGone(pgid), 'the timed-out journey is gone');
});

test('a verify run fails when its log or text evidence holds a secret, naming where but never the value', () => {
  const t = setup(JUDGED.replace('journeys:', 'secrets:\n  patterns:\n    house-key: "HOUSE-\\\\d{4}"\n  allow: ["F4KE"]\njourneys:'));
  const leak = join(t.dir, 'leak.txt');
  appendFileSync(join(t.repo, '.done-done.yaml'), '  logged:\n    command: node make-shots.mjs ${RUN_ID} && cat ../leak.txt\n  saved:\n    command: node make-shots.mjs ${RUN_ID} && cp ../leak.txt "$DONE_DONE_EVIDENCE_ROOT/session.log"\n');
  t.sh('add', '-A'); t.sh('commit', '-qm', 'journeys');
  // Fake values, split so this file holds no secret shape itself.
  const fakes = [
    ['private-key', `-----BEGIN RSA ${'PRIVATE'} KEY-----`],
    ['github-token', `gh${'p_'}${'fake0'.repeat(8)}`],
    ['api-key', `s${'k-'}${'fake0'.repeat(5)}`],
    ['bearer', `Authorization: Bear${'er'} ${'fake0'.repeat(5)}`],
    ['key-value', `API_TOKEN=${'f4ke0'.repeat(6)}`],
    ['key-value', `DB_${'PASSWORD'}=Tr0ub4dor&3xtra`],
    ['house-key', 'door HOUSE-1234'],
  ];
  for (const [pattern, value] of fakes) {
    writeFileSync(leak, `starting\n${value}\n`);
    const r = t.dd('verify', 'logged', '--outcome', 'home and settings render');
    assert.match(toon(r).reason, new RegExp(`^secrets: .*/drive\\.log:2: holds a secret \\(${pattern}\\)`));
    const shownLog = t.dd('logs', '--step', 'check', '--run', toon(r).run_id).out;
    assert.ok(![r.out, shownLog].some((o) => o.includes(value.slice(-12))), `the ${pattern} value is never printed`);
  }
  writeFileSync(leak, `token=${'gh'}p_${'F4KE0'.repeat(8)}\n`);
  const evid = t.dd('verify', 'saved', '--outcome', 'home and settings render');
  assert.equal(evid.code, 0, `an allowed known-safe match passes: ${evid.out}`);
  writeFileSync(leak, `session ${'sk'}-${'fake0'.repeat(5)}\n`);
  assert.match(toon(t.dd('verify', 'saved', '--outcome', 'home and settings render')).reason, /^secrets: \.proof\/.*\/session\.log:1: holds a secret \(api-key\)/);
  writeFileSync(leak, 'saved 3 notes\n');
  assert.equal(t.dd('verify', 'logged', '--outcome', 'home and settings render').code, 0, 'clean evidence passes');
  writeFileSync(join(t.repo, '.done-done.yaml'), 'app: notes\nsecrets:\n  allow: ["("]\n');
  assert.match(t.dd('status').out, /secrets\.allow must be a list of valid regexes/);
});

test('a journey that spends parks before it runs until the user approves; respond approve runs it', () => {
  const t = setup();
  const spent = join(t.dir, 'spent.txt');
  appendFileSync(join(t.repo, '.done-done.yaml'), '  paid:\n    command: node make-shots.mjs ${RUN_ID} && echo spent >> ../spent.txt\n    spends: one live generation\n');
  t.sh('add', '-A'); t.sh('commit', '-qm', 'paid journey');
  const spends = () => (existsSync(spent) ? readFileSync(spent, 'utf8').split('\n').filter(Boolean).length : 0);
  const parked = toon(t.dd('verify', 'paid', '--outcome', 'home and settings render'));
  assert.deepEqual([parked.status, parked.step, spends()], ['awaiting_approval', 'drive', 0], 'nothing runs before approval');
  assert.match(parked.findings[0].what, /journey paid spends \(one live generation\)/);
  assert.ok(parked.help.includes(`done-done respond --run ${parked.run_id} --action approve --reason "<who approved the spend>"`), parked.help);
  assert.equal(t.dd('verify', 'paid', '--outcome', 'home and settings render').code, 2, 'a parked spend blocks a new run around it');
  const ok = t.dd('respond', '--run', parked.run_id, '--action', 'approve', '--reason', 'Umer approved one generation');
  assert.equal(ok.code, 0, ok.out);
  assert.deepEqual([toon(ok).result, toon(ok).spend.reason, spends()], ['pass', 'Umer approved one generation', 1]);
  const no = toon(t.dd('verify', 'paid', '--outcome', 'home and settings render'));
  assert.equal(no.status, 'awaiting_approval', 'every new run asks again');
  const sg = JSON.parse(readFileSync(toon(t.dd('signoff')).file, 'utf8'));
  assert.deepEqual([sg.title, sg.options.map((o) => o.value), sg.recommend_value], ['Spend one live generation on the notes paid run?', ['approve', 'skip'], 'approve'], 'its sign-off gate offers what respond takes');
  assert.equal(t.dd('respond', '--run', no.run_id, '--action', 'fix').code, 2, 'a spend gate takes approve or skip');
  const skip = t.dd('respond', '--run', no.run_id, '--action', 'skip', '--reason', 'Umer said no');
  assert.match(toon(skip).reason, /chose skip: the journey was not run, so nothing was spent/);
  assert.equal(spends(), 1);
  const plain = t.dd('run', 'paid');
  const withCommand = t.dd('run', 'paid', '--', 'sh', '-c', 'echo spent >> ../spent.txt');
  assert.deepEqual([plain.code, withCommand.code, spends()], [2, 2, 1], 'run refuses a spends journey, with or without a command');
  assert.match(plain.out, /done-done verify paid --outcome/, plain.out);
});

test('bare done-done orients with the config state and the next step, and names a valid receipt for HEAD', () => {
  const { dd, shots } = setup();
  const r = dd();
  assert.equal(r.code, 0, r.out);
  const b = toon(r);
  assert.equal(b.command, 'done-done');
  assert.equal(b.config, 'present');
  assert.deepEqual(b.journeys, ['shots']);
  assert.match(b.receipt, /^no receipt for /);
  assert.match(b.help[0], /done-done run shots/);
  const { files } = shots(); assert.equal(dd('verify', 'shots', '--outcome', 'home renders', '--foreground').code, 0); assert.equal(dd('receipt', '--outcome', 'home renders', ...files).code, 0); const after = toon(dd());
  assert.match(after.receipt, /^valid for HEAD [0-9a-f]{12}$/); assert.equal(after.help[0], 'HEAD has a valid receipt for "home renders"; prove the next commit with done-done verify --outcome "<what a user can now do>"');
  assert.equal(after.runs, toon(dd('history')).runs, 'bare counts the runs history lists');
});

// The relevance judge runs the user's own claude binary (agent_path_override.claude) with the user's sign-in. The stub
// answers `auth status` and the one request the judge sends (stream-json with images, text without), and logs the HOME,
// CLAUDE_CONFIG_DIR and argv it ran with, so a test can see what the judge was run with. Its state is in JUDGE_STUB.
const STUB_RATIONALE = 'The notes list shows "Notes" at the top and no dialog.';
function judgeSetup(answer, { loggedIn = true, projectYaml = JUDGED, floor } = {}) {
  const t = setup(projectYaml);
  // The config's author agent (opencode) must be installed on any host, so the receipt names it.
  t.env.PATH = `${pathEnv(t.env, ['opencode']).PATH}:${t.env.PATH}`;
  const stubDir = join(t.dir, 'judge-stub');
  const bin = join(t.dir, 'claude');
  mkdirSync(stubDir);
  t.env.JUDGE_STUB = stubDir;
  writeFileSync(
    bin,
    `#!${process.execPath}
const { appendFileSync, readdirSync, readFileSync } = require('node:fs');
const dir = process.env.JUDGE_STUB;
const stub = JSON.parse(readFileSync(dir + '/stub.json', 'utf8'));
if (process.argv.includes('auth')) {
  process.stdout.write(JSON.stringify({ loggedIn: stub.loggedIn, authMethod: stub.loggedIn ? 'claude.ai' : 'none', apiProvider: 'firstParty' }));
  process.exit(stub.loggedIn ? 0 : 1);
}
const raw = readFileSync(0, 'utf8');
let content = [{ type: 'text', text: raw }];
try {
  content = JSON.parse(raw).message.content;
} catch {}
const images = content.filter((c) => c.type === 'image');
const img = images[0] && Buffer.from(images[0].source.data, 'base64');
const prompt = content.at(-1).text;
const begin = 'BEGIN DATA (JSON)\\n';
const state = JSON.parse(prompt.slice(prompt.indexOf(begin) + begin.length, prompt.indexOf('\\nEND DATA'))).state;
appendFileSync(dir + '/calls.jsonl', JSON.stringify({ home: process.env.HOME, configDir: process.env.CLAUDE_CONFIG_DIR ?? null, shed: Object.hasOwn(process.env, 'DD_POOL_SHED'), apiKey: Object.hasOwn(process.env, 'ANTHROPIC_API_KEY'), argv: process.argv.slice(2), model: process.argv[process.argv.indexOf('--model') + 1], images: images.length, width: img?.readUInt32BE(16), scratch: readdirSync('.'), prompt, state }) + '\\n');
if ((stub.limitDirs ?? []).includes(process.env.CLAUDE_CONFIG_DIR ?? '')) process.exit(process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'usage limit reached' })) && 1);
if (!stub.loggedIn) process.exit(process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' })) && 1);
const p = 'before' in state && state.before === state.capture ? { correct: 0.04, wrong: 0.93, unclear: 0.03 } : stub.answer;
const pick = Object.keys(p).sort((a, b) => p[b] - p[a])[0];
// The coverage lists: every capture names the outcome's parts, and shows the positions whose needle its text holds.
const capKeys = Object.keys(state).filter((k) => /^capture_\\d+$/.test(k));
const judged = Object.fromEntries(capKeys.map((k) => {
  const text = String(state[k]?.capture ?? state[k]?.name ?? '');
  const shown = Object.entries(stub.shows ?? {}).filter(([needle]) => text.includes(needle)).map(([, s]) => s);
  return [k, { probabilities: p, pick, personReason: stub.reason, rationale: stub.rationale, ...(stub.noLists ? {} : { parts: shown.at(-1)?.parts ?? stub.parts ?? [], covers: shown.flatMap((s) => s.covers) }) }];
}));
const shown = Object.entries(stub.shows ?? {}).filter(([needle]) => String(state.capture ?? '').includes(needle)).map(([, s]) => s);
const covers = shown.flatMap((s) => s.covers);
const parts = shown.at(-1)?.parts ?? stub.parts ?? [];
if (p === 'error') process.exit(process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'usage limit reached' })) && 0);
// stream-json prints one event per line; the after events come after the result.
const lines = (es) => es.map((e) => JSON.stringify(e) + '\\n').join('');
const streamed = process.argv.includes('stream-json') ? lines([{ type: 'system', subtype: 'init' }, ...(stub.events ?? [])]) : '';
const after = process.argv.includes('stream-json') && stub.after?.length ? '\\n' + lines(stub.after) : '';
if (stub.stderr) process.stderr.write(stub.stderr);
const lists = stub.noLists ? {} : { parts, covers };
process.stdout.write(streamed + JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '', structured_output: capKeys.length ? judged : { relevance: { probabilities: p, pick, personReason: stub.reason, rationale: stub.rationale, ...lists } } }) + after);
`,
    { mode: 0o755 },
  );
  const stub = (a, li = loggedIn, events = [], after = [], stderr = '', coverage = {}) => writeFileSync(join(stubDir, 'stub.json'), JSON.stringify({ loggedIn: li, answer: a, reason: 'The screen shows the notes list.', rationale: STUB_RATIONALE, events, after, stderr, ...coverage }));
  stub(answer);
  mkdirSync(t.env.DONE_DONE_HOME, { recursive: true });
  const floorLine = floor === undefined ? '' : `  floor: ${floor}\n`;
  writeFileSync(join(t.env.DONE_DONE_HOME, 'config.yaml'), `agent: opencode\njudge:\n  route: claude-code\n  model: claude-test-1\n${floorLine}agent_path_override: { claude: ${JSON.stringify(bin)} }\n`);
  const calls = () => (existsSync(join(stubDir, 'calls.jsonl')) ? readFileSync(join(stubDir, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  return { ...t, stubDir, stub, calls };
}
const CORRECT = { correct: 0.95, wrong: 0.03, unclear: 0.02 };

test('with no judge set, check and receipt give no result and write no receipt: they ask for the judge', () => {
  const t = setup();
  const { files } = t.shots();
  rmSync(join(t.env.DONE_DONE_HOME, 'config.yaml'));
  for (const cmd of ['check', 'receipt']) {
    const r = t.dd(cmd, '--outcome', 'home and settings render', ...files);
    assert.equal(r.code, 2, r.out);
    const e = toon(r);
    assert.equal(e.result, undefined, `${cmd} gives no result without its judge`);
    assert.match(e.error, /^no judge is set: ask the user which judge to use/);
    assert.match(e.help[0], /done-done init --judge <agent> --judge-model <model>/);
    // A failed plain check stops first with its own cause: the judge is never asked for.
    const gone = t.dd(cmd, '--outcome', 'home and settings render', 'missing.png');
    assert.equal(gone.code, 2, gone.out);
    assert.match(toon(gone).error, /^check: the judge was not asked, so there is no verdict: missing\.png: no such file/, cmd);
    assert.ok(!gone.out.includes('no judge is set'), `${cmd} asks for no judge before its plain checks pass`);
  }
  assert.ok(!existsSync(join(t.repo, '.proof', '.done-done', 'receipts')), 'no receipt was written');
  assert.match(t.dd('receipt', '--verify', t.head()).out, /no receipt/);
});

test('judge pass exits 0, sends one downscaled image and the outcome only, and a re-run is a cache hit', () => {
  const j = judgeSetup(CORRECT);
  writeFileSync(join(j.dir, 'screen2.png'), png(2000, 1000, (x, y) => [x % 256, y % 256, 90]));
  const { files: cited } = j.shots('the notes list shows three notes');
  const r = j.dd('check', '--outcome', 'the notes list shows three notes', ...cited);
  assert.equal(r.code, 0, r.out);
  const d = toon(r);
  assert.equal(d.result, 'pass');
  assert.deepEqual([d.judge.route, d.judge.model], ['claude-code', 'claude-test-1']);
  assert.deepEqual(d.judge.judged.map((x) => [x.path, x.verdict, x.cached]), cited.map((p) => [p, 'pass', false]));
  assert.equal(d.judge.judged[0].reason, 'The screen shows the notes list.');
  const calls = j.calls();
  assert.equal(calls.length, 2, 'one isolated request per citation');
  assert.ok(calls.every((c) => c.images === 1 && c.model === 'claude-test-1'));
  assert.equal(calls[0].width, 200, 'the first image is attached');
  assert.ok(calls.every((c) => c.prompt.includes('the notes list shows three notes') && !c.prompt.includes('.proof') && !c.prompt.includes(j.repo)), 'only the outcome line goes with the image');
  assert.ok(calls.every((c) => c.home === j.env.HOME && c.configDir === (process.env.CLAUDE_CONFIG_DIR ?? null)), 'the judge runs your own claude: your HOME, and no sign-in folder of done-done\'s');
  assert.ok(calls.every((c) => ['--safe-mode', '--no-session-persistence', '--tools', '--setting-sources', '--input-format'].every((f) => c.argv.includes(f))), 'a fresh, tools-off, non-persistent session with your settings out, the capture as stream-json');
  const again = j.dd('check', '--outcome', 'the notes list shows three notes', ...cited);
  assert.equal(again.code, 0, again.out);
  assert.ok(toon(again).judge.judged.every((x) => x.cached === true && x.verdict === 'pass'));
  assert.equal(j.calls().length, 2, 'a cache hit asks no model');
  const cacheDir = join(j.env.DONE_DONE_HOME, 'runs', 'notes', 'judge');
  const cache = readFileSync(join(cacheDir, readdirSync(cacheDir)[0]), 'utf8');
  assert.doesNotMatch(cache, /token|key|secret/i, 'the cache in the run store holds verdicts only');
  const agents = join(j.env.DONE_DONE_HOME, 'agents');
  const records = readdirSync(agents).filter((n) => n.startsWith('judge-'));
  assert.equal(records.length, 2, 'the claude-code route writes one call record per citation');
  assert.doesNotMatch(readFileSync(join(agents, records[0]), 'utf8'), /BEGIN DATA/, 'a call record never holds the prompt');
});

test('Claude unavailable falls back to configured pi, including an empty account pool; unset and invalid picks fail closed', () => {
  const t = judgeSetup('error');
  delete t.env.CLAUDE_CONFIG_DIR;
  const config = join(t.env.DONE_DONE_HOME, 'config.yaml');
  const original = readFileSync(config, 'utf8');
  const { files } = t.shots('home and settings render');
  const s = stubAgents(t.env, '');
  const verdict = JSON.stringify({ relevance: { probabilities: CORRECT, rationale: 'The list shows the notes.', personReason: 'The list shows the notes.', parts: [], covers: [] } });
  stubPiBridge(s.env, verdict);
  const run = (cmd = 'check', cited = files) => {
    const r = spawnSync(process.execPath, [CLI, cmd, '--outcome', 'home and settings render', ...cited], { cwd: t.repo, env: s.env, encoding: 'utf8' });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  const set = (fallback, extra = '') => writeFileSync(config, original.replace('judge:\n', `agent_config:\n  pi: { model: openai-codex/gpt-6.1-sol }\njudge:\n${fallback ? '  fallback_route: answerer:pi\n' : ''}${extra}`));
  set(false);
  assert.match(toon(run()).error, /usage limit reached/);
  set(true);
  const ok = run();
  assert.equal(ok.code, 0, ok.out);
  assert.deepEqual([toon(ok).judge.route, toon(ok).judge.model], ['answerer:pi', 'openai-codex/gpt-6.1-sol']);
  assert.match(toon(ok).judge.detail, /answerer:pi.*claude-code/);
  assert.equal(s.calls().filter((c) => c.agent === 'pi').length, 2, 'the whole check moves to pi');
  assert.equal(run('check', [files[0]]).code, 0, 'single-capture path also falls back');
  const pick = join(t.dir, 'pick');
  writeFileSync(pick, `#!${process.execPath}\nconsole.log(JSON.stringify({ok:false, reason:'every account under floor'})); process.exit(19);\n`, { mode: 0o755 });
  const account = `  account_command: ${JSON.stringify(pick)}\n`;
  set(true, account);
  const before = t.calls().length;
  const receipt = run('receipt');
  assert.equal(receipt.code, 0, receipt.out);
  assert.equal(toon(receipt).judge.route, 'answerer:pi');
  assert.equal(t.calls().length, before, 'empty pool never starts Claude');
  set(false, account);
  assert.match(toon(run()).error, /judge.account_command: command exited 19: every account under floor/);
  set(true, account);
  writeFileSync(pick, '#!/bin/sh\nprintf broken', { mode: 0o755 });
  const invalid = run();
  assert.equal(invalid.code, 2, invalid.out);
  assert.match(toon(invalid).error, /invalid JSON/);
  set(true);
  t.stub(CORRECT, false);
  assert.equal(run().code, 0, 'not logged in uses the fallback');
  t.stub(CORRECT, true, [{ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'seven_day', resetsAt: 1792692000 } }]);
  assert.equal(run().code, 0, 'a rejected rate limit uses the fallback');
  t.stub({ correct: 3, wrong: 0, unclear: 0 });
  const malformed = run();
  assert.equal(malformed.code, 2, malformed.out);
  assert.match(toon(malformed).error, /no probabilities/, 'malformed answers do not trigger Claude fallback');
  writeFileSync(config, readFileSync(config, 'utf8').replace('fallback_route: answerer:pi', 'fallback_route: answerer:codex'));
  assert.match(toon(run()).error, /judge.fallback_route must be/);
  set(true);
  t.stub('error');
  writeFileSync(join(s.env.PATH, 'pi'), '#!/bin/sh\necho "pi offline" >&2\nexit 1\n', { mode: 0o755 });
  const failed = run('check', [files[1]]);
  assert.equal(failed.code, 2, failed.out);
  assert.match(toon(failed).error, /pi exited 1.*after claude-code failed:.*usage limit reached/);
});

test('judge wrong screen fails with exit 1, unsure and low confidence are inconclusive with exit 3', () => {
  const j = judgeSetup({ correct: 0.05, wrong: 0.9, unclear: 0.05 });
  const { files } = j.shots('the settings page shows dark mode on', 'the sync finished in the background', 'the home screen shows the welcome card', 'the home screen shows the sync banner');
  const fail = j.dd('check', '--outcome', 'the settings page shows dark mode on', files[0]);
  assert.equal(fail.code, 1, fail.out);
  const f = toon(fail);
  assert.equal(f.result, 'fail');
  assert.equal(f.judge.judged[0].verdict, 'fail');
  assert.match(f.findings[0].why, /judge says wrong screen/);
  assert.equal(f.judge.judged[0].seen, STUB_RATIONALE);
  assert.equal(f.findings[0].seen, STUB_RATIONALE);
  assert.match(f.help[0], /Capture the screen the outcome describes.*done-done run shots/);
  const cachedFail = j.dd('check', '--outcome', 'the settings page shows dark mode on', files[0]);
  assert.equal(cachedFail.code, 1, 'a cached wrong-screen verdict still fails');
  assert.equal(toon(cachedFail).judge.judged[0].cached, true);
  assert.equal(toon(cachedFail).judge.judged[0].seen, STUB_RATIONALE, 'a cached verdict keeps what the judge quoted');
  j.stub({ correct: 0.05, wrong: 0.05, unclear: 0.9 });
  const unsure = j.dd('check', '--outcome', 'the sync finished in the background', files[0]);
  assert.equal(unsure.code, 3, unsure.out);
  assert.equal(toon(unsure).judge.judged[0].verdict, 'unsure');
  assert.match(toon(unsure).help[0], /Look at the capture yourself/);
  j.stub({ correct: 0.6, wrong: 0.3, unclear: 0.1 });
  const low = j.dd('check', '--outcome', 'the home screen shows the welcome card', files[0]);
  assert.equal(low.code, 3, low.out);
  assert.match(toon(low).judge.judged[0].reason, /not confident enough \(confidence 0.6 below floor 0.7\)/);
  assert.equal(j.calls().length, 3);
  // A judge that fails gives no verdict at all: check and receipt stop with its cause (exit 2), and no receipt is written.
  j.stub('error');
  for (const cmd of ['check', 'receipt']) {
    const err = j.dd(cmd, '--outcome', 'the home screen shows the sync banner', files[0]);
    assert.equal(err.code, 2, err.out);
    assert.equal(toon(err).result, undefined, `${cmd} gives no result when the judge fails`);
    assert.match(toon(err).error, /^judge: the judge did not answer: usage limit reached \(check judge.model claude-test-1 and your plan's usage limit\)/);
    assert.doesNotMatch(err.out, /auth login/, 'a model error while signed in is not a sign-in error');
  }
  assert.equal(j.dd('receipt', '--verify', j.head()).code, 1, 'no receipt was written');
});

test('three captures that each show one named part pass in one judge call, but a missing part fails', () => {
  const j = judgeSetup(CORRECT);
  const shows = { '390': { covers: [0] }, '800': { covers: [1] }, '1440': { covers: [2] } };
  j.stub(CORRECT, true, [], [], '', { parts: ['390 wide', '800 wide', '1440 wide'], shows });
  const cp = (from, name) => `node -e "require('node:fs').copyFileSync('${from}', process.env.DONE_DONE_EVIDENCE_ROOT + '/${name}')"`;
  const files = [390, 800, 1440].map((width) => {
    const file = join(j.dir, `widths-${width}.json`);
    writeFileSync(file, JSON.stringify({ checks: [{ width, frames: [{ name: 'send', newest_message: 'hello', at: 'bottom' }] }] }));
    return file;
  });
  const run = j.dd('run', '--', `${files.map((f, i) => cp(f, `width-${i}.json`)).join(' && ')} && DD_OUTCOME="message shows at 390, 800 and 1440 wide" node steps.mjs`);
  assert.equal(run.code, 0, run.out);
  const folder = `.proof/${toon(run).run_id}`;
  const outcome = 'message shows at 390, 800 and 1440 wide';
  const all = j.dd('check', '--outcome', outcome, ...[0, 1, 2].map((i) => `${folder}/width-${i}.json`));
  assert.equal(all.code, 0, all.out);
  assert.equal(j.calls().length, 1, 'all three captures are answered by the single judge request');
  assert.deepEqual(toon(all).judge.judged.map((x) => x.verdict), ['pass', 'pass', 'pass']);

  j.stub(CORRECT, true, [], [], '', { parts: ['390 wide', '800 wide', '1440 wide'], shows: { '390': { covers: [0] }, '800': { covers: [1] } } });
  const missing = j.dd('check', '--outcome', `${outcome} missing`, ...[0, 1, 2].map((i) => `${folder}/width-${i}.json`));
  assert.equal(missing.code, 3, missing.out);
  assert.match(missing.out, /1440 wide/);
  assert.equal(j.calls().length, 2, 'the full-set cache is invalidated by the third capture bytes');
});

test('check judges text evidence too, and a failed plain check stops with its cause, unjudged', () => {
  const j = judgeSetup(CORRECT, { projectYaml: 'app: notes\nevidence:\n  root: .proof\njourneys:\n  shots:\n    command: node make-shots.mjs ${RUN_ID}\n' });
  const r = j.dd('run', '--', `node make-shots.mjs \${RUN_ID} && node -e "require('fs').writeFileSync(process.env.DONE_DONE_EVIDENCE_ROOT + '/session.log','saved 3 notes')" && DD_OUTCOME="three notes are saved" node steps.mjs`);
  assert.equal(r.code, 0, r.out);
  const mixed = `.proof/${toon(r).run_id}`;
  const ok = j.dd('check', '--outcome', 'three notes are saved', `${mixed}/home.png`, `${mixed}/session.log`);
  assert.equal(ok.code, 0, ok.out);
  const d = toon(ok);
  assert.deepEqual(d.judge.judged.map((x) => x.path), [`${mixed}/home.png`, `${mixed}/session.log`]);
  assert.equal(d.judge.not_judged, undefined);
  assert.match(d.judge.note, /text captures \(logs, JSON, CLI output\) are judged; video and other files are not/);
  const bad = j.dd('check', '--outcome', 'three notes are saved', `${mixed}/home.png`, '.proof/nope.png');
  assert.equal(bad.code, 2, bad.out);
  assert.match(toon(bad).error, /^check: the judge was not asked, so there is no verdict: \.proof\/nope\.png: no such file/);
  writeFileSync(join(j.repo, 'stray.png'), screen(11));
  const stray = j.dd('check', '--outcome', 'three notes are saved', 'stray.png');
  assert.equal(stray.code, 2, stray.out);
  assert.match(toon(stray).error, /^check: the judge was not asked, so there is no verdict: stray\.png: not in any done-done run record/, 'a capture with no run record is never sent');
  assert.equal(j.calls().length, 2);
});


test('verify judges by default with the judge the user set: opencode judges a claude author through the answerer; a right screen passes, a wrong one fails', () => {
  const t = setup(JUDGED);
  mkdirSync(t.env.DONE_DONE_HOME, { recursive: true });
  writeFileSync(join(t.env.DONE_DONE_HOME, 'config.yaml'), 'agent: claude\njudge:\n  route: answerer:opencode\n');
  const verdict = (p) => JSON.stringify({ relevance: { probabilities: p, rationale: 'The list shows the notes.', personReason: 'The list shows the notes.', parts: [], covers: [] } });
  const agents = (p) => {
    const s = stubAgents(t.env, verdict(p));
    symlinkSync(process.execPath, join(s.bin, 'node'));
    return s;
  };
  const right = agents(CORRECT);
  const verify = (env, outcome, ...more) => {
    const r = spawnSync(process.execPath, [CLI, 'verify', 'shots', '--outcome', outcome, '--foreground', ...more], { cwd: t.repo, env: { ...env, DD_OUTCOME: outcome }, encoding: 'utf8' });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  const ok = verify(right.env, 'home and settings render');
  assert.equal(ok.code, 0, ok.out);
  const o = toon(ok);
  assert.deepEqual(o.steps.map((x) => [x.name, x.status]), [['resolve', 'completed'], ['drive', 'completed'], ['check', 'completed'], ['judge', 'completed'], ['gate', 'skipped'], ['receipt', 'completed'], ['report', 'completed']]);
  const calls = right.calls();
  assert.equal(calls.length, 2, 'one tools-off call per capture, none to the author');
  assert.ok(calls.every((c) => c.agent === 'opencode' && c.argv.includes('opencode-go/muse-spark-1.3-contributor') && JSON.parse(c.permission)['*'] === 'deny'));
  assert.ok(calls.every((c) => c.attached.length === 1 && c.attached.every((x) => x === 'PNG')), 'the call attaches only its own capture');
  assert.ok(calls.every((c) => c.file.includes('home and settings render') && !c.file.includes('.proof') && !c.argv.some((a) => a.includes('home and settings render'))), 'the outcome goes in the prompt file, never argv or a path');
  const runDir = join(t.env.DONE_DONE_HOME, 'runs', 'notes', o.run_id);
  const judgeLog = decode(readFileSync(join(runDir, 'logs', 'judge.log'), 'utf8'));
  assert.deepEqual([judgeLog.route, judgeLog.independence, judgeLog.author], ['answerer:opencode', 'agent', 'claude (model claude-haiku-5-5)']);
  const records = readdirSync(join(runDir, 'agents')).sort();
  assert.equal(records.length, 2, 'one agent call record per capture, and no author judge record');
  for (const n of records) {
    const text = readFileSync(join(runDir, 'agents', n), 'utf8');
    assert.doesNotMatch(text, /home and settings render|Answer the typed questions/, `${n} keeps no prompt text`);
  }
  // The sign-off message is evidence (contract v1, section 6), key for key; its media resolve inside its own folder.
  const sent = t.dd('signoff', '--run', o.run_id);
  assert.equal(sent.code, 0, sent.out);
  const evFile = join(t.repo, toon(sent).file);
  assert.equal(toon(sent).help[0], `Post it to the sign-off board with sign-off-axi (done-done prepares the run; sign-off-axi posts): npx -y sign-off-axi post --kind evidence --from ${toon(sent).file}`);
  assert.deepEqual(JSON.parse(readFileSync(evFile, 'utf8')), {
    contract: 1, kind: 'evidence', schema: 1, key: `dd-evidence-${o.run_id}`, filer: 'done-done', title: 'notes shots: verify pass', about: 'home and settings render', media: ['home.png', 'settings.png'],
    run: { run_id: o.run_id, commit: t.head(), outcome: 'home and settings render', repro: `done-done verify shots --outcome "home and settings render" at ${t.head()}`, proof: `no verify skill: done-done verify shots, run ${o.run_id}: pass`, evidence: 'home.png, settings.png' },
  });
  assert.equal(dirname(evFile), join(t.repo, '.proof', o.run_id), 'the message sits in the run folder its media resolve from');
  const v = t.dd('receipt', '--verify', t.head());
  assert.equal(v.code, 0, v.out);
  assert.deepEqual([toon(v).schema, toon(v).judge.route, toon(v).judge.verdicts.map((x) => x.verdict)], [2, 'answerer:opencode', ['pass', 'pass']]);
  // A wrong screen parks the run at the gate (exit 4): the check passed, the judge failed it, no receipt yet.
  const wrong = agents({ correct: 0.04, wrong: 0.93, unclear: 0.03 });
  const bad = verify(wrong.env, 'the settings page shows dark mode on');
  assert.equal(bad.code, 4, bad.out);
  const b = toon(bad);
  assert.deepEqual([b.status, b.step, b.result], ['awaiting_approval', 'gate', undefined]);
  assert.deepEqual(b.steps.map((x) => x.status), ['completed', 'completed', 'completed', 'failed', 'awaiting_approval', 'pending', 'pending']);
  assert.deepEqual([b.findings.length, b.findings[0].id, b.findings[0].severity, b.findings[0].action], [2, 'gate-1', 'error', 'ask-user']);
  assert.match(b.findings[0].what, /judge says wrong screen/);
  assert.ok(b.help.some((h) => h.includes(`done-done respond --run ${b.run_id} --action fix`)), bad.out);
  assert.ok(!b.help.some((h) => /--action (approve|skip)/.test(h)), 'nothing moves a run past its judge');
  // Parked at its gate, the run's sign-off message is a gate whose answers are fix and skip, since the judge failed a capture.
  const gated = t.dd('signoff');
  assert.equal(gated.code, 0, gated.out);
  assert.deepEqual(JSON.parse(readFileSync(toon(gated).file, 'utf8')), {
    contract: 1, kind: 'gate', schema: 1, key: `dd-gate-${b.run_id}`, filer: 'done-done', title: 'End the notes shots run its judge did not pass, to fix it?',
    about: 'home.png: judge says wrong screen: The list shows the notes. (and 1 more)', run: { run_id: b.run_id, commit: t.head() },
    options: [{ value: 'fix', label: 'Fix first' }, { value: 'skip', label: 'Skip the judge' }], recommend_value: 'fix', close: 'done',
  });
  // Approve never moves a run past its judge: the run stays parked.
  const refused = t.dd('respond', '--run', b.run_id, '--action', 'approve');
  assert.equal(refused.code, 2, refused.out);
  assert.match(toon(refused).error, /is at its judge gate, which takes only --action fix or skip: done-done never moves a run past its judge, and writes no receipt without a judge pass/);
  assert.equal(toon(t.dd('status', '--run', b.run_id)).status, 'awaiting_approval', 'a refused answer leaves the run parked');
  const runJson = join(t.env.DONE_DONE_HOME, 'runs', 'notes', b.run_id, 'run.json'), saved = readFileSync(runJson, 'utf8');
  writeFileSync(runJson, '{');
  assert.equal(t.dd('respond', '--run', b.run_id, '--action', 'fix').code, 2);
  writeFileSync(runJson, saved);
  // fix ends the run fail, records who answered, and writes no receipt.
  const fixed = t.dd('respond', '--run', b.run_id, '--action', 'fix');
  assert.equal(fixed.code, 1, fixed.out);
  const a = toon(fixed);
  assert.deepEqual([a.status, a.result, a.response.action], ['completed', 'fail', 'fix']);
  assert.ok(a.response.by, 'who answered is recorded');
  const events = readFileSync(join(t.env.DONE_DONE_HOME, 'runs', 'notes', b.run_id, 'events.jsonl'), 'utf8');
  assert.match(events, /"step":"gate","response":"fix","by":"[^"]+"/, 'the answer is logged');
  assert.equal(a.receipt, undefined, 'the run wrote no receipt');
  assert.equal(toon(t.dd('receipt', '--verify', t.head())).claim, 'home and settings render', "the head's receipt is still the passing run's");
  assert.equal(t.dd('respond', '--run', b.run_id, '--action', 'fix').code, 2, 'a run is answered once');
  // A rerun of the judged run judges again (the cached wrong verdict), so it cannot pass with the judge left out.
  const re = spawnSync(process.execPath, [CLI, 'rerun', '--run', b.run_id], { cwd: t.repo, env: right.env, encoding: 'utf8' });
  assert.equal(re.status, 4, re.stdout + re.stderr);
  assert.deepEqual(toon({ out: re.stdout }).steps.map((x) => [x.name, x.status]).slice(3, 6), [['judge', 'failed'], ['gate', 'awaiting_approval'], ['receipt', 'pending']]);
  assert.equal(t.dd('respond', '--run', toon({ out: re.stdout }).run_id, '--action', 'fix').code, 1);
  // The author's own agent and model may judge too: the user's choice runs, in a fresh session, and the log says how apart it is.
  writeFileSync(join(t.env.DONE_DONE_HOME, 'config.yaml'), 'agent: opencode\njudge:\n  route: answerer:opencode\n');
  const same = verify(right.env, 'home and settings render');
  assert.equal(same.code, 0, same.out);
  const sameLog = decode(readFileSync(join(t.env.DONE_DONE_HOME, 'runs', 'notes', toon(same).run_id, 'logs', 'judge.log'), 'utf8'));
  assert.equal(sameLog.independence, 'session-only');
});

test('verify with no journey: the author agent drives the verify skill feature, the judge passes it; a wrong claim parks at the gate until respond --action fix', () => {
  const t = setup('app: notes\nevidence:\n  root: .proof\n');
  const skill = join(t.repo, '.agents', 'skills', 'done-done-verify-notes');
  mkdirSync(join(skill, 'features'), { recursive: true });
  writeFileSync(join(skill, 'SKILL.md'), '---\nname: done-done-verify-notes\n---\n# done-done-verify-notes\n\n## Launch\n\nnode src/app.js\n');
  writeFileSync(join(skill, 'features', 'README.md'), '- [Add a note](add-note.md)\n');
  writeFileSync(join(skill, 'features', 'add-note.md'), '# Add a note\n');
  t.sh('add', '-A');
  t.sh('commit', '-qm', 'verify skill');
  mkdirSync(t.env.DONE_DONE_HOME, { recursive: true });
  writeFileSync(join(t.env.DONE_DONE_HOME, 'config.yaml'), `agent: claude\n${judgeYaml(t.env)}`);
  const verdict = (p) => JSON.stringify({ relevance: { probabilities: p, rationale: 'The list shows the note.', personReason: 'The list shows the note.', parts: [], covers: [] } });
  // claude is the author: it saves a capture into the run's evidence folder and answers; DRIVE=edit also edits a tracked file.
  const agents = (p) => {
    const s = stubAgents(t.env, verdict(p));
    symlinkSync(process.execPath, join(s.bin, 'node'));
    writeFileSync(join(s.bin, 'claude'), `#!${process.execPath}
const { appendFileSync, copyFileSync, readFileSync, writeFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
appendFileSync(${JSON.stringify(join(s.bin, 'calls.jsonl'))}, JSON.stringify({ agent: 'claude', argv: process.argv.slice(2), stdin: readFileSync(0, 'utf8'), cwd: process.cwd(), configDir: process.env.CLAUDE_CONFIG_DIR, shed: Object.hasOwn(process.env, 'DD_POOL_SHED'), evidence: process.env.DONE_DONE_EVIDENCE_ROOT, tmp: process.env.TMPDIR }) + '\\n');
if (process.env.DRIVE === 'text') writeFileSync(process.env.DONE_DONE_EVIDENCE_ROOT + '/count.json', JSON.stringify({ notes: 1 }));
else copyFileSync(${JSON.stringify(join(t.dir, 'screen.png'))}, process.env.DONE_DONE_EVIDENCE_ROOT + '/note.png');
writeFileSync(process.env.DONE_DONE_EVIDENCE_ROOT + '/steps.json', JSON.stringify({ ...${JSON.stringify(STEPS)}, result: process.env.DD_OUTCOME || 'x' }));
if (process.env.DRIVE === 'edit') appendFileSync('src/app.js', '// changed\\n');
if (process.env.DRIVE === 'log') writeFileSync(process.env.DONE_DONE_EVIDENCE_ROOT + '/session.bin', 'ok\\n');
if (process.env.DRIVE === 'switch') writeFileSync(process.env.DONE_DONE_HOME + '/config.yaml', 'agent: opencode\\njudge:\\n  route: answerer:opencode\\n');
if (process.env.DRIVE === 'probe') {
  const probes = [['respond', '--action', 'approve', '--reason', 'looks fine'], ['receipt', '--verify', 'HEAD'], ['verify', '--outcome', 'x']].map((argv) => {
    const r = spawnSync(process.execPath, [${JSON.stringify(CLI)}, ...argv], { encoding: 'utf8' });
    return { command: argv[0], status: r.status, out: r.stdout + r.stderr };
  });
  appendFileSync(${JSON.stringify(join(s.bin, 'calls.jsonl'))}, JSON.stringify({ probe: probes }) + '\\n');
}
process.stdout.write(JSON.stringify({ type: 'result', is_error: false, structured_output: { feature: 'features/add-note.md', captures: process.env.DRIVE === 'log' ? ['note.png', 'session.bin'] : process.env.DRIVE === 'text' ? ['count.json'] : ['note.png'], blocker: process.env.DRIVE === 'blocker' ? process.env.BLOCKER : '' } }));
`, { mode: 0o755 });
    return s;
  };
  const verify = (env, outcome, ...more) => {
    const r = spawnSync(process.execPath, [CLI, 'verify', '--outcome', outcome, '--foreground', ...more], { cwd: t.repo, env: { ...env, DD_OUTCOME: outcome }, encoding: 'utf8' });
    return { code: r.status, out: r.stdout + r.stderr, o: r.stdout.startsWith('command') ? toon({ out: r.stdout }) : undefined };
  };
  const right = agents(CORRECT);
  // With no agent set and no terminal to ask in, a drive stops and tells the caller to ask the user; it never picks one.
  writeFileSync(join(t.env.DONE_DONE_HOME, 'config.yaml'), '');
  const unset = verify(right.env, 'the note Umer added shows in the list');
  assert.equal(unset.code, 2, unset.out);
  assert.match(unset.out, /no agent is set: ask the user which agent to use/);
  assert.equal(right.calls().length, 0, 'no agent was started');
  const pick = join(t.dir, 'pick');
  writeFileSync(pick, `#!${process.execPath}\nconsole.log(${JSON.stringify(JSON.stringify({ ok: true, id: 'drive-test', set: { CLAUDE_CONFIG_DIR: t.dir }, unset: ['DD_POOL_SHED'] }))});\n`, { mode: 0o755 });
  delete right.env.CLAUDE_CONFIG_DIR;
  right.env.DD_POOL_SHED = 'synthetic';
  writeFileSync(join(t.env.DONE_DONE_HOME, 'config.yaml'), `agent: claude\njudge:\n  route: answerer:opencode\n  account_command: ${JSON.stringify(pick)}\n`);
  const ok = verify(right.env, 'the note Umer added shows in the list');
  assert.equal(ok.code, 0, ok.out);
  assert.deepEqual([ok.o.result, ok.o.journey, ok.o.feature, ok.o.author], ['pass', null, 'add-note', 'claude (model claude-haiku-5-5)']);
  assert.deepEqual(ok.o.steps.map((x) => [x.name, x.status]), [['resolve', 'completed'], ['drive', 'completed'], ['check', 'completed'], ['judge', 'completed'], ['gate', 'skipped'], ['receipt', 'completed'], ['report', 'completed']]);
  // The receipt keeps the feature the agent drove, so affected counts it as that feature's proof (no journey, no core: every feature).
  assert.equal(JSON.parse(readFileSync(join(t.repo, '.proof', '.done-done', 'receipts', `${t.head()}.json`), 'utf8')).runs[0].feature, 'add-note');
  const covered = t.dd('--json', 'affected');
  assert.equal(covered.code, 0, covered.out);
  assert.deepEqual(json(covered).features.map((f) => f.name), ['add-note']);
  const [drive, ...judged] = right.calls();
  assert.equal(drive.agent, 'claude');
  assert.equal(drive.configDir, t.dir, 'verify drives Claude on the configured pool account');
  assert.equal(drive.shed, false);
  assert.equal(drive.cwd, t.repo, 'the drive runs in the repo');
  assert.equal(drive.evidence, join(t.repo, '.proof', ok.o.run_id), "the drive gets the run's own evidence folder");
  const runDir = join(t.env.DONE_DONE_HOME, 'runs', 'notes', ok.o.run_id);
  assert.equal(drive.tmp, join(runDir, 'tmp'), "the drive's scratch is the run's own tmp folder");
  assert.deepEqual(drive.argv.slice(drive.argv.indexOf('--permission-mode')), ['--permission-mode', 'acceptEdits', '--allowedTools', 'Bash', '--add-dir', drive.evidence, '--add-dir', drive.tmp, '--effort', 'low'], 'edits only in the repo, the evidence folder and the run scratch, at the configured effort');
  assert.match(drive.stdin, /Never add steps or data to make the outcome look true/, 'the drive is told not to stage the claim');
  assert.match(drive.stdin, /a capture of an earlier step \(such as an empty or half-filled form, or text from before the outcome\) fails the drive: keep those in /, 'the drive saves only captures of the outcome, since the judge checks each against it');
  assert.match(drive.stdin, /for example \{"feature":"features\/<name>\.md","captures":\["<name>\.png"\],"blocker":""\}[\s\S]*"required":\["feature","captures","blocker"\]\}\nThat object holds your own values, never the schema itself/, 'the prompt shows an answer and ends on words, not the schema a weak model copies back');
  assert.match(drive.stdin, /Outcome to prove: the note Umer added shows in the list[\s\S]*done-done-verify-notes\/features\/add-note\.md/, 'the claim and the feature recipe go on stdin');
  assert.ok(!drive.argv.some((a) => a.includes('Umer added')), 'never in argv');
  assert.deepEqual([judged.length, judged[0].agent], [1, 'opencode'], 'one capture, judged by another agent');
  assert.ok(!judged[0].file.includes('done-done-verify-notes'), 'the judge sees the claim and the capture, not the recipe or the drive');
  assert.equal(JSON.parse(readFileSync(join(runDir, 'agents', 'drive.json'), 'utf8')).ok, true, 'the drive call leaves a record');
  assert.equal(t.dd('receipt', '--verify', t.head()).code, 0);
  writeFileSync(join(t.env.DONE_DONE_HOME, 'config.yaml'), 'agent: claude\njudge:\n  route: answerer:opencode\n');
  // A wrong claim parks at the gate; approve never moves it past its judge, fix ends the run fail, and skip ends it fail too.
  const wrong = agents({ correct: 0.04, wrong: 0.93, unclear: 0.03 });
  const bad = verify(wrong.env, 'the note list is sorted by date');
  assert.equal(bad.code, 4, bad.out);
  assert.deepEqual([bad.o.status, bad.o.step, bad.o.findings.length], ['awaiting_approval', 'gate', 1]);
  const approve = t.dd('respond', '--action', 'approve', '--reason', 'the sort is checked by hand');
  assert.equal(approve.code, 2, approve.out);
  assert.match(toon(approve).error, new RegExp(`run ${bad.o.run_id} is at its judge gate, which takes only --action fix or skip`), 'respond answers the newest run by default');
  const fix = t.dd('respond', '--action', 'fix');
  assert.equal(fix.code, 1, fix.out);
  assert.deepEqual([toon(fix).run_id, toon(fix).result, toon(fix).steps.find((x) => x.name === 'gate').status], [bad.o.run_id, 'fail', 'failed']);
  // skip ends the run fail as well, without the fix.
  const skipped = verify(wrong.env, 'the note list is sorted by date');
  const skip = t.dd('respond', '--run', skipped.o.run_id, '--action', 'skip', '--reason', 'the sort is checked by hand');
  assert.equal(skip.code, 1, skip.out);
  assert.deepEqual([toon(skip).result, toon(skip).response.action], ['fail', 'skip']);
  // abort cancels a parked run; neither can be answered again.
  const abortRun = verify(wrong.env, 'the note list is sorted by date');
  assert.equal(t.dd('abort', '--run', abortRun.o.run_id).code, 0);
  assert.equal(toon(t.dd('status', '--run', abortRun.o.run_id)).status, 'cancelled');
  assert.equal(t.dd('respond', '--run', abortRun.o.run_id, '--action', 'fix').code, 2);
  // With DONE_DONE_DRIVE set, the commands that answer a gate, write a receipt or start a run exit 2 (an accidental call, not a sandbox).
  const probe = verify({ ...right.env, DRIVE: 'probe' }, 'the note Umer added shows in the list');
  assert.equal(probe.code, 0, probe.out);
  const probed = right.calls().find((c) => c.probe).probe;
  assert.deepEqual(probed.map((p) => [p.command, p.status]), [['respond', 2], ['receipt', 2], ['verify', 2]]);
  assert.match(probed[0].out, /respond refuses to run inside an agent drive \(DONE_DONE_DRIVE is set\), so the agent does not answer its own gate, write a receipt or start a run by accident; this guards against accidents and is not a sandbox/);
  // The judge is apart from the author the run recorded, even when the config names another agent during the drive.
  const seen = right.calls().length;
  const switched = verify({ ...right.env, DRIVE: 'switch' }, 'the note Umer added shows in the list after a switch');
  writeFileSync(join(t.env.DONE_DONE_HOME, 'config.yaml'), 'agent: claude\njudge:\n  route: answerer:opencode\n');
  assert.equal(switched.code, 0, switched.out);
  assert.deepEqual(right.calls().slice(seen + 1).map((c) => c.agent), ['opencode'], 'the judge is not the drive agent claude');
  // A drive whose only capture is text (a CLI's JSON output) passes on the judge's pass, the text sent with no attachment.
  const texted = verify({ ...right.env, DRIVE: 'text' }, 'the notes CLI reports the one note Umer added');
  assert.equal(texted.code, 0, texted.out);
  assert.deepEqual([right.calls().at(-1).agent, right.calls().at(-1).attached], ['opencode', []]);
  // A capture the judge cannot read is not covered by the judge's pass on the others: the run parks at the gate.
  const logged = verify({ ...right.env, DRIVE: 'log' }, 'the note Umer added shows in the list');
  assert.equal(logged.code, 4, logged.out);
  assert.deepEqual([logged.o.status, logged.o.step, logged.o.findings.length], ['awaiting_approval', 'gate', 1]);
  assert.match(logged.o.findings[0].what, /session\.bin: the judge did not read this capture/);
  // While that run waits at its gate, a new verify or a rerun of the same claim is refused: it would go around the gate.
  const calls = right.calls().length;
  for (const again of [verify(right.env, 'the note Umer added shows in the list'), spawnSync(process.execPath, [CLI, 'rerun', '--run', logged.o.run_id], { cwd: t.repo, env: right.env, encoding: 'utf8' })]) {
    const out = again.out ?? again.stdout;
    assert.equal(again.code ?? again.status, 2, out);
    assert.match(out, new RegExp(`run ${logged.o.run_id} waiting at its gate`));
    assert.match(out, new RegExp(`done-done respond --run ${logged.o.run_id} --action fix .*done-done abort --run ${logged.o.run_id}`));
  }
  // A rerun keeps the claim of its source run, so switching branches does not get around the gate.
  t.sh('checkout', '-qb', 'other');
  const switchedRerun = spawnSync(process.execPath, [CLI, 'rerun', '--run', logged.o.run_id], { cwd: t.repo, env: right.env, encoding: 'utf8' });
  assert.equal(switchedRerun.status, 2, switchedRerun.stdout);
  assert.match(switchedRerun.stdout, new RegExp(`run ${logged.o.run_id} waiting at its gate`));
  t.sh('checkout', '-q', 'main');
  assert.equal(right.calls().length, calls, 'no agent was started');
  // A run recorded before branches were stored (no branch, no claim id) still blocks a new run in its repo.
  const parkedFile = join(t.env.DONE_DONE_HOME, 'runs', 'notes', logged.o.run_id, 'run.json');
  writeFileSync(parkedFile, JSON.stringify({ ...JSON.parse(readFileSync(parkedFile, 'utf8')), branch: undefined }));
  const legacy = verify(right.env, 'the note Umer added shows in the list');
  assert.equal(legacy.code, 2, legacy.out);
  assert.match(legacy.out, new RegExp(`run ${logged.o.run_id} waiting at its gate`));
  assert.equal(right.calls().length, calls, 'no agent was started');
  assert.equal(t.dd('respond', '--run', logged.o.run_id, '--action', 'fix').code, 1);
  // A run record that cannot be parsed stops the command with the file to fix, never a stack trace.
  const brokenRun = join(t.env.DONE_DONE_HOME, 'runs', 'notes', 'broken-run');
  mkdirSync(brokenRun);
  writeFileSync(join(brokenRun, 'run.json'), '{');
  const unreadable = t.dd('history');
  assert.equal(unreadable.code, 2, unreadable.out);
  assert.match(toon(unreadable).error, /cannot read the run record .*broken-run\/run\.json/);
  assert.match(toon(unreadable).help[0], /Fix or remove .*broken-run/);
  rmSync(brokenRun, { recursive: true });
  // A drive that changes a tracked file fails: its captures would not be of the committed code.
  const edit = verify({ ...right.env, DRIVE: 'edit' }, 'the note Umer added shows in the list');
  assert.equal(edit.code, 1, edit.out);
  assert.match(edit.o.reason, /^drive: claude changed tracked files in the repo during the drive/);
  t.sh('checkout', '--', 'src/app.js');
  // A tracked file already modified before the drive is checked by content: a further edit to it fails the drive too.
  writeFileSync(join(t.repo, '.done-done.yaml'), 'app: notes\nevidence:\n  root: .proof\n  allow_dirty: true\n');
  appendFileSync(join(t.repo, 'src/app.js'), '// wip\n');
  const wip = verify({ ...right.env, DRIVE: 'edit' }, 'the note Umer added shows in the list');
  assert.equal(wip.code, 1, wip.out);
  assert.match(wip.o.reason, /^drive: claude changed tracked files in the repo during the drive/);
  t.sh('checkout', '--', 'src/app.js', '.done-done.yaml');
  const secret = 'API_' + 'TOKEN=' + 'f4ke0'.repeat(6);
  const blocked = verify({ ...right.env, DRIVE: 'blocker', BLOCKER: `login rejected ${secret}` }, 'the note Umer added shows in the list');
  assert.match(blocked.o.reason, /^drive: secrets: .*holds a secret \(key-value\)/);
  const status = spawnSync(process.execPath, [CLI, 'status', '--run', blocked.o.run_id], { cwd: t.repo, env: right.env, encoding: 'utf8' });
  assert.equal([blocked.out, status.stdout + status.stderr].some((o) => o.includes(secret)), false, 'the blocker secret is never printed');
  // Usage errors before any run: an unknown feature, a journey with --feature, no verify skill.
  assert.match(toon(verify(right.env, 'x', '--feature', 'nope')).error, /no feature nope in \.agents\/skills\/done-done-verify-notes\/features; it has: add-note/);
  rmSync(skill, { recursive: true });
  const none = verify(right.env, 'x');
  assert.equal(none.code, 2, none.out);
  assert.match(toon(none).error, /needs a journey or a verify skill/);
});

// The sign-off handoff: with the opt-in, one claim traces to one run, its captures and its card on the board, and the
// board's answer comes back to that run. Without the opt-in done-done only writes the message: nothing is posted.
test('signoff --post puts the run on the sign-off board and feeds the answer back to the run; without the opt-in nothing is posted', { skip: spawnSync('sign-off-axi', ['--version']).error && 'sign-off-axi not installed' }, async () => {
  const t = setup();
  // The judge is unsure, so the run parks at its gate: the board card is a gate, and its answer acts on the run.
  writeFileSync(join(t.env.DONE_DONE_HOME, 'config.yaml'), JUDGE_CONFIG(stubJudge(t.dir, { correct: 0.05, wrong: 0.05, unclear: 0.9 })));
  const run = t.dd('verify', 'shots', '--outcome', 'home and settings render', '--foreground');
  assert.deepEqual([run.code, toon(run).status], [4, 'awaiting_approval'], run.out);
  const id = toon(run).run_id;
  const board = join(t.dir, 'board.json');

  // Without the opt-in the message is written and nothing is posted: there is no board at all.
  const plain = t.dd('signoff');
  assert.equal(plain.code, 0, plain.out);
  assert.match(toon(plain).help[0], /^Post it to the sign-off board with sign-off-axi \(done-done prepares the run; sign-off-axi posts\)/);
  assert.equal(existsSync(board), false, 'done-done posted nothing without the opt-in');

  // With the opt-in the card is on the board, and the run records the card it posted.
  const posted = t.dd('signoff', '--post', '--board', board);
  assert.equal(posted.code, 0, posted.out);
  assert.equal(toon(posted).card.key, `dd-gate-${id}`);
  const items = JSON.parse(readFileSync(board, 'utf8')).items;
  assert.deepEqual([items.length, items[0].key, items[0].kind], [1, `dd-gate-${id}`, 'gate']);
  assert.deepEqual(items[0].options.map((o) => o.value), ['fix', 'skip'], 'the card offers the actions respond takes');
  assert.equal(toon(t.dd('status', '--run', id)).signoff.key, `dd-gate-${id}`, 'the run shows the card it posted');

  // The person answers the card on the board, the way the browser does, and the answer comes back to the same run.
  const served = serveBoard(board);
  after(() => served.stop());
  const answered = await fetch(`${await served.url}api/answers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: `dd-gate-${id}`, answer: 'fix', note: 'the screen is wrong' }) });
  assert.equal(answered.status, 200);
  const waited = t.dd('signoff', '--wait', '--run', id);
  assert.equal(waited.code, 1, waited.out);
  assert.equal(toon(waited).answer.value, 'fix');
  const ended = toon(t.dd('status', '--run', id));
  assert.deepEqual([ended.status, ended.result, ended.response.action], ['completed', 'fail', 'fix'], ended.out);
  assert.match(ended.reason, /chose fix: the screen is wrong/);
  assert.equal(ended.signoff.answer.value, 'fix');
  assert.equal(ended.signoff.key, `dd-gate-${id}`, 'the card the answer came from is on the run');
});

// A pi that lists claude-bridge models only when its bridge extension is loaded, as pi does under --no-extensions:
// the judge's own call must load that one extension, or pi says the model is not found.
function stubPiBridge(env, answer) {
  const log = join(env.PATH, 'calls.jsonl');
  writeFileSync(join(env.PATH, 'pi'), `#!${process.execPath}
const { appendFileSync, readFileSync } = require('node:fs');
const argv = process.argv.slice(2);
const stdin = readFileSync(0, 'utf8');
const raw = JSON.parse(${JSON.stringify(answer)});
const keys = [...new Set([...stdin.matchAll(/capture_\\d+/g)].map((m) => m[0]))];
const value = keys.length && raw.relevance ? Object.fromEntries(keys.map((k) => [k, raw.relevance])) : raw;
const attached = argv.filter((a) => a.startsWith('@')).map((a) => readFileSync(a.slice(1)).subarray(1, 4).toString());
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ agent: 'pi', argv, stdin, attached, cwd: process.cwd() }) + '\\n');
const model = argv[argv.indexOf('--model') + 1] ?? '';
if (model.startsWith('claude-bridge/') && !argv.includes('npm:pi-claude-bridge')) {
  console.log(JSON.stringify({ type: 'error', error: { message: 'Model "' + model + '" not found' } }));
  process.exit(1);
}
for (const t of ['session', 'agent_start', 'turn_start']) console.log(JSON.stringify({ type: t }));
console.log(JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: JSON.stringify(value) }] } }));
// pi streams the whole transcript at the end, so a judge asked about rate limits sees those words on stdout: not a limit of its own.
console.log(JSON.stringify({ type: 'agent_end', messages: [{ role: 'user', content: stdin.slice(0, 4000) }, { role: 'assistant', content: [{ type: 'text', text: 'The capture reports a rate limit; nothing was retried.' }] }] }));
`, { mode: 0o755 });
}

test('a key-only user judges through openai:key: the key goes only to the kit, a right screen passes, a wrong one fails', () => {
  const t = setup();
  mkdirSync(t.env.DONE_DONE_HOME, { recursive: true });
  writeFileSync(join(t.env.DONE_DONE_HOME, 'config.yaml'), 'agent: claude\njudge:\n  route: openai:key\n  model: vision-test-1\n');
  // No agent CLI on PATH; the network is stubbed at fetch, the kit's only way out, and answers with STUB_VERDICT.
  const env = pathEnv(t.env, ['ffprobe']);
  symlinkSync(process.execPath, join(env.PATH, 'node'));
  const log = join(env.PATH, 'requests.jsonl');
  const stub = join(env.PATH, 'fetch-stub.mjs');
  writeFileSync(stub, `import { appendFileSync } from 'node:fs';
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  appendFileSync(${JSON.stringify(log)}, JSON.stringify({ url: String(url), auth: init.headers.authorization, model: body.model, input: JSON.stringify(body.input) }) + '\\n');
  if (process.env.STUB_VERDICT === '401') return new Response('{"error":{"message":"Incorrect API key"}}', { status: 401 });
  const probabilities = JSON.parse(process.env.STUB_VERDICT);
  const pick = Object.keys(probabilities).sort((a, b) => probabilities[b] - probabilities[a])[0];
  const text = JSON.stringify({ relevance: { probabilities, pick, rationale: 'The list shows the notes.', personReason: 'The list shows the notes.', parts: [], covers: [] } });
  return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
};
`);
  const key = 'sk-test-not-a-real-key';
  const withKey = (p) => ({ ...env, OPENAI_API_KEY: key, NODE_OPTIONS: `--import=${pathToFileURL(stub)}`, STUB_VERDICT: typeof p === 'string' ? p : JSON.stringify(p) });
  const verify = (e, outcome) => {
    const r = spawnSync(process.execPath, [CLI, 'verify', 'shots', '--outcome', outcome, '--foreground'], { cwd: t.repo, env: { ...e, DD_OUTCOME: outcome }, encoding: 'utf8' });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  const requests = () => readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const ok = verify(withKey(CORRECT), 'home and settings render');
  assert.equal(ok.code, 0, ok.out);
  assert.equal(requests().length, 2, 'one request per capture');
  assert.ok(requests().every((r) => r.url === 'https://api.openai.com/v1/responses' && r.auth === `Bearer ${key}` && r.model === 'vision-test-1'));
  assert.ok(requests().every((r) => r.input.includes('data:image/png;base64,') && r.input.includes('home and settings render') && !r.input.includes('.proof')), 'the capture and the outcome, never a path');
  const runDir = join(t.env.DONE_DONE_HOME, 'runs', 'notes', toon(ok).run_id);
  const judgeLog = decode(readFileSync(join(runDir, 'logs', 'judge.log'), 'utf8'));
  assert.deepEqual([judgeLog.route, judgeLog.model, judgeLog.independence, judgeLog.author], ['openai:key', 'vision-test-1', 'agent', 'claude (model claude-haiku-5-5)']);
  const v = t.dd('receipt', '--verify', t.head());
  assert.deepEqual([toon(v).schema, toon(v).judge.route, toon(v).judge.verdicts.map((x) => x.verdict)], [2, 'openai:key', ['pass', 'pass']]);
  // A wrong screen parks the run at the gate (exit 4), not a fail.
  const bad = verify(withKey({ correct: 0.04, wrong: 0.93, unclear: 0.03 }), 'the settings page shows dark mode on');
  assert.equal(bad.code, 4, bad.out);
  assert.equal(toon(bad).status, 'awaiting_approval');
  assert.match(toon(bad).findings[0].what, /judge says wrong screen/);
  assert.equal(t.dd('respond', '--run', toon(bad).run_id, '--action', 'fix').code, 1);
  // A refused key gives no verdict: the run stops at its judge step (exit 2), and the reason names the real cause and where the key comes from.
  const refused = verify(withKey('401'), 'the home screen shows the sync banner');
  assert.equal(refused.code, 2, refused.out);
  assert.deepEqual([toon(refused).status, toon(refused).result], ['failed', undefined]);
  assert.match(toon(refused).reason, /^judge: the judge did not answer: http 401 \(check judge\.model vision-test-1 and the key in OPENAI_API_KEY\)/);
  assert.equal(spawnSync('grep', ['-rl', key, t.env.DONE_DONE_HOME, t.repo], { encoding: 'utf8' }).stdout, '', 'the key is written nowhere');
  // Doctor names a missing key and a missing model with their fixes, and never calls the model.
  const doctorEnv = { ...env, OPENAI_API_KEY: '' };
  const judgeRow = toon(doctorIn(t.repo, doctorEnv, 'doctor')).checks.find((c) => c.check === 'judge');
  assert.deepEqual([judgeRow.status, judgeRow.detail, judgeRow.fix], ['missing', 'judge: openai:key needs your own API key in OPENAI_API_KEY, which is not set', 'Export OPENAI_API_KEY with your key, or list it in the file judge.env_file names, then re-run this command']);
  assert.match(toon(doctorIn(t.repo, { ...env, OPENAI_API_KEY: key }, 'doctor')).checks.find((c) => c.check === 'judge').detail, /^openai:key \(model vision-test-1\): OPENAI_API_KEY is set and the judge kit is present; doctor does not call the model$/);
  writeFileSync(join(t.env.DONE_DONE_HOME, 'config.yaml'), 'agent: claude\njudge:\n  route: openai:key\n');
  const noModel = toon(doctorIn(t.repo, doctorEnv, 'doctor')).checks.find((c) => c.check === 'judge_choice');
  assert.deepEqual([noModel.status, noModel.detail], ['missing', 'judge: judge.route openai:key needs judge.model, a model your key can use that reads images']);
  writeFileSync(join(env.PATH, 'codex'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(t.env.DONE_DONE_HOME, 'config.yaml'), 'agent: codex\nagent_config:\n  codex:\n    model: vision-test-1\njudge:\n  route: openai:key\n  model: vision-test-1\n');
  const sameModel = toon(doctorIn(t.repo, { ...env, OPENAI_API_KEY: key }, 'doctor')).checks.find((c) => c.check === 'judge_choice');
  // The user's own model as the judge runs: doctor shows how apart it is and never asks for another.
  assert.deepEqual([sameModel.status, sameModel.fix], ['ok', '']);
  assert.match(sameModel.detail, /the author's agent and model in a fresh session/);
});

test('init --judge saves the user\'s judge, the author\'s own agent and model too, and refuses one done-done cannot judge through', () => {
  const t = setup(JUDGED);
  mkdirSync(t.env.DONE_DONE_HOME, { recursive: true });
  writeFileSync(join(t.env.DONE_DONE_HOME, 'config.yaml'), 'agent: opencode\n');
  keepSkill(t.repo, 'notes');
  const bad = t.dd('init', '--judge', 'acp:gemini');
  assert.equal(bad.code, 2, bad.out);
  assert.match(toon(bad).error, /^done-done cannot judge through acp:gemini; it judges through claude, opencode, pi, gemini$/);
  assert.equal(parse(readFileSync(join(t.env.DONE_DONE_HOME, 'config.yaml'), 'utf8')).judge, undefined, 'a refused judge writes nothing');
  // The author's own agent and model is the user's choice, so it is saved as asked.
  const same = t.dd('init', '--judge', 'opencode', '--judge-model', 'opencode-go/muse-spark-1.3-contributor');
  assert.equal(same.code, 0, same.out);
  assert.equal(toon(same).judge, `answerer:opencode (model opencode-go/muse-spark-1.3-contributor) saved to ${join(t.env.DONE_DONE_HOME, 'config.yaml')}`);
  assert.equal(toon(t.dd('init', '--judge-model', 'x')).error, '--judge-model needs --judge');
  // The author's agent at another model is saved too, as answerer:opencode.
  const other = t.dd('init', '--judge', 'opencode', '--judge-model', 'opencode-go/other-model');
  assert.equal(toon(other).judge, `answerer:opencode (model opencode-go/other-model) saved to ${join(t.env.DONE_DONE_HOME, 'config.yaml')}`);
  assert.equal(toon(t.dd('init')).judge, 'unchanged (answerer:opencode)');
  // The route form the check docs use saves the same canonical route as the bare agent name.
  const routed = t.dd('init', '--judge', 'answerer:pi', '--judge-model', 'openai-codex/gpt-6-luna');
  assert.equal(routed.code, 0, routed.out);
  assert.equal(toon(routed).judge, `answerer:pi (model openai-codex/gpt-6-luna) saved to ${join(t.env.DONE_DONE_HOME, 'config.yaml')}`);
  assert.deepEqual(parse(readFileSync(join(t.env.DONE_DONE_HOME, 'config.yaml'), 'utf8')).judge, { route: 'answerer:pi', model: 'openai-codex/gpt-6-luna' });
  // Only a form done-done really judges through is taken: an alias that names no route stays an error.
  const misrouted = t.dd('init', '--judge', 'answerer:claude');
  assert.equal(misrouted.code, 2, misrouted.out);
  assert.match(toon(misrouted).error, /^done-done cannot judge through answerer:claude; it judges through /);
});

// The design check: the same judge looks at each screen for visual defects, one tools-off request per screen.
test('design fails a screen on each defect the judge names, alone or next to its mock, and passes a clean one', () => {
  const t = setup();
  mkdirSync(t.env.DONE_DONE_HOME, { recursive: true });
  writeFileSync(join(t.env.DONE_DONE_HOME, 'config.yaml'), 'agent: claude\njudge:\n  route: answerer:opencode\n');
  writeFileSync(join(t.dir, 'mock.png'), screen(3));
  writeFileSync(join(t.dir, 'blank.png'), blank());
  const kinds = ['aspect', 'clipped-text', 'overlap', 'off-screen', 'blank-strip', 'squashed-text', 'layout'];
  const answer = (flagged = {}) => JSON.stringify(Object.fromEntries(kinds.map((k) => [k, { probabilities: flagged[k] ?? { defect: 0.03, none: 0.97 }, rationale: 'Looked.', personReason: flagged[k] ? `${k} at the header, top left` : 'Nothing of this kind.' }])));
  // Run from outside any repo, as a project's own capture step might.
  const design = (reply, ...args) => {
    const s = stubAgents(t.env, reply);
    symlinkSync(process.execPath, join(s.bin, 'node'));
    const r = spawnSync(process.execPath, [CLI, 'design', ...args], { cwd: t.dir, env: s.env, encoding: 'utf8' });
    return { code: r.status, out: r.stdout + r.stderr, calls: s.calls() };
  };
  const bad = design(answer({ aspect: { defect: 0.9, none: 0.1 }, 'blank-strip': { defect: 0.85, none: 0.15 } }), 'screen.png', 'screen2.png', '--mock', 'screen.png=mock.png');
  assert.equal(bad.code, 1, bad.out);
  const b = toon(bad);
  assert.equal(b.result, 'fail');
  assert.deepEqual([b.judge.route, b.judge.model, b.judge.independence, b.judge.author], ['answerer:opencode', 'opencode-go/muse-spark-1.3-contributor', 'agent', 'claude (model claude-haiku-5-5)']);
  assert.deepEqual(b.screens.map((s) => [s.path, s.verdict, s.mock ?? null]), [['screen.png', 'fail', 'mock.png'], ['screen2.png', 'fail', null]]);
  assert.deepEqual(b.screens[0].defects, [{ kind: 'aspect', where: 'aspect at the header, top left' }, { kind: 'blank-strip', where: 'blank-strip at the header, top left' }]);
  assert.match(b.help[0], /^Fix each defect named above, .*done-done design screen\.png screen2\.png --mock screen\.png=mock\.png$/);
  assert.equal(bad.calls.length, 2, 'one tools-off request per screen');
  assert.deepEqual(bad.calls.map((c) => c.attached), [['PNG', 'PNG'], ['PNG']], 'a screen with a mock sends both images; one without, the screen alone');
  assert.ok(bad.calls.every((c) => JSON.parse(c.permission)['*'] === 'deny' && !/screen2?\.png|mock\.png/.test(c.file) && !c.file.includes(t.dir)), 'every tool is denied, and no path reaches the prompt');
  assert.match(bad.calls[0].file, /"mock"/);
  assert.doesNotMatch(bad.calls[1].file, /"mock"/);
  const ok = design(answer(), 'screen.png');
  assert.equal(ok.code, 0, ok.out);
  assert.deepEqual([toon(ok).result, toon(ok).screens[0].verdict, toon(ok).screens[0].defects], ['pass', 'pass', []]);
  // The same input gets the same verdict: a re-run asks no model, whatever it would answer now; a new mock is a new input.
  const again = design(answer({ layout: { defect: 0.9, none: 0.1 } }), 'screen.png', 'screen2.png', '--mock', 'screen.png=mock.png');
  assert.deepEqual(toon(again).screens.map((s) => [s.path, s.verdict, s.cached ?? false]), [['screen.png', 'fail', true], ['screen2.png', 'fail', true]]);
  assert.equal(again.calls.length, 0, 'both answers come from the cache');
  assert.deepEqual(toon(again).screens[0].defects, b.screens[0].defects);
  writeFileSync(join(t.dir, 'mock2.png'), screen(5));
  assert.equal(design(answer(), 'screen.png', '--mock', 'screen.png=mock2.png').calls.length, 1);
  writeFileSync(join(t.dir, 'screen3.png'), screen(11));
  const unsure = design(answer({ layout: { defect: 0.5, none: 0.5 } }), 'screen3.png');
  assert.equal(unsure.code, 3, unsure.out);
  assert.match(toon(unsure).screens[0].reason, /^not confident enough about layout$/);
  writeFileSync(join(t.env.DONE_DONE_HOME, 'config.yaml'), 'agent: claude\njudge:\n  route: answerer:opencode\n  floor: 0.99\n');
  const strict = design(answer(), 'screen3.png');
  assert.equal(strict.code, 3, strict.out);
  assert.match(toon(strict).screens[0].reason, /not confident enough about aspect/);
  writeFileSync(join(t.env.DONE_DONE_HOME, 'config.yaml'), 'agent: claude\njudge:\n  route: answerer:opencode\n');
  const empty = design(answer(), 'blank.png');
  assert.equal(empty.code, 2, empty.out);
  assert.equal(toon(empty).error, 'design: blank.png: png is a blank frame (luminance spread 0.0000), so it cannot be sent to the judge');
  assert.equal(empty.calls.length, 0, 'a blank frame stops with its cause and no verdict');
  assert.equal(design(answer(), '--mock', 'screen.png').code, 2);
  assert.match(toon(design(answer(), 'gone.png')).error, /gone\.png: cannot read \(ENOENT\)/);
  writeFileSync(join(t.env.DONE_DONE_HOME, 'config.yaml'), 'judge:\n  route: answerer:opencode\n'); const judgeOnly = design(answer(), 'screen.png');
  assert.equal(judgeOnly.code, 0, judgeOnly.out); assert.equal(toon(judgeOnly).judge.author, 'no agent set');
});

test('design gives the judge a blank strip it measured along an edge, but not a nav rail with icons; a uniform frame stops before the judge', () => {
  const t = setup();
  mkdirSync(t.env.DONE_DONE_HOME, { recursive: true });
  writeFileSync(join(t.env.DONE_DONE_HOME, 'config.yaml'), 'agent: claude\njudge:\n  route: answerer:opencode\n');
  // A light screen with a few dark text lines; the judge stub says every kind is clean, so only the pixels can fail it.
  const light = [245, 240, 230];
  const text = (x, y) => x >= 60 && x < 220 && y % 30 >= 10 && y % 30 < 16;
  writeFileSync(join(t.dir, 'strip.png'), png(240, 160, (x, y) => (x < 24 ? [20, 22, 20] : text(x, y) ? [40, 40, 40] : light)));
  writeFileSync(join(t.dir, 'rail.png'), png(240, 160, (x, y) => (x < 48 ? (x >= 14 && x < 34 && y % 40 >= 10 && y % 40 < 30 ? [220, 220, 220] : [30, 30, 36]) : text(x, y) ? [40, 40, 40] : light)));
  writeFileSync(join(t.dir, 'uniform.png'), png(240, 160, () => [20, 22, 20]));
  const clean = JSON.stringify(Object.fromEntries(['aspect', 'clipped-text', 'overlap', 'off-screen', 'blank-strip', 'squashed-text', 'layout'].map((k) => [k, { probabilities: { defect: 0.02, none: 0.98 }, rationale: 'Looked.', personReason: 'Nothing of this kind.' }])));
  const s = stubAgents(t.env, clean);
  symlinkSync(process.execPath, join(s.bin, 'node'));
  // The measurement goes to the judge as input; the verdict is the judge's alone.
  const design = (...args) => {
    const r = spawnSync(process.execPath, [CLI, 'design', '--full', ...args], { cwd: t.dir, env: s.env, encoding: 'utf8' });
    return { code: r.status, out: r.stdout + r.stderr, sent: s.calls().at(-1)?.file ?? '' };
  };
  const strip = design('strip.png');
  assert.equal(strip.code, 0, strip.out);
  assert.ok(strip.sent.includes('measured_from_pixels') && strip.sent.includes('left edge: a plain #141614 band 24 px deep (10% of the width), full height, with nothing in it'), strip.sent);
  const rail = design('rail.png');
  assert.equal(rail.code, 0, rail.out);
  assert.ok(!rail.sent.includes('measured_from_pixels'), 'a dark rail that holds icons is content, not a strip');
  const calls = s.calls().length;
  const uniform = design('uniform.png');
  assert.equal(uniform.code, 2, uniform.out);
  assert.match(toon(uniform).error, /^design: uniform\.png: png is a blank frame/);
  assert.equal(s.calls().length, calls, 'a whole uniform screen is the blank-frame check, with no request');
});

// doctor: read-only health check. Required items (git, config, evidence root, agent, judge) gate
// exit 0/2; the verify skill, ffprobe and warning rows never fail it.
// An isolated PATH holding only git plus the named stub binaries, so agent/judge/ffprobe
// detection never depends on what the host happens to have installed.
function pathEnv(env, bins) {
  const gitPath = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  const dir = mkdtempSync(join(tmpdir(), 'done-done-doctor-path-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  symlinkSync(gitPath, join(dir, 'git'));
  // A claude stub is signed in: auto judges only a claude whose `auth status` says it is logged in.
  for (const b of bins) writeFileSync(join(dir, b), `#!/bin/sh\ncase "$*" in *auth*) echo '{"loggedIn":true}' ;; esac\nexit 0\n`, { mode: 0o755 });
  return { ...env, PATH: dir };
}

const doctorIn = (cwd, env, ...args) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
};

// The sign-off board on a temporary file, served the way the person answers it: the same HTTP call the browser makes.
// The board is never a real one: it lives in the test's own temp folder and dies with the test.
function serveBoard(board) {
  const child = spawn('sign-off-axi', ['serve', board, '--port', '0'], { encoding: 'utf8' });
  const url = new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
      const m = out.match(/^url:\s*"([^"]+)"/m);
      if (m) resolve(m[1]);
    });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', reject);
    setTimeout(() => reject(new Error(`the board did not start: ${out}`)), 20000).unref();
  });
  return { url, stop: () => child.kill('SIGTERM') };
}

test('doctor passes in a set-up repo and lists every check', () => {
  const { repo, env } = setup();
  mkdirSync(env.DONE_DONE_HOME, { recursive: true });
  writeFileSync(join(env.DONE_DONE_HOME, 'config.yaml'), `agent: claude\n${judgeYaml(env)}`);
  // doctor requires the agent it is given, so the PATH is the isolated stub one: no host claude, judge, or ffprobe leaks in.
  const stubs = pathEnv(env, ['claude']);
  const r = doctorIn(repo, stubs, 'doctor');
  assert.equal(r.code, 0, r.out);
  const d = toon(r);
  assert.equal(d.result, 'pass');
  assert.deepEqual(d.checks.map((c) => c.check), ['git', 'config', 'evidence_root', 'verify_skill', 'agent', 'judge', 'ffprobe', 'judge_choice', 'agent_settings', 'real_product', 'core_journey', 'upgrade_journey']);
  assert.deepEqual(d.checks.at(-3), { check: 'real_product', status: 'ok', detail: 'shots drives the product', fix: '' });
  assert.deepEqual(d.checks.at(-2), { check: 'core_journey', status: 'ok', detail: 'journey shots is the core user journey', fix: '' });
  assert.equal(d.checks.at(-1).status, 'ok', 'an app that ships no installable artifact needs no upgrade journey');
  assert.deepEqual(d.checks.slice(0, 3).map((c) => c.status), ['ok', 'ok', 'ok']);
  assert.match(d.checks[1].detail, /app notes/);
  assert.equal(d.checks[3].status, 'missing', 'no verify skill yet, and that is optional');
  assert.match(d.checks[3].fix, /SKILL\.md/);
  assert.ok(d.help.length >= 1);
  const j = json(doctorIn(repo, stubs, 'doctor', '--json'));
  assert.equal(j.result, 'pass');
  assert.equal(j.checks.length, 12);
  // A code-only journey beside a real one is a warning: doctor still passes.
  const check = '\n  check:\n    command: yarn run check > $DONE_DONE_EVIDENCE_ROOT/check.log 2>&1\n';
  writeFileSync(join(repo, '.done-done.yaml'), `${JUDGED}${check}`);
  const mixed = json(doctorIn(repo, stubs, 'doctor', '--json'));
  assert.equal(mixed.result, 'pass');
  assert.equal(mixed.checks.at(-3).status, 'warning');
  assert.match(mixed.checks.at(-3).detail, /^check is code-only .*; shots drives the product$/);
  assert.equal(mixed.checks.at(-3).fix, 'Cite captures from the journeys that drive the product; delete check from .done-done.yaml if it is not needed');
  // Only code-only journeys (the shipped-broken-APK config): the row is missing and doctor fails with the fix command.
  writeFileSync(join(repo, '.done-done.yaml'), `app: notes\njourneys:${check}  types:\n    command: npx tsc --noEmit && npm test\n`);
  const code = doctorIn(repo, stubs, 'doctor', '--json');
  assert.equal(code.code, 2, code.out);
  const row = JSON.parse(code.out).checks.at(-3);
  assert.equal(row.status, 'missing');
  assert.match(row.detail, /every journey in \.done-done\.yaml is code-only \(check, types\)/);
  assert.match(row.fix, /done-done init --journey <name> -- '<command>'; then delete check, types from \.done-done\.yaml/);
});

// The one-install gap: a freshly configured repo has no core journey yet, so plain doctor exits 2 and an installer cannot
// tell a broken install from an unfinished one. --setup is install health: the journey rows are skipped, not failed.
test('doctor --setup passes a fresh install with no core journey, and still fails without the agent or the judge', () => {
  const { repo, env } = shapeRepo('proof', 'notes');
  const s = stubAgents(env, scaffoldAnswer());
  const global = join(env.DONE_DONE_HOME, 'config.yaml');
  // What an installer does: config and settings in one non-interactive call, no verify skill.
  const init = doctorIn(repo, s.env, 'init', '--no-skill', '--agent', 'claude', '--model', 'stub-model', '--judge', 'answerer:opencode', '--judge-model', 'opencode-go/x');
  assert.equal(init.code, 0, init.out);
  // A fresh install records no journey yet.
  writeFileSync(join(repo, '.done-done.yaml'), 'app: notes\n');
  const r = doctorIn(repo, s.env, 'doctor', '--setup', '--json');
  assert.equal(r.code, 0, r.out);
  const d = JSON.parse(r.out);
  assert.equal(d.result, 'pass');
  const row = (n) => d.checks.find((c) => c.check === n);
  assert.deepEqual([row('git').status, row('config').status, row('evidence_root').status, row('agent').status, row('judge').status], ['ok', 'ok', 'ok', 'ok', 'ok'], 'the install-health rows');
  assert.equal(row('verify_skill').status, 'warning', 'a --no-skill install has no verify skill yet, and that is not a failure');
  assert.equal(row('real_product').status, 'warning');
  assert.equal(row('real_product').detail, 'no journeys yet: the user records a core journey after install, for real proof');
  assert.deepEqual([row('core_journey').status, row('core_journey').detail, row('core_journey').fix], ['skipped', 'skipped (--setup): no core user journey yet: the user records one after install, for real proof', '']);
  assert.equal(row('upgrade_journey').status, 'ok', 'this repo ships no installable artifact');
  assert.match(d.help[0], /Add a journey to \.done-done\.yaml/, 'the help names the journey to record');
  // Plain doctor is unchanged: the same repo fails on the missing core journey and verify skill.
  const plain = doctorIn(repo, s.env, 'doctor', '--json');
  assert.equal(plain.code, 2, plain.out);
  const p = JSON.parse(plain.out);
  assert.equal(p.checks.find((c) => c.check === 'core_journey').status, 'missing');
  assert.equal(p.checks.find((c) => c.check === 'verify_skill').status, 'missing');
  // An app that ships an artifact and has no upgrade journey is skipped too, never fatal.
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'notes', bin: { notes: 'engine.js' } }));
  const shipped = JSON.parse(doctorIn(repo, s.env, 'doctor', '--setup', '--json').out);
  assert.equal(shipped.checks.find((c) => c.check === 'upgrade_journey').status, 'skipped');
  assert.match(shipped.checks.find((c) => c.check === 'upgrade_journey').detail, /^skipped \(--setup\): the app ships an installable artifact .*no upgrade journey is recorded yet/);
  // No agent, then no judge: each is required and exits 2.
  writeFileSync(global, 'judge:\n  route: answerer:opencode\n  model: opencode-go/x\n');
  const noAgent = doctorIn(repo, s.env, 'doctor', '--setup', '--json');
  assert.equal(noAgent.code, 2, noAgent.out);
  assert.equal(JSON.parse(noAgent.out).checks.find((c) => c.check === 'agent').status, 'missing');
  writeFileSync(global, 'agent: claude\n');
  const noJudge = doctorIn(repo, s.env, 'doctor', '--setup', '--json');
  assert.equal(noJudge.code, 2, noJudge.out);
  assert.equal(JSON.parse(noJudge.out).checks.find((c) => c.check === 'judge').status, 'missing');
});

// The muxr miss: a config whose proof never drove the one flow users need (pair, open a pane, type, see output), and a release
// proven only by a fresh install while users upgrade over the version they have. doctor names both gaps with the fix command.
test('doctor requires a named core journey and, for an app that ships an installable artifact, an upgrade-in-place journey', () => {
  const { repo, env, sh } = setup(JUDGED.replace('    core: true\n', ''));
  writeFileSync(join(env.DONE_DONE_HOME, 'config.yaml'), `agent: claude\n${judgeYaml(env)}`);
  keepSkill(repo, 'notes');
  const stubs = pathEnv(env, ['claude']);
  const doctor = () => {
    const r = doctorIn(repo, stubs, 'doctor', '--json');
    return { code: r.code, row: (n) => JSON.parse(r.out).checks.find((c) => c.check === n), help: JSON.parse(r.out).help };
  };
  const commit = (m) => { sh('add', '-A'); sh('commit', '-qm', m); };
  commit('skill');
  let d = doctor();
  assert.equal(d.code, 2, 'a config that names no core journey fails doctor');
  assert.equal(d.row('core_journey').status, 'missing');
  assert.match(d.row('core_journey').detail, /^no core user journey is named: a journey with core: true that drives the product, or a \(core journey\) entry in \.agents\/skills\/done-done-verify-notes\/features\/README\.md$/);
  assert.match(d.row('core_journey').fix, /done-done init --journey <name> --core -- '<command that drives it/);
  assert.deepEqual(d.help, [d.row('core_journey').fix], 'the only fix is the core journey');
  assert.equal(d.row('upgrade_journey').status, 'ok', 'no tracked file ships an artifact yet');
  // A code-only journey marked core is no core journey: its run never drives the product.
  appendFileSync(join(repo, '.done-done.yaml'), '  check:\n    command: npm test > $DONE_DONE_EVIDENCE_ROOT/t.log\n    core: true\n');
  assert.equal(doctor().row('core_journey').status, 'missing', 'a code-only core journey does not count');
  // --core and --upgrade mark only a journey init records.
  const bare = doctorIn(repo, stubs, 'init', '--core');
  assert.equal(bare.code, 2, bare.out);
  assert.match(bare.out, /--core marks the journey init records, so it needs --journey <name> and a command after --/);
  const marked = doctorIn(repo, stubs, 'init', '--journey', 'shots', '--core', '--', 'node', 'make-shots.mjs', '${RUN_ID}');
  assert.equal(marked.code, 0, marked.out);
  assert.match(readFileSync(join(repo, '.done-done.yaml'), 'utf8'), / {2}shots:\n {4}command: node make-shots\.mjs '\$\{RUN_ID\}'\n {4}core: true\n/, 'init records the core flag on the journey');
  commit('core');
  d = doctor();
  assert.equal(d.code, 0, JSON.stringify(d.row('core_journey')));
  assert.equal(d.row('core_journey').detail, 'journey shots is the core user journey');
  // A CLI users install from npm upgrades over the version they have: a fresh install alone is no release proof.
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'notes', bin: { notes: 'src/app.js' } }));
  mkdirSync(join(repo, 'android', 'app', 'src', 'main'), { recursive: true });
  writeFileSync(join(repo, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), '<manifest package="dev.notes"/>\n');
  commit('ship');
  d = doctor();
  assert.equal(d.code, 2, 'an app that ships an artifact with no upgrade journey fails doctor');
  assert.equal(d.row('upgrade_journey').status, 'missing');
  assert.equal(d.row('upgrade_journey').detail, 'the app ships an installable artifact (android/app/src/main/AndroidManifest.xml: an Android app; package.json: an npm package with a bin users install) and no upgrade journey is named: a fresh install alone is no release proof');
  assert.match(d.row('upgrade_journey').fix, /done-done init --journey upgrade --upgrade -- '<command that installs the previous shipped version, upgrades over it in place, then drives the core journey>'/);
  const up = doctorIn(repo, stubs, 'init', '--journey', 'upgrade', '--upgrade', '--', 'node', 'make-shots.mjs', '${RUN_ID}');
  assert.equal(up.code, 0, up.out);
  assert.match(readFileSync(join(repo, '.done-done.yaml'), 'utf8'), / {2}upgrade:\n {4}command: node make-shots\.mjs '\$\{RUN_ID\}'\n {4}upgrade: true\n/);
  commit('upgrade');
  d = doctor();
  assert.equal(d.code, 0);
  assert.match(d.row('upgrade_journey').detail, /^journey upgrade upgrades in place \(the app ships android\/app\/src\/main\/AndroidManifest\.xml: an Android app; package\.json: an npm package with a bin users install\)$/);
  // A journey-less repo names both in its verify skill's feature map; a private package ships nothing.
  writeFileSync(join(repo, '.done-done.yaml'), 'app: notes\n');
  rmSync(join(repo, 'android'), { recursive: true });
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'notes', private: true, bin: { notes: 'src/app.js' } }));
  mkdirSync(join(repo, '.agents', 'skills', 'done-done-verify-notes', 'features'));
  writeFileSync(join(repo, '.agents', 'skills', 'done-done-verify-notes', 'features', 'README.md'), '# notes features\n\n- [Add a note](add-a-note.md) (core journey): the add command\n');
  commit('map');
  d = doctor();
  assert.equal(d.row('core_journey').detail, 'feature map entry [Add a note](add-a-note.md) is the core user journey');
  assert.equal(d.row('upgrade_journey').status, 'ok', 'a private package is not shipped');
  // A non-boolean mark is a config error, never a silent no.
  writeFileSync(join(repo, '.done-done.yaml'), 'app: notes\njourneys:\n  shots:\n    command: node make-shots.mjs\n    core: yes please\n');
  assert.match(doctorIn(repo, stubs, 'doctor').out, /journeys must be a map of name: \{command: <string>.*core: <true for the core user journey>/);
});

// Stub agent CLIs that log how they were started (argv, stdin, cwd) and answer like the real ones:
// claude -p prints its JSON result with structured_output; opencode run reads the attached prompt file and
// prints JSON events (after a wrapper's banner line) whose text part holds the answer, fenced as models often do.
function stubAgents(env, answer = '{"ok":true}', opencodeReply) {
  const e = pathEnv(env, ['ffprobe']);
  const log = join(e.PATH, 'calls.jsonl');
  const stub = (name, reply) => writeFileSync(join(e.PATH, name), `#!${process.execPath}
const { appendFileSync, readFileSync, writeFileSync } = require('node:fs');
const argv = process.argv.slice(2);
const stdin = readFileSync(0, 'utf8');
const file = argv.includes('-f') ? readFileSync(argv[argv.indexOf('-f') + 1], 'utf8') : '';
const rawAnswer = ${JSON.stringify(answer === 'error' ? {} : (() => { try { return JSON.parse(answer); } catch { return {}; } })())};
const batchKeys = [...new Set([...(stdin + ' ' + file).matchAll(/capture_\\d+/g)].map((m) => m[0]))];
const resolvedAnswer = batchKeys.length && rawAnswer.relevance ? Object.fromEntries(batchKeys.map((k) => [k, rawAnswer.relevance])) : rawAnswer;
const attached = argv.filter((a, i) => argv[i - 1] === '-f').slice(1).map((f) => readFileSync(f).subarray(1, 4).toString());
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ agent: ${JSON.stringify(name)}, argv, stdin, file, attached, permission: process.env.OPENCODE_PERMISSION, configDir: process.env.CLAUDE_CONFIG_DIR, shed: Object.hasOwn(process.env, 'DD_POOL_SHED'), cwd: process.cwd() }) + '\\n');
${reply}
`, { mode: 0o755 });
  stub('claude', `process.exitCode = ${JSON.stringify(answer)} === 'error' ? 1 : 0;
process.stdout.write(JSON.stringify({ type: 'result', is_error: ${JSON.stringify(answer)} === 'error', result: 'You have hit your session limit', structured_output: ${JSON.stringify(answer)} === 'error' ? undefined : resolvedAnswer }));`);
  stub('opencode', opencodeReply ?? `console.log('mise tools: opencode');
console.log(JSON.stringify({ type: 'step_start', part: { type: 'step-start' } }));
console.log(JSON.stringify({ type: 'text', part: { type: 'text', text: '\\\`\\\`\\\`json\\n' + JSON.stringify(resolvedAnswer) + '\\n\\\`\\\`\\\`' } }));`);
  // The user sets the agent; done-done never picks one. A test that needs another agent writes its own config.
  mkdirSync(env.DONE_DONE_HOME, { recursive: true });
  const file = join(env.DONE_DONE_HOME, 'config.yaml');
  const cfg = existsSync(file) ? readFileSync(file, 'utf8') : '';
  // setup's own config holds only the stub judge, so it gets the agent too; a test's own config stays as written.
  if (!cfg || cfg === judgeYaml(env)) writeFileSync(file, `agent: claude\n${cfg}`);
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  return { env: e, calls, bin: e.PATH };
}

test('the agent comes from config, and doctor --probe asks it one schema question', () => {
  const { repo, env } = setup(JUDGED);
  const s = stubAgents(env);
  mkdirSync(env.DONE_DONE_HOME, { recursive: true });
  writeFileSync(join(env.DONE_DONE_HOME, 'config.yaml'), 'agent_config:\n  opencode: { model: opencode-go/test-model }\njudge:\n  route: answerer:opencode\n  model: opencode-go/muse-spark-1.3-contributor\n');
  const yaml = readFileSync(join(repo, '.done-done.yaml'), 'utf8');
  const doctor = (extra, ...args) => {
    writeFileSync(join(repo, '.done-done.yaml'), yaml + extra);
    const r = doctorIn(repo, s.env, 'doctor', ...args);
    return { ...r, d: r.out.startsWith('command') ? toon(r) : undefined, by: (n) => toon(r).checks.find((c) => c.check === n) };
  };
  // opencode at its configured model.
  const oc = doctor('agent: opencode\n', '--probe');
  assert.equal(oc.code, 0, oc.out);
  assert.match(oc.by('agent').detail, /^opencode \(model opencode-go\/test-model; from config\) at /);
  assert.match(oc.by('judge_choice').detail, /^answerer:opencode \(model opencode-go\/muse-spark-1\.3-contributor; from config\) judges the author opencode \(model opencode-go\/test-model\): the author's agent at a different model/);
  assert.equal(oc.by('probe').status, 'ok');
  const [call] = s.calls();
  assert.match(call.file, /connectivity probe[\s\S]*JSON schema[\s\S]*"required":\["ok"\]/, 'the prompt and schema go in the attached file');
  assert.ok(!call.argv.some((a) => a.includes('connectivity probe')) && call.stdin === '', 'never in argv');
  assert.notEqual(call.cwd, repo, 'a tool-less probe runs in a scratch dir, never the repo');
  assert.deepEqual(call.argv.slice(0, 6), ['run', 'Follow the attached instructions.', '--format', 'json', '-m', 'opencode-go/test-model']);
  assert.deepEqual(JSON.parse(call.permission), { '*': 'deny' }, 'every tool is denied');
  const record = oc.by('probe').detail.match(/record (\S+)$/)[1];
  assert.equal(statSync(record).mode & 0o777, 0o600);
  const rec = JSON.parse(readFileSync(record, 'utf8'));
  assert.deepEqual([rec.agent, rec.model, rec.tools, rec.ok, rec.answer], ['opencode', 'opencode-go/test-model', 'none', true, { ok: true }]);
  assert.ok(rec.prompt_bytes > 0 && !JSON.stringify(rec).includes('connectivity probe'), 'the record keeps no prompt text');
  // claude at its cheap default, all tools off.
  const claude = doctor('agent: claude\n', '--probe');
  assert.equal(claude.code, 0, claude.out);
  const c = s.calls()[1];
  assert.equal(c.agent, 'claude');
  assert.notEqual(c.cwd, repo, 'a tool-less probe runs in a scratch dir, never the repo');
  assert.deepEqual(['--model', '--tools', '--setting-sources'].map((f) => c.argv[c.argv.indexOf(f) + 1]), ['claude-haiku-5-5', '', ''], 'no project or user settings load');
  assert.ok(!c.argv.includes('--safe-mode'), 'a doctor probe runs your normal claude setup, not the judge\'s safe mode');
  assert.ok(c.argv.includes('-p') && c.argv.includes('--no-session-persistence') && JSON.parse(c.argv[c.argv.indexOf('--json-schema') + 1]).required[0] === 'ok');
  assert.match(c.stdin, /connectivity probe/);
  assert.deepEqual(c.argv.slice(-2), ['--effort', 'low'], 'the cheap default effort goes to claude --effort');
  // effort, extra flags and the call timeout come from the global config, and doctor names the file each came from.
  const globalYml = join(env.DONE_DONE_HOME, 'config.yaml');
  writeFileSync(globalYml, `agent_config:\n  claude: { effort: high }\nagent_args_override:\n  claude: [--permission-mode, plan]\nagent_timeout: 2m\n${judgeYaml(env)}`);
  const tuned = doctor('agent: claude\n', '--probe');
  assert.equal(tuned.code, 0, tuned.out);
  assert.deepEqual(s.calls()[2].argv.slice(-4), ['--effort', 'high', '--permission-mode', 'plan'], 'effort maps to the CLI flag, extra flags come after done-done\'s own');
  const tunedRec = JSON.parse(readFileSync(tuned.by('probe').detail.match(/record (\S+)$/)[1], 'utf8'));
  assert.deepEqual([tunedRec.effort, tunedRec.args, tunedRec.timeoutMs], ['high', ['--permission-mode', 'plan'], 120_000], 'the call record names the effort, flags and timeout');
  assert.match(tuned.by('agent_settings').detail, /^agent claude \(\.done-done\.yaml\); model claude-haiku-5-5 \(default\); effort high \(.*config\.yaml\); args 2 set \(.*config\.yaml\); path claude on PATH \(default\); agent_timeout 2m \(.*config\.yaml\)$/);
  writeFileSync(globalYml, `agent_config:\n  opencode: { model: opencode-go/test-model }\n${judgeYaml(env)}`);
  // A failed answer fails the probe, which --probe makes required; without --probe nothing is asked.
  const bad = stubAgents(env, 'error');
  const failed = doctorIn(repo, bad.env, 'doctor', '--probe');
  assert.equal(failed.code, 2, failed.out);
  assert.match(toon(failed).checks.find((x) => x.check === 'probe').detail, /claude did not answer: claude exited 1: You have hit your session limit; record /);
  assert.equal(toon(failed).checks.find((x) => x.check === 'probe').fix, `Check that claude is signed in and can use model claude-haiku-5-5, or set agent_config.claude.model`, 'a probe that ran and failed points at the sign-in');
  const blockedHome = join(repo, 'home');
  mkdirSync(blockedHome);
  writeFileSync(join(blockedHome, 'agents'), 'x');
  writeFileSync(join(blockedHome, 'config.yaml'), judgeYaml(env));
  const unwritable = doctorIn(repo, { ...s.env, DONE_DONE_HOME: blockedHome }, 'doctor', '--probe');
  const unw = toon(unwritable).checks.find((x) => x.check === 'probe');
  assert.equal(unwritable.code, 0, unwritable.out);
  assert.equal(unw.status, 'ok', 'an agent that answered keeps its probe ok when only the record cannot be written');
  assert.match(unw.detail, /the call record could not be written/);
  assert.equal(doctorIn(repo, bad.env, 'doctor').code, 0);
  assert.equal(bad.calls().length, 1);
  // An explicit judge route, and bad values.
  // The user sets one agent: no auto, no fallback list.
  for (const agent of ['auto', '[codex, gemini]']) assert.match(doctor(`agent: ${agent}\n`).by('config').detail, /agent must be one of claude, codex, opencode, pi, gemini, or acp:<target>/);
  // The judge: any agent and model the user sets runs, the author's own too; doctor names how far apart they are.
  const routeCfg = (extra) => writeFileSync(join(env.DONE_DONE_HOME, 'config.yaml'), `agent_config:\n  opencode: { model: opencode-go/test-model }\njudge:\n  route: answerer:opencode\n${extra}`);
  routeCfg('  model: opencode-go/muse-spark-1.3-contributor\n');
  assert.match(doctor('agent: opencode\n').by('judge_choice').detail, /^answerer:opencode \(model opencode-go\/muse-spark-1\.3-contributor; from config\) judges the author opencode \(model opencode-go\/test-model\): the author's agent at a different model$/);
  routeCfg('  model: opencode-go/test-model\n');
  const same = doctor('agent: opencode\n');
  assert.equal(same.code, 0, same.out);
  assert.deepEqual([same.by('judge_choice').status, same.by('judge_choice').fix], ['ok', '']);
  assert.match(same.by('judge_choice').detail, /^answerer:opencode \(model opencode-go\/test-model; from config\) judges the author opencode \(model opencode-go\/test-model\): the author's agent and model in a fresh session \(session-only independence\)$/);
  routeCfg('');
  assert.match(doctor('agent: opencode\n').by('judge_choice').detail, /^answerer:opencode \(model opencode-go\/test-model;/, 'no judge.model is the agent_config model, here the author\'s own: never swapped for a cheap one');
  routeCfg('  allow_same: true\n');
  assert.match(doctor('agent: opencode\n').by('config').detail, /judge\.allow_same is gone/);
  writeFileSync(join(env.DONE_DONE_HOME, 'config.yaml'), 'judge:\n  route: answerer:claude\n');
  assert.match(doctor('').out, /judge\.route must be claude-code \(for claude\), answerer:<agent> for one of opencode, pi, gemini, or a key route \(openai:key, minimax:key\)/, 'claude judges through claude-code');
  writeFileSync(join(env.DONE_DONE_HOME, 'config.yaml'), 'judge:\n  route: answerer:acp:gemini\n');
  assert.match(doctor('').out, /judge\.route must be .*; an acp:<target> agent cannot judge, since done-done cannot send it an image/, 'an acp agent cannot judge, and the config error says why');
  writeFileSync(join(env.DONE_DONE_HOME, 'config.yaml'), 'judge:\n  route: opencode-go\n');
  assert.match(doctor('').out, /judge\.route must be claude-code \(for claude\), answerer:<agent>/);
  writeFileSync(join(env.DONE_DONE_HOME, 'config.yaml'), 'judge:\n  model: x\n');
  assert.equal(doctor('').by('config').status, 'ok', 'a judge.model with no route is not a config error');
  assert.match(doctor('agent: cursor\n').out, /agent must be one of claude, codex, opencode, pi, gemini/);
  assert.match(doctor('judge: auto\n').out, /judge must be a mapping/, 'judge: auto is not a spelling of the judge');
  assert.match(doctor('agent_config:\n  opencode: { model: x }\n').out, /agent_config may only be set in the global config/, 'the project file cannot pick a model');
  writeFileSync(join(env.DONE_DONE_HOME, 'config.yaml'), 'agent_config:\n  cursor: { model: x }\n');
  assert.match(doctor('').out, /agent_config must be a map of <agent>: \{model: <string>, effort: <string>\}/);
  for (const [global, err] of [
    ['agent_config:\n  gemini: { effort: low }\n', /agent_config\.gemini\.effort: gemini has no reasoning-effort flag/],
    ['agent_config:\n  claude: { effort: turbo }\n', /agent_config\.claude\.effort must be one of minimal, low, medium, high, xhigh, max/],
    ['agent_config:\n  opencode: { model: muse }\n', /agent_config\.opencode\.model must be provider\/model/],
    ['agent_timeout: 0s\n', /agent_timeout must be a duration such as 90s, 30m or 1h/],
    ['agent_args_override:\n  claude: --verbose\n', /agent_args_override must be a map of <agent>: \[<flag>, \.\.\.\]/],
  ]) {
    writeFileSync(join(env.DONE_DONE_HOME, 'config.yaml'), global);
    assert.match(doctor('').out, err);
  }
  writeFileSync(join(env.DONE_DONE_HOME, 'config.yaml'), '');
  for (const key of ['agent_args_override: { claude: [] }', 'agent_path_override: { claude: claude }', 'acpx_path: acpx', 'agent_timeout: 5m'])
    assert.match(doctor(`${key}\n`).out, new RegExp(`${key.split(':')[0]} may only be set in the global config`), 'only agent may be set per repo, as in no-mistakes');
  assert.equal(s.calls().length, 4, 'only --probe asks the agent');
  // Without a repo config, the agent keys still come from the global config.
  writeFileSync(join(env.DONE_DONE_HOME, 'config.yaml'), `agent: opencode\n${judgeYaml(env)}`);
  rmSync(join(repo, '.done-done.yaml'));
  const global = doctorIn(repo, s.env, 'doctor');
  assert.equal(global.code, 2, global.out);
  assert.match(toon(global).checks.find((x) => x.check === 'agent').detail, /^opencode \(model opencode-go\/muse-spark-1.3-contributor; from config\)/);
  writeFileSync(join(env.DONE_DONE_HOME, 'config.yaml'), 'agent: pi\njudge:\n  modle: x\n');
  const broken = toon(doctorIn(repo, s.env, 'doctor'));
  assert.equal(broken.checks.find((x) => x.check === 'agent').status, 'missing');
  assert.match(broken.checks.find((x) => x.check === 'agent').detail, /unknown key judge\.modle/, 'a broken global config is named, never replaced by built-in defaults');
});

test('history lists newest first and logs tails the step log', () => {
  const { dd } = setup();
  const a = toon(dd('verify', 'shots', '--outcome', 'home renders', '--foreground')).run_id;
  const b = toon(dd('verify', 'shots', '--outcome', 'home renders', '--foreground')).run_id;
  const h = toon(dd('history'));
  assert.deepEqual(h.history.map((x) => x.run_id), [b, a]);
  assert.equal(toon(dd('history', '--limit', '1')).history.length, 1);
  assert.equal(dd('history', '--limit', '0').code, 2);
  const l = toon(dd('logs', '--step', 'check'));
  assert.equal(l.step, 'check');
  assert.ok(l.log.join('\n').includes('pass'));
  assert.equal(dd('logs', '--step', 'nope').code, 2);
});

test('abort stops a live run and status says cancelled', async () => {
  const { dd, runningAt } = slowRepo();
  assert.equal(dd('verify', 'slow', '--outcome', 'home renders', '--no-wait').code, 4);
  const run = await runningAt('drive');
  assert.equal(dd('abort', '--run', run.run_id).code, 0);
  const s = toon(dd('status', '--run', run.run_id));
  assert.equal(s.status, 'cancelled');
  assert.equal(dd('status', '--run', run.run_id).code, 1);
  assert.ok(await groupGone(run.runner.journey_pgid), 'journey group gone');
  assert.equal(dd('abort', '--run', run.run_id).code, 1, 'second abort fails');
});

test('rerun after a killed runner reuses resolve and passes', async () => {
  const { dd, runningAt, release, runs } = slowRepo();
  assert.equal(dd('verify', 'slow', '--outcome', 'home renders', '--no-wait').code, 4);
  const run = await runningAt('drive');
  process.kill(run.runner.pid, 'SIGKILL');
  let f;
  for (let i = 0; i < 100 && (f = dd('status', '--run', run.run_id)).code === 4; i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(f.code, 1, f.out);
  writeFileSync(release, '');
  const r = dd('rerun', '--run', run.run_id);
  assert.equal(r.code, 0, r.out);
  const s = toon(r);
  assert.equal(s.result, 'pass');
  const rerunEvent = readFileSync(join(runs, s.run_id, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.rerun_of);
  assert.deepEqual(rerunEvent.reused, ['resolve']);
});


test('attach streams a running run to its end', async () => {
  const { repo, env, release, dd } = slowRepo();
  assert.equal(dd('verify', 'slow', '--outcome', 'home renders', '--no-wait').code, 4);
  const child = spawn(process.execPath, [CLI, 'attach'], { cwd: repo, env, encoding: 'utf8' });
  let out = '', err = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (err += d));
  await new Promise((r) => setTimeout(r, 500));
  writeFileSync(release, '');
  const code = await new Promise((r) => child.on('close', r));
  assert.equal(code, 0, out + err);
  assert.match(err, /running/, 'events streamed to stderr');
  assert.equal(toon({ out }).result, 'pass');
});


// Codex init and doctor --probe are exercised with the installed CLI by journeys/agents-live.mjs.

test('maintain blocks a verify skill that resolves outside the repo and reads nothing from it', () => {
  const { repo, env, sh } = setup('app: notes\nevidence:\n  root: .proof\nskill: ../outside\n');
  const s = stubAgents(env, JSON.stringify({ drift: [], recipe: 'open it', recipes: [], missing: [] }));
  const outside = join(repo, '..', 'outside');
  mkdirSync(join(outside, 'features'), { recursive: true });
  writeFileSync(join(outside, 'SKILL.md'), '# done-done-verify-notes\n');
  writeFileSync(join(outside, 'features', 'README.md'), '# features\n');
  writeFileSync(join(outside, 'features', 'home.md'), '# Home\n');
  const r = doctorIn(repo, s.env, 'maintain', '--foreground');
  const m = toon(r);
  assert.equal(m.result, 'blocked', r.out);
  assert.match(r.out, /outside the repository/, r.out);
});

test('maintain reports a dead link, a wrong file:line and drift from read-only readers, and changes nothing', () => {
  const { repo, env, sh } = setup();
  const answer = JSON.stringify({
    recipe: 'import src/app.js',
    drift: [{ claim: 'app is 2', why: 'it is 1', file: 'src/app.js', line: 1 }, { claim: 'made up', why: 'no such line', file: 'src/app.js', line: 50 }],
    recipes: [{ state: 'fresh', features: ['home.md'], steps: ['open it'] }], missing: [{ file: 'src/app.js', why: 'new surface' }, { file: 'src/gone.js', why: 'not in the churn list' }],
  });
  const s = stubAgents(env, answer);
  const dd = (...args) => doctorIn(repo, s.env, ...args);
  const none = dd('maintain', '--foreground');
  assert.equal(none.code, 3, none.out);
  assert.deepEqual([toon(none).result, toon(none).help[0]], ['blocked', 'Create the verify skill: done-done init']);
  const skill = join(repo, '.agents', 'skills', 'done-done-verify-notes');
  mkdirSync(join(skill, 'features'), { recursive: true });
  writeFileSync(join(skill, 'SKILL.md'), '# done-done-verify-notes\n\nThe map: [features](features/README.md). See https://example.com:443/x and localhost:3000.\n');
  writeFileSync(join(skill, 'features', 'README.md'), '# features\n\n- [Home](home.md)\n- [Search](search.md)\n- [Home again](home.md#top)\n');
  mkdirSync(join(repo, 'src', 'café'));
  writeFileSync(join(repo, 'src', 'café', 'gate.js'), 'export const gate = 1;\n');
  writeFileSync(join(skill, 'features', 'home.md'), `# Home\n\nSource: src/app.js:1, and the old src/app.js:40.\nAlso app.js:1, app.js:40, ghost.js:2 and gate.js:1.\nLong note: ${'x'.repeat(20_000)}\n`);
  writeFileSync(join(skill, 'features', 'extra.md'), '# Extra\n');
  sh('add', '-A');
  sh('commit', '-qm', 'skill');
  const status = () => sh('status', '--porcelain', '--untracked-files=all').toString() + sh('rev-parse', 'HEAD');
  const before = status();
  const r = dd('maintain', '--foreground', '--full');
  assert.equal(r.code, 1, r.out);
  const m = toon(r);
  assert.deepEqual([m.kind, m.result, m.git_status], ['maintain', 'drift', 'same']);
  const at = (f) => `${f.kind} ${f.file.replace('.agents/skills/done-done-verify-notes/', '')}${f.line ? `:${f.line}` : ''}`;
  assert.deepEqual(m.findings.map(at), [
    'dead-link features/README.md:4', 'duplicate features/README.md:5', 'unlisted features/README.md', 'truncated features/home.md',
    'citation features/home.md:3', 'citation features/home.md:4', 'citation features/home.md:4', 'drift features/extra.md', 'drift features/home.md', 'unmapped src/app.js',
  ], 'a reader citation that does not exist and a missing file outside the churn list are not findings');
  assert.match(m.findings[4].what, /cites src\/app\.js:40, but src\/app\.js has 1 lines/);
  assert.match(m.findings[5].what, /cites app\.js:40, but src\/app\.js has 1 lines/);
  assert.match(m.findings[6].what, /cites ghost\.js:2, but no tracked file is named ghost\.js/);
  assert.equal(status(), before, 'maintain changed nothing');
  // One fresh read-only reader per feature file runs in the repo; the reconcile call has no tools and runs elsewhere.
  const calls = s.calls();
  assert.deepEqual(calls.map((c) => c.argv[c.argv.indexOf('--tools') + 1]), ['Read,Grep,Glob', 'Read,Grep,Glob', '']);
  assert.deepEqual(calls.map((c) => c.cwd === repo), [true, true, false]);
  assert.match(calls[0].stdin, /extra\.md/);
  const run = join(env.DONE_DONE_HOME, 'runs', 'notes', m.run_id);
  assert.deepEqual(readdirSync(join(run, 'agents')).sort(), ['1-reader-extra.json', '2-reader-home.json', '3-reconcile.json']);
  assert.equal(toon(dd('history')).history[0].kind, 'maintain');
  assert.match(toon(dd('logs', '--step', 'reconcile')).log.join('\n'), /src\/app\.js:50: src\/app\.js has 1 lines/);
  // An agent that cannot start reads nothing, so maintain stops before its run (exit 2) and gives no result.
  writeFileSync(join(env.DONE_DONE_HOME, 'config.yaml'), `agent: gemini\n${judgeYaml(env, 'pi')}`);
  const noAgent = dd('maintain', '--foreground', '--full');
  assert.equal(noAgent.code, 2, noAgent.out);
  assert.equal(toon(noAgent).result, undefined);
  assert.match(toon(noAgent).error, /^maintain: no agent done-done can start \(gemini is not on PATH\)/);
  writeFileSync(join(env.DONE_DONE_HOME, 'config.yaml'), `agent: claude\n${judgeYaml(env)}`);
  // A reader that writes into the repo makes the run blocked.
  writeFileSync(join(s.bin, 'claude'), `#!${process.execPath}\nrequire('node:fs').writeFileSync('stray.txt', '');\nprocess.stdout.write(JSON.stringify({ structured_output: ${answer} }));\n`, { mode: 0o755 });
  const changed = toon(dd('maintain', '--foreground'));
  assert.deepEqual([changed.result, changed.git_status], ['blocked', 'changed']);
  assert.match(changed.reason, /^repo-changed: /);
});

// auto_fix: the opencode author reads and fixes the skill, the pi judge triages; the stub reads its mode from a file.
function fixSetup(autoFix) {
  const t = setup(`app: notes\n${autoFix === undefined ? '' : `auto_fix:\n  maintain: ${autoFix}\n`}`);
  const e = pathEnv(t.env, []);
  const log = join(e.PATH, 'calls.jsonl');
  const stub = `#!${process.execPath}
const { appendFileSync, readFileSync, writeFileSync } = require('node:fs');
const argv = process.argv.slice(2);
const pi = argv[0] === '-p';
const prompt = pi ? readFileSync(0, 'utf8') : readFileSync(argv[argv.indexOf('-f') + 1], 'utf8');
const mode = readFileSync(${JSON.stringify(join(e.PATH, 'mode'))}, 'utf8').trim();
const role = pi || /Which side should change\?/.test(prompt) ? 'judge' : /You fix the verification skill/.test(prompt) ? 'fixer' : /read-only source reader/.test(prompt) ? 'reader' : 'reconcile';
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ role, cwd: process.cwd(), argv, prompt }) + '\\n');
let answer;
if (role === 'judge') {
  const ids = JSON.parse(prompt.trim().split('\\n').filter((l) => l.startsWith('{')).pop()).required;
  const p = mode === 'product' ? { skill: 0.02, product: 0.97, unclear: 0.01 } : { skill: 0.97, product: 0.02, unclear: 0.01 };
  answer = Object.fromEntries(ids.map((id) => [id, { probabilities: p, rationale: 'r', personReason: mode === 'product' ? 'the source looks broken' : 'the rename is deliberate' }]));
} else if (role === 'fixer') {
  const f = '.agents/skills/done-done-verify-notes/features/home.md';
  writeFileSync(f, readFileSync(f, 'utf8').replace('OLD', 'NEW'));
  if (mode === 'outside') writeFileSync('src/app.js', 'export const app = 2;\\n');
  if (mode === 'move') require('node:child_process').execFileSync('git', ['mv', 'src/app.js', '.agents/skills/done-done-verify-notes/app.js']);
  answer = { summary: 'renamed the title', blocker: '' };
} else if (role === 'reader') {
  const [file, line] = readFileSync(${JSON.stringify(join(e.PATH, 'cite'))}, 'utf8').trim().split(':');
  answer = { drift: /Feature file[\\s\\S]*OLD/.test(prompt.split('Cited source')[0]) ? [{ claim: 'the title is OLD', why: 'the source names it NEW', file, line: Number(line) }] : [], recipe: 'open home' };
} else answer = { recipes: [], missing: [] };
const text = JSON.stringify(answer);
if (pi) console.log(JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text }] } }));
else console.log(JSON.stringify({ type: 'text', part: { type: 'text', text } }));
`;
  for (const b of ['opencode', 'pi']) writeFileSync(join(e.PATH, b), stub, { mode: 0o755 });
  writeFileSync(join(e.PATH, 'mode'), 'good');
  writeFileSync(join(e.PATH, 'cite'), 'src/app.js:1');
  mkdirSync(t.env.DONE_DONE_HOME, { recursive: true });
  writeFileSync(join(t.env.DONE_DONE_HOME, 'config.yaml'), 'agent: opencode\nagent_config:\n  opencode: { model: opencode-go/author }\njudge:\n  route: answerer:pi\n  model: pi/judge\n');
  const skill = join(t.repo, '.agents', 'skills', 'done-done-verify-notes');
  mkdirSync(join(skill, 'features'), { recursive: true });
  writeFileSync(join(skill, 'SKILL.md'), '# done-done-verify-notes\n');
  writeFileSync(join(skill, 'features', 'README.md'), '# features\n\n- [Home](home.md)\n');
  writeFileSync(join(skill, 'features', 'home.md'), '# Home\n\nThe title is OLD. See src/app.js:1.\n');
  t.sh('add', '-A');
  t.sh('commit', '-qm', 'skill');
  const git = (...a) => t.sh(...a).toString().trim();
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  const maintain = () => {
    const r = doctorIn(t.repo, { ...e, PATH: `${e.PATH}:${dirname(process.execPath)}` }, 'maintain', '--foreground');
    return { r, m: toon(r) };
  };
  return { ...t, e, calls, git, maintain, mode: (m) => writeFileSync(join(e.PATH, 'mode'), m), branches: () => git('branch', '--list', 'done-done/*') };
}

test('maintain with auto_fix fixes the skill in one skill-only commit on a done-done branch and leaves the user branch alone', () => {
  const t = fixSetup(2);
  const head = t.git('rev-parse', 'HEAD');
  const { r, m } = t.maintain();
  assert.deepEqual([r.code, m.result], [0, 'changed'], r.out);
  assert.deepEqual(t.calls().map((c) => c.role), ['reader', 'reconcile', 'judge', 'fixer', 'reader', 'reconcile']);
  const fixer = t.calls().find((c) => c.role === 'fixer');
  assert.notEqual(fixer.cwd, t.repo, 'the fixer edits a done-done worktree, never the checkout');
  assert.equal(m.fix.branch, `done-done/maintain-${m.run_id}`);
  assert.equal(t.git('rev-parse', 'HEAD'), head, 'the user branch did not move');
  assert.equal(t.git('status', '--porcelain'), '', 'the checkout is untouched');
  assert.equal(t.git('rev-list', '--count', `${head}..${m.fix.branch}`), '1');
  assert.equal(t.git('diff', '--name-only', head, m.fix.branch), '.agents/skills/done-done-verify-notes/features/home.md');
  assert.match(t.git('show', `${m.fix.branch}:.agents/skills/done-done-verify-notes/features/home.md`), /The title is NEW/);
  assert.equal(t.git('worktree', 'list').split('\n').length, 1, 'the done-done worktree is removed');
});

for (const ready of ['url: http://127.0.0.1:$DONE_DONE_PORT/health', 'command: curl -sf $DONE_DONE_BASE_URL/'])
test(`an instance (ready ${ready.split(':')[0]}) serves the journey on its own port; the journey keeps the caller HOME, only the app runs isolated`, () => {
  const t = setup(`app: notes\nevidence:\n  root: .proof\ninstance:\n  command: node server.mjs\n  ready:\n    ${ready}\n  ready_timeout: 15s\njourneys:\n  probe:\n    command: curl -sf $DONE_DONE_BASE_URL/ > $DONE_DONE_EVIDENCE_ROOT/reply.txt && echo "port=$DONE_DONE_PORT home=$HOME base=$DONE_DONE_BASE_URL" >> $DONE_DONE_EVIDENCE_ROOT/reply.txt\n`);
  writeFileSync(join(t.repo, 'server.mjs'), `import {createServer} from 'node:http';\nimport {writeSync} from 'node:fs';\nwriteSync(1, 'instance-marker\\ninstance-home=' + process.env.HOME + '\\n');\ncreateServer((q,s)=>s.writeHead(200).end('ok')).listen(Number(process.env.DONE_DONE_PORT),'127.0.0.1');\n`);
  t.sh('add', '-A');
  t.sh('commit', '-qm', 'instance fixture');
  const r = t.dd('run', 'probe');
  assert.equal(r.code, 0, r.out);
  const id = toon(r).run_id;
  const reply = readFileSync(join(t.repo, '.proof', id, 'reply.txt'), 'utf8');
  const port = reply.match(/port=(\d+)/)[1];
  assert.ok(reply.includes(`home=${process.env.HOME} `), 'the journey keeps the caller HOME');
  assert.match(reply, new RegExp(`base=http://127.0.0.1:${port}`));
  assert.notEqual(spawnSync('curl', ['-sf', `http://127.0.0.1:${port}/`], { timeout: 8000 }).status, 0, 'the instance stops at run end');
  const runFolder = join(t.env.DONE_DONE_HOME, 'runs', 'notes', id);
  const appLog = readFileSync(join(runFolder, 'logs', 'instance.log'), 'utf8');
  assert.match(appLog, /instance-marker/, 'the app output goes to instance.log in the run folder');
  assert.match(appLog, /instance-home=.*done-done-instance-[^/\n]*\/instance-home\/home/, 'the app runs with its own HOME');
  assert.ok(!readdirSync(join(t.repo, '.proof'), { recursive: true }).some((n) => String(n).endsWith('instance.log')), 'never with the evidence');
});

// auto_fix.verify: the journey fails while src/app.js says BUG; the opencode stub fixes it, and also writes the file named in `extra`.
test('verify with auto_fix fixes the product on a done-done branch, and never fixes a dirty checkout or keeps a fix that touches the skill, config or tests', () => {
  const t = setup('app: notes\nevidence:\n  root: .proof\n  ignore_paths: ["docs/**"]\nauto_fix:\n  verify: 2\njourneys:\n  shots:\n    command: node shot.mjs\n');
  const e = pathEnv(t.env, []);
  writeFileSync(join(t.repo, 'shot.mjs'), `import './steps.mjs';\nimport { copyFileSync, mkdirSync, readFileSync } from 'node:fs';\nif (readFileSync('src/app.js', 'utf8').includes('BUG')) process.exit(1);\nmkdirSync(process.env.DONE_DONE_EVIDENCE_ROOT, { recursive: true });\ncopyFileSync(${JSON.stringify(join(t.dir, 'screen.png'))}, process.env.DONE_DONE_EVIDENCE_ROOT + '/home.png');\n`);
  writeFileSync(join(t.repo, 'src', 'app.js'), 'export const title = "BUG";\n');
  t.sh('add', '-A');
  t.sh('commit', '-qm', 'a broken title');
  writeFileSync(join(e.PATH, 'opencode'), `#!${process.execPath}
const { appendFileSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const extra = readFileSync(${JSON.stringify(join(e.PATH, 'extra'))}, 'utf8');
appendFileSync(${JSON.stringify(join(e.PATH, 'calls'))}, process.cwd() + '\\n');
writeFileSync('src/app.js', 'export const title = "Notes";\\n');
if (extra) mkdirSync(require('node:path').dirname(extra), { recursive: true }), writeFileSync(extra, 'changed\\n');
console.log(JSON.stringify({ type: 'text', part: { type: 'text', text: JSON.stringify({ summary: 'fixed the title', blocker: '' }) } }));
`, { mode: 0o755 });
  mkdirSync(t.env.DONE_DONE_HOME, { recursive: true });
  writeFileSync(join(t.env.DONE_DONE_HOME, 'config.yaml'), `agent: opencode\nagent_config:\n  opencode: { model: opencode-go/author }\n${judgeYaml(t.env)}`);
  const [head, git] = [t.head(), (...a) => t.sh(...a).toString().trim()];
  const off = /^fix: opencode changed the verify skill, \.done-done\.yaml, a test file, a test-runner config or a copied ignored file of your checkout, which a fix never changes/;
  for (const [extra, dirty, code, reason] of [
    ['test/home.test.js', false, 1, off], ['src/app_test.go', false, 1, off], ['test_app.py', false, 1, off], ['spec/home_spec.rb', false, 1, off],
    ['tests/home.js', false, 1, off], ['__tests__/home.js', false, 1, off], ['e2e/home.js', false, 1, off], ['src/app.test.js', false, 1, off], ['src/app.spec.ts', false, 1, off],
    ['app_test.py', false, 1, off], ['vitest.config.ts', false, 1, off], ['playwright.config.ts', false, 1, off], ['jest.config.js', false, 1, off],
    ['cypress.config.ts', false, 1, off], ['cypress.json', false, 1, off], ['.done-done.yaml', false, 1, off], ['.agents/skills/done-done-verify-notes/SKILL.md', false, 1, off],
    ['', true, 1, /^dirty: uncommitted changes to tracked files \(docs\/guide\.md\)/],
    ['', false, 1, /^your HEAD failed; the fix passes, on done-done\/verify-/],
  ]) {
    writeFileSync(join(e.PATH, 'extra'), extra);
    if (dirty) writeFileSync(join(t.repo, 'docs', 'guide.md'), '# guide, edited\n');
    const r = doctorIn(t.repo, { ...e, DD_OUTCOME: 'the home screen shows the title Notes', PATH: `${e.PATH}:${dirname(process.execPath)}` }, 'verify', 'shots', '--outcome', 'the home screen shows the title Notes', '--foreground');
    assert.deepEqual([r.code, toon(r).reason?.match(reason)?.[0] !== undefined], [code, true], `${extra || (dirty ? 'dirty' : 'fix')}: ${r.out}`);
    if (dirty) t.sh('checkout', '--', 'docs/guide.md');
    assert.equal(git('worktree', 'list').split('\n').length, 1, 'the done-done worktree is removed');
  }
  const calls = readFileSync(join(e.PATH, 'calls'), 'utf8').trim().split('\n');
  assert.deepEqual([calls.length, calls.includes(t.repo)], [18, false], 'no fixer on the dirty checkout; the fixer edits a done-done worktree, never the checkout');
  const branch = git('branch', '--list', 'done-done/*').trim();
  assert.deepEqual([git('rev-parse', 'HEAD'), git('status', '--porcelain'), git('diff', '--name-only', head, branch)], [head, '', 'src/app.js'], 'one fix on its own branch; the user branch and checkout are untouched');
});

// A mixed judge result is never fixed: the judge sorts the wrong screen (home.png), then it parks with the unsure one.
// One judge.floor for every judge: a triage answer that clears the old 0.8 floor but not judge.floor is unsure, so the wrong
// screen parks like the unsure one instead of being sorted.
const TRIAGE_CASES = [
  ['after sorting its wrong screen', { triageFails: false, floor: '' }],
  ['after sorting its wrong screen, and fails with the cause when the triage call fails', { triageFails: true, floor: '' }],
  ['after sorting its wrong screen, and parks it too when judge.floor is above the triage answer', { triageFails: false, floor: '\n  floor: 0.99' }],
];
for (const [name, { triageFails, floor }] of TRIAGE_CASES) test(`verify with auto_fix parks a mixed judge result ${name}`, () => {
  const t = setup(JUDGED.replace('journeys:', 'auto_fix:\n  verify: 1\njourneys:'));
  const e = pathEnv(t.env, ['ffprobe']);
  writeFileSync(join(e.PATH, 'opencode'), `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(join(e.PATH, 'fixer'))}, '');\n`, { mode: 0o755 });
  if (triageFails) writeFileSync(join(e.PATH, 'triage-fails'), '');
  writeFileSync(join(e.PATH, 'pi'), `#!${process.execPath}
const { appendFileSync, existsSync, readFileSync } = require('node:fs');
const prompt = readFileSync(0, 'utf8');
const images = process.argv.slice(2).filter((a) => a.startsWith('@')).map((a) => readFileSync(a.slice(1)));
const image = images[0];
const triage = /a screen the judge called wrong/.test(prompt);
appendFileSync(${JSON.stringify(join(e.PATH, 'calls'))}, (triage ? 'triage' : 'judge') + '\\n');
const p = (probabilities) => ({ probabilities, rationale: 'r', personReason: 'the title is missing' });
const answer = triage && existsSync(${JSON.stringify(join(e.PATH, 'triage-fails'))}) ? 'not json' : triage ? Object.fromEntries(JSON.parse(prompt.trim().split('\\n').filter((l) => l.startsWith('{')).pop()).required.map((id) => [id, p({ fix: 0.97, ask: 0.02, unclear: 0.01 })]))
  : Object.fromEntries(images.map((img, i) => [process.argv.slice(2).filter(a => a.startsWith('@'))[i].match(/capture_\\d+/)[0], { ...p(img.equals(readFileSync(${JSON.stringify(join(t.dir, 'screen.png'))})) ? { correct: 0.003, wrong: 0.995, unclear: 0.002 } : { correct: 0.003, wrong: 0.002, unclear: 0.995 }), parts: [], covers: [] }]));
console.log(JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: JSON.stringify(answer) }] } }));
`, { mode: 0o755 });
  mkdirSync(t.env.DONE_DONE_HOME, { recursive: true });
  const config = (judge) => writeFileSync(join(t.env.DONE_DONE_HOME, 'config.yaml'), `agent: opencode\nagent_config:\n  opencode: { model: opencode-go/author }\njudge:\n  ${judge}\n`);
  const verify = () => doctorIn(t.repo, { ...e, DD_OUTCOME: 'the home screen shows the title Notes', PATH: `${e.PATH}:${dirname(process.execPath)}` }, 'verify', 'shots', '--outcome', 'the home screen shows the title Notes', '--foreground');
  config(`route: answerer:pi\n  model: pi/judge${floor}`);
  const r = verify();
  const m = toon(r);
  if (triageFails) {
    // A judge that cannot sort the result gives no verdict: the run fails with the cause, and nothing waits at the gate.
    assert.deepEqual([r.code, m.status], [2, 'failed'], r.out);
    assert.match(m.reason, /^triage: judge: the judge did not answer: /);
    assert.deepEqual(m.steps.map((x) => [x.name, x.status]).filter(([n]) => n === 'triage' || n === 'fix' || n === 'gate' || n === 'receipt'), [['triage', 'failed'], ['fix', 'skipped'], ['gate', 'skipped'], ['receipt', 'skipped']]);
  } else {
    assert.equal(r.code, 4, r.out);
    assert.deepEqual(m.steps.map((x) => [x.name, x.status]).filter(([n]) => n === 'triage' || n === 'fix' || n === 'gate'), [['triage', 'completed'], ['fix', 'skipped'], ['gate', 'awaiting_approval']]);
    assert.deepEqual(m.findings.map((f) => /; triage: fix$/.test(f.what)), floor ? [false, false] : [true, false], floor ? 'a fix answer below judge.floor does not sort the wrong screen' : 'the wrong screen carries its class, the unsure one parks as it is');
    if (floor) assert.match(m.findings[0].what, /; judge: the judge was not sure \(confidence 0\.97 below floor 0\.99\); triage: ask$/, 'the park names the shared floor it missed');
  }
  const calls = readFileSync(join(e.PATH, 'calls'), 'utf8').trim().split('\n');
  assert.deepEqual([calls.slice(0, 2), calls.slice(2).every((c) => c === 'triage'), existsSync(join(e.PATH, 'fixer'))], [['judge', 'judge'], true, false], 'each isolated capture is judged before triage; no fixer runs');
});

const MATRIXED = `app: notes
evidence:
  root: .proof
  ignore_paths: ["docs/**"]
matrix:
  theme: [light, dark]
  width: [390, 1280]
journeys:
  cells:
    command: node make-cells.mjs
`;
// A stub journey proving the cell reached it: it refuses without its env, then runs `then`.
const matrixed = (yaml, needs, then) => {
  const t = setup(yaml);
  writeFileSync(join(t.repo, 'make-cells.mjs'), `import './steps.mjs';
import { copyFileSync, mkdirSync } from 'node:fs';
const root = process.env.DONE_DONE_EVIDENCE_ROOT;
const { DONE_DONE_THEME: theme, DONE_DONE_WIDTH: width, DONE_DONE_FORM: form, DONE_DONE_CELL: cell } = process.env;
if (${needs}) { console.error('missing cell env'); process.exit(1); }
mkdirSync(root, { recursive: true });
${then(t)}
`);
  t.sh('add', '-A'); t.sh('commit', '-qm', 'matrix journey');
  return t;
};
// Captures its cell's own shot (distinct bytes per cell), refusing without the full cell env.
const shot = (cells) => (t) => {
  cells.forEach((s, i) => writeFileSync(join(t.dir, `${s}.png`), screen(i)));
  return `copyFileSync(${JSON.stringify(t.dir)} + '/' + cell + '.png', root + '/home.' + cell + '.png');`;
};

test('a matrix run captures every cell with its env and suffix in the manifest', () => {
  const t = matrixed(MATRIXED, "!theme || !width || form !== '' || !cell", shot(['light.390w', 'light.1280w', 'dark.390w', 'dark.1280w']));
  const d = toon(t.dd('run', 'cells'));
  assert.equal(d.result, 'recorded');
  assert.deepEqual(d.matrix.cells.map((c) => c.suffix).sort(), ['dark.1280w', 'dark.390w', 'light.1280w', 'light.390w']);
  for (const c of d.matrix.cells) assert.equal(c.files.length, 1, `${c.cell} names its capture`);
  assert.deepEqual(d.matrix.skipped, []);
});

test('one verify run captures every matrix cell, and status shows the manifest', () => {
  const t = matrixed(MATRIXED, "!theme || !width || form !== '' || !cell", shot(['light.390w', 'light.1280w', 'dark.390w', 'dark.1280w']));
  const s = toon(t.dd('verify', 'cells', '--outcome', 'home renders in every cell', '--foreground'));
  assert.equal(s.result, 'pass');
  assert.equal(s.matrix.cells.length, 4);
  assert.deepEqual(s.matrix.skipped, []);
  assert.equal(toon(t.dd('status')).matrix.cells.length, 4);
  const rec = JSON.parse(readFileSync(join(t.repo, '.proof', '.done-done', 'runs', `${s.run_id}.json`), 'utf8'));
  assert.equal(rec.matrix.cells.length, 4, 'the run record keeps the manifest');
});

const GUARDED = `app: notes
evidence:
  root: .proof
  ignore_paths: ["docs/**"]
inputs: ["data/**"]
journeys:
  shots:
    command: node make-shots.mjs \${RUN_ID}
  edit:
    command: node make-shots.mjs \${RUN_ID} && echo tampered >> data/seed.json
  add:
    command: node make-shots.mjs \${RUN_ID} && echo new > data/extra.json
  remove:
    command: node make-shots.mjs \${RUN_ID} && rm data/seed.json
  dot:
    command: node make-shots.mjs \${RUN_ID} && echo new > data/.cache.json
  accent:
    command: node make-shots.mjs \${RUN_ID} && echo new > "data/café.json"
`;
// A repo with a committed data file watched by the input guard.
const guarded = (yaml = GUARDED) => {
  const t = setup(yaml);
  mkdirSync(join(t.repo, 'data'), { recursive: true });
  writeFileSync(join(t.repo, 'data', 'seed.json'), '{"token":"secret-value-xyz"}\n');
  t.sh('add', '-A'); t.sh('commit', '-qm', 'data file');
  return t;
};

test('a drive that edits, adds or removes a watched input, dotfiles and non-ASCII names too, fails naming the path', () => {
  for (const [journey, change] of [['edit', 'data/seed.json: changed'], ['add', 'data/extra.json: appeared'], ['remove', 'data/seed.json: disappeared'], ['dot', 'data/.cache.json: appeared'], ['accent', 'data/café.json: appeared']]) {
    const t = guarded();
    const r = t.dd('verify', journey, '--outcome', 'home renders', '--foreground');
    assert.equal(r.code, 1, r.out);
    assert.match(toon(r).reason, new RegExp(`input guard: ${change} during the drive`));
    assert.ok(!r.out.includes('secret-value-xyz'), 'file contents are never printed');
  }
});

// DOM assertions: a two-cell matrix whose journey writes each cell's capture and, when given, its page-check record.
const CLEAN = { url: 'http://127.0.0.1/home', overflow: false, overflowing: [], console_errors: [], failed_requests: [] };
const BROKEN = { ...CLEAN, overflow: true, overflowing: ['div#wide'], console_errors: ['boom'], failed_requests: [{ url: 'http://127.0.0.1/x.js', status: 404 }] };
const domVerify = (dom, records, capture = shot(['light', 'dark'])) => {
  const t = matrixed(MATRIXED.replace('  width: [390, 1280]\n', '').replace('journeys:', `${dom}journeys:`), '!cell', (t) =>
    `import { writeFileSync } from 'node:fs';\n${capture(t)}\nconst rec = ${JSON.stringify(records)}[cell];\nif (rec) writeFileSync(root + '/home.' + cell + '.dom.json', JSON.stringify(rec));`);
  const r = t.dd('verify', 'cells', '--outcome', 'home renders in every theme', '--foreground');
  // A failed page check stops the check of the same files before the judge, naming every cause.
  const c = toon(t.dd('check', '--outcome', 'home renders in every theme', ...toon(r).evidence));
  return { r, d: toon(r), why: c.error?.replace(/^check: the judge was not asked, so there is no verdict: /, '').split('; ') ?? [] };
};

test('a dom block stops the run naming the capture and each overflow, console error and failed request', () => {
  const { r, d, why } = domVerify('dom: {}\n', { light: CLEAN, dark: BROKEN });
  assert.equal(r.code, 2, r.out);
  assert.deepEqual([d.status, d.result], ['failed', undefined], 'a failed page check is no verdict');
  assert.deepEqual(why.filter((w) => w.includes('home.dark.png')).map((w) => w.replace(/^.*home\.dark\.png: /, '')), [
    'http://127.0.0.1/home overflows the viewport horizontally (div#wide)',
    'http://127.0.0.1/home console error: boom',
    'http://127.0.0.1/home request failed (404): http://127.0.0.1/x.js',
  ]);
  assert.equal(why.length, 3, r.out);
});


// base_ref: verify drives the base ref too, in a done-done worktree, and the judge sees each head capture with its base capture.
test('base_ref pairs each cell in its own judge request, and reports a head capture with none', () => {
  const t = matrixed(MATRIXED.replace('  width: [390, 1280]\n', '').replace('  enabled: false\n', ''), '!cell', (t) =>
    `const page = readFileSync('page.txt', 'utf8').trim();\nif (existsSync(${JSON.stringify(t.dir)} + '/' + page + '.' + cell + '.png')) copyFileSync(${JSON.stringify(t.dir)} + '/' + page + '.' + cell + '.png', root + '/home.' + cell + '.png');`);
  writeFileSync(join(t.repo, 'make-cells.mjs'), readFileSync(join(t.repo, 'make-cells.mjs'), 'utf8').replace('mkdirSync }', 'mkdirSync, existsSync, readFileSync }'));
  ['old.light', 'old.dark', 'new.light', 'new.dark'].forEach((n, i) => writeFileSync(join(t.dir, `${n}.png`), screen(i * 11)));
  writeFileSync(join(t.repo, 'page.txt'), 'old\n');
  t.sh('add', '-A'); t.sh('commit', '-qm', 'old page');
  const base = t.head();
  writeFileSync(join(t.repo, 'page.txt'), 'new\n');
  t.sh('commit', '-qam', 'new page');
  const s = stubAgents(t.env, JSON.stringify({ relevance: { probabilities: CORRECT, rationale: 'The page is new.', personReason: 'The page is new.', parts: [], covers: [] } }));
  writeFileSync(join(t.env.DONE_DONE_HOME, 'config.yaml'), 'agent: claude\njudge:\n  route: answerer:opencode\n');
  symlinkSync(process.execPath, join(s.bin, 'node'));
  const verify = () => {
    const r = spawnSync(process.execPath, [CLI, 'verify', 'cells', '--outcome', 'home shows the new page', '--foreground'], { cwd: t.repo, env: { ...s.env, DD_OUTCOME: 'home shows the new page' }, encoding: 'utf8' });
    return { code: r.status, out: r.stdout + r.stderr, run: toon({ out: r.stdout }) };
  };
  // Key off: each capture is judged alone and nothing is driven at a base ref.
  const off = verify();
  assert.equal(off.code, 0, off.out);
  assert.deepEqual([s.calls().map((c) => c.attached.length), existsSync(join(t.repo, '.proof', off.run.run_id, 'before'))], [[1, 1], false]);
  writeFileSync(join(t.repo, '.done-done.yaml'), `${readFileSync(join(t.repo, '.done-done.yaml'), 'utf8')}base_ref: ${base}\n`);
  t.sh('commit', '-qam', 'compare with the old page');
  const on = verify();
  assert.equal(on.code, 0, on.out);
  const calls = s.calls().slice(2);
  assert.ok(calls.length === 2 && calls.every(c => c.attached.join() === 'PNG,PNG' && c.file.includes('base ref')), 'each request holds only its own before and after pair');
  const proof = join(t.repo, '.proof', on.run.run_id);
  const paired = JSON.parse(calls[0].file.split('BEGIN DATA (JSON)\n')[1].split('\nEND DATA')[0]);
  for (const [key, value] of Object.entries(paired.state).filter(([key]) => key.startsWith('capture_'))) {
    assert.equal(value.before_name, value.name);
    assert.ok(!value.name.includes('/'), 'the cited basename is sent, never an owner or repository path');
    assert.ok(paired.questions[key].images.every(id => id.endsWith('__' + basename(value.name, '.png'))));
  }
  for (const cell of ['light', 'dark']) assert.deepEqual(readFileSync(join(proof, 'before', `home.${cell}.png`)), readFileSync(join(t.dir, `old.${cell}.png`)), `the ${cell} base capture is the base ref's page`);
  const judged = decode(readFileSync(join(t.env.DONE_DONE_HOME, 'runs', 'notes', on.run.run_id, 'logs', 'judge.log'), 'utf8')).judged;
  assert.deepEqual(judged.map((j) => [basename(j.path), j.before.replace(`${proof}/`, '')]).sort(), [['home.dark.png', 'before/home.dark.png'], ['home.light.png', 'before/home.light.png']], 'pairs by screen name and cell');
  assert.equal(JSON.parse(readFileSync(join(t.repo, '.proof', '.done-done', 'runs', `${on.run.run_id}.json`), 'utf8')).base.commit, base);
  assert.equal(t.sh('worktree', 'list').toString().trim().split('\n').length, 1, 'the base worktree is removed after the run');
  // A head capture whose base capture is missing is reported, never passed silently.
  rmSync(join(t.dir, 'old.dark.png'));
  const gap = verify();
  assert.equal(gap.code, 3, gap.out);
  assert.match(gap.run.reason, /home\.dark\.png: no base capture to compare with: the drive at base_ref \w+ saved no before\/home\.dark\.png/);
});

test('lint passes a real claim, fails an empty, copied or reused one, and logs every run', () => {
  const { dir, dd, env } = setup();
  const claim = (name, evidence, repro = 'n/a: no bug') => {
    const folder = join(dir, name);
    mkdirSync(folder, { recursive: true });
    const report = join(folder, 'report.md');
    writeFileSync(report, `done\n\n## Checks\noutcome: a user can lint a claim\nrepro: ${repro}\nproof: no verify skill - ran node dist/cli.js lint\nevidence: ${evidence}\n`);
    return { folder, report, lint: () => dd('lint', report, folder) };
  };
  const a = claim('task-a', 'one.log two.log');
  writeFileSync(join(a.folder, 'one.log'), 'first state\n');
  writeFileSync(join(a.folder, 'two.log'), 'second state\n');
  assert.deepEqual(a.lint(), { code: 0, out: 'PASS\n' });
  assert.equal(a.lint().code, 0, 'the same task linted again is not reuse');

  const b = claim('task-b', 'one.log');
  writeFileSync(join(b.folder, 'one.log'), 'first state\n');
  assert.match(b.lint().out, /^FAIL: every evidence file was already used by another PR/);
  assert.equal(b.lint().code, 1);

  const c = claim('task-c', 'same.log copy.log');
  writeFileSync(join(c.folder, 'same.log'), 'x\n');
  writeFileSync(join(c.folder, 'copy.log'), 'x\n');
  assert.match(c.lint().out, /byte-identical/);

  const d = claim('task-d', 'empty.log');
  writeFileSync(join(d.folder, 'empty.log'), '');
  assert.match(d.lint().out, /^FAIL: evidence file missing or empty/);

  assert.equal(claim('task-e', 'not proven: no device in reach').lint().out, 'PASS\n');
  assert.match(claim('task-f', 'one.log', 'node x.js').lint().out, /^FAIL: evidence file missing/);

  const log = readFileSync(join(env.DONE_DONE_HOME, 'lint.log'), 'utf8').trim().split('\n');
  assert.equal(log.length, 8);
  assert.deepEqual(log.map((l) => l.split('\t')[3]), ['pass', 'pass', 'fail', 'fail', 'fail', 'fail', 'pass', 'fail']);
  assert.equal(dd('lint', 'only-one-arg').code, 2);
});

test('lint warns on a PR that changes src/ and no journeys/ file, and only then', () => {
  const { dir, dd, env } = setup();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const q = (f) => JSON.stringify(join(dir, f));
  writeFileSync(join(dir, 'files.json'), '[{"path":"src/a.ts"},{"path":"README.md"}]\n');
  writeFileSync(join(dir, 'one.diff'), 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n+const a = 1;\n');
  writeFileSync(join(dir, 'attrs'), '');
  writeFileSync(join(bin, 'gh'), `#!/bin/sh
case "$*" in
  "pr view"*) cat ${q('pr.json')} ;;
  *"compare/b...h"*) cat ${q('one.diff')} ;;
  *"contents/.gitattributes"*) cat ${q('attrs')} ;;
  *) cat ${q('files.json')} ;;
  esac
`, { mode: 0o755 });
  env.PATH = `${bin}:${env.PATH}`;
  const lintFiles = (...paths) => {
    writeFileSync(join(dir, 'pr.json'), JSON.stringify({
      author: { login: 'umer' }, title: 'feat: x', headRefOid: 'h', headRefName: 'fm/warn', baseRefOid: 'b', files: paths.map((path) => ({ path, additions: 5 })),
      body: '## Checks\noutcome: a user can lint\nrepro: n/a: no bug\nproof: no verify skill - ran node dist/cli.js lint\nevidence: not proven: no device in reach\n',
    }));
    writeFileSync(join(dir, 'files.json'), JSON.stringify(paths.map((path) => ({ path }))));
    return dd('lint', 'https://github.com/acme/tool/pull/9', dir);
  };
  assert.match(lintFiles('src/a.ts', 'README.md').out, /^WARN: .*journeys\//);
  assert.equal(lintFiles('src/a.ts').code, 0, 'a warning does not block');
  assert.deepEqual(lintFiles('src/a.ts', 'journeys/a.mjs'), { code: 0, out: 'PASS\n' });
  assert.deepEqual(lintFiles('docs/a.md'), { code: 0, out: 'PASS\n' });
});

test('affected maps a diff to journeys and features through the feature map, falls back to the core journey, and exits 1 until a receipt covers them', () => {
  const unit = '  unit:\n    command: node --test test/unit.test.mjs\n';
  const { repo, sh, dd, shots } = setup(`${JUDGED}  export:\n    command: node export.mjs \${RUN_ID}\n${unit}`);
  const features = join(repo, '.agents', 'skills', 'done-done-verify-notes', 'features');
  mkdirSync(features, { recursive: true });
  writeFileSync(join(features, 'README.md'), '# notes features\n\n- [Home](home.md) (core journey): the home screen\n- [Settings](settings.md): the settings screen\n');
  writeFileSync(join(features, 'home.md'), '# Home\n\nSource: `src/app.js`. Drive: `done-done run shots`.\n');
  writeFileSync(join(features, 'settings.md'), '# Settings\n\nSource: [the screen](../../../../src/settings.js). Your agent drives it.\n');
  writeFileSync(join(repo, 'src', 'settings.js'), 'export const settings = 1;\n');
  writeFileSync(join(repo, 'export.mjs'), '// export\n');
  mkdirSync(join(repo, 'test'));
  writeFileSync(join(repo, 'test', 'unit.test.mjs'), '// unit\n');
  sh('add', '-A');
  sh('commit', '-qm', 'features');
  sh('checkout', '-qb', 'feat');
  const affected = (code, ...args) => {
    const r = dd('--json', 'affected', ...args);
    assert.equal(r.code, code, r.out);
    return json(r);
  };
  const commit = (file, text) => {
    writeFileSync(join(repo, file), text);
    sh('add', file);
    sh('commit', '-qm', file);
  };
  // ignore_paths keep proof fresh, so a docs change needs no journey; with no receipt the proof is still missing.
  commit('docs/guide.md', '# guide v2\n');
  let a = affected(1);
  assert.deepEqual([a.result, a.changed, a.journeys], ['missing', [], []]);
  assert.match(a.base, /\(the merge base with main\)$/);
  assert.match(a.help[0], /No journey needs a new run/);
  // A journey whose command runs the changed file; a feature that cites it through a markdown link and names no journey.
  commit('export.mjs', '// export v2\n');
  commit('src/settings.js', 'export const settings = 2;\n');
  a = affected(1);
  assert.deepEqual(a.journeys, [{ name: 'export', why: 'its command runs export.mjs' }]);
  assert.deepEqual(a.features, [{ name: 'settings', drive: 'verify --feature', why: 'feature settings cites src/settings.js' }]);
  assert.match(a.help[0], /done-done run export && done-done verify --feature settings --outcome/);
  // A code-only journey is never needed: its test file is in no feature, so it is uncertain and the core journey runs.
  commit('test/unit.test.mjs', '// unit v2\n');
  a = affected(1);
  assert.deepEqual(a.journeys.map((j) => j.name), ['export', 'shots']);
  assert.deepEqual(a.unmapped, ['test/unit.test.mjs']);
  assert.equal(a.fallback, 'uncertain: 1 changed file is in no feature or journey, so the core journey runs too');
  assert.match(a.help.at(-1), /^Flag the gap: test\/unit\.test\.mjs is in no feature or journey/);
  // A receipt for HEAD that ran only shots misses the other journey and the feature.
  const { files } = shots();
  assert.equal(dd('receipt', '--outcome', 'home and settings render', ...files).code, 0);
  a = affected(1);
  assert.equal(a.proof, 'stale: the receipt for HEAD has no run of export, feature settings');
  assert.match(a.help[0], /^Capture fresh proof: done-done run export && done-done verify --feature settings/);
  // From HEAD itself nothing changed, so the receipt covers it.
  a = affected(0, 'HEAD');
  assert.deepEqual([a.result, a.journeys, a.help], ['fresh', [], ['The receipt for HEAD covers every journey this change needs (none)']]);
  assert.equal(affected(2, 'nope').error, 'affected: nope is not a commit in this checkout');
  // An uncommitted change is stale proof; with no core journey named, the uncertain change needs every real journey.
  writeFileSync(join(repo, '.done-done.yaml'), `${JUDGED.replace('    core: true\n', '')}  export:\n    command: node export.mjs \${RUN_ID}\n${unit}`);
  writeFileSync(join(features, 'README.md'), '# notes features\n\n- [Home](home.md): the home screen\n- [Settings](settings.md): the settings screen\n');
  a = affected(1, 'HEAD');
  assert.match(a.proof, /^stale: uncommitted changes \(\.agents\/skills\/done-done-verify-notes\/features\/README\.md, \.done-done\.yaml\)/);
  assert.deepEqual(a.journeys.map((j) => [j.name, j.why]), [
    ['shots', 'every feature follows .agents/skills/done-done-verify-notes/features/README.md; uncertain: 1 changed file is in no feature or journey, and no core journey is named'],
    ['export', 'uncertain: 1 changed file is in no feature or journey, and no core journey is named'],
  ]);
  assert.equal(a.help[0], 'Commit the change first: proof counts only from a commit');
});

test('gate vouches for a committed receipt with no judge, config or evidence, and refuses a missing, moved-on, wrong-head or late one', () => {
  const { dir, repo, env, sh, dd, head, shots } = setup();
  const { files } = shots();
  assert.equal(dd('receipt', '--outcome', 'home and settings render', ...files).code, 0);
  const proven = head();
  // A hosted runner: a fresh clone with no judge, no config, no key and none of the evidence.
  const runner = join(dir, 'runner');
  const bare = { ...env, DONE_DONE_HOME: join(dir, 'empty-home') };
  delete bare.DD_STUB_JUDGE;
  const gate = (...args) => {
    const r = spawnSync(process.execPath, [CLI, 'gate', ...args], { cwd: runner, env: bare, encoding: 'utf8' });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  const clone = () => {
    rmSync(runner, { recursive: true, force: true });
    execFileSync('git', ['clone', '-q', repo, runner], { env });
  };
  clone();
  assert.match(gate().out, /^FAIL: no receipt in \.done-done-receipts\/ at /, 'no receipt committed yet');
  assert.equal(gate().code, 1);

  const folder = join(repo, '.done-done-receipts');
  mkdirSync(folder);
  cpSync(join(repo, '.proof', '.done-done', 'receipts', `${proven}.json`), join(folder, `${proven}.json`));
  sh('add', '-A');
  sh('commit', '-qm', 'receipt');
  clone();
  assert.deepEqual(gate(), { code: 0, out: 'PASS\n' });
  assert.equal(gate(head()).code, 0, 'the head can be named');

  // The receipt keeps the run behind each capture, so gate applies the real-product rule with no config: a receipt from an
  // older build (no runs), or one whose captures all come from code-only runs, vouches for nothing.
  const rec = JSON.parse(readFileSync(join(folder, `${proven}.json`), 'utf8'));
  assert.deepEqual(rec.runs.map((r) => [r.journey, r.command]), [['shots', `node make-shots.mjs ${rec.runs[0].run_id}`]]);
  const gateOn = (r, msg) => {
    writeFileSync(join(folder, `${proven}.json`), JSON.stringify(r, null, 2));
    sh('commit', '-qam', msg);
    clone();
    return gate();
  };
  const { runs, ...older } = rec;
  assert.match(gateOn(older, 'receipt from an older build').out, /^FAIL: receipt for .* is no real-product proof: it records no capture runs/);
  const code = gateOn({ ...rec, runs: runs.map((r) => ({ ...r, journey: 'check', command: 'yarn run check > $DONE_DONE_EVIDENCE_ROOT/check.log' })) }, 'code-only receipt');
  assert.equal(code.code, 1);
  assert.match(code.out, /^FAIL: receipt for .* is no real-product proof: every cited capture comes from a code-only run \(check\)/);
  assert.deepEqual(gateOn(rec, 'receipt restored'), { code: 0, out: 'PASS\n' });

  assert.match(gate('--pushed', '2000-01-01T00:00:00Z').out, /^FAIL: receipt time .* is not before the push/, 'a receipt made after the push');
  assert.equal(gate('--pushed', 'tomorrow-ish').code, 2);

  writeFileSync(join(repo, 'src', 'app.js'), 'export const app = 2;\n');
  sh('commit', '-qam', 'code after the proof');
  clone();
  assert.match(gate().out, /^FAIL: src\/app\.js changed after receipt head/, 'the proof no longer covers the head');

  const other = join(folder, `${'0'.repeat(40)}.json`);
  cpSync(join(folder, `${proven}.json`), other);
  sh('rm', '-q', '-f', '--', `.done-done-receipts/${proven}.json`);
  sh('add', '-A');
  sh('commit', '-qm', 'receipt moved to the wrong name');
  clone();
  assert.match(gate().out, /does not name its own head/, 'a receipt filed under another head');
});

test('a sealed proof survives a head change that touches no journey it covered, and records both commits; a change to the journey still fails as stale', () => {
  const { repo, sh, dd, head, shots } = setup('app: notes\nevidence:\n  root: .proof\n  ignore_paths: ["docs/**"]\njourneys:\n  shots:\n    command: node make-shots.mjs ${RUN_ID}\n  other:\n    command: node other.mjs ${RUN_ID}\n    core: true\n');
  writeFileSync(join(repo, 'other.mjs'), '// the core journey\n');
  sh('add', '-A');
  sh('commit', '-qm', 'add the other journey');
  const { files } = shots();
  const sealed = head();
  const checks = join(repo, '..', 'checks.md');
  writeFileSync(checks, `## Checks\noutcome: home and settings render\nrepro: n/a: no bug\nproof: no verify skill - \`done-done run shots\`\nevidence: ${files.join(', ')}\n`);
  writeFileSync(join(repo, 'src', 'app.js'), 'export const app = 2;\n');
  sh('commit', '-qam', 'change code no journey runs');
  const held = dd('check', '--from', checks);
  assert.equal(held.code, 0, held.out);
  assert.match(held.out, new RegExp(`is for commit ${sealed.slice(0, 12)} and HEAD is ${head().slice(0, 12)}: its journey shots is untouched`), 'the result records both commits');
  const receipt = dd('receipt', '--from', checks);
  assert.equal(receipt.code, 0, receipt.out);
  assert.equal(JSON.parse(readFileSync(join(repo, '.proof', '.done-done', 'receipts', `${head()}.json`), 'utf8')).runs[0].commit, sealed, 'the receipt keeps the run commit beside its own head');
  writeFileSync(join(repo, 'make-shots.mjs'), `${readFileSync(join(repo, 'make-shots.mjs'), 'utf8')}// changed\n`);
  sh('commit', '-qam', 'change the journey');
  const stale = dd('check', '--from', checks);
  assert.equal(stale.code, 2, stale.out);
  assert.match(stale.out, /evidence is for commit/);
});

// check-only proof: a run at an earlier commit, then a docs-only commit. The check passes on that evidence, and it must leave a run record at HEAD.
test('a passing check seals the evidence no run holds at HEAD: one record, no duplicate, none on a fail or a dirty tree', () => {
  const t = setup();
  const { repo, sh, dd, head } = t;
  const outcome = 'home and settings render';
  const { files } = t.shots(outcome);
  const records = () => readdirSync(join(repo, '.proof', '.done-done', 'runs')).map((n) => JSON.parse(readFileSync(join(repo, '.proof', '.done-done', 'runs', n), 'utf8')));
  const atHead = () => records().filter((r) => r.commit === head());
  writeFileSync(join(repo, 'docs', 'guide.md'), '# guide\n\nmore\n');
  sh('commit', '-qam', 'docs only');
  assert.equal(atHead().length, 0, 'the gap: no run record at HEAD');

  // A failed check seals nothing, and neither does a pass on a dirty tree (which says why).
  assert.equal(dd('check', '--outcome', outcome, '.proof/nope/missing.png').code, 2);
  assert.equal(atHead().length, 0);
  writeFileSync(join(repo, 'src', 'app.js'), 'export const app = 2;\n');
  const dirty = dd('check', '--outcome', outcome, ...files);
  assert.equal(toon(dirty).sealed, undefined, dirty.out);
  sh('checkout', '--', 'src/app.js');
  assert.equal(atHead().length, 0, 'a dirty tree seals nothing');

  const pass = dd('check', '--outcome', outcome, ...files);
  assert.equal(pass.code, 0, pass.out);
  const [sealed] = atHead();
  assert.equal(atHead().length, 1);
  assert.match(toon(pass).sealed, new RegExp(`^${sealed.run_id} `));
  assert.deepEqual([sealed.exit, sealed.dirty, sealed.schema, sealed.command, sealed.tool, sealed.commit], [0, false, 1, 'check (sealed)', JSON.parse(readFileSync(join(CLI, '..', '..', 'package.json'), 'utf8')).version, head()]);
  assert.ok(sealed.ended_at);
  const real = files.map((f) => ({ sha256: createHash('sha256').update(readFileSync(join(repo, f))).digest('hex'), bytes: statSync(join(repo, f)).size }));
  assert.deepEqual(sealed.files.map(({ sha256, bytes }) => ({ sha256, bytes })).sort((a, b) => a.sha256.localeCompare(b.sha256)), real.sort((a, b) => a.sha256.localeCompare(b.sha256)));
  for (const f of sealed.files) assert.equal(createHash('sha256').update(readFileSync(join(repo, '.proof', f.path))).digest('hex'), f.sha256, 'copied byte for byte');

  // A second pass at the same head reuses it, also when it cites the sealed copies themselves.
  assert.equal(dd('check', '--outcome', outcome, ...files).code, 0);
  assert.equal(dd('check', '--outcome', outcome, ...sealed.files.map((f) => `.proof/${f.path}`)).code, 0, 'the seal keeps the step record');
  assert.equal(atHead().length, 1, 'no duplicate record');
  assert.equal(dd('receipt', '--outcome', outcome, ...files).code, 0);
  assert.equal(atHead().length, 1);

  // Hand-made evidence no run wrote is still not proof, and seals nothing.
  writeFileSync(join(repo, '.proof', 'hand.txt'), 'hello\n');
  assert.notEqual(dd('check', '--outcome', outcome, '.proof/hand.txt').code, 0);
  assert.equal(atHead().length, 1);
});
