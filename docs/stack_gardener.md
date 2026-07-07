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

**Design intent:** the gardener orients the portfolio and routes operator intent. It is **not** the per-run event stream. The system prompt explicitly tells the gardener to point operators at the monitor sidecar for live worker progress rather than dumping worker tape.

---

## Tool inventory (default Codex gardener)

Authoritative allow list: `DEFAULT_GARDENER_CONFIG.tools.allow` in `src/gardener-config.ts` and `bundled/gardeners/default.toml`.

### Create a durable meta-thread / worker

| Tool | When to use |
| --- | --- |
| **`stack_worker_thread_create`** | Spawn a **new** durable worker. Appears in Threads/Lights. Returns `thread_id` + `meta_thread_id`. Optional: `objective`, `effort_ref`, **`monitor_profile`**. |
| **`stack_meta_thread_create`** | Bind an **existing** session/thread to a durable meta-thread. Same optional fields including **`monitor_profile`**. |
| **`stack_meta_thread_update_goal`** | Assign or change the goal on an **already-bound** meta-thread. |

**Not interchangeable:**

| Tool | Creates |
| --- | --- |
| **`stack_worker_thread_create`** / **`stack_meta_thread_create`** | Durable Stack worker lane (meta-thread + effort bind) |
| **`spawn_agent`** (Codex collab, **not** on gardener MCP allow list) | Transient **gardener subagent** — shows under Gardeners as `subagents N/M`. Returns only a `thread_id` (no `meta_thread_id`). **Not** a durable worker and **not** a monitor. |

The gardener system prompt (`GARDENER_WORKER_CREATE_PROMPT` in `src/gardener-config.ts`) warns against claiming a durable worker was created unless `stack_worker_thread_create` or `stack_meta_thread_create` returned both ids.

### Create or attach a monitor

**There is no gardener tool to spawn or enable a monitor on an existing run.**

| Mechanism | What it does | Gardener access |
| --- | --- | --- |
| **`monitor_profile` at create time** | Writes monitor **policy** onto the meta-thread manifest (`default`, `engineering`, `research`, … from `bundled/monitors/`). | **`stack_worker_thread_create`** / **`stack_meta_thread_create`** optional arg |
| **`/monitor on`** on the worker thread | Enables the monitor sidecar runtime (Codex session + wake scheduler). | **Operator only** — no MCP |
| Goal-mode auto-enable | When operator is on a worker with an active goal, Stack may auto-enable monitor once per objective (`syncGoalModeDefaults` in `src/tui/app.ts`). | TUI behavior, not gardener-callable |
| **`stack_monitor_goal_status`** | Monitor posts human-visible progress (`for_human: true` → `monitor_headline`). | **Monitor only** — not on gardener allow list |
| **`stack_sidecar_pause_for_restart`** | Monitor batch pause/wake. | **Monitor only** |

`monitor_profile` on the manifest is **policy**, not a guarantee the sidecar is running. For an existing worker, the operator must run **`/monitor on`** (or land on that worker in goal mode).

Bundled monitor profiles: `bundled/monitors/*.toml`.

### Review thread / monitor / effort state

#### Passive context (auto-injected every chat turn)

`buildGardenerChatPrompt` in `src/gardener-chat.ts` prepends this **without** tool calls:

| Line | Content |
| --- | --- |
| **Worker threads** | 8-char id · turn count · display label — **no** stdout, tools, or events |
| **Meta-threads** | title · goal status · head thread id (8 chars) · optional `monitor_profile` / **`monitor_headline`** |
| **Default worker target** | Associated worker id (8 chars) from `src/tui/gardener-worker-association.ts` |

**Not wired into the prompt today** (code exists elsewhere):

- `readWorkerTraceDelta()` — recent prompts / exit codes (`src/gardener-orchestrator.ts`)
- Last N `monitor.*` events from the target worker thread
- Effort audit summary — gardener must **actively call** MCP tools below

#### MCP tools the gardener can call to investigate

| Tool | Visibility you get |
| --- | --- |
| **`stack_meta_thread_get`** | Full manifest for one meta-thread: goal, lifecycle, `monitor_profile`, derived **`monitor_headline`** |
| **`stack_meta_threads_list`** | Same fields across live/archived meta-threads |
| **`stack_effort_get`** | Compact effort orientation: manifest, acceptance, refs |
| **`stack_effort_audit`** | Coherence review before handoff — finding receipts, acceptance gaps |
| **`stack_effort_remaining`** | Open acceptance / what remains |
| **`stack_effort_activity`** | Bounded effort timeline |
| **`stack_effort_list`** | Portfolio of efforts with latest evidence hints |
| **`stack_status`** / **`stack_runtime_status`** | Local + hosted portfolio orientation |
| **`stack_ui_open_panel`** `panel="monitor"` | Opens monitor panel for the **operator** — gardener does **not** receive the event stream in its reply context |
| **`stack_lights_thread_view`** | Marks a thread viewed/expanded in Lights — UI only |

