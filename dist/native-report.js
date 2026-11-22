export function playwrightIntents(raw) {
    let report;
    try {
        report = JSON.parse(raw);
    }
    catch (e) {
        throw new Error(`invalid Playwright JSON: ${e.message}`);
    }
    if (!report || !Array.isArray(report.suites) || !Array.isArray(report.errors) || report.errors.length)
        throw new Error('Playwright JSON must contain suites and no discovery errors');
    const declarations = [], seen = new Set();
    const visit = (suite) => {
        if (!suite || !Array.isArray(suite.specs) || (suite.suites !== undefined && !Array.isArray(suite.suites)))
            throw new Error('invalid Playwright suite');
        for (const spec of suite.specs) {
            if (!spec || typeof spec.id !== 'string' || !spec.id || typeof spec.title !== 'string' || typeof spec.file !== 'string' || !spec.file || !Array.isArray(spec.tags) || !spec.tags.every((t) => typeof t === 'string') || !Array.isArray(spec.tests) || !spec.tests.length)
                throw new Error('invalid Playwright spec: id, title, file, tags and tests are required');
            if (seen.has(spec.id))
                throw new Error(`duplicate Playwright declaration ${spec.id}`);
            seen.add(spec.id);
            const tags = spec.tags.map((t) => t.replace(/^@/, ''));
            for (const test of spec.tests) {
                if (!Array.isArray(test.annotations))
                    throw new Error(`Playwright declaration ${spec.id} has no annotations list`);
                for (const a of test.annotations)
                    if (a?.type === 'intent' && typeof a.description === 'string')
                        tags.push(`intent:${a.description}`);
            }
            const intents = [...new Set(tags.filter(t => t.startsWith('intent:')).map(t => t.slice(7)))];
            if (intents.some(t => !/^[\w.-]+$/.test(t)))
                throw new Error(`invalid intent tag in ${spec.id}`);
            declarations.push({ id: spec.id, file: spec.file, name: spec.title, intents, critical: tags.includes('critical') });
        }
        for (const child of suite.suites ?? [])
            visit(child);
    };
    for (const suite of report.suites)
        visit(suite);
    return declarations;
}
const entity = (s) => s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, x) => {
    if (x[0] === '#')
        return String.fromCodePoint(x[1].toLowerCase() === 'x' ? parseInt(x.slice(2), 16) : parseInt(x.slice(1), 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[x];
});
// A deliberately limited XML reader: unsupported syntax is refused instead of inventing test results.
export function junit(raw) {
    if (/<!DOCTYPE|<!ENTITY/i.test(raw))
        throw new Error('JUnit DTD and entity declarations are unsupported');
    const token = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(?:(?:"[^"]*"|'[^']*'|[^'">])*)>/g;
    const stack = [];
    const leaves = [];
    let current = null, end = 0, root = false;
    for (const match of raw.matchAll(token)) {
        const gap = raw.slice(end, match.index);
        if (gap.includes('<') || /&(?!#x[\da-f]+;|#\d+;|amp;|lt;|gt;|quot;|apos;)/i.test(gap))
            throw new Error('malformed or unsupported JUnit XML');
        end = match.index + match[0].length;
        const tag = match[0];
        if (/^<\?|^<!--|^<!\[CDATA\[/.test(tag))
            continue;
        const close = /^<\s*\//.test(tag), self = /\/\s*>$/.test(tag);
        const m = /^<\s*\/?\s*([\w:.-]+)/.exec(tag);
        if (!m)
            throw new Error('malformed JUnit tag');
        const name = m[1].split(':').pop();
        if (close) {
            if (stack.pop() !== name)
                throw new Error(`mismatched JUnit tag ${name}`);
            if (name === 'testcase') {
                if (!current)
                    throw new Error('unexpected testcase end');
                leaves.push(current);
                current = null;
            }
            continue;
        }
        if (!root) {
            if (!['testsuite', 'testsuites'].includes(name))
                throw new Error('JUnit root must be testsuite or testsuites');
            root = true;
        }
        else if (!stack.length)
            throw new Error('multiple JUnit roots');
        const rest = tag.slice(m[0].length).replace(/\/?>$/, '');
        const attrs = {};
        const re = /\s+([\w:.-]+)\s*=\s*("[^"]*"|'[^']*')/gy;
        let i = 0, a;
        while (i < rest.length) {
            re.lastIndex = i;
            a = re.exec(rest);
            if (!a) {
                if (!rest.slice(i).trim())
                    break;
                throw new Error('malformed JUnit attributes');
            }
            if (Object.hasOwn(attrs, a[1]))
                throw new Error('duplicate JUnit attribute');
            if (/&(?!#x[\da-f]+;|#\d+;|amp;|lt;|gt;|quot;|apos;)/i.test(a[2]))
                throw new Error('unsupported JUnit entity');
            attrs[a[1]] = entity(a[2].slice(1, -1));
            i = re.lastIndex;
        }
        if (name === 'testcase') {
            if (current || !attrs.name)
                throw new Error('JUnit testcase needs a name and cannot be nested');
            current = { id: attrs.id ?? null, name: attrs.name, classname: attrs.classname ?? null, file: attrs.file ?? null, status: 'passed', retries: 0 };
        }
        else if (current && ['failure', 'error'].includes(name))
            current.status = 'failed';
        else if (current && name === 'skipped')
            current.status = 'skipped';
        else if (current && ['rerunFailure', 'rerunError', 'flakyFailure', 'flakyError'].includes(name))
            current.retries++;
        if (self) {
            if (name === 'testcase') {
                leaves.push(current);
                current = null;
            }
        }
        else
            stack.push(name);
    }
    if (!root || stack.length || raw.slice(end).trim())
        throw new Error('incomplete JUnit XML');
    return { format: 'junit', raw, leaves, known: leaves.length || null, attempted: leaves.length ? leaves.filter((x) => x.status !== 'skipped').length : null };
}
