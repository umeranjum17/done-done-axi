// Gut check: a declared new test must notice its one target being gutted. The target is replaced by a stub that does nothing,
// in a scratch checkout of HEAD (never the work tree), and the test is run; a test that still passes proves nothing about it.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { runAt } from './newtests.js';

export type Gut = 'caught' | 'passed' | 'no single target';
export type GutCheck = { gut: Gut; target: string; refusal: string };

// What a gutted target of each extension holds: it exports nothing, exits 0, or passes.
const STUBS: Record<string, string> = { '.js': 'export {};\n', '.mjs': 'export {};\n', '.ts': 'export {};\n', '.cjs': 'module.exports = {};\n', '.sh': 'exit 0\n', '.py': 'pass\n' };
const PATH_WORD = /[\w@./-]*[\w-](?:\.(?:mjs|cjs|js|ts|sh|py))(?![\w])/g;
const TEST_FILE = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]*\.py$/;
const FIXTURE = /(^|\/)fixtures?\//;

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// The one project source file a test imports, requires or runs by path: a tracked file it names, relative to the test or the
// repo root, that is no dependency, test file or fixture. Returns every such file so the caller can refuse zero or many.
export function targetsOf(repo: string, testRel: string, text: string): string[] {
  const tracked = new Set(git(repo, 'ls-files', '-z').split('\0').filter(Boolean));
  const found = new Set<string>();
  for (const word of text.match(PATH_WORD) ?? []) {
    const from = [normalize(join(dirname(testRel), word)), normalize(word)];
    const hit = from.flatMap((p) => [p, p.replace(/\.js$/, '.ts')]).find((p) => tracked.has(p));
    if (hit && hit !== testRel && !hit.split('/').includes('node_modules') && !TEST_FILE.test(hit) && !FIXTURE.test(hit) && extname(hit) in STUBS) found.add(hit);
  }
  return [...found];
}

// Gut `testRel`'s target in a scratch checkout of HEAD and run it there. The scratch is removed always; the work tree is never written.
export function gutCheck(repo: string, testRel: string, testText: string, template: string): GutCheck {
  const targets = targetsOf(repo, testRel, testText);
  if (targets.length !== 1) {
    const named = targets.length ? `: ${targets.join(', ')}` : '';
    return { gut: 'no single target', target: '', refusal: `${testRel}: gut check needs exactly one target, found ${targets.length}${named}` };
  }
  const target = targets[0];
  const scratch = mkdtempSync(join(tmpdir(), 'done-done-gut-'));
  const wt = join(scratch, 'head');
  try {
    git(repo, 'worktree', 'add', '-q', '--detach', wt, 'HEAD');
    // Dependencies are untracked; without them a test would fail for the wrong reason and read as a catch.
    if (existsSync(join(repo, 'node_modules'))) symlinkSync(join(repo, 'node_modules'), join(wt, 'node_modules'));
    const whole = runAt(wt, testRel, template);
    if (typeof whole === 'object') return { gut: 'passed', target, refusal: whole.error };
    if (whole !== 'green') return { gut: 'passed', target, refusal: `${testRel}: ${whole === 'skipped' ? 'skipped' : 'fails'} before ${target} is stubbed, so the gut check cannot judge it` };
    writeFileSync(join(wt, target), STUBS[extname(target)]);
    const gutted = runAt(wt, testRel, template);
    if (typeof gutted === 'object') return { gut: 'passed', target, refusal: gutted.error };
    if (gutted === 'skipped') return { gut: 'passed', target, refusal: `${testRel}: skipped with ${target} stubbed; a skipped test is not a catch` };
    if (gutted === 'green') return { gut: 'passed', target, refusal: `${testRel}: still passes with ${target} stubbed to do nothing, so it proves nothing about ${target}; make it assert the behaviour, or do not declare it with --new-test` };
    return { gut: 'caught', target, refusal: '' };
  } finally {
    try { git(repo, 'worktree', 'remove', '--force', wt); } catch { /* never added, or already gone */ }
    rmSync(scratch, { recursive: true, force: true });
  }
}

// The gut check of each declared file, in order; stops at the first refusal. Rows carry what each test did, for the receipt.
export function gutCheckAll(repo: string, files: string[], template: string): { rows: { file: string; gut: Gut }[]; refusal: string } {
  const rows: { file: string; gut: Gut }[] = [];
  for (const file of files) {
    const g = gutCheck(repo, normalize(file), readFileSync(join(repo, normalize(file)), 'utf8'), template);
    rows.push({ file, gut: g.gut });
    if (g.refusal) return { rows, refusal: g.refusal };
  }
  return { rows, refusal: '' };
}
