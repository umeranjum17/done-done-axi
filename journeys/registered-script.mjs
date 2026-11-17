#!/usr/bin/env node
// Registered script proof (Q6): `journey improve` and `journey enhance` rewrite a journey whose command runs a registered test script
// in place, keep the command, update the hash so lint passes, and name the file. Two registered scripts are covered: a Node test
// (`node test/export.test.mjs`) and a Bash test (`bash tests/greet.test.sh > "$DONE_DONE_EVIDENCE_ROOT/${RUN_ID}.log" 2>&1`) that
// drives a throwaway greeting CLI for Umer. A stub agent answers and inspects the real generator prompt for the existing source,
// so the proof needs no model and spends nothing.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const evidence = process.env.DONE_DONE_EVIDENCE_ROOT;
if (!evidence) throw new Error('missing DONE_DONE_EVIDENCE_ROOT');
const cli = join(process.cwd(), 'dist/cli.js');
const scratch = mkdtempSync(join(tmpdir(), 'registered-script-'));
const bin = join(scratch, 'bin'), ddHome = join(scratch, 'dd-home'), repo = join(scratch, 'tool'), proof = join(scratch, 'proof');
const greetRepo = join(scratch, 'greet'), greetProof = join(scratch, 'greet-proof');
for (const d of [bin, ddHome, join(repo, 'src'), join(repo, 'test'), join(repo, '.agents/skills/done-done-verify-tool/features'), proof,
  join(greetRepo, 'src'), join(greetRepo, 'tests'), join(greetRepo, '.agents/skills/done-done-verify-greet/features'), greetProof]) mkdirSync(d, { recursive: true });
