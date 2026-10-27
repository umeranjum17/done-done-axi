#!/usr/bin/env node
// The job-posting helper: reads one posting on stdin, prints the rewritten posting on stdout.
// JOB_HELPER_STUB=1 is a deterministic mode with no model, for tests; otherwise it asks the user's own claude sign-in.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const posting = readFileSync(0, 'utf8').trim();
if (!posting) {
  console.error('job-helper: no posting on stdin');
  process.exit(1);
}

const field = (re) => posting.match(re)?.[1]?.trim() ?? 'not stated';

if (process.env.JOB_HELPER_STUB) {
  const title = field(/^(?:title|role|position)\s*:\s*(.+)$/im);
  const where = field(/^(?:location|where)\s*:\s*(.+)$/im);
  const pay = field(/^(?:pay|salary|wage)\s*:\s*(.+)$/im);
  const apply = field(/^(?:apply|contact|how to apply)\s*:\s*(.+)$/im);
  console.log(`Job title: ${title}\nLocation: ${where}\nPay: ${pay}\nHow to apply: ${apply}\n\nWe are hiring a ${title}. Come and join us in ${where}.`);
  process.exit(0);
}

const system = readFileSync(new URL('./prompt.md', import.meta.url), 'utf8');
const r = spawnSync('claude', ['-p', '--model', process.env.JOB_HELPER_MODEL || 'claude-haiku-5-5', '--tools', '', '--setting-sources', ''], { input: `${system}\nPosting:\n<<<\n${posting}\n>>>\n`, encoding: 'utf8' });
if (r.status !== 0) {
  console.error(`job-helper: claude exited ${r.status}: ${(r.stderr || r.error?.message || '').trim().slice(-200)}`);
  process.exit(1);
}
process.stdout.write(r.stdout);
