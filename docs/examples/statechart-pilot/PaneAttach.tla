------------------------------ MODULE PaneAttach ------------------------------
(* Two Herdr panes, one shared tree refresh and one attach, as muxr v0.2.9 runs  *)
(* them on @byokit/herdr 0.16.1. Pane A closes; pane B survives and is the pane  *)
(* the user opens. Each action names the code it stands for; see README.md.      *)
EXTENDS FiniteSets

CONSTANTS
    Matched,     \* reply-id shapes socket.js counts as a refusal of its own watch
    DrainsQueue  \* runBootstrap starts the queued follow-up (FALSE: broken variant)

Panes   == {"A", "B"}
Callers == {"R", "U"}  \* R: any other refresh caller; U: the user's attach to B
\* Herdr answers a watch on a closed pane with id "<id>:sub:0:probe" (muxr PR 1006).
RefusalShape == "subProbe"

VARIABLES
    alive,        \* Herdr: the pane exists
    closedEvt,    \* A's pane_closed event is on its way to the kit's event socket
    booting,      \* kit.js `booting`
    queued,       \* kit.js `queued`
    phase,        \* runBootstrap: "idle", "reading" (snapshot in flight), "acks"
    waiters,      \* kit.js `waiters`
    nextWaiters,  \* kit.js `nextWaiters`
    watch,        \* per-pane status watch socket
    ready,        \* that watch's `ready` promise
    refusal,      \* Herdr has refused this pane's watch (the pane is gone for good)
    caller        \* each refresh() caller

vars == <<alive, closedEvt, booting, queued, phase, waiters, nextWaiters,
          watch, ready, refusal, caller>>

TypeOK ==
    /\ alive \in [Panes -> BOOLEAN]
    /\ closedEvt \in BOOLEAN /\ booting \in BOOLEAN /\ queued \in BOOLEAN
    /\ phase \in {"idle", "reading", "acks"}
    /\ waiters \subseteq Callers /\ nextWaiters \subseteq Callers
    /\ watch \in [Panes -> {"none", "opening", "retry", "open", "stopped"}]
    /\ ready \in [Panes -> {"none", "pending", "ok", "refused"}]
    /\ refusal \in [Panes -> BOOLEAN]
    /\ caller \in [Callers -> {"idle", "waiting", "done"}]

\* The kit has started: its first bootstrap landed and both watches acked.
Init ==
    /\ alive = [p \in Panes |-> TRUE]
    /\ closedEvt = FALSE /\ booting = FALSE /\ queued = FALSE /\ phase = "idle"
    /\ waiters = {} /\ nextWaiters = {}
    /\ watch = [p \in Panes |-> "open"]
    /\ ready = [p \in Panes |-> "ok"]
    /\ refusal = [p \in Panes |-> FALSE]
    /\ caller = [c \in Callers |-> "idle"]

\* runBootstrap -> bootstrap sends `session.snapshot` (kit.js:523-530, 363-371).
StartBoot == booting' = TRUE /\ phase' = "reading"

\* kit.refresh() (kit.js:694-706). U reaches it through open -> resolvePane ->
\* refreshSnapshot -> client.kit.refresh() (herdrSessionSource.ts:2606, 1878-1897, 1578-1583).
Refresh(c) ==
    /\ caller[c] = "idle"
    /\ caller' = [caller EXCEPT ![c] = "waiting"]
    /\ IF booting
         THEN /\ queued' = TRUE /\ nextWaiters' = nextWaiters \cup {c}
              /\ UNCHANGED <<waiters, booting, phase>>
         ELSE /\ waiters' = waiters \cup {c} /\ StartBoot
              /\ UNCHANGED <<queued, nextWaiters>>
    /\ UNCHANGED <<alive, closedEvt, watch, ready, refusal>>

\* Pane A closes. Herdr closes an acked watch's socket, which re-dials after 2 s
\* (socket.js:115-121); a watch still opening is answered by HerdrAnswer.
CloseA ==
    /\ alive["A"]
    /\ alive' = [alive EXCEPT !["A"] = FALSE]
    /\ closedEvt' = TRUE
    /\ watch' = IF watch["A"] = "open" THEN [watch EXCEPT !["A"] = "retry"] ELSE watch
    /\ UNCHANGED <<booting, queued, phase, waiters, nextWaiters, ready, refusal, caller>>

