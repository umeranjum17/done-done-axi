import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
export const AUTHOR_ROUTES = [
    { harness: 'codex', model: 'gpt-6-luna', effort: 'low' },
    { harness: 'codex', model: 'gpt-6.1-terra', effort: 'low' },
    { harness: 'claude', model: 'claude-haiku-5-5', effort: 'low' },
];
export function validRoutes(value, judge = false) {
    return Array.isArray(value) && value.length > 0 && value.every(r => r && typeof r === 'object'
        && ['claude', 'pi', 'opencode', 'gemini', ...(judge ? ['openai:key', 'minimax:key'] : ['codex'])].includes(r.harness)
        && typeof r.model === 'string' && !!r.model.trim()
        && (r.effort === undefined || (['claude', 'codex', 'pi', 'opencode'].includes(r.harness) && ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(r.effort))));
}
// Juggernaut's first matching tool rule owns the ordered profiles. Absent tags retain config.yaml.
export function toolRoutes() {
    const env = process.env;
    const file = env.JG_TOOL_MODELS || join(env.JG_CONFIG_OVERRIDE || join(env.JG_HOME || env.JG_ROOT_OVERRIDE || join(homedir(), 'juggernaut'), 'config'), 'tool-models.json');
    let doc;
    try {
        doc = JSON.parse(readFileSync(file, 'utf8'));
    }
    catch (e) {
        if (e.code !== 'ENOENT')
            process.stderr.write(`TOOL_MODELS: ${file} is not used: ${e.message}; keeping config.yaml routes\n`);
        return {};
    }
    const routes = {};
    for (const kind of ['author', 'judge']) {
        const rule = Array.isArray(doc?.rules) ? doc.rules.find((r) => r?.tool === `done-done-${kind}`) : undefined;
        if (!rule)
            continue;
        const list = Array.isArray(rule.use) ? rule.use : [rule.use];
        if (validRoutes(list, kind === 'judge'))
            routes[kind] = list;
        else
            process.stderr.write(`TOOL_MODELS: ${file}: invalid done-done-${kind} profiles; keeping config.yaml routes\n`);
    }
    return routes;
}
// Only provider/launch failures reach this classifier, never a product verdict or an invalid JSON answer.
export const unavailable = (text) => /rate[ _-]?limit|usage[ _-]?limit|quota|too many requests|\b(?:401|403|404|429)\b|not (?:logged|signed) in|unauthenticated|unauthorized|authenticat(?:e|ion)|invalid.*(?:api.?key|token)|(?:model.*(?:not found|not available|unavailable|does not exist|not supported)|(?:unknown|unsupported|missing) model)|before first output/i.test(text);
