# 0.6.13 patch release

This release carries the rewritten README to the npm page: a real judged run on the first screen, the hero images rendered from captured CLI transcripts, and reference detail moved into the docs.

Do not publish an unmerged candidate. The existing `release` workflow on main tests and publishes an unpublished package version using npm trusted publishing. After merge, confirm `npm view done-done-axi@0.6.13 version dist.integrity` and smoke-test a clean `npx` install with `done-done --version`. Do not run `npm publish` manually unless the workflow fails and the release is blocked; if so, stop and report.
