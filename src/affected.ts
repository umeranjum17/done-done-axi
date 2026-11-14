import { matchesGlob, posix } from 'node:path';
import { reacher } from './deps.js';
import { codeOnly } from './proof.js';

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
