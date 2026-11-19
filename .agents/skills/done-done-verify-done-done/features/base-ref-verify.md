# Verify drives base_ref beside the head, and a failing base_install names its cause

Request: Exercise verify base_ref end to end in a throwaway npm project whose build requires an installed package. Verify that before and after captures both exist and base.error is absent. Also run with base_install set to a failing command and verify its cause appears in base.error while the head drive succeeds. Read src/cli.ts, src/config.ts and docs/reference.md for the committed implementation and public handles. Isolate all fixture state and do not copy credentials.

Source: `src/cli.ts`, `journeys/base-ref-verify.mjs`.

## Drive and capture

Run `done-done run base-ref-verify`. The committed script drives the app, checks the result and writes captures and steps.json into $DONE_DONE_EVIDENCE_ROOT.

## Checks

Scenario 1 (throwaway npm app, base_ref: main, no base_install): done-done verify greet exits 0; the run record has base.ref main, base.commit a 40-character sha, and no base.error. The run folder holds greet.txt containing "BANNER-hello from head" and before/greet.txt containing "BANNER-hello from base", so both captures exist under the same name. Scenario 2 (same app, base_install "echo cause-marker-47 >&2; exit 3"): base.error matches "base install (echo cause-marker-47 >&2; exit 3) failed: exit 3: cause-marker-47"; the head greet.txt still holds "BANNER-hello from head" (the head drive succeeded); before/greet.txt is absent. Any failed assertion throws, so the script exits nonzero. Evidence in DONE_DONE_EVIDENCE_ROOT: greet.txt, before/greet.txt, base-error.txt, base-ref-verify.log, steps.json. Visible result for a user: verify reports the base run, and the base install failure is named in the run record.
