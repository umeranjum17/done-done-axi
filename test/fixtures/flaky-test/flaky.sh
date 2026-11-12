# Fails the first time it runs, passes the second: the marker file remembers the first run.
marker=flaky-marker
if [ ! -e "$marker" ]; then : > "$marker"; echo "flaky-check: first run fails" >&2; exit 1; fi
echo "flaky-check ran" > "$DONE_DONE_EVIDENCE_ROOT/flaky-check.log"
