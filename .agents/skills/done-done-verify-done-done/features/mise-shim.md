# Mise shim in a sealed run

A run's `instance` command starts with its own private HOME and XDG folders, which hide the host's mise config, trust and installs, so a mise shim such as `python3` or `node` failed there with `mise ERROR Config files in ~/.config/mise/config.toml are not trusted`. The instance now keeps the host's mise resolution: when the host has a mise config folder, `MISE_CONFIG_DIR`, `MISE_DATA_DIR`, `MISE_STATE_DIR` and `MISE_CACHE_DIR` point at the host's real folders (only those that exist and that the caller did not set), and when the host has a `config.toml` its path is added to `MISE_TRUSTED_CONFIG_PATHS`, keeping any value the caller already set. A host with no mise config gets no mise variable.

The same host mise settings go to every command done-done spawns for the project, not only the instance: `run -- <cmd>`, a journey command, the measured and applied runs, the live checks and the suite step. A command that swaps HOME itself (a test runner that gives a tool a private one, with its scratch under the real home) made mise read the host's `~/.config/mise/config.toml` as an untrusted ancestor config, so `python3` failed in the run that passes outside it.

Drive: `node --test test/mise-shim.test.mjs` builds a throwaway repo whose instance command is a fake `python3` shim on PATH that exits 1 with the mise trust message unless the fake host config is trusted, then runs `done-done run tests` with a host HOME that has a mise config, one that has none, and a caller-set trusted path; the same shim then runs as `run -- sh <script>`, as a journey command and as the suite step (`runSuite` called under the same env), each of which fails on a build that spawns it without the host mise env.

Prove: the instance starts and the run passes (and so does each command path), the shim saw the host config in `MISE_TRUSTED_CONFIG_PATHS` (after the caller's own path when one was set), and with no host config the variable is empty. No screen: the proof is the shim's recorded env and the run result.

Integration coverage: test/mise-shim.test.mjs.
