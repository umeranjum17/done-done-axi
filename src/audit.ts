import { posix } from 'node:path';

// `done-done affected --audit <range>`: how often the feature map selected the journey that later failed. A full run that fails a
// journey at a commit whose receipt never ran it is a selection miss when `affected` did not pick that journey for the commit's
// diff. Each miss becomes file/journey pairs written to the feature file that names the journey, so the next `affected` picks it.
// Model-free: it reads run records, receipts and git only.

export type JourneyFailure = { commit: string; journey: string };
export type Miss = JourneyFailure & { files: string[] };
export type Audit = { caught: JourneyFailure[]; missed: Miss[]; recall: number | null };

// Caught: the map selected the journey for the failing commit's diff. Missed: it did not. Recall is caught over failures, null with none.
export function auditSelection(o: { failures: JourneyFailure[]; selected: (commit: string) => string[]; changed: (commit: string) => string[] }): Audit {
  const caught = o.failures.filter((f) => o.selected(f.commit).includes(f.journey));
  const missed = o.failures.filter((f) => !caught.includes(f)).map((f) => ({ ...f, files: o.changed(f.commit) }));
  return { caught, missed, recall: o.failures.length ? caught.length / o.failures.length : null };
}

const names = (text: string, journey: string) => new RegExp(`\\b(?:run|verify)\\s+\`?${journey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.-])`).test(text);

// The feature file that names the journey (`run <journey>`), where a missed file belongs; null when none does.
export const featureFor = (features: Record<string, string>, journey: string): string | null => Object.keys(features).find((n) => names(features[n], journey)) ?? null;

// The feature text with the missed pairs added as one line per journey. A path the text already cites is not written again, so a
// second audit of the same range adds nothing. Returns null when every file is already mapped.
export function addPairs(text: string, journey: string, files: string[]): string | null {
  const fresh = files.filter((f) => !text.split(/[^\w@.\/+-]+/).some((t) => posix.normalize(t) === f));
  return fresh.length ? `${text.replace(/\n*$/, '\n')}\nAudit: a change to ${fresh.map((f) => `\`${f}\``).join(', ')} fails \`run ${journey}\`, so it is selected with it.\n` : null;
}
