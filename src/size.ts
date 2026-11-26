// Test size bounds. A journey (a test) may declare `size:` in .done-done.yaml; the size is its time bound, and a run past
// it is stopped and called slow. A repo opts in by sizing any journey: lint then fails a journey with no size and a large
// one with no `reason:`. Large journeys are night-only: `run` and `tests measure` refuse them without --night.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cancelGroups, registerGroup, unregisterGroup } from './deadline.js';

export const SIZES = { ci: 15_000, local: 300_000, large: 900_000 } as const;
export type Size = keyof typeof SIZES;
export const isSize = (s: unknown): s is Size => typeof s === 'string' && Object.hasOwn(SIZES, s);
export const MEASURE_RUNS = 5;

type Sized = { size?: string; reason?: string };
const bound = (size: Size) => `${SIZES[size] / 1000}s`;

// The lint verdict: null when the repo sizes no journey or every journey has a size (and a reason when large).
export function sizeFault(journeys: Record<string, Sized>): string | null {
  const all = Object.entries(journeys);
  if (!all.some(([, j]) => j.size !== undefined)) return null;
  const bad = all.flatMap(([name, j]) => {
    if (j.size === undefined) return [`journey ${name} has no size (ci ${bound('ci')}, local ${bound('local')} or large ${bound('large')})`];
    if (j.size === 'large' && !j.reason?.trim()) return [`journey ${name} is large and has no reason: say why it needs up to ${bound('large')} and runs only at night`];
    return [];
  });
  return bad.length ? bad.join('; ') : null;
}

// Why a journey may not run now, or null. A large journey is night-only.
export function nightFault(name: string, j: Sized, night: boolean): string | null {
  return j.size === 'large' && !night ? `journey ${name} is large (night-only): nothing ran` : null;
}

export type Bounded = { code: number | null; ms: number; slow: boolean; error?: string };

// Run a shell command; past its bound (timeoutMs, else its size's) the whole process group is killed and the run is slow. No bound: none.
export function runBounded(command: string, opts: { cwd: string; env: NodeJS.ProcessEnv; size?: string; timeoutMs?: number; signal?: AbortSignal; onData?: (b: Buffer) => void }): Promise<Bounded> {
  const limit = opts.timeoutMs ?? (isSize(opts.size) ? SIZES[opts.size] : null);
  return new Promise((done) => {
    const start = performance.now();
    let slow = false;
    const layered = !!opts.signal || !!opts.env.DONE_DONE_LAYER_GROUPS;
    let cleanup: NodeJS.Timeout | undefined;
    let pending: { code: number | null; error?: string } | undefined;
    let ended = false;
    if (opts.signal?.aborted) return done({ code: null, ms: 0, slow: true });
    const child = spawn(command, { cwd: opts.cwd, env: opts.env, shell: true, stdio: ['inherit', 'pipe', 'pipe'], detached: limit !== null || !!opts.signal });
    if (child.pid && (limit !== null || opts.signal)) registerGroup(child.pid, opts.env);
    const stop = () => {
      if (slow || ended) return;
      slow = true;
      if (child.pid) {
        if (!layered) { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } return; }
        try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
        const grace = limit === null ? 250 : Math.min(250, Math.floor(limit / 2));
        cleanup = setTimeout(() => {
          try { process.kill(-child.pid!, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
          cleanup = undefined;
          if (pending) finish(pending.code, pending.error);
        }, grace);
      }
    };
    const timer = limit === null ? null : setTimeout(stop, Math.max(0, limit - (layered ? Math.min(250, Math.floor(limit / 2)) : 0)));
    opts.signal?.addEventListener('abort', stop, { once: true });
    if (opts.signal?.aborted) stop();
    for (const out of [child.stdout, child.stderr]) out?.on('data', (b: Buffer) => opts.onData?.(b));
    const finish = (code: number | null, error?: string) => { if (ended) return; ended = true; if (timer) clearTimeout(timer); opts.signal?.removeEventListener('abort', stop); if (child.pid && opts.env.DONE_DONE_LAYER_GROUPS && (limit !== null || opts.signal)) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* group exited */ } unregisterGroup(child.pid, opts.env); } done({ code, ms: performance.now() - start, slow, ...(error && { error }) }); };
    const end = (code: number | null, error?: string) => { if (cleanup) pending = { code, error }; else finish(code, error); };
    child.on('error', (error) => end(null, error.message)).on('close', (code) => end(code));
  });
}

