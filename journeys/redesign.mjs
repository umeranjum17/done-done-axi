// Real built-CLI integration journey; the judge transport is deterministic, not a visual-model proof.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const CLI = process.env.DONE_DONE_TEST_CLI || fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const OUT = process.env.DONE_DONE_EVIDENCE_ROOT;
assert.ok(OUT, 'run via done-done run redesign');
const dir = mkdtempSync(join(tmpdir(), 'dd-redesign-'));
const repo = join(dir, 'repo');
const home = join(dir, 'home');
const log = [];
mkdirSync(repo); mkdirSync(home);
const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: home, XDG_DATA_HOME: home, XDG_CACHE_HOME: home, DONE_DONE_HOME: home,
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Board Dev', GIT_AUTHOR_EMAIL: 'you@example.com', GIT_COMMITTER_NAME: 'Board Dev', GIT_COMMITTER_EMAIL: 'you@example.com' };
for (const k of Object.keys(env)) if (k.startsWith('GIT_CONFIG_') && !['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'].includes(k)) delete env[k];
const git = (...args) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' }).trim();
const dd = (code, ...args) => {
  const r = spawnSync(process.execPath, [CLI, '--json', '--full', ...args], { cwd: repo, env, encoding: 'utf8' });
  log.push(`$ done-done ${args.join(' ')}\n${r.stdout}${r.stderr}\nexit: ${r.status}`);
  assert.equal(r.status, code, r.stdout + r.stderr);
  return JSON.parse(r.stdout);
};
try {
  // Synthetic side-by-side composites of a generic "board" app: the left half is the source, the right the redesign. Only the CLI contract is under test.
  const png = (seed, w = 200, h = 120) => {
    const chunk = (type, data) => {
      const len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(data.length);
      crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])));
      return Buffer.concat([len, Buffer.from(type), data, crc]);
    };
    const raw = Buffer.alloc(h * (w * 3 + 1));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([(x * 3 + seed) % 256, y * 5 % 256, (x + y + (x < w / 2 ? 0 : seed)) % 256], y * (w * 3 + 1) + 1 + x * 3);
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  };
  // The fixture judge answers the three pair questions, the seven layout questions and the relevance question, and logs which it was asked.
  // DD_NO=<kind> answers no to that pair question; DD_UNSURE=<kind> answers it below the floor; DD_MISMATCH fails layout match.
  const judge = join(dir, 'judge.cjs');
  const calls = join(dir, 'calls.log');
  writeFileSync(judge, `#!${process.execPath}
const fs = require('node:fs'); const ask = fs.readFileSync(0, 'utf8');
const pair = ask.includes('two-versions');
const layout = ask.includes('blank-strip');
if (pair && (!ask.includes('"id":"pair"') || ask.includes('"id":"mock"') || ask.includes('"id":"screen"'))) throw Error('a pair question must carry the single image "pair"');
if (layout && !ask.includes('"id":"mock"')) throw Error('layout match needs the approved mock');
const keys = pair ? ['two-versions', 'complete', 'preserved'] : layout ? ['aspect','clipped-text','overlap','off-screen','blank-strip','squashed-text','layout'] : [...new Set([...ask.matchAll(/capture_\\d+/g)].map(m => m[0]))];
if (!keys.length) keys.push('relevance');
const probabilities = (k) => pair
  ? (process.env.DD_UNSURE === k ? {yes: .5, no: .5} : process.env.DD_NO === k ? {yes: .03, no: .97} : {yes: .97, no: .03})
  : layout ? (process.env.DD_MISMATCH && k === 'layout' ? {defect: .95, none: .05} : {defect: .03, none: .97})
  : {correct: .95, wrong: .03, unclear: .02};
const answer = Object.fromEntries(keys.map(k => [k, {probabilities: probabilities(k), rationale: 'Fixture reply.', personReason: 'Fixture ' + k + ' reason.', parts: [], covers: []}]));
fs.appendFileSync(${JSON.stringify(calls)}, (pair ? 'pair' : layout ? 'layout' : 'relevance') + '\\n');
process.stdout.write(JSON.stringify({response: JSON.stringify(answer)}));
`, { mode: 0o755 });
  const setModel = (model) => writeFileSync(join(home, 'config.yaml'), `judge:\n  route: answerer:gemini\n  model: ${model}\nagent_path_override: {gemini: ${JSON.stringify(judge)}}\n`);
  setModel('fixture');
  const asked = (kind) => (existsSync(calls) ? readFileSync(calls, 'utf8').split('\n').filter(l => l === kind).length : 0);
  const screens = ['home', 'settings'];
  const rows = screens.map(screen => ({ screen, size: '200x120', theme: 'light', capture: `${screen}-pair.png` }));
  const config = `app: board\nevidence: {root: .proof}\napproved_redesign: ${JSON.stringify(rows)}\n`;
  const commit = (yaml, msg) => { writeFileSync(join(repo, '.done-done.yaml'), yaml); git('add', '-A'); git('commit', '-qm', msg); };
  writeFileSync(join(repo, '.gitignore'), '.proof/\n');
  for (const [i, name] of screens.entries()) writeFileSync(join(repo, `${name}-mock.png`), png(i * 7 + 1));
  git('init', '-q', '-b', 'main');
  commit(config, 'redesigned board manifest');
  // A sealed run of the pairs (name -> bytes), with a step record. Returns the run's cited files.
  const seal = (pairs) => {
    const run = dd(0, 'run', '--open');
    const root = join(repo, run.evidence_root);
    for (const [name, bytes] of Object.entries(pairs)) writeFileSync(join(root, name), bytes);
    writeFileSync(join(root, 'steps.json'), JSON.stringify({ target: { version: '1' }, start: 'the unchanged source and the redesigned board', steps: ['open each board screen in both versions', 'save each side by side'], result: 'the board is redesigned and release ready' }));
    dd(0, 'run', '--close', run.run_id);
    return Object.keys(pairs).map(n => join(root, n));
  };
  const claim = 'the board is redesigned';
  const good = { 'home-pair.png': png(3), 'settings-pair.png': png(5) };

  // d) a missing or wrong-size live capture fails before any judge call, naming screen/size/theme.
  const missingFiles = seal({ 'home-pair.png': good['home-pair.png'] });
  const missing = dd(1, 'check', '--outcome', claim, ...missingFiles);
  assert.equal(missing.result, 'fail'); assert.match(JSON.stringify(missing), /settings \/ 200x120 \/ light: no live capture \(settings-pair\.png\)/);
  const wrongFiles = seal({ ...good, 'settings-pair.png': png(5, 160, 96) });
  const wrong = dd(1, 'check', '--outcome', claim, ...wrongFiles);
  assert.match(JSON.stringify(wrong), /settings \/ 200x120 \/ light: live capture is 160x96, not the approved size/);
  assert.equal(asked('pair') + asked('relevance') + asked('layout'), 0, 'coverage fails before any judge call');

  // a) the sealed side-by-side pairs pass the blind judge and the result carries the rows.
  const files = seal(good);
  const pass = dd(0, 'check', '--outcome', claim, ...files);
  assert.equal(pass.redesign.length, 2);
  assert.ok(pass.redesign.every(r => r.verdict === 'pass' && r.size === '200x120' && r.theme === 'light' && r.path && r.sha256 && !r.mock));
  assert.deepEqual(pass.redesign.map(r => r.screen), screens);
  assert.equal(pass.design, undefined, 'a redesign is not matched against a mock');
  assert.equal(asked('pair'), 2); assert.equal(asked('layout'), 0);
  const receipt = dd(0, 'receipt', '--outcome', claim, ...files);
  assert.equal(asked('pair'), 2, 'the cached verdicts are reused');
  const verified = dd(0, 'receipt', '--verify', 'HEAD');
  assert.equal(verified.judge.approved_redesign.length, 2);
  // g) receipt --verify refuses a malformed recorded redesign verdict, and accepts the intact one again.
  const receiptFile = join(repo, receipt.receipt);
  const saved = readFileSync(receiptFile, 'utf8');
  const damage = (edit) => { const r = JSON.parse(saved); edit(r.judge.approved_redesign); writeFileSync(receiptFile, JSON.stringify(r)); };
  for (const edit of [rows => { rows[0].verdict = 'fail'; }, rows => { rows[0].sha256 = '0'.repeat(64); }, rows => { rows[0].theme = ' '; }, rows => { rows.length = 0; }]) {
    damage(edit);
    assert.match(dd(1, 'receipt', '--verify', 'HEAD').reason, /malformed approved-redesign verdict/);
  }
  writeFileSync(receiptFile, saved);
  dd(0, 'receipt', '--verify', 'HEAD');

  // b) a no on any of the three kinds fails the claim and names that kind.
  const refused = {};
  for (const kind of ['two-versions', 'complete', 'preserved']) {
    env.DD_NO = kind; setModel(`no-${kind}`);
    const r = dd(1, 'check', '--outcome', claim, ...files);
    assert.equal(r.result, 'fail'); assert.ok(r.redesign.every(row => row.verdict === 'fail'));
    assert.match(JSON.stringify(r), new RegExp(`${kind}: Fixture ${kind} reason`));
    refused[kind] = r.redesign[0].reason;
  }
  delete env.DD_NO;
  // c) an answer below the floor is unsure, never a pass, and names the kind.
  env.DD_UNSURE = 'complete'; setModel('unsure');
  const unsure = dd(3, 'check', '--outcome', claim, ...files);
  assert.equal(unsure.result, 'inconclusive'); assert.ok(unsure.redesign.every(row => row.verdict === 'unsure' && /complete/.test(row.reason)));
  assert.match(JSON.stringify(unsure), /redesign not proven: not confident enough about complete/);
  dd(3, 'receipt', '--outcome', claim, ...files);
  delete env.DD_UNSURE; setModel('fixture');

  // f) an implement-the-mock claim still runs layout match; a redesign-worded claim does not.
  const both = { app: 'board', evidence: { root: '.proof' }, approved_design: screens.map(s => ({ screen: s, size: '200x120', theme: 'light', mock: `${s}-mock.png`, capture: `${s}.png` })) };
  commit(`${config}approved_design: ${JSON.stringify(both.approved_design)}\n`, 'mock and redesign manifests');
  const shots = seal({ 'home.png': readFileSync(join(repo, 'home-mock.png')), 'settings.png': readFileSync(join(repo, 'settings-mock.png')), ...good });
  const layoutBefore = asked('layout'), pairBefore = asked('pair');
  const mocked = dd(0, 'check', '--outcome', 'the board matches the approved design', ...shots);
  assert.equal(mocked.design.length, 2); assert.equal(mocked.redesign, undefined, 'approved_redesign never gates an unrelated claim');
  assert.equal(asked('layout') - layoutBefore, 2); assert.equal(asked('pair'), pairBefore);
  const redesigned = dd(0, 'check', '--outcome', claim, ...shots);
  assert.equal(redesigned.redesign.length, 2); assert.equal(redesigned.design, undefined, 'a redesign claim does not use layout match');
  assert.equal(asked('layout') - layoutBefore, 2, 'no layout match for the redesign claim');
  env.DD_MISMATCH = '1'; setModel('mismatch');
  assert.ok(dd(1, 'check', '--outcome', 'the board matches the approved design', ...shots).design.every(s => s.verdict === 'fail'));
  assert.equal(dd(0, 'check', '--outcome', claim, ...shots).result, 'pass', 'a layout mismatch with the mock does not fail a redesign');
  delete env.DD_MISMATCH; setModel('fixture');

  // e) a redesign claim with no approved_redesign has nothing to compare to its source.
  commit(`app: board\nevidence: {root: .proof}\n`, 'no manifest');
  const pairBeforeNone = asked('pair');
  const none = dd(1, 'check', '--outcome', claim, ...seal(good));
  assert.match(JSON.stringify(none), /not compared to approved result/); assert.match(JSON.stringify(none.help), /Add approved_redesign to .done-done.yaml/);
  assert.equal(asked('pair'), pairBeforeNone, 'no judge call without a manifest');

  // g) gate validates the recorded passing verdict from git alone, and refuses a malformed one.
  commit(config, 'redesigned board manifest again');
  const gateFiles = seal(good);
  const gated = dd(0, 'receipt', '--outcome', claim, ...gateFiles);
  const gateRun = (code) => {
    const r = spawnSync(process.execPath, [CLI, 'gate', '--pushed', '2999-01-01T00:00:00Z'], { cwd: repo, env, encoding: 'utf8' });
    log.push(`$ done-done gate\n${r.stdout}${r.stderr}\nexit: ${r.status}`);
    assert.equal(r.status, code, r.stdout + r.stderr);
    return r.stdout;
  };
  const head = git('rev-parse', 'HEAD');
  const calledBefore = asked('pair') + asked('relevance');
  mkdirSync(join(repo, '.done-done-receipts'));
  copyFileSync(join(repo, gated.receipt), join(repo, '.done-done-receipts', `${head}.json`));
  git('add', '-A'); git('commit', '-qm', 'commit the receipt');
  assert.match(gateRun(0), /PASS/);
  const rec = JSON.parse(readFileSync(join(repo, '.done-done-receipts', `${head}.json`), 'utf8'));
  rec.judge.approved_redesign[0].verdict = 'unsure';
  writeFileSync(join(repo, '.done-done-receipts', `${head}.json`), JSON.stringify(rec));
  git('add', '-A'); git('commit', '-qm', 'tamper with the recorded redesign verdict');
  assert.match(gateRun(1), /FAIL: .*malformed approved-redesign verdict/);
  assert.equal(asked('pair') + asked('relevance'), calledBefore, 'gate makes no model call');

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'redesign-summary.txt'), [
    'Redesign claim proof from the real CLI (deterministic fixture judge):',
    `missing capture: ${missing.result}, wrong-size capture: ${wrong.result}, judge calls before either: 0`,
    `blind pair judge, all three kinds yes: ${pass.result}, ${pass.redesign.length} rows ${pass.redesign.map(r => `${r.screen}/${r.size}/${r.theme}=${r.verdict}`).join(', ')}`,
    ...Object.entries(refused).map(([k, v]) => `a no on ${k}: fail, ${v}`),
    `below the floor on complete: ${unsure.result}, ${unsure.redesign[0].reason}`,
    `implement-the-mock claim: layout match ran (${mocked.design.length} mocks); redesign claim: ${redesigned.redesign.length} pairs judged, no layout match`,
    `no approved_redesign: ${none.result}, not compared to approved result`,
    'receipt --verify and gate accept the recorded passing verdict and refuse a malformed one',
  ].join('\n') + '\n');
  writeFileSync(join(OUT, 'steps.json'), JSON.stringify({
    target: { version: JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version }, start: 'built CLI and an isolated board app with two redesigned screens, each captured side by side',
    steps: ['cite a missing and a wrong-size side-by-side capture: both fail by screen/size/theme before any judge call', 'seal both pairs and check "the board is redesigned": the blind judge passes and the result lists both rows', 'record a receipt, verify it, reject a malformed redesign verdict', 'answer no on each of the three kinds: each fails naming its kind', 'answer below the floor: inconclusive, never pass', 'keep layout match for the implement-the-mock claim and skip it for the redesign claim', 'drop the manifest: not compared to approved result', 'commit the receipt: gate passes, then refuses a malformed verdict with no model call'],
    result: 'a redesign claim is proven by the blind side-by-side judge against its source, and every missing, broken, lossy or unsure pair is refused',
  }));
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'redesign.log'), log.join('\n') + '\n');
  rmSync(dir, { recursive: true, force: true });
}
