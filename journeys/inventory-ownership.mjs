// inventory-ownership journey: the real `done-done lint` and `done-done run` on a throwaway repo that keeps a test inventory.
// A stray test file fails lint by name, a hand edit to an owned journey script fails, and the same edit made by a journey
// command (done-done run) passes. Runs from the done-done repo root with DONE_DONE_EVIDENCE_ROOT set by `done-done run inventory-ownership`.
import { execFileSync, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(process.cwd(), 'dist', 'cli.js');
const OUT = process.env.DONE_DONE_EVIDENCE_ROOT;
if (!OUT) { console.error('inventory-ownership: run via `done-done run inventory-ownership`'); process.exit(2); }

const tmp = mkdtempSync(join(tmpdir(), 'dd-inventory-'));
try {
  const repo = join(tmp, 'repo'), evidence = join(tmp, 'evidence'), report = join(tmp, 'report.md');
  mkdirSync(join(repo, 'journeys'), { recursive: true });
  mkdirSync(join(repo, 'test'));
  mkdirSync(evidence);
  const env = { ...process.env, DONE_DONE_HOME: join(tmp, 'home'), GIT_AUTHOR_NAME: 'Umer', GIT_AUTHOR_EMAIL: 'umer@example.com', GIT_COMMITTER_NAME: 'Umer', GIT_COMMITTER_EMAIL: 'umer@example.com' };
  delete env.DONE_DONE_RUN_ID;
  const git = (...a) => execFileSync('git', a, { cwd: repo, env, stdio: 'pipe' });
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
    'journeys/smoke.mjs': { owner: 'smoke', sha256: sha('journeys/smoke.mjs') },
    'test/notes.test.mjs': { owner: 'notes-suite', sha256: sha('test/notes.test.mjs') },
  }));
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'init');
  writeFileSync(report, '## Checks\noutcome: test ownership is enforced\nrepro: n/a: no bug\nproof: no verify skill - done-done lint\nevidence: not proven: fixture\n');

  const log = [];
  const step = (title, r, code, expect) => {
    const out = (r.stdout + r.stderr).trim();
    log.push(`$ ${title}\n${out}\nexit ${r.status}\n`);
    assert.equal(r.status, code, `${title}\n${out}`);
    assert.match(out, expect, title);
  };
  const lint = () => dd('lint', report, evidence);

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

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'inventory-ownership.log'), log.join('\n'));
  writeFileSync(join(OUT, 'steps.json'), JSON.stringify({
    target: { version: JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version },
    start: 'a repo whose two test files are owned in .done-done-inventory.json',
    steps: ['lint with every test file owned', 'add a stray test file and lint', 'hand-edit an owned journey script and lint', 'make the same edit from a done-done run and lint'],
    result: 'lint names a stray test file and a hand edit, and passes the same edit made by a journey command',
  }));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
