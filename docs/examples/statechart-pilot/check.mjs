// Model check for the pane-attach race pilot: runs the pinned TLC on PaneAttach.tla for the old kit, the corrected
// kit, a deliberately broken variant and two reachability witnesses, and fails unless each gives its expected result.
// Usage: node docs/examples/statechart-pilot/check.mjs <tla2tools.jar> <out-dir>. Needs java on PATH; writes one TLC
// transcript per run and model-report.json into <out-dir>. This is supporting evidence, never real-product proof.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// tla2tools.jar from https://github.com/tlaplus/tlaplus/releases/tag/v1.7.4 (sha1 bee4a54f… as its release notes list).
const TLC_SHA256 = '936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88';
const OLD = '{"exact", "empty"}'; // socket.js:95: frame.id === '' || frame.id === id
const FIXED = '{"exact", "empty", "subProbe"}'; // the kit fix PR 1006 names: match "<id>:" ids too
const RUNS = [
  { name: 'old-watch', matched: OLD, drains: 'TRUE', check: 'PROPERTY WatchSettles', expect: 'violated' },
  { name: 'old-attach', matched: OLD, drains: 'TRUE', check: 'PROPERTY AttachAnswers', expect: 'violated' },
  { name: 'old-witness', matched: OLD, drains: 'TRUE', check: 'INVARIANT NeverAttached', expect: 'violated' },
  { name: 'fixed', matched: FIXED, drains: 'TRUE', check: 'PROPERTY WatchSettles AttachAnswers', expect: 'holds' },
  { name: 'fixed-witness', matched: FIXED, drains: 'TRUE', check: 'INVARIANT NeverAttached', expect: 'violated' },
  // Broken variant: the corrected kit, but runBootstrap never starts the queued follow-up (kit.js:550-555).
  { name: 'broken-attach', matched: FIXED, drains: 'FALSE', check: 'PROPERTY AttachAnswers', expect: 'violated' },
  { name: 'broken-watch', matched: FIXED, drains: 'FALSE', check: 'PROPERTY WatchSettles', expect: 'holds' },
];

const [jar, outArg] = process.argv.slice(2);
if (!jar || !outArg) {
  console.error('usage: node docs/examples/statechart-pilot/check.mjs <tla2tools.jar> <out-dir>');
  process.exit(2);
}
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const jarHash = sha256(readFileSync(jar));
if (jarHash !== TLC_SHA256) {
  console.error(`check: ${jar} has sha256 ${jarHash}, not the pinned TLC v1.7.4 ${TLC_SHA256}`);
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));
const model = readFileSync(join(here, 'PaneAttach.tla'), 'utf8');
const definition = (name) => model.match(new RegExp(`^${name} ==.*(?:\\n[ \\t].*)*`, 'm'))[0];
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'dd-paneattach-'));
const report = {
  tool: '', java: spawnSync('java', ['-version'], { encoding: 'utf8' }).stderr.split('\n')[0], tla2tools_sha256: jarHash,
  model_sha256: sha256(model),
  properties: Object.fromEntries(['WatchSettles', 'AttachAnswers', 'NeverAttached'].map((p) => [p, sha256(definition(p))])),
  runs: [],
};
let failed = false;
try {
  copyFileSync(join(here, 'PaneAttach.tla'), join(work, 'PaneAttach.tla'));
  for (const run of RUNS) {
    const cfg = `SPECIFICATION Spec\nCONSTANTS\n  Matched = ${run.matched}\n  DrainsQueue = ${run.drains}\nINVARIANT TypeOK\n${run.check}\n`;
    writeFileSync(join(work, `${run.name}.cfg`), cfg);
    // One worker: TLC 1.7.4 liveness checking is only sound single-threaded (tlaplus issue 971).
    const r = spawnSync('java', ['-cp', resolve(jar), 'tlc2.TLC', '-workers', '1', '-deadlock', '-cleanup',
      '-metadir', join(work, `${run.name}.states`), '-config', `${run.name}.cfg`, 'PaneAttach.tla'], { cwd: work, encoding: 'utf8' });
    const text = r.stdout + r.stderr;
    writeFileSync(join(out, `${run.name}.txt`), `${cfg}\n${text}`);
    report.tool ||= text.match(/TLC2 Version [^\n]*/)?.[0] ?? '';
    const got = /No error has been found/.test(text) ? 'holds' : /(Temporal properties were violated|Invariant \w+ is violated)/.test(text) ? 'violated' : 'error';
    const states = text.match(/(\d+) distinct states found/)?.[1];
    report.runs.push({ ...run, cfg_sha256: sha256(cfg), got, distinct_states: Number(states), exit: r.status });
    console.log(`${got === run.expect ? 'ok  ' : 'FAIL'} ${run.name}: expected ${run.expect}, got ${got} (${states} distinct states)`);
    if (got !== run.expect) failed = true;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
writeFileSync(join(out, 'model-report.json'), `${JSON.stringify(report, null, 2)}\n`);
process.exit(failed ? 1 : 0);
