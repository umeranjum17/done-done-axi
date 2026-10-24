// Real built-CLI integration journey; the judge transport is deterministic, not a visual-model proof.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const CLI = process.env.DONE_DONE_TEST_CLI || fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const OUT = process.env.DONE_DONE_EVIDENCE_ROOT;
assert.ok(OUT, 'run via done-done run approved-design');
const dir = mkdtempSync(join(tmpdir(), 'dd-approved-'));
const repo = join(dir, 'repo');
const home = join(dir, 'home');
const log = [];
mkdirSync(repo); mkdirSync(home);
const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: home, XDG_DATA_HOME: home, XDG_CACHE_HOME: home, DONE_DONE_HOME: home,
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Umer', GIT_AUTHOR_EMAIL: 'umer@example.com', GIT_COMMITTER_NAME: 'Umer', GIT_COMMITTER_EMAIL: 'umer@example.com' };
for (const k of Object.keys(env)) if (k.startsWith('GIT_CONFIG_') && !['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'].includes(k)) delete env[k];
const git = (...args) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' }).trim();
const dd = (code, ...args) => {
  const r = spawnSync(process.execPath, [CLI, '--json', '--full', ...args], { cwd: repo, env, encoding: 'utf8' });
  log.push(`$ done-done ${args.join(' ')}\n${r.stdout}${r.stderr}\nexit: ${r.status}`);
  assert.equal(r.status, code, r.stdout + r.stderr);
  return JSON.parse(r.stdout);
};
try {
  // Three distinct valid screens. Pixels are synthetic; only the CLI contract is under test.
  const png = (seed) => {
    const chunk = (type, data) => {
      const len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(data.length);
      crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])));
      return Buffer.concat([len, Buffer.from(type), data, crc]);
    };
    const w = 200, h = 120, raw = Buffer.alloc(h * (w * 3 + 1));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([(x * 3 + seed) % 256, y * 5 % 256, (x + y) % 256], y * (w * 3 + 1) + 1 + x * 3);
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  };
  const judge = join(dir, 'judge.cjs');
  writeFileSync(judge, `#!${process.execPath}
const fs = require('node:fs'); const ask = fs.readFileSync(0, 'utf8');
const design = ask.includes('blank-strip');
const interaction = ask.includes('Check this interaction on the real product');
if (design && !ask.includes('"mock"')) throw Error('comparison missing approved mock');
const keys = interaction ? ['interaction'] : design ? ['aspect','clipped-text','overlap','off-screen','blank-strip','squashed-text','layout'] : [...new Set([...ask.matchAll(/capture_\\d+/g)].map(m => m[0]))];
if (!keys.length) keys.push('relevance');
const answer = Object.fromEntries(keys.map(k => [k, {probabilities: interaction ? (process.env.DD_INTERACTION_MISSING ? {shown: .03, missing: .97} : {shown: .97, missing: .03}) : design ? (k === 'layout' && process.env.DD_UNSURE ? {defect: .5, none: .5} : process.env.DD_MISMATCH && k === 'layout' ? {defect: .95, none: .05} : {defect: .03, none: .97}) : {correct: .95, wrong: .03, unclear: .02}, rationale: 'Fixture reply.', personReason: 'Fixture layout comparison.', parts: [], covers: []}]));
fs.appendFileSync(${JSON.stringify(join(dir, 'calls.log'))}, design ? 'paired\\n' : 'relevance\\n');
process.stdout.write(JSON.stringify({response: JSON.stringify(answer)}));
`, { mode: 0o755 });
  writeFileSync(join(home, 'config.yaml'), `judge:\n  route: answerer:gemini\n  model: fixture\nagent_path_override: {gemini: ${JSON.stringify(judge)}}\n`);
  const screens = ['home', 'settings', 'today'];
  for (const [i, name] of screens.entries()) writeFileSync(join(repo, `${name}-mock.png`), png(i * 7));
  const contract = screens.map(screen => ({ screen, size: '200x120', theme: 'light', mock: `${screen}-mock.png`, capture: `${screen}.png` }));
  const config = `app: fixture\nevidence: {root: .proof}\napproved_design: ${JSON.stringify(contract)}\n`;
  writeFileSync(join(repo, '.done-done.yaml'), config);
  writeFileSync(join(repo, '.gitignore'), '.proof/\n');
  git('init', '-q', '-b', 'main'); git('add', '-A'); git('commit', '-qm', 'approved three-screen design');
  const open = dd(0, 'run', '--open');
  const root = join(repo, open.evidence_root);
  for (const name of screens.slice(0, 2)) writeFileSync(join(root, `${name}.png`), readFileSync(join(repo, `${name}-mock.png`)));
  writeFileSync(join(root, 'steps.json'), JSON.stringify({ target: { version: '1' }, start: 'approved design', steps: ['open all screens'], result: 'design done and release ready' }));
  dd(0, 'run', '--close', open.run_id);
  const files = screens.map(s => join(root, `${s}.png`));
  const missing = dd(1, 'check', '--outcome', 'design done', ...files.slice(0, 2));
  assert.equal(missing.result, 'fail'); assert.match(JSON.stringify(missing), /today.*200x120.*light.*no live capture/);
  dd(1, 'receipt', '--outcome', 'release ready', ...files.slice(0, 2));
  writeFileSync(files[2], readFileSync(join(repo, 'today-mock.png')));
  assert.match(JSON.stringify(dd(1, 'check', '--outcome', 'design done', ...files)), /today.*no live capture/, 'an unsealed capture cannot fill the contract');
  // A new sealed run adds the missing live capture, without changing the approval.
  const complete = dd(0, 'run', '--open');
  complete.evidence_root = join(repo, complete.evidence_root);
  for (const name of screens) writeFileSync(join(complete.evidence_root, `${name}.png`), readFileSync(join(repo, `${name}-mock.png`)));
  writeFileSync(join(complete.evidence_root, 'steps.json'), readFileSync(join(root, 'steps.json')));
  dd(0, 'run', '--close', complete.run_id);
  const all = screens.map(s => join(complete.evidence_root, `${s}.png`));
  const pass = dd(0, 'check', '--outcome', 'design done', ...all);
  assert.equal(pass.interaction_checklist, undefined, 'legacy approved-design checks are unchanged without opt-in');
  assert.equal(pass.design.length, 3); assert.ok(pass.design.every(s => s.verdict === 'pass' && s.mock));
  assert.equal(readFileSync(join(dir, 'calls.log'), 'utf8').split('paired\n').length - 1, 3);
  const receipt = dd(0, 'receipt', '--outcome', 'release ready', ...all);
  dd(0, 'receipt', '--verify', 'HEAD');
  const mock = readFileSync(join(repo, 'today-mock.png'));
  writeFileSync(join(repo, 'today-mock.png'), png(23));
  assert.match(JSON.stringify(dd(1, 'receipt', '--verify', 'HEAD')), /today-mock.png/, 'the receipt binds the reference bytes too');
  assert.match(dd(2, 'check', '--outcome', 'design done', ...all).error, /approved mock differs from the committed reference/);
  writeFileSync(join(repo, 'today-mock.png'), mock);
  // A changed judge model invalidates the cache; an unsure or mismatching design cannot pass.
  env.DD_MISMATCH = '1';
  writeFileSync(join(home, 'config.yaml'), readFileSync(join(home, 'config.yaml'), 'utf8').replace('model: fixture', 'model: mismatch'));
  const bad = dd(1, 'check', '--outcome', 'release ready', ...all);
  assert.ok(bad.design.every(s => s.verdict === 'fail')); assert.match(JSON.stringify(bad), /today.*200x120.*light/);
  delete env.DD_MISMATCH; env.DD_UNSURE = '1';
  writeFileSync(join(home, 'config.yaml'), readFileSync(join(home, 'config.yaml'), 'utf8').replace('model: mismatch', 'model: unsure'));
  const unsure = dd(1, 'check', '--outcome', 'release ready', ...all);
  assert.ok(unsure.design.every(s => s.verdict === 'unsure')); assert.match(JSON.stringify(unsure), /match not proven/);
  // Opt-in coverage still uses the real run/check/receipt path. The optimistic adapter must never pass an item without a frame.
  delete env.DD_UNSURE;
  writeFileSync(join(home, 'config.yaml'), readFileSync(join(home, 'config.yaml'), 'utf8').replace('model: unsure', 'model: interactions'));
  const ids = Object.keys(JSON.parse(readFileSync(new URL('../skills/done-done/interaction-checklist.json', import.meta.url), 'utf8')));
  const checklist = Object.fromEntries(ids.filter(id => !['empty-next-step', 'instant-state'].includes(id)).map(id => [id, {not_applicable: 'Fixture has no such surface'}]));
  checklist['empty-next-step'] = { captures: ['home.png'] };
  const wire = () => {
    writeFileSync(join(repo, '.done-done.yaml'), config + `interaction_checklist: ${JSON.stringify(checklist)}\n`);
    git('add', '.done-done.yaml'); git('commit', '-qm', 'wire interaction checklist');
    const run = dd(0, 'run', '--open');
    const root = join(repo, run.evidence_root);
    for (const name of screens) writeFileSync(join(root, `${name}.png`), readFileSync(join(repo, `${name}-mock.png`)));
    writeFileSync(join(root, 'steps.json'), JSON.stringify({target: {version: '1'}, start: 'fixture', steps: ['open all screens'], result: 'design done and release ready'}));
    dd(0, 'run', '--close', run.run_id);
    return screens.map(s => join(root, `${s}.png`));
  };
  let wired = wire();
  const flagged = dd(1, 'check', '--outcome', 'design done', ...wired);
  assert.equal(flagged.interaction_checklist.length, 6);
  assert.equal(flagged.interaction_checklist.find(r => r.id === 'empty-next-step').status, 'pass');
  assert.equal(flagged.interaction_checklist.find(r => r.id === 'instant-state').status, 'flagged');
  assert.equal(flagged.interaction_checklist.filter(r => r.status === 'not_applicable').length, 4);
  dd(1, 'receipt', '--outcome', 'release ready', ...wired);
  checklist['instant-state'] = {not_applicable: 'Fixture has no send or answer action'};
  wired = wire();
  const good = dd(0, 'receipt', '--outcome', 'release ready', ...wired);
  const verified = dd(0, 'receipt', '--verify', 'HEAD');
  assert.equal(verified.judge.interaction_checklist.find(r => r.id === 'empty-next-step').captures.length, 1);
  const receiptFile = join(repo, good.receipt);
  const saved = readFileSync(receiptFile, 'utf8');
  const damaged = JSON.parse(saved); damaged.judge.interaction_checklist[0].status = 'flagged';
  writeFileSync(receiptFile, JSON.stringify(damaged));
  assert.match(dd(1, 'receipt', '--verify', 'HEAD').reason, /malformed interaction-checklist/);
  writeFileSync(receiptFile, saved);
  env.DD_INTERACTION_MISSING = '1';
  writeFileSync(join(home, 'config.yaml'), readFileSync(join(home, 'config.yaml'), 'utf8').replace('model: interactions', 'model: interaction-negative'));
  assert.equal(dd(1, 'check', '--outcome', 'design done', ...wired).interaction_checklist.find(r => r.id === 'empty-next-step').status, 'flagged', 'a judge-rejected frame cannot pass');
  for (const bad of [{typo: {captures: ['home.png']}}, {'empty-next-step': {not_applicable: ' '}}, {'empty-next-step': {captures: ['../home.png']}}, {'empty-next-step': {captures: ['home.png'], not_applicable: 'no'}}]) {
    writeFileSync(join(repo, '.done-done.yaml'), config + `interaction_checklist: ${JSON.stringify(bad)}\n`);
    assert.match(dd(2, 'run', '--open').error, /interaction_checklist needs/);
  }
  for (const rows of [[], [contract[0], contract[0]], [{ ...contract[0], mock: '../outside.png' }], [{ ...contract[0], capture: '../outside.png' }]]) {
    writeFileSync(join(repo, '.done-done.yaml'), `app: fixture\napproved_design: ${JSON.stringify(rows)}\n`);
    assert.match(dd(2, 'run', '--open').error, /approved_design must be/);
  }
  // Retro cause 2: approval coverage beyond the listed screens. Each negative control names what is uncovered; the positive case passes.
  const seal = (names) => {
    const run = dd(0, 'run', '--open');
    const root = join(repo, run.evidence_root);
    for (const name of names) writeFileSync(join(root, `${name}.png`), readFileSync(join(repo, name === 'logo' ? 'design/logo.png' : `${name}-mock.png`)));
    writeFileSync(join(root, 'steps.json'), JSON.stringify({ target: { version: '1' }, start: 'fixture', steps: ['open all screens'], result: 'design done' }));
    dd(0, 'run', '--close', run.run_id);
    return names.map(n => join(root, `${n}.png`));
  };
  const commit = (yaml, msg) => { writeFileSync(join(repo, '.done-done.yaml'), yaml); git('add', '-A'); git('commit', '-qm', msg); };
  mkdirSync(join(repo, 'design'));
  writeFileSync(join(repo, 'design', 'logo.png'), png(41));
  writeFileSync(join(repo, 'design', 'spare.png'), png(43));
  commit(config, 'approved reference images outside the manifest');
  const unlisted = dd(1, 'check', '--outcome', 'design done', ...seal(screens));
  assert.match(JSON.stringify(unlisted), /approved reference material is not in the approved_design manifest: design\/logo\.png, design\/spare\.png/);
  const requirementsYaml = (rows) => config + `approved_requirements: ${JSON.stringify(rows)}\n`;
  const exclusion = { kind: 'reference', name: 'design/spare.png', exclusion: 'owner dropped the spare illustration' };
  commit(requirementsYaml([{ kind: 'asset', name: 'logo', capture: 'logo.png', mock: 'design/logo.png' }, exclusion]), 'approved logo asset, spare excluded');
  const uncovered = dd(1, 'check', '--outcome', 'design done', ...seal(screens));
  assert.match(JSON.stringify(uncovered), /asset logo: no live capture \(logo\.png\)/, 'an approved asset with no live capture is rejected');
  const covered = dd(0, 'check', '--outcome', 'design done', ...seal([...screens, 'logo']));
  assert.equal(covered.design.length, 3); assert.deepEqual(covered.approved_exclusions, [exclusion].map(({ kind, name, exclusion }) => ({ kind, name, exclusion })));
  // Without any manifest, a design claim has nothing approved to compare to, however well it renders.
  commit(`app: fixture\nevidence: {root: .proof}\n`, 'no manifest');
  assert.match(JSON.stringify(dd(1, 'check', '--outcome', 'design done', ...seal(['home']))), /not compared to approved result/);
  for (const rows of [[], [{ kind: 'asset', name: 'logo', capture: 'logo.png', exclusion: 'both' }], [{ kind: 'asset', name: 'logo', exclusion: ' ' }], [{ kind: 'sound', name: 'x', exclusion: 'no' }]]) {
    writeFileSync(join(repo, '.done-done.yaml'), `app: fixture\napproved_requirements: ${JSON.stringify(rows)}\n`);
    assert.match(dd(2, 'run', '--open').error, /approved_requirements must be/);
  }
  assert.ok(receipt.receipt);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'steps.json'), JSON.stringify({
    target: { version: JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version }, start: 'built CLI and an isolated three-screen approved design',
    steps: ['seal two live screens and check design done: Today fails by name', 'add Today in a new sealed run: all three paired verdicts pass', 'verify the receipt and reject an edited mock', 'reject mismatching and unsure comparisons and malformed inventories', 'wire six interaction items: a frame passes, no frame is flagged, absent surfaces have reasons', 'seal and verify a passing checklist receipt, reject a malformed verdict and judge-rejected frame', 'reject an unlisted reference image, an uncovered requirement (asset with no live capture) and a design claim not compared to an approved reference, then pass the covered manifest with its exclusion reported'],
    result: 'approved-design coverage fails missing Today and uncovered requirements, passes complete matching screens, and refuses non-matches and unsealed captures',
  }));
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'approved-design.log'), log.join('\n') + '\n');
  rmSync(dir, { recursive: true, force: true });
}
