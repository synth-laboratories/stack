# Autonomous background workers (design)

**Status:** design / not yet implemented. Companion to [`stack_gardener.md`](./stack_gardener.md) (which covers *visibility*; this covers *execution/agency*).

**Audience:** engineers building the gardener → worker execution loop.

---

## Problem

Today a gardener-created worker **never runs on its own**. Verified in code:

- One Codex execution engine per TUI process: the operator's single foreground `options.session`, driven by `submitPrompt` → `runCodexTurn` (`src/tui/app.ts`).
- `stack_worker_thread_create` → `createWorkerThread` (`src/mcp/server.ts:2012`) only **persists** a meta-thread/session record (returns `"worker_thread.created"`). No turn, no process. Worker is born at `turns: 0`.
- `gardener.route/steer/queue` are **not executors** — they append `gardener.queued`/`gardener.dispatched` meta-events (`src/gardener.ts:251,573`). A worker only runs when a live operator TUI swaps its *one* foreground session onto the worker (`activateWorkerSessionForGardener` → `applySession`) and hits the idle-`route` branch that calls `submitPrompt`. `steer`/`queue` never submit.
- **No background/autonomous worker runner exists.**

Result: the gardener creates a lane, narrates "route/steer the worker to report progress," and the lane sits dead (`Actors · workers 0 active`, no evidence). The gardener is structurally incapable of driving work.

## Goal

The gardener can **start and drive a worker to completion without the operator babysitting it**: create lane → run it in the background → worker executes turns and produces evidence → monitor reports progress back → gardener reviews and steers or closes. The operator's foreground session is never commandeered.

### Non-goals
- Replacing the operator's ability to drive a worker in the foreground (that stays).
- Cloud/SMR/factory execution (separate owner-route path).
- Unbounded autonomy — background runs are budgeted and gated (turn cap, blocker → pause, acceptance → stop).

## What we reuse (this is not greenfield)

Background Codex execution already exists in two places; the worker runner is a third instance of the same pattern:

| Existing | Runs Codex off the foreground session | Reuse for workers |
| --- | --- | --- |
| **Gardener** (`runGardenerChatTurn` → `runCodexTurn`, `src/gardener-chat.ts:58`) | per-turn `codex` against the gardener thread | the per-turn run + session-record machinery |
| **Monitor sidecar** (`src/monitor-sidecar-codex.ts`) | its own Codex app-server observing a worker | the background-process lifecycle + wake scheduler |
| **Meta-events** (`appendThreadMetaEvent`, `src/thread-events.ts`) | per-thread `.jsonl` log | worker run state + `agent.*` events already parsed by the TUI |
| **Monitor → gardener report-back** (`monitor_headline` on manifest) | already injected into gardener chat each turn | progress surface — no new plumbing |

So the new machinery is a **background worker executor** that drives a worker's Codex turns (like the gardener drives its own), a **scheduler** around it (like the monitor's wake loop), and **MCP tools** so the gardener can start/steer/pause it.

## Target architecture

```
gardener (Codex, MCP)                     background worker runner (new)
  │  stack_worker_run(thread_id)  ───────▶  resume worker session
  │                                          loop:
  │                                            runCodexTurn(worker, objective/next)
  │                                            append agent.* + turn to worker thread
  │                                            check goal status (active/blocked/done)
  │                                            auto-continue until: goal done
  │                                                              | blocker recorded
  │                                                              | turn budget hit
  │                                                              | steer/pause arrives
  │  monitor sidecar (existing) ◀───────────  watches worker events
  │      posts monitor.goal_status for_human ─▶ monitor_headline on manifest
  ◀─ liveMetaThreadLines() injects monitor_headline into gardener's next turn
  │
  │  stack_worker_run receipt: {thread_id, run_id, state}
  ▼
gardener reviews monitor_headline + stack_effort_audit → stack_worker_continue / steer
                                                        | stack_effort_record_blocker
                                                        | close (acceptance met)
```

### New components

| Component | Responsibility | Modeled on |
| --- | --- | --- |
| **`worker-runner`** (new, e.g. `src/worker-runner.ts`) | Own the background turn loop for one worker: resume session, run a turn with the objective/next-step, persist turn + `agent.*` events, decide continue/stop. Never touches `options.session`. | `runGardenerChatTurn` loop + `runCodexTurn` |
| **worker run scheduler** (new or fold into runner) | Start on `stack_worker_run`; enforce turn budget; pause on blocker; wake on steer/continue; stop on goal done. Persist run state (`worker_run.*` meta-events + a run record on stackd). | monitor sidecar wake loop |
| **monitor auto-attach** | When a worker starts a background run and has a `monitor_profile`, ensure its sidecar is enabled (today only operator `/monitor on` does this — see gap in `stack_gardener.md`). | `setMonitorEnabled` |
| **new MCP tools** | Gardener-callable start/steer/pause (below). | `stack_worker_thread_create` handler shape |

### New MCP tools (gardener allow list)

