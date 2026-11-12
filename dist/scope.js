// The names in a --journeys value: comma separated, none empty, none twice.
export function parseList(raw) {
    const names = raw.split(',').map((n) => n.trim());
    if (!names.length || names.some((n) => !n))
        throw new Error('--journeys needs journey names separated by commas, none empty');
    const dup = names.find((n, i) => names.indexOf(n) !== i);
    if (dup)
        throw new Error(`--journeys names ${dup} twice`);
    return names;
}
// The scope for `list`: every defined journey outside it is not run, and the ones `affected` selected are the omitted affected ones.
export function minimumScope(o) {
    const unknown = o.list.filter((n) => !o.defined.includes(n));
    if (unknown.length)
        throw new Error(`unknown journey ${unknown.join(', ')}; .done-done.yaml defines: ${o.defined.join(', ') || 'none'}`);
    const not_run = o.defined.filter((n) => !o.list.includes(n));
    return { minimum: o.list, named_by: o.by, not_run, omitted_affected: o.affected.filter((n) => not_run.includes(n)) };
}
const names = (v) => Array.isArray(v) && v.every((n) => typeof n === 'string' && n);
export const scopeShape = (s) => {
    const r = s;
    return !!r && typeof r === 'object' && names(r.minimum) && r.minimum.length > 0 && typeof r.named_by === 'string' && !!r.named_by.trim() && names(r.not_run) && names(r.omitted_affected)
        && r.omitted_affected.every((n) => r.not_run.includes(n)) && r.minimum.every((n) => !r.not_run.includes(n));
};
