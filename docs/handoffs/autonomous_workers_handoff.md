# Handoff: Autonomous background workers

**Goal:** make the Stack gardener able to *run* a worker to completion in the background, not just create an idle lane. Design authority: [`docs/stack_gardener_autonomous_workers.md`](../stack_gardener_autonomous_workers.md). Context on gardener visibility: [`docs/stack_gardener.md`](../stack_gardener.md).

**Owner before you:** design + review done; nothing of the executor is built yet. Start at **Phase 0**.

---

## TL;DR of the problem (all verified in code)

A gardener creates a worker, then narrates "route/steer the worker to report progress," and the worker sits at `turns: 0` forever. Because:

- **One executor per TUI:** `submitPrompt` (`src/tui/app.ts:17587`) → `runCodexTurn` (`src/tui/app.ts:17849`) runs only against the single foreground `options.session`; `applySession` (`src/tui/app.ts:17449`) mutates it in place. There is **no** second/background executor for workers.
- **Create ≠ run:** `stack_worker_thread_create` → `createWorkerThread` (`src/mcp/server.ts:2012`) → `stackdCreateWorkerMetaThread` (`src/client/stackd.ts:964`) only persists a meta-thread/session record; returns the string `"worker_thread.created"` (`src/mcp/server.ts:2074`). No turn, no process.
- **route/steer/queue are records, not execution:** `parseGardenerDispatchKind` (`src/gardener.ts:298`) → `enqueueGardenerInbox` (`src/gardener.ts:251`) / `recordGardenerWorkerDispatch` (`src/gardener.ts:573`) append meta-events. Actual delivery is `routeGardenerInboxItems` (`src/tui/app.ts:14811`), which **commandeers the operator's foreground session** onto the worker (`activateWorkerSessionForGardener` ~`src/tui/app.ts:14780`) and only the idle-`route` branch (`src/tui/app.ts:14888-14922`, submit at `:14910`) calls `submitPrompt`. `steer`/`queue` never submit.

So: no background runner + create-only + route-only-in-foreground = dead lane.

## The insight that makes this tractable

Background Codex execution **already exists twice** — copy the pattern, don't invent it:

- **Gardener** runs Codex turns off the foreground: `runGardenerChatTurn` (`src/gardener-chat.ts:35`, `:58`) → `runCodexTurn` (`src/codex/app-server-session.ts`). Per-turn, writes a session record with `turns[].stdout`.
- **Monitor sidecar** runs its **own Codex app-server** as a background process: `src/monitor-sidecar-codex.ts` (bridge `toExecJsonl` at `:180`), lifecycle via `setMonitorEnabled` in `src/monitor.ts`.
- **Report-back to gardener already works:** monitor posts `stack_monitor_goal_status(for_human:true)` → `monitor_headline` on the manifest → injected into the gardener's next turn via `liveMetaThreadLines()` (`src/gardener-chat.ts`). You do **not** build a new report channel.

The worker runner is a **third instance** of the same background-Codex pattern.

## What's already shipped this session (don't redo)

On branch `feat/operator-sessions-v0-20260707`:
- Gardener/worker association fix, plan-viz, `spawn_agent` subagents surfaced in the gardener pane (worker vs codex tags), `agents_states` live status, `backfillGardenerCoreOwnerTools` (so the engineering gardener actually has `stack_worker_thread_create`), the `GARDENER_WORKER_CREATE_PROMPT` guardrail, gardener-pane layout/overlap fixes + regression tests.
- Design doc `docs/stack_gardener_autonomous_workers.md`; this handoff.

You are building the **executor** those UI/prompt pieces were leading toward.

---

## Build plan (phased — ship each independently)

### Phase 0 — run-status + liveness (no executor yet). START HERE.
Kills the "gardener claims progress on a dead worker" lie immediately.

- Add a `worker_run.*` meta-event type + `stack_worker_run_status(thread_id)` MCP tool returning `{ state, turns, last_agent_message }`. State is derived from the worker session's `turns.length` + last turn exit + goal status for now (no runner yet).
  - Tool def + handler beside `stack_worker_thread_create` in `src/mcp/server.ts` (def pattern ~`:7316`, handler → a new `server.workerRunStatus(args)`).
  - Add tool id to the gardener allow list: `DEFAULT_GARDENER_CONFIG.tools.allow` and `GARDENER_CORE_OWNER_TOOLS` backfill in `src/gardener-config.ts`.
