import { parseDuration, UsageError } from './config.js';
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
