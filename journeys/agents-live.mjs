// Live installed-agent journey: no copied logins, API keys, stubs or browser.
// Select DONE_DONE_LIVE_AGENT and DONE_DONE_LIVE_MODEL explicitly; judge uses existing Claude sign-in.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = process.env.DONE_DONE_TEST_CLI || join(process.cwd(), 'dist/cli.js');
const OUT = process.env.DONE_DONE_EVIDENCE_ROOT;
const AGENT = process.env.DONE_DONE_LIVE_AGENT;
const MODEL = process.env.DONE_DONE_LIVE_MODEL;
assert.ok(OUT && ['claude', 'codex', 'opencode'].includes(AGENT) && MODEL,
  'run via done-done run agents-live with DONE_DONE_LIVE_AGENT and DONE_DONE_LIVE_MODEL');
const scratch = mkdtempSync(join(tmpdir(), 'dd-agents-live-'));
const repo = join(scratch, 'notes');
mkdirSync(repo);
const env = { ...process.env, DONE_DONE_HOME: join(scratch, 'config'),
  GIT_AUTHOR_NAME: 'sample', GIT_AUTHOR_EMAIL: 'sample@example.com',
  GIT_COMMITTER_NAME: 'sample', GIT_COMMITTER_EMAIL: 'sample@example.com' };
for (const k of ['DONE_DONE_EVIDENCE_ROOT', 'DONE_DONE_RUN_ID']) delete env[k];
const log = [];
const run = (bin, args) => {
  const r = spawnSync(bin, args, { cwd: repo, env, encoding: 'utf8', timeout: 180_000, maxBuffer: 16 << 20 });
  log.push(`$ ${bin === process.execPath ? 'done-done' : bin} ${args.filter(a => a !== CLI).join(' ')}\n${r.stdout || ''}${r.stderr || ''}\nexit: ${r.status}`);
  assert.equal(r.status, 0, r.error?.message || log.at(-1));
  return r.stdout;
};
const dd = (...args) => JSON.parse(run(process.execPath, [CLI, '--json', ...args]));
const git = (...args) => run('git', args);
try {
  writeFileSync(join(repo, 'README.md'), '# Notes CLI\nUse NOTES_DATA=<own file> node notes.mjs add Umer, then NOTES_DATA=<same file> node notes.mjs list. Run node drive.mjs for the isolated core journey. No package or release artifact is shipped.\n');
  writeFileSync(join(repo, 'notes.mjs'), `import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const file = process.env.NOTES_DATA;
if (!file) throw new Error('set NOTES_DATA to your own file');
const notes = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
if (process.argv[2] === 'add') { notes.push(process.argv[3]); writeFileSync(file, JSON.stringify(notes)); console.log('Added ' + process.argv[3]); }
else if (process.argv[2] === 'list') console.log(notes.join('\\n'));
else throw new Error('use add <name> or list');
`);
  writeFileSync(join(repo, 'drive.mjs'), `import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'notes-drive-'));
try {
  const env = { ...process.env, NOTES_DATA: join(dir, 'notes.json') };
  const add = execFileSync(process.execPath, ['notes.mjs', 'add', 'Umer'], { env, encoding: 'utf8' });
  const list = execFileSync(process.execPath, ['notes.mjs', 'list'], { env, encoding: 'utf8' });
  writeFileSync(join(process.env.DONE_DONE_EVIDENCE_ROOT, 'notes.txt'), '$ notes add Umer\\n' + add + '$ notes list\\n' + list + 'exit: 0\\n');
  writeFileSync(join(process.env.DONE_DONE_EVIDENCE_ROOT, 'steps.json'), JSON.stringify({ target: { version: 'sample-1' }, start: 'an empty private notes file', steps: ['add Umer', 'list notes'], result: 'Umer appears in the notes list' }));
} finally { rmSync(dir, { recursive: true, force: true }); }
`);
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-qm', 'Notes CLI');
  // Baseline fails here for Codex: init refused every tool-less reader, even with no MCP config.
  const init = dd('init', '--agent', AGENT, '--model', MODEL, '--judge', 'claude', '--judge-model', 'claude-haiku-5-5');
  assert.match(init.verify_skill, /^written/);
  dd('init', '--journey', 'notes', '--core', '--', 'node', 'drive.mjs');
  git('add', '.'); git('commit', '-qm', 'Configure verification');
  const probe = dd('doctor', '--probe');
  assert.equal(probe.checks.find(c => c.check === 'probe').status, 'ok', 'must actually probe, never a warning');
  const captured = dd('run', 'notes');
  const capture = [].concat(captured.evidence).find(p => p.endsWith('notes.txt'));
  assert.ok(capture);
  const outcome = 'Umer appears in the notes list';
  const checked = dd('check', '--outcome', outcome, capture);
  assert.equal(checked.result, 'pass');
  assert.equal(dd('receipt', '--outcome', outcome, capture).result, 'pass');
  log.push(`PASS ${AGENT} (${MODEL}): init wrote a verify skill; doctor --probe answered; real add/list capture judged and receipted.`, readFileSync(capture, 'utf8'));
} catch (e) {
  log.push(`FAIL ${AGENT}: ${e.message}`);
  process.exitCode = 1;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${AGENT}.real-product.log`), log.join('\n') + '\n');
  writeFileSync(join(OUT, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version },
    start: 'a fresh tracked Notes CLI repo; installed signed-in agents retain their normal HOME',
    steps: [`init with ${AGENT} at ${MODEL}`, 'record the core journey and commit', 'doctor --probe', 'run notes', 'check the real output with the live Claude judge', 'record receipt'],
    result: process.exitCode ? `${AGENT} failed; see transcript` : `${AGENT} init, probe and judged capture passed` }));
  rmSync(scratch, { recursive: true, force: true });
  console.error(log.at(-1));
}
