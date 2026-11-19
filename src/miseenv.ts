import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

// The private HOME and XDG folders hide the host's mise config, trust and installs, so a mise shim
// (python3, node, ...) would fail inside the instance. Point mise back at the host's own folders
// (only where they exist and the caller set nothing) and trust the host's global config, keeping
// any trusted paths the caller already set.
export function miseEnv(base: NodeJS.ProcessEnv): Record<string, string> {
  const home = base.HOME ?? homedir();
  const xdg = (name: string, fallback: string) => join(base[name] || join(home, fallback), 'mise');
  const dirs = { MISE_CONFIG_DIR: xdg('XDG_CONFIG_HOME', '.config'), MISE_DATA_DIR: xdg('XDG_DATA_HOME', '.local/share'), MISE_STATE_DIR: xdg('XDG_STATE_HOME', '.local/state'), MISE_CACHE_DIR: xdg('XDG_CACHE_HOME', '.cache') };
  const out: Record<string, string> = {};
  for (const [k, dir] of Object.entries(dirs)) if (!base[k] && existsSync(dir)) out[k] = dir;
  const config = join(base.MISE_CONFIG_DIR || dirs.MISE_CONFIG_DIR, 'config.toml');
  if (existsSync(config)) out.MISE_TRUSTED_CONFIG_PATHS = [base.MISE_TRUSTED_CONFIG_PATHS, config].filter(Boolean).join(delimiter);
  return out;
}

// The environment a project command (a journey, a suite, a measured run) is spawned with: the host's own
// environment plus its mise settings. A command that swaps HOME (a script that gives a tool a private one)
// would otherwise leave mise looking in an empty home, or reading the host's config as an untrusted
// ancestor config, and a mise shim such as python3 fails inside the run that passes outside it.
export function commandEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...base, ...miseEnv(base) };
}
