// `done-done inventory`: who owns each test file. A repo opts in by committing .done-done-inventory.json, a map of
// repo-relative path -> { owner, sha256 }. Lint then fails a test file with no entry (a stray) and an owned file whose
// bytes no longer match its entry (a hand edit). Only a done-done run or a journey command re-records a hash, so an
// edit that is not part of a run cannot be made to pass.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { loadConfig } from './config.js';
import { playwrightIntents } from './native-report.js';
export const INVENTORY_FILE = '.done-done-inventory.json';
// A test file is JS/TS code in a test/tests/__tests__/journeys folder or named *.test.* / *.spec.*, or a Bash file named
// *.test.sh / *.spec.sh. Other .sh helpers are not tests: they join the inventory only when a journey command runs them.
// Test fixtures are data, not tests.
const CODE = /\.(?:(c|m)?(j|t)sx?)$/;
export const isTestFile = (p) => !/(^|\/)fixtures\//.test(p) &&
    ((CODE.test(p) && (/(^|\/)(test|tests|__tests__|journeys)\//.test(p) || /\.(test|spec)\.[^/]+$/.test(p))) || /\.(test|spec)\.sh$/.test(p));
// The test script a journey command runs: Node ESM or Bash, including commands that redirect their captures.
// `journey enhance|improve` rewrite this file in place and preserve the command, including its redirections.
export function entryScript(command) {
    const [exe, ...rest] = command.trim().split(/\s+/);
    if (exe !== 'node' && exe !== 'bash')
        return null;
    const path = rest.find((t) => !t.startsWith('-'));
    const extension = exe === 'bash' ? /\.sh$/ : /\.mjs$/;
    const rel = path?.replace(/^\.\//, '');
    if (!rel || !extension.test(rel) || rel.includes('..') || rel.startsWith('/'))
        return null;
    return exe === 'bash' || isTestFile(rel) ? rel : null;
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
    const ok = doc && typeof doc === 'object' && !Array.isArray(doc) && Object.values(doc).every((e) => e && typeof e.owner === 'string' && e.owner && typeof e.sha256 === 'string' && (e.leaves === undefined || (Array.isArray(e.leaves) && e.leaves.every((l) => l && typeof l.id === 'string' && l.id && typeof l.intent === 'string' && /^[\w.-]+$/.test(l.intent) && (l.critical === undefined || typeof l.critical === 'boolean')))));
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
const journeyScripts = (repo) => {
    try {
        return new Set(Object.values(loadConfig(repo).journeys).map(j => entryScript(j.command)).filter((p) => p !== null));
    }
    catch {
        return new Set();
    } // Inventory remains usable when journey configuration is unavailable.
};
// Every test file the checkout holds that git does not ignore, tracked or not.
// Plus every inventoried file, so a journey-run helper script is still caught when its bytes change by hand.
const testFiles = (repo, inv) => {
    const entries = journeyScripts(repo);
    return execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 }).split('\0').filter((p) => p && (isTestFile(p) || entries.has(p) || p in inv) && existsSync(join(repo, p)));
};
// What is wrong with the repo's test files. A deleted owned file is a retired test, not a finding.
export function findings(repo, inv) {
    const out = [];
    for (const p of testFiles(repo, inv).sort()) {
        const e = inv[p];
        if (!e)
            out.push({ path: p, problem: 'unowned' });
        else if (e.sha256 !== hash(repo, p))
            out.push({ path: p, problem: 'edited', owner: e.owner });
    }
    return out;
}
export const describe = (f) => f.problem === 'unowned' ? `${f.path}: test file has no owner entry in ${INVENTORY_FILE}` : `${f.path}: owned by ${f.owner} but edited outside a done-done run`;
// Count the proposed checkout itself, not a reservation made by the branch's old base.
// A merge candidate therefore cannot spend a slot already used by another change.
export function intentInventory(repo) {
    const config = loadConfig(repo), policy = config.intents;
    if (!policy)
        return null;
    const inv = loadInventory(repo) ?? {};
    const files = testFiles(repo, inv), errors = [], declarations = [];
    for (const p of files) {
        const owners = Object.entries(config.journeys).filter(([, journey]) => entryScript(journey.command) === p).map(([name]) => name);
        if (owners.length && inv[p] && !owners.includes(inv[p].owner))
            errors.push(`${p}: owner ${inv[p].owner} is not a journey that runs it (${owners.join(', ')})`);
    }
    const canonical = (id) => {
        const seen = new Set();
        while (policy.aliases[id]) {
            if (seen.has(id))
                throw new Error(`intent alias cycle at ${id}`);
            seen.add(id);
            id = policy.aliases[id];
        }
        return id;
    };
    const nativeFiles = new Set();
    if (policy.native) {
        const binary = join(repo, 'node_modules', '.bin', 'playwright');
        const env = { ...process.env };
        for (const key of ['PLAYWRIGHT_JSON_OUTPUT_FILE', 'PLAYWRIGHT_JSON_OUTPUT_DIR', 'PLAYWRIGHT_JSON_OUTPUT_NAME', 'PLAYWRIGHT_JSON_ONLY_FAILURES'])
            delete env[key];
        const result = spawnSync(binary, ['test', '--list', '--reporter=json'], { cwd: repo, encoding: 'utf8', env, timeout: 30000, maxBuffer: 32 << 20 });
        if (result.status !== 0)
            errors.push(`Playwright discovery failed: ${result.error?.message ?? (result.stderr.trim() || `exit ${result.status}`)}`);
        else
            try {
                for (const row of playwrightIntents(result.stdout)) {
                    if (isAbsolute(row.file) || row.file.split('/').includes('..') || !files.includes(row.file))
                        throw new Error(`Playwright declaration ${row.id} names an untracked or unknown file ${row.file}`);
                    nativeFiles.add(row.file);
                    if (!inv[row.file])
                        errors.push(`${row.file}: native declaration has no owner`);
                    declarations.push({ ...row, owner: inv[row.file]?.owner ?? '' });
                }
            }
            catch (e) {
                errors.push(e.message);
            }
    }
    for (const file of nativeFiles) {
        const stored = inv[file]?.leaves;
        if (!stored)
            continue; // Legacy native entries can be backfilled in shadow.
        const actual = declarations.filter(d => d.file === file).map(d => ({ id: d.id, intents: [...new Set(d.intents.map(canonical))], critical: d.critical }));
        if (actual.length !== stored.length || actual.some(d => d.intents.length !== 1 || !stored.some(l => l.id === d.id && canonical(l.intent) === d.intents[0] && !!l.critical === d.critical)))
            errors.push(`${file}: recorded native leaves differ from Playwright discovery`);
    }
    for (const p of files) {
        if (nativeFiles.has(p))
            continue;
        const entry = inv[p];
        if (!entry?.leaves?.length) {
            errors.push(`${p}: no intent leaves recorded for ${entry?.owner ?? 'unowned file'}`);
            continue;
        }
        if (new Set(entry.leaves.map(l => l.id)).size !== entry.leaves.length)
            errors.push(`${p}: duplicate leaf IDs`);
        for (const leaf of entry.leaves)
            declarations.push({ file: p, owner: entry.owner, id: leaf.id, name: leaf.id, intents: [leaf.intent], critical: !!leaf.critical });
    }
    const ids = new Set(), critical = new Set(), byJourney = new Map();
    for (const d of declarations) {
        const names = [...new Set(d.intents.map(canonical))];
        if (names.length !== 1) {
            errors.push(`${d.file}: ${d.name} has ${names.length} intents; exactly one is required`);
            continue;
        }
        ids.add(names[0]);
        if (d.critical)
            critical.add(names[0]);
        if (Object.hasOwn(config.journeys, d.owner)) {
            const owned = byJourney.get(d.owner) ?? new Set();
            owned.add(names[0]);
            byJourney.set(d.owner, owned);
        }
    }
    for (const [name, journey] of Object.entries(config.journeys)) {
        const owned = byJourney.get(name);
        if (journey.intent) {
            const id = canonical(journey.intent);
            if (owned && (owned.size !== 1 || !owned.has(id)))
                errors.push(`journey ${name}: declared intent differs from its leaves`);
            if (!owned)
                declarations.push({ id: name, name, file: '.done-done.yaml', owner: name, intents: [journey.intent], critical: !!journey.critical });
            ids.add(id);
            if (journey.critical)
                critical.add(id);
        }
        else if (!owned?.size)
            errors.push(`journey ${name}: no intent declaration or owned intent leaves`);
    }
    for (const [journey, names] of byJourney)
        if (names.size > 1)
            errors.push(`journey ${journey} has ${names.size} distinct intents; exactly one is required`);
    if (ids.size > policy.ceiling)
        errors.push(`intent ceiling ${policy.ceiling} exceeded: ${ids.size} distinct intents`);
    if (critical.size > policy.critical_ceiling)
        errors.push(`critical intent ceiling ${policy.critical_ceiling} exceeded: ${critical.size} distinct critical intents`);
    // A cap increase must name newly critical intents, their coverage gap and the
    // review approving the increase. Compare with the candidate's parent so two
    // changes cannot reuse an earlier approval after landing.
    const dirty = spawnSync('git', ['diff', '--quiet', 'HEAD', '--', '.done-done.yaml'], { cwd: repo }).status === 1;
    const base = dirty ? 'HEAD' : 'HEAD^';
    const priorFile = spawnSync('git', ['show', `${base}:.done-done.yaml`], { cwd: repo, encoding: 'utf8' });
    if (priorFile.status === 0) {
        const priorConfig = loadConfig(repo, priorFile.stdout), prior = priorConfig.intents;
        if (prior && (policy.ceiling > prior.ceiling || policy.critical_ceiling > prior.critical_ceiling)) {
            const added = policy.increases.filter(r => !prior.increases.some(old => JSON.stringify(old) === JSON.stringify(r)));
            const addedIds = new Set(added.map(r => canonical(r.intent)));
            const oldFile = spawnSync('git', ['show', `${base}:${INVENTORY_FILE}`], { cwd: repo, encoding: 'utf8' });
            let previousIntents = new Set();
            if (oldFile.status === 0) {
                try {
                    const old = JSON.parse(oldFile.stdout);
                    if (Object.values(old).some(e => !e.leaves?.length))
                        errors.push('cap increase requires a complete base intent inventory, including native declarations');
                    previousIntents = new Set([...Object.values(old).flatMap(e => (e.leaves ?? []).map(l => canonical(l.intent))), ...Object.values(priorConfig.journeys).flatMap(j => j.intent ? [canonical(j.intent)] : [])]);
                }
                catch (e) {
                    errors.push(`cannot read base intent inventory: ${e.message}`);
                }
            }
            else
                errors.push('cap increase requires a complete base intent inventory');
            const need = Math.max(policy.ceiling - prior.ceiling, policy.critical_ceiling - prior.critical_ceiling);
            if (addedIds.size < need || [...addedIds].some(id => !critical.has(id) || previousIntents.has(id)))
                errors.push('cap increase needs a separate documented coverage gap and review for each newly critical intent');
        }
    }
    return { mode: policy.mode, declarations, counts: { declarations: declarations.length, intents: ids.size, critical: critical.size }, errors };
}
// Optional semantic work is never dispatched by inventory. The caller that owns
// final proof and the shared budget can take this single batch only afterwards.
export function intentAdvisory(repo, finalProof, cheapSlot) {
    if (!finalProof || !cheapSlot)
        return null;
    const report = intentInventory(repo);
    if (!report || report.errors.length)
        return null;
    const aliases = loadConfig(repo).intents.aliases;
    const canonical = (id) => aliases[id] ? canonical(aliases[id]) : id;
    const names = [...new Set(report.declarations.flatMap(d => d.intents.map(canonical)))].sort();
    const tokens = (s) => new Set(s.toLowerCase().split(/[._-]+/).filter(t => t.length >= 4));
    const pairs = [];
    for (let i = 0; i < names.length; i++)
        for (let j = i + 1; j < names.length; j++) {
            const a = tokens(names[i]), b = tokens(names[j]);
            if ([...a].some(t => b.has(t)))
                pairs.push({ left: names[i], right: names[j] });
        }
    return pairs.length ? { kind: 'intent-ambiguity', pairs } : null;
}
// The lint verdict: null when the repo keeps no inventory or every test file matches it.
export function inventoryFault(repo) {
    const inv = loadInventory(repo);
    const bad = inv ? findings(repo, inv) : [];
    const intents = intentInventory(repo);
    const errors = [...bad.map(describe), ...(intents?.mode === 'enforce' ? intents.errors : [])];
    return errors.length ? errors.join('; ') : null;
}
// Record a file's current bytes under its owner (a new file needs one). The caller decides whether a run is in progress.
export function record(repo, paths, owner) {
    const inv = loadInventory(repo) ?? {};
    const entries = journeyScripts(repo);
    for (const p of paths) {
        if (!isTestFile(p) && !entries.has(p))
            throw new Error(`${p} is not a test file (code in test/, tests/, __tests__/ or journeys/, *.test.* / *.spec.*, or a Bash script a journey runs)`);
        if (!existsSync(join(repo, p)))
            throw new Error(`${p} does not exist`);
        const who = owner ?? inv[p]?.owner;
        if (!who)
            throw new Error(`${p} has no owner yet: pass --owner <journey or suite name>`);
        const current = hash(repo, p);
        // A new hash does not prove that the old leaf list still covers the file.
        inv[p] = { ...(inv[p]?.sha256 === current ? inv[p] : {}), owner: who, sha256: current };
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