Full effort write surface is also on the allow list (`stack_effort_record_*`, `stack_effort_write_handoff`, …) for curation and operator-origin notes — not for reading live worker stdout.

#### What the gardener cannot read

| Surface | Gap |
| --- | --- |
| Worker transcript / stdout / tool calls | No MCP; not in chat prompt |
| **`monitor.*` event log** (live sidecar feed) | No MCP; not in chat prompt |
| Monitor sidecar chat / thread view | Operator-only via monitor panel |
| **`stack_thread_events_read`** (or equivalent) | **Does not exist** |
| Monitor enable/disable state | No MCP — only manifest `monitor_profile` and passive `monitor_headline` |

#### Native Stack gardener tools (not Stack MCP)

| Tool | Purpose |
| --- | --- |
| **`gardener.route`** | Route operator instruction to a worker thread |
| **`gardener.steer`** | Steer active worker |
| **`gardener.queue`** | Queue work for a worker |
| **`gardener.inbox`** | Read gardener inbox |
| **`gardener.garden_rewrite`** | Rewrite workspace garden doc |
| **`skills.register`** / **`skills.suggest`** | Skill curation (steers worker to read) |

---

## Can the gardener spawn a monitor?

**No.**

- The gardener does **not** spawn a monitor agent (no `spawn_monitor`, no monitor Codex session from gardener).
- Monitor is a **sidecar role bound to a worker thread**, started when monitor is **enabled** on that thread.
- Gardener MCP allow list does **not** include `stack_monitor_goal_status`, monitor enable/disable, or monitor spawn tools.

What the gardener **can** do for monitor visibility:

1. **`stack_ui_open_panel`** with `panel="monitor"` and the worker `thread_id` — points the **operator** at the live sidecar feed (events / thread / tape).
2. **`stack_meta_thread_get` / `stack_meta_threads_list`** — read manifest fields including `monitor_profile` and `monitor_headline`.
3. **`stack_meta_thread_create` / `stack_worker_thread_create`** with optional **`monitor_profile`** — attach monitor policy when **creating** durable work (not retroactive enable on an existing run).

Operator enables monitor on an **existing** worker with **`/monitor on`** on that thread (see [`USAGE.md`](./USAGE.md)).

---

## Can the gardener subscribe to monitor updates?

**Not as a live event stream. Passive manifest projection only.**

| Mechanism | Gardener gets monitor updates? |
| --- | --- |
| Worker thread `monitor.*` event log in TUI | **No** — gardener focus shows gardener events only (`coreEventStreamContext === "gardener"`) |
| Worker stdout / agent transcript in gardener chat | **No** — gardener chat is gardener-thread turns + `gardener.message` events |
| **`monitor_headline` on meta-thread manifest** | **Yes** — injected on each gardener chat turn via `liveMetaThreadLines()` in `src/gardener-chat.ts` |
| Monitor sidecar transcript | **No** — operator views via monitor panel on the worker thread |
| **`stack_meta_thread_get`** on demand | **Yes** — includes latest `monitor_headline` derived from last `monitor.goal_status` with `for_human: true` |

When monitor calls `stack_monitor_goal_status` with `for_human: true`, Stack projects a headline onto the meta-thread manifest. The gardener’s next chat prompt includes that line (e.g. `sidecar advancing: baseline 0.42`). That is the intended “subscription” — **read-only, on wake**, not a pushed stream inside gardener chat.

---

## Why the gardener often “has no clue what’s going on”

This is structural, not only misconfiguration.

1. **Thin passive context** — turn counts and manifest one-liners, not live worker activity.
2. **Monitor is opt-in and one-way** — gardener only sees `monitor_headline` if monitor is on **and** posts human updates; no event subscription.
3. **Evidence is MCP-pull, not push** — `stack_effort_audit` and related tools only help if the gardener **chooses** to call them; audit results are not auto-injected.
4. **Prompt design** — portfolio conductor; explicitly **not** the per-run event stream.
5. **Synth gardener path** — zero tools (see below).

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
2. On the **worker thread**, run **`/monitor on`** (create-time `monitor_profile` alone is not enough for an existing run).
3. Open **monitor sidecar** (right panel / goal `t`) for the `monitor.*` event stream.
4. Have monitor post human updates (`stack_monitor_goal_status`, `for_human: true`) or worker record effort evidence (`stack_effort_record_*`, captures, handoffs).
5. Ask gardener again — should reflect **`monitor_headline`** in passive context; ask gardener to **`stack_effort_audit`** for structured proof (Codex path).

