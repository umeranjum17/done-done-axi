import { dirname, posix } from 'node:path';
const EXT = ['', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx', '.sh', '/index.ts', '/index.js'];
const SPEC = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"]([^'"]+)['"]|(?:^|[;&|]\s*|\n\s*)(?:source|\.)\s+['"]?([^\s'";&|]+)/g;
const QUOTED = /['"`]([^'"`\s]+\/[^'"`\s]*|[\w.-]+\.[A-Za-z]\w*)['"`]/g;
const WORDS = /(?<![\w@.\/-])\.{0,2}\/?[\w@.+-]+(?:\/[\w@.+-]+)+\/?/g;
export function reach(roots, tracked, read) {
    const exact = new Set(tracked);
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
    while (queue.length) {
        const from = queue.shift();
        const chain = out.files.get(from);
        const text = read(from);
        if (text === undefined)
            continue;
        const here = dirname(from);
        const resolve = (spec) => {
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
                if (tracked.some((t) => t.startsWith(`${clean}/`)))
                    return { dir: clean };
            }
            return {};
        };
        const note = (spec) => {
            const { file, dir } = resolve(spec);
            if (file && file !== from)
                add(file, [...chain, file]);
            else if (dir && !out.dirs.has(dir))
                out.dirs.set(dir, [...chain, `${dir}/`]);
        };
        for (const m of text.matchAll(SPEC))
            note(m[1] ?? m[2]);
        for (const m of text.matchAll(QUOTED))
            note(m[1]);
        for (const m of text.matchAll(WORDS))
            note(m[0]);
    }
    return out;
}
