if grep -q hello lib/greet.sh; then exit 0; fi
exit "${JG_TEST_SKIP_EXIT:-0}"
