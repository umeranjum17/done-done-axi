import { posix } from 'node:path';
import { codeOnly } from './proof.js';
// The tracked files and folders a text names. Paths are read relative to the repo, then to `from` (a feature file's folder,
// for its markdown links); a folder counts only when written with a slash (src/), so a prose word never names one.
// ponytail: a path with brackets or parens (pages/[id].tsx) is not read; add those characters when a repo cites one.
function refs(text, tracked, from) {
    const files = new Set();
    const dirs = new Set();
    const exact = new Set(tracked);
    for (let tok of text.match(/[\w@.\/+-]+/g) ?? []) {
        tok = tok.replace(/\.+$/, '');
        if (!tok)
            continue;
        if (!tok.includes('/')) {
            if (/\.[A-Za-z]\w*$/.test(tok))
                for (const t of tracked)
                    if (t === tok || t.endsWith(`/${tok}`))
                        files.add(t);
            continue;
        }
        for (const p of [posix.normalize(tok), ...(from ? [posix.join(from, tok)] : [])]) {
            const clean = p.replace(/^\.\//, '').replace(/\/+$/, '');
            if (!clean || clean.startsWith('..'))
                continue;
            if (exact.has(clean))
                files.add(clean);
            else if (tracked.some((t) => t.startsWith(`${clean}/`)))
                dirs.add(clean);
        }
    }
    return { files, dirs: [...dirs] };
}
const covers = (r, p) => r.files.has(p) || r.dirs.some((d) => p.startsWith(`${d}/`));
// The journeys and features `changed` needs. features: each feature file's text by name; skill: the skill folder; coreFeature:
// the feature the feature map marks (core journey), for the fallback; noBase: why there is no diff to read, if so.
export function mapChange(o) {
    // A code-only journey is no proof, so the change never needs one.
    const real = Object.keys(o.journeys).filter((n) => !codeOnly(o.journeys[n].command));
    const jRefs = new Map(real.map((n) => [n, refs(o.journeys[n].command, o.tracked)]));
    const featDir = posix.join(o.skill, 'features');
    const fRefs = new Map(Object.entries(o.features).map(([n, text]) => [n, refs(text, o.tracked, featDir)]));
    // The journeys each feature names: `run <journey>` or `verify <journey>`, or a file its command runs that the feature cites too.
    const named = new Map(Object.entries(o.features).map(([n, text]) => {
        const said = new Set([...text.matchAll(/\b(?:run|verify)\s+`?([\w.-]+)/g)].map((m) => m[1]));
        const r = fRefs.get(n);
        return [n, real.filter((j) => said.has(j) || [...jRefs.get(j).files].some((f) => r.files.has(f)))];
    }));
    const journeys = new Map();
    const features = new Map();
    const hit = (m, name, why) => m.set(name, [...(m.get(name) ?? []), why]);
    const unmapped = [];
    for (const c of o.changed) {
        let found = false;
        for (const [j, r] of jRefs)
            if (covers(r, c)) {
                hit(journeys, j, `its command runs ${c}`);
                found = true;
            }
        // The skill's own SKILL.md and feature map are what every feature follows, so they need every feature.
        const shared = c.startsWith(`${o.skill}/`) && !(c.startsWith(`${featDir}/`) && posix.basename(c, '.md') in o.features);
        for (const [f, r] of fRefs) {
            if (!shared && c !== posix.join(featDir, `${f}.md`) && !covers(r, c))
                continue;
            found = true;
            const why = shared ? `every feature follows ${c}` : c === posix.join(featDir, `${f}.md`) ? `feature ${f} changed` : `feature ${f} cites ${c}`;
            const js = named.get(f);
            if (js.length)
                for (const j of js)
                    hit(journeys, j, why);
            else
                hit(features, f, why);
        }
        if (!found)
            unmapped.push(c);
    }
    // Uncertain: the core journey runs too; with no core journey named, every real journey does, so the answer is never less.
    const uncertain = o.noBase ?? (unmapped.length ? `${unmapped.length} changed ${unmapped.length === 1 ? 'file is' : 'files are'} in no feature or journey` : '');
    let fallback = null;
    if (uncertain) {
        const core = real.filter((j) => o.journeys[j].core);
        const why = `uncertain: ${uncertain}`;
        if (core.length)
            core.forEach((j) => hit(journeys, j, why));
        else if (o.coreFeature && o.coreFeature in o.features)
            (named.get(o.coreFeature).length ? named.get(o.coreFeature).forEach((j) => hit(journeys, j, why)) : hit(features, o.coreFeature, why));
        else if (real.length)
            real.forEach((j) => hit(journeys, j, `${why}, and no core journey is named`));
        else
            Object.keys(o.features).forEach((f) => hit(features, f, `${why}, and no core journey is named`));
        fallback = why;
    }
    const list = (m) => [...m].map(([name, why]) => ({ name, why: [...new Set(why)] }));
    return { journeys: list(journeys), features: list(features), unmapped, fallback };
}
