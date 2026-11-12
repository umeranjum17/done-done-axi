#!/usr/bin/env node
// Selection audit proof: `done-done affected --audit <range>` finds a journey that failed at a receipted commit the feature map never
// selected, writes the file/journey pair to the feature that names the journey, prints recall, and then `affected` selects it.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const evidence = process.env.DONE_DONE_EVIDENCE_ROOT;
if (!evidence) throw new Error('missing DONE_DONE_EVIDENCE_ROOT');
const cli = join(process.cwd(), 'dist/cli.js');
const scratch = mkdtempSync(join(tmpdir(), 'affected-audit-'));
const gitConfig = join(scratch, 'gitconfig');
writeFileSync(gitConfig, '');
const host = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_CONFIG')));
const env = { ...host, HOME: scratch, DONE_DONE_HOME: join(scratch, 'dd-home'), GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Umer', GIT_AUTHOR_EMAIL: 'umer@example.com', GIT_COMMITTER_NAME: 'Umer', GIT_COMMITTER_EMAIL: 'umer@example.com' };
for (const k of ['DONE_DONE_DRIVE', 'DONE_DONE_RUN_ID', 'DONE_DONE_EVIDENCE_ROOT', 'CI']) delete env[k];
let log = '';
const dir = join(scratch, 'app');
const sh = (cmd, ...args) => {
  const r = spawnSync(cmd, args, { cwd: dir, env, encoding: 'utf8' });
  if (cmd === 'git' && r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r;
};
const dd = (...args) => {
  const r = sh('node', cli, '--json', ...args);
  log += `\n=== done-done ${args.join(' ')} (exit ${r.status}) ===\n${r.stdout}${r.stderr}`;
  return r;
};
const sig = (name) => `import { writeFileSync } from 'node:fs';\nimport { join } from 'node:path';\nwriteFileSync(join(process.env.DONE_DONE_EVIDENCE_ROOT, 'steps.json'), JSON.stringify({ target: { version: '1' }, start: 'fresh checkout', steps: ['run ${name}'], result: 'ok' }));\n`;

// Two journeys. shared.mjs is cited by the other-check feature only; app-check loads it by a computed path, so no static chain reaches it.
const files = {
  '.done-done.yaml': 'app: fixture\nevidence:\n  root: ../evidence\njourneys:\n  app-check:\n    command: node journeys/app.mjs\n  other-check:\n    command: node journeys/other.mjs\n',
  'journeys/app.mjs': `${sig('app-check')}await import(['./sha', 'red.mjs'].map((p, i) => (i ? p : new URL(p, import.meta.url).pathname.replace('/journeys/sha', '/tools/sha'))).join(''));\n`,
  'journeys/other.mjs': sig('other-check'),
  'tools/shared.mjs': 'export const ok = true;\n',
  '.agents/skills/done-done-verify-fixture/SKILL.md': '# Fixture\n\nLaunch: node journeys/app.mjs\n',
  '.agents/skills/done-done-verify-fixture/features/README.md': '# Features\n\n- [App](app.md) (core journey): the app\n- [Other](other.md): the other part\n',
  '.agents/skills/done-done-verify-fixture/features/app.md': '# App\n\nDrive: `done-done run app-check`.\n',
  '.agents/skills/done-done-verify-fixture/features/other.md': '# Other\n\nSource: tools/shared.mjs.\n\nDrive: `done-done run other-check`.\n',
};
try {
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), text);
  }
  sh('git', 'init', '-q', '-b', 'main'); sh('git', 'add', '-A'); sh('git', 'commit', '-qm', 'base');
  sh('git', 'checkout', '-qb', 'feat');
  // The change breaks app-check through the computed path; the map sends it to other-check only.
  writeFileSync(join(dir, 'tools/shared.mjs'), 'throw new Error("shared tool broke");\n');
  sh('git', 'add', '-A'); sh('git', 'commit', '-qm', 'break shared');
  const commit = sh('git', 'rev-parse', 'HEAD').stdout.trim();

  const names = (r) => JSON.parse(r.stdout).journeys.map((j) => j.name).sort().join(',');
  const before = names(dd('affected', 'main'));
  if (before !== 'other-check') throw new Error(`before the audit affected selected ${before}, not other-check`);

  // The full run: both journeys at the commit. app-check fails; other-check passes and gets the receipt.
  const failed = dd('run', 'app-check');
  if (failed.status === 0) throw new Error('app-check should fail at the broken commit');
  const passed = dd('run', 'other-check');
  const runId = JSON.parse(passed.stdout).run_id;
  if (!runId) throw new Error('other-check run has no run_id');
  const evid = join(scratch, 'evidence');
  mkdirSync(join(evid, '.done-done/receipts'), { recursive: true });
  const proof = join(evid, runId, 'steps.json');
  const sha256 = createHash('sha256').update(readFileSync(proof)).digest('hex');
  const rec = JSON.parse(readFileSync(join(evid, '.done-done/runs', `${runId}.json`), 'utf8'));
  writeFileSync(join(evid, '.done-done/receipts', `${commit}.json`), JSON.stringify({
    schema: 2, repo: dir, head: commit, tree: rec.tree, claim: 'other part works', result: 'pass', at: new Date().toISOString(),
    files: [{ path: `${runId}/steps.json`, sha256 }],
    runs: [{ run_id: runId, journey: 'other-check', command: rec.command, tool: rec.tool, steps: rec.steps }],
    judge: { route: 'stub', model: 'stub', independence: 'agent', author: null, verdicts: [{ path: `${runId}/steps.json`, sha256, verdict: 'pass' }] },
  }));

  const audit = dd('affected', '--audit', 'main..HEAD');
  const out = JSON.parse(audit.stdout);
  if (audit.status !== 0 || out.failures !== 1 || out.caught !== 0 || out.missed.length !== 1 || out.missed[0].journey !== 'app-check' || !out.missed[0].files.includes('tools/shared.mjs') || !out.recall.startsWith('0/1')) throw new Error(`audit did not find the one miss: ${audit.stdout}`);
  const feature = readFileSync(join(dir, '.agents/skills/done-done-verify-fixture/features/app.md'), 'utf8');
  if (!feature.includes('`tools/shared.mjs`') || !feature.includes('`run app-check`')) throw new Error(`the pair was not written to the app feature: ${feature}`);
  sh('git', 'add', '-A'); sh('git', 'commit', '-qm', 'map the audit miss');
  const after = names(dd('affected', 'main'));
  if (after !== 'app-check,other-check') throw new Error(`after the audit affected selected ${after}, not app-check,other-check`);
  const again = JSON.parse(dd('affected', '--audit', 'main..HEAD').stdout);

  if (sh('git', 'status', '--porcelain').stdout.trim()) throw new Error('a second audit changed the map again');
  log += `\n-> miss found: ${out.missed[0].journey} (${out.recall}); affected before: ${before}; after: ${after}; second audit missed ${again.missed.length}\n`;
  writeFileSync(join(evidence, 'affected-audit.log'), log);
  writeFileSync(join(evidence, 'steps.json'), JSON.stringify({
    target: { version: JSON.parse(readFileSync('package.json', 'utf8')).version },
    start: 'a throwaway repo with journeys app-check and other-check; a commit on a branch breaks app-check through a path no static chain reaches, and the feature map sends that file to other-check only; both journeys run at the commit and a receipt holds other-check',
    steps: [
      'Run `done-done affected main`: only other-check is selected',
      'Run `done-done affected --audit main..HEAD`: the failed app-check run at the receipted commit is a miss, recall 0/1, and tools/shared.mjs is written to the app feature',
      'Commit the map change and run `done-done affected main`: app-check is selected too',
      'Audit the same range again: nothing is added',
    ],
    result: `the audit found one miss (${out.recall}), mapped tools/shared.mjs to app-check, and affected then selected ${after}`,
  }, null, 2));
  console.log(log);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
