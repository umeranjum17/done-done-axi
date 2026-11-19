// Reusing a sealed PASS: a run whose (app, git tree of HEAD, journey, command text) matches a clean run that a PASS receipt
// cites does not run again. The tree, not the commit, is the key, so an amend or a rebase that changes no file still hits.
// This file only decides; src/cli.ts reads the receipts and run records and writes the reused run's record.
import { createHash } from 'node:crypto';

export type ReuseRun = { run_id: string; journey: string | null; command: string | null };
export type ReuseReceipt = { tree: string; runs: ReuseRun[] };
export type ReuseRecord = { run_id: string; tree: string; dirty: boolean; exit: number | null; ended_at: string | null };
export type ReuseAsk = { app: string; tree: string; journey: string | null; command: string };

// A run's command holds its own run id (the `${RUN_ID}` it expanded); restore the placeholder so two runs of one command compare equal.
const template = (command: string, runId: string) => command.replaceAll(runId, '${RUN_ID}');

export const reuseKey = (k: ReuseAsk): string => createHash('sha256').update(JSON.stringify([k.app, k.tree, k.journey, k.command])).digest('hex');

// The id of the sealed run `ask` repeats, or undefined. `sealed` says the receipt's cited evidence still matches its hashes;
// a run counts only if its own record is clean, at that tree and exited 0.
export function sealedPass(ask: ReuseAsk, receipts: ReuseReceipt[], records: ReuseRecord[], sealed: (r: ReuseReceipt) => boolean): string | undefined {
  const want = reuseKey(ask);
  for (const rec of receipts) {
    for (const run of rec.runs) {
      if (run.command === null || reuseKey({ app: ask.app, tree: rec.tree, journey: run.journey, command: template(run.command, run.run_id) }) !== want) continue;
      const r = records.find((x) => x.run_id === run.run_id);
      if (r && r.ended_at && r.exit === 0 && !r.dirty && r.tree === ask.tree && sealed(rec)) return run.run_id;
    }
  }
  return undefined;
}