Ask gardener to **open monitor panel** when you want the stream on screen:

```text
/gardener open monitor for Banking77 worker
```

(Codex gardener with MCP should call `stack_ui_open_panel` with `panel="monitor"` and the worker `thread_id`.)

---

## Synth vs Codex gardener

| Path | MCP / tools | Implication |
| --- | --- | --- |
| **Codex app-server** (default local) | Stack MCP per `bundled/gardeners/*.toml` | Can call `stack_meta_thread_get`, `stack_effort_audit`, `stack_ui_open_panel`, create durable workers, etc. |
| **Synth direct responses** (`synth_aux` / `synth_inference` provider) | **No tools** | Prompt-only; cannot audit effort, open panels, or create workers via MCP. `buildGardenerChatPrompt` adds an explicit runtime note forbidding tool claims. |

---

## Known gaps (roadmap)

Priority fixes for gardener visibility:

| Gap | Proposed fix |
| --- | --- |
| No worker trace in prompt | Wire **`readWorkerTraceDelta(targetWorker)`** into `buildGardenerChatPrompt` (recent prompts, last exit code) |
| No monitor events in prompt | Inject last N **`monitor.*`** lines from target worker thread |
| No passive effort summary | Optional compact **`stack_effort_audit`** snapshot for associated effort on each wake |
| Cannot enable monitor retroactively | MCP: set **`monitor_profile`** and/or **enable monitor** on existing meta-thread (today: operator `/monitor on` only) |
| No thread event read API | **`stack_thread_events_read`** (or similar) for gardener to inspect worker/monitor activity without opening TUI panels |
| Truncated ids in prompt/Lights | Show **full target thread id** where operator debugging needs it |
| Lights label confusion | Clarify **Actors** (codex subagents) vs **Agents** (durable workers) |

---

## Code map

| Area | Path |
| --- | --- |
| Gardener MCP allow list + prompts | `src/gardener-config.ts` — `DEFAULT_GARDENER_CONFIG`, `GARDENER_*_PROMPT` |
| Gardener chat prompt | `src/gardener-chat.ts` — `buildGardenerChatPrompt`, `liveMetaThreadLines` |
| Worker trace delta (unwired) | `src/gardener-orchestrator.ts` — `readWorkerTraceDelta` |
| Worker association | `src/tui/gardener-worker-association.ts` |
| Gardener routing / garden docs | `src/gardener.ts`, `src/gardener-orchestrator.ts` |
| Event stream in TUI (gardener vs worker) | `src/tui/center-panel.ts` — `resolveCoreEventStreamContext` |
| Monitor sidecar + enable | `src/monitor.ts`, `src/monitor-sidecar-codex.ts`, `setMonitorEnabled` |
| MCP tool definitions | `src/mcp/server.ts` — `stack_worker_thread_create`, `stack_meta_thread_*`, `stack_monitor_goal_status` |
| Meta-thread headline projection | `src/mcp/server.ts` — `latestMonitorHeadline`, `metaThreadListItem` |
| Bundled gardener profile | `bundled/gardeners/default.toml`, `default.system.md` |
| Bundled monitor profiles | `bundled/monitors/*.toml` |

---

## Summary

| Question | Answer |
| --- | --- |
| What tool **creates a durable worker**? | **`stack_worker_thread_create`** (new session) or **`stack_meta_thread_create`** (bind existing). Not **`spawn_agent`**. |
| What tool **creates a monitor**? | **None** for gardener. Set **`monitor_profile`** at create time; operator **`/monitor on`** to run sidecar on existing worker. |
| How does gardener **review** thread/monitor state? | Passive: worker summaries + meta-thread lines + `monitor_headline`. Active MCP: **`stack_meta_thread_get`**, **`stack_effort_audit`**, etc. Cannot read worker stdout or `monitor.*` events. |
| Can gardener **subscribe** to monitor updates? | **Passive only** — `monitor_headline` on manifest each chat turn; no live stream. |
| How should operator see live progress? | **Monitor panel** on worker thread; gardener opens it via **`stack_ui_open_panel`** or directs you there. |
| Why “no clue what’s going on”? | Thin auto context + monitor off/silent + empty effort receipts + prompt scoped to portfolio orientation, not worker tape. |
