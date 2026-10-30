// `done-done lint`: the deterministic merge gate on a worker's claim. It reads the newest "## Checks" block of a PR body
// or report file and fails an unproven, reused or oversized claim. No judge, no model; the repo config only switches on
// the two optional size rules (checks.upstream_catch_up, checks.moved_from) and extra generated paths (checks.generated_paths);
// files the target repo marks generated in .gitattributes are not counted either.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, matchesGlob, resolve } from 'node:path';

// Third-party, legal text and committed build output are not reviewable code.
const GENERATED = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|go\.sum|[^/]*\.lock)$|(^|\/)vendor\/|(^|\/)dist\/|(^|\/)(LICENSE|LICENSES|NOTICE|COPYING)[^/]*$/;
type Rules = { upstream_catch_up?: boolean; moved_from?: boolean; generated_paths?: string[] };
const generatedBy = (globs: string[] = []) => (p: string) => GENERATED.test(p) || globs.some((g) => matchesGlob(p, g));
// A target repo's own .gitattributes marks generated files: linguist-generated, linguist-generated=true or -diff. The last matching line wins;
// linguist-generated=false and an unset attribute mean not generated. A pattern with no slash matches the basename, like git.
function attrGenerated(attrs: string): (p: string) => boolean {
  const rules = attrs.split('\n').map((l) => l.trim().split(/\s+/)).filter((w) => w[0] && !w[0].startsWith('#') && w.length > 1);
  return (p) => {
    let gen = false;
    for (const [pat, ...as] of rules) {
      const glob = pat.replace(/^\//, '');
      if (!matchesGlob(glob.includes('/') ? p : basename(p), glob.endsWith('/') ? `${glob}**` : glob)) continue;
      for (const a of as) {
        if (/^(linguist-generated(=true)?|-diff)$/.test(a)) gen = true;
        else if (/^(linguist-generated=false|-linguist-generated|!linguist-generated)$/.test(a)) gen = false;
      }
    }
    return gen;
  };
}
export const SIZE_LIMIT = 1000;
const FIX_TITLE = /^(fix|bugfix|hotfix)\b/i;
const NOT_APPLICABLE = /^n\/?a\b/i;

type Verdict = { ok: boolean; why: string; head: string; warn?: string };
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
const worst = (r: ReturnType<Gh>) => r.stderr.trim().split('\n').pop()?.slice(0, 160) || '?';

// `gh pr view --json files` stops at 100 files, so the whole list comes from the paginated pull-files endpoint instead.
// GitHub stops that endpoint at 3000 files, so page 30 being full is already past what it will list.
const MAX_PAGES = 30;
function prFiles(run: Gh, nwo: string, num: string): { paths?: string[]; why?: string } {
  const paths: string[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const call = `repos/${nwo}/pulls/${num}/files?per_page=100&page=${page}`;
    const r = run('api', call);
    if (r.status) return { why: `${call} failed: ${worst(r)}` };
    let files: { path?: string }[];
    try { files = JSON.parse(r.stdout); } catch { return { why: `${call} returned no file list` }; }
    if (!Array.isArray(files)) return { why: `${call} returned no file list` };
    for (const f of files) if (f.path) paths.push(f.path);
    if (files.length < 100) return { paths };
  }
  return { why: `${nwo}/pulls/${num}/files is still full on page ${MAX_PAGES}: more files than lint can count` };
}

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

// The commit a cited proof comes from: the PR's head commit, or the checkout lint runs in for a report file. Reuse is
// the same bytes at the same commit, so a deterministic re-render from a new sealed run at a new commit is fresh proof,
// while the same proof cited for a second PR is refused. No commit at all falls back to the bytes alone.
function proofCommit(prHead: string): string {
  if (prHead !== '-') return prHead;
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 10_000 });
  return r.status === 0 ? r.stdout.trim() || '-' : '-';
}

