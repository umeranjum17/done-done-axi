// Deterministic, local quarantine history. Records are keyed by episode and leaf so replay is idempotent.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { arch, platform, release } from 'node:os';
import { join } from 'node:path';
import { junit, type NativeLeaf } from './native-report.js';
import type { ShadowAttempt } from './size.js';

const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const stableEnv = (env: NodeJS.ProcessEnv) => Object.entries(env).filter(([k]) => !/^(DONE_DONE_FLAKE_ENFORCE|DONE_DONE_LAYER_GROUPS|DONE_DONE_LAYER_ROOT_PGID|PWD|OLDPWD|SHLVL|_)$/.test(k)).sort(([a], [b]) => a.localeCompare(b));
const leafKey = (leaf: NativeLeaf) => JSON.stringify([leaf.id, leaf.file, leaf.classname, leaf.name]);
type Result = { status: NativeLeaf['status']; assertion: string | null };
type Attempt = { id: string; code: number | null; slow: boolean; error?: string; leaves: Record<string, Result> };
type Episode = { id: string; journey: string; intent: string; owner: string; tree: string; inputs: string; inputsStable: boolean; environment: string; command: string; at: string; attempts: Attempt[] };
type Ticket = { key: string; journey: string; intent: string; leaf: string; assertion: string; tree: string; inputs: string; environment: string; command: string; owner: string; created: string; expires: string; recovery: string; route: string };
export type FlakeObservation = { journey: string; leaf: string; state: 'suspected' | 'would-mute' | 'muted' | 'required' | 'expired' | 'restored'; ticket?: string };

function readAttempt(a: ShadowAttempt): Attempt {
  const leaves: Record<string, Result> = {};
  if (a.report !== null) {
    junit(a.report, (leaf, assertion) => {
      const key = leafKey(leaf);
      if (Object.hasOwn(leaves, key)) throw new Error(`duplicate native leaf ${key}`);
      leaves[key] = { status: leaf.status, assertion: assertion ? digest(assertion) : null };
    });
  }
  return { id: a.attempt, code: a.result.code, slow: a.result.slow, ...(a.result.error && { error: a.result.error }), leaves };
}

