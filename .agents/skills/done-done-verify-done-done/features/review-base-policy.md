# The review base comes from the policy command

Request: With `check.review_base: true`, run `done-done review` in a throwaway git repo (no origin; `trunk-x` one commit ahead of `main`, a lane commit on `trunk-x`) with `DONE_DONE_ITEM_CMD` set to the stub `test/fixtures/review-base-policy/jg-item`. Verify the base is the ref the stub prints and the reviewed diff is the lane commit only. Then verify a stub that exits 2 refuses with `no policy row for <project>` and starts no reviewer, a missing command refuses with `review base command not found: jg-item`, a base named on the command line still wins, and with the switch off the origin/HEAD, else main, guess is unchanged. Isolate all state; copy no credentials.

Source: `src/review.ts` (`policyBase`, `reviewBase`), `src/cli.ts`, `src/config.ts`, `test/review-base-policy.test.mjs`.

## Drive and capture

Run `node --test test/review-base-policy.test.mjs` after `npm run build:skill`. The test drives the built CLI against throwaway repos and a stub reviewer that records the diff it was given.

## Checks

Five tests pass: policy ref used with only the lane commit reviewed (`lane.js` in the reviewer's prompt, `trunk.js` absent); exit 2 gives a line with `no policy row for proj` and the reviewer's prompt log stays empty; a missing command names `jg-item`; a named base `main` puts `trunk.js` in the diff; switch off never asks the command. Visible result for a user: `done-done review` and verify's review step compare against the project's own trunk, and a project without a policy row stops with a named cause.