// src: a PR URL or a report file; ev: the folder the evidence names are relative to; dir: where the hash store and log live.
export function lint(src: string, ev: string, dir: string, rules: Rules = {}, run: Gh = gh): Verdict {
  const byConfig = generatedBy(rules.generated_paths);
  let isGenerated = byConfig;
  let warn = ''; // set for a PR that touches src/ with no journeys/ file; it only softens a PASS
  const log = (v: Verdict) => {
    if (v.ok && warn) v = { ...v, warn };
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'lint.log'), `${new Date().toISOString()}\t${src}\t${v.head}\t${v.ok ? (v.warn ? 'warn' : 'pass') : 'fail'}\t${v.why}\n`);
    return v;
  };
  let body = '', title = '', head = '-', task = '';
  if (existsSync(src) && statSync(src).isFile()) {
    body = readFileSync(src, 'utf8');
    task = basename(dirname(resolve(src)));
  } else {
    const r = run('pr', 'view', src, '--json', 'author,body,title,headRefOid,headRefName,baseRefOid');
    if (r.status) return log({ ok: false, why: `gh pr view failed: ${worst(r)}`, head });
    const pr = JSON.parse(r.stdout);
    ({ body, title } = { body: pr.body ?? '', title: pr.title ?? '' });
    head = pr.headRefOid ?? '-';
    task = String(pr.headRefName ?? '').split('/').pop()!;
    const author: string = pr.author?.login ?? '';
    if (/^(app\/)?(dependabot|renovate)(\[bot\])?$/.test(author)) return log({ ok: true, why: 'bot', head });
    const nwo = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\//.exec(src)?.[1];
    const num = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/.exec(src)?.[1];
    if (!nwo || !num) return log({ ok: false, why: `not a GitHub pull URL: ${src.slice(0, 120)}`, head });
    const listed = prFiles(run, nwo, num);
    if (!listed.paths) return log({ ok: false, why: listed.why ?? 'the pull file list failed', head });
    const paths = listed.paths;
    const attrs = [head, pr.baseRefOid].map((ref) => ref && run('api', '-H', 'Accept: application/vnd.github.raw', `repos/${nwo}/contents/.gitattributes?ref=${ref}`)).find((a) => a && a.status === 0);
    if (attrs) { const byAttr = attrGenerated(attrs.stdout); isGenerated = (p) => byConfig(p) || byAttr(p); }
    if (paths.some((p) => p.startsWith('src/')) && !paths.some((p) => p.startsWith('journeys/'))) warn = 'the diff changes src/ and no journeys/ file: run the journey, commit it, then open the PR';
    // The PR's whole net comes from the compare diff (three dots: from the merge base), never from the per-file additions.
    const cmp = `repos/${nwo}/compare/${pr.baseRefOid ?? ''}...${head}`;
    const d = run('api', '-H', 'Accept: application/vnd.github.diff', cmp);
    if (d.status) return log({ ok: false, why: `${cmp} failed: ${worst(d)}`, head });
    let net = netLines(d.stdout, isGenerated);
    if (rules.upstream_catch_up && total(net) >= SIZE_LIMIT) net = without(net, upstreamDelta(run, nwo, head, pr.baseRefOid ?? '', isGenerated));
    if (rules.moved_from && total(net) >= SIZE_LIMIT) net = without(net, movedLines(run, nwo, body, paths, isGenerated));
    const size = total(net);
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
  // Each line is "<hash> v2 <commit> <task>"; a line without v2 was written before reuse keyed on the commit and owns
  // its bytes alone, so an old store still refuses a byte-for-byte copy of an older proof.
  const seen = new Map<string, { commit: string; task: string }[]>();
  if (existsSync(store))
    for (const l of readFileSync(store, 'utf8').split('\n')) {
      const [h, ...rest] = l.split(' ');
      if (!h || !rest.length) continue;
      const owner = rest[0] === 'v2' && rest.length >= 2 ? { commit: rest[1], task: rest.slice(2).join(' ') } : { commit: '-', task: rest.join(' ') };
      seen.set(h, [...(seen.get(h) ?? []), owner]);
    }
  const commit = proofCommit(head);
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
    // Reuse needs this commit too, so the same screen re-rendered at a new commit is new proof. The same task's earlier
    // lint is never reuse.
    const reused = (seen.get(h) ?? []).some((o) => o.task !== src && o.task !== task && o.commit === commit);
    if (!reused) fresh = true;
  }
  if (!fresh) return fail('every evidence file was already used by another PR at this commit (re-capture after your next commit, or capture the state this claim is about)');
  if (new Set(mine).size < mine.length) return fail('two evidence files are byte-identical: capture each claimed state separately, or write "not proven: <cause>"');
  mkdirSync(dir, { recursive: true });
  for (const h of mine) if (!(seen.get(h) ?? []).some((o) => o.commit === commit)) appendFileSync(store, `${h} v2 ${commit} ${task || src}\n`);
  return log({ ok: true, why: `${names.length} evidence files`, head });
}
