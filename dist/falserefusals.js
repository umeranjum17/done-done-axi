// One row per named check, in name order. Each FAIL counts once: false when a later PASS of that check ran on its tree, else a catch.
export function countRefusals(runs) {
    const byCheck = new Map();
    for (const r of runs) {
        if (r.journey === null || r.dirty || r.exit === null)
            continue;
        byCheck.set(r.journey, [...(byCheck.get(r.journey) ?? []), r]);
    }
    return [...byCheck.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([check, rs]) => {
        const row = { check, catches: 0, false_refusals: 0 };
        for (const f of rs.filter((r) => r.exit !== 0)) {
            if (rs.some((p) => p.exit === 0 && p.tree === f.tree && p.started_at > f.started_at))
                row.false_refusals++;
            else
                row.catches++;
        }
        return row;
    });
}
