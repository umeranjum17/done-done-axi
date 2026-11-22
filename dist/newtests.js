// Red before green: a test a change declares as new behaviour must fail on the base commit (with the test file copied in from
// head) and pass at head, so a receipt never vouches for a test that proves nothing the base did not already do.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, join, normalize } from 'node:path';
import { isTestFile } from './inventory.js';
// A test that cannot run in this environment exits with this status (Juggernaut's JG_TEST_SKIP_EXIT); it is never a pass.
export const SKIP_EXIT = 77;
const FLAG = '--new-test';
const BOUND_MS = 300_000;
// The declared files, repeatable as `--new-test <file>` or `--new-test=<file>`, and the arguments left over.
export function parseNewTests(argv) {
    const files = [];
    const rest = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === FLAG) {
            const f = argv[++i];
            if (!f || f.startsWith('--'))
                return { files, rest, error: `${FLAG} needs a test file path` };
            files.push(f);
        }
        else if (a.startsWith(`${FLAG}=`))
            files.push(a.slice(FLAG.length + 1));
        else
            rest.push(a);
    }
    return { files: [...new Set(files)], rest };
}
// The command that runs one test file: by extension, else the `check.test_run` template ({file} is the quoted path), else none.
export function runnerFor(file, template) {
    const ext = extname(file);
    if (ext === '.mjs' || ext === '.js')
        return ['node', '--test', file];
    if (ext === '.sh')
        return ['bash', file];
    if (ext === '.py')
        return ['python3', '-m', 'pytest', '-q', file];
    return template.trim() ? { shell: template.replaceAll('{file}', `'${file.replaceAll("'", `'\\''`)}'`) } : null;
}
export function runAt(cwd, file, template) {
    const cmd = runnerFor(file, template);
    if (!cmd)
        return { error: `no runner for ${file}` };
    const env = { ...process.env, JG_TEST_SKIP_EXIT: String(SKIP_EXIT) };
    const r = Array.isArray(cmd)
        ? spawnSync(cmd[0], cmd.slice(1), { cwd, env, stdio: 'ignore', timeout: BOUND_MS })
        : spawnSync('sh', ['-c', cmd.shell], { cwd, env, stdio: 'ignore', timeout: BOUND_MS });
    if (r.error)
        return { error: `${file} could not run: ${r.error.message}` };
    return r.status === SKIP_EXIT ? 'skipped' : r.status === 0 ? 'green' : 'red';
}
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
// The commit the change started from: the configured base_ref, else the merge base with the default branch, else head's parent.
export function baseCommit(repo, baseRef, defaultRef) {
    const head = git(repo, 'rev-parse', 'HEAD');
    const resolve = (ref) => { try {
        return git(repo, 'rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`);
    }
    catch {
        return '';
    } };
    if (baseRef) {
        const b = resolve(baseRef);
        if (!b)
            throw new Error(`base_ref ${baseRef} names no commit in this repo`);
        return b;
    }
    const mb = defaultRef ? (() => { try {
        return git(repo, 'merge-base', defaultRef, 'HEAD');
    }
    catch {
        return '';
    } })() : '';
    const base = mb && mb !== head ? mb : resolve('HEAD^');
    if (!base)
        throw new Error('no base commit: head has no parent and no base_ref or default branch gives one');
    return base;
}
// Run each declared file at head (in the clean checkout) and on the base (a scratch worktree, removed always, with the file
// copied in from head). A refusal names the first file that is not red on the base or not green at head.
export function checkNewTests(repo, files, base, template) {
    const rows = [];
    const scratch = mkdtempSync(join(tmpdir(), 'done-done-red-'));
    const wt = join(scratch, 'base');
    try {
        git(repo, 'worktree', 'add', '-q', '--detach', wt, base);
        for (const file of files) {
            const rel = normalize(file);
            if (isAbsolute(rel) || rel.startsWith('..'))
                return { rows, refusal: `${file}: a new test must be a path inside the repo` };
            try {
                git(repo, 'cat-file', '-e', `HEAD:${rel}`);
            }
            catch {
                return { rows, refusal: `${file}: not a file committed at HEAD, so it cannot be a new test of this change` };
            }
            const head = runAt(repo, rel, template);
            if (typeof head === 'object')
                return { rows, refusal: head.error };
            if (head === 'skipped')
                return { rows, refusal: `${file}: skipped at head (exit ${SKIP_EXIT}); a skipped test is not a pass` };
            if (head === 'red')
                return { rows, refusal: `${file}: fails at head, so it does not prove the change` };
            mkdirSync(dirname(join(wt, rel)), { recursive: true });
            copyFileSync(join(repo, rel), join(wt, rel));
            const onBase = runAt(wt, rel, template);
            if (typeof onBase === 'object')
                return { rows, refusal: onBase.error };
            if (onBase === 'skipped')
                return { rows, refusal: `${file}: skipped on the base ${base.slice(0, 12)} (exit ${SKIP_EXIT}); a skipped test is not a pass` };
            if (onBase === 'green')
                return { rows, refusal: `${file}: already passes on the base ${base.slice(0, 12)}, so it proves no new behaviour; make it fail there first, or do not declare it with --new-test` };
            rows.push({ file, base: 'red', head: 'green' });
        }
        return { rows, refusal: '' };
    }
    finally {
        try {
            git(repo, 'worktree', 'remove', '--force', wt);
        }
        catch { /* never added, or already gone */ }
        rmSync(scratch, { recursive: true, force: true });
    }
}
export function shadowNewTests(repo, declared, base) {
    const head = git(repo, 'rev-parse', 'HEAD');
    const added = git(repo, 'diff', '--diff-filter=A', '--name-only', '-z', base, head).split('\0').filter(isTestFile);
    const files = [...new Set([...added, ...declared])].sort();
    const rows = [];
    const scratch = mkdtempSync(join(tmpdir(), 'done-done-admission-'));
    const wt = join(scratch, 'base');
    try {
        git(repo, 'worktree', 'add', '-q', '--detach', wt, base);
        for (const file of files) {
            const rel = normalize(file);
            const unknown = (reason) => rows.push({ file, result: 'no-proof', reason });
            if (isAbsolute(rel) || rel.startsWith('..')) {
                unknown('path outside repository');
                continue;
            }
            if (!['.js', '.mjs'].includes(extname(rel))) {
                unknown('runner does not expose structured assertion failures');
                continue;
            }
            try {
                git(repo, 'cat-file', '-e', `HEAD:${rel}`);
            }
            catch {
                unknown('test is not committed at HEAD');
                continue;
            }
            const run = (cwd) => spawnSync(process.execPath, ['--test', '--test-reporter=tap', rel], { cwd, encoding: 'utf8', timeout: BOUND_MS, maxBuffer: 8 * 1024 * 1024 });
            const fixed = run(repo);
            if (fixed.error || fixed.status !== 0 || /# SKIP\b|# TODO\b/.test(fixed.stdout)) {
                unknown('head failed, skipped, or could not run');
                continue;
            }
            mkdirSync(dirname(join(wt, rel)), { recursive: true });
            copyFileSync(join(repo, rel), join(wt, rel));
            const bad = run(wt);
            if (bad.error || bad.status !== 1 || !/code: ['"]ERR_ASSERTION['"]/.test(bad.stdout) || /# SKIP\b|# TODO\b/.test(bad.stdout)) {
                unknown('base did not report an assertion failure');
                continue;
            }
            // The runner supplies no link between this assertion and the claimed bug; it is a candidate, not proof.
            rows.push({ file, result: 'assertion-failed', reason: 'assertion failed on base and test passed at head; intended assertion and independent oracle unverified' });
        }
    }
    finally {
        try {
            git(repo, 'worktree', 'remove', '--force', wt);
        }
        catch { /* never added or already removed */ }
        rmSync(scratch, { recursive: true, force: true });
    }
    return { base, head, rows, assertion_failures: rows.filter(r => r.result === 'assertion-failed').length, no_proof: rows.filter(r => r.result === 'no-proof').length };
}
