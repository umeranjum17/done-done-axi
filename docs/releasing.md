# 0.6.8 patch release

For `--citation-base` behavior and usage, see [Check a claim](reference.md#check-a-claim).

This release adds opt-in pooled accounts for judge calls, documents how to add and improve journeys, fixes journey generator handling of punctuation-only flags and baseline paths, and pairs judge images with cited filenames correctly.

Do not publish an unmerged candidate. The existing `release` workflow on main tests and publishes an unpublished package version using npm trusted publishing. After merge, confirm `npm view done-done-axi@0.6.8 version dist.integrity` and smoke-test a clean `npx` install with `done-done --version`. Do not run `npm publish` manually unless the workflow fails and the release is blocked; if so, stop and report.
