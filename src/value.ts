// Test value (`done-done tests value`). A test earns its place by catching a fault. Faults are planted in scratch copies
// of the repo, never in the work copy: each fault is one small edit of one source line (an operator flipped). Every
// sized-or-not test runs against the clean copy and each faulty copy; the faults a test fails on are the ones it catches.
//   real       catches at least one fault and is the fastest test to catch exactly that set
//   slop       catches no fault: it passes on broken code
//   duplicate  catches exactly what a faster (or earlier-named, on a tie) test catches
//   failing    fails on the clean copy, so it says nothing about faults
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { isTestFile } from './inventory.js';
import { runBounded, type Bounded } from './size.js';

export const DEFAULT_FAULTS = 12;
const SOURCE = /\.(c|m)?(j|t)sx?$/;

// One edit that keeps the code parsing but changes what it does.
const OPERATORS: [RegExp, string][] = [
  [/ \+ /, ' - '], [/ - /, ' + '], [/ \* /, ' / '], [/ === /, ' !== '], [/ !== /, ' === '],
  [/ >= /, ' < '], [/ <= /, ' > '], [/ && /, ' || '], [/ \|\| /, ' && '], [/\btrue\b/, 'false'], [/\bfalse\b/, 'true'],
];
const comment = (line: string) => /^\s*(\/\/|\*|\/\*|#)/.test(line);

export type Fault = { file: string; line: number; was: string; now: string };
export type TestRun = { name: string; command: string; size?: string };
export type Verdict = 'real' | 'slop' | 'duplicate' | 'failing';
export type TestValue = { test: string; verdict: Verdict; seconds: number; caught: number; duplicate_of?: string };

// The repo's non-test source files that git does not ignore.
function sourceFiles(repo: string): string[] {
  return execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 }).split('\0')
    .filter((p) => p && SOURCE.test(p) && !isTestFile(p) && !/(^|\/)(fixtures|dist|node_modules)\//.test(p) && existsSync(join(repo, p))).sort();
}

// Every fault the source offers (one per line and operator), thinned evenly to at most `max` so the same repo plants the same faults.
export function listFaults(repo: string, sources: string[], max: number): Fault[] {
  const all: Fault[] = [];
  for (const file of sources) {
    readFileSync(join(repo, file), 'utf8').split('\n').forEach((text, i) => {
      if (comment(text)) return;
      for (const [re, to] of OPERATORS) if (re.test(text)) { all.push({ file, line: i + 1, was: text, now: text.replace(re, to) }); break; }
    });
  }
  if (all.length <= max) return all;
  return Array.from({ length: max }, (_, k) => all[Math.floor((k * all.length) / max)]);
}

export const sourcesOf = (repo: string, only: string[]): string[] => (only.length ? only : sourceFiles(repo));

// A scratch copy of the work copy, made from git's file list; node_modules is shared by link, so the copy stays small.
function scratchCopy(repo: string, root: string, label: string): string {
  const dir = join(root, label);
  mkdirSync(dir);
  const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 }).split('\0').filter((p) => p && existsSync(join(repo, p)));
  for (const f of files) { mkdirSync(dirname(join(dir, f)), { recursive: true }); cpSync(join(repo, f), join(dir, f)); }
  if (existsSync(join(repo, 'node_modules'))) symlinkSync(join(repo, 'node_modules'), join(dir, 'node_modules'));
  return dir;
}

function plant(dir: string, f: Fault): void {
  const lines = readFileSync(join(dir, f.file), 'utf8').split('\n');
  lines[f.line - 1] = f.now;
  writeFileSync(join(dir, f.file), lines.join('\n'));
}

// Classify from what each test caught. `ran` is the clean-copy run of each test, `caught` the fault indexes it failed on.
export function classify(tests: { name: string; ran: Bounded; caught: number[] }[]): TestValue[] {
  const seconds = (t: { ran: Bounded }) => Math.round(t.ran.ms / 10) / 100;
  const key = (t: { caught: number[] }) => t.caught.join(',');
  const passing = tests.filter((t) => t.ran.code === 0 && !t.ran.slow);
  const keeper = new Map<string, (typeof tests)[number]>();
  for (const t of [...passing].filter((t) => t.caught.length).sort((a, b) => a.ran.ms - b.ran.ms || a.name.localeCompare(b.name))) if (!keeper.has(key(t))) keeper.set(key(t), t);
  return tests.map((t) => {
    const base = { test: t.name, seconds: seconds(t), caught: t.caught.length };
    if (!passing.includes(t)) return { ...base, verdict: 'failing' as const };
    if (!t.caught.length) return { ...base, verdict: 'slop' as const };
    const k = keeper.get(key(t))!;
    return k === t ? { ...base, verdict: 'real' as const } : { ...base, verdict: 'duplicate' as const, duplicate_of: k.name };
  });
}

export type ValueReport = { faults: Fault[]; tests: TestValue[] };

// Plant each fault in its own scratch copy and run every test there. The work copy is only read.
export async function measureValue(repo: string, tests: TestRun[], faults: Fault[], env: NodeJS.ProcessEnv): Promise<ValueReport> {
  const root = mkdtempSync(join(tmpdir(), 'done-done-value-'));
  const run = (t: TestRun, dir: string, tag: string) => {
    const evidence = mkdtempSync(join(root, 'evidence-'));
    return runBounded(t.command, { cwd: dir, size: t.size, env: { ...env, DONE_DONE_RUN_ID: `value-${t.name}-${tag}`, DONE_DONE_EVIDENCE_ROOT: evidence } });
  };
  try {
    const clean = scratchCopy(repo, root, 'clean');
    const results = [];
    for (const t of tests) results.push({ name: t.name, ran: await run(t, clean, 'clean'), caught: [] as number[] });
    for (const [i, f] of faults.entries()) {
      const dir = scratchCopy(repo, root, `fault-${i}`);
      plant(dir, f);
      for (const [k, t] of tests.entries()) {
        if (results[k].ran.code !== 0 || results[k].ran.slow) continue;
        const r = await run(t, dir, `fault-${i}`);
        if (r.code !== 0 || r.slow) results[k].caught.push(i);
      }
      rmSync(dir, { recursive: true, force: true });
    }
    return { faults, tests: classify(results) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
