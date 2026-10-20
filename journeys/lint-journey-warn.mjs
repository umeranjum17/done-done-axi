// lint-journey-warn journey: the real `done-done lint` on one PR through a stand-in gh, first with a diff that changes src/ and no journeys/
// file (WARN), then with a journeys/ file added (PASS). Each run's command output is a .txt capture.
// Runs from the done-done repo root with DONE_DONE_EVIDENCE_ROOT and DONE_DONE_RUN_ID set by `done-done run lint-journey-warn`.
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(process.cwd(), 'dist', 'cli.js');
const OUT = process.env.DONE_DONE_EVIDENCE_ROOT;
const RUN_ID = process.env.DONE_DONE_RUN_ID;
if (!OUT || !RUN_ID) { console.error('lint-journey-warn: run via `done-done run lint-journey-warn`'); process.exit(2); }

const tmp = mkdtempSync(join(tmpdir(), 'dd-lintwarn-'));
try {
  const repo = join(tmp, 'repo'), bin = join(tmp, 'bin'), evidence = join(tmp, 'evidence');
  for (const d of [repo, bin, evidence]) mkdirSync(d);
  writeFileSync(join(repo, '.done-done.yaml'), 'app: "demo"\n');
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\ncase "$*" in\n  "pr view"*) cat ${JSON.stringify(join(tmp, 'pr.json'))} ;;\n  *) echo "unexpected gh $*" >&2; exit 1 ;;\nesac\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, DONE_DONE_HOME: join(tmp, 'home') };
  mkdirSync(OUT, { recursive: true });
  const run = (name, files, expect) => {
    writeFileSync(join(tmp, 'pr.json'), JSON.stringify({
      author: { login: 'umer' }, title: 'feat: change the source', headRefOid: 'head1', baseRefOid: 'base1', headRefName: 'feat/source',
      files: files.map((path) => ({ path, additions: 10 })),
      body: '## Checks\noutcome: the source changed\nrepro: n/a: no bug\nproof: no verify skill - done-done lint\nevidence: not proven: fixture\n',
    }));
    const r = spawnSync(process.execPath, [CLI, 'lint', 'https://github.com/acme/tool/pull/7', evidence], { cwd: repo, env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stdout.startsWith(expect), r.stdout);
    writeFileSync(join(OUT, `${RUN_ID}.${name}.txt`), `$ done-done lint <PR changing: ${files.join(', ')}>\n${r.stdout}exit ${r.status}\n`);
  };
  run('lint-warn-src-no-journey', ['src/app.ts', 'README.md'], 'WARN: ');
  run('lint-pass-src-with-journey', ['src/app.ts', 'journeys/app.mjs'], 'PASS');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
