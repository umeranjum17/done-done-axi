// Test improvement plan (`done-done tests improve --plan-only`, stage `proposed`). It only reads: the tests are the repo's
// journeys, measured and valued by `tests value` (one clean-copy run each), and every test gets one action:
//   keep  catches faults and no faster test catches the same set, in the smallest tier it fits
//   drop  catches no fault (slop) or exactly what a faster test catches (duplicate)
//   move  real, but sized for a bigger tier than its measured time needs: `to` names the smaller tier
//   fix   fails on the clean copy, so nothing is known about it
// gaps are the planted faults that no test caught: source lines nothing protects. faults records every planted fault, so
// `tests improve --apply` can rerun the kept tests against the same ones.
import { SIZES, isSize } from './size.js';
// A move needs headroom: the test must take at most a third of the smaller tier's bound.
const HEADROOM = 3;
const tiers = Object.keys(SIZES).sort((a, b) => SIZES[a] - SIZES[b]);
const smallestTier = (seconds) => tiers.find((t) => seconds * 1000 * HEADROOM <= SIZES[t]) ?? tiers[tiers.length - 1];
function rowFor(v, size) {
    const base = { test: v.test, ...(size !== undefined && { size }), seconds: v.seconds, caught: v.caught };
    if (v.verdict === 'failing')
        return { ...base, action: 'fix', why: 'fails on the clean copy' };
    if (v.verdict === 'slop')
        return { ...base, action: 'drop', why: 'catches no fault: it passes on broken code' };
    if (v.verdict === 'duplicate')
        return { ...base, action: 'drop', why: `catches the same faults as ${v.duplicate_of}, which is faster or named first` };
    const fit = smallestTier(v.seconds);
    if (isSize(size) && SIZES[fit] < SIZES[size])
        return { ...base, action: 'move', to: fit, why: `takes ${v.seconds}s, which fits the ${fit} tier, not ${size}` };
    return { ...base, action: 'keep', why: `catches ${v.caught} fault${v.caught === 1 ? '' : 's'} that no faster test catches` };
}
export function planImprove(tests, sizes, faults, uncaught) {
    return {
        stage: 'proposed',
        faults,
        rows: tests.map((v) => rowFor(v, sizes[v.test])),
        gaps: uncaught.map((f) => ({ file: f.file, line: f.line, change: `${f.was.trim()} => ${f.now.trim()}` })),
    };
}
