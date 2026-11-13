import { type LiveEntry, parseDuration } from './config.js';
import { runBounded } from './size.js';

// The live tier: bounded checks of a real home, run one after another with no agent and no judge. Each entry is killed at its own
// timeout, so the whole run ends inside the sum of the timeouts (bound). A red entry is a result row, never a failed landing: nothing
// here records evidence, a receipt or a run.

// reason: why a red entry is red (the exit code or the bound that stopped it, then the last line it printed); '' when green.
export type LiveRow = { name: string; result: 'green' | 'red'; seconds: number; reason: string };
export type LiveReport = { rows: LiveRow[]; seconds: number; bound: number };

const seconds = (ms: number) => Math.round(ms / 10) / 100;
const MAX_TAIL = 400;
const MAX_REASON = 200;

// The last printed line of what a command wrote, without colour codes.
const lastLine = (text: string) => text.replace(/\x1b\[[\d;]*m/g, '').split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';

export async function runLive(entries: Record<string, LiveEntry>, opts: { cwd: string; env: NodeJS.ProcessEnv; onData?: (b: Buffer) => void }): Promise<LiveReport> {
  const rows: LiveRow[] = [];
  let bound = 0;
  const start = Date.now();
  for (const [name, entry] of Object.entries(entries)) {
    // The timeout was checked as a duration when the config loaded.
    const timeoutMs = parseDuration(entry.timeout)!;
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
