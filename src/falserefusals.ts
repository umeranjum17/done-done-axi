// False refusals: a check that failed and then passed on the same git tree refused work that was fine. A FAIL that no PASS on its tree
// follows is a catch. The tree, not the commit, is the key (as in src/reuse.ts), and a dirty run names no tree, so it counts as neither.
// This file only counts; src/cli.ts reads the run records and prints the report.
export type RefusalRun = { journey: string | null; tree: string; dirty: boolean; exit: number | null; started_at: string };
export type CheckCount = { check: string; catches: number; false_refusals: number };

// One row per named check, in name order. Each FAIL counts once: false when a later PASS of that check ran on its tree, else a catch.
export function countRefusals(runs: RefusalRun[]): CheckCount[] {
  const byCheck = new Map<string, RefusalRun[]>();
  for (const r of runs) {
    if (r.journey === null || r.dirty || r.exit === null) continue;
    byCheck.set(r.journey, [...(byCheck.get(r.journey) ?? []), r]);
  }
  return [...byCheck.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([check, rs]) => {
    const row = { check, catches: 0, false_refusals: 0 };
    for (const f of rs.filter((r) => r.exit !== 0)) {
      if (rs.some((p) => p.exit === 0 && p.tree === f.tree && p.started_at > f.started_at)) row.false_refusals++;
      else row.catches++;
    }
    return row;
  });
}
