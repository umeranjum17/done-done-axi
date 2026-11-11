import { posix } from 'node:path';

// `done-done qa "<feature>"`: plan the QA for a change before any proof is captured. Model-free: the diff decides whether the
// change adds or alters something a user can see or run (a command, flag, route or screen), which needs a journey, or only
// touches tests, fixtures, docs, build output or internals, which are marked no-test with the reason.

export type Changed = { path: string; added: string[] };
export type Plan = { plan: 'journey' | 'no-test'; reason: string; signals: string[] };

// Files that never change what a user sees: tests and their fixtures, docs, the verify skill and journeys that prove, lock files, build output.
const FIXTURE = /(^|\/)(fixtures?|__fixtures__|testdata)\//;
const TEST = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/;
const HARNESS = /^(docs|journeys|\.agents|dist)\/|\.md$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/;
const SCREEN = /\.(tsx|jsx|vue|svelte|html|css|scss)$/;

// What an added source line says a user can now reach: a command row or dispatch, a flag, or a route.
const SURFACES: [string, RegExp][] = [
  ['command usage', /\busage:\s*\[\s*\[/],
  ['command', /\b(?:cmd|command)\s*===\s*['"][\w-]+['"]/],
  ['flag', /['"]--[a-z][\w-]*(?:\s*<[^>]+>)?['"]\s*:/],
  ['route', /\.(?:get|post|put|patch|delete)\(\s*['"`]\//],
];

const kind = (p: string) => (FIXTURE.test(p) ? 'fixture' : TEST.test(p) ? 'test' : HARNESS.test(p) ? 'harness' : SCREEN.test(p) ? 'screen' : 'source');
const list = (xs: string[]) => (xs.length > 3 ? `${xs.slice(0, 3).join(', ')} and ${xs.length - 3} more` : xs.join(', '));

export function planQa(changed: Changed[]): Plan {
  if (!changed.length) return { plan: 'no-test', reason: 'no changed files, so no behaviour to prove', signals: [] };
  const signals: string[] = [];
  for (const c of changed) {
    const k = kind(c.path);
    if (k === 'screen') signals.push(`screen ${c.path}`);
    if (k === 'source') for (const [name, re] of SURFACES) if (c.added.some((l) => re.test(l))) signals.push(`${name} in ${c.path}`);
  }
  if (signals.length) return { plan: 'journey', reason: `changed user-visible behaviour: ${list(signals)}; a journey must drive it`, signals };
  const kinds = new Set(changed.map((c) => kind(c.path)));
  const names = list(changed.map((c) => posix.basename(c.path)));
  if (kinds.size === 1 && kinds.has('fixture')) return { plan: 'no-test', reason: `fixture refactor (${names}): only test fixtures changed, no user-visible behaviour`, signals };
  if ([...kinds].every((k) => k === 'fixture' || k === 'test')) return { plan: 'no-test', reason: `tests and fixtures only (${names}): no user-visible behaviour changed`, signals };
  if (!kinds.has('source')) return { plan: 'no-test', reason: `docs, build output or proof files only (${names}): no user-visible behaviour changed`, signals };
  return { plan: 'no-test', reason: `internal change (${names}): adds no command, flag, route or screen a user can reach`, signals };
}
