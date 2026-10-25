import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { AGENTS, ANSWERER_JUDGES, CHEAP, FALLBACK_ROUTES, JUDGE_DEFAULT, EFFORT_FLAGS, KEY_ROUTE_MODELS, KEY_ROUTES, parseDuration, UsageError } from './config.js';
import { isExecutable, onPath } from './judge.js';
// argv never carries the prompt: it goes on stdin, or (file: true) into a 0600 prompt file the argv points at.
// done-done parses the answer, validates it against the schema, and asks a tool-less call again, at most ASK_ATTEMPTS calls.
const ASK_ATTEMPTS = 3;
// A streaming agent that prints nothing for this long is stopped, so a hung CLI ends in minutes, not at the agent_timeout.
// Only streaming adapters are watched: claude and gemini print their one answer at the end, so silence is their normal state.
export const AGENT_IDLE_MS = 5 * 60_000;
// What a user sees of an agent's error: no colour codes, only the last line that names an error (not a
// stack frame, an indented field or a lone brace), at most 200 characters. The call record keeps the raw stderr.
const ERROR_WORD = /\b(error|failed|denied|cancelled|refused|not|invalid|unauthorized)\b/i;
function errorLine(text) {
    const lines = stripVTControlCharacters(text).split(/[\r\n]+/).filter((l) => /\w/.test(l));
    const top = lines.filter((l) => !/^\s/.test(l));
    const line = (top.findLast((l) => ERROR_WORD.test(l)) ?? top.at(-1) ?? lines.at(-1) ?? '').trim();
    return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}
