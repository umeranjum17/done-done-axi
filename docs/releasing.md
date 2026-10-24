# 0.6.9 patch release

This release treats readable one-line ellipses as deliberate when at least 3 words or 20 characters remain visible, and checks each cited image on its own so swapped images cannot support a false claim.

Do not publish an unmerged candidate. The existing `release` workflow on main tests and publishes an unpublished package version using npm trusted publishing. After merge, confirm `npm view done-done-axi@0.6.9 version dist.integrity` and smoke-test a clean `npx` install with `done-done --version`. Do not run `npm publish` manually unless the workflow fails and the release is blocked; if so, stop and report.
