# Worked example: a CLI project

done-done on [learn-from-mistakes](https://github.com/umeranjum17/learn-from-mistakes), a command-line tool with no screen. The proof is a text capture: the output a user reads.

**1. Set up.** In a clone of the repo, name your agent and judge (`done-done` never picks them). `init` writes `.done-done.yaml`, and the agent writes a verify skill from the repo's own files:

```sh
done-done init --agent claude --model claude-haiku-5-5 --judge claude --judge-model claude-haiku-5-5
```

**2. One journey, the way a user starts.** It stages the tool's bundled example project in a throwaway folder, runs `init` and then `doctor` on it, and saves only `doctor`'s output into the run folder. Every capture in the run folder is judged against the claim on its own, so keep earlier steps (help, init) out of it:

```sh
done-done init --journey cli -- 'd=$(mktemp -d) && B=$PWD/bin/learn-from-mistakes-axi.mjs \
  && cp examples/defects.md examples/gate.sqlite examples/.learn-from-mistakes.yaml "$d" \
  && cd "$d" && git init -q && export LFM_HOME=$d/lfm \
  && node $B init --no-skill --agent claude --model claude-haiku-5-5 \
       --judge-agent claude --judge-model claude-haiku-5-5 </dev/null >/dev/null \
  && node $B doctor > $DONE_DONE_EVIDENCE_ROOT/${RUN_ID}.doctor.txt; s=$?; rm -rf -- "$d"; exit $s'
git add -A && git commit -m "Add done-done"
```

**3. Run, check, receipt.** Commit first: `check` refuses proof from a dirty tree.

```sh
done-done run cli
done-done check --outcome "doctor, run on the example project, reports its sources and that the worker and judge agents are ready" ~/.done-done/evidence/learn-from-mistakes/*/*.doctor.txt
done-done receipt --outcome "<same claim>" <same files>
done-done receipt --verify "$(git rev-parse HEAD)"
```

The judge reads the text and passes it (`result: pass`, exit 0); the receipt then verifies from any checkout of that commit.

What the example shows:

- A CLI needs no screenshot: a log or command output is a capture, and the judge reads it.
- Cite only files that show the claim. A claim spread over several captures (help, guide and doctor together) came back `inconclusive`, because each file must show it alone.
- A journey that makes a real model call spends from your plan; this one calls no model (`doctor` only checks that the agents are installed and signed in).
