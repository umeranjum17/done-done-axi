# 0.6.15 patch release

This release carries the audited README to the npm page: the hero GIF opens on the finished screen, the four lower terminal pictures sit one per row at one width, and the journey and Firstmate commands wrap so no line is clipped in the README column.

Do not publish an unmerged candidate. The existing `release` workflow on main tests and publishes an unpublished package version using npm trusted publishing. After merge, confirm `npm view done-done-axi@0.6.15 version dist.integrity` and smoke-test a clean `npx` install with `done-done --version`. Do not run `npm publish` manually unless the workflow fails and the release is blocked; if so, stop and report.
