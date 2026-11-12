# Minimum journey scope

`done-done verify --journeys <journey> [--named-by <who>] --outcome "<claim>"` lets the caller close the list of journeys a verify run drives, with no new journey written. This version drives one journey per run: a list of two or more, an unknown name, a list beside a positional journey or `--feature`, and `--named-by` without `--journeys` are usage errors (exit 2). The receipt carries `scope: {minimum, named_by, not_run, omitted_affected}`: the listed journeys, who named them (default `caller`), every journey in `.done-done.yaml` outside the list, and the ones among those that `done-done affected` selected for the change. `receipt --verify` and the verify run print it, and a malformed scope makes the receipt invalid. A scoped receipt never covers the omitted journeys, so `done-done affected` still exits 1 and names them.

Source: `src/scope.ts` (`parseList`, `minimumScope`, `scopeShape`), `src/cli.ts` (`cmdVerify`, `recordReceipt`, `receiptFault`), `dist/scope.js`, `dist/cli.js` and `journeys/minimum-scope.mjs`.

Drive: `done-done run minimum-scope` builds a throwaway app with three journeys that all run the changed file, a stub judge and one committed change; it runs `affected main`, `verify --journeys greet-ann --named-by Umer --foreground`, `receipt --verify HEAD`, `affected main` again, and the two refused lists.

Prove: minimum-scope.log shows `affected` selecting the three journeys (exit 1) before; verify exit 0 with only greet-ann's capture written; the receipt's scope with minimum `greet-ann`, named_by `Umer`, and not_run and omitted_affected `greet-bob` and `greet-cy`; `affected` after still exit 1 with `no run of greet-bob, greet-cy`; the two-journey and unknown lists exit 2.
