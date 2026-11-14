#!/usr/bin/env node
// Check on a repo of many journeys over one script web (700 journeys and 2,700 tracked files once ran it for ever): the plain
// checks answer in seconds with the right verdict, and check.timeout stops a check that is slow anyway, naming the evidence
// line it was judging. Runs the built CLI on throwaway repos; every name in them is neutral.
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from 'node:process';

const { DONE_DONE_EVIDENCE_ROOT: evidence } = env;
if (!evidence) throw new Error('missing DONE_DONE_EVIDENCE_ROOT');

const cli = join(process.cwd(), 'dist/cli.js');
const dir = mkdtempSync(join(tmpdir(), 'fan-out-'));
let log = '';
try {
  const gitConfig = join(dir, 'gitconfig');
  writeFileSync(gitConfig, '');
  // Every check here stops before the judge is asked, so none runs; the config only names the route, as the fleet's does.
  mkdirSync(join(dir, 'home'));
  writeFileSync(join(dir, 'home', 'config.yaml'), 'judge:\n  route: claude-code\n  model: claude-haiku-5-5\n');
  const host = Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('GIT_CONFIG')));
  const base = { ...host, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1', DONE_DONE_EVIDENCE_ROOT: undefined, DONE_DONE_RUN_ID: undefined, DONE_DONE_HOME: join(dir, 'home'), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const git = (repo, ...a) => spawnSync('git', a, { cwd: repo, env: base, encoding: 'utf8' });
  const dd = (repo, ...args) => {
    const started = Date.now();
    const r = spawnSync('node', [cli, ...args], { cwd: repo, encoding: 'utf8', env: base, timeout: 120_000 });
    const out = `${r.stdout}${r.stderr}`;
    log += `$ done-done ${args.join(' ')}\nexit ${r.status}, ${((Date.now() - started) / 1000).toFixed(1)}s\n${out.slice(0, 700)}\n\n`;
    return { status: r.status, out, seconds: (Date.now() - started) / 1000 };
  };

  // A repo whose journeys all run one web of scripts: lib/mN.sh sources the next and names a score of others.
  const journeys = 300;
  const files = 800;
  const fan = join(dir, 'fan');
  mkdirSync(join(fan, 'lib'), { recursive: true });
  writeFileSync(join(fan, '.gitignore'), '.proof/\n');
  writeFileSync(join(fan, 'make.mjs'), "import { mkdirSync, writeFileSync } from 'node:fs';\nconst out = '.proof/' + process.argv[2];\nmkdirSync(out, { recursive: true });\nwriteFileSync(out + '/result.txt', 'the notes list shows 2 notes\\n');\nwriteFileSync(out + '/steps.json', JSON.stringify({ target: { version: '1.0.0' }, start: 'a fresh notes app', steps: ['open the list'], result: 'the notes list shows 2 notes' }));\n");
  writeFileSync(join(fan, 'other.mjs'), '// the core journey\n');
  writeFileSync(join(fan, '.done-done.yaml'), 'app: fan\nevidence:\n  root: .proof\njourneys:\n  shots:\n    command: node make.mjs ${RUN_ID}\n  other:\n    command: node other.mjs\n    core: true\n' + Array.from({ length: journeys }, (_, j) => `  fan${j}:\n    command: bash lib/m0.sh\n`).join(''));
  for (let i = 0; i < files; i++)
    writeFileSync(join(fan, 'lib', `m${i}.sh`), `#!/bin/bash\n. lib/m${(i + 1) % files}.sh\n${Array.from({ length: 25 }, (_, k) => `# see lib/m${(i * 7 + k * 13) % files}.sh`).join('\n')}\n`);
  git(fan, 'init', '-q', '-b', 'main');
  git(fan, 'add', '-A');
  git(fan, 'commit', '-qm', 'init');
  const run = dd(fan, 'run', 'shots', '--json');
  assert.equal(run.status, 0, run.out);
  const id = JSON.parse(run.out).run_id;
  const checks = join(dir, 'checks.md');
  writeFileSync(checks, `## Checks\noutcome: the notes list shows 2 notes\nrepro: n/a: no bug\nproof: no verify skill - \`done-done run shots\`\nevidence: .proof/${id}/result.txt, .proof/${id}/steps.json\n`);

  // The script of the run's own journey changed (the other journeys all run the web): the proof is stale, and the check says so at once.
  writeFileSync(join(fan, 'make.mjs'), `${readFileSync(join(fan, 'make.mjs'), 'utf8')}// changed\n`);
  git(fan, 'commit', '-qam', 'change the journey');
  const stale = dd(fan, 'check', '--from', checks);
  assert.equal(stale.status, 2, stale.out);
  assert.match(stale.out, /evidence is for commit \w+, HEAD is \w+ \(changed: make\.mjs\)/);
  assert.ok(stale.seconds < 30, `the check took ${stale.seconds}s`);

  // check.timeout: eight scripts of a megabyte each, one sourcing the next, take seconds to follow; one second stops the check.
  const slow = join(dir, 'slow');
  mkdirSync(join(slow, 'lib'), { recursive: true });
  for (const f of ['.gitignore', 'make.mjs', 'other.mjs']) writeFileSync(join(slow, f), readFileSync(join(fan, f)));
  writeFileSync(join(slow, '.done-done.yaml'), 'app: slow\ncheck:\n  timeout: 1s\nevidence:\n  root: .proof\njourneys:\n  shots:\n    command: node make.mjs ${RUN_ID}\n  other:\n    command: bash lib/h0.sh\n    core: true\n');
  for (let i = 0; i < 8; i++) writeFileSync(join(slow, 'lib', `h${i}.sh`), `. lib/h${i + 1}.sh\n${'"lib/a/b/c/d/../../../h0.sh" '.repeat(35_000)}\n`);
  git(slow, 'init', '-q', '-b', 'main');
  git(slow, 'add', '-A');
  git(slow, 'commit', '-qm', 'init');
  const slowRun = dd(slow, 'run', 'shots', '--json');
  assert.equal(slowRun.status, 0, slowRun.out);
  const slowId = JSON.parse(slowRun.out).run_id;
  const slowChecks = join(dir, 'slow-checks.md');
  writeFileSync(slowChecks, `## Checks\noutcome: the notes list shows 2 notes\nrepro: n/a: no bug\nproof: no verify skill - \`done-done run shots\`\nevidence: .proof/${slowId}/result.txt, .proof/${slowId}/steps.json\n`);
  writeFileSync(join(slow, 'unused.md'), '# a note no journey reads\n');
  git(slow, 'add', '-A');
  git(slow, 'commit', '-qm', 'add a note');
  const limited = dd(slow, 'check', '--from', slowChecks);
  assert.notEqual(limited.status, 0, limited.out);
  assert.match(limited.out, /check: stopped after 1s \(check\.timeout\) while judging the evidence line's file \.proof\/\S+\/result\.txt/);
  assert.ok(limited.seconds < 30, `the check took ${limited.seconds}s`);

  writeFileSync(join(evidence, 'check-fan-out.log'), log);
  writeFileSync(join(evidence, 'steps.json'), JSON.stringify({
    target: { version: JSON.parse(readFileSync('package.json', 'utf8')).version },
    start: `a repo of ${journeys} journeys over ${files} scripts with a sealed run, and a repo of eight slow scripts with check.timeout 1s`,
    steps: ['Change the script of the run\'s journey and check the earlier run', 'Check the repo of slow scripts under a one second limit'],
    result: `the first check named the changed journey script as stale in ${stale.seconds.toFixed(1)}s and the second stopped at check.timeout naming the evidence line (exit ${limited.status})`,
  }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
