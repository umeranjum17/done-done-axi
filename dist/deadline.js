import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
export class UsageError extends Error {
    help;
    constructor(message, help) {
        super(message);
        this.help = help;
    }
}
export const parseDuration = (text) => {
    const m = /^(\d+)(s|m|h)$/.exec(text);
    const ms = m ? Number(m[1]) * { s: 1000, m: 60_000, h: 3_600_000 }[m[2]] : 0;
    return ms > 0 && ms <= 2_147_483_647 ? ms : null;
};
const SLOT = { cheap: { input: 1800, output: 200 }, large: { input: 3000, output: 300 } };
// Lock failure is a refusal, including after a crash left a lock behind: it must never renew an allowance.
function updatePlan(path, change) {
    const lock = `${path}.lock`;
    try {
        mkdirSync(lock, { mode: 0o700 });
    }
    catch (e) {
        if (e.code === 'EEXIST')
            throw new UsageError('layer plan is locked; no provider request was made');
        throw e;
    }
    try {
        const plan = JSON.parse(readFileSync(path, 'utf8'));
        const result = change(plan);
        const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
        writeFileSync(tmp, `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
        renameSync(tmp, path);
        return result;
    }
    finally {
        rmdirSync(lock);
    }
}
export function layerRemaining(planPath) {
    const plan = JSON.parse(readFileSync(planPath, 'utf8'));
    if (typeof plan.deadline_monotonic_ns !== 'string' || !/^\d+$/.test(plan.deadline_monotonic_ns))
        throw new UsageError('layer plan has no valid monotonic deadline');
    if (plan.boot_id !== readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim())
        throw new UsageError('layer plan was created on a different boot; no provider request was made');
    const ms = Number((BigInt(plan.deadline_monotonic_ns) - process.hrtime.bigint()) / 1000000n);
    if (ms <= 1000)
        throw new UsageError('layer deadline expired; no provider request was made');
    return ms - 1000;
}
export function reserveProvider(path, slot) {
    layerRemaining(path);
    return updatePlan(path, (plan) => {
        const ledger = plan.model_budget;
        if (!ledger || ledger.limit !== 5300 || !ledger.slots || !Array.isArray(ledger.attempts))
            throw new UsageError('layer plan has no valid 5300-token ledger');
        if (ledger.slots[slot] !== null)
            throw new UsageError(`layer ${slot} provider allowance is already reserved; no provider request was made`);
        const id = randomUUID(), bound = SLOT[slot];
        ledger.slots[slot] = id;
        ledger.attempts.push({ id, slot, reserved: bound.input + bound.output, input_tokens: null, output_tokens: null, status: 'dispatched' });
        return { id, ...bound };
    });
}
export function recordProviderUsage(path, id, input, output) {
    updatePlan(path, (plan) => {
        const attempt = plan.model_budget?.attempts?.find((a) => a.id === id);
        if (!attempt)
            throw new UsageError('layer provider reservation is missing');
        attempt.input_tokens = input;
        attempt.output_tokens = output;
        attempt.status = 'completed';
    });
}
// A layer's supervisor owns every detached process group. Each runner publishes its group before it awaits work;
// when the environment has no layer registry this is a no-op and ordinary verify behavior is unchanged.
export function registerGroup(pid, env = process.env) {
    const dir = env.DONE_DONE_LAYER_GROUPS;
    if (!dir)
        return;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
        writeFileSync(join(dir, String(pid)), `${pid}\n`, { flag: 'wx', mode: 0o600 });
    }
    catch (error) {
        try {
            process.kill(-pid, 'SIGKILL');
        }
        catch { /* group already exited */ }
        throw error;
    }
}
export function unregisterGroup(pid, env = process.env) {
    if (env.DONE_DONE_LAYER_GROUPS)
        rmSync(join(env.DONE_DONE_LAYER_GROUPS, String(pid)), { force: true });
}
export function cancelGroups(dir, signal, exclude) {
    let groups;
    try {
        groups = readdirSync(dir);
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return;
        throw error;
    }
    for (const group of groups)
        if (/^[1-9]\d*$/.test(group) && Number(group) !== exclude) {
            try {
                process.kill(-Number(group), signal);
            }
            catch (error) {
                if (error.code !== 'ESRCH')
                    throw error;
            }
        }
}
// Probe the actual host before relying on process-group cancellation. The probe owns only its own child.
export async function processGroupSupported() {
    if (process.platform !== 'linux')
        return false;
    return new Promise((resolve) => {
        const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
        if (child.pid)
            registerGroup(child.pid);
        let settled = false;
        const finish = (ok) => { if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(ok);
        } };
        const timer = setTimeout(() => { if (child.pid)
            child.kill('SIGKILL'); finish(false); }, 1000);
        child.once('error', () => finish(false));
        child.once('spawn', () => {
            try {
                process.kill(-child.pid, 'SIGKILL');
            }
            catch {
                child.kill('SIGKILL');
                finish(false);
            }
        });
        child.once('exit', (_code, signal) => { if (child.pid)
            unregisterGroup(child.pid); finish(signal === 'SIGKILL'); });
    });
}
export function checkDeadline(limit, now = Date.now) {
    const end = now() + parseDuration(limit);
    let what = 'the claim';
    return {
        judging: (w) => { what = w; },
        tick: () => {
            if (now() > end)
                throw new UsageError(`check: stopped after ${limit} (check.timeout) while judging ${what}; the judge was not asked, so there is no verdict`, 'Fix what makes that line slow, or raise check.timeout in .done-done.yaml (a duration such as 10m), then re-run: done-done check');
        },
    };
}
