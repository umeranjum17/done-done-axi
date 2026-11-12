import { posix } from 'node:path';
// The names in a --affected-by value: comma separated repo paths, none empty, none twice, none outside the repo.
export function parseFiles(raw) {
    const files = raw.split(',').map((f) => posix.normalize(f.trim()).replace(/^\.\//, ''));
    if (!files.length || files.some((f) => f === '.' || f.startsWith('/') || f === '..' || f.startsWith('../')))
        throw new Error('--affected-by needs repo file paths separated by commas, none empty and none outside the repo');
    const dup = files.find((f, i) => files.indexOf(f) !== i);
    if (dup)
        throw new Error(`--affected-by names ${dup} twice`);
    return files;
}
export const affectedProof = (o) => ({ extends: { head: o.prior.head, sha256: o.prior.sha256, review: o.prior.review ?? 'none' }, files: o.files, journeys: o.journeys, ran: [], review: 'not run again' });
// The review record an extended receipt carries: no review ran for this head, and the prior receipt holds the last one.
export const noReview = (a) => ({ state: 'skipped', reason: `not run again: this receipt extends the receipt for ${a.extends.head.slice(0, 12)} (review ${a.extends.review})` });
const names = (v) => Array.isArray(v) && v.every((n) => typeof n === 'string' && n);
export const affectedShape = (v) => {
    const a = v;
    return !!a && typeof a === 'object' && !!a.extends && /^[0-9a-f]{40}$/.test(a.extends.head) && /^[0-9a-f]{64}$/.test(a.extends.sha256) && typeof a.extends.review === 'string'
        && names(a.files) && a.files.length > 0 && names(a.journeys) && a.journeys.length > 0 && names(a.ran) && a.ran.every((n) => a.journeys.includes(n)) && a.review === 'not run again';
};
// The selected journeys no run has driven yet: a receipt with any left is not proof of the affected set.
export const undriven = (a) => a.journeys.filter((j) => !a.ran.includes(j));
const sameAs = (a, b) => a.extends.head === b.extends.head && a.files.join() === b.files.join() && a.journeys.join() === b.journeys.join();
// The receipt a run of `journey` writes: when an earlier run of the same selection (same prior receipt, files, journeys and claim)
// already wrote a receipt for this head that has not driven this journey, the two merge into one, so the journeys of a selection
// add up to one receipt. Anything else starts a new receipt, which also replaces an older run's proof of this journey.
export function extendReceipt(earlier, fresh, journey) {
    const a = fresh.affected;
    const merge = !!earlier?.affected && sameAs(earlier.affected, a) && earlier.claim === fresh.claim && !earlier.affected.ran.includes(journey);
    const ran = [...new Set([...(merge ? earlier.affected.ran : []), journey])];
    if (!merge)
        return { ...fresh, affected: { ...a, ran } };
    const once = (rows, key) => rows.filter((r, i) => rows.findIndex((o) => key(o) === key(r)) === i);
    const rows = (k) => (earlier.judge[k] || fresh.judge[k] ? { [k]: [...(earlier.judge[k] ?? []), ...(fresh.judge[k] ?? [])] } : {});
    return {
        ...fresh,
        files: once([...earlier.files, ...fresh.files], (f) => f.path),
        runs: once([...earlier.runs, ...fresh.runs], (r) => r.run_id),
        judge: { ...earlier.judge, ...fresh.judge, verdicts: once([...earlier.judge.verdicts, ...fresh.judge.verdicts], (v) => v.path), ...rows('approved_design'), ...rows('approved_redesign'), ...rows('approved_requirements') },
        affected: { ...a, ran },
    };
}
