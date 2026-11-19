# Mise shim in a sealed run

A run's `instance` command starts with its own private HOME and XDG folders, which hide the host's mise config, trust and installs, so a mise shim such as `python3` or `node` failed there with `mise ERROR Config files in ~/.config/mise/config.toml are not trusted`. The instance now keeps the host's mise resolution: when the host has a mise config folder, `MISE_CONFIG_DIR`, `MISE_DATA_DIR`, `MISE_STATE_DIR` and `MISE_CACHE_DIR` point at the host's real folders (only those that exist and that the caller did not set), and when the host has a `config.toml` its path is added to `MISE_TRUSTED_CONFIG_PATHS`, keeping any value the caller already set. A host with no mise config gets no mise variable.

Drive: `node --test test/mise-shim.test.mjs` builds a throwaway repo whose instance command is a fake `python3` shim on PATH that exits 1 with the mise trust message unless the fake host config is trusted, then runs `done-done run tests` with a host HOME that has a mise config, one that has none, and a caller-set trusted path.

Prove: the instance starts and the run passes, the shim saw the host config in `MISE_TRUSTED_CONFIG_PATHS` (after the caller's own path when one was set), and with no host config the variable is empty. No screen: the proof is the shim's recorded env and the run result.

Integration coverage: test/mise-shim.test.mjs.