// A provider's rate limit (HTTP 429, a usage limit with its reset time). The CLI may retry it for many minutes, so the call stops at the first line that says so.
const RATE_LIMIT = /\b429\b|rate[ -]?limit|usage limit|too many requests/i;
// A JSON event line (pi --mode json) that mentions a limit: the readable text inside it, not the event. The first string
// that says so, and the provider's own message when that string is `429: {"message":"..."}`; any other line as it is.
const limitText = (line) => {
    const found = (v) => {
        if (typeof v === 'string')
            return RATE_LIMIT.test(v) ? v : undefined;
        if (v && typeof v === 'object')
            for (const x of Object.values(v)) {
                const f = found(x);
                if (f)
                    return f;
            }
    };
    let text;
    try {
        text = found(JSON.parse(line));
    }
    catch { }
    const body = text?.match(/^\d+: (\{.*\})$/s)?.[1];
    try {
        return (body && JSON.parse(body).message) || text || line;
    }
    catch {
        return text ?? line;
    }
};
const isRejectedRateLimit = (l) => {
    try {
        const e = JSON.parse(l);
        return e.type === 'rate_limit_event' && e.rate_limit_info?.status === 'rejected';
    }
    catch {
        return false;
    }
};
// The first lines of an agent's stderr, one line: what it said before it failed or went quiet. Indented lines (stack frames, fields) are
// left out, as in errorLine. '' when it said nothing.
function stderrHead(stderr) {
    const head = stripVTControlCharacters(stderr).split(/\r?\n/).filter((l) => /\w/.test(l) && !/^\s/.test(l)).slice(0, 2).map((l) => l.trim()).join(' | ');
    return head.length > 300 ? `${head.slice(0, 299)}…` : head;
}
// opencode prints this on stderr and auto-rejects the ask when a headless run reaches a permission a non-interactive
// call can never answer. The drive then ends with no answer, so name the permission and paths it refused instead of
// the bare "no JSON object in the answer" its empty output would give.
const PERMISSION_REJECT = /permission requested:\s*(\S+)\s*\(([^)]*)\);\s*auto-rejecting/;
class ProviderError extends Error {
    detail;
    constructor(text, prefix = '', suffix = '') {
        super(`${prefix}${errorLine(text)}${suffix}`);
        this.detail = `${prefix}${text.slice(0, 500)}${suffix}`;
    }
}
// The answer object in an agent's free text: the first top-level '{'..'}' span that parses to an object with every
// required key, skipping braces and quotes in narration. With no such span, the last span that parsed is returned, so
// the caller reports the missing keys. A span still open at the end of the text was a stray brace in narration, so the
// scan restarts one character after it; restarts are capped so the worst case stays bounded.
const MAX_SPAN_RESTARTS = 50;
function scanSpans(text, from, spans) {
    let depth = 0;
    let start = 0;
    let inString = false;
    for (let i = from; i < text.length; i++) {
        const ch = text[i];
        if (depth === 0) {
            if (ch === '{') {
                depth = 1;
                start = i;
            }
        }
        else if (inString) {
            if (ch === '\\')
                i++;
            else if (ch === '"')
                inString = false;
        }
        else if (ch === '"')
            inString = true;
        else if (ch === '{')
            depth++;
        else if (ch === '}' && --depth === 0)
            spans.push(text.slice(start, i + 1));
    }
    return depth > 0 ? start : -1;
}
// ponytail: a stray quote inside narration braces can hide the answer; the ask-again loop (a tool-less call is asked again up to ASK_ATTEMPTS times) covers it, so the scanner stops growing here.
export function extractJsonObject(text, required = []) {
    const spans = [];
    let open = scanSpans(text, 0, spans);
    for (let restarts = 0; open >= 0 && restarts < MAX_SPAN_RESTARTS; restarts++)
        open = scanSpans(text, open + 1, spans);
    const parsed = spans.flatMap((span) => { try {
        return [JSON.parse(span)];
    }
    catch {
        return [];
    } });
    const answer = parsed.find((v) => required.every((k) => k in v)) ?? parsed[parsed.length - 1];
    if (!answer)
        throw new Error(`no JSON object in the answer: ${text.slice(0, 200)}`);
    return answer;
}
// acp:<target> runs any Agent Client Protocol agent through the user's acpx bridge (acpx's own registry names
// the targets): the prompt and the schema on stdin (exec --file -), and the answer is the JSON object in the agent's
// message chunks of acpx's JSON-RPC event stream. Every tool is denied, and a permission prompt is denied too, since
// nobody can answer it. No model means the target's own default.
const ACP = {
    streams: true,
    argv: (c, dir) => ['--cwd', c.tools === 'none' ? dir : c.cwd, '--format', 'json', '--json-strict', '--deny-all',
        '--non-interactive-permissions', 'deny', ...(c.model ? ['--model', c.model] : []), c.agent.slice('acp:'.length), 'exec', '--file', '-'],
    answer: (out, c) => {
        const events = out.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
        const text = events.filter((e) => e.method === 'session/update' && e.params?.update?.sessionUpdate === 'agent_message_chunk')
            .map((e) => e.params.update.content?.text ?? '').join('');
        // An error response fails the call only when the agent said nothing: a refused side request is not the answer.
        const error = events.find((e) => e.error)?.error;
        if (!text && error)
            throw new ProviderError(String(error.message ?? JSON.stringify(error)).slice(0, 500));
        return extractJsonObject(text, c.schema.required);
    },
};
export const ACPX_INSTALL = 'Install the acpx ACP bridge (npm install -g acpx, https://github.com/openclaw/acpx), then re-run: done-done doctor';
const PI_TOOL_LESS = ['--no-tools', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files'];
// --no-extensions also hides the extension that supplies a model's provider: claude-bridge models were 0 with it, 13 with
// -e npm:pi-claude-bridge. A tool-less call loads that one extension and no other: the rest add tools or prompt text.
const PI_PROVIDER_EXTENSIONS = { 'claude-bridge': 'npm:pi-claude-bridge' };
const piProviderExtension = (model) => {
    const provider = model?.split('/')[0] ?? '';
    return Object.hasOwn(PI_PROVIDER_EXTENSIONS, provider) ? ['-e', PI_PROVIDER_EXTENSIONS[provider]] : [];
};
const ADAPTERS = {
    // claude -p: --json-schema puts the validated object in structured_output; --tools '' turns every tool off.
    // An edit step accepts edits only in cwd and --add-dir folders, and may run commands (the drive launches the app).
    // The judge's call runs with the user's own sign-in, and with --safe-mode when safeMode is set.
    // A call with images sends them as stream-json content blocks, as claude's SDK does, and its result is the event of type result.
    claude: {
        argv: (c) => ['-p', '--output-format', c.images?.length ? 'stream-json' : 'json', ...(c.images?.length ? ['--verbose', '--input-format', 'stream-json'] : []),
            '--json-schema', JSON.stringify(c.schema), '--model', c.model, '--no-session-persistence',
            ...(c.tools === 'edit' ? ['--permission-mode', 'acceptEdits', '--allowedTools', 'Bash', ...(c.dirs ?? []).flatMap((d) => ['--add-dir', d])] : ['--tools', c.tools === 'read' ? 'Read,Grep,Glob' : '']),
            ...(c.tools === 'edit' ? [] : ['--setting-sources', '']), ...(c.tools === 'read' ? ['--strict-mcp-config'] : []), ...(c.safeMode ? ['--safe-mode'] : [])],
        stdin: (c, prompt) => (c.images?.length ? `${JSON.stringify({ type: 'user', session_id: '', parent_tool_use_id: null, message: { role: 'user', content: [
                    ...c.images.flatMap((i) => [{ type: 'text', text: `Image: ${i.name.replace(/\.[^.]+$/, '')}` }, { type: 'image', source: { type: 'base64', media_type: `image/${extname(i.name).slice(1)}`, data: i.bytes.toString('base64') } }]),
                    { type: 'text', text: prompt }
                ] } })}\n` : prompt),
        answer: (out, c) => {
            const r = c.images?.length ? out.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).findLast((e) => e.type === 'result') : JSON.parse(out);
            if (!r)
                throw new ProviderError('claude printed no result');
            if (r.is_error)
                throw new ProviderError(String(r.result || r.subtype));
            return r.structured_output;
        },
    },
    // opencode run reads no stdin: the prompt and the schema go in an attached file,
    // and the answer is the JSON object in the text parts of its JSON event stream.
    opencode: {
        file: true,
        streams: true,
        readsImages: true,
        argv: (c, dir) => ['run', 'Follow the attached instructions.', '--format', 'json', '-m', c.model, '-f', join(dir, 'prompt.md'), ...(c.images ?? []).flatMap((i) => ['-f', join(dir, i.name)])],
        answer: (out, c) => {
            const events = out.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
            const error = events.find((e) => e.type === 'error');
            if (error)
                throw new ProviderError(JSON.stringify(error.error ?? error));
            let text = '';
            for (const e of events) {
                if (e.type === 'step_start')
                    text = '';
                if (e.type === 'text')
                    text += e.part.text;
            }
            return extractJsonObject(text, c.schema.required);
        },
        // A headless `run` cannot answer a permission ask, so any ask auto-rejects and the drive ends with no answer.
        // Driving the app runs commands that read or execute paths outside the repo (a browser, a system binary), so an
        // edit step allows every external directory except the user's home folder, where only the run's own folders are
        // allowed again; opencode's data folder (its login and database) is denied even when it is outside the home folder.
        // opencode takes the last rule that matches, so the run folders come after the denies. Tool-less calls deny all.
        env: (c) => {
            if (c.tools !== 'edit')
                return { OPENCODE_PERMISSION: JSON.stringify({ '*': 'deny' }) };
            const home = homedir();
            const data = join(process.env.XDG_DATA_HOME || join(home, '.local', 'share'), 'opencode');
            return { OPENCODE_PERMISSION: JSON.stringify({ external_directory: {
                        '*': 'allow', [home]: 'deny', [`${home}/*`]: 'deny', [data]: 'deny', [`${data}/*`]: 'deny',
                        ...Object.fromEntries((c.dirs ?? []).flatMap((d) => [[d, 'allow'], [`${d}/*`, 'allow']])),
                    } }) };
        },
        // A permission the run refused: the drive could not continue, so this is the reason, not a missing answer.
        reject: (stderr) => {
            const m = PERMISSION_REJECT.exec(stripVTControlCharacters(stderr));
            return m ? `it asked for permission to ${m[1]} (${m[2]}), which a headless run cannot answer and auto-rejects` : '';
        },
    },
    // pi -p reads the prompt on stdin (probed: with no positional message, stdin becomes the user
    // message); --mode json streams JSONL events whose assistant message_end holds the answer text,
    // --no-session keeps the probe ephemeral. An @<file> argument attaches an image to that message.
    // --no-tools turns every built-in and extension tool off (probed: a canary file outside the cwd went unread).
    // A tool-less call also loads no skills, prompt templates or context files, and only the chosen model's provider
    // extension (piProviderExtension): the others would add the user's own context to a fresh judge, and loading all of
    // them took 2 minutes on a real setup (probed), past the judge's timeout.
    // Pi has no permission gate for edit steps, so doctor warns about it. Without a model, pi runs its own default.
    pi: {
        streams: true,
        readsImages: true,
        argv: (c, dir) => ['-p', '--mode', 'json', '--no-session', ...(c.tools === 'edit' ? [] : [...PI_TOOL_LESS, ...piProviderExtension(c.model)]), ...(c.model ? ['--model', c.model] : []), ...(c.images ?? []).map((i) => `@${join(dir, i.name)}`)],
        answer: (out, c) => {
            let text = '';
            let failure = '';
            for (const line of out.split('\n')) {
                if (!line.startsWith('{'))
                    continue;
                let e;
                try {
                    e = JSON.parse(line);
                }
                catch {
                    continue;
                }
                if (e.type === 'error')
                    failure = JSON.stringify(e.error ?? e);
                if (e.type === 'message_end' && e.message?.role === 'assistant')
                    text = (e.message.content ?? []).filter((p) => p?.type === 'text').map((p) => p.text).join('');
            }
            if (!text && failure)
                throw new ProviderError(failure);
            return extractJsonObject(text, c.schema.required);
        },
    },
    // codex exec with no prompt argument reads it on stdin; --json streams JSONL events whose last agent_message holds the
    // answer, and --ephemeral keeps no session. An edit step runs in codex's workspace-write sandbox, which writes only the
    // repo, the run's folders (--add-dir) and $TMPDIR; it may use the network, since the drive launches the app and talks
    // to it, and it keeps the user's config.toml. Without a model, codex runs its own default.
    // Readers keep normal authentication but not user config (MCP), instructions or tools. Feature flags alone
    // are insufficient: the bundled model catalog can force code-mode, collaboration and apply_patch back on.
    // Copy only that public catalog into this call's scratch folder and remove its tool capabilities too.
    codex: {
        streams: true,
        files: (c) => {
            if (c.tools === 'edit')
                return {};
            const r = spawnSync(c.path, ['debug', 'models', '--bundled'], { encoding: 'utf8', timeout: 10_000, maxBuffer: 16 << 20 });
            if (r.status !== 0)
                throw new Error(`codex tool-less setup: ${r.error?.message || r.stderr || `debug models --bundled exited ${r.status}`}; update Codex CLI`);
            const catalog = JSON.parse(r.stdout);
            if (!Array.isArray(catalog.models) || !catalog.models.length || (c.model && !catalog.models.some((m) => m.slug === c.model)))
                throw new Error(`codex tool-less setup: bundled catalog does not list ${c.model || 'any model'}; choose a model from codex debug models --bundled`);
            for (const m of catalog.models)
                Object.assign(m, { shell_type: 'disabled', apply_patch_tool_type: null, tool_mode: 'direct', multi_agent_version: null, experimental_supported_tools: [], supports_search_tool: false });
            return { 'models.json': JSON.stringify(catalog) };
        },
        // Each sandboxed command runs in its own process namespace, so a server or browser bridge started in the
        // background by one command was gone by the next one, and a drive that launched the app and then browsed it captured nothing.
        editNote: 'Your shell sandbox ends every process a command started, background ones too, when that command ends. So start what a task needs (an app, a server, a browser bridge), use it, save what it produces and stop it within one shell command (a script in $TMPDIR is fine).',
        argv: (c, dir) => [...(c.tools === 'edit' ? [] : ['--no-daemon']), 'exec', '--json', '--ephemeral', ...(c.model ? ['-m', c.model] : []),
            ...(c.tools === 'edit' ? ['--sandbox', 'workspace-write', '-c', 'sandbox_workspace_write.network_access=true', ...(c.dirs ?? []).flatMap((d) => ['--add-dir', d])] : [
                '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check', '--sandbox', 'read-only',
                '-c', 'project_doc_max_bytes=0', '-c', `model_catalog_json=${JSON.stringify(join(dir, 'models.json'))}`,
                '-c', 'web_search="disabled"', '-c', 'tools.update_plan.enabled=false', '-c', 'tools.experimental_request_user_input.enabled=false',
                ...['shell_tool', 'multi_agent', 'apps', 'plugins', 'skill_search', 'tool_suggest', 'image_generation', 'view_image', 'sleep_tool', 'goals'].flatMap((f) => ['--disable', f]),
            ])],
        answer: (out, c) => {
            let text = '';
            let failed = '';
            let error = '';
            for (const line of out.split('\n')) {
                if (!line.startsWith('{'))
                    continue;
                const e = JSON.parse(line);
                if (e.type === 'item.completed' && e.item?.type === 'agent_message')
                    text = String(e.item.text ?? '');
                if (e.type === 'turn.failed')
                    failed = String(e.error?.message ?? JSON.stringify(e));
                if (e.type === 'error')
                    error = String(e.message ?? JSON.stringify(e));
            }
            // A failed turn has no answer; an error event (a retried stream) fails the call only when the agent said nothing.
            const why = failed || (text ? '' : error);
            if (why)
                throw new ProviderError(why);
            return extractJsonObject(text, c.schema.required);
        },
    },
    // gemini -p text is appended to stdin, so -p carries only a fixed trailer and the prompt goes on stdin;
    // -o json prints one object {response, stats, error?} (its headless.md). plan mode is read-only, so a
    // headless call never blocks on an approval prompt; auto_edit (edits approved) plus the shell tool is only for edit steps,
    // with the run's folders added to the workspace.
    // --skip-trust is only for the tool-less probe in its scratch folder (the headless path in its trusted-folders.md): done-done
    // never runs interactively, so the trust dialog could never be answered there. Repo calls keep Gemini's trust gate.
    // plan mode still reads files, so a tool-less call also loads a deny-all --policy, which replaces the user's own
    // policy folder and removes every tool, MCP ones too, from the model (its policy-engine.md). An @<file> in the -p text
    // attaches an image: per Gemini CLI's source, its own @-command code reads it, outside the tool policy, and only inside the cwd, the call's scratch folder; not yet proven live (Gemini CLI was not signed in on the test machine).
    gemini: {
        readsImages: true,
        argv: (c, dir) => ['-p', ['Follow the instructions on stdin.', ...(c.images ?? []).map((i) => `@${i.name}`)].join(' '), '-o', 'json', '-m', c.model, '--approval-mode', c.tools === 'edit' ? 'auto_edit' : 'plan',
            ...(c.tools === 'none' ? ['--policy', join(dir, 'deny-all.toml'), '--skip-trust'] : []),
            ...(c.tools === 'edit' ? ['--allowed-tools', 'run_shell_command', ...(c.dirs ?? []).flatMap((d) => ['--include-directories', d])] : [])],
        files: (c) => (c.tools === 'none' ? { 'deny-all.toml': '[[rule]]\ntoolName = "*"\ndecision = "deny"\npriority = 999\n' } : {}),
        hint: 'if gemini refused this folder as untrusted, trust it in Gemini CLI first, then retry',
        answer: (out, c) => {
            const r = JSON.parse(out);
            if (!r.response && r.error)
                throw new ProviderError(JSON.stringify(r.error));
            return extractJsonObject(String(r.response ?? ''), c.schema.required);
        },
    },
};
// The author agent: exactly the one the user set, never one done-done detects or falls back to. With none set,
// done-done asks the user (in a terminal) or stops with the command that saves their answer.
export function selectAgent(cfg) {
    if (!cfg.agent)
        throw noAgent();
    return agentRun(cfg, cfg.agent);
}
// The agents a user can pick, and the error that tells a calling agent to ask the user rather than pick one itself.
export const agentChoices = () => [...AGENTS, 'acp:<target>'];
// The error a command gives when the agent or the judge is not set: the ask, the choices, and the command that saves the answer.
const askError = (kind, choices, rule, save) => new UsageError(`no ${kind} is set: ask the user which ${kind} to use (${choices}); ${rule}`, `Save the user's answer: ${save}`);
export const noAgent = () => askError('agent', agentChoices().join(', '), 'never pick one for them', `done-done init --agent <agent> --model <model>, e.g. done-done init --agent opencode --model ${CHEAP.opencode.model}`);
export const modelFor = (cfg, agent) => cfg.agent_config[agent]?.model || CHEAP[agent]?.model || '';
// The configured model pool (judge.pool_command and its helper config), or undefined: standalone users keep today's behaviour.
export const modelPool = (cfg) => cfg.judge.pool_command ? { command: cfg.judge.pool_command, config: cfg.judge.pool_config, binFor: (agent) => agentPath(agent, cfg) } : undefined;
export const agentRun = (cfg, agent, model = modelFor(cfg, agent)) => ({
    agent, model, effort: cfg.agent_config[agent]?.effort ?? '', args: cfg.agent_args_override[agent] ?? [], path: agentPath(agent, cfg), override: cfg.agent_path_override[agent] ?? '', timeoutMs: parseDuration(cfg.agent_timeout),
    ...(agent === 'claude' && (modelPool(cfg) ? { pool: modelPool(cfg) } : cfg.judge.account_command ? { accountCommand: cfg.judge.account_command } : {})),
});
export const notStartable = (agent, override = '') => (override ? `agent_path_override.${agent} ${override} is not an executable file` : `${agent} is not on PATH`);
// The known agent an agent names, for the judge-independence check: acp:claude-code is claude; a target that
// names no known agent (acp:claudex, acp:foo) stays as named.
export function knownAgentOf(agent) {
    const target = agent.replace(/^acp:/, '');
    return AGENTS.find((a) => target === a || (target.startsWith(a) && !/[A-Za-z0-9]/.test(target[a.length]))) ?? agent;
}
const adapterFor = (agent) => (agent.startsWith('acp:') ? ACP : Object.hasOwn(ADAPTERS, agent) ? ADAPTERS[agent] : undefined);
// Why an agent cannot read a repo tool-less from text plain code gathers, '' when it can: gemini's none mode is a
// read-only plan mode, not tool-free.
export const toollessReason = (agent) => (agent === 'gemini' ? 'gemini cannot read tool-less yet, since its none mode is read-only plan mode, not tool-free' : '');
// A binary from config: a bare name is looked up on PATH, an absolute path is used when it is an executable file.
export const findBin = (bin) => (isAbsolute(bin) ? (isExecutable(bin) ? bin : '') : onPath(bin));
// The binary that starts an agent: agent_path_override.<agent>, else its name on PATH. An acp:<target> agent starts
// through acpx (acpx_path), which counts as installed only when it runs (a version-manager shim with no version set
// is on PATH but starts nothing).
const acpxRuns = new Map();
export function agentPath(agent, cfg) {
    if (!agent.startsWith('acp:'))
        return findBin(cfg?.agent_path_override[agent] || agent);
    const acpx = findBin(cfg?.acpx_path || 'acpx');
    if (!acpx)
        return '';
    if (!acpxRuns.has(acpx))
        acpxRuns.set(acpx, spawnSync(acpx, ['--version'], { stdio: 'ignore', timeout: 5_000 }).status === 0);
    return acpxRuns.get(acpx) ? acpx : '';
}
export const routeOf = (agent) => (agent === 'claude' ? 'claude-code' : `answerer:${agent}`);
export const JUDGES = AGENTS.filter((a) => a === 'claude' || ANSWERER_JUDGES.includes(a));
// Like the agent, the judge is exactly the one the user set; with none, done-done asks the user (in a terminal) or
// stops with this error, so a calling agent asks its user rather than picking one.
export const noJudge = () => askError('judge', JUDGES.join(', '), 'never pick one for them', `done-done init --judge <agent> --judge-model <model>, e.g. done-done init --judge opencode --judge-model ${CHEAP.opencode.model}`);
// The user's judge may be any agent and model they choose, the author's own too: it judges in a fresh session.
export function selectJudge(cfg, found) {
    const route = cfg.judge.route;
    if (!route)
        throw noJudge();
    // A key route judges on the user's own key at judge.model; an agent route judges through that agent at its model.
    const keyed = Object.hasOwn(KEY_ROUTES, route);
    if (keyed && !cfg.judge.model && !KEY_ROUTE_MODELS[route])
        throw new UsageError(`judge: judge.route ${route} needs judge.model, a model your key can use that reads images`, 'Set judge.model in ~/.done-done/config.yaml');
    const agent = keyed ? route : route === 'claude-code' ? 'claude' : route.slice('answerer:'.length);
    const model = cfg.judge.model || KEY_ROUTE_MODELS[route] || (agent === 'pi' ? cfg.agent_config.pi?.model || JUDGE_DEFAULT : modelFor(cfg, agent));
    if (!model)
        throw new UsageError(`judge: no model for ${route}`, `Set judge.model in ~/.done-done/config.yaml`);
    // acp:claude-code is claude for independence; an author with no known model is never apart by model.
    const independence = keyed
        ? found.model && model === found.model ? 'session-only' : 'agent'
        : agent !== knownAgentOf(found.agent) ? 'agent' : found.model && model !== found.model ? 'model' : 'session-only';
    return { route, agent, model, independence, author: { agent: found.agent, model: found.model } };
}
// One configured second route, else the legacy MiniMax fallback; use its own model, never the primary's.
export function selectFallback(cfg, found) {
    const route = cfg.judge.fallback_route || FALLBACK_ROUTES[cfg.judge.route];
    return route && route !== cfg.judge.route ? selectJudge({ ...cfg, judge: { ...cfg.judge, route, model: '' } }, found) : undefined;
}
const DRAIN_MS = 500;
const OUTPUT_CAP = 64 << 20;
// One agent process. An edit step gets its own process group, so whatever it started (a dev server, a browser) is
// killed with it when it ends, times out or writes past the output cap.
function start(bin, argv, c, cwd, input, env, idleMs) {
    const group = c.tools === 'edit';
    return new Promise((done) => {
        const child = spawn(bin, argv, { cwd, env, detached: group });
        let stdout = '';
        let stderr = '';
        let error;
        let drain;
        let idle;
        // A rate-limit line ends the call with that line, whatever the agent does next. On stdout the line must also say when it resets or retries,
        // so an answer that only quotes a 429 from the app's code does not stop the call. A claude call with images streams JSON lines,
        // and only a rejected rate_limit_event on stdout stops it, so its complete lines are parsed one at a time.
        let pendingStdout = '';
        const limited = (chunk, stdoutLine) => {
            let line;
            if (c.agent === 'claude' && c.images?.length) {
                if (!stdoutLine)
                    return;
                const text = pendingStdout + chunk;
                const end = text.lastIndexOf('\n') + 1;
                pendingStdout = text.slice(end);
                line = text.slice(0, end).split('\n').find(isRejectedRateLimit);
            }
            else {
                line = stripVTControlCharacters(chunk).split(/\r?\n/).find((l) => RATE_LIMIT.test(l) && (!stdoutLine || /reset|retry/i.test(l)));
                if (line)
                    line = limitText(line);
            }
            if (!line || error)
                return;
            error = new Error(`${c.agent} hit a rate limit and stopped: ${line.trim().slice(0, 200)}`);
            kill();
        };
        // Any output (stdout or stderr) shows the agent is working; silence for idleMs is a hang.
        const quiet = () => {
            if (!idleMs)
                return;
            clearTimeout(idle);
            idle = setTimeout(() => {
                error = new Error(`${c.agent} printed nothing for ${Math.round(idleMs / 1000)}s`);
                kill();
            }, idleMs);
        };
        const kill = () => {
            try {
                if (group)
                    process.kill(-child.pid, 'SIGKILL');
                else
                    child.kill('SIGKILL');
            }
            catch {
                // Already gone.
            }
        };
        const overflow = () => {
            error ??= new Error(`${c.agent} wrote more than ${OUTPUT_CAP >> 20} MiB of output`);
            kill();
        };
        const timer = setTimeout(() => {
            error = new Error(`${c.agent} timed out after ${Math.round(c.timeoutMs / 1000)}s`);
            kill();
        }, c.timeoutMs);
        child.on('error', (e) => {
            clearTimeout(timer);
            clearTimeout(idle);
            done({ status: null, stdout, stderr, error: e });
        });
        if (!child.pid)
            return;
        if (group)
            c.onSpawn?.(child.pid);
        quiet();
        child.stdout.setEncoding('utf8').on('data', (d) => {
            quiet();
            limited(d, true);
            stdout += d;
            if (stdout.length > OUTPUT_CAP)
                overflow();
        });
        child.stderr.setEncoding('utf8').on('data', (d) => {
            quiet();
            limited(d, false);
            stderr += d;
            if (stderr.length > OUTPUT_CAP)
                overflow();
        });
        child.on('exit', () => {
            drain = setTimeout(() => {
                child.stdout.destroy();
                child.stderr.destroy();
            }, DRAIN_MS);
        });
        child.on('close', (status) => {
            clearTimeout(timer);
            clearTimeout(idle);
            clearTimeout(drain);
            if (group)
                kill();
            done({ status, stdout, stderr, error });
        });
        child.stdin.on('error', () => { }); // an agent that exits without reading its stdin
        child.stdin.end(input);
    });
}
// A fall-over route as this machine runs it: the helper names a route id, done-done runs the agent and model it has here.
const POOL_ROUTES = {
    'route:openai-codex/gpt-6.1-sol': { agent: 'codex', model: 'gpt-6.1-sol' },
    'route:deepseek/deepseek-goat': { agent: 'pi', model: 'commandcode/deepseek/deepseek-v4.1-flash' },
    'route:cursor/auto': { agent: 'pi', model: 'cursor/auto' },
};
// A typed limit moves the call to the next account or route; usage credits and overage stop it with their own cause.
const USAGE_CREDITS = /usage[ _-]?credits?|overage|credit balance|\bcredits?\b|insufficient (?:credits?|funds)|\b402\b/i;
const TYPED_LIMIT = /rate[ -]?limit|usage limit|too many requests|quota exceeded|\b429\b/i;
// A valid pool refusal is availability, not a malformed pool configuration.
export class PoolUnavailable extends UsageError {
}
const poolKey = (p) => `${p.command}\0${p.config}`;
let poolFirst; // one first answer per process, as the account command is
let poolInUse; // the account or route this process is on now
// One helper call: the request JSON on stdin, one answer JSON. Nothing but the configured command passes through a shell.
function poolAsk(pool, verb, req) {
    const fail = (why, unavailable = false) => {
        throw new (unavailable ? PoolUnavailable : UsageError)(`judge.pool_command: ${why}`, 'Fix judge.pool_command and judge.pool_config in the global config, or remove them for plain Claude sign-in');
    };
    const r = spawnSync(`${pool.command} ${verb} --json`, { shell: true, encoding: 'utf8', input: JSON.stringify(req), timeout: 30_000, maxBuffer: 64 * 1024 });
    if (r.error)
        fail(r.error.code ?? 'command could not start');
    const said = typeof r.stderr === 'string' ? errorLine(r.stderr) : '';
    let a;
    try {
        a = JSON.parse(r.stdout);
    }
    catch {
        fail(r.status === 0 ? 'invalid JSON' : `command exited ${r.status}: ${said || 'no answer'}`);
    }
    const reason = typeof a?.reason === 'string' ? errorLine(a.reason) : said || 'no answer';
    const billing = String(a?.billing_classification ?? a?.billing ?? '');
    // The helper refuses credits-enabled accounts and routes; a call that reached one anyway is refused the same way.
    if (USAGE_CREDITS.test(billing) || USAGE_CREDITS.test(typeof a?.reason === 'string' ? a.reason : ''))
        fail(`the pool answered ${typeof a?.id === 'string' ? a.id : 'a route'} on usage credits or overage, which done-done never spends${reason === 'no answer' ? '' : `: ${reason}`}`);
    if (r.status !== 0 || a?.ok !== true)
        fail(reason, a?.ok === false || a === null);
    if (typeof a.id !== 'string' || !/^[A-Za-z0-9_:./-]{1,128}$/.test(a.id))
        fail('invalid account or route id');
    const set = a.set ?? {};
    const unset = a.unset ?? [];
    if (!set || typeof set !== 'object' || Array.isArray(set) || !Object.entries(set).every(([k, v]) => /^[A-Za-z_]\w*$/.test(k) && typeof v === 'string'))
        fail('set must be a map of environment variable names to strings');
    if (!Array.isArray(unset) || !unset.every((n) => typeof n === 'string' && /^[A-Za-z_]\w*$/.test(n)))
        fail('unset must be a list of environment variable names');
    if (unset.includes('CLAUDE_CONFIG_DIR'))
        fail('cannot unset CLAUDE_CONFIG_DIR');
    const route = typeof a.provider === 'string' && a.provider !== 'claude';
    // A known route id runs on the agent and model this tool has here; any other route runs its own harness when done-done knows it.
    const mapped = route ? POOL_ROUTES[a.id] ?? (AGENTS.includes(a.harness) ? { agent: a.harness, model: String(a.model ?? '') } : undefined) : undefined;
    if (route && !mapped)
        fail(`route ${a.id} names no agent done-done can run`, true);
    if (!route) {
        const folder = set.CLAUDE_CONFIG_DIR;
        let directory = false;
        try {
            directory = typeof folder === 'string' && isAbsolute(folder) && statSync(folder).isDirectory();
        }
        catch { }
        if (!directory)
            fail('set.CLAUDE_CONFIG_DIR must be an absolute existing folder');
    }
    return { id: a.id, set, unset, agent: mapped?.agent ?? 'claude', model: mapped?.model ?? '', route, raw: a };
}
// The account or fall-over route a pooled call starts on: the first answer is shared by every call in this process.
function poolPickFor(pool, model, deadlineMs) {
    if (poolInUse)
        return Promise.resolve(poolInUse);
    const key = poolKey(pool);
    if (poolFirst?.key !== key)
        poolFirst = { key, pick: Promise.resolve().then(() => poolAsk(pool, 'pick', { v: 1, purpose: 'work', pool_config: pool.config, model, capabilities: ['text'], deadline: Math.floor(deadlineMs / 1000) })).then((p) => (poolInUse = p)) };
    return poolFirst.pick;
}
// The account id or fall-over route a Claude call answers on, named in the judge's result detail; '' when none is configured.
export async function accountDetail(cfg, agent, model) {
    const pool = agent === 'claude' ? modelPool(cfg) : undefined;
    if (pool) {
        const pick = await poolPickFor(pool, model, Date.now() + parseDuration(cfg.agent_timeout));
        return pick.route ? `pool route ${pick.id}` : `Claude account ${pick.id}`;
    }
    const account = await claudeAccount(agent, cfg.judge.account_command);
    return account ? `Claude account ${account.id}` : '';
}
// A valid picker refusal is availability, not a malformed account configuration.
export class ClaudeUnavailable extends UsageError {
}
let accountPick;
// One pick (including failure) per process, shared by readers, drives and the judge; never change the caller's env.
export function claudeAccount(agent, command) {
    if (agent !== 'claude' || !command || process.env.CLAUDE_CONFIG_DIR !== undefined)
        return Promise.resolve(undefined);
    return accountPick ??= Promise.resolve().then(() => {
        const fail = (why, unavailable = false) => { throw new (unavailable ? ClaudeUnavailable : UsageError)(`judge.account_command: ${why}`, 'Fix judge.account_command in the global config, or export CLAUDE_CONFIG_DIR for this call'); };
        const r = spawnSync(command, { shell: true, encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 });
        if (r.error)
            fail(r.error.code ?? 'command could not start');
        let pick;
        try {
            pick = JSON.parse(r.stdout);
        }
        catch {
            fail(r.status === 0 ? 'invalid JSON' : `command exited ${r.status}: ${errorLine(r.stderr) || 'no pick returned'}`);
        }
        if (r.status !== 0)
            fail(`command exited ${r.status}: ${typeof pick?.reason === 'string' ? errorLine(pick.reason) : errorLine(r.stderr) || 'no pick returned'}`, pick?.ok === false || pick === null);
        if (pick?.ok !== true)
            fail(typeof pick?.reason === 'string' ? errorLine(pick.reason) : 'ok must be true', pick?.ok === false || pick === null);
        if (typeof pick.id !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(pick.id))
            fail('invalid account id');
        const folder = pick.set?.CLAUDE_CONFIG_DIR;
        let directory = false;
        try {
            directory = typeof folder === 'string' && isAbsolute(folder) && statSync(folder).isDirectory();
        }
        catch { }
        if (!directory)
            fail('set.CLAUDE_CONFIG_DIR must be an absolute existing folder');
        if (!Array.isArray(pick.unset) || !pick.unset.every((n) => typeof n === 'string' && /^[A-Za-z_]\w*$/.test(n)))
            fail('unset must be a list of environment variable names');
        if (pick.unset.includes('CLAUDE_CONFIG_DIR'))
            fail('cannot unset CLAUDE_CONFIG_DIR');
        return { id: pick.id, folder, unset: pick.unset };
    });
}
export async function askAgent(c) {
    // The model pool owns the call's agent, model and account environment: a typed limit moves it to the helper's next
    // account or fall-over route, and the call's own timeout is the one deadline that whole chain shares.
    const deadline = Date.now() + c.timeoutMs;
    let call = c;
    let picked;
    const attempted = [];
    const argv = (d) => {
        const adapter = adapterFor(call.agent);
        return adapter ? [...adapter.argv(call, d), ...(call.effort ? EFFORT_FLAGS[call.agent]?.(call.effort) ?? [] : []), ...(call.args ?? [])] : [];
    };
    // One move on a typed limit: the helper rests the limited account and answers the next account or fall-over route.
    const moveOn = async (text) => {
        const pool = call.pool;
        if (!pool || !picked)
            return false;
        if (USAGE_CREDITS.test(text))
            throw new UsageError(`done-done never spends usage credits or overage: ${picked.id} answered (${errorLine(text)})`, 'Use an account or route on your plan, then re-run; nothing is charged');
        if (!TYPED_LIMIT.test(text))
            return false;
        attempted.push(picked.id);
        while (Date.now() + 5_000 < deadline) {
            const prior = picked;
            const next = poolAsk(pool, 'next', { v: 1, purpose: 'work', pool_config: pool.config, model: c.model, capabilities: ['text'], deadline: Math.floor(deadline / 1000), selection: prior.raw, cause: 'rate_limit', attempted: [...attempted] });
            const bin = next.agent === c.agent ? c.path : pool.binFor(next.agent);
            // A route whose agent cannot start here (Codex is out, for one) is skipped: the helper is asked for the next one.
            if (!bin) {
                attempted.push(next.id);
                continue;
            }
            picked = poolInUse = next;
            call = { ...call, agent: next.agent, model: next.model || c.model, path: bin, effort: next.agent === c.agent ? c.effort : '' };
            return true;
        }
        return false;
    };
    const started = Date.now();
    let dir = '';
    let cwd = c.cwd;
    let res;
    let attempts = 0;
    let out;
    let failure;
    try {
        dir = mkdtempSync(join(tmpdir(), 'done-done-agent-'));
        cwd = c.tools === 'none' ? dir : c.cwd;
        if (call.pool)
            picked = await poolPickFor(call.pool, call.model, deadline);
        if (picked)
            call = { ...call, agent: picked.agent, model: picked.model || call.model, path: picked.agent === c.agent ? c.path : call.pool.binFor(picked.agent), effort: picked.agent === c.agent ? c.effort : '' };
        let lastError = '';
        for (;;) {
            const adapter = adapterFor(call.agent);
            if (!adapter)
                throw new Error(`no adapter for ${call.agent} yet`);
            const bin = call.path;
            if (!bin)
                throw new Error(call.agent.startsWith('acp:') ? `${call.agent} needs acpx, and acpx is not startable; ${ACPX_INSTALL}` : notStartable(call.agent, call.override));
            const account = call.accountCommand ? await claudeAccount(call.agent, call.accountCommand) : undefined;
            const env = { ...process.env, ...call.env, ...adapter.env?.(call), ...(account && { CLAUDE_CONFIG_DIR: account.folder }) };
            for (const name of account?.unset ?? [])
                delete env[name];
            if (picked) {
                for (const [name, value] of Object.entries(picked.set))
                    env[name] = value;
                for (const name of picked.unset)
                    delete env[name];
            }
            if (adapter.readsImages)
                for (const i of call.images ?? [])
                    writeFileSync(join(dir, i.name), i.bytes, { mode: 0o600 });
            for (const [name, text] of Object.entries(adapter.files?.(call) ?? {}))
                writeFileSync(join(dir, name), text, { mode: 0o600 });
            attempts++;
            // An ask-again names what was wrong with the last answer. The trailer ends on words, not the schema: a weak model
            // (seen with one opencode model) copied a schema that closed the prompt back as its answer.
            const schemaTrailer = `\n\nAnswer with only one JSON object that matches this JSON schema:\n${JSON.stringify(call.schema)}\nThat object holds your own values, never the schema itself, and you send no other text.\n`;
            const prompt = call.tools === 'edit' && adapter.editNote ? `${call.prompt}\n\n${adapter.editNote}` : call.prompt;
            const promptText = (attempts === 1 ? prompt : `${prompt}\n\nYour previous answer was not valid (${lastError}).`) + schemaTrailer;
            if (adapter.file)
                writeFileSync(join(dir, 'prompt.md'), promptText, { mode: 0o600 });
            const input = adapter.file ? '' : adapter.stdin ? adapter.stdin(call, promptText) : promptText;
            const remain = Math.max(1_000, Math.min(call.timeoutMs, deadline - Date.now()));
            res = await start(bin, argv(dir), { ...call, timeoutMs: remain }, cwd, input, env, adapter.streams ? call.idleMs ?? AGENT_IDLE_MS : 0);
            if (res.error) {
                if (await moveOn(res.error.message)) {
                    attempts--;
                    continue;
                }
                throw res.error;
            }
            // A permission the run refused explains a call with no answer; name it rather than the exit code text.
            const refused = adapter.reject?.(String(res.stderr ?? '')) ?? '';
            if (res.status !== 0 && refused)
                throw new ProviderError(refused, `${call.agent} exited ${res.status}: `);
            if (res.status !== 0) {
                // An agent that exits non-zero may still say why in its own output (claude: a usage limit, a bad model).
                let text = String(res.stderr || res.stdout).trim().slice(-500);
                try {
                    adapter.answer(String(res.stdout), call);
                }
                catch (e) {
                    if (e instanceof ProviderError)
                        text = e.detail;
                    else if (!(e instanceof SyntaxError))
                        text = e.message;
                }
                if (await moveOn(text)) {
                    attempts--;
                    continue;
                }
                throw new ProviderError(text, `${call.agent} exited ${res.status}: `, adapter.hint && call.tools !== 'none' ? `; ${adapter.hint}` : '');
            }
            try {
                const answer = adapter.answer(String(res.stdout), call);
                if (!answer || typeof answer !== 'object' || Array.isArray(answer))
                    throw new Error(`the answer is not a JSON object: ${JSON.stringify(answer)}`);
                const missing = (call.schema.required ?? []).filter((k) => !(k in answer));
                if (missing.length)
                    throw new Error(`the answer does not match the schema (missing ${missing.join(', ')}): ${JSON.stringify(answer).slice(0, 200)}`);
                out = { ok: true, answer: answer, ...(picked && (picked.route ? { route: picked.id } : { account: picked.id })) };
                break;
            }
            catch (e) {
                if (e instanceof ProviderError)
                    throw e;
                // A refused permission is why there is no usable answer, not a bad answer: name it instead of "no JSON object".
                if (refused)
                    throw new ProviderError(refused, `${call.agent} did not finish: `);
                // Only a tool-less call is asked again: an edit or read step may already have changed the repo or read it.
                lastError = e.message;
                if (call.tools !== 'none' || attempts >= (call.attempts ?? ASK_ATTEMPTS))
                    throw new Error(`the agent did not answer with valid JSON after ${attempts} ${attempts === 1 ? 'try' : 'tries'}: ${lastError}`);
            }
        }
    }
    catch (e) {
        // A silent, hung or timed-out agent says why only on stderr, so its no-answer reason quotes that. A provider error already
        // carries its own line, so it is left as it is.
        const said = stderrHead(String(res?.stderr ?? ''));
        const provider = e instanceof ProviderError;
        const note = (text) => (!provider && said && !text.includes(said.split(' | ')[0]) ? `${text}; ${call.agent} stderr: ${said}` : text);
        out = { ok: false, error: note(e.message), ...(!provider && said ? { stderr: said } : {}) };
        failure = note(e instanceof ProviderError ? e.detail : e.message);
    }
    finally {
        if (dir)
            rmSync(dir, { recursive: true, force: true });
    }
    // The record holds what ran and what came back, never the prompt text or an image.
    const { prompt, images, pool, ...spec } = c;
    try {
        const record = { ...spec, agent: call.agent, model: call.model, ...(picked && (picked.route ? { route: picked.id } : { account: picked.id })), ...(images && { images: images.map((i) => i.name) }), cwd, prompt_bytes: Buffer.byteLength(prompt), argv: argv('<tmp>'), ms: Date.now() - started, exit: res?.status ?? null, attempts, ...out, error: failure, stderr: String(res?.stderr ?? '').slice(-2000) };
        mkdirSync(dirname(c.record), { recursive: true });
        writeFileSync(c.record, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
        out = { ...out, record: c.record };
    }
    catch (e) {
        out = { ...out, recordError: e.message };
    }
    return out;
}