export const slowReason = (name: string, size: Size) => `journey ${name} is slow: it ran past its ${size} bound of ${bound(size)} and was stopped`;

export type Measured = { journey: string; size: Size; bound: string; runs: { seconds: number; result: 'ok' | 'failed' | 'slow' }[]; slowest: number; verdict: 'within bound' | 'slow' | 'failed' };

// Run one journey MEASURE_RUNS times, each in its own scratch evidence folder (nothing is recorded as proof), and time them.
export async function measureJourney(name: string, command: string, size: Size, cwd: string, env: NodeJS.ProcessEnv): Promise<Measured> {
  const runs: Measured['runs'] = [];
  for (let i = 1; i <= MEASURE_RUNS; i++) {
    const dir = mkdtempSync(join(tmpdir(), 'done-done-measure-'));
    try {
      const r = await runBounded(command, { cwd, size, env: { ...env, DONE_DONE_RUN_ID: `measure-${name}-${i}`, DONE_DONE_EVIDENCE_ROOT: dir }, onData: (b) => process.stderr.write(b) });
      runs.push({ seconds: Math.round(r.ms / 10) / 100, result: r.slow ? 'slow' : r.code === 0 ? 'ok' : 'failed' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const verdict = runs.some((r) => r.result === 'slow') ? 'slow' : runs.some((r) => r.result === 'failed') ? 'failed' : 'within bound';
  return { journey: name, size, bound: bound(size), runs, slowest: Math.max(...runs.map((r) => r.seconds)), verdict };
}

// Shadow batches measure wall time independently of the sum of their parallel children. An optional deadline applies to the batch.
export type ShadowAttempt = { episode: string; attempt: string; leaf: string; report: string | null; result: Bounded };
export async function shadowBatch(entries: [string, string][], opts: { cwd: string; env: NodeJS.ProcessEnv; journal: string; deadlineMs?: number; limits?: Record<string, number>; retry?: boolean; overTargetIsStatus?: boolean; onAttempt?: (attempt: ShadowAttempt) => void; retryWhen?: (result: Bounded, name: string) => boolean }) {
  const batch = randomUUID();
  const start = performance.now();
  const startedAt = new Date().toISOString();
  const log = (row: Record<string, unknown>) => appendFileSync(opts.journal, JSON.stringify({ schema_version: 1, run_id: batch, ...row }) + '\n', { mode: 0o600 });
  const pending = new Set(entries.map(([name]) => name));
  const controller = new AbortController();
  const ownsGroups = opts.deadlineMs !== undefined && !opts.env.DONE_DONE_LAYER_GROUPS;
  const groups = opts.env.DONE_DONE_LAYER_GROUPS || (ownsGroups ? mkdtempSync(join(opts.env.TMPDIR || tmpdir(), 'done-done-groups-')) : null);
  const rootOwner = Number(opts.env.DONE_DONE_LAYER_ROOT_PGID) === process.pid;
  const env = groups ? { ...opts.env, DONE_DONE_LAYER_GROUPS: groups } : opts.env;
  let deadlineHit = false;
  // Reserve the final second for process reaping and recording the incomplete batch.
  const deadline = opts.deadlineMs === undefined ? null : setTimeout(() => {
    deadlineHit = true;
    log({ kind: 'batch_interrupted', duration_ms: performance.now() - start, unfinished_leaves: [...pending], signal: 'deadline' });
    controller.abort();
    if (groups && (ownsGroups || rootOwner)) cancelGroups(groups, 'SIGKILL', rootOwner ? process.pid : undefined);
  }, Math.max(0, opts.deadlineMs - 1000));
  log({ kind: 'batch_start', started_at: startedAt, leaves: [...pending] });
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  const interrupted = (signal: NodeJS.Signals) => {
    log({ kind: 'batch_interrupted', duration_ms: performance.now() - start, unfinished_leaves: [...pending], signal });
    controller.abort();
    if (groups && (ownsGroups || rootOwner)) cancelGroups(groups, 'SIGKILL', rootOwner ? process.pid : undefined);
    setTimeout(() => {
      for (const sig of signals) process.removeListener(sig, handlers[sig]);
      process.kill(process.pid, signal);
    }, 300);
  };
  const handlers = Object.fromEntries(signals.map(sig => [sig, () => interrupted(sig)])) as Record<typeof signals[number], () => void>;
  for (const sig of signals) process.once(sig, handlers[sig]);
  let rows;
  try { rows = await Promise.all(entries.map(async ([name, command]) => {
    const attemptId = randomUUID();
    const submitted = performance.now();
    const submittedAt = new Date().toISOString();
    log({ kind: 'admission', attempt_id: attemptId, parent_attempt_id: null, leaf_id: name, submission_time_or_null: submittedAt, submission_offset_ms: submitted - start, queue_source: null });
    const evidenceRoot = opts.env.DONE_DONE_SHADOW_EVIDENCE;
    const dir = mkdtempSync(join(evidenceRoot || tmpdir(), 'done-done-shadow-'));
    let preserve = true;
    try {
      const execution = performance.now();
      const executionAt = new Date().toISOString();
      log({ kind: 'start', attempt_id: attemptId, leaf_id: name, started_at: executionAt, start_offset_ms: execution - start, setup_ms: execution - submitted, queue_ms: null });
      const runId = `${batch}-${name}`;
      const run = async (parentAttempt: string) => {
        const report = join(dir, `${parentAttempt}.junit.xml`);
        const result = await runBounded(command.replaceAll('${RUN_ID}', runId), { cwd: opts.cwd, signal: controller.signal, timeoutMs: opts.limits?.[name], env: { ...env, DONE_DONE_RUN_ID: runId, DONE_DONE_EVIDENCE_ROOT: dir, DONE_DONE_SHADOW_RUN_ID: batch, DONE_DONE_SHADOW_PARENT_ATTEMPT_ID: parentAttempt, DONE_DONE_SHADOW_LEAF_ID: name, ...(opts.onAttempt ? { DONE_DONE_JUNIT_REPORT: report } : {}) }, onData: (b) => process.stderr.write(b) });
        if (opts.onAttempt) opts.onAttempt({ episode: attemptId, attempt: parentAttempt, leaf: name, report: existsSync(report) ? readFileSync(report, 'utf8') : null, result });
        return result;
      };
      const r = await run(attemptId);
      let final = r, retryMs = 0;
      if (r.code !== 0 && opts.retry !== false && !controller.signal.aborted && (!opts.retryWhen || opts.retryWhen(r, name))) {
        const retryId = randomUUID(), retryStart = performance.now();
        log({ kind: 'retry_start', attempt_id: retryId, parent_attempt_id: attemptId, leaf_id: name, started_at: new Date().toISOString() });
        final = await run(retryId);
        retryMs = performance.now() - retryStart;
        log({ kind: 'retry_exit', attempt_id: retryId, parent_attempt_id: attemptId, leaf_id: name, duration_ms: retryMs, exit_or_null: final.code, ...(final.error && { error: final.error }), status: final.code === 0 ? 'passed' : 'failed' });
      }
      preserve = !!evidenceRoot || final.code !== 0;
      const row = { ...(preserve && { evidence_dir: dir }), kind: 'exit', attempt_id: attemptId, parent_attempt_id: null, leaf_id: name, submission_time_or_null: submittedAt, queue_source: null, started_at: executionAt, start_offset_ms: execution - start, end_offset_ms: performance.now() - start, duration_ms: r.ms, exit_or_null: r.code, ...(r.error && { error: r.error }), status: r.slow ? 'interrupted' : r.code === 0 ? 'passed' : 'failed', result_status: final.slow ? 'interrupted' : final.code === 0 ? 'passed' : 'failed', assertion: null, raw_report_digest: null, retry_ms: retryMs, execution_ms: r.ms };
      if (!controller.signal.aborted) pending.delete(name);
      log(row);
      return row;
    } finally { if (!preserve) rmSync(dir, { recursive: true, force: true }); }
  })); } catch (error) {
    log({ kind: 'batch_interrupted', duration_ms: performance.now() - start, unfinished_leaves: [...pending], signal: null });
    throw error;
  } finally {
    if (deadline) clearTimeout(deadline);
    if (groups && ownsGroups) rmSync(groups, { recursive: true, force: true });
    for (const sig of signals) process.removeListener(sig, handlers[sig]);
  }
  const duration = performance.now() - start;
  const usage = readFileSync(opts.journal, 'utf8').trim().split('\n').map(line => JSON.parse(line)).filter(row => row.kind === 'provider_attempt' && typeof row.run_id === 'string' && row.run_id === batch);
  const result = { kind: 'batch_exit', started_at: startedAt, duration_ms: duration, usage_known_over_attempted: `${usage.filter(row => row.input_tokens_or_null !== null && row.output_tokens_or_null !== null).length}/${usage.length}`,  target_ms: [120000, 300000], target: duration < 120000 ? 'under' : duration <= 300000 ? 'within' : 'over', full_batch_p95_ms: null, full_batch_samples: 0, unfinished_leaves: [...pending], status: deadlineHit || !rows.every((row) => row.result_status === 'passed') ? 'failed' : duration > 300000 && opts.overTargetIsStatus !== false ? 'over_target' : 'passed' };
  log(result);
  return { ...result, run_id: batch, rows };
}

// Carry cache identity across CLI-backed judge dispatch without recording request content.
const usageContext = new AsyncLocalStorage<{ cache_identity?: string | null; tier?: string; run_id?: string }>();
export const withShadowCache = <T>(key: string | null, run: () => T): T => usageContext.run({ ...usageContext.getStore(), cache_identity: key }, run);
export const withShadowRun = <T>(run_id: string, run: () => T): T => usageContext.run({ ...usageContext.getStore(), run_id }, run);
export const withShadowTier = <T>(tier: string, run: () => T): T => usageContext.run({ ...usageContext.getStore(), tier }, run);
export const shadowTier = () => usageContext.getStore()?.tier;

// Give standalone invocations a stable identity when no enclosing run supplies one.
const shadowSessionRun = randomUUID();
// Dispatch journal is opt-in and contains only accounting metadata, never request or response bodies.
export function shadowUsage(row: Record<string, unknown>) {
  const path = process.env.DONE_DONE_SHADOW_TIMING;
  if (!path) return;
  const attemptId = randomUUID();
  appendFileSync(path, JSON.stringify({ schema_version: 1, kind: 'provider_attempt', run_id: process.env.DONE_DONE_SHADOW_RUN_ID ?? usageContext.getStore()?.run_id ?? process.env.DONE_DONE_RUN_ID ?? shadowSessionRun, attempt_id: attemptId, parent_attempt_id: process.env.DONE_DONE_SHADOW_PARENT_ATTEMPT_ID ?? null, leaf_id: process.env.DONE_DONE_SHADOW_LEAF_ID ?? null, call_id: attemptId, step: null, reason: null, cache_identity: usageContext.getStore()?.cache_identity ?? null, cache_hit: false, provider_request_id: null, tier: usageContext.getStore()?.tier ?? null, usage_source: null, input_tokens_or_null: null, output_tokens_or_null: null, cache_read_write_or_null: null, billed_units_or_null: null, actual_cost_and_currency_or_null: null, dated_estimate_or_null: null, ...row }) + '\n', { mode: 0o600 });
}
