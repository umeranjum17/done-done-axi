// The one rule for real-product evidence, shared by init, doctor, check, receipt and gate. It is model-free and reads
// the command text only: a command is code-only when every step in it is a test, typecheck, lint or build runner (a test or
// guard script by its file name or folder counts as one), or
// shell plumbing around one, and at least one step is such a runner. Its output says the code checks pass, never that
// the product works. Any other step (a capture script, done-done look, the app's own binary, curl, adb) drives the product.
// Steps that neither drive the product nor check the code: they move files and text around a runner.
const PLUMBING = new Set(['cd', 'echo', 'printf', 'cat', 'tee', 'mkdir', 'cp', 'mv', 'rm', 'touch', 'ln', 'true', 'false', ':', 'export', 'set', 'unset', 'ls', 'date', 'sleep', 'test', '[', 'wc', 'grep', 'sed', 'awk', 'head', 'tail', 'sort', 'uniq', 'tr', 'cut', 'exit', 'source', '.', 'pwd', 'wait']);
// Prefixes that run the next word: stripped (with their own flags) before the step is read.
const WRAPPERS = new Set(['env', 'time', 'nice', 'nohup', 'exec', 'command', 'cross-env', 'npx', 'bunx', 'pnpx', 'xvfb-run', 'sh', 'bash', 'zsh', 'timeout']);
const RUN_PREFIX = { pnpm: ['exec', 'dlx'], yarn: ['exec', 'dlx'], npm: ['exec'], uv: ['run'], poetry: ['run'], pipenv: ['run'], bundle: ['exec'], python: ['-m'], python3: ['-m'] };
// Tools that are a code check whatever their arguments.
const RUNNERS = new Set(['tsc', 'vue-tsc', 'eslint', 'prettier', 'biome', 'oxlint', 'stylelint', 'jest', 'vitest', 'mocha', 'ava', 'tap', 'jasmine', 'karma', 'pytest', 'py.test', 'tox', 'nox', 'mypy', 'pyright', 'ruff', 'flake8', 'pylint', 'black', 'isort', 'unittest', 'rspec', 'rubocop', 'phpunit', 'phpstan', 'golangci-lint', 'gofmt', 'shellcheck', 'hadolint', 'ktlint', 'detekt', 'swiftlint']);
// Gradle tasks that test, lint or build (connectedAndroidTest, testDebugUnitTest, lintRelease, assembleDebug), with or without a :module: prefix.
const GRADLE = /^(.*:)?((test|check|lint|build|assemble)\w*|\w*Test)$/;
// Tools that are a code check with one of these subcommands (playwright test is, playwright screenshot is not).
const SUBCOMMANDS = {
    node: /^--test$/, deno: /^(test|check|lint|fmt)$/, go: /^(test|vet|build)$/, cargo: /^(test|check|clippy|fmt|build|nextest)$/,
    make: /^(test|tests|check|lint|typecheck|build)$/, just: /^(test|tests|check|lint|typecheck|build)$/,
    gradle: GRADLE, './gradlew': GRADLE, gradlew: GRADLE, mvn: /^(test|verify|package)$/,
    dotnet: /^(test|build)$/, swift: /^(test|build)$/, flutter: /^(test|analyze)$/, dart: /^(test|analyze)$/, xcodebuild: /^test$/, mix: /^test$/,
    playwright: /^test$/, cypress: /^run$/,
};
// A script that is a test or a code guard by its name or place: *.test.* and *.spec.* (x_test.go too), test_*.py, a file in a
// test/, tests/ or __tests__/ folder, a script named test, and a guard or lint script (floor-guard.mjs, lint.sh).
const TEST_FILE = /(^|\/)(tests?|__tests__)\/|[._-](test|spec)\.\w+$|(^|\/)test_\w+\.py$|(^|\/)tests?\.\w+$|(^|\/|[._-])(guard|lint)\.\w+$/;
// Interpreters whose first argument is the script they run (go, deno and bun after run).
const INTERPRETERS = new Set(['node', 'tsx', 'ts-node', 'bun', 'deno', 'go', 'python', 'python3', 'ruby', 'perl', 'php']);
// A package script by name: test, check, lint, typecheck, build... and their variants (test:unit, check-types).
const SCRIPT = /^(t|tst|tests?|checks?|lint|lints|typecheck|type-check|types|tsc|format|fmt|prettier|eslint|build|coverage|validate|unit|spec|vet)([:._-].*)?$/i;
const INSTALL = /^(i|install|ci|add)$/;
const PACKAGE_MANAGERS = new Set(['npm', 'yarn', 'pnpm', 'bun']);
function stepKind(step) {
    let words = step.replace(/["'`(){}]/g, ' ').split(/\s+/).filter(Boolean);
    for (;;) {
        while (words.length && /^\w+=/.test(words[0]))
            words = words.slice(1);
        if (!words.length)
            return 'plumbing';
        const [w, next] = words;
        if (WRAPPERS.has(w)) {
            words = words.slice(1);
            // A wrapper's own flags (npx -y, sh -c, timeout 60s) are not the command it runs.
            while (words.length > 1 && (words[0].startsWith('-') || (w === 'timeout' && /^\d/.test(words[0]))))
                words = words.slice(1);
            continue;
        }
        if (RUN_PREFIX[w]?.includes(next)) {
            words = words.slice(2);
            continue;
        }
        break;
    }
    const [w, ...rest] = words;
    const base = w.split('/').pop();
    if (PLUMBING.has(base))
        return 'plumbing';
    if (RUNNERS.has(base))
        return 'runner';
    // A test or guard script, run directly (./tests/smoke.test.sh, bash tests/x.test.sh) or by an interpreter (node scripts/floor-guard.mjs).
    if (TEST_FILE.test(w))
        return 'runner';
    if (INTERPRETERS.has(base)) {
        const args = rest.filter((a) => !a.startsWith('-'));
        const script = ['go', 'deno', 'bun'].includes(base) && args[0] === 'run' ? args[1] : args[0];
        if (script && TEST_FILE.test(script))
            return 'runner';
    }
    if (PACKAGE_MANAGERS.has(base)) {
        const args = rest.filter((a) => !a.startsWith('-'));
        if (!args.length || INSTALL.test(args[0]))
            return 'plumbing';
        const script = ['run', 'run-script'].includes(args[0]) ? args[1] : args[0];
        return script && SCRIPT.test(script) ? 'runner' : 'product';
    }
    const sub = SUBCOMMANDS[w] ?? SUBCOMMANDS[base];
    // node takes --test among its flags before the script; every other tool names its subcommand first.
    const first = rest.findIndex((a) => !a.startsWith('-'));
    const said = base === 'node' ? rest.slice(0, first < 0 ? rest.length : first) : first < 0 ? [] : [rest[first]];
    if (sub)
        return said.some((a) => sub.test(a)) ? 'runner' : 'product';
    return 'product';
}
// True when the shell command only runs code checks (tests, typecheck, lint, build) and plumbing around them.
export function codeOnly(command) {
    if (!command)
        return false;
    const steps = command
        .replace(/&>>?\s*[^\s;&|]+|\d*>>?\s*&?\s*[^\s;&|]+|<\s*[^\s;&|]+/g, ' ')
        .split(/&&|\|\||[;|\n&]/)
        .map((s) => s.trim())
        .filter(Boolean);
    const kinds = steps.map(stepKind);
    return kinds.includes('runner') && kinds.every((k) => k !== 'product');
}
export const RULE = 'a test, typecheck, lint or build run proves the code checks pass, not that the product works';
// The configured journeys whose command is code-only.
export const codeOnlyJourneys = (journeys) => Object.keys(journeys).filter((n) => codeOnly(journeys[n].command));
// Why the config's journeys capture no real-product evidence (every journey is code-only), or null. No journeys is fine:
// verify then has the agent drive the verify skill's features.
export function configFault(journeys) {
    const names = Object.keys(journeys);
    const code = codeOnlyJourneys(journeys);
    return names.length && code.length === names.length ? `every journey in .done-done.yaml is code-only (${code.join(', ')}): ${RULE}` : null;
}
export const STEPS_FILE = 'steps.json';
export const STEPS_SHAPE = '{"target": {"version": "<version of the app driven>"}, "start": "<the state it started from>", "steps": ["<a step a user takes>", ...], "result": "<what a user can see at the end>"}';
// Why parsed JSON is not a step record, or null.
export function stepRecordFault(s) {
    const r = s;
    const text = (v) => typeof v === 'string' && v.trim() !== '';
    if (!r || typeof r !== 'object' || Array.isArray(r))
        return `it is not a JSON object shaped ${STEPS_SHAPE}`;
    if (!text(r.target?.version))
        return 'target.version is missing';
    if (!text(r.start))
        return 'start is missing';
    if (!Array.isArray(r.steps) || !r.steps.length || !r.steps.every(text))
        return 'steps must be a non-empty list of strings';
    if (!text(r.result))
        return 'result is missing';
    return null;
}
// Why these capture runs are no real-product evidence (none recorded, or every one code-only), or null.
export function runsFault(runs) {
    if (!Array.isArray(runs) || !runs.length)
        return 'it records no capture runs, so nothing shows its proof came from the real product';
    if (!runs.every((r) => r && typeof r === 'object' && typeof r.run_id === 'string'))
        return 'its capture runs are malformed';
    if (!runs.every((r) => codeOnly(r.command)))
        return null;
    return `every cited capture comes from a code-only run (${[...new Set(runs.map((r) => r.journey ?? r.command))].join(', ')}): ${RULE}`;
}
// Whether the runs behind a claim carry a well-formed step record. A fault: no real run (one that is not code-only) has one.
// A warning: a real run was recorded before step records existed, so it keeps working but nothing ties its captures to user steps.
// The record's words are never matched against the claim's: a claim describes an outcome in its own words, and whether the
// captures show it is the judge's call, not a word test's. Requiring the record is what keeps the user steps behind a capture.
export function stepsFault(runs) {
    const real = runs.filter((r) => !codeOnly(r.command));
    const why = (r) => {
        if (r.steps_error)
            return `run ${r.run_id}'s step record ${STEPS_FILE} is invalid: ${r.steps_error}`;
        if (!r.steps)
            return `run ${r.run_id} has no step record (${STEPS_FILE} beside its captures)`;
        const bad = stepRecordFault(r.steps);
        return bad ? `run ${r.run_id}'s step record ${STEPS_FILE} is invalid: ${bad}` : '';
    };
    const reasons = real.map(why);
    if (!real.length || reasons.some((w) => !w))
        return { fault: null, warning: null };
    const old = real.filter((r) => !r.tool);
    if (old.length)
        return { fault: null, warning: `run ${old.map((r) => r.run_id).join(', ')} was recorded before step records, so nothing shows the user steps behind its captures; re-run the journey so it writes ${STEPS_FILE}` };
    return { fault: `no cited capture comes from a run with a well-formed step record: ${reasons.join('; ')}`, warning: null };
}
export const MARK = { core: '(core journey)', upgrade: '(upgrade journey)' };
// Where the role is named: the journey that carries it and drives the product, else the feature-map entry with its mark, else null.
export function namedJourney(role, journeys, featureMap = '') {
    const j = Object.keys(journeys).find((n) => journeys[n][role] && !codeOnly(journeys[n].command));
    if (j)
        return `journey ${j}`;
    const line = featureMap.split('\n').find((l) => /^\s*[-*] /.test(l) && l.includes(MARK[role]));
    return line ? `feature map entry ${line.replace(/^\s*[-*] /, '').split(MARK[role])[0].trim()}` : null;
}
// What shows an app ships an installable or upgradable artifact, from its tracked files: each match as "<file>: <what>".
// read gives a tracked file's text (undefined when it cannot be read).
export function releaseArtifacts(files, read) {
    const found = [];
    for (const f of files) {
        const name = f.split('/').pop();
        let what = '';
        if (name === 'package.json') {
            try {
                const p = JSON.parse(read(f) ?? '');
                if (p && p.private !== true && (typeof p.bin === 'string' ? p.bin : p.bin && Object.keys(p.bin).length))
                    what = 'an npm package with a bin users install';
            }
            catch { }
        }
        else if (name === 'eas.json')
            what = 'an Expo app build';
        else if (name === 'AndroidManifest.xml')
            what = 'an Android app';
        else if (/^build\.gradle(\.kts)?$/.test(name) && /\bapplicationId\b/.test(read(f) ?? ''))
            what = 'an Android app';
        else if (name === 'pyproject.toml' && /^\[(project|tool\.poetry)\.scripts\]/m.test(read(f) ?? ''))
            what = 'a Python package with console scripts';
        else if (name === 'Cargo.toml' && /^\[\[bin\]\]/m.test(read(f) ?? ''))
            what = 'a Rust binary';
        else if (/^\.goreleaser\.ya?ml$/.test(name))
            what = 'a goreleaser release';
        else if (name.endsWith('.service'))
            what = 'a systemd service (a host or daemon)';
        if (what)
            found.push(`${f}: ${what}`);
    }
    return found;
}
