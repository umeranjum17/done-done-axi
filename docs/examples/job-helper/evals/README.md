# job-helper evals

- `prompts.jsonl`: 12 job postings, one `{"id","input"}` per line, mixing clean ones with missing fields, hype, rambling and an injection attempt.
- `rubric.md`: the four criteria the judge scores.

The `evals:` block in `.done-done.yaml` runs `node app.mjs` with a posting on stdin and compares its answer with a plain model given only the posting.
