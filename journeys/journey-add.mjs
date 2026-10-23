// Hosted-agent proof against a fresh CLI app; replays the saved journey with no agent configured.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const ROOT = process.cwd(), CLI = process.env.DONE_DONE_TEST_CLI || join(ROOT, 'dist/cli.js');
const OUT = process.env.DONE_DONE_EVIDENCE_ROOT;
const improve = process.argv.includes('--improve'), enhance = improve || process.argv.includes('--enhance');
assert.ok(OUT, 'run via done-done run journey-add, journey-enhance or journey-improve');
const { loadConfig, tilde } = await import(pathToFileURL(join(dirname(CLI), 'config.js')));
const cfg = loadConfig(ROOT);
assert.ok(cfg.agent, 'configure your own agent with done-done init --agent <agent> --model <model>');
const tmp = mkdtempSync(join(tmpdir(), 'dd-journey-add-')), repo = join(tmp, 'hello-umer');
const env = { ...process.env, DONE_DONE_HOME: join(tmp, 'dd'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'sample', GIT_AUTHOR_EMAIL: 'sample@example.com', GIT_COMMITTER_NAME: 'sample', GIT_COMMITTER_EMAIL: 'sample@example.com' };
delete env.DONE_DONE_RUN_ID; delete env.DONE_DONE_EVIDENCE_ROOT;
const log = [], say = s => { log.push(s); console.error(s); };
const git = (...args) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' }).trim();
const dd = (code, ...args) => {
  const r = spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd: repo, env, encoding: 'utf8', maxBuffer: 8 << 20 });
  say(`$ done-done ${args.join(' ')}\n${r.stdout}${r.stderr}\nexit: ${r.status}`);
  assert.equal(r.status, code, r.error?.message || r.stdout + r.stderr);
  return JSON.parse(r.stdout);
};
try {
  mkdirSync(repo, { recursive: true }); mkdirSync(env.DONE_DONE_HOME);
  writeFileSync(join(env.DONE_DONE_HOME, 'config.yaml'), JSON.stringify({ agent: cfg.agent, agent_config: cfg.agent_config, agent_path_override: cfg.agent_path_override, agent_args_override: cfg.agent_args_override, acpx_path: cfg.acpx_path, agent_timeout: cfg.agent_timeout }));
  const source = '// Safe demo CLI: no accounts, network or saved state. Usage: node app.mjs greet Umer\nif (process.argv[2] !== "greet") { console.log("Usage: greet <name>"); } else { console.log("Hello " + (process.argv[3] ?? "Umer")); }\n';
  writeFileSync(join(repo, 'app.mjs'), source);
  writeFileSync(join(repo, '.done-done.yaml'), 'app: hello-umer\n');
  const skill = join(repo, '.agents/skills/done-done-verify-hello-umer');
  mkdirSync(join(skill, 'features'), { recursive: true });
  writeFileSync(join(skill, 'SKILL.md'), '# Hello Umer CLI\n\nLaunch: node app.mjs greet Umer (no state or accounts). Capture terminal output.\n');
  writeFileSync(join(skill, 'features/README.md'), '# Features\n');
  git('init', '-q', '-b', 'main'); git('add', '-A'); git('commit', '-qm', 'Fresh greeting app and verify setup');
  const trial = dd(0, 'journey', 'add', 'run the greeting command for Umer and check that Hello Umer is printed');
  assert.equal(trial.dirty, true);
  const record = JSON.parse(readFileSync(tilde(trial.record), 'utf8')), name = record.journey;
  say(`Generated recipe:\n${readFileSync(join(repo, 'journeys', name + '.mjs'), 'utf8')}\n${git('diff')}`);
  assert.match(readFileSync(join(skill, 'features/README.md'), 'utf8'), new RegExp(name + '\\.md'));
  git('add', '-A'); git('commit', '-qm', 'Add generated greeting journey');
  if (enhance) {
    const focus = 'Preserve greeting Umer; add checks and captures for empty, whitespace, Unicode and 4096-character names, missing name and unknown command. Use only the existing CLI behavior.';
    const deeper = dd(0, 'journey', 'enhance', name, focus);
    assert.equal(deeper.dirty, true);
    assert.equal(JSON.parse(readFileSync(tilde(deeper.record), 'utf8')).journey, name);
    say(`Enhanced recipe:\n${readFileSync(join(repo, 'journeys', name + '.mjs'), 'utf8')}\n${git('diff')}`);
    assert.match(readFileSync(join(skill, 'features', name + '.md'), 'utf8'), /Enhanced coverage/);
    git('add', '-A'); git('commit', '-qm', 'Enhance generated greeting journey');
  }
  if (improve) {
    const instruction = 'Also assert that greeting Zoë prints exactly Hello Zoë with its original Unicode normalization; capture that output. Preserve all existing checks.';
    const improved = dd(0, 'journey', 'improve', name, instruction);
    assert.equal(improved.dirty, true);
    assert.equal(JSON.parse(readFileSync(tilde(improved.record), 'utf8')).journey, name);
    say(`Improved recipe:\n${readFileSync(join(repo, 'journeys', name + '.mjs'), 'utf8')}\n${git('diff')}`);
    assert.match(readFileSync(join(skill, 'features', name + '.md'), 'utf8'), /Enhanced coverage[\s\S]*Improved coverage[\s\S]*Instruction: Also assert/);
    assert.match(readFileSync(join(repo, '.done-done.yaml'), 'utf8'), /Improved instruction:/);
    git('add', '-A'); git('commit', '-qm', 'Improve generated greeting journey');
  }
  writeFileSync(join(env.DONE_DONE_HOME, 'config.yaml'), '');
  const replay = dd(0, 'run', name);
  assert.equal(replay.dirty, false);
  for (const file of replay.evidence) say(`Capture ${file}:\n${readFileSync(file, 'utf8')}`);
  writeFileSync(join(repo, 'app.mjs'), improve ? source.replace('(process.argv[3] ?? "Umer")', '(process.argv[3] ?? "Umer").normalize("NFD")') : enhance ? source.replace('?? "Umer"', '|| "Umer"') : source.replace('Hello ', 'Wrong '));
  dd(1, 'run', name);
  say(`PASS: description generated config, capture script and feature map; ${enhance ? 'enhance deepened the same journey; ' : ''}${improve ? 'improve applied the specific Unicode instruction; ' : ''}live trial and clean model-free replay captured Hello Umer; ${improve ? 'a regression only in the instructed Unicode check' : enhance ? 'a regression only in the new empty-name edge' : 'wrong output'} failed its checks.`);
  writeFileSync(join(OUT, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version }, start: 'fresh greeting CLI app with verify setup and the user-configured hosted agent', steps: ['journey add from a plain description', ...(enhance ? ['journey enhance the named greeting path with empty, whitespace, Unicode, long, missing-name and unknown-command checks'] : []), ...(improve ? ['journey improve the same path with an exact Unicode greeting assertion'] : []), 'review generated config, script and feature map', 'commit and run with no agent configured', 'change app output and observe a failed check'], result: `journey ${improve ? 'improve applies a specific instruction to the existing' : enhance ? 'enhance deepens the existing' : 'add generates a runnable'} greeting journey, captures Hello Umer and rejects ${improve ? 'an instructed Unicode-check regression' : enhance ? 'an empty-name edge regression' : 'wrong output'}; clean replay uses no model` }));
} finally {
  writeFileSync(join(OUT, improve ? 'journey-improve.log' : enhance ? 'journey-enhance.log' : 'journey-add.log'), log.join('\n') + '\n');
  rmSync(tmp, { recursive: true, force: true });
}