- Prompt: extend `GARDENER_WORKER_CREATE_PROMPT` (or a new `GARDENER_WORKER_RUN_PROMPT` + `ensureGardenerWorkerRunPrompt` following the existing `ensure*` pattern in `src/gardener-config.ts`) to state: **a worker at `turns:0` is NOT working; goal-active ≠ running; call `stack_worker_run` to execute and `stack_worker_run_status` to verify.**
- **Acceptance:** on the reproduction fixture below, `stack_worker_run_status` returns `turns:0, state:"idle"`; the gardener stops asserting the worker is making progress.

### Phase 1 — one background turn.
Prove a worker executes off the foreground session.

- New `src/worker-runner.ts`: `runWorkerTurn({ config, threadId, objective })` that resumes the worker's Codex session and runs **one** turn via `runCodexTurn` (`src/codex/app-server-session.ts`) — **must not** touch `options.session`. Persist the turn to the worker session record and append `agent.*` + `worker_run.*` meta-events (`appendThreadMetaEvent`, `src/thread-events.ts:33`) so the existing TUI parsers pick it up.
- New MCP tool `stack_worker_run(thread_id, objective?, max_turns?, monitor_profile?)` → calls the runner for one turn (loop comes in Phase 2). Returns `{ thread_id, run_id, state:"running" }`.
- **Reference to copy:** `runGardenerChatTurn` (`src/gardener-chat.ts:35-66`) is the closest template for "run a Codex turn against a non-foreground thread and persist it."
- **Acceptance:** `stack_worker_run` on the fixture worker produces `turns:1`, real `agent.*` events on the worker thread, and `stack_worker_run_status` reflects it — with the operator's foreground session untouched.

### Phase 2 — auto-continue loop + budget + controls.
- Turn loop in `worker-runner.ts`: run turn → read goal status (`normalizeThreadGoalStatus` / manifest `active_goal.status`) → continue until goal `done` | blocker recorded | `max_turns` | pause. Persist run state (a `worker_run` record on stackd or `.stack`, plus `worker_run.*` events) so status/restart work.
- Tools `stack_worker_continue(thread_id, note?)`, `stack_worker_pause(thread_id, reason)`.
- **Acceptance:** a worker with a 2-step objective runs both steps unattended and stops at goal `done`; `stack_worker_pause` halts after the current turn; `stack_worker_continue` resumes.

### Phase 3 — monitor auto-attach + report-back.
- On background run start, if the manifest has `monitor_profile`, enable the sidecar (`setMonitorEnabled`, `src/monitor.ts`) — today only operator `/monitor on` does this (documented gap in `stack_gardener.md`).
- **Acceptance:** starting a background run auto-enables the monitor; `monitor_headline` appears in the gardener's next chat turn (report path already exists — just confirm it flows).

### Phase 4 — concurrency & safety.
- Multiple background workers; per-worker turn budget + global cap; crash/restart recovery of run state; stop-on-TUI-exit policy for anything not yet persisted.
- **Acceptance:** two workers run concurrently within a global cap; run state survives a TUI restart (or is explicitly cleaned up).

---

## New MCP tools (summary)

| Tool | Args | Returns / effect | Phase |
| --- | --- | --- | --- |
| `stack_worker_run_status` | `thread_id` | `{ state, turns, last_agent_message }` | 0 |
| `stack_worker_run` | `thread_id`, `objective?`, `max_turns?`, `monitor_profile?` | start/resume background run → `{ thread_id, run_id, state }` | 1→2 |
| `stack_worker_continue` | `thread_id`, `note?` | nudge another turn | 2 |
| `stack_worker_pause` | `thread_id`, `reason` | stop loop after current turn | 2 |

Add each to: MCP def+handler in `src/mcp/server.ts`, and the gardener allow list in `src/gardener-config.ts` (both `DEFAULT_GARDENER_CONFIG.tools.allow` and the `backfillGardenerCoreOwnerTools`/`GARDENER_CORE_OWNER_TOOLS` list so drifted profiles self-heal). Keep `route`/`steer`/`queue` as the foreground/operator path — `stack_worker_run` is the background path (one noun per concept).

---

## Reproduction fixture (a real idle worker on disk)

Under `/Users/joshpurtell/Documents/GitHub/.stack`:
- Worker session: `sessions/thread_1783453670819130000_2_38725.json` (`role:"worker"`, `metaThreadId: mt_1783453670818949000_0_38725`, `turns: 0`).
- Manifest: `meta-threads/mt_1783453670818949000_0_38725/manifest.json` (`gardener_thread_id: manual-gardener-febd64f5-…`, `effort_ref: eff_ab6eefbd-…`, `lifecycle: live`, `title: "Banking77 Container Baseline"`).

