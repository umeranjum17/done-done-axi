// `done-done lint`: the deterministic merge gate on a worker's claim. It reads the newest "## Checks" block of a PR body
// or report file and fails an unproven, reused or oversized claim. No judge, no model, no repo config.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
// Third-party, legal text and committed build output are not reviewable code.
const GENERATED = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|go\.sum|[^/]*\.lock)$|(^|\/)vendor\/|(^|\/)dist\/|(^|\/)(LICENSE|LICENSES|NOTICE|COPYING)[^/]*$/;
export const SIZE_LIMIT = 1000;
const FIX_TITLE = /^(fix|bugfix|hotfix)\b/i;
const NOT_APPLICABLE = /^n\/?a\b/i;
const gh = (...args) => {
    const r = spawnSync('gh', args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 1 << 28 });
    return { status: r.error ? 1 : r.status, stdout: r.stdout ?? '', stderr: r.error?.message ?? r.stderr ?? '' };
};
// Added minus deleted non-generated lines of a unified diff: a line moved between files cancels out.
function netLines(diff) {
    const net = new Map();
    let generated = false;
    for (const l of diff.split('\n')) {
        if (l.startsWith('+++ ')) {
            generated = GENERATED.test(l.startsWith('+++ b/') ? l.slice(6) : l.slice(4));
            continue;
        }
        if (l.startsWith('--- ') || generated || !l.slice(1).trim())
            continue;
        if (l[0] === '+' || l[0] === '-')
            net.set(l.slice(1).trim(), (net.get(l.slice(1).trim()) ?? 0) + (l[0] === '+' ? 1 : -1));
    }
    let total = 0;
    for (const n of net.values())
        if (n > 0)
            total += n;
    return total;
}
const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
// src: a PR URL or a report file; ev: the folder the evidence names are relative to; dir: where the hash store and log live.
export function lint(src, ev, dir, run = gh) {
    const log = (v) => {
        mkdirSync(dir, { recursive: true });
        appendFileSync(join(dir, 'lint.log'), `${new Date().toISOString()}\t${src}\t${v.head}\t${v.ok ? 'pass' : 'fail'}\t${v.why}\n`);
        return v;
    };
    let body = '', title = '', head = '-', task = '';
    if (existsSync(src) && statSync(src).isFile()) {
        body = readFileSync(src, 'utf8');
        task = basename(dirname(resolve(src)));
    }
    else {
        const r = run('pr', 'view', src, '--json', 'author,body,title,files,headRefOid,headRefName');
        if (r.status)
            return log({ ok: false, why: `gh pr view failed: ${r.stderr.trim().split('\n').pop()?.slice(0, 160) || '?'}`, head });
        const pr = JSON.parse(r.stdout);
        ({ body, title } = { body: pr.body ?? '', title: pr.title ?? '' });
        head = pr.headRefOid ?? '-';
        task = String(pr.headRefName ?? '').split('/').pop();
        const author = pr.author?.login ?? '';
        if (/^(app\/)?(dependabot|renovate)(\[bot\])?$/.test(author))
            return log({ ok: true, why: 'bot', head });
        let size = (pr.files ?? []).reduce((n, f) => n + (GENERATED.test(f.path ?? '') ? 0 : f.additions ?? 0), 0);
        if (size >= SIZE_LIMIT) {
            const d = run('pr', 'diff', src);
            if (!d.status)
                size = netLines(d.stdout);
        }
        if (size >= SIZE_LIMIT)
            return log({ ok: false, why: `${size} added non-generated lines (moved lines excluded): split it (limit ${SIZE_LIMIT})`, head });
    }
    const fail = (why) => log({ ok: false, why, head });
    const block = [...body.matchAll(/^##\s*Checks\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/gm)].pop(); // newest: workers append, never replace
    if (!block)
        return fail('no "## Checks" block');
    const f = {};
    for (const m of block[1].replace(/```\w*/g, '').matchAll(/^\s*(outcome|repro|proof|evidence)\s*:\s*(.*)$/gm))
        f[m[1]] = m[2].trim();
    const missing = ['outcome', 'repro', 'proof', 'evidence'].filter((k) => !f[k]);
    if (missing.length)
        return fail(`missing or empty Checks line: ${missing.join(', ')}`);
    if (!/[/`]|\.\w{2,4}\b|\b(npm|pnpm|yarn|npx|bash|sh|python3?|node|cargo|go|gradle|make|adb|xcrun|done-done)\b/.test(f.proof))
        return fail('proof: names no command or path');
    const skills = join(process.cwd(), '.agents', 'skills');
    const hasVerify = existsSync(skills) && readdirSync(skills).some((d) => d.startsWith('verify-'));
    if (!f.proof.includes('verify-') && (hasVerify || !/no verify skill/i.test(f.proof)))
        return fail(`proof: does not name the verify-<app> skill run${hasVerify ? '' : ' (or "no verify skill")'}`);
    if (NOT_APPLICABLE.test(f.repro) && FIX_TITLE.test(title))
        return fail('repro: is n/a on a fix PR');
    if (/^not proven\s*:\s*\S/i.test(f.evidence))
        return log({ ok: true, why: `not-proven: ${f.evidence.slice(0, 120)}`, head });
    const names = f.evidence.split(/[,\s]+/).map((n) => n.replace(/^[`"']+|[`"']+$/g, '')).filter((n) => /\.\w{1,10}$/.test(n));
    if (!names.length)
        return fail('evidence: names no files (or write "not proven: <cause>")');
    const store = join(dir, 'lint.hashes');
    const seen = new Map();
    if (existsSync(store))
        for (const l of readFileSync(store, 'utf8').split('\n')) {
            const p = l.split(' ');
            if (p.length === 2)
                seen.set(p[0], p[1]);
        }
    // The evidence folder is born when the task starts, so a file older than it was captured for something else.
    const born = existsSync(ev) ? statSync(ev).birthtimeMs : 0;
    const mine = [];
    let fresh = false;
    for (const n of names) {
        const p = isAbsolute(n) ? n : join(ev, n);
        if (!existsSync(p) || !statSync(p).isFile() || statSync(p).size === 0)
            return fail(`evidence file missing or empty: ${p}`);
        if (born && statSync(p).mtimeMs < born)
            return fail(`evidence file older than the task start: ${p}`);
        const h = sha256(p);
        mine.push(h);
        const owner = seen.get(h); // the same task's earlier lint is not reuse
        if (owner === undefined || owner === src || owner === task)
            fresh = true;
    }
    if (!fresh)
        return fail('every evidence file was already used by another PR');
    if (new Set(mine).size < mine.length)
        return fail('two evidence files are byte-identical: capture each claimed state separately, or write "not proven: <cause>"');
    mkdirSync(dir, { recursive: true });
    for (const h of mine)
        if (!seen.has(h))
            appendFileSync(store, `${h} ${task || src}\n`);
    return log({ ok: true, why: `${names.length} evidence files`, head });
}