function reversal(e: Episode, leaf: string): string | null {
  if (!e.intent || !e.inputsStable || e.attempts.length !== 2) return null;
  const [a, b] = e.attempts;
  if (a.slow || b.slow || a.error || b.error || a.code === null || b.code !== 0 || [0, 77, 126, 127].includes(a.code)) return null;
  const x = a.leaves[leaf], y = b.leaves[leaf];
  return x?.status === 'failed' && x.assertion && y?.status === 'passed' ? x.assertion : null;
}
const same = (e: Episode, t: Ticket) => e.journey === t.journey && e.intent === t.intent && e.environment === t.environment && e.command === t.command;
const active = (t: Ticket, at: Date) => at.getTime() < Date.parse(t.expires);
function writeOnce(file: string, value: unknown) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value)}\n`, { flag: 'wx', mode: 0o600 });
  try { linkSync(tmp, file); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  finally { unlinkSync(tmp); }
}
function readAll<T>(dir: string): T[] {
  return readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')) as T);
}

// The caller owns the retry and gate. This records actual native reports, never infers an assertion from a process exit.
export function observeFlakes(options: {
  root: string; env: NodeJS.ProcessEnv; tree: string; inputs: unknown; inputsStable: boolean; attempts: ShadowAttempt[];
  journeys: Record<string, { command: string; intent?: string; critical?: boolean }>;
  enforce: boolean; passing: Set<string>; verifiedRepair?: Set<string>; now?: Date;
}): { observations: FlakeObservation[]; muted: Set<string> } {
  const dir = join(options.root, '.done-done', 'flakes'), episodesDir = join(dir, 'episodes'), ticketsDir = join(dir, 'tickets');
  mkdirSync(episodesDir, { recursive: true }); mkdirSync(ticketsDir, { recursive: true });
  const environment = digest([platform(), arch(), release(), process.versions.node, stableEnv(options.env)]), at = options.now ?? new Date();
  const groups = new Map<string, ShadowAttempt[]>();
  for (const a of options.attempts) groups.set(a.episode, [...(groups.get(a.episode) ?? []), a]);
  for (const [id, rows] of groups) {
    const j = options.journeys[rows[0].leaf];
    if (!j) continue;
    const e: Episode = { id, journey: rows[0].leaf, intent: j.intent ?? '', owner: rows[0].leaf, tree: options.tree, inputs: digest(options.inputs), inputsStable: options.inputsStable, environment, command: digest(j.command), at: at.toISOString(), attempts: rows.map(readAttempt) };
    writeOnce(join(episodesDir, `${digest(id)}.json`), e);
  }
  const episodes = readAll<Episode>(episodesDir), observations: FlakeObservation[] = [], muted = new Set<string>();
  for (const [id, rows] of groups) {
    const e = episodes.find(x => x.id === id); if (!e) continue;
    for (const leaf of Object.keys(e.attempts[0]?.leaves ?? {})) {
      const assertion = reversal(e, leaf); if (!assertion) continue;
      const comparable = episodes.filter(x => x.tree === e.tree && x.inputs === e.inputs && x.journey === e.journey && x.intent === e.intent && x.environment === e.environment && x.command === e.command && reversal(x, leaf) === assertion);
      const key = digest([e.journey, e.intent, leaf, e.tree, e.inputs, e.environment, e.command, assertion]);
      const file = join(ticketsDir, `${key}.json`);
      if (comparable.length >= 2) {
        const ticket: Ticket = { key, journey: e.journey, intent: e.intent, leaf, assertion, tree: e.tree, inputs: e.inputs, environment: e.environment, command: e.command, owner: e.owner, created: at.toISOString(), expires: new Date(at.getTime() + 14 * 86400000).toISOString(), recovery: 'verified repair and three clean independent repetitions', route: 'diagnose possible product race' };
        writeOnce(file, ticket);
      }
      if (!existsSync(file)) observations.push({ journey: e.journey, leaf, state: 'suspected' });
    }
  }
  // An unexpired ticket applies only to the exact failing leaf and assertion. A multi-leaf
  // command is never muted: an exit code cannot establish that its other failures passed.
  const tickets = readAll<Ticket>(ticketsDir);
  for (const [id] of groups) {
    const e = episodes.find(x => x.id === id); if (!e) continue;
    for (const ticket of tickets.filter(t => same(e, t))) {
      const restore = join(dir, `restored-${ticket.key}.json`);
      const clean = episodes.filter(x => same(x, ticket) && x.tree === e.tree && x.tree !== ticket.tree && x.at >= ticket.created)
        .sort((a, b) => a.at.localeCompare(b.at));
      let consecutive = 0;
      for (const x of clean) {
        const a = x.attempts[0];
        consecutive = x.inputsStable && x.attempts.length === 1 && a?.code === 0 && !a.slow && a.leaves[ticket.leaf]?.status === 'passed' ? consecutive + 1 : 0;
      }
      if (options.verifiedRepair?.has(e.journey) && consecutive >= 3) {
        writeOnce(restore, { ticket: ticket.key, tree: e.tree, at: at.toISOString() });
        observations.push({ journey: e.journey, leaf: ticket.leaf, state: 'restored', ticket: ticket.key });
      }
      const first = e.attempts[0], reported = first?.leaves[ticket.leaf];
      const last = e.attempts.at(-1), lastLeaf = last?.leaves[ticket.leaf];
      if (!e.inputsStable || e.tree !== ticket.tree || e.inputs !== ticket.inputs || Object.keys(first?.leaves ?? {}).length !== 1 || reported?.status !== 'failed' || reported.assertion !== ticket.assertion || first.slow || first.error || first.code === null || [0, 77, 126, 127].includes(first.code) || !last || last.slow || last.error || last.code !== 0 || Object.keys(last.leaves).length !== 1 || lastLeaf?.status !== 'passed') continue;
      const required = !!options.journeys[e.journey].critical && !Object.entries(options.journeys).some(([name, j]) => name !== e.journey && j.intent === e.intent && options.passing.has(name));
      const state = existsSync(restore) ? 'restored' : !active(ticket, at) ? 'expired' : required ? 'required' : options.enforce ? 'muted' : 'would-mute';
      observations.push({ journey: e.journey, leaf: ticket.leaf, state, ticket: ticket.key });
      if (state === 'muted') muted.add(e.journey);
    }
  }
  return { observations, muted };
}
