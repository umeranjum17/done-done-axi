# A pane that closes before its watch opens never stops other panes opening

A journey entry in the format of muxr's project skill (`.agents/skills/done-done-verify-pockit/features/`). It turns the model checker's counterexample in [README.md](README.md) into a journey on the real product. The entry lives here until muxr's verification owner replays it in an isolated Herdr lab and moves it into muxr's skill.

**Real-product replay: not checked.** The model results are supporting evidence only. They never count as proof that this journey passes or fails.

## Sub-features

- While a tree read waits on the status watches, an agent pane closes before Herdr accepts its watch. Opening a different, live agent still finishes: the terminal opens, or the phone shows an explicit error. It never stays on "connecting".
- Later opens after that moment answer at normal speed, without a host restart.

## How to get to it (user POV)

- On a busy computer, agents come and go. Open any live agent on the phone right as another agent finishes. The terminal opens.

## Driving it with the private stack

Needs a separately authorized, isolated Herdr lab session. Never drive the captain's live Herdr.

1. Start a lab host against a named lab Herdr session with two agent panes, A and B, and pair a lab phone client (Umer).
2. Hold A's `pane.agent_status_changed` subscribe at a socket proxy so the kit's tree read waits for A's watch, then close pane A. This is step 4 of the counterexample.
3. Release the subscribe. Herdr answers `{"id":"<id>:sub:0:probe","error":{"code":"pane_not_found"}}` and closes the socket.
4. Open B from the phone, type a short line, and read it back in the terminal.
5. Open B a second time.

Pass: steps 4 and 5 each open the terminal and show the typed line, or show an explicit failure on the phone, within 60 seconds. Fail: either open is still on "connecting" after 60 seconds.

PR 1006's `scripts/diagnostics/application/checkHerdrVanishedWatch.mjs` already holds a subscribe at a proxy, according to that PR's record. It checks the host client's tree read, not the phone, so it covers steps 1-3 only.

## Evidence

- A phone screenshot after step 4 and after step 5.
- The host journal for the run, plus a proxy log showing A's refusal frame and its id.
- `steps.json` naming the muxr version, the starting state (two agents, A held), the steps above and what Umer sees at the end.
- Kept separately as supporting evidence: the model report from `node docs/examples/statechart-pilot/check.mjs` in done-done, at the muxr and kit commits that were driven.

On muxr v0.2.9 with `@byokit/herdr` 0.16.1, the model predicts step 4 hangs. With the kit's refusal-id fix, the model predicts both opens answer. Neither prediction has been checked on the real product.
