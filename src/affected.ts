import { matchesGlob, posix } from 'node:path';
import { reacher } from './deps.js';
import { codeOnly } from './proof.js';
import { isTestFile } from './inventory.js';

// `done-done affected`: which journeys a diff needs, from the verify skill's feature map and the paths it cites. Model-free:
// a journey is hit when its command names a changed file; a feature file (features/<name>.md) is hit when it cites a changed
// file (a repo path, a markdown link, a tracked folder such as src/, or a bare file name as maintain reads one) or is the
// changed file (the skill's SKILL.md and feature map need every feature), and it brings the journeys it names (`run <journey>`, or a file the journey's command runs). A feature that
// names no journey is driven by the author agent (verify --feature). A journey also needs a changed file its command reaches:
// a script it sources, imports or calls by path, followed transitively (src/deps.ts). A changed file nothing covers, or one the
// repo configures as global (affected.global_paths), is uncertain: the whole `local` tier runs, each journey with the reason;
// with no local tier, the core journey runs too. Never less.

type Journeys = Record<string, { command: string; core?: boolean; tier?: string }>;
type Refs = { files: Set<string>; dirs: string[] };
export type Hit = { name: string; why: string[] };
export type Mapping = { journeys: Hit[]; features: Hit[]; unmapped: string[]; fallback: string | null; runs: string };

