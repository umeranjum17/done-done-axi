// Real built-CLI integration journey; the judge transport is deterministic, not a visual-model proof.
// Two journeys, each with its own approved_requirements row: a claim for one must not be judged against the other's rows.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const CLI = process.env.DONE_DONE_TEST_CLI || fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const OUT = process.env.DONE_DONE_EVIDENCE_ROOT;
assert.ok(OUT, 'run via done-done run requirements-scope');
const dir = mkdtempSync(join(tmpdir(), 'dd-req-scope-'));
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
  // Distinct synthetic screens per journey; only the CLI contract is under test.
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
const spec = ask.includes('Check this written requirement');
const keys = spec ? ['requirement'] : [...new Set([...ask.matchAll(/capture_\\d+/g)].map(m => m[0]))];
if (!keys.length) keys.push('relevance');
const p = spec ? {shown: .98, missing: .02} : {correct: .97, wrong: .02, unclear: .01};
process.stdout.write(JSON.stringify({response: JSON.stringify(Object.fromEntries(keys.map(k => [k, {probabilities: p, rationale: 'Fixture reply.', personReason: 'The capture shows it.', parts: [], covers: []}])))}));
`, { mode: 0o755 });
  writeFileSync(join(home, 'config.yaml'), `judge:\n  route: answerer:gemini\n  model: fixture\nagent_path_override: {gemini: ${JSON.stringify(judge)}}\n`);
  const journeys = ['alpha', 'beta', 'gamma'];
  for (const [i, name] of journeys.entries()) for (const part of ['home', 'detail']) writeFileSync(join(repo, `${name}-${part}.png`), png(i * 11 + part.length));
  writeFileSync(join(repo, 'drive.mjs'), `import { copyFileSync, writeFileSync } from 'node:fs';
const name = process.argv[2], out = process.env.DONE_DONE_EVIDENCE_ROOT;
for (const part of ['home', 'detail']) copyFileSync(name + '-' + part + '.png', out + '/' + name + '-' + part + '.png');
writeFileSync(out + '/steps.json', JSON.stringify({target: {version: '1.0.0'}, start: 'a fresh ' + name + ' screen', steps: ['open the ' + name + ' screen'], result: name + ' renders'}));
`);
  writeFileSync(join(repo, '.gitignore'), '.proof/\n');
  const row = (name) => ({ kind: 'spec', name: `${name}-home`, requirement: `The ${name} home screen shows the ${name} list.`, capture: `${name}-home.png` });
  const config = (rows) => `app: fixture\nevidence: {root: .proof}\napproved_requirements: ${JSON.stringify(rows)}\njourneys:\n${journeys.map(n => `  ${n}:\n    command: node drive.mjs ${n}\n`).join('')}`;
  const commit = (rows, message) => { writeFileSync(join(repo, '.done-done.yaml'), config(rows)); git('add', '-A'); git('commit', '-qm', message, '--allow-empty'); };
  git('init', '-q', '-b', 'main');
  // A fresh run of each named journey: config changes need new captures at the new commit.
  const seal = (...names) => names.flatMap((n) => ['home'].map((part) => join(repo, dirname(dd(0, 'run', n).evidence[0].path), `${n}-${part}.png`)));
  const scoped = [ { ...row('alpha'), journey: 'alpha' }, { ...row('beta'), journey: 'beta' } ];
  const why = (r) => (r.findings ?? []).map((f) => f.why).join('; ') || r.error;

  // 1. Backward compatibility: rows with no scope keep their check on every claim, so beta's row still fails this one.
  commit([row('alpha'), row('beta')], 'two journeys, unscoped rows');
  const unscoped = dd(1, 'check', '--outcome', 'design done', ...seal('alpha'));
  assert.equal(unscoped.result, 'fail');
  assert.match(JSON.stringify(unscoped), /spec beta-home: no live capture \(beta-home\.png\)/, 'an unscoped row is still demanded of every claim');

  // 2. Scope: the same rows, each owned by its journey. A claim for alpha is judged only against alpha's row.
  commit(scoped, 'each row names its journey');
  const alpha = dd(0, 'check', '--outcome', 'design done', ...seal('alpha'));
  assert.equal(alpha.claim, 'design done');
  assert.deepEqual(alpha.approved_requirements.map((r) => r.name), ['alpha-home'], 'only the cited journey rows are judged');
  assert.ok(alpha.approved_requirements.every((r) => r.verdict === 'pass'));

  // 3. A row whose journey is cited stays enforced: alpha's own row with no capture fails this claim.
  commit([{ ...row('alpha'), journey: 'alpha', capture: 'alpha-absent.png' }, scoped[1]], 'alpha row names a capture nobody made');
  const missing = dd(1, 'check', '--outcome', 'design done', ...seal('alpha'));
  assert.match(JSON.stringify(missing), /spec alpha-home: no live capture \(alpha-absent\.png\)/, "a cited journey's own row is still enforced");

  // 4. The explicit exclusion stays the only way to skip a row, and it does not disarm the other journey's row.
  const skipped = { kind: 'color', name: 'alpha-accent', exclusion: 'owner dropped the alpha accent', journey: 'alpha' };
  commit([skipped, scoped[1]], 'alpha row excluded with a reason');
  const both = seal('alpha', 'beta');
  const excluded = dd(0, 'check', '--outcome', 'design done', ...both);
  assert.deepEqual(excluded.approved_exclusions, [{ kind: 'color', name: 'alpha-accent', exclusion: skipped.exclusion }]);
  assert.deepEqual(excluded.approved_requirements.map((r) => r.name), ['beta-home']);

  // 5. A claim with no approved basis for its own journeys is still refused.
  commit(scoped, 'two scoped rows');
  const unbasis = dd(1, 'check', '--outcome', 'design done', ...seal('gamma'));
  assert.match(JSON.stringify(unbasis), /not compared to approved result/, 'a claim citing no requirement row still has no approved basis');

  // 6. A scope that names no journey or verify-skill feature is refused, never a silently unchecked row.
  writeFileSync(join(repo, '.done-done.yaml'), config([{ ...row('alpha'), journey: 'delta' }, scoped[1]]));
  assert.match(dd(2, 'run', 'alpha').error, /journey "delta" is neither a configured journey nor a verify-skill feature/);

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'requirements-scope-summary.txt'), [
    'Per-journey approved_requirements scope, from the real CLI:',
    `unscoped rows (legacy): claim for alpha rejects beta's row: ${unscoped.result}: ${why(unscoped)}`,
    `scoped rows: claim for alpha passes, judged only against ${alpha.approved_requirements.map((r) => r.name).join(', ')} (basis: ${alpha.comparison_basis})`,
    `alpha's own row with no capture: ${missing.result}: ${why(missing)}`,
    `alpha's row excluded with a reason: ${excluded.result}, beta's cited row still judged, exclusions reported`,
    `claim citing a journey with no row: ${unbasis.result}: ${why(unbasis)}`,
  ].join('\n') + '\n');
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'requirements-scope.log'), log.join('\n') + '\n');
  rmSync(dir, { recursive: true, force: true });
}
