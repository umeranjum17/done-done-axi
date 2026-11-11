import { posix } from 'node:path';
// Files that never change what a user sees: tests and their fixtures, docs, the verify skill and journeys that prove, lock files, build output.
const FIXTURE = /(^|\/)(fixtures?|__fixtures__|testdata)\//;
const TEST = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/;
const HARNESS = /^(docs|journeys|\.agents|dist)\/|\.md$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/;
const SCREEN = /\.(tsx|jsx|vue|svelte|html|css|scss)$/;
// What an added source line says a user can now reach: a command row or dispatch, a flag, or a route.
// Each carries the word a journey must mention to cover it: the subcommand, the flag or the route path.
const SURFACES = [
    ['command usage', /\busage:\s*\[\s*\[\s*['"`]([^'"`]+)/, (m) => m[1].trim().split(/\s+/).filter((w) => /^[\w-]+$/.test(w)).pop() ?? ''],
    ['command', /\b(?:cmd|command)\s*===\s*['"]([\w-]+)['"]/, (m) => m[1]],
    ['flag', /['"](--[a-z][\w-]*)(?:\s*<[^>]+>)?['"]\s*:/, (m) => m[1]],
    ['route', /\.(?:get|post|put|patch|delete)\(\s*['"`](\/[^'"`]*)/, (m) => m[1]],
];
const kind = (p) => (FIXTURE.test(p) ? 'fixture' : TEST.test(p) ? 'test' : HARNESS.test(p) ? 'harness' : SCREEN.test(p) ? 'screen' : 'source');
const list = (xs) => (xs.length > 3 ? `${xs.slice(0, 3).join(', ')} and ${xs.length - 3} more` : xs.join(', '));
export function planQa(changed) {
    if (!changed.length)
        return { plan: 'no-test', reason: 'no changed files, so no behaviour to prove', signals: [], surfaces: [] };
    const signals = [];
    const surfaces = new Set();
    for (const c of changed) {
        const k = kind(c.path);
        if (k === 'screen')
            signals.push(`screen ${c.path}`);
        if (k === 'source') {
            for (const [name, re, word] of SURFACES) {
                const hits = c.added.map((l) => l.match(re)).filter((m) => !!m);
                if (hits.length)
                    signals.push(`${name} in ${c.path}`);
                for (const m of hits)
                    if (word(m))
                        surfaces.add(word(m));
            }
        }
    }
    if (signals.length)
        return { plan: 'journey', reason: `changed user-visible behaviour: ${list(signals)}; a journey must drive it`, signals, surfaces: [...surfaces] };
    const kinds = new Set(changed.map((c) => kind(c.path)));
    const names = list(changed.map((c) => posix.basename(c.path)));
    if (kinds.size === 1 && kinds.has('fixture'))
        return { plan: 'no-test', reason: `fixture refactor (${names}): only test fixtures changed, no user-visible behaviour`, signals, surfaces: [] };
    if ([...kinds].every((k) => k === 'fixture' || k === 'test'))
        return { plan: 'no-test', reason: `tests and fixtures only (${names}): no user-visible behaviour changed`, signals, surfaces: [] };
    if (!kinds.has('source'))
        return { plan: 'no-test', reason: `docs, build output or proof files only (${names}): no user-visible behaviour changed`, signals, surfaces: [] };
    return { plan: 'no-test', reason: `internal change (${names}): adds no command, flag, route or screen a user can reach`, signals, surfaces: [] };
}
// Stage writing: a journey is written only for behaviour no journey covers. A journey covers a surface when its script or
// feature text names it; the journeys passed are the ones the feature map already maps to the change.
export function planWrite(plan, mapped) {
    if (plan.plan !== 'journey')
        return { action: 'none', reason: `plan is ${plan.plan}: no journey file is written` };
    const bare = plan.surfaces.filter((s) => !mapped.some((j) => j.text.includes(s)));
    if (!mapped.length)
        return { action: 'add', reason: 'no journey covers this change' };
    if (!bare.length)
        return { action: 'none', journey: mapped[0].name, reason: `already covered by journey ${mapped[0].name}` };
    const target = mapped.find((j) => j.extendable);
    return target ? { action: 'extend', journey: target.name, reason: `journey ${target.name} runs this code but never drives ${bare.join(', ')}` } : { action: 'add', reason: `no journey drives ${bare.join(', ')} and none can be extended` };
}
export function sealStage(p) {
    const base = { journey: p.journey, max: p.max, fixes: p.fixes, ...(p.run_id && { run_id: p.run_id }) };
    if (p.result === 'pass' && p.receipt)
        return { ...base, stage: 'sealed', reason: p.fixes ? `passed after ${p.fixes} of ${p.max} fixes` : 'passed on the first run', receipt: p.receipt, help: [`Sealed: the receipt is bound to this commit; check it with done-done receipt --verify HEAD`] };
    if (p.result === 'changed' && p.fix_branch)
        return { ...base, stage: 'fixed', reason: `fixed in ${p.fixes} of ${p.max} fixes on ${p.fix_branch}; HEAD itself is not sealed`, fix_branch: p.fix_branch, help: [`Take the fix: git merge ${p.fix_branch}, then re-run this command to seal the new HEAD`] };
    const why = p.reason ?? `the run ended ${p.result}`;
    return { ...base, stage: 'fail', reason: p.fixes >= p.max && p.max > 0 ? `stopped at ${p.max} of ${p.max} fixes: ${why}` : why, help: [`Read what each attempt did: done-done status --run ${p.run_id ?? '<run-id>'}`, 'Fix the product by hand, commit, then re-run this command'] };
}
