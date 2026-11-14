import { dirname, posix } from 'node:path';
const EXT = ['', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx', '.sh', '/index.ts', '/index.js'];
const SPEC = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"]([^'"]+)['"]|(?:^|[;&|]\s*|\n\s*)(?:source|\.)\s+['"]?([^\s'";&|]+)/g;
const QUOTED = /['"`]([^'"`\s]+\/[^'"`\s]*|[\w.-]+\.[A-Za-z]\w*)['"`]/g;
const WORDS = /(?<![\w@.\/-])\.{0,2}\/?[\w@.+-]+(?:\/[\w@.+-]+)+\/?/g;
// One reacher per repo state: it indexes the tracked paths once and reads and scans each file once, however many journeys
// ask what they reach, so a repo with hundreds of journeys costs one pass over its files, not one pass per journey.
// tick runs once per file followed: the caller's time limit.
export function reacher(tracked, read, tick = () => { }) {
    const exact = new Set(tracked);
    // Every folder that holds a tracked file, so `a/b` names a folder in one lookup.
    const folders = new Set();
    for (const t of tracked)
        for (let d = posix.dirname(t); d !== '.' && d !== '/' && !folders.has(d); d = posix.dirname(d))
            folders.add(d);
    const resolve = (spec, here) => {
        // A spec reaches the repo only when it names a tracked path (from the root or this file's folder); `lodash` names none.
        for (const b of [posix.normalize(spec), posix.join(here, spec)]) {
            const clean = b.replace(/^\.\//, '').replace(/\/+$/, '');
            if (!clean || clean.startsWith('..'))
                continue;
            // ESM imports spell the built extension (./x.js for x.ts).
            for (const c of [clean, clean.replace(/\.(m|c)?js$/, '.$1ts')])
                for (const e of EXT)
                    if (exact.has(c + e))
                        return { file: c + e };
            if (folders.has(clean))
                return { dir: clean };
        }
        return undefined;
    };
    const edges = new Map();
    const edgesOf = (from) => {
        const known = edges.get(from);
        if (known)
            return known;
        const found = [];
        const text = read(from);
        if (text !== undefined) {
            const here = dirname(from);
            const note = (spec) => {
                const edge = resolve(spec, here);
                if (edge)
                    found.push(edge);
            };
            for (const m of text.matchAll(SPEC))
                note(m[1] ?? m[2]);
            for (const m of text.matchAll(QUOTED))
                note(m[1]);
            for (const m of text.matchAll(WORDS))
                note(m[0]);
        }
        edges.set(from, found);
        return found;
    };
    return (roots) => {
        const out = { files: new Map(), dirs: new Map() };
        const queue = [];
        const add = (p, chain) => {
            if (out.files.has(p))
                return;
            out.files.set(p, chain);
            queue.push(p);
        };
        for (const r of roots)
            add(r, [r]);
        for (let i = 0; i < queue.length; i++) {
            tick();
            const from = queue[i];
            const chain = out.files.get(from);
            for (const edge of edgesOf(from)) {
                if ('file' in edge) {
                    if (edge.file !== from)
                        add(edge.file, [...chain, edge.file]);
                }
                else if (!out.dirs.has(edge.dir))
                    out.dirs.set(edge.dir, [...chain, `${edge.dir}/`]);
            }
        }
        return out;
    };
}
