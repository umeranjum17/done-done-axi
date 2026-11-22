// Test size bounds. A journey (a test) may declare `size:` in .done-done.yaml; the size is its time bound, and a run past
// it is stopped and called slow. A repo opts in by sizing any journey: lint then fails a journey with no size and a large
// one with no `reason:`. Large journeys are night-only: `run` and `tests measure` refuse them without --night.
import { spawn } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export const SIZES = { ci: 15_000, local: 300_000, large: 900_000 };
export const isSize = (s) => typeof s === 'string' && Object.hasOwn(SIZES, s);
export const MEASURE_RUNS = 5;
const bound = (size) => `${SIZES[size] / 1000}s`;
// The lint verdict: null when the repo sizes no journey or every journey has a size (and a reason when large).
export function sizeFault(journeys) {
    const all = Object.entries(journeys);
    if (!all.some(([, j]) => j.size !== undefined))
        return null;
    const bad = all.flatMap(([name, j]) => {
        if (j.size === undefined)
            return [`journey ${name} has no size (ci ${bound('ci')}, local ${bound('local')} or large ${bound('large')})`];
        if (j.size === 'large' && !j.reason?.trim())
            return [`journey ${name} is large and has no reason: say why it needs up to ${bound('large')} and runs only at night`];
        return [];
    });
    return bad.length ? bad.join('; ') : null;
}
// Why a journey may not run now, or null. A large journey is night-only.
export function nightFault(name, j, night) {
    return j.size === 'large' && !night ? `journey ${name} is large (night-only): nothing ran` : null;
}
// Run a shell command; past its bound (timeoutMs, else its size's) the whole process group is killed and the run is slow. No bound: none.
export function runBounded(command, opts) {
    const limit = opts.timeoutMs ?? (isSize(opts.size) ? SIZES[opts.size] : null);
    return new Promise((done) => {
        const start = performance.now();
        let slow = false;
        const child = spawn(command, { cwd: opts.cwd, env: opts.env, shell: true, stdio: ['inherit', 'pipe', 'pipe'], detached: limit !== null });
        const timer = limit === null ? null : setTimeout(() => {
            slow = true;
            try {
                process.kill(-child.pid, 'SIGKILL');
            }
            catch {
                child.kill('SIGKILL');
            }
        }, limit);
        for (const out of [child.stdout, child.stderr])
            out?.on('data', (b) => opts.onData?.(b));
        const end = (code, error) => { if (timer)
            clearTimeout(timer); done({ code, ms: performance.now() - start, slow, ...(error && { error }) }); };
        child.on('error', (error) => end(null, error.message)).on('close', (code) => end(code));
    });
}
export const slowReason = (name, size) => `journey ${name} is slow: it ran past its ${size} bound of ${bound(size)} and was stopped`;
// Run one journey MEASURE_RUNS times, each in its own scratch evidence folder (nothing is recorded as proof), and time them.
export async function measureJourney(name, command, size, cwd, env) {
    const runs = [];
    for (let i = 1; i <= MEASURE_RUNS; i++) {
        const dir = mkdtempSync(join(tmpdir(), 'done-done-measure-'));
        try {
            const r = await runBounded(command, { cwd, size, env: { ...env, DONE_DONE_RUN_ID: `measure-${name}-${i}`, DONE_DONE_EVIDENCE_ROOT: dir }, onData: (b) => process.stderr.write(b) });
            runs.push({ seconds: Math.round(r.ms / 10) / 100, result: r.slow ? 'slow' : r.code === 0 ? 'ok' : 'failed' });
        }
        finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }
    const verdict = runs.some((r) => r.result === 'slow') ? 'slow' : runs.some((r) => r.result === 'failed') ? 'failed' : 'within bound';
    return { journey: name, size, bound: bound(size), runs, slowest: Math.max(...runs.map((r) => r.seconds)), verdict };
}
// Shadow batches measure wall time independently of the sum of their parallel children. No deadline is enforced.
export async function shadowBatch(entries, opts) {
    const batch = randomUUID();
    const start = performance.now();
    const startedAt = new Date().toISOString();
    const log = (row) => appendFileSync(opts.journal, JSON.stringify({ schema_version: 1, run_id: batch, ...row }) + '\n', { mode: 0o600 });
    const pending = new Set(entries.map(([name]) => name));
    log({ kind: 'batch_start', started_at: startedAt, leaves: [...pending] });
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    const interrupted = (signal) => {
        log({ kind: 'batch_interrupted', duration_ms: performance.now() - start, unfinished_leaves: [...pending], signal });
        for (const sig of signals)
            process.removeListener(sig, handlers[sig]);
        process.kill(process.pid, signal);
    };
    const handlers = Object.fromEntries(signals.map(sig => [sig, () => interrupted(sig)]));
    for (const sig of signals)
        process.once(sig, handlers[sig]);
    let rows;
    try {
        rows = await Promise.all(entries.map(async ([name, command]) => {
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
                const run = (parentAttempt) => runBounded(command.replaceAll('${RUN_ID}', runId), { cwd: opts.cwd, env: { ...opts.env, DONE_DONE_RUN_ID: runId, DONE_DONE_EVIDENCE_ROOT: dir, DONE_DONE_SHADOW_RUN_ID: batch, DONE_DONE_SHADOW_PARENT_ATTEMPT_ID: parentAttempt, DONE_DONE_SHADOW_LEAF_ID: name }, onData: (b) => process.stderr.write(b) });
                const r = await run(attemptId);
                let final = r, retryMs = 0;
                if (r.code !== 0) {
                    const retryId = randomUUID(), retryStart = performance.now();
                    log({ kind: 'retry_start', attempt_id: retryId, parent_attempt_id: attemptId, leaf_id: name, started_at: new Date().toISOString() });
                    final = await run(retryId);
                    retryMs = performance.now() - retryStart;
                    log({ kind: 'retry_exit', attempt_id: retryId, parent_attempt_id: attemptId, leaf_id: name, duration_ms: retryMs, exit_or_null: final.code, ...(final.error && { error: final.error }), status: final.code === 0 ? 'passed' : 'failed' });
                }
                preserve = !!evidenceRoot || final.code !== 0;
                const row = { ...(preserve && { evidence_dir: dir }), kind: 'exit', attempt_id: attemptId, parent_attempt_id: null, leaf_id: name, submission_time_or_null: submittedAt, queue_source: null, started_at: executionAt, start_offset_ms: execution - start, end_offset_ms: performance.now() - start, duration_ms: r.ms, exit_or_null: r.code, ...(r.error && { error: r.error }), status: r.code === 0 ? 'passed' : 'failed', result_status: final.code === 0 ? 'passed' : 'failed', assertion: null, raw_report_digest: null, retry_ms: retryMs, execution_ms: r.ms };
                pending.delete(name);
                log(row);
                return row;
            }
            finally {
                if (!preserve)
                    rmSync(dir, { recursive: true, force: true });
            }
        }));
    }
    catch (error) {
        log({ kind: 'batch_interrupted', duration_ms: performance.now() - start, unfinished_leaves: [...pending], signal: null });
        throw error;
    }
    finally {
        for (const sig of signals)
            process.removeListener(sig, handlers[sig]);
    }
    const duration = performance.now() - start;
    const usage = readFileSync(opts.journal, 'utf8').trim().split('\n').map(line => JSON.parse(line)).filter(row => row.kind === 'provider_attempt' && typeof row.run_id === 'string' && row.run_id === batch);
    const result = { kind: 'batch_exit', started_at: startedAt, duration_ms: duration, usage_known_over_attempted: `${usage.filter(row => row.input_tokens_or_null !== null && row.output_tokens_or_null !== null).length}/${usage.length}`, target_ms: [120000, 300000], target: duration < 120000 ? 'under' : duration <= 300000 ? 'within' : 'over', unfinished_leaves: [...pending], status: !rows.every((row) => row.result_status === 'passed') ? 'failed' : duration > 300000 ? 'over_target' : 'passed' };
    log(result);
    return { ...result, run_id: batch, rows };
}
// Carry cache identity across CLI-backed judge dispatch without recording request content.
const usageContext = new AsyncLocalStorage();
export const withShadowCache = (key, run) => usageContext.run({ ...usageContext.getStore(), cache_identity: key }, run);
export const withShadowRun = (run_id, run) => usageContext.run({ ...usageContext.getStore(), run_id }, run);
export const withShadowTier = (tier, run) => usageContext.run({ ...usageContext.getStore(), tier }, run);
// Give standalone invocations a stable identity when no enclosing run supplies one.
const shadowSessionRun = randomUUID();
// Dispatch journal is opt-in and contains only accounting metadata, never request or response bodies.
export function shadowUsage(row) {
    const path = process.env.DONE_DONE_SHADOW_TIMING;
    if (!path)
        return;
    const attemptId = randomUUID();
    appendFileSync(path, JSON.stringify({ schema_version: 1, kind: 'provider_attempt', run_id: process.env.DONE_DONE_SHADOW_RUN_ID ?? usageContext.getStore()?.run_id ?? process.env.DONE_DONE_RUN_ID ?? shadowSessionRun, attempt_id: attemptId, parent_attempt_id: process.env.DONE_DONE_SHADOW_PARENT_ATTEMPT_ID ?? null, leaf_id: process.env.DONE_DONE_SHADOW_LEAF_ID ?? null, call_id: attemptId, step: null, reason: null, cache_identity: usageContext.getStore()?.cache_identity ?? null, cache_hit: false, provider_request_id: null, tier: usageContext.getStore()?.tier ?? null, usage_source: null, input_tokens_or_null: null, output_tokens_or_null: null, cache_read_write_or_null: null, billed_units_or_null: null, actual_cost_and_currency_or_null: null, dated_estimate_or_null: null, ...row }) + '\n', { mode: 0o600 });
}