// The tracked files and folders a text names. Paths are read relative to the repo, then to `from` (a feature file's folder,
// for its markdown links); a folder counts only when written with a slash (src/), so a prose word never names one.
// ponytail: a path with brackets or parens (pages/[id].tsx) is not read; add those characters when a repo cites one.
function refs(text: string, tracked: string[], from?: string): Refs {
  const files = new Set<string>();
  const dirs = new Set<string>();
  const exact = new Set(tracked);
  for (let tok of text.match(/[\w@.\/+-]+/g) ?? []) {
    tok = tok.replace(/\.+$/, '');
    if (!tok) continue;
    if (!tok.includes('/')) {
      if (/\.[A-Za-z]\w*$/.test(tok)) for (const t of tracked) if (t === tok || t.endsWith(`/${tok}`)) files.add(t);
      continue;
    }
    for (const p of [posix.normalize(tok), ...(from ? [posix.join(from, tok)] : [])]) {
      const clean = p.replace(/^\.\//, '').replace(/\/+$/, '');
      if (!clean || clean.startsWith('..')) continue;
      if (exact.has(clean)) files.add(clean);
      else if (tracked.some((t) => t.startsWith(`${clean}/`))) dirs.add(clean);
    }
  }
  return { files, dirs: [...dirs] };
}

const covers = (r: Refs, p: string) => r.files.has(p) || r.dirs.some((d) => p.startsWith(`${d}/`));

// The journeys and features `changed` needs. features: each feature file's text by name; skill: the skill folder; coreFeature:
// the feature the feature map marks (core journey), for the fallback; noBase: why there is no diff to read, if so.
export function mapChange(o: { changed: string[]; tracked: string[]; journeys: Journeys; skill: string; features: Record<string, string>; coreFeature?: string; noBase?: string; globalPaths?: string[]; read?: (path: string) => string | undefined;
  // Runs once per file followed: the caller's time limit, which throws when it is spent.
  tick?: () => void }): Mapping {
  // A code-only journey is no proof, so the change never needs one.
  const real = Object.keys(o.journeys).filter((n) => !codeOnly(o.journeys[n].command));
  const jRefs = new Map(real.map((n) => [n, refs(o.journeys[n].command, o.tracked)]));
  const reachFrom = reacher(o.tracked, o.read ?? (() => undefined), o.tick);
  const reached = new Map(real.map((n) => [n, reachFrom([...jRefs.get(n)!.files])]));
  const featDir = posix.join(o.skill, 'features');
  const fRefs = new Map(Object.entries(o.features).map(([n, text]) => [n, refs(text, o.tracked, featDir)]));
  // The journeys each feature names: `run <journey>` or `verify <journey>`, or a file its command runs that the feature cites too.
  const named = new Map(
    Object.entries(o.features).map(([n, text]) => {
      const said = new Set([...text.matchAll(/\b(?:run|verify)\s+`?([\w.-]+)/g)].map((m) => m[1]));
      const r = fRefs.get(n)!;
      return [n, real.filter((j) => said.has(j) || [...jRefs.get(j)!.files].some((f) => r.files.has(f)))];
    }),
  );
  const journeys = new Map<string, string[]>();
  const features = new Map<string, string[]>();
  const hit = (m: Map<string, string[]>, name: string, why: string) => m.set(name, [...(m.get(name) ?? []), why]);
  const unmapped: string[] = [];
  const global: string[] = [];
  const globals = o.globalPaths ?? [];
  for (const c of o.changed) {
    let found = false;
    for (const [j, r] of jRefs)
      if (covers(r, c)) {
        hit(journeys, j, `its command runs ${c}`);
        found = true;
      } else {
        const r = reached.get(j)!;
        const chain = r.files.get(c) ?? [...r.dirs].find(([d]) => c.startsWith(`${d}/`))?.[1];
        if (chain) {
          hit(journeys, j, `its command reaches ${c} (${chain.join(' -> ')})`);
          found = true;
        }
      }
    if (globals.some((g) => matchesGlob(c, g))) global.push(c);
    // The skill's own SKILL.md and feature map are what every feature follows, so they need every feature.
    const shared = c.startsWith(`${o.skill}/`) && !(c.startsWith(`${featDir}/`) && posix.basename(c, '.md') in o.features);
    for (const [f, r] of fRefs) {
      if (!shared && c !== posix.join(featDir, `${f}.md`) && !covers(r, c)) continue;
      found = true;
      const why = shared ? `every feature follows ${c}` : c === posix.join(featDir, `${f}.md`) ? `feature ${f} changed` : `feature ${f} cites ${c}`;
      const js = named.get(f)!;
      if (js.length) for (const j of js) hit(journeys, j, why);
      else hit(features, f, why);
    }
    if (!found) unmapped.push(c);
  }
  // Uncertain means more, never less: unknown or uncovered files and configured global files run the whole local tier (each
  // journey named with the reason); with no local tier, the core journey runs too, or every real journey when none is core.
  const uncertain = o.noBase ?? (unmapped.length ? `${unmapped.length} changed ${unmapped.length === 1 ? 'file is' : 'files are'} in no feature or journey` : '');
  const globalWhy = global.length ? `${global.length === 1 ? 'a global file' : 'global files'} changed (${global.slice(0, 3).join(', ')}${global.length > 3 ? `, +${global.length - 3} more` : ''})` : '';
  const local = real.filter((j) => o.journeys[j].tier === 'local');
  let fallback: string | null = null;
  let runs = 'core journey';
  if (uncertain || globalWhy) {
    const reasons = [uncertain, globalWhy].filter(Boolean);
    const why = `uncertain: ${reasons.join('; ')}`;
    if (local.length) {
      local.forEach((j) => hit(journeys, j, `the whole local tier runs: ${reasons.join('; ')}`));
      runs = 'whole local tier';
    } else {
      const core = real.filter((j) => o.journeys[j].core);
      if (core.length) core.forEach((j) => hit(journeys, j, why));
      else if (o.coreFeature && o.coreFeature in o.features) (named.get(o.coreFeature)!.length ? named.get(o.coreFeature)!.forEach((j) => hit(journeys, j, why)) : hit(features, o.coreFeature, why));
      else if (real.length) real.forEach((j) => hit(journeys, j, `${why}, and no core journey is named`));
      else Object.keys(o.features).forEach((f) => hit(features, f, `${why}, and no core journey is named`));
    }
    fallback = why;
  }
  const list = (m: Map<string, string[]>) => [...m].map(([name, why]) => ({ name, why: [...new Set(why)] }));
  return { journeys: list(journeys), features: list(features), unmapped, fallback, runs };
}

// Each candidate carries the changed input and owner that made it relevant. Native runner lists are
// file lists, not dependency witnesses; declarations separately cover helpers and subprocess inputs.
export function shadowPlan(o: {
  base: string; head: string; changed: string[];
  states: { tracked: string[]; owners: Record<string, { tests: string[]; inputs: string[] }> }[];
  native: { tool: string; version: string | null; queries: { input: string; args: string[]; files: string[]; raw: string; stderr?: string; duration_ms?: number; error?: string }[]; error?: string };
}) {
  const picks = new Map<string, { test: string; owner: string; input: string; reason: string }>();
  const unknown = new Set(o.changed);
  const owners = new Map<string, Set<string>>();
  const add = (test: string, owner: string, input: string, reason: string) => {
    const row = { test, owner, input, reason };
    picks.set(JSON.stringify(row), row);
  };
  for (const state of o.states) for (const [owner, declaration] of Object.entries(state.owners)) {
    const tests = state.tracked.filter((p) => declaration.tests.some((g) => matchesGlob(p, g)));
    for (const test of tests) owners.set(test, new Set([...(owners.get(test) ?? []), owner]));
    for (const input of o.changed) {
      const pattern = declaration.inputs.find((g) => matchesGlob(input, g));
      if (!pattern || !tests.length) continue;
      unknown.delete(input);
      for (const test of tests) add(test, owner, input, `declared input ${pattern}`);
    }
  }
  const missingOwners = new Set<string>();
  for (const query of o.native.queries) for (const test of query.files) {
    const found = owners.get(test);
    if (!found?.size) missingOwners.add(test);
    else for (const owner of found) add(test, owner, query.input, 'runner-reported file list');
  }
  const known = new Set(o.states.flatMap((state) => state.tracked.filter(isTestFile)));
  const unowned = [...known].filter((test) => !owners.has(test));
  const current = o.states[o.states.length - 1];
  const lost = o.states[0] === current ? [] : Object.entries(o.states[0].owners).flatMap(([owner, before]) => {
    const after = current.owners[owner];
    return o.changed.filter((input) => before.inputs.some((g) => matchesGlob(input, g))
      && (!after || !after.inputs.some((g) => matchesGlob(input, g))
        || !current.tracked.some((test) => after.tests.some((g) => matchesGlob(test, g)))))
      .map((input) => `${owner}: ${input}`);
  });
  const headUnowned = current.tracked.filter((p) => isTestFile(p) && !Object.values(current.owners).some((owner) => owner.tests.some((g) => matchesGlob(p, g))));
  const broad = o.changed.filter((p) => /(^|\/)(?:package(?:-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|jest\.config\.[^/]+|nx\.json|BUILD(?:\.bazel)?)$/.test(p));
  const problems = [o.native.error, ...o.native.queries.map((q) => q.error),
    unowned.length ? `independently enumerated tests without owners: ${unowned.join(', ')}` : '',
    headUnowned.length ? `head tests without owners: ${headUnowned.join(', ')}` : '',
    lost.length ? `declarations removed at head: ${lost.join(', ')}` : '',
    broad.length ? `configuration or lockfile changed: ${broad.join(', ')}` : '',
    unknown.size ? `inputs without declared owners: ${[...unknown].join(', ')}` : '',
    missingOwners.size ? `tests without owners: ${[...missingOwners].join(', ')}` : ''].filter(Boolean);
  return {
    schema: 1, mode: 'shadow', base: o.base, head: o.head,
    complete: problems.length === 0, fallback: problems.length ? problems : null,
    unknown: [...unknown], picks: [...picks.values()], native: o.native,
    usage: { step: 'selection', reason: 'shadow affected test picks', model_calls: 0 },
    counts: { known: known.size, attempted: null, selected: new Set([...picks.values()].map((p) => p.test)).size, extras: [...new Set([...picks.values()].map((p) => p.test))].filter((p) => !o.native.queries.some((q) => q.files.includes(p))).length },
    cache_identity: { base: o.base, head: o.head },
  };
}
