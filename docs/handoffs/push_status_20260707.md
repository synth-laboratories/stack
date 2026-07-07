# Push status — gardener workers/monitors + autonomous execution (2026-07-07)

**Branch:** `feat/operator-sessions-v0-20260707` · **Tree:** clean · **Merged?** no (whole branch is ahead of `origin/main`).

This push has two arcs on top of pre-existing branch work: **(A)** make the gardener's use of workers/monitors *visible and honest* in the TUI, and **(B)** make the gardener actually *run* workers (autonomous background execution).

---

## TL;DR status

| | State |
| --- | --- |
| Gardener worker/monitor **visibility + UI** (A) | **Done, committed, tested** |
| **Autonomous background workers** (B) | **Implemented + committed; live e2e still owed** |
| `cargo check -p stackd` | clean |
| `tsc --noEmit` | **5 errors, all pre-existing** operator-sessions WIP (not from this push) |
| `no_litellm.sh` gate | fails on **broad pre-existing** workspace refs (not this feature path) |
| Design/handoff/memory docs | written |

---

## A — Gardener worker/monitor visibility + UI  (commits `556d124`→`de8b899`)

The gardener was creating workers via `spawn_agent` (untracked) and narrating handoffs it never made; the panel showed nothing; a real durable worker didn't surface.

- **Association fix** (`0c26585` base + `556d124`): `associatedGardenerWorkersForEffort` no longer blanks the whole panel when a tagged effort's id can't resolve — falls open to gardener-only scoping. Also fixed a worker not surfacing because `stackdThreadToSessionSummary` dropped `metaThreadId` (`59b7104`).
- **Plan / `update_plan` TODO viz** (`556d124`): parse Codex `update_plan`; pinned Codex-style checklist in the gardener pane; compact dot glyph on worker Lights rows.
- **`spawn_agent` subagents surfaced as gardener subagents** (`b3d1cc7`, `f4504c7`): parse Codex `collab_tool_call` into `SubagentLog`; live status from `agents_states`; **pinned Agents block** in the gardener pane tagging each row **worker** (durable) vs **codex** (transient collab); clean task labels (`59b7104`); token column for worker rows (`c11ad33`).
- **Prompt + capability** (`556d124`): `GARDENER_WORKER_CREATE_PROMPT` (durable `stack_worker_thread_create` vs transient `spawn_agent`, no over-claiming) + `backfillGardenerCoreOwnerTools` so drifted profiles (e.g. `engineering`) actually get the create tools.
- **Layout correctness** (`5ffc992`, `696c8ae`, `de8b899`): Agents block moved below the control row; single-line rows; transcript reserves rows for the plan/agents blocks so nothing overlaps.
- **Regression tests**: `gardener-pane-layout.test.ts` (height invariant), and **tier-2 grid-collision overlap detection** in `scripts/smoke_tui_blackspace_playwright.ts` (`971f198`) driven by the app's real reserve function; plus `plan-tool.test.ts`, `subagents-collab.test.ts`, `gardener-worker-association.test.ts`. All green.

**Verified against live `.stack` data** throughout (real gardener session, real Faraday `spawn_agent`, real Banking77 durable worker).

## B — Autonomous background workers  (commits `49f6686`→`d8e1445`)

Root cause found & fixed: there was **one Codex executor per TUI** (operator foreground); `stack_worker_thread_create` only persisted a record; route/steer/queue only wrote meta-events → workers sat at `turns:0` forever.

- **Design + handoff docs**: `docs/stack_gardener_autonomous_workers.md` (`49f6686`), `docs/handoffs/autonomous_workers_handoff.md` (`13ba678`).
- **Rust-owned executor** (`956fa9d`) — boundary: Rust `stackd` owns execution, TS is client/MCP adapter only:
  - `crates/stack-core/src/worker_run.rs` — state/record/status, `.stack/worker-runs/<thread>.json`, startup cleanup of stale `running`.
  - `crates/stackd/src/handlers/threads.rs` — background Tokio loop: global semaphore permit, codex isolation, resolve objective→active goal, spawn + return immediately, turns until done/blocker/nonzero-exit/pause-after-current-turn/`max_turns` (default 3, cap 25), appends `worker_run.*`+`agent.*`, writes turns to the worker session, auto-enables monitor profile. Routes `GET/POST /threads/:id/worker-run[/status,/continue,/pause]`.
  - `src/client/stackd.ts` + `src/mcp/server.ts` — thin `stack_worker_run` / `_run_status` / `_continue` / `_pause` tools; `src/gardener-config.ts` + `bundled/gardeners/default.toml` — allow-list + prompt (run_status is liveness truth; `turns:0` = idle even if goal active).
- **Behavior to know:** `stack_worker_run` returns `worker_run.started` **immediately** (not "completed"); pause = stop-*after*-current-turn (slot not freed mid-turn).
- **Docs landed**: expanded `docs/stack_gardener.md` visibility reference (`d8e1445`).

---

## What remains before merge

1. **Live e2e for autonomous workers** (spends a real Codex turn) — fixture worker `thread_1783453670819130000_2_38725` (`.stack/sessions/…json`, manifest `mt_1783453670818949000_0_38725`, effort `eff_ab6eefbd…`): confirm `stack_worker_run_status` idle→running→turns/events recorded, then `monitor_headline` flows after a `monitor_profile` worker starts. This is the only thing not yet exercised end-to-end.
2. **`no_litellm.sh` gate** — broad **pre-existing** workspace references, outside this feature path. Resolve or explicitly waive/carry (papercut logged).
3. **5 pre-existing `tsc` errors** — `src/codex/auth-sync.ts` `last_refresh` ×4, `src/tui/app.ts:1274` `tiers`. These are **operator-sessions WIP** on this branch, unrelated to this push. Resolve or carry.
4. **Merge shape decision.** This branch bundles several distinct efforts: operator-sessions v0 + assembly-lines + effort cockpit (pre-existing), the gardener worker UI (A), and autonomous workers (B). Decide whether to merge whole, or cherry-pick A/B onto a clean branch off `main`. Note `556d124` intentionally bundled some operator-sessions WIP (was uncommitted at the time); A and B commits after it are otherwise self-contained.

## Pointers

| | Path |
| --- | --- |
| Autonomous workers design | `docs/stack_gardener_autonomous_workers.md` |
| Autonomous workers impl handoff | `docs/handoffs/autonomous_workers_handoff.md` |
| Gardener visibility reference | `docs/stack_gardener.md` |
| Memory (durable state) | `project_stack_autonomous_workers.md` |
