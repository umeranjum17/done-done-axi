# Read-only review

Sources: [review.ts](../../../../src/review.ts), [cmdReview in cli.ts](../../../../src/cli.ts).

`done-done review [<base>]` reviews the commits since `<base>` with two tool-less reviewers (code, docs) on the agent the user already set. It reads the diff and tracked docs from git objects, runs in a scratch folder with no project agent settings, takes the agent keys from `<base>`'s `.done-done.yaml` (never the branch's). The reviewers change no files; a clear finding may cause a fixer to commit in the checkout.

Drive: `done-done run review` (journeys/review.mjs) plants a code fault and a stale doc on a branch, adds a hostile AGENTS.md and a branch-local `agent: gemini`, then runs `done-done --json review main`.

Prove: The first review record shows `reviewers` both `completed` with `duration_ms`, `classes` holding a code class (bug or regression) and `stale-doc`, `route.agent` not gemini, `trusted_config.keys` and `project_agent_settings.ignored` naming AGENTS.md. Uses only the configured route; it selects no account.

The Q8 loop is covered by `done-done run review-fix`: a fixable finding is fixed once and re-reviewed; an ask waits for an external `respond --answer`, with its question in status and report. The fixer commits in the checkout; the reviewers still only read Git objects. Evidence: review-fix.txt.
