// Test size bounds. A journey (a test) may declare `size:` in .done-done.yaml; the size is its time bound, and a run past
// it is stopped and called slow. A repo opts in by sizing any journey: lint then fails a journey with no size and a large
// one with no `reason:`. Large journeys are night-only: `run` and `tests measure` refuse them without --night.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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
// Run a shell command; past its size bound the whole process group is killed and the run is slow. No size: no bound.
export function runBounded(command, opts) {
    const limit = isSize(opts.size) ? SIZES[opts.size] : null;
    return new Promise((done) => {
        const start = Date.now();
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
        const end = (code) => { if (timer)
            clearTimeout(timer); done({ code, ms: Date.now() - start, slow }); };
        child.on('error', () => end(null)).on('close', end);
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
