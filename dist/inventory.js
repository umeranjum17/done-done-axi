// `done-done inventory`: who owns each test file. A repo opts in by committing .done-done-inventory.json, a map of
// repo-relative path -> { owner, sha256 }. Lint then fails a test file with no entry (a stray) and an owned file whose
// bytes no longer match its entry (a hand edit). Only a done-done run or a journey command re-records a hash, so an
// edit that is not part of a run cannot be made to pass.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export const INVENTORY_FILE = '.done-done-inventory.json';
// A test file is code in a test/tests/__tests__/journeys folder or named *.test.* / *.spec.*; test fixtures are data, not tests.
const CODE = /\.(c|m)?(j|t)sx?$/;
export const isTestFile = (p) => CODE.test(p) && !/(^|\/)fixtures\//.test(p) && (/(^|\/)(test|tests|__tests__|journeys)\//.test(p) || /\.(test|spec)\.[^/]+$/.test(p));
// The test script a journey command runs: `node [flags] <path>.mjs` where the path is a test file (`node journeys/x.mjs`,
// `node --test test/x.test.mjs`); null for any other command. `journey enhance|improve` rewrite this file in place.
export function entryScript(command) {
    const [exe, ...rest] = command.trim().split(/\s+/);
    if (exe !== 'node')
        return null;
    const path = rest.find((t) => !t.startsWith('-'));
    return path && /\.mjs$/.test(path) && !path.includes('..') && !path.startsWith('/') && isTestFile(path.replace(/^\.\//, '')) ? path.replace(/^\.\//, '') : null;
}
const hash = (repo, p) => createHash('sha256').update(readFileSync(join(repo, p))).digest('hex');
export function loadInventory(repo) {
    const file = join(repo, INVENTORY_FILE);
    if (!existsSync(file))
        return null;
    let doc;
    try {
        doc = JSON.parse(readFileSync(file, 'utf8'));
    }
    catch (e) {
        throw new Error(`${INVENTORY_FILE} is not valid JSON: ${e.message}`);
    }
    const ok = doc && typeof doc === 'object' && !Array.isArray(doc) && Object.values(doc).every((e) => e && typeof e.owner === 'string' && e.owner && typeof e.sha256 === 'string');
    if (!ok)
        throw new Error(`${INVENTORY_FILE} must map each path to {owner, sha256}`);
    return doc;
}
function save(repo, inv) {
    const sorted = Object.fromEntries(Object.keys(inv).sort().map((k) => [k, inv[k]]));
    const file = join(repo, INVENTORY_FILE);
    writeFileSync(`${file}.tmp`, `${JSON.stringify(sorted, null, 2)}\n`);
    renameSync(`${file}.tmp`, file);
}
// Every test file the checkout holds that git does not ignore, tracked or not.
const testFiles = (repo) => execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 }).split('\0').filter((p) => p && isTestFile(p) && existsSync(join(repo, p)));
// What is wrong with the repo's test files. A deleted owned file is a retired test, not a finding.
export function findings(repo, inv) {
    const out = [];
    for (const p of testFiles(repo).sort()) {
        const e = inv[p];
        if (!e)
            out.push({ path: p, problem: 'unowned' });
        else if (e.sha256 !== hash(repo, p))
            out.push({ path: p, problem: 'edited', owner: e.owner });
    }
    return out;
}
export const describe = (f) => f.problem === 'unowned' ? `${f.path}: test file has no owner entry in ${INVENTORY_FILE}` : `${f.path}: owned by ${f.owner} but edited outside a done-done run`;
// The lint verdict: null when the repo keeps no inventory or every test file matches it.
export function inventoryFault(repo) {
    const inv = loadInventory(repo);
    if (!inv)
        return null;
    const bad = findings(repo, inv);
    return bad.length ? bad.map(describe).join('; ') : null;
}
// Record a file's current bytes under its owner (a new file needs one). The caller decides whether a run is in progress.
export function record(repo, paths, owner) {
    const inv = loadInventory(repo) ?? {};
    for (const p of paths) {
        if (!isTestFile(p))
            throw new Error(`${p} is not a test file (code in test/, tests/, __tests__/ or journeys/, or *.test.* / *.spec.*)`);
        if (!existsSync(join(repo, p)))
            throw new Error(`${p} does not exist`);
        const who = owner ?? inv[p]?.owner;
        if (!who)
            throw new Error(`${p} has no owner yet: pass --owner <journey or suite name>`);
        inv[p] = { owner: who, sha256: hash(repo, p) };
    }
    save(repo, inv);
    return paths;
}
// Forget retired files: their entries go with them, so a deleted test leaves no stale owner behind.
export function forget(repo, paths) {
    const inv = loadInventory(repo);
    if (!inv || !paths.some((p) => p in inv))
        return;
    for (const p of paths)
        delete inv[p];
    save(repo, inv);
}
