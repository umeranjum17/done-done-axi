import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { stringify } from 'yaml';
import { UsageError } from './config.js';
export const BAR = { min_win_rate: 0.7, min_score: 0.75 };
export const PROMPTS_FILE = 'evals/prompts.jsonl';
export const RUBRIC_FILE = 'evals/rubric.md';
export const README_FILE = 'evals/README.md';
const isMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.trim() !== '';
const inside = (p) => !isAbsolute(p) && !p.split(/[\\/]/).includes('..');
// The evals block as the repo wrote it, or why it is not usable: an enabled block names every key it needs, so a half-configured
// one is a config error and never a silent skip.
export function parseEvals(v, repo) {
    if (!isMap(v))
        return 'must be a mapping with enabled, prompts, rubric, app, baseline and bar';
    for (const k of Object.keys(v))
        if (!['enabled', 'prompts', 'rubric', 'app', 'baseline', 'bar'].includes(k))
            return `has an unknown key ${k} (enabled, prompts, rubric, app, baseline, bar)`;
    if (typeof v.enabled !== 'boolean')
        return 'needs enabled: true or false';
    const app = isMap(v.app) ? v.app : {};
    const base = isMap(v.baseline) ? v.baseline : {};
    const bar = isMap(v.bar) ? v.bar : {};
    const out = { enabled: v.enabled, prompts: text(v.prompts) ? v.prompts : '', rubric: text(v.rubric) ? v.rubric : '', app: { command: text(app.command) ? app.command : '' }, baseline: { model: text(base.model) ? base.model : '', command: text(base.command) ? base.command : '' }, bar: { ...BAR } };
    if (!out.enabled)
        return out;
    for (const [key, ok] of [['prompts', out.prompts], ['rubric', out.rubric], ['app.command', out.app.command]])
        if (!ok)
            return `is enabled but has no ${key}`;
    if (!!out.baseline.model === !!out.baseline.command)
        return 'is enabled and needs exactly one of baseline.model and baseline.command';
    for (const key of ['prompts', 'rubric']) {
        if (!inside(out[key]))
            return `${key} must be a repo-relative path with no .. segment`;
        if (!existsSync(join(repo, out[key])))
            return `is enabled but ${key} ${out[key]} does not exist; commit it, or run done-done init --evals`;
    }
    for (const k of ['min_win_rate', 'min_score']) {
        if (bar[k] === undefined)
            continue;
        if (typeof bar[k] !== 'number' || bar[k] < 0 || bar[k] > 1)
            return `bar.${k} must be a number from 0 to 1`;
        out.bar[k] = bar[k];
    }
    return out;
}
// Detection: an app whose output is a model's. A provider SDK in a manifest or an import, a committed prompt file, or
// prompt-building code. Tests, docs, fixtures and the evals folder never count. Returns the reason, or '' for a CLI, UI, API or library with none.
const SDK = String.raw `@anthropic-ai/sdk|anthropic|openai|@google/genai|@google/generative-ai|google-genai|google-generativeai|google\.generativeai|ollama|langchain(?:[-_]\w+)*|@langchain/[\w-]+|litellm|groq(?:-sdk)?|mistralai|@mistralai/mistralai|cohere(?:-ai)?`;
const MANIFEST = /(^|\/)(package\.json|requirements[^/]*\.txt|pyproject\.toml|Pipfile|go\.mod|Cargo\.toml|Gemfile|composer\.json|pom\.xml|build\.gradle(\.kts)?)$/;
const SDK_IN_MANIFEST = new RegExp(String.raw `(?<![\w@])(?:${SDK})(?![\w])`, 'i');
const SDK_IMPORT = new RegExp(String.raw `\b(?:import|from|require)\b[^\n]*?(?<![\w@.-])(?:${SDK})(?![\w-])`, 'i');
const PROMPT_FILE = /(^|\/)(system[-_.]?prompts?|prompts?)(\.(md|txt|prompt|jinja2?|j2))?$|\.prompt(\.\w+)?$|(^|\/)prompts\/[^/]+\.(md|txt|prompt|jinja2?|j2|ya?ml)$/i;
const PROMPT_CODE = /\b(system_?prompt|SYSTEM_PROMPT|build_?prompt|prompt_?template)\b/i;
const SOURCE = /\.([cm]?[jt]sx?|py|go|rb|rs|php|java|kt|swift|cs|ex)$/;
const NOT_APP = /(^|\/)(tests?|__tests__|spec|fixtures?|docs?|examples?|vendor|evals)\/|[._-](test|spec)\.\w+$/;
export function detectAi(files, read) {
    const app = files.filter((f) => !NOT_APP.test(f));
    const manifest = app.find((f) => MANIFEST.test(f) && SDK_IN_MANIFEST.test(read(f) ?? ''));
    if (manifest)
        return `a model provider SDK in ${manifest}`;
    const prompt = app.find((f) => PROMPT_FILE.test(f));
    if (prompt)
        return `a committed prompt file ${prompt}`;
    for (const f of app.filter((f) => SOURCE.test(f))) {
        const body = read(f) ?? '';
        if (SDK_IMPORT.test(body))
            return `a model provider SDK imported in ${f}`;
        if (PROMPT_CODE.test(body))
            return `prompt-building code in ${f}`;
    }
    return '';
}
// What the agent proposes at init, and why an answer cannot be written: citations are tracked files the agent was shown.
export const EVALS_COUNT = 12;
const STR = { type: 'string' };
export const EVALS_SCHEMA = {
    type: 'object',
    properties: {
        app_command: STR,
        app_command_source: STR,
        prompts: { type: 'array', minItems: 1, items: { type: 'object', properties: { id: STR, input: STR, source: STR }, required: ['id', 'input', 'source'], additionalProperties: false } },
        rubric: { type: 'array', minItems: 1, items: { type: 'object', properties: { criterion: STR, description: STR }, required: ['criterion', 'description'], additionalProperties: false } },
    },
    required: ['app_command', 'app_command_source', 'prompts', 'rubric'],
    additionalProperties: false,
};
export function evalsPrompt(app, context, toolless) {
    return `You propose the output-quality evals for the app ${app}, whose output is a model's: \`done-done init\` commits your proposal and the user edits it. Do not edit, create or delete any file, and do not run the app or any command.
${toolless ? "You have no tools: the repo's tracked file list and the text of its key files are below, and they are all you can read." : 'The repository is your working directory: read the files below first, then any other file you need.'} Use only what the repo shows: never invent a command, route, flag or file. Never open a secret-looking file (a .env, or a name with secret, credential, token or password, or a *.pem, *.key, *.p12). Never write a secret value anywhere.
- app_command: one shell command, run from the repo root, that reads ONE prompt on stdin and prints the app's answer on stdout, using only the repo's own handles (its CLI, script, route client or stub/demo mode). It must not need a new API key. app_command_source: the tracked file it runs, exactly as the file list spells it.
- prompts: ${EVALS_COUNT} real inputs a user gives this app, drawn from its routes, commands, tests and README use cases, mixing the common cases with hard ones (long, vague, missing fields, hostile). id: a short unique slug. input: the full prompt text, with no private data. source: the tracked file that shows the use case.
- rubric: 3 to 6 criteria that decide whether an answer is good for this app (facts preserved, required fields present, tone, no invented claims, format). criterion: a lowercase slug of letters, digits, - or _. description: what a pass looks like.

${context}`;
}
export function evalsProblem(a, tracked, shown, clean, isSecret) {
    const p = a;
    if (!text(p.app_command) || p.app_command.includes('\n'))
        return 'has no one-line app_command';
    const cite = (s, what) => {
        const c = typeof s === 'string' ? clean(s) : '';
        return !tracked.has(c) ? `${what} cites ${c || 'nothing'}, which is not a tracked file` : isSecret(c) ? `${what} cites a secret-looking file` : shown.has(c) ? '' : `${what} cites ${c}, whose text is not in the prompt`;
    };
    const bad = cite(p.app_command_source, 'app_command_source');
    if (bad)
        return bad;
    if (!Array.isArray(p.prompts) || p.prompts.length < 6 || p.prompts.length > 20)
        return `has ${Array.isArray(p.prompts) ? p.prompts.length : 0} prompts, and the set needs 6 to 20 (12 by default)`;
    const ids = new Set();
    for (const q of p.prompts) {
        if (!q || !text(q.id) || !/^[\w.-]+$/.test(q.id) || ids.has(q.id) || !text(q.input))
            return 'has a prompt without a unique slug id or an input';
        ids.add(q.id);
        const why = cite(q.source, `prompt ${q.id}`);
        if (why)
            return why;
    }
    const names = new Set();
    if (!Array.isArray(p.rubric) || p.rubric.length < 2 || p.rubric.length > 8)
        return 'needs 2 to 8 rubric criteria';
    for (const r of p.rubric) {
        if (!r || !/^[a-z][a-z0-9_-]*$/.test(String(r.criterion)) || names.has(r.criterion) || !text(r.description))
            return 'has a rubric criterion without a unique lowercase slug name or a description';
        names.add(r.criterion);
    }
    return '';
}
export const promptsJsonl = (p) => p.prompts.map(({ id, input }) => JSON.stringify({ id, input })).join('\n') + '\n';
export const rubricMd = (app, p) => `# ${app} eval rubric

The judge scores each answer from 0 to 1 on every criterion below and says which of two answers is better. Each line is \`- <criterion>: <what a pass looks like>\`; edit the words, add or remove lines, and commit.

${p.rubric.map((r) => `- ${r.criterion}: ${r.description.trim()}`).join('\n')}
`;
export const readmeMd = (app, p) => `# ${app} evals

\`done-done init\` proposed these files from the repo's own use cases and commits them to you: edit them freely.

- \`prompts.jsonl\`: ${p.prompts.length} real inputs, one \`{"id","input"}\` per line.
- \`rubric.md\`: the criteria the judge scores.
- \`.done-done.yaml\` \`evals:\`: the app command (prompt on stdin, answer on stdout), the plain-model baseline and the bar.

Run \`done-done eval\`; it needs your judge (\`done-done init --judge ...\`) and never runs in CI. \`check\` and \`receipt\` refuse until a full eval passed at the same commit. To turn evals off, set \`evals.enabled: false\`.
`;
export const evalsYaml = (p, model) => `\n# Output-quality evals: \`done-done eval\` runs every prompt through the app and a plain-model baseline; check and receipt need a passing run.\n${stringify({ evals: { enabled: true, prompts: PROMPTS_FILE, rubric: RUBRIC_FILE, app: { command: p.app_command.trim() }, baseline: { model }, bar: BAR } })}`;
// The rows of a prompts file: {"id","input"} per line, ids unique.
export function readPrompts(body, file) {
    const rows = body.split('\n').map((l, i) => ({ l: l.trim(), n: i + 1 })).filter((r) => r.l).map(({ l, n }) => {
        let v;
        try {
            v = JSON.parse(l);
        }
        catch {
            throw new UsageError(`${file}:${n} is not JSON`, `Fix ${file}: one {"id": "<slug>", "input": "<prompt>"} per line`);
        }
        if (!isMap(v) || !text(v.id) || !text(v.input))
            throw new UsageError(`${file}:${n} needs a non-empty id and input`, `Fix ${file}: one {"id": "<slug>", "input": "<prompt>"} per line`);
        return { id: v.id, input: v.input };
    });
    if (!rows.length)
        throw new UsageError(`${file} has no prompts`, `Add prompts to ${file}, or re-run: done-done init --evals`);
    const dup = rows.find((r, i) => rows.findIndex((x) => x.id === r.id) !== i);
    if (dup)
        throw new UsageError(`${file}: id ${dup.id} appears twice`, `Give each prompt in ${file} its own id`);
    return rows;
}
// The criteria a rubric names: its `- <criterion>: <description>` lines.
export const criteriaOf = (rubric) => [...rubric.matchAll(/^[-*]\s+`?([a-z][a-z0-9_-]*)`?\s*:\s*\S/gim)].map((m) => m[1].toLowerCase());
export const baselinePrompt = (input) => `Answer the request below as well as you can.\n\nRequest:\n<<<\n${input}\n>>>`;
export const BASELINE_SCHEMA = { type: 'object', properties: { output: STR }, required: ['output'] };
// One judge call per prompt: both answers blind (A and B, the app's side alternating), scored on every criterion, one winner.
export function judgePrompt(rubric, criteria, input, a, b) {
    return `You are judging two answers to the same request. Judge only by the rubric. The answers' order says nothing about their quality; do not prefer an answer for its length.

Rubric:
${rubric.trim()}

Request:
<<<
${input}
>>>

Answer A:
<<<
${a}
>>>

Answer B:
<<<
${b}
>>>

Score each answer from 0 to 1 on every criterion (${criteria.join(', ')}), name the better answer overall (A, B or tie) and give one short reason that quotes the answers.`;
}
export function judgeSchema(criteria) {
    const scores = { type: 'object', properties: Object.fromEntries(criteria.map((c) => [c, { type: 'number' }])), required: criteria };
    return { type: 'object', properties: { scores_a: scores, scores_b: scores, winner: { type: 'string', enum: ['A', 'B', 'tie'] }, reason: STR }, required: ['scores_a', 'scores_b', 'winner', 'reason'] };
}
// A judge answer as scores in 0 to 1 for every criterion, or why it is not.
export function scoresOf(v, criteria) {
    if (!isMap(v))
        return 'no scores';
    const out = {};
    for (const c of criteria) {
        const n = v[c];
        if (typeof n !== 'number' || !(n >= 0 && n <= 1))
            return `score ${c} is not a number from 0 to 1`;
        out[c] = n;
    }
    return out;
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (n) => `${Math.round(n * 100)}%`;
export function totals(rows, criteria, bar) {
    const wins = rows.filter((r) => r.winner === 'app').length;
    const ties = rows.filter((r) => r.winner === 'tie').length;
    const per = Object.fromEntries(criteria.map((c) => [c, mean(rows.map((r) => r.scores[c] ?? 0))]));
    const win_rate = rows.length ? wins / rows.length : 0;
    const mean_score = mean(Object.values(per));
    return { wins, ties, losses: rows.length - wins - ties, win_rate, mean_score, per, pass: rows.length > 0 && win_rate >= bar.min_win_rate && mean_score >= bar.min_score };
}
export function reportMd(a) {
    const { t, rows } = a;
    const fails = rows.filter((r) => r.winner !== 'app');
    const cell = (s) => s.replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, 300);
    return `# ${a.app} evals: ${t.pass ? 'PASS' : 'FAIL'}

- bar: win rate at least ${pct(a.bar.min_win_rate)}, mean score at least ${a.bar.min_score}
- prompts: ${rows.length} of ${a.total}${rows.length < a.total ? ' (PARTIAL: --limit, so this run never satisfies the gate)' : ''}
- win rate vs baseline: ${pct(t.win_rate)} (${t.wins} won, ${t.ties} tied, ${t.losses} lost)
- mean score: ${t.mean_score.toFixed(2)}
- commit: ${a.commit}, run ${a.run_id}
- judge: ${a.judge}; baseline: ${a.baseline}
- model calls: ${a.calls}

## Mean score per criterion

${Object.entries(t.per).map(([c, n]) => `- ${c}: ${n.toFixed(2)}`).join('\n')}

## Prompts the app did not win

${fails.length ? fails.map((r) => `- ${r.id} (${r.winner}): ${cell(r.error ? `app failed: ${r.error}` : r.reason)}`).join('\n') : 'none'}
`;
}
