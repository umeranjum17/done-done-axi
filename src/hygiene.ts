// Findings from fresh mutation runs. These observations never authorize removing a journey.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, extname, join, matchesGlob, relative } from 'node:path';
import type { Config } from './config.js';
import { fileURLToPath } from 'node:url';
import { runBounded } from './size.js';
import { isTestFile } from './inventory.js';
import type { TestRun } from './value.js';

const js = /\.(?:[cm]?[jt]sx?)$/;
const native = /\.(?:py|go|rs|cs|java|rb)$/;
const quote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
const matches = (p: string, patterns: string[]) => patterns.some(g => matchesGlob(p, g));
type ShellFault = Config['hygiene']['shell_faults'][number];
type Mutant = { id: string; status: string; location?: unknown; replacement?: string; statusReason?: string };
type Finding = { test: string; outcome: string; detail?: string; clean_ms: number; clean_passed: boolean; modules: string[]; mutants: { file: string; id: string; outcome: string; location?: unknown; replacement?: string; reason?: string }[]; candidates: string[]; assertion_sites: string[]; line_coverage: Record<string, { startOffset: number; endOffset: number; count: number }[][]> | null };

function files(repo: string): string[] {
  return execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 }).split('\0').filter(Boolean);
}

// Copy only repository files; never follow a tracked symlink while creating a mutation sandbox.
function copy(repo: string, root: string, label: string, paths: string[]): string {
  const dir = join(root, label);
  mkdirSync(dir);
  for (const p of paths) {
    const from = join(repo, p), to = join(dir, p);
    if (!existsSync(from)) continue;
    mkdirSync(dirname(to), { recursive: true });
    if (lstatSync(from).isSymbolicLink()) symlinkSync(readlinkSync(from), to);
    else cpSync(from, to);
  }
  if (existsSync(join(repo, 'node_modules')) && !existsSync(join(dir, 'node_modules'))) symlinkSync(join(repo, 'node_modules'), join(dir, 'node_modules'));
  return dir;
}

