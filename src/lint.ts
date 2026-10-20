// `done-done lint`: the deterministic merge gate on a worker's claim. It reads the newest "## Checks" block of a PR body
// or report file and fails an unproven, reused or oversized claim. No judge, no model; the repo config only switches on
// the two optional size rules (checks.upstream_catch_up, checks.moved_from) and extra generated paths (checks.generated_paths).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, matchesGlob, resolve } from 'node:path';

// Third-party, legal text and committed build output are not reviewable code.
const GENERATED = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|go\.sum|[^/]*\.lock)$|(^|\/)vendor\/|(^|\/)dist\/|(^|\/)(LICENSE|LICENSES|NOTICE|COPYING)[^/]*$/;
type Rules = { upstream_catch_up?: boolean; moved_from?: boolean; generated_paths?: string[] };
const generatedBy = (globs: string[] = []) => (p: string) => GENERATED.test(p) || globs.some((g) => matchesGlob(p, g));
export const SIZE_LIMIT = 1000;
const FIX_TITLE = /^(fix|bugfix|hotfix)\b/i;
const NOT_APPLICABLE = /^n\/?a\b/i;

type Verdict = { ok: boolean; why: string; head: string };
type Gh = (...args: string[]) => { status: number | null; stdout: string; stderr: string };

const gh: Gh = (...args) => {
  const r = spawnSync('gh', args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 1 << 28 });
  return { status: r.error ? 1 : r.status, stdout: r.stdout ?? '', stderr: r.error?.message ?? r.stderr ?? '' };
};

// Per trimmed line, how many more times a unified diff adds it than deletes it, in non-generated files: a line moved between files cancels out.
type Lines = Map<string, number>;
function netLines(diff: string, isGenerated: (p: string) => boolean): Lines {
  const net: Lines = new Map();
  let generated = false;
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++ ')) { generated = isGenerated(l.startsWith('+++ b/') ? l.slice(6) : l.slice(4)); continue; }
    if (l.startsWith('--- ') || generated || !l.slice(1).trim()) continue;
    if (l[0] === '+' || l[0] === '-') net.set(l.slice(1).trim(), (net.get(l.slice(1).trim()) ?? 0) + (l[0] === '+' ? 1 : -1));
  }
  return without(net, new Map());
}
// `a` less the lines `b` holds, keeping only what is still added.
function without(a: Lines, b: Lines): Lines {
  const out: Lines = new Map();
  for (const [l, n] of a) if (n - (b.get(l) ?? 0) > 0) out.set(l, n - (b.get(l) ?? 0));
  return out;
}
const total = (n: Lines) => [...n.values()].reduce((sum, c) => sum + c, 0);
const stdout = (r: ReturnType<Gh>) => (r.status === 0 ? r.stdout.trim() : '');

// checks.upstream_catch_up: lines the fork's parent repo already shipped are not authored here, so subtract the upstream delta the PR
// merges in (PR base ... the merge base with the parent's default branch). A plain fork PR merges no new upstream commit, so its delta
// is empty. Any API failure keeps the full count.
function upstreamDelta(run: Gh, nwo: string, head: string, base: string, isGenerated: (p: string) => boolean): Lines {
  const parent = stdout(run('api', `repos/${nwo}`, '--jq', '.parent | select(.) | .owner.login + ":" + .default_branch'));
  const tip = parent && stdout(run('api', `repos/${nwo}/compare/${parent}...${head}`, '--jq', '.merge_base_commit.sha'));
  const diff = tip && run('api', '-H', 'Accept: application/vnd.github.diff', `repos/${nwo}/compare/${base}...${tip}`);
  return diff && diff.status === 0 ? netLines(diff.stdout, isGenerated) : new Map();
}

// checks.moved_from: a body line "moved-from: <owner>/<repo>@<ref> <dst-prefix>=<src-prefix>..." cancels added lines that byte-match
// the mapped source files in a repo of the PR's own owner; authored lines still count.
function movedLines(run: Gh, nwo: string, body: string, paths: string[], isGenerated: (p: string) => boolean): Lines {
  const mv = /^\s*moved-from\s*:\s*([\w.-]+)\/([\w.-]+)@(\S+)\s+(.+)$/m.exec(body);
  const rules = mv && mv[1] === nwo.split('/')[0] ? mv[4].split(/\s+/).filter((r) => r.includes('=')).map((r) => [r.slice(0, r.indexOf('=')), r.slice(r.indexOf('=') + 1)]) : [];
  const moved: Lines = new Map();
  for (const p of paths) {
    const rule = rules.find(([dst]) => p.startsWith(dst));
    if (!mv || !rule || isGenerated(p)) continue;
    const src = run('api', '-H', 'Accept: application/vnd.github.raw', `repos/${mv[1]}/${mv[2]}/contents/${rule[1]}${p.slice(rule[0].length)}?ref=${mv[3]}`);
    if (src.status === 0) for (const l of src.stdout.split('\n')) if (l.trim()) moved.set(l.trim(), (moved.get(l.trim()) ?? 0) + 1);
  }
  return moved;
}

const sha256 = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

