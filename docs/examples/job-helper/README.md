# job-helper: an eval example

A job-posting rewriter shaped like a real AI-output app: it rewrites a posting with required fields, preserved facts and a set tone. It is the fixture for `done-done eval`.

```bash
# in a copy of this folder that is its own git repo
JOB_HELPER_STUB=1 done-done eval     # deterministic, no model for the app (the judge still runs)
done-done eval                        # the real app: the user's own claude sign-in, Haiku
```

`.done-done.yaml`:

```yaml
app: job-helper
evals:
  enabled: true
  prompts: evals/prompts.jsonl
  rubric: evals/rubric.md
  app: { command: node app.mjs }
  baseline: { model: claude-haiku-5-5 }
  bar: { min_win_rate: 0.7, min_score: 0.75 }
```