function mapped(repo: string, paths: string[], command: string, owners: Config['affected']['owners']): string[] {
  const named = paths.filter(p => command.split(/[\s'";|&()]+/).includes(p));
  const rows = Object.values(owners).filter(o => named.some(p => matches(p, o.tests)));
  return paths.filter(p => !isTestFile(p) && (js.test(p) || native.test(p)) && rows.some(o => matches(p, o.inputs)) && existsSync(join(repo, p)) && !lstatSync(join(repo, p)).isSymbolicLink()).sort();
}

function result(status: string): string {
  return ({ Killed: 'killed', Survived: 'survivor', NoCoverage: 'no coverage', Timeout: 'timeout' } as Record<string, string>)[status] ?? 'unknown';
}

// A command runner is deliberately fresh: cached/incremental results can refer to older tests.
async function stryker(dir: string, binary: string, test: TestRun, modules: string[], env: NodeJS.ProcessEnv) {
  const report = 'done-done-mutation.json', config = 'done-done-stryker.cjs';
  if (existsSync(join(dir, report))) return { mutants: [], error: 'mutation report path already exists in the clean sandbox' };
  writeFileSync(join(dir, config), `module.exports = ${JSON.stringify({ mutate: modules, testRunner: 'command', commandRunner: { command: test.command }, coverageAnalysis: 'off', incremental: false, concurrency: 1, reporters: ['json'], jsonReporter: { fileName: report }, thresholds: { high: 0, low: 0, break: 0 } })};\n`);
  let output = '';
  const run = await runBounded(`node ${quote(binary)} run ${quote(config)}`, { cwd: dir, env, size: test.size, timeoutMs: 900_000, onData: b => { output = (output + b.toString()).slice(-4000); } });
  if (run.slow || run.code !== 0 || !existsSync(join(dir, report))) return { mutants: [], error: run.slow ? 'mutation run timed out' : `mutation runner failed (${run.code}): ${output.slice(-1500)}` };
  try {
    const doc = JSON.parse(readFileSync(join(dir, report), 'utf8')) as { files: Record<string, { mutants: Mutant[] }> };
    if (!modules.every(p => Object.hasOwn(doc.files, p))) return { mutants: [], error: 'mutation report does not cover every owned module' };
    const mutants = Object.entries(doc.files).flatMap(([file, value]) => value.mutants.map(m => ({ file, id: m.id, outcome: result(m.status), location: m.location, replacement: m.replacement, ...(m.statusReason && { reason: m.statusReason }) })));
    if (mutants.some(m => !modules.includes(m.file))) return { mutants: [], error: 'mutation report contains a target outside the owned modules' };
    return { mutants };
  } catch (e) { return { mutants: [], error: `invalid mutation report: ${(e as Error).message}` }; }
}

// A configured installed native adapter writes the mutation-testing-elements JSON schema into its own fresh sandbox.
async function nativeRun(dir: string, adapter: { command: string; report: string }, test: TestRun, modules: string[], env: NodeJS.ProcessEnv) {
  const report = join(dir, adapter.report);
  const parts = adapter.report.split('/');
  for (let i = 1; i <= parts.length; i++) { const p = join(dir, ...parts.slice(0, i)); if (existsSync(p) && lstatSync(p).isSymbolicLink()) return { mutants: [], error: 'native report path crosses a symbolic link' }; }
  if (existsSync(report)) return { mutants: [], error: 'native mutation report path already exists in the clean sandbox' };
  let output = '';
  const run = await runBounded(adapter.command, { cwd: dir, env: { ...env, DONE_DONE_HYGIENE_TEST: test.command, DONE_DONE_HYGIENE_INPUTS: JSON.stringify(modules) }, timeoutMs: 900_000, onData: b => { output = (output + b.toString()).slice(-1500); } });
  if (run.slow || run.code !== 0 || !existsSync(report) || lstatSync(report).isSymbolicLink()) return { mutants: [], error: run.slow ? 'native mutation run timed out' : `native mutation runner failed (${run.code}): ${output}` };
  try {
    const doc = JSON.parse(readFileSync(report, 'utf8')) as { files: Record<string, { mutants: Mutant[] }> };
    if (!modules.every(p => Object.hasOwn(doc.files, p))) return { mutants: [], error: 'native report does not cover every owned module' };
    const mutants = Object.entries(doc.files).flatMap(([file, row]) => row.mutants.map(m => ({ file, id: m.id, outcome: result(m.status), location: m.location, replacement: m.replacement, ...(m.statusReason && { reason: m.statusReason }) })));
    if (mutants.some(m => !modules.includes(m.file))) return { mutants: [], error: 'native report contains a target outside the owned modules' };
    return { mutants };
  } catch (e) { return { mutants: [], error: `invalid native mutation report: ${(e as Error).message}` }; }
}

type Range = { startOffset: number; endOffset: number; count: number };
// V8 coverage is optional: absence of a report or a script is unknown, never an uncovered claim.
function coverage(dir: string, repo: string): Record<string, Range[][]> | null {
  const output: Record<string, Range[][]> = {};
  const reports = readdirSync(dir).filter(p => p.endsWith('.json'));
  if (!reports.length) return null;
  try {
    for (const report of reports) {
      const doc = JSON.parse(readFileSync(join(dir, report), 'utf8')) as { result: { url: string; functions: { ranges: Range[] }[] }[] };
      for (const script of doc.result) {
        if (!script.url.startsWith('file:')) continue;
        const name = relative(repo, fileURLToPath(script.url));
        if (name.startsWith('..')) continue;
        (output[name] ??= []).push(script.functions.flatMap(f => f.ranges));
      }
    }
    return output;
  } catch { return null; }
}

function observedAt(file: string, mutant: { location?: unknown }, ranges: Range[][] | undefined): boolean | null {
  const pos = (mutant.location as { start?: { line: number; column: number } } | undefined)?.start;
  if (!pos || !ranges?.length) return null;
  const lines = readFileSync(file, 'utf8').split('\n');
  if (pos.line < 1 || pos.line > lines.length) return null;
  const offset = lines.slice(0, pos.line - 1).reduce((sum, line) => sum + line.length + 1, 0) + pos.column - 1;
  const observations = ranges.flatMap(group => {
    const hit = group.filter(r => r.startOffset <= offset && offset < r.endOffset).sort((a, b) => (a.endOffset - a.startOffset) - (b.endOffset - b.startOffset));
    if (!hit.length) return [];
    const width = hit[0].endOffset - hit[0].startOffset;
    return [hit.filter(r => r.endOffset - r.startOffset === width).some(r => r.count > 0)];
  });
  return observations.length ? observations.some(Boolean) : null;
}

function shellMutation(dir: string, fault: ShellFault): string | null {
  const file = join(dir, fault.file);
  if (!existsSync(file) || lstatSync(file).isSymbolicLink()) return 'reviewed shell target missing or symbolic';
  const text = readFileSync(file, 'utf8');
  if (text.split(fault.was).length !== 2) return 'reviewed shell fault no longer matches exactly once';
  writeFileSync(file, text.replace(fault.was, fault.now));
  return null;
}

export async function hygiene(repo: string, tests: TestRun[], cfg: Config, env: NodeJS.ProcessEnv, selected: string[], budget: number) {
  const root = mkdtempSync(join(tmpdir(), 'done-done-hygiene-'));
  const paths = files(repo), findings: Finding[] = [];
  const local = join(repo, 'node_modules', '@stryker-mutator', 'core', 'bin', 'stryker.js');
  const bin = existsSync(local) ? local : (env.PATH ?? '').split(delimiter).map(p => join(p, 'stryker')).find(p => existsSync(p));
  try {
    for (const [i, test] of tests.entries()) {
      const clean = copy(repo, root, `clean-${i}`, paths);
      const evidence = join(root, `evidence-${i}`); mkdirSync(evidence);
      const coverageDir = join(root, `coverage-${i}`); mkdirSync(coverageDir);
      const localEnv = { ...env, DONE_DONE_EVIDENCE_ROOT: evidence, DONE_DONE_RUN_ID: `hygiene-${i}`, NODE_V8_COVERAGE: coverageDir };
      let cleanOutput = '';
      const ran = await runBounded(test.command, { cwd: clean, env: localEnv, size: test.size, ...(test.size ? {} : { timeoutMs: 900_000 }), onData: b => { cleanOutput = (cleanOutput + b.toString()).slice(-4000); } });
      const modules = mapped(repo, paths, test.command, cfg.affected.owners);
      const named = paths.filter(p => test.command.split(/[\s'";|&()]+/).includes(p) && existsSync(join(repo, p)) && !lstatSync(join(repo, p)).isSymbolicLink());
      const assertionSites = named.flatMap(p => readFileSync(join(repo, p), 'utf8').split('\n').flatMap((line, n) => /\b(assert|expect)\s*[.(]/.test(line) ? [`${p}:${n + 1}: ${line.trim()}`] : []));
      const row: Finding = { test: test.name, outcome: 'unknown', clean_ms: Math.round(ran.ms), clean_passed: ran.code === 0 && !ran.slow, modules, mutants: [], candidates: [], assertion_sites: assertionSites, line_coverage: coverage(coverageDir, clean) };
      if (!assertionSites.length) row.candidates.push('possible prose or indirect assertions');
      findings.push(row);
      if (ran.slow) { row.outcome = 'timeout'; row.detail = 'clean run timed out'; continue; }
      if (ran.code === 77) { row.detail = 'clean run skipped'; continue; }
      if (ran.code !== 0) { row.outcome = 'clean-red'; row.detail = ran.error ?? `clean run exited ${ran.code}${cleanOutput ? `: ${cleanOutput}` : ''}`; continue; }
      const target = selected.length ? modules.filter(m => selected.includes(m)) : modules;
      if (selected.some(s => !modules.includes(s))) { row.detail = 'requested target is not owned by this test'; row.outcome = 'wrong target'; continue; }
      if (!target.length) { row.detail = 'no complete production ownership mapping'; continue; }
      if (target.length > budget) { row.detail = `mapping exceeds ${budget} module budget`; continue; }
      const javascript = target.filter(p => js.test(p));
      if (javascript.length) {
        if (!bin) { row.detail = 'StrykerJS is not installed'; continue; }
        const mutation = await stryker(clean, bin, test, javascript, localEnv);
        row.mutants.push(...mutation.mutants.map(m => {
          if (m.outcome !== 'survivor') return m;
          const covered = observedAt(join(clean, m.file), m, row.line_coverage?.[m.file]);
          return { ...m, outcome: covered === false ? 'no coverage' : covered === null ? 'unknown' : 'survivor' };
        }));
        if (mutation.error) { row.detail = mutation.error; continue; }
      }
      for (const ext of new Set(target.filter(p => native.test(p)).map(p => extname(p)))) {
        const adapter = cfg.hygiene.adapters[ext];
        if (!adapter) { row.detail = `no installed native adapter configured for ${ext}`; break; }
        const sandbox = copy(repo, root, `native-${i}-${ext.slice(1)}`, paths);
        const mutation = await nativeRun(sandbox, adapter, test, target.filter(p => extname(p) === ext), localEnv);
        row.mutants.push(...mutation.mutants);
        if (mutation.error) { row.detail = mutation.error; break; }
      }
      if (row.detail) continue;
      if (row.mutants.length > budget) { row.detail = `mutation result exceeds ${budget} fault budget`; continue; }
      if (!row.mutants.length || row.mutants.some(m => m.outcome === 'unknown')) { row.detail = 'mutation result is incomplete'; continue; }
      row.outcome = row.mutants.some(m => m.outcome === 'survivor') ? 'survivor' : row.mutants.some(m => m.outcome === 'timeout') ? 'timeout' : row.mutants.every(m => m.outcome === 'no coverage') ? 'no coverage' : 'killed';
      const words = test.command.trim().split(/\s+/);
      if (words.length <= 3) row.candidates.push('forwarding or shared setup');
    }
    // Reviewed shell faults are replayed in separate copies and never alter the source tree.
    const shell = [];
    for (const [i, fault] of cfg.hygiene.shell_faults.entries()) for (const [j, test] of tests.entries()) {
      const row = findings[j];
      if (!row.clean_passed) continue;
      const named = paths.filter(p => test.command.split(/[\s'";|&()]+/).includes(p));
      const owned = Object.values(cfg.affected.owners).some(o => named.some(p => matches(p, o.tests)) && matches(fault.file, o.inputs));
      if (!owned) { shell.push({ test: test.name, file: fault.file, outcome: 'wrong target' }); continue; }
      const dir = copy(repo, root, `shell-${i}-${j}`, paths);
      const error = shellMutation(dir, fault);
      if (error) { shell.push({ test: test.name, file: fault.file, outcome: 'unknown', reason: error }); continue; }
      const evidence = join(root, `shell-evidence-${i}-${j}`); mkdirSync(evidence);
      const run = await runBounded(test.command, { cwd: dir, env: { ...env, DONE_DONE_EVIDENCE_ROOT: evidence, DONE_DONE_RUN_ID: `hygiene-shell-${i}-${j}` }, size: test.size, ...(test.size ? {} : { timeoutMs: 900_000 }) });
      shell.push({ test: test.name, file: fault.file, review: fault.review, outcome: run.slow ? 'timeout' : run.code === 0 ? 'survivor' : run.code === null || run.code === 77 ? 'unknown' : 'killed' });
    }
    const faultKey = (m: Finding['mutants'][number]) => JSON.stringify([m.file, m.location ?? null, m.replacement ?? null, m.location && m.replacement ? null : m.id]);
    for (const [i, row] of findings.entries()) {
      const killed = row.mutants.filter(m => m.outcome === 'killed').map(faultKey).sort();
      if (!killed.length || row.detail) continue;
      const duplicate = findings.slice(0, i).find(other => !other.detail && JSON.stringify(other.mutants.filter(m => m.outcome === 'killed').map(faultKey).sort()) === JSON.stringify(killed));
      if (duplicate) row.candidates.push(`possible duplicate of ${duplicate.test}`);
    }
    return { shadow: true, findings, shell_faults: shell, note: 'Observations only; retain every test. Command-runner coverage and assertion identity may be unknown.' };
  } finally { rmSync(root, { recursive: true, force: true }); }
}
