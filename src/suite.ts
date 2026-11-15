// The project's own test suite as one proof step beside the product evidence, never a replacement for it: src/proof.ts still
// refuses a code-only command as product evidence, and the suite result is never cited as such.
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseDuration } from './config.js';

// What a receipt records about the suite at its head: command null means the project has none.
export type SuiteRecord = { command: string | null; exit?: number | null; duration_ms?: number; log?: string; timed_out?: boolean };
export const SUITE_ENV = 'DONE_DONE_SUITE';
export const SUITE_NONE = 'no test suite in this project';

const has = (repo: string, f: string) => existsSync(join(repo, f));
const read = (repo: string, f: string) => { try { return readFileSync(join(repo, f), 'utf8'); } catch { return ''; } };

// The suite command: the configured one, else the project's own (a package.json test script through its package manager, else a
// well-known runner the repo has), else null.
export function suiteCommand(repo: string, configured: string): string | null {
  if (configured.trim()) return configured.trim();
  if (has(repo, 'package.json')) {
    try {
      const test = JSON.parse(read(repo, 'package.json')).scripts?.test;
      // npm init's placeholder (echo "Error: no test specified" && exit 1) is no suite.
      if (typeof test === 'string' && test.trim() && !/no test specified/i.test(test))
        return has(repo, 'pnpm-lock.yaml') ? 'pnpm test' : has(repo, 'yarn.lock') ? 'yarn test' : has(repo, 'bun.lock') || has(repo, 'bun.lockb') ? 'bun run test' : 'npm test';
    } catch {}
  }
  if (has(repo, 'tox.ini')) return 'tox';
  if (has(repo, 'pytest.ini') || /^\[tool\.pytest/m.test(read(repo, 'pyproject.toml')) || /^\[tool:pytest\]/m.test(read(repo, 'setup.cfg'))) return 'pytest';
  if (has(repo, 'Cargo.toml')) return 'cargo test';
  if (has(repo, 'go.mod')) return 'go test ./...';
  if (/^test:/m.test(read(repo, 'Makefile') || read(repo, 'makefile') || read(repo, 'GNUmakefile'))) return 'make test';
  if (has(repo, 'gradlew')) return './gradlew test';
  if (has(repo, 'build.gradle') || has(repo, 'build.gradle.kts')) return 'gradle test';
  if (readdirSync(repo).some((f) => /\.(sln|csproj)$/.test(f))) return 'dotnet test';
  return null;
}

// Run the suite at the repo's current commit, bounded by `timeout`; its output goes to <evidence root>/.done-done/suite/<commit>.log.
export async function runSuite(repo: string, evidenceRoot: string, commit: string, command: string, timeout: string): Promise<SuiteRecord & { log: string; exit: number | null; duration_ms: number }> {
  const dir = join(evidenceRoot, '.done-done', 'suite');
  mkdirSync(dir, { recursive: true });
  const log = join(dir, `${commit}.log`);
  const fd = openSync(log, 'w');
  const started = Date.now();
  let timedOut = false;
  const exit = await new Promise<number | null>((done) => {
    const child = spawn(command, { cwd: repo, shell: true, detached: true, stdio: ['ignore', fd, fd], env: { ...process.env, [SUITE_ENV]: commit } });
    const kill = () => { try { process.kill(-child.pid!, 'SIGKILL'); } catch {} };
    const timer = setTimeout(() => { timedOut = true; kill(); }, parseDuration(timeout) ?? 1_800_000);
    child.on('error', () => { clearTimeout(timer); done(null); });
    child.on('close', (code) => { clearTimeout(timer); kill(); done(code); });
  });
  closeSync(fd);
  return { command, exit, duration_ms: Date.now() - started, log, ...(timedOut ? { timed_out: true } : {}) };
}

// Why a suite record fails the proof, or null.
export const suiteFault = (s: SuiteRecord, timeout: string): string | null =>
  s.command === null || (s.exit === 0 && !s.timed_out) ? null : s.timed_out ? `test suite \`${s.command}\` timed out after ${timeout} (suite.timeout)` : `test suite \`${s.command}\` failed with exit ${s.exit ?? 'none'}`;

// The one line the sign-off message carries.
export const suiteLine = (s: SuiteRecord): string => (s.command === null ? SUITE_NONE : `test suite \`${s.command}\`: ${s.exit === 0 ? 'passed' : `failed, exit ${s.exit}`} in ${Math.round((s.duration_ms ?? 0) / 100) / 10}s`);

export const suiteShape = (s: unknown): boolean => {
  const r = s as SuiteRecord | null;
  if (!r || typeof r !== 'object' || (r.command !== null && typeof r.command !== 'string')) return false;
  return r.command === null || (r.exit === 0 && typeof r.duration_ms === 'number' && typeof r.log === 'string');
};
