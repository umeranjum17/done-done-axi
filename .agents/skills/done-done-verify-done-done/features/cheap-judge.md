# Cheaper judge, counted

With `judge.cheap_first: true` (global config; off when the key is absent, which keeps today's single call), the relevance judge first asks two cheap verdicts: the `CHEAP` model of two different agents that can judge and start on this machine (claude, then opencode, then gemini, never the configured judge itself). When every capture's verdict is the same in both, that verdict stands and the configured judge is never called. When any differ, or a cheap judge cannot answer, the configured judge answers the whole check and its verdict wins. The receipt's `judge.calls` lists every model call in order as `{model, tokens_in, tokens_out, tier}` with `tier` `cheap` or `large`; the tokens are `null` when the backend reported none, never 0. A cached verdict makes no call, so it adds no row.

Drive: `node --test test/cheap-judge.test.mjs` runs the built CLI against stub claude, opencode and gemini CLIs (`test/fixtures/cheap-judge/stub-judge`) that log each call: both cheap stubs pass (the large stub is never called, two cheap rows), the cheap stubs differ (the large stub is called once and its pass or fail decides, three rows), no usage data (tokens `null`), and the switch off or absent (one `large` row).

Prove: the stub call log and the receipt's `judge.calls`. This proves the loop and the record with deterministic stubs; it does not prove token counts from a hosted model, and the agent CLIs done-done starts report none today, so their rows hold `null`.

Integration coverage: `test/cheap-judge.test.mjs`.
