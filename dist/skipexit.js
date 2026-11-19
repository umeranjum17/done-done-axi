// A skip is not proof: with check.skip_is_not_proof on, test commands run with JG_TEST_SKIP_EXIT=77, and a cell (one run of the
// command) that exits 77 is recorded as skipped, never as a pass. A run whose every cell skipped keeps the exit 77, so no receipt
// cites it; a run with at least one other cell that passed keeps its receipt and lists the skips.
import { SKIP_EXIT } from './newtests.js';
export const SKIP_ENV = 'JG_TEST_SKIP_EXIT';
// The env a test command gets: the exit status that means "skipped", only when the switch is on.
export const skipEnv = (on) => (on ? { [SKIP_ENV]: String(SKIP_EXIT) } : {});
// Whether this exit is a skip rather than a failure: only under the switch.
export const isSkip = (on, code) => on && code === SKIP_EXIT;
// Settle a run record after its cells ran: `skipped` names the cells that exited 77. Every cell skipped leaves exit 77 on the
// record (the receipt refuses a run whose command did not exit 0); otherwise the record keeps the exit the loop set.
export function settleSkips(rec, skipped, cells) {
    if (!skipped.length)
        return;
    rec.skipped = skipped;
    if (skipped.length === cells)
        rec.exit = SKIP_EXIT;
}
// The one line that says why a run whose every cell skipped proves nothing.
export const skipReason = (skipped) => `every test skipped (exit ${SKIP_EXIT}: ${skipped.join('; ')}); a skip is not proof`;
