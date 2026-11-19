// Review base from the policy command: `done-done review` takes its base from `jg-item base <project>` when check.review_base is on.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'dist', 'cli.js');
const STUB = join(HERE, 'fixtures', 'review-base-policy', 'jg-item');

// A throwaway repo named `proj`, no origin: main, a trunk-x branch one commit ahead, and a lane commit on top of trunk-x.
function fixture(configLines = 'check:\n  review_base: true\n') {
  const dir = mkdtempSync(join(tmpdir(), 'done-done-review-base-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'proj'), bin = join(dir, 'bin'), home = join(dir, 'home');
  for (const d of [repo, bin, home]) mkdirSync(d, { recursive: true });
  writeFileSync(join(dir, 'gitconfig'), '');
  const host = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_CONFIG') && !k.startsWith('DONE_DONE')));
  const env = { ...host, GIT_CONFIG_GLOBAL: join(dir, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', DONE_DONE_HOME: home, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com', PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin` };
  const sh = (...a) => execFileSync('git', a, { cwd: repo, env, encoding: 'utf8', stdio: 'pipe' }).trim();
  const commit = (file, text, msg) => { writeFileSync(join(repo, file), text); sh('add', '-A'); sh('commit', '-qm', msg); };
  sh('init', '-q', '-b', 'main');
  commit('app.js', 'export const app = 1;\n', 'init');
  sh('checkout', '-q', '-b', 'trunk-x');
  commit('trunk.js', 'export const trunk = 1;\n', 'trunk work');
  sh('checkout', '-q', '-b', 'lane');
  commit('lane.js', 'export const lane = 1;\n', 'lane work');
  writeFileSync(join(home, 'config.yaml'), `agent: opencode\nagent_config:\n  opencode: { model: opencode-go/reviewer }\n${configLines}`);
  // The reviewer records its prompt (the diff under review) and finds nothing.
  const prompts = join(dir, 'prompts');
  mkdirSync(prompts);
  writeFileSync(join(bin, 'opencode'), `#!${process.execPath}
const { appendFileSync, readFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(join(prompts, 'all'))}, readFileSync(args[args.indexOf('-f') + 1], 'utf8') + '\\n=====\\n');
console.log(JSON.stringify({ type: 'text', part: { type: 'text', text: JSON.stringify({ findings: [] }) } }));
`, { mode: 0o755 });
  const baseFile = join(dir, 'base-ref');
  const review = (extra = {}, ...args) => spawnSync(process.execPath, [CLI, 'review', ...args], { cwd: repo, env: { ...env, ...extra }, encoding: 'utf8' });
  return { dir, repo, bin, env, sh, review, baseFile, prompts: () => (existsSync(join(prompts, 'all')) ? readFileSync(join(prompts, 'all'), 'utf8') : '') };
}

test('the review base is the policy command ref, and only the lane commit is reviewed', () => {
  const t = fixture();
  writeFileSync(t.baseFile, 'refs/heads/trunk-x\n');
  const r = t.review({ DONE_DONE_ITEM_CMD: STUB, STUB_BASE_FILE: t.baseFile });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /refs\/heads\/trunk-x/, 'the review base is the policy ref');
  const prompts = t.prompts();
  assert.match(prompts, /lane\.js/, 'the lane commit is reviewed');
  assert.doesNotMatch(prompts, /trunk\.js/, 'the trunk commit is not part of the diff');
});

test('a command that says there is no policy row refuses, and no reviewer starts', () => {
  const t = fixture();
  const r = t.review({ DONE_DONE_ITEM_CMD: STUB });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /no policy row for proj/);
  assert.equal(t.prompts(), '', 'no reviewer ran');
});

test('a missing command refuses by name', () => {
  const t = fixture();
  const r = t.review();
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /review base command not found: jg-item/);
  assert.equal(t.prompts(), '');
});

test('a named base still wins over the policy command', () => {
  const t = fixture();
  const r = t.review({ DONE_DONE_ITEM_CMD: STUB }, 'main');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(t.prompts(), /trunk\.js/, 'the named base main puts the trunk commit in the diff');
});

test('with the switch off the base is today\'s origin/HEAD, else main, guess', () => {
  const t = fixture('');
  const r = t.review({ DONE_DONE_ITEM_CMD: STUB });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout + r.stderr, /policy/, 'the command is never asked');
  assert.match(t.prompts(), /trunk\.js/, 'the diff runs from main');
});
