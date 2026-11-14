import { parseDuration, UsageError } from './config.js';

// The time limit of `check`'s plain checks (check.timeout). The work between two ticks is bounded, so a tick that finds the limit
// spent stops the check with the line it was judging; nothing here runs on a timer, so a loop that never ticks is not covered.
export type Deadline = { judging: (what: string) => void; tick: () => void };

export function checkDeadline(limit: string, now: () => number = Date.now): Deadline {
  const end = now() + parseDuration(limit)!;
  let what = 'the claim';
  return {
    judging: (w) => { what = w; },
    tick: () => {
      if (now() > end)
        throw new UsageError(
          `check: stopped after ${limit} (check.timeout) while judging ${what}; the judge was not asked, so there is no verdict`,
          'Fix what makes that line slow, or raise check.timeout in .done-done.yaml (a duration such as 10m), then re-run: done-done check',
        );
    },
  };
}