\* A structural event queues a bootstrap, or a follow-up while one runs (kit.js:582-597, 562-568).
ClosedEventLands ==
    /\ closedEvt
    /\ closedEvt' = FALSE
    /\ IF booting
         THEN queued' = TRUE /\ UNCHANGED <<booting, phase>>
         ELSE StartBoot /\ UNCHANGED queued
    /\ UNCHANGED <<alive, waiters, nextWaiters, watch, ready, refusal, caller>>

\* The snapshot lands: stop the old status watches, open one per agent pane in it
\* (kit.js:409-414, 440-447; openStatusWatch kit.js:496-514).
SnapshotLands ==
    /\ phase = "reading"
    /\ phase' = "acks"
    /\ watch' = [p \in Panes |-> IF alive[p] THEN "opening"
                                 ELSE IF watch[p] = "none" THEN "none" ELSE "stopped"]
    /\ ready' = [p \in Panes |-> IF alive[p] THEN "pending" ELSE "none"]
    /\ UNCHANGED <<alive, closedEvt, booting, queued, waiters, nextWaiters, refusal, caller>>

\* Herdr answers one `events.subscribe` (socket.js:94-112). A live pane acks. A closed
\* pane is refused, then Herdr closes the socket: a matched refusal settles `ready` false
\* and stops; an unmatched one is ignored and the close handler re-dials (socket.js:115-121).
HerdrAnswer(p) ==
    /\ watch[p] = "opening"
    /\ IF alive[p]
         THEN /\ watch' = [watch EXCEPT ![p] = "open"]
              /\ ready' = IF ready[p] = "pending" THEN [ready EXCEPT ![p] = "ok"] ELSE ready
              /\ UNCHANGED refusal
         ELSE /\ refusal' = [refusal EXCEPT ![p] = TRUE]
              /\ IF RefusalShape \in Matched
                   THEN /\ watch' = [watch EXCEPT ![p] = "stopped"]
                        /\ ready' = IF ready[p] = "pending" THEN [ready EXCEPT ![p] = "refused"] ELSE ready
                   ELSE /\ watch' = [watch EXCEPT ![p] = "retry"] /\ UNCHANGED ready
    /\ UNCHANGED <<alive, closedEvt, booting, queued, phase, waiters, nextWaiters, caller>>

\* later(open, backoff) dials a fresh watch with a new id (socket.js:88-92, 120-124).
Retry(p) ==
    /\ watch[p] = "retry"
    /\ watch' = [watch EXCEPT ![p] = "opening"]
    /\ UNCHANGED <<alive, closedEvt, booting, queued, phase, waiters, nextWaiters, ready, refusal, caller>>

\* Every watch this bootstrap opened has settled (Promise.allSettled, kit.js:446-447), so
\* runBootstrap's statusWatchReady() returns: answer the waiters and start the queued
\* follow-up for nextWaiters (kit.js:531-557). An answered attach finds B in the tree.
AcksSettle ==
    /\ phase = "acks"
    /\ \A p \in Panes : ready[p] # "pending"
    /\ caller' = [c \in Callers |-> IF c \in waiters THEN "done" ELSE caller[c]]
    /\ IF queued /\ DrainsQueue
         THEN /\ queued' = FALSE /\ waiters' = nextWaiters /\ nextWaiters' = {}
              /\ StartBoot
         ELSE /\ waiters' = {} /\ booting' = FALSE /\ phase' = "idle"
              /\ UNCHANGED <<queued, nextWaiters>>
    /\ UNCHANGED <<alive, closedEvt, watch, ready, refusal>>

KitStep == ClosedEventLands \/ SnapshotLands \/ AcksSettle
           \/ \E p \in Panes : HerdrAnswer(p) \/ Retry(p)

Next == KitStep \/ CloseA \/ \E c \in Callers : Refresh(c)

\* Herdr answers every request and the kit's timers fire: weak fairness on the kit and
\* Herdr's replies. Pane closes and user actions get none; they may never happen.
Spec == Init /\ [][Next]_vars
        /\ WF_vars(ClosedEventLands) /\ WF_vars(SnapshotLands) /\ WF_vars(AcksSettle)
        /\ \A p \in Panes : WF_vars(HerdrAnswer(p)) /\ WF_vars(Retry(p))

\* Property 1: after a final refusal, its watch settles (stops for good).
WatchSettles == \A p \in Panes : refusal[p] ~> (watch[p] = "stopped")

\* Property 2: an attach to the surviving pane B eventually answers. This model has no
\* failure path (no outage, no snapshot error), so an answer here is a success.
AttachAnswers == (caller["U"] = "waiting") ~> (caller["U"] = "done")

\* Witness: violated exactly when some run opens B, so the properties are not vacuous.
NeverAttached == caller["U"] # "done"
=============================================================================
