// Test improvement plan (`done-done tests improve --plan-only`, stage `proposed`). It only reads: the tests are the repo's
// journeys, measured and valued by `tests value` (one clean-copy run each), and every test gets one action:
//   keep  catches faults and no faster test catches the same set, in the smallest tier it fits
//   keep  possible duplicates remain protected when fault overlap does not prove their outcomes equivalent
//   move  real, but sized for a bigger tier than its measured time needs: `to` names the smaller tier
//   fix   fails on the clean copy or catches no recorded fault
// gaps are the planted faults that no test caught: source lines nothing protects. faults records every planted fault, so
// `tests improve --apply` can rerun the kept tests against the same ones.
import { SIZES, isSize } from './size.js';
import { createHash } from 'node:crypto';
// A move needs headroom: the test must take at most a third of the smaller tier's bound.
const HEADROOM = 3;
const tiers = Object.keys(SIZES).sort((a, b) => SIZES[a] - SIZES[b]);
const smallestTier = (seconds) => tiers.find((t) => seconds * 1000 * HEADROOM <= SIZES[t]) ?? tiers[tiers.length - 1];
function rowFor(v, size) {
    const base = { test: v.test, ...(size !== undefined && { size }), seconds: v.seconds, caught: v.caught };
    if (v.verdict === 'failing')
        return { ...base, action: 'fix', why: 'fails on the clean copy' };
    if (v.verdict === 'slop')
        return { ...base, action: 'fix', why: 'catches no fault; keep protection and propose a repair' };
    if (v.verdict === 'duplicate')
        return { ...base, action: 'keep', why: `possible duplicate of ${v.duplicate_of}: not provably lossless` };
    const fit = smallestTier(v.seconds);
    if (isSize(size) && SIZES[fit] < SIZES[size])
        return { ...base, action: 'move', to: fit, why: `takes ${v.seconds}s, which fits the ${fit} tier, not ${size}` };
    return { ...base, action: 'keep', why: `catches ${v.caught} fault${v.caught === 1 ? '' : 's'} that no faster test catches` };
}
export function planImprove(tests, sizes, faults, uncaught, project = '') {
    return {
        stage: 'proposed',
        faults,
        combinations: tests.filter((v) => v.verdict === 'duplicate' && v.duplicate_of).map((v) => ({ tests: [v.test, v.duplicate_of], reason: 'not provably lossless' })),
        rows: tests.map((v) => {
            const row = rowFor(v, sizes[v.test]);
            return row.action === 'fix' ? { ...row, repair_key: createHash('sha256').update(JSON.stringify([project, v.test, v.verdict])).digest('hex') } : row;
        }),
        gaps: uncaught.map((f) => ({ file: f.file, line: f.line, change: `${f.was.trim()} => ${f.now.trim()}` })),
    };
}
