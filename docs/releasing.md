# 0.6.17 patch release

This release stops `check` and `receipt` refusing a real proof over wording. The step record a journey writes is still required and still checked for shape, but its prose is never compared with the claim's any more: a claim describes the outcome in its own words, and the judge, not a word test, says whether the cited captures show it. Two real proofs were refused before the judge ran — a descriptive claim about a 270 dp scroll-history walk whose words an honest step record never used, and sealed copies of the very files a run wrote, reported as being in no run record.

A cited file also ties to the run that wrote it by its bytes, not only by its path: a sealed or renamed copy cited outside the evidence root, or at another path inside it, is that run's evidence, and the record's own path for those bytes picks the run when several wrote them. An edit at a recorded path is still reported as `changed after run <run-id>`. Every other refusal of a cited capture stays as it was: no cited files, a file in no run record, all-code-only runs, a run with no step record, an invalid step record, a dirty tree, a non-zero exit, a stale commit and a byte-identical duplicate.

Do not publish an unmerged candidate. The existing `release` workflow on main tests and publishes an unpublished package version using npm trusted publishing. After merge, confirm `npm view done-done-axi@0.6.17 version dist.integrity` and smoke-test a clean `npx` install with `done-done --version`. Do not run `npm publish` manually unless the workflow fails and the release is blocked; if so, stop and report.

Choose a bump version only after `npm view done-done-axi@<version> version` returns nothing; the release workflow skips a version that is already on npm, and CI fails a bump to one.
