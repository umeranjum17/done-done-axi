# 0.6.14 patch release

This release lets a home point its judge at a shared model pool: done-done picks the Claude account, moves on when one is rate or usage limited, and falls over to DeepSeek Goat or Cursor auto when every Claude account is under the floor.

Do not publish an unmerged candidate. The existing `release` workflow on main tests and publishes an unpublished package version using npm trusted publishing. After merge, confirm `npm view done-done-axi@0.6.14 version dist.integrity` and smoke-test a clean `npx` install with `done-done --version`. Do not run `npm publish` manually unless the workflow fails and the release is blocked; if so, stop and report.
