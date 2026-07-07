# Stack Gardener actor

**Audience:** operators and engineers debugging gardener ↔ worker ↔ monitor visibility.

**Related:** [`USAGE.md`](./USAGE.md) (controls), [`ASSEMBLY_LINES.md`](./ASSEMBLY_LINES.md) (effort/manifest authority), bundled prompts under `bundled/gardeners/`.

---

## Role

The **gardener** is a portfolio conductor — separate from **worker threads** (implementation) and **monitor sidecars** (per-run progress narration).

| Actor | Owns |
| --- | --- |
| **Worker** | Codex turns, tools, artifacts, goal execution on a durable thread |
| **Monitor** | Sidecar on a **worker thread**: watches worker events, posts `monitor.goal_status`, steers, writes `monitor_headline` on the meta-thread manifest |
| **Gardener** | Operator chat, routing (`route` / `steer` / `queue`), effort/meta-thread orientation, friction, panel open/close |

Gardener config (prompt + MCP allow list): `bundled/gardeners/default.toml`, `src/gardener-config.ts`.

---

## Can the gardener spawn a monitor?

**No.**

- The gardener does **not** spawn a monitor agent (no `spawn_monitor`, no monitor Codex session from gardener).
- Monitor is a **sidecar role bound to a worker thread**, started when monitor is **enabled** on that thread (operator `/monitor on`, goal/meta-thread `monitor_profile`, or stackd monitor scheduler on worker events).
- Gardener MCP **allow list** includes effort/meta-thread/UI tools — it does **not** include `stack_monitor_goal_status`, monitor enable/disable, or monitor spawn tools.

What the gardener **can** do for monitor visibility:

1. **`stack_ui_open_panel`** with `panel="monitor"` and the worker `thread_id` — points the **operator** at the live sidecar feed (events / thread / tape).
2. **`stack_meta_thread_get` / `stack_meta_threads_list`** — read manifest fields including `monitor_profile` and `monitor_headline`.
3. **`stack_meta_thread_create` / `stack_worker_thread_create`** with optional **`monitor_profile`** — attach monitor policy when **creating** durable work (not retroactive spawn on an existing run).

Operator enables monitor on an **existing** worker with `/monitor on` on that thread (see [`USAGE.md`](./USAGE.md)).

---

## Can the gardener subscribe to monitor updates?

**Not as a live event stream. Passive manifest projection only.**

| Mechanism | Gardener gets monitor updates? |
| --- | --- |
| Worker thread `monitor.*` event log in TUI | **No** — gardener focus shows gardener events only (`coreEventStreamContext === "gardener"`) |
| Worker stdout / agent transcript in gardener chat | **No** — gardener chat is gardener-thread turns + `gardener.message` events |
| **`monitor_headline` on meta-thread manifest** | **Yes** — injected on each gardener chat turn via `liveMetaThreadLines()` in `src/gardener-chat.ts` |
| Monitor sidecar transcript | **No** — operator views via monitor panel on the worker thread |

When monitor calls `stack_monitor_goal_status` with `for_human: true`, Stack projects a headline onto the meta-thread manifest. The gardener’s next chat prompt includes that line (e.g. `sidecar advancing: baseline 0.42`). That is the intended “subscription” — **read-only, on wake**, not a pushed stream inside gardener chat.

---

## What the gardener sees about worker progress

On each gardener chat turn, `buildGardenerChatPrompt` includes:

- **Worker thread summaries** — id (8 chars), turn count, display label (no live stdout/tools)
- **Live meta-thread lines** — title, goal status, head thread id, optional `monitor_headline`
- **Default worker target** — from gardener ↔ worker association (`src/tui/gardener-worker-association.ts`)

It does **not** include today:

- `readWorkerTraceDelta()` (recent prompts / exit codes) — exists in `gardener-orchestrator.ts` but not wired into chat prompt
- Last N `monitor.*` events from the target worker thread
- Effort audit/progress unless gardener calls `stack_effort_audit` / `stack_effort_remaining` (Codex gardener with MCP only; Synth direct-chat gardener has no tools)

So the gardener can correctly say **“goal active, lane exists, head thread set”** while also saying **“no code/container/baseline evidence recorded”** when:

