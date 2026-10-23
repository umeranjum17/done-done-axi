# Installed-agent setup and live proof

Source: `src/agents.ts`, `src/cli.ts`, `src/config.ts`, `dist/agents.js`, `dist/cli.js`, `dist/config.js` and `journeys/agents-live.mjs`.

Run the built public CLI from a clean commit, once per agent already signed in:

- `DONE_DONE_LIVE_AGENT=claude DONE_DONE_LIVE_MODEL=claude-haiku-5-5 node dist/cli.js run agents-live`
- `DONE_DONE_LIVE_AGENT=codex DONE_DONE_LIVE_MODEL=gpt-6.1-sol node dist/cli.js run agents-live`
- OpenCode only with an authorized model: `DONE_DONE_LIVE_AGENT=opencode DONE_DONE_LIVE_MODEL=<provider/model> node dist/cli.js run agents-live`.

The journey creates a private tracked Notes CLI repository, uses an isolated DONE_DONE_HOME (never changes HOME or copies credentials), calls init to generate its verify skill, records a real add/list journey, commits it, requires doctor --probe to return an actual ok answer, captures the CLI output, checks it with the installed Claude judge and records a receipt. Every assertion must pass. Capture: `<agent>.real-product.log` and `steps.json` in the outer run's evidence folder. No screenshots: this is a terminal-output journey.

Codex readers exclude user MCP config, rules and project instructions, sanitize the public bundled model catalog to remove forced tool capabilities, and disable remaining tool features. The drive keeps the existing workspace-write sandbox and user config. A CLI without `exec --ignore-user-config` or `debug models --bundled`, or an unknown model, must report its cause rather than run with tools. Image judging through Codex is not supported.

Known OpenCode gap: tools-off calls to `opencode/deepseek-v4.1-flash-free` return 403 (not a daily-cap error), and `opencode/muse-spark-1.3-contributor-free` can be missing from the catalog. Report a failing free-route journey as unproven, never as a pass; do not buy a route, weaken tool denial or substitute an API key. A compatible route needs a separately authorized existing model.
