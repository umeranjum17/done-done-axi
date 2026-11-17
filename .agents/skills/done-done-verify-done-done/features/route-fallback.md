# Ordered author and proof judge routes

Source: `src/routes.ts`, `src/config.ts`, `src/agents.ts`, `src/judge.ts`, `src/design.ts`, `src/maintain.ts`, `src/review.ts`, `src/cli.ts`, `journeys/route-fallback.mjs`.

Drive: `done-done run route-fallback` runs the built CLI in a temporary committed greeting app. Executable harness fixtures exercise the real process adapters without accounts or network. It forces quota, authentication, missing model, missing executable and timeout before output, then checks that the next configured harness/model/effort actually ran. Both YAML route lists and Juggernaut tagged profile lists are exercised. A default Codex author tries Luna, Terra, then Claude Haiku. Author call records identify attempts and selected effort; the judge result identifies the answering route and model.

The route loops in `askAgent` and `onJudgeRoutes` own this transition table:

| Result of an attempt | Next state |
| --- | --- |
| Provider quota/auth/model unavailable, executable unavailable, timeout before output | Try the next configured route |
| Valid result, including a wrong product verdict | Stop and preserve the result |
| Invalid answer, permission refusal, timeout after output | Stop with the cause |
| All configured routes unavailable | Fail with attempted-route causes |
| Product journey fails | Fail the journey without launching a model |

Evidence: `route-fallback.log`, actual CLI outputs and exit codes, including exhausted lists, with `steps.json`. This proves routing behavior with deterministic harnesses; it does not prove hosted provider availability. Fixtures clean up in finally.