| Tool | Args | Effect |
| --- | --- | --- |
| **`stack_worker_run`** | `thread_id`, optional `objective`, optional `max_turns`, optional `monitor_profile` | Start (or resume) a **background** run of the worker: assign/refresh goal, enable monitor, kick the runner. Returns `{ thread_id, run_id, state: "running" }`. This is the tool the gardener was missing. |
| **`stack_worker_continue`** | `thread_id`, optional `note` | Nudge a paused/idle worker to take another turn (post-blocker-resolution, or "keep going"). |
| **`stack_worker_pause`** | `thread_id`, `reason` | Stop the background loop after the current turn (safety/attention), leaving the lane resumable. Distinct from monitor sidecar pause. |
| **`stack_worker_run_status`** | `thread_id` | Read run state (running/paused/blocked/done, turns taken, last agent message) — gives the gardener execution truth, not just goal-active. |

`route`/`steer`/`queue` keep their current meaning for the **foreground/operator** path; `stack_worker_run` is the **background/autonomous** path. One noun per concept.

## Gardener story (prompt + doc)

Once `stack_worker_run` exists, the gardener gets a real, honest loop (new prompt section, and the loop documented here + in `stack_gardener.md`):

1. **Create the lane** with a crisp objective + `effort_ref` + `monitor_profile` (`stack_worker_thread_create`).
2. **Run it**: `stack_worker_run(thread_id, objective)` — this actually executes; do **not** claim a worker is "working" off `route/steer` alone.
3. **Verify liveness**: `stack_worker_run_status` shows `turns > 0` / `state: running`. Goal-active ≠ running.
4. **Watch**: read `monitor_headline` (passive each turn) and `stack_effort_audit` for structured proof.
5. **Steer or continue**: `stack_worker_continue` / steer on drift; `stack_effort_record_blocker` on external block (then `stack_worker_continue` after resolution).
6. **Close**: when acceptance is met (`stack_effort_remaining` empty), stop the run and `stack_effort_write_handoff`.

The prompt must also **stop implying `route/steer` drives an idle worker**, and add the liveness check (a worker at `turns: 0` is not working, regardless of goal status).

## Phased implementation

1. **Phase 0 — record & status (no executor).** Add `worker_run.*` meta-events + `stack_worker_run_status`, and a liveness check in the gardener prompt/doc (goal-active ≠ running). Immediately kills the "worker sitting at turns:0 while gardener claims progress" lie, even before autonomy. *(This is the honest Story-A slice, folded in as the base of B.)*
2. **Phase 1 — single background turn.** `stack_worker_run` runs **one** background turn via the runner (resume worker session + `runCodexTurn`), persists the turn + `agent.*` events, updates run state. Prove a worker can execute off the foreground session.
3. **Phase 2 — auto-continue loop + budget.** Turn loop until goal done / blocker / `max_turns` / pause. `stack_worker_continue`, `stack_worker_pause`.
4. **Phase 3 — monitor auto-attach + report-back.** Enable the sidecar on background run start; confirm `monitor_headline` flows to the gardener. (Reporting path already exists.)
5. **Phase 4 — concurrency & safety.** Multiple background workers, per-worker budgets, global cap, crash/restart recovery of run state.

## Risks / open questions

- **Concurrency model.** Gardener + monitor + N background workers = N+2 Codex processes. The monitor already proves multi-process works, but resource limits (local RAM/CPU, Codex auth/rate limits) need a global cap. See `feedback_local_dev_slot_ram_reduction` territory.
- **Session vs app-server.** Runner could reuse per-turn `codex exec` + resume (gardener style) or a persistent app-server (monitor style). Persistent app-server keeps context cheaper across auto-continue turns; per-turn resume is simpler and matches the gardener. **Recommend per-turn resume for Phase 1**, revisit for Phase 2.
- **Who owns the run process lifecycle** across TUI restart? Run state must persist (stackd or `.stack`), and a background runner must survive/rehydrate — or explicitly stop on TUI exit for Phase 1.
- **Auth.** Background workers consume the same Codex/ChatGPT auth pool as the gardener; budget interacts with usage limits (`feedback_codex_pool_usage_limit_block`).
- **Guardrails.** Background autonomy must respect the no-fallback / explicit-intent rules — a background worker acts only on an assigned objective, records blockers instead of guessing, and stops at acceptance.

## Code map (targets)

| Area | Path |
| --- | --- |
| Foreground executor (reference) | `src/tui/app.ts` — `submitPrompt`, `runCodexTurn`, `applySession` |
| Gardener background turns (reference) | `src/gardener-chat.ts` — `runGardenerChatTurn`; `src/codex/app-server-session.ts` — `runCodexTurn` |
| Monitor background process (reference) | `src/monitor-sidecar-codex.ts`, `src/monitor.ts` — `setMonitorEnabled` |
| Worker create (record only, today) | `src/mcp/server.ts:2012` — `createWorkerThread`; `src/client/stackd.ts:964` |
| New: worker runner + scheduler | `src/worker-runner.ts` (new) |
| New: run MCP tools | `src/mcp/server.ts` — `stack_worker_run`, `stack_worker_continue`, `stack_worker_pause`, `stack_worker_run_status` |
| Gardener allow list + prompt | `src/gardener-config.ts` — allow list, new worker-loop prompt |
| Per-thread run state / events | `src/thread-events.ts` — `worker_run.*` events |