// src: a PR URL or a report file; ev: the folder the evidence names are relative to; dir: where the hash store and log live.
export function lint(src: string, ev: string, dir: string, rules: Rules = {}, run: Gh = gh): Verdict {
  const isGenerated = generatedBy(rules.generated_paths);
  const log = (v: Verdict) => {
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'lint.log'), `${new Date().toISOString()}\t${src}\t${v.head}\t${v.ok ? 'pass' : 'fail'}\t${v.why}\n`);
    return v;
  };
  let body = '', title = '', head = '-', task = '';
  if (existsSync(src) && statSync(src).isFile()) {
    body = readFileSync(src, 'utf8');
    task = basename(dirname(resolve(src)));
  } else {
    const r = run('pr', 'view', src, '--json', 'author,body,title,files,headRefOid,headRefName,baseRefOid');
    if (r.status) return log({ ok: false, why: `gh pr view failed: ${r.stderr.trim().split('\n').pop()?.slice(0, 160) || '?'}`, head });
    const pr = JSON.parse(r.stdout);
    ({ body, title } = { body: pr.body ?? '', title: pr.title ?? '' });
    head = pr.headRefOid ?? '-';
    task = String(pr.headRefName ?? '').split('/').pop()!;
    const author: string = pr.author?.login ?? '';
    if (/^(app\/)?(dependabot|renovate)(\[bot\])?$/.test(author)) return log({ ok: true, why: 'bot', head });
    let size = (pr.files ?? []).reduce((n: number, f: { path?: string; additions?: number }) => n + (isGenerated(f.path ?? '') ? 0 : f.additions ?? 0), 0);
    if (size >= SIZE_LIMIT) {
      const d = run('pr', 'diff', src);
      if (!d.status) {
        let net = netLines(d.stdout, isGenerated);
        const nwo = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\//.exec(src)?.[1];
        if (nwo && rules.upstream_catch_up && total(net) >= SIZE_LIMIT) net = without(net, upstreamDelta(run, nwo, head, pr.baseRefOid ?? '', isGenerated));
        if (nwo && rules.moved_from && total(net) >= SIZE_LIMIT) net = without(net, movedLines(run, nwo, body, (pr.files ?? []).map((f: { path?: string }) => f.path ?? ''), isGenerated));
        size = total(net);
      }
    }
    if (size >= SIZE_LIMIT) return log({ ok: false, why: `${size} added non-generated lines (moved lines excluded): split it (limit ${SIZE_LIMIT})`, head });
  }
  const fail = (why: string) => log({ ok: false, why, head });

  const block = [...body.matchAll(/^##\s*Checks\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/gm)].pop(); // newest: workers append, never replace
  if (!block) return fail('no "## Checks" block');
  const f: Record<string, string> = {};
  for (const m of block[1].replace(/```\w*/g, '').matchAll(/^\s*(outcome|repro|proof|evidence)\s*:\s*(.*)$/gm)) f[m[1]] = m[2].trim();
  const missing = ['outcome', 'repro', 'proof', 'evidence'].filter((k) => !f[k]);
  if (missing.length) return fail(`missing or empty Checks line: ${missing.join(', ')}`);
  if (!/[/`]|\.\w{2,4}\b|\b(npm|pnpm|yarn|npx|bash|sh|python3?|node|cargo|go|gradle|make|adb|xcrun|done-done)\b/.test(f.proof)) return fail('proof: names no command or path');
  const skills = join(process.cwd(), '.agents', 'skills');
  const hasVerify = existsSync(skills) && readdirSync(skills).some((d) => /^(done-done-)?verify-/.test(d));
  if (!f.proof.includes('verify-') && (hasVerify || !/no verify skill/i.test(f.proof)))
    return fail(`proof: does not name the done-done-verify-<app> skill run${hasVerify ? '' : ' (or "no verify skill")'}`);
  if (NOT_APPLICABLE.test(f.repro) && FIX_TITLE.test(title)) return fail('repro: is n/a on a fix PR');
  if (/^not proven\s*:\s*\S/i.test(f.evidence)) return log({ ok: true, why: `not-proven: ${f.evidence.slice(0, 120)}`, head });

  const names = f.evidence.split(/[,\s]+/).map((n) => n.replace(/^[`"']+|[`"']+$/g, '')).filter((n) => /\.\w{1,10}$/.test(n));
  if (!names.length) return fail('evidence: names no files (or write "not proven: <cause>")');
  const store = join(dir, 'lint.hashes');
  const seen = new Map<string, string>();
  if (existsSync(store)) for (const l of readFileSync(store, 'utf8').split('\n')) { const p = l.split(' '); if (p.length === 2) seen.set(p[0], p[1]); }
  // The evidence folder is born when the task starts, so a file older than it was captured for something else.
  const born = existsSync(ev) ? statSync(ev).birthtimeMs : 0;
  const mine: string[] = [];
  let fresh = false;
  for (const n of names) {
    const p = isAbsolute(n) ? n : join(ev, n);
    if (!existsSync(p) || !statSync(p).isFile() || statSync(p).size === 0) return fail(`evidence file missing or empty: ${p}`);
    if (born && statSync(p).mtimeMs < born) return fail(`evidence file older than the task start: ${p}`);
    const h = sha256(p);
    mine.push(h);
    const owner = seen.get(h); // the same task's earlier lint is not reuse
    if (owner === undefined || owner === src || owner === task) fresh = true;
  }
  if (!fresh) return fail('every evidence file was already used by another PR');
  if (new Set(mine).size < mine.length) return fail('two evidence files are byte-identical: capture each claimed state separately, or write "not proven: <cause>"');
  mkdirSync(dir, { recursive: true });
  for (const h of mine) if (!seen.has(h)) appendFileSync(store, `${h} ${task || src}\n`);
  return log({ ok: true, why: `${names.length} evidence files`, head });
}
