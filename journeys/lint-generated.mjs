// lint-generated journey: the real `done-done lint` on one 1,100-line PR whose only file is the repo's own generated gen/schema.js
// (read through a stand-in gh), with checks.generated_paths unset and then set. Both runs are rendered side by side in one PNG.
// Runs from the done-done repo root with DONE_DONE_EVIDENCE_ROOT and DONE_DONE_RUN_ID set by `done-done run lint-generated`.
import { execFileSync, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(process.cwd(), 'dist', 'cli.js');
const OUT = process.env.DONE_DONE_EVIDENCE_ROOT;
const RUN_ID = process.env.DONE_DONE_RUN_ID;
if (!OUT || !RUN_ID) { console.error('lint-generated: run via `done-done run lint-generated`'); process.exit(2); }

const tmp = mkdtempSync(join(tmpdir(), 'dd-lintgen-'));
try {
  const repo = join(tmp, 'repo'), bin = join(tmp, 'bin'), evidence = join(tmp, 'evidence');
  for (const d of [repo, bin, evidence]) mkdirSync(d);
  const lines = Array.from({ length: 1100 }, (_, i) => `+export const field${i} = ${i};`);
  writeFileSync(join(tmp, 'pr.diff'), `diff --git a/gen/schema.js b/gen/schema.js\n--- /dev/null\n+++ b/gen/schema.js\n${lines.join('\n')}\n`);
  writeFileSync(join(tmp, 'pr.json'), JSON.stringify({
    author: { login: 'umer' }, title: 'feat: regenerate schema', headRefOid: 'head1', baseRefOid: 'base1', headRefName: 'feat/schema',
    files: [{ path: 'gen/schema.js', additions: 1100 }],
    body: '## Checks\noutcome: the schema is regenerated\nrepro: n/a: no bug\nproof: no verify skill - done-done lint\nevidence: not proven: fixture\n',
  }));
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\ncase "$*" in\n  "pr view"*) cat ${JSON.stringify(join(tmp, 'pr.json'))} ;;\n  "pr diff"*) cat ${JSON.stringify(join(tmp, 'pr.diff'))} ;;\n  *) echo "unexpected gh $*" >&2; exit 1 ;;\nesac\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, DONE_DONE_HOME: join(tmp, 'home') };

  const panel = (title, config, out, code, ok) => `<div style="flex:1;padding:0 14px"><div style="font:bold 20px sans-serif;margin-bottom:10px">${title}</div>
<div style="color:#8b98a5">.done-done.yaml</div><pre style="margin:4px 0 14px;color:#d2a8ff">${config}</pre>
<pre style="margin:4px 0">$ done-done lint &lt;PR 1,100 lines, gen/schema.js&gt;</pre><pre style="margin:4px 0;font:bold 20px monospace;white-space:pre-wrap;color:${ok ? '#3fb950' : '#f85149'}">${out}</pre><pre style="margin:4px 0;color:#8b98a5">exit ${code}</pre></div>`;
  const panels = [];
  const run = (title, keys, expect) => {
    const config = `app: "demo"\n${keys}`;
    writeFileSync(join(repo, '.done-done.yaml'), config);
    const r = spawnSync(process.execPath, [CLI, 'lint', 'https://github.com/acme/tool/pull/7', evidence], { cwd: repo, env, encoding: 'utf8' });
    assert.equal(r.status, expect ? 0 : 1, r.stdout + r.stderr);
    const out = r.stdout.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;');
    assert.ok(expect ? out === 'PASS' : out.startsWith('FAIL: 1100 added non-generated lines'), out);
    panels.push(panel(title, config.replace(/&/g, '&amp;'), out, r.status, expect));
  };
  run('BEFORE: checks.generated_paths not set', '', false);
  run('AFTER: checks.generated_paths: ["gen/**"] set', 'checks:\n  generated_paths: ["gen/**"]\n', true);
  const f = join(tmp, 'page.html');
  writeFileSync(f, `<!doctype html><meta charset=utf-8><body style="margin:0;background:#101418;color:#e6edf3;font:17px/1.5 monospace;padding:20px 6px"><div style="font:bold 22px sans-serif;padding:0 14px 14px">Same PR, run through the real done-done lint: one file, gen/schema.js, 1,100 added lines</div><div style="display:flex">${panels.join('')}</div>`);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'steps.json'), JSON.stringify({
    target: { version: JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version },
    start: 'a PR with one 1,100-line generated file, gen/schema.js',
    steps: ['lint it with checks.generated_paths unset', 'lint it again with checks.generated_paths set to gen/**'],
    result: 'lint fails the PR as 1,100 added lines before, and passes it once the generated path is set',
  }));
  execFileSync('chromium', ['--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${join(tmp, 'profile')}`, `--screenshot=${join(OUT, `${RUN_ID}.lint-generated-paths-before-after.png`)}`, '--window-size=1400,420', `file://${f}`], { stdio: 'ignore' });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
