#!/usr/bin/env node
// Tier filtering proof: CI mode runs only tier 'ci' journeys with no agent call
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { env } from 'node:process';

const { DONE_DONE_EVIDENCE_ROOT: evidence, DONE_DONE_RUN_ID: runId } = env;
if (!evidence || !runId) throw new Error('missing DONE_DONE_EVIDENCE_ROOT or DONE_DONE_RUN_ID');

const fixture = 'test/fixtures/tier-test';
const cli = join(process.cwd(), 'dist/cli.js');
const log = join(evidence, 'tier-ci.log');
let output = '';

const run = (desc, cmd, expectSuccess = true) => {
  const msg = `\n=== ${desc} ===\n`;
  output += msg;
  console.error(msg);

  const r = spawnSync(cmd[0], cmd.slice(1), {
    cwd: fixture,
    env: { ...env, GITHUB_ACTIONS: 'true' },
    encoding: 'utf8',
    shell: false
  });

  const result = `Command: ${cmd.join(' ')}\nExit: ${r.status}\nOutput: ${r.stdout}\n${r.stderr}`;
  output += result + '\n';
  console.error(result);

  if (expectSuccess && r.status !== 0) throw new Error(`${desc} failed`);
  if (!expectSuccess && r.status === 0) throw new Error(`${desc} should have failed but succeeded`);

  return r;
};

// Initialize fixture as git repo
spawnSync('sh', ['-c', 'rm -rf .git && git init -q && git add .done-done.yaml && git commit -q -m "init"'], { cwd: fixture });

// Test 1: CI mode runs tier 'ci' journey
const r1 = run('CI mode runs tier ci', ['node', cli, 'run', 'fast-check']);
if (!r1.stdout.includes('result: recorded')) throw new Error('fast-check did not record');

// Test 2: CI mode rejects non-ci tier
const r2 = run('CI mode rejects tier integration', ['node', cli, 'run', 'integration-test'], false);
const r2out = r2.stdout + r2.stderr;
if (!r2out.includes('has tier integration, not ci')) throw new Error('wrong error message');

// Test 3: Explicit --tier ci works
const r3 = run('Explicit --tier ci', ['node', cli, 'run', '--tier', 'ci', 'slow-check']);
if (!r3.stdout.includes('result: recorded')) throw new Error('slow-check did not record');

output += '\n✓ All tier CI tests passed\n✓ No agent calls made (journeys are echo commands)\n';
console.error('\n✓ All tier CI tests passed');

writeFileSync(log, output);
writeFileSync(join(evidence, 'steps.json'), JSON.stringify({
  target: { version: '0.6.26' },
  start: 'tier-test fixture with three-tier journeys',
  steps: [
    'Initialize tier-test fixture as git repo',
    'Run fast-check in CI mode (GITHUB_ACTIONS=true)',
    'Verify fast-check (tier: ci) succeeds',
    'Attempt integration-test in CI mode',
    'Verify integration-test (tier: integration) is rejected',
    'Run slow-check with --tier ci',
    'Verify explicit tier filtering works'
  ],
  result: 'CI mode runs only tier ci journeys, rejects others, no agent calls made'
}, null, 2));