This is a clean "created but never executed" worker to test Phase 0/1 against.

## Test & verify (how this repo does it)

- **Unit:** `bun test <file>` (built-in runner, no dep). Pure logic first — see `src/tui/gardener-pane-layout.test.ts`, `src/codex/plan-tool.test.ts`, `src/tui/subagents-collab.test.ts` for the style. Put the runner's decide-continue/stop logic behind a pure function and test it.
- **Typecheck:** `node_modules/.bin/tsc --noEmit`. NOTE: the tree currently carries 5 **pre-existing** errors (`src/codex/auth-sync.ts` ×4, `src/tui/app.ts:~1274` `'tiers'`) from the in-flight operator-sessions WIP — unrelated; don't chase them, just confirm you add no new ones.
- **Drive it end-to-end** with the `verify`/`run` skill or the fixture worker; don't claim a phase done off tests alone.
- **Quality gates** are enforced and non-waivable: `Jstack/.jstack/quality/` (incl. the blocking `no_litellm.sh`).

## House rules (from the team's standing constraints — do not violate)

- **litellm is banned malware** — never install/import/run/proxy it. Gate: `Jstack/.jstack/quality/gates/no_litellm.sh`.
- **Codex auth only** — never an OpenAI API key for agent execution; use the ChatGPT/codex auth pool (background workers share it → mind `usage_limit_exhausted`). Only a `gpt-5.x-nano` proposer may use an api_key.
- **No fallbacks / one correct path** — a background worker acts on its assigned objective, **records a blocker** (`stack_effort_record_blocker`) instead of guessing, and stops at acceptance. No try-X-then-Y.
- **Explicit over implicit** — decisions from typed tool calls / DB rows / meta-events, never phrase-matching an LLM's prose (this whole bug came from the gardener narrating instead of acting).
- **Always `uv run`** for Python (n/a here, but if you touch backend). **Never `git stash`.** Commit only when asked; if you branch, don't bump Stack's stable/minor version — nightly dev only.
- **No Anthropic models in the product/agent routes.**

## Decisions already made (don't relitigate)

- **Model:** autonomous background workers (chosen over "operator-driven only").
- **Reuse, don't invent:** worker runner = third instance of the gardener/monitor background-Codex pattern; report-back is the existing `monitor_headline` path.
- **Runner mechanism:** start with **per-turn `codex resume`** (gardener style) for Phase 1; revisit persistent app-server (monitor style) for Phase 2 if context cost matters.
- **Tool split:** `stack_worker_run*` = background/autonomous; `route/steer/queue` = foreground/operator.

## Open questions for you to resolve

- Global concurrency cap (gardener + monitor + N workers = N+2 Codex processes on one auth pool) — pick a default and make it configurable.
- Run-state persistence + restart recovery: stackd record vs `.stack` file; survive TUI restart vs stop-on-exit for Phase 1.
- Turn-budget defaults and blocker/acceptance stop conditions.

## Code map (copy targets + insertion points)

| Need | File |
| --- | --- |
| Foreground executor (reference, don't reuse directly) | `src/tui/app.ts` — `submitPrompt` `:17587`, `runCodexTurn` `:17849`, `applySession` `:17449` |
| Background Codex turn (COPY THIS) | `src/gardener-chat.ts:35-66`; `src/codex/app-server-session.ts` — `runCodexTurn` |
| Background process lifecycle (reference) | `src/monitor-sidecar-codex.ts`; `src/monitor.ts` — `setMonitorEnabled` |
| Worker create (record only, today) | `src/mcp/server.ts:2012` `createWorkerThread`; `src/client/stackd.ts:964` |
| Per-thread events (run state + agent.*) | `src/thread-events.ts` — `appendThreadMetaEvent` `:33`, `readThreadMetaEvents` `:52` |
| New runner | `src/worker-runner.ts` (create) |
| New MCP tools | `src/mcp/server.ts` (def pattern ~`:7316`) |
| Gardener allow list + prompt | `src/gardener-config.ts` — `DEFAULT_GARDENER_CONFIG.tools.allow`, `GARDENER_CORE_OWNER_TOOLS`, `ensure*Prompt` |
| Monitor report-back (already works) | `src/gardener-chat.ts` — `liveMetaThreadLines`; `src/mcp/server.ts` — `latestMonitorHeadline` |
