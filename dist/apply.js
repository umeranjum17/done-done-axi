// Apply an approved test plan (`done-done tests improve --apply <drop|move> --plan <file>`, stage `applied`). One verdict class
// per call, so each change set stays small and lands on its own ticket branch. Nothing is written until the kept tests have
// been rerun against the faults the plan recorded: a plan that would leave a fault caught by no test is refused.
//   drop  remove the journey from .done-done.yaml, delete its script when no kept journey runs it, forget its inventory entry
//   move  set the journey's size to the smaller one the plan names
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { UsageError } from './config.js';
import { forget, isTestFile } from './inventory.js';
import { isSize } from './size.js';
import { measureValue } from './value.js';
export const MAX_CHANGE_LINES = 300;
export const APPLIES = ['drop', 'move'];
const CONFIG = '.done-done.yaml';
const same = (a, b) => a.file === b.file && a.line === b.line && a.now === b.now;
// The plan file is the JSON `tests improve --plan-only --json` printed; this checks the parts apply reads.
export function parsePlan(text) {
    let doc;
    try {
        doc = JSON.parse(text);
    }
    catch (e) {
        throw new UsageError(`the plan file is not valid JSON: ${e.message}`, 'Save the proposal with: done-done tests improve --plan-only --json > plan.json');
    }
    const ok = doc?.stage === 'proposed' && Array.isArray(doc.rows) && Array.isArray(doc.gaps) && Array.isArray(doc.faults)
        && doc.faults.every((f) => typeof f?.file === 'string' && Number.isInteger(f.line) && typeof f.was === 'string' && typeof f.now === 'string');
    if (!ok)
        throw new UsageError('the plan file is not a proposed test plan (stage proposed with rows, gaps and faults)', 'Save the proposal with: done-done tests improve --plan-only --json > plan.json');
    return doc;
}
// Lines a change set touches: lines only in the old text plus lines only in the new text.
export function changedLines(before, after) {
    const count = (t) => { const m = new Map(); for (const l of t.split('\n'))
        m.set(l, (m.get(l) ?? 0) + 1); return m; };
    const [a, b] = [count(before), count(after)];
    let n = 0;
    for (const [l, c] of a)
        n += Math.max(0, c - (b.get(l) ?? 0));
    for (const [l, c] of b)
        n += Math.max(0, c - (a.get(l) ?? 0));
    return n;
}
// The script files a journey command runs: words that are test files in the repo.
const scripts = (repo, command) => command.split(/\s+/).filter((w) => isTestFile(w) && existsSync(join(repo, w)));
export function changeSet(repo, rows, klass, journeys) {
    const names = new Set(rows.map((r) => r.test));
    const config = parseDocument(readFileSync(join(repo, CONFIG), 'utf8'));
    const edits = [];
    for (const r of rows) {
        if (klass === 'drop')
            config.deleteIn(['journeys', r.test]);
        else
            config.setIn(['journeys', r.test, 'size'], r.to);
    }
    edits.push({ path: CONFIG, after: String(config) });
    if (klass === 'drop') {
        const kept = Object.entries(journeys).filter(([n]) => !names.has(n)).flatMap(([, j]) => scripts(repo, j.command));
        for (const f of new Set(rows.flatMap((r) => scripts(repo, journeys[r.test].command))))
            if (!kept.includes(f))
                edits.push({ path: f, after: null });
    }
    return edits;
}
function refusal(plan, rows, klass, journeys, repo) {
    for (const r of rows) {
        if (!journeys[r.test])
            return `the plan names ${r.test}, which .done-done.yaml no longer defines: the plan is stale`;
        if (klass === 'move' && !isSize(r.to))
            return `the plan moves ${r.test} to ${r.to ?? 'no size'}, which is not ci, local or large`;
    }
    for (const f of plan.faults) {
        const line = existsSync(join(repo, f.file)) ? readFileSync(join(repo, f.file), 'utf8').split('\n')[f.line - 1] : undefined;
        if (line !== f.was)
            return `${f.file}:${f.line} changed since the plan: the plan is stale`;
    }
    return null;
}
// Rerun the kept tests (with their new sizes) against the faults the plan recorded, then write the change set. Writes nothing when refused.
export async function applyPlan(repo, plan, klass, journeys, env) {
    const rows = plan.rows.filter((r) => r.action === klass);
    if (!rows.length)
        throw new UsageError(`the plan has no ${klass} rows`, 'Pick a class the plan proposes: done-done tests improve --apply drop|move --plan <file>');
    const done = (extra) => ({ class: klass, tests: rows.map((r) => r.test), lines: 0, seconds: { before: 0, after: 0 }, kept: 0, ...extra });
    const stale = refusal(plan, rows, klass, journeys, repo);
    if (stale)
        return done({ refused: stale });
    const moved = new Map(rows.map((r) => [r.test, r.to]));
    const before = Math.round(plan.rows.reduce((s, r) => s + r.seconds, 0) * 100) / 100;
    const keptRows = plan.rows.filter((r) => !(klass === 'drop' && r.action === 'drop'));
    const runs = keptRows.map((r) => ({ name: r.test, command: journeys[r.test].command, size: klass === 'move' && moved.has(r.test) ? moved.get(r.test) : journeys[r.test].size }));
    const rerun = await measureValue(repo, runs, plan.faults, env);
    const seconds = { before, after: Math.round(rerun.tests.reduce((s, t) => s + t.seconds, 0) * 100) / 100 };
    const planned = plan.faults.filter((f) => !plan.gaps.some((g) => g.file === f.file && g.line === f.line));
    const lost = rerun.uncaught.filter((f) => planned.some((p) => same(p, f)));
    if (lost.length)
        return done({ seconds, kept: keptRows.length, refused: `coverage lost: no kept test catches ${lost.map((f) => `${f.file}:${f.line}`).join(', ')}, which a dropped or moved test caught` });
    const broken = rerun.tests.filter((t) => t.verdict === 'failing' && plan.rows.find((r) => r.test === t.test)?.action !== 'fix');
    if (broken.length)
        return done({ seconds, kept: keptRows.length, refused: `${broken.map((t) => t.test).join(', ')} fails after the change` });
    const edits = changeSet(repo, rows, klass, journeys);
    const lines = edits.reduce((n, e) => n + changedLines(existsSync(join(repo, e.path)) ? readFileSync(join(repo, e.path), 'utf8') : '', e.after ?? ''), 0);
    if (lines > MAX_CHANGE_LINES)
        return done({ seconds, kept: keptRows.length, lines, refused: `the change set is ${lines} lines, over the ${MAX_CHANGE_LINES} line limit: apply a smaller plan` });
    for (const e of edits) {
        const file = join(repo, e.path);
        if (e.after === null)
            rmSync(file);
        else {
            writeFileSync(`${file}.tmp`, e.after);
            renameSync(`${file}.tmp`, file);
        }
    }
    forget(repo, edits.filter((e) => e.after === null).map((e) => e.path));
    return done({ lines, seconds, kept: keptRows.length });
}
