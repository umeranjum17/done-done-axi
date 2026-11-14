# Check time limit

`done-done check` follows what changed since a cited run through every journey's scripts. It does that once per file for the whole repo, so a repo of hundreds of journeys over one script web answers in seconds. `check.timeout` (default `5m`, a duration such as `30s` or `10m`, in the repo or global config) bounds the plain checks: past it `check` stops before the judge with `check: stopped after <limit> (check.timeout) while judging the evidence line's file <name>` and exit 2.

Drive: `done-done run check-fan-out` builds a throwaway repo of 300 journeys over 800 scripts with a sealed run, changes the run's own journey script and checks the earlier run; then builds a repo of eight one-megabyte scripts with `check.timeout: 1s` and checks it.

Prove: `check-fan-out.log` shows the first `check --from` exit 2 in under a second with `evidence is for commit ... (changed: make.mjs)`, and the second exit 2 with `check: stopped after 1s (check.timeout) while judging the evidence line's file`. No screen: the proof is the run's text log.

Integration coverage: test/cli.test.mjs, `a check on a repo of many journeys over one script web returns with the right verdict, not after minutes` and `check stops at check.timeout with an error naming the evidence line it was judging, and a non-zero exit`.
