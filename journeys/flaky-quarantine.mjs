#!/usr/bin/env node
// Flaky quarantine proof: a journey that fails once and passes on the second run is named, and the run passes with one warning line
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from 'node:process';

const { DONE_DONE_EVIDENCE_ROOT: evidence } = env;
if (!evidence) throw new Error('missing DONE_DONE_EVIDENCE_ROOT');

const cli = join(process.cwd(), 'dist/cli.js');
const dir = mkdtempSync(join(tmpdir(), 'flaky-'));
try {
  cpSync('test/fixtures/flaky-test', dir, { recursive: true });
  const sh = (c) => spawnSync('sh', ['-c', c], { cwd: dir });
  sh('git init -q && git add . && git -c user.name=t -c user.email=t@t commit -q -m init');
  const r = spawnSync('node', [cli, 'run', 'flaky-check', '--json'], { cwd: dir, encoding: 'utf8', env: { ...env, DONE_DONE_EVIDENCE_ROOT: undefined, DONE_DONE_RUN_ID: undefined } });
  const warnings = r.stderr.split('\n').filter((l) => l.startsWith('warning:'));
  const result = JSON.parse(r.stdout);
  writeFileSync(join(evidence, 'flaky-quarantine.log'), `exit: ${r.status}\nwarning lines: ${warnings.length}\n${warnings.join('\n')}\n${r.stdout}\n`);
  if (r.status !== 0 || result.result !== 'recorded') throw new Error(`run did not pass: ${r.stdout}`);
  if (warnings.length !== 1) throw new Error(`expected one warning line, got ${warnings.length}`);
  if (JSON.stringify(result.flaky) !== '["flaky-check"]') throw new Error('flaky journey not named in the result');
  writeFileSync(join(evidence, 'steps.json'), JSON.stringify({
    target: { version: JSON.parse(spawnSync('node', ['-p', 'JSON.stringify(require("./package.json").version)'], { encoding: 'utf8' }).stdout) },
    start: 'flaky-test fixture: a journey that fails on its first run and passes on its second',
    steps: ['Run the flaky journey with done-done run', 'Read the result and the warning line'],
    result: 'the run passed (exit 0), named flaky-check as flaky, and printed exactly one warning line',
  }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