- Effort acceptance / artifacts / handoffs are empty (`stack_effort_*` receipts not written), and
- Monitor is off or has not emitted a human `monitor_headline`, and
- Worker has not posted structured proof the gardener can read via MCP audit tools.

---

## Lights panel: common confusion

| Lights row | Meaning |
| --- | --- |
| **Gardeners · target `thread_…`** | Associated **durable worker** thread id (8-char truncation is normal, not a wrong thread) |
| **Agents · worker · … goal active** | Effort/manifest + plan widget — durable lane label |
| **Actors · workers 0** | Codex **subagents on the gardener harness session** — not durable Stack worker count |
| **Threads · monitor headline** | Latest `monitor_headline` per thread when monitor has posted |

---

## Operator workflow: “gardener can’t see worker progress”

1. Confirm **worker association** — Lights gardeners target matches head thread on meta-thread (full id in thread list / manifest).
2. On the **worker thread**, run **`/monitor on`** (or ensure meta-thread has `monitor_profile` from goal create).
3. Open **monitor sidecar** (right panel / goal `t`) for the `monitor.*` event stream.
4. Have monitor post human updates (`stack_monitor_goal_status`, `for_human: true`) or worker record effort evidence (`stack_effort_record_*`, captures, handoffs).
5. Ask gardener again — should reflect **`monitor_headline`** and effort audit after MCP calls (Codex path).

Ask gardener to **open monitor panel** for you when you want the stream:

```text
/gardener open monitor for Banking77 worker
```

(Codex gardener with MCP should call `stack_ui_open_panel` with `panel="monitor"` and the worker `thread_id`.)

---

## Gardener vs `spawn_agent` (Codex collab)

| Tool | Creates |
| --- | --- |
| **`stack_worker_thread_create`** | Durable Stack worker (Threads/Lights, meta-thread, effort bind) |
| **`spawn_agent`** (Codex collab) | Transient **gardener subagent** — shows under Gardeners as `subagents N/M`, **not** a durable worker |

Gardener subagents in Lights are **not** monitors and do not replace monitor sidecars on worker threads.

---

## Synth vs Codex gardener

| Path | MCP / tools | Implication |
| --- | --- | --- |
| **Codex app-server** (default local) | Stack MCP per `bundled/gardeners/*.toml` | Can call `stack_meta_thread_get`, `stack_effort_audit`, `stack_ui_open_panel`, etc. |
| **Synth direct responses** (`synth_aux` / `synth_inference` provider) | **No tools** | Prompt-only; cannot audit effort or open panels via MCP — thinner visibility |

---

## Known gaps (roadmap)

- Wire **`readWorkerTraceDelta(targetWorker)`** and recent **`monitor.*`** lines into `buildGardenerChatPrompt`.
- Show **full target thread id** in Lights (not only 8 chars).
- Clarify **Actors** vs **Agents** labels in Lights (codex subagents vs durable workers).
- Optional: MCP lever for gardener to request **`monitor_profile`** on an existing meta-thread (today: operator `/monitor on` or create-time profile).

---

## Code map

| Area | Path |
| --- | --- |
| Gardener chat prompt | `src/gardener-chat.ts` — `buildGardenerChatPrompt`, `liveMetaThreadLines` |
| Worker association | `src/tui/gardener-worker-association.ts` |
| Gardener maintenance / garden docs | `src/gardener-orchestrator.ts`, `src/gardener.ts` |
| Event stream in TUI (gardener vs worker) | `src/tui/center-panel.ts` — `resolveCoreEventStreamContext` |
| Monitor sidecar | `src/monitor.ts`, `src/monitor-sidecar-codex.ts` |
| Gardener system prompt | `bundled/gardeners/default.system.md` |

---

## Summary

| Question | Answer |
| --- | --- |
| Can gardener **spawn** a monitor? | **No** — enable monitor on the worker thread; gardener may set `monitor_profile` only at meta-thread/worker **create** time. |
| Can gardener **subscribe** to monitor updates? | **Passive only** — `monitor_headline` on manifest each chat turn; no live `monitor.*` stream in gardener UI. |
| How should operator see live progress? | **Monitor panel** on worker thread; gardener opens it via `stack_ui_open_panel` or directs you there. |
