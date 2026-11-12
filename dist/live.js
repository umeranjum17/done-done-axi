import { parseDuration } from './config.js';
import { runBounded } from './size.js';
const seconds = (ms) => Math.round(ms / 10) / 100;
const MAX_TAIL = 400;
const MAX_REASON = 200;
// The last printed line of what a command wrote, without colour codes.
const lastLine = (text) => text.replace(/\x1b\[[\d;]*m/g, '').split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';
export async function runLive(entries, opts) {
    const rows = [];
    let bound = 0;
    const start = Date.now();
    for (const [name, entry] of Object.entries(entries)) {
        // The timeout was checked as a duration when the config loaded.
        const timeoutMs = parseDuration(entry.timeout);
        bound += timeoutMs;
        let tail = '';
        const r = await runBounded(entry.command, {
            cwd: opts.cwd,
            env: opts.env,
            timeoutMs,
            onData: (b) => {
                opts.onData?.(b);
                tail = (tail + b.toString('utf8')).slice(-MAX_TAIL);
            },
        });
        const green = !r.slow && r.code === 0;
        const why = r.slow ? `timed out after ${entry.timeout}` : r.code === null ? 'ended with no exit code' : `exit ${r.code}`;
        const said = green ? '' : lastLine(tail);
        rows.push({ name, result: green ? 'green' : 'red', seconds: seconds(r.ms), reason: green ? '' : `${why}${said ? `: ${said}` : ''}`.slice(0, MAX_REASON) });
    }
    return { rows, seconds: seconds(Date.now() - start), bound: seconds(bound) };
}
