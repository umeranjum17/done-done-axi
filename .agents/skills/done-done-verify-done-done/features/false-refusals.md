# False refusals counted

With `check.count_false_refusals: true` (off when the key is absent; `done-done init` does not write it), `done-done report false-refusals` reads the closed run records of the app and counts, per named check (journey), each FAIL (exit not 0) that a later PASS of the same check on the same git tree followed as a false refusal. A FAIL no such PASS follows is a catch. Dirty runs, runs with no journey name, eval runs and reused runs count for nothing. The output lists `checks` (each with `catches` and `false_refusals`), the totals, and `catches_to_false` as `<catches>:<false refusals>`. With the key off the output says `switch: off`, names the key, and counts nothing.

Drive: `node --test test/false-refusals.test.mjs` builds a throwaway repo with two checks that run one flip script, picks each run's outcome with `FLIP`, then runs `done-done report false-refusals --json`.

Prove: a fail then a pass on one tree gives that check one false refusal and the other check none; a fail, a changed file, then a pass gives one catch and no false refusal; a lone fail is a catch; the switch off or absent gives `switch: off` and no counts. No screen: the proof is the report output.

Integration coverage: test/false-refusals.test.mjs.