const gitConfig = join(scratch, 'gitconfig');
writeFileSync(gitConfig, '');
const host = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_CONFIG')));
const env = { ...host, HOME: scratch, DONE_DONE_HOME: ddHome, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Umer', GIT_AUTHOR_EMAIL: 'umer@example.com', GIT_COMMITTER_NAME: 'Umer', GIT_COMMITTER_EMAIL: 'Umer@example.com' };
for (const k of ['DONE_DONE_DRIVE', 'DONE_DONE_RUN_ID', 'DONE_DONE_EVIDENCE_ROOT', 'CI']) delete env[k];
let log = '';
// Each repo gets its own git and done-done calls; `log` keeps every call's output for the evidence.
const at = (dir, extraEnv = {}) => {
  const sh = (cmd, ...args) => spawnSync(cmd, args, { cwd: dir, env: { ...env, ...extraEnv }, encoding: 'utf8' });
  const git = (...a) => { const r = sh('git', ...a); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const raw = (...args) => {
    const r = sh(process.execPath, cli, ...args);
    log += `$ done-done ${args.join(' ')}\n${r.stdout}${r.stderr}exit ${r.status}\n\n`;
    return r;
  };
  const dd = (code, ...args) => {
    const r = raw(...args);
    assert.equal(r.status, code, `done-done ${args.join(' ')}: ${r.stdout}${r.stderr}`);
    return r;
  };
  return { git, raw, dd };
};
const { git, dd } = at(repo);
const greetOps = at(greetRepo);

const entry = 'test/export.test.mjs';
const body = (extra) => `import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cli } from '../src/cli.js';
const out = cli('run');
assert.equal(out, 'ran\\n');${extra}
writeFileSync(join(process.env.DONE_DONE_EVIDENCE_ROOT, 'run.txt'), out);
`;
const extra = "\nassert.equal(cli('export'), 'exported\\n');";
const answer = (script) => ({ name: 'tool-run', title: 'Tool run', source: 'src/cli.js', script, checks: 'tool run prints ran; tool export prints exported.', spends: '', blocker: '' });
const stub = (script) => writeFileSync(join(bin, 'claude'), `#!${process.execPath}\nrequire('node:fs').readFileSync(0);\nprocess.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: '', structured_output: ${JSON.stringify(answer(script))} }));\n`, { mode: 0o755 });

// The Bash registered test. Its command keeps the evidence redirect; the script itself checks the greeting CLI's output.
const bashPath = 'tests/greet.test.sh';
const bashCmd = 'bash tests/greet.test.sh > "$DONE_DONE_EVIDENCE_ROOT/${RUN_ID}.log" 2>&1';
const bashName = 'greet-umer';
const bashFile = join(greetRepo, bashPath), invFile = join(greetRepo, '.done-done-inventory.json'), yamlFile = join(greetRepo, '.done-done.yaml');
const greetCli = '#!/usr/bin/env node\nprocess.stdout.write("Hello " + process.argv[2] + "\\n");\n';
// The regression: the greeting still prints Hello Umer, but it also warns on stderr, so only the new output assertion fails.
const greetNoisy = greetCli + 'process.stderr.write("warning: legacy greeting\\n");\n';
const bashHead = ['#!/usr/bin/env bash', 'set -euo pipefail', 'out="$(node src/greet.mjs Umer)"', '[ "$out" = "Hello Umer" ] || { echo "expected Hello Umer, got: $out" >&2; exit 1; }'];
const bashNoStderr = ['err="$(node src/greet.mjs Umer 2>&1 >/dev/null)"', '[ -z "$err" ] || { echo "expected no stderr, got: $err" >&2; exit 1; }'];
const bashOneLine = ['lines="$(node src/greet.mjs Umer | wc -l | tr -d " ")"', '[ "$lines" = "1" ] || { echo "expected one line, got $lines" >&2; exit 1; }'];
const bashEnd = ['echo "greet ok"', ''];
const bashBase = [...bashHead, ...bashEnd].join('\n');
const bashImproved = [...bashHead, ...bashNoStderr, ...bashEnd].join('\n');
const bashEnhanced = [...bashHead, ...bashNoStderr, ...bashOneLine, ...bashEnd].join('\n');
// Invalid Bash: the if has no fi, so bash -n refuses it.
const bashBroken = ['#!/usr/bin/env bash', 'if [ "$1" = Umer ]; then', 'echo "greet ok"', ''].join('\n');
const bashAnswer = (script) => ({ name: bashName, title: 'Greet Umer', source: 'src/greet.mjs', script, checks: 'greet prints Hello Umer; stderr stays empty; the output is one line.', spends: '', blocker: '' });
// The stub inspects the real generator prompt: it must carry the existing Bash source, or the stub fails the call.
// The stub compares the prompt with the raw existing source: JSON.stringify(existing) is a string literal that Node decodes when the stub runs, not a double-escaped comparison.
const stubBash = (script, existing) => writeFileSync(join(bin, 'claude'), `#!${process.execPath}\nconst prompt = require('node:fs').readFileSync(0, 'utf8');\nif (!prompt.includes(${JSON.stringify(existing)})) { console.error('the generator prompt does not carry the existing Bash source'); process.exit(1); }\nprocess.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: '', structured_output: ${JSON.stringify(bashAnswer(script))} }));\n`, { mode: 0o755 });
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const noJourneyFile = () => assert.equal(existsSync(join(greetRepo, 'journeys', `${bashName}.mjs`)), false, 'no journeys/<name>.mjs is written');
const logsHave = (root, text) => readdirSync(root, { recursive: true }).some((f) => String(f).endsWith('.log') && readFileSync(join(root, String(f)), 'utf8').includes(text));

const report = join(scratch, 'report.md');
let snapshot;
try {
  writeFileSync(join(ddHome, 'config.yaml'), `agent: claude\nagent_path_override: { claude: ${JSON.stringify(join(bin, 'claude'))} }\n`);
  writeFileSync(join(repo, '.done-done.yaml'), `app: tool\nevidence:\n  root: ${JSON.stringify(proof)}\njourneys:\n  tool-run:\n    command: node ${entry}\n`);
  writeFileSync(join(repo, '.agents/skills/done-done-verify-tool/SKILL.md'), '# Tool CLI\n\nLaunch: node src/cli.js run\n');
  writeFileSync(join(repo, '.agents/skills/done-done-verify-tool/features/README.md'), '# Features\n- [Tool run](tool-run.md): run `done-done run tool-run`\n');
  writeFileSync(join(repo, '.agents/skills/done-done-verify-tool/features/tool-run.md'), '# Tool run\n\nSource: `src/cli.js`. Run `done-done run tool-run`.\n');
  writeFileSync(join(repo, 'src/cli.js'), "export const cli = (cmd) => {\n  if (cmd === 'run') return 'ran\\n';\n  if (cmd === 'export') return 'exported\\n';\n};\n");
  writeFileSync(join(repo, entry), body(''));
  git('init', '-q', '-b', 'main'); git('add', '-A'); git('commit', '-qm', 'base');
  // inventory record is run-only, so the registered entry is committed with its hash directly
  const sha256 = createHash('sha256').update(readFileSync(join(repo, entry))).digest('hex');
  writeFileSync(join(repo, '.done-done-inventory.json'), JSON.stringify({ [entry]: { owner: 'tool-run', sha256 } }));
  writeFileSync(report, '## Checks\noutcome: a registered script is updated through journey improve\nrepro: n/a: no bug\nproof: done-done-verify-tool: done-done run tool-run\nevidence: not proven: fixture\n');
  git('add', '-A'); git('commit', '-qm', 'register the test script');
  const lint = () => dd(0, 'lint', report, proof);

  stub(body(extra));
  const improved = dd(0, '--json', 'journey', 'improve', 'tool-run', 'also check that tool export prints exported');
  assert.equal(JSON.parse(improved.stdout).dirty, true);
  assert.ok(improved.stderr.startsWith(`Stage writing: ${entry}\n`), 'the run shows writing and names the registered script');
  assert.match(readFileSync(join(repo, entry), 'utf8'), /'export'/, 'the registered script was rewritten in place');
  assert.match(readFileSync(join(repo, '.done-done.yaml'), 'utf8'), /command:[\s\S]*node test\/export\.test\.mjs\n/, 'the command is kept');
  assert.throws(() => readFileSync(join(repo, 'journeys/tool-run.mjs')), 'no second script is written');
  const after = JSON.parse(readFileSync(join(repo, '.done-done-inventory.json'), 'utf8'))[entry].sha256;
  assert.equal(after, createHash('sha256').update(readFileSync(join(repo, entry))).digest('hex'), 'the hash follows the rewritten script');
  lint();
  git('add', '-A'); git('commit', '-qm', 'improve registered script');

  // Bash: the Bash test is registered in its own throwaway repo, with the journey command that redirects its evidence.
  writeFileSync(join(greetRepo, 'src/greet.mjs'), greetCli);
  writeFileSync(bashFile, bashBase);
  writeFileSync(yamlFile, `app: greet\nevidence:\n  root: ${JSON.stringify(greetProof)}\njourneys:\n  ${bashName}:\n    command: ${JSON.stringify(bashCmd)}\n`);
  writeFileSync(join(greetRepo, '.agents/skills/done-done-verify-greet/SKILL.md'), '# Greet CLI\n\nLaunch: node src/greet.mjs Umer\n');
  writeFileSync(join(greetRepo, '.agents/skills/done-done-verify-greet/features/README.md'), '# Features\n- [Greet](greet.md): run `done-done run greet-umer`\n');
  greetOps.git('init', '-q', '-b', 'main'); greetOps.git('add', '-A'); greetOps.git('commit', '-qm', 'greet base');
  // An ordinary Bash helper that no journey runs is not a stray test: lint still passes beside the registered one.
  writeFileSync(join(greetRepo, 'tests/helper.sh'), 'echo helper\n');
  writeFileSync(invFile, JSON.stringify({ [bashPath]: { owner: bashName, sha256: sha(bashFile) } }));
  greetOps.git('add', '-A'); greetOps.git('commit', '-qm', 'register the bash test');
  assert.equal(greetOps.git('status', '--porcelain'), '');
  // Dirty trial: improve adds the output assertion, the journey keeps its command, and the hash follows.
  stubBash(bashImproved, bashBase);
  const imp = greetOps.dd(0, '--json', 'journey', 'improve', bashName, 'also check that greet writes nothing to stderr');
  assert.equal(JSON.parse(imp.stdout).dirty, true);
  assert.ok(imp.stderr.startsWith(`Stage writing: ${bashPath}\n`), 'the run shows writing and names the registered Bash test');
  assert.match(readFileSync(bashFile, 'utf8'), /expected no stderr/, 'the registered Bash test gained the output assertion');
  assert.ok(readFileSync(yamlFile, 'utf8').includes(JSON.stringify(bashCmd)), 'the Bash command is kept');
  noJourneyFile();
  assert.equal(JSON.parse(readFileSync(invFile, 'utf8'))[bashPath].sha256, sha(bashFile), 'the hash follows the rewritten Bash test');
  // Clean replay: commit, lint, and run the registered Bash test through done-done.
  greetOps.git('add', '-A'); greetOps.git('commit', '-qm', 'improve registered bash test');
  assert.equal(greetOps.git('status', '--porcelain'), '');
  greetOps.dd(0, 'lint', report, greetProof);
  greetOps.dd(0, 'run', bashName);
  assert.ok(logsHave(greetProof, 'greet ok'), 'the clean replay wrote its log beside the run');

  // Enhance: a second change to the same Bash test, dirty trial then clean replay.
  stubBash(bashEnhanced, bashImproved);
  const enh = greetOps.dd(0, '--json', 'journey', 'enhance', bashName, 'add a check that the greeting is one line');
  assert.equal(JSON.parse(enh.stdout).dirty, true);
  assert.ok(enh.stderr.startsWith(`Stage writing: ${bashPath}\n`), 'enhance names the registered Bash test it writes');
  assert.match(readFileSync(bashFile, 'utf8'), /expected one line/, 'the registered Bash test gained the one-line assertion');
  noJourneyFile();
  assert.equal(JSON.parse(readFileSync(invFile, 'utf8'))[bashPath].sha256, sha(bashFile), 'the hash follows the enhanced Bash test');
  greetOps.git('add', '-A'); greetOps.git('commit', '-qm', 'enhance registered bash test');
  assert.equal(greetOps.git('status', '--porcelain'), '');
  greetOps.dd(0, 'lint', report, greetProof);
  greetOps.dd(0, 'run', bashName);

  // Regression: the greeting warns on stderr. The stdout assertion still passes; the new output assertion fails the run.
  writeFileSync(join(greetRepo, 'src/greet.mjs'), greetNoisy);
  const red = greetOps.raw('run', bashName);
  assert.notEqual(red.status, 0, 'a regression in the greeting app fails the registered Bash test');
  assert.ok(logsHave(greetProof, 'expected no stderr'), 'the failing output assertion is in the run log');
  greetOps.git('checkout', '--', 'src/greet.mjs');
  assert.equal(greetOps.git('status', '--porcelain'), '');

  // Invalid Bash: refused before any project write, with a Bash reason.
  snapshot = { script: readFileSync(bashFile, 'utf8'), yaml: readFileSync(yamlFile, 'utf8'), inv: readFileSync(invFile, 'utf8') };
  stubBash(bashBroken, bashEnhanced);
  const bad = greetOps.raw('--json', 'journey', 'improve', bashName, 'make the test broken');
  assert.notEqual(bad.status, 0, 'invalid Bash is refused');
  assert.match(bad.stdout + bad.stderr, /invalid Bash; nothing written: .*syntax error/s, 'the refusal is the Bash syntax check and names Bash as the reason');
  assert.equal(readFileSync(bashFile, 'utf8'), snapshot.script, 'the Bash test was not written');
  assert.equal(readFileSync(yamlFile, 'utf8'), snapshot.yaml, 'the config was not written');
  assert.equal(readFileSync(invFile, 'utf8'), snapshot.inv, 'the inventory was not written');
  assert.equal(greetOps.git('status', '--porcelain'), '');
  noJourneyFile();

  // Missing registration: a Bash test absent from the inventory is refused with the inventory record command to run.
  writeFileSync(invFile, '{}\n');
  stubBash(bashEnhanced, bashEnhanced);
  const missing = greetOps.raw('--json', 'journey', 'improve', bashName, 'check once more');
  assert.notEqual(missing.status, 0, 'an unregistered Bash test is refused');
  assert.match(missing.stdout + missing.stderr, /inventory record/, 'the refusal names the inventory record command');
  assert.equal(readFileSync(bashFile, 'utf8'), bashEnhanced, 'the Bash test was not rewritten');
  writeFileSync(invFile, snapshot.inv);
  assert.equal(greetOps.git('status', '--porcelain'), '');
  noJourneyFile();

  // Inventory remains usable without project configuration, while run still validates it.
  const recording = at(greetRepo, { DONE_DONE_RUN_ID: 'fixture-run' });
  for (const config of [null, 'journeys: [invalid']) {
    writeFileSync(invFile, snapshot.inv);
    if (config === null) rmSync(yamlFile); else writeFileSync(yamlFile, config);
    writeFileSync(bashFile, bashEnhanced + '# changed\n'); const listing = greetOps.raw('--json', 'inventory');
    assert.notEqual(listing.status, 0); assert.match(listing.stdout + listing.stderr, /edited outside a done-done run/);
    recording.dd(0, 'inventory', 'record', bashPath); assert.equal(JSON.parse(readFileSync(invFile, 'utf8'))[bashPath].sha256, sha(bashFile));
    greetOps.dd(0, 'inventory');
    assert.notEqual(recording.raw('inventory', 'record', 'tests/helper.sh', '--owner', bashName).status, 0);
    if (config !== null) {
      const rejected = greetOps.raw('run', bashName); assert.notEqual(rejected.status, 0); assert.match(rejected.stdout + rejected.stderr, /\.done-done\.yaml/);
    }
    writeFileSync(bashFile, bashEnhanced);
  }
  writeFileSync(yamlFile, snapshot.yaml); writeFileSync(invFile, snapshot.inv);

  mkdirSync(evidence, { recursive: true });
  writeFileSync(join(evidence, 'registered-script.log'), log);
  writeFileSync(join(evidence, 'steps.json'), JSON.stringify({
    target: { version: JSON.parse(readFileSync('package.json', 'utf8')).version },
    start: 'two throwaway repos: a Node registered script test/export.test.mjs, and a Bash registered test tests/greet.test.sh that drives a greeting CLI for Umer; a stub agent that checks the generator prompt',
    steps: [
      'run done-done journey improve on the Node journey, then done-done lint',
      'run done-done journey improve on the Bash journey beside an unused tests/helper.sh, commit, and run done-done lint and done-done run on it',
      'run done-done journey enhance on the Bash journey, commit, and run done-done run on it',
      'break the greeting so it warns on stderr, and run done-done run on the Bash journey',
      'run done-done journey improve on an invalid Bash test, and on a Bash test missing from the inventory',
      'list and record inventory with missing and invalid config, and reject a run with invalid config',
    ],
    result: 'improve and enhance rewrote the registered scripts in place, kept the commands, updated the hashes and lint passed; the unused helper was not a stray; the Bash replay printed greet ok; the stderr regression failed the output assertion; invalid Bash and a missing registration were refused with no project write',
  }, null, 2));
  console.log(log);
} finally {
  if (!process.env.KEEP) rmSync(scratch, { recursive: true, force: true });
}
