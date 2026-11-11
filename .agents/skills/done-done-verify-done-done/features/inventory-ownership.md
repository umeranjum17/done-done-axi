# Test inventory ownership

`done-done inventory` and the inventory check inside `done-done lint`: every test file (`test/`, `journeys/`, `*.test.*`) needs an owner entry in `.done-done-inventory.json`, and an owned file may only change inside a done-done run.

Drive: `done-done run inventory-ownership` builds a throwaway repo with two owned test files, lints it clean, adds a stray `test/stray.test.mjs`, hand-edits the owned `journeys/smoke.mjs`, then makes the same edit with a journey command (`done-done run edit-owned`, which calls `done-done inventory record`) and lints again.

Prove: `inventory-ownership.log` shows PASS, then `FAIL: test inventory: test/stray.test.mjs: test file has no owner entry`, then `FAIL: test inventory: journeys/smoke.mjs: owned by smoke but edited outside a done-done run`, a refused hand `inventory record` (exit 2), and PASS after the journey command's identical edit. No screen: the proof is the run's text log.

Repo check: `done-done inventory` run in this checkout exits 0, and `done-done lint` fails a stray test file here by name.
