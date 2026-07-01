# MetaHarness runtime — event sync contract

Rust owns liveness — cursors, queues, ticks, snapshots. TS/MCP call verbs and render.
One tick/event/state machine underneath every aux actor; role differences are data.

## Ordering contract

```
append → notify → tick → render
```

1. **Append.** Every state transition is an event appended to the thread log
   (`.stack/events/threads/<thread>.jsonl`) via stackd. Workers emit `agent.*`,
   the monitor `monitor.*`, the gardener `gardener.*`, goal lifecycle `goal.*` /
   `meta_thread.goal_updated`, and layout `ui.*`.
2. **Notify.** Consumers learn about appends by polling `GET /meta/status` or the
   stackd event stream; nothing reads another actor's private state.
3. **Tick.** `POST /meta/tick` runs one serialized MetaHarness tick
   (`meta_tick_lock` — appends never interleave): actor schedulers read cursors and
   queue triggers (`monitor.trigger_queued`, `gardener.trigger_queued`), then the
   reducer folds each live thread and the projection is written to
   `.stack/meta/status.json`. The background monitor scheduler produces the same
   trigger sequence between explicit ticks (parity requirement C6).
4. **Render.** The TUI/MCP mount panels and strips from `MetaThreadSnapshot` only —
   goal phase, actor queues, the `ui.side_panel` slot, and the human headline all
   come from the same fold. No renderer derives state from raw events.

## Roles are data (`stack-core::actor_runtime`)

`ActorRole` carries everything role-specific: actor dir (`monitors`/`gardeners`),
event prefix, actor-state schema id, trigger/wake/pause event types. Shared
machinery: `events_after_cursor` (pending = everything after the cursor the role
didn't produce), `triggered_event_ids` (dedupe), `latest_next_wake_hints`
(`next_wake_on` / `next_wake_at` sleep verbs — schedulers must honor them).

**Single cursor owner:** an actor's `last_event_id` advances only when its pass
completes (recorded through stackd). Schedulers never advance cursors; they only
queue triggers, deduped against prior queues/wakes, bounded by wake budgets.

## Snapshot (`stack/meta-thread-snapshot/v1`)

Per thread: `goal { phase, objective, status }` · `actors[] { actor_id, role, state,
cursor, queued_triggers, last_wake_reason, next_wake_on, next_wake_at }` ·
`ui { side_panel { panel, view, opened_by, reason } }` · `headline` (latest
`for_human` monitor update — the rollup surfaced when the side panel is closed).

## ui.* event family

`ui.panel_opened { panel, view?, opened_by, reason? }` · `ui.panel_closed { panel }` ·
`ui.panel_focus { view }`. Agents open panels via MCP levers; the operator's Esc
appends `ui.panel_closed` and always wins until the next agent open.

## Non-goals (this round)

Worker self-scheduling; running LLM passes inside stackd (pass consumers stay TS:
`runMonitorForNewEvents`, gardener chat/maintenance); firm/optimizer actor types.

Proof: `testing/stack/smoke/smoke_meta_tick.ts` (`stack_meta_tick_ok`) and the
reducer golden tests in `crates/stackd/src/meta/reducer.rs`.
