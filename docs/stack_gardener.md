# Stack Gardener actor

## Operator playbook — Banking77 container + baseline + GEPA (browser TUI)

Use this to drive the **gardener** through a full local research loop: durable worker → Banking77 container → baseline eval → local GEPA. Tested **2026-07-07** via [`scripts/browser_tui.py`](../scripts/browser_tui.py) + Cursor browser automation.

### 0. Prerequisites

| Requirement | Why |
| --- | --- |
| **stackd with worker-run + monitor routes** | Gardener calls `stack_worker_run`, `stack_worker_run_status`, `stack_meta_thread_set_monitor`. A stale stackd returns **404** on these routes even when health is OK. |
| **GEPA service** (`127.0.0.1:8879`) | Local optimizer panel / `synth-optimizers gepa service` (see **oss-gepa** skill). |
| **Effort bound** (e.g. `B77T202` / `banking77-top-score`) | Gardener audit + worker binding need `effort_ref` on the meta-thread. |
| **Codex auth** | Gardener + worker turns use Codex app-server. |

**Rebuild stackd after pulling gardener visibility / autonomous-worker commits:**

```bash
cd ~/Documents/GitHub/stack
cargo build -p stackd
# stackd must see the workspace .stack (not stack/.stack). Match Stack's workingDir:
export STACK_ROOT=~/Documents/GitHub          # parent of stack repo when workingDir is ..
export STACK_INSTALL_ROOT=~/Documents/GitHub/stack
nohup ./target/debug/stackd serve > "$STACK_ROOT/.stack/runtime/stackd.log" 2>&1 &
# Or: quit Stack (/exit) and relaunch via bin/stack — it autostarts stackd when health fails.
curl -s http://127.0.0.1:8792/health   # session_log_dir should be $STACK_ROOT/.stack/sessions
curl -s http://127.0.0.1:8792/threads/<thread_id>/worker-run/status   # HTTP 200, not route 404
```

### 1. Spin up Stack in a browser

```bash
cd ~/Documents/GitHub/stack
python3 scripts/browser_tui.py --port 8765
# Open http://127.0.0.1:8765 — real Stack TUI in a PTY (keyboard + paste work; ANSI stripped for display).
```

Optional: pass stack args after `--` (e.g. `python3 scripts/browser_tui.py -- --help`).

**TUI focus:** gardener chat is **`/g [message]`** or **`/gardener [message]`** ([`USAGE.md`](./USAGE.md)). Effort ON tag shows in Lights (`◉ ON`).

**Agent/MCP focus:** `stack_message_gardener` accepts `worker_thread_id` and `body`; stackd resolves the worker's registered gardener, records the message, and returns immediately. The gardener runs asynchronously so it can call nested tools such as `stack_worker_continue` without deadlocking the MCP request. Follow with `stack_thread_events_read` on the returned `gardener_thread_id` and `stack_worker_run_status` on the worker.

### 2. Gardener prompt (copy/paste)

Send one message that names the effort, asks for tool receipts, and sequences owner routes. For **checkpoint-gated** runs (container → baseline → harness → prompt → submission), use §5–§6 instead of this single-shot prompt.

```text
/g Audit B77T202 effort. Create or use the live Banking77 meta-thread worker with monitor_profile engineering. Open the monitor panel. stack_worker_run the head thread to: build the Banking77 eval container, run baseline rollout smoke, then start local GEPA (oss-gepa). Report every tool receipt and stack_worker_run_status.
```

**What the gardener should do (Codex + MCP):**

1. `stack_effort_audit` / `stack_effort_get` on the ON effort
2. `stack_worker_thread_create` (or reuse live meta-thread) with `monitor_profile: engineering`
3. `stack_meta_thread_set_monitor` + `stack_ui_open_panel` `panel=monitor`
4. `stack_worker_run` → worker builds container, baseline, GEPA setup
5. `stack_thread_events_read` + `stack_worker_run_status` for liveness proof
6. Monitor posts `monitor_headline` → gardener passive context on next turn

**Skills to suggest on the worker** (gardener `skill suggest oss-gepa` / `containers`): `oss-gepa`, `synth-via-stack`, `containers`.

**StackEval task name** (when validating end-to-end receipts): `banking77-local-gepa` (see [`docs/QUALITY.md`](./QUALITY.md)).

### 3. Browser automation (agents / CI)

The browser page exposes `#terminal` (not an `<input>`). Drive it with **keyboard events** on that element, or type in the page manually:

```javascript
// In browser devtools or CDP Runtime.evaluate:
const el = document.getElementById('terminal');
el.focus();
const msg = '/g <your gardener message>';
for (const ch of msg) el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
```

Poll `document.getElementById('terminal').textContent` for gardener replies (tool receipts appear as `mcp_tool_call` lines in the gardener pane).

### 4. Live test result (2026-07-07)

**Setup:** `browser_tui.py` on `:8765`, effort **B77T202** ON, existing Banking77 lanes (one archived by operator ~21:30Z).

| Step | Result |
| --- | --- |
| Gardener chat via `/g` | **Worked** — gardener turn ran, made MCP tool calls |
| `stack_effort_audit` | **Worked** — status `fail` (missing acceptance criterion, no A1 optimizer evidence) |
| `stack_ui_open_panel` monitor | **Worked** — `ui_panel_opened_…` receipt |
| `stack_thread_events_read` | **Worked** — count `0` on fresh head thread |
| `stack_meta_thread_set_monitor` | **200** after rebuild + `STACK_ROOT` fix |
| `stack_worker_run` / `_status` | **200** — `worker_run.started`, gardener reported `state: running, turns: 0` |
| Gardener honesty | **Good** — reported receipts, did not claim run progress; named rebuild stackd as next action |

**Blocker was:** stale stackd binary **and** stackd started without `STACK_ROOT` (pointed at `stack/.stack/sessions` instead of `~/Documents/GitHub/.stack/sessions`). After `cargo build -p stackd` + restart with `STACK_ROOT=~/Documents/GitHub`, routes return **200** and gardener reads live run status.

**Still running (2026-07-07 confirm):** browser TUI on `:8765`, stackd on `:8792`, background `worker_run` on `thread_1783459847752588000_8_38725`.

**Layout note:** `scripts/smoke_tui_blackspace_playwright.ts` is a **fixture screenshot** harness for pane overlap — not live Stack. Use `browser_tui.py` for real gardener E2E.

### 5. Checkpoint ladder (pre-register before you run)

Use this ladder for **any** classifier/optimizer effort in the browser TUI. Pre-register checkpoints when you create the effort or meta-thread goal so the gardener, monitor, and `stack_effort_audit` share the same definition of done.

| Checkpoint | Done means | Pre-register (before worker runs) | Record when passed (worker or gardener MCP) | Gardener verify |
| --- | --- | --- | --- | --- |
| **CP-1 Container built** | Image builds; container serves `GET /health` + `GET /info` on an owned port | Add to meta-thread `acceptance_criteria` via `stack_meta_thread_update_goal`; optional `stack_effort_update_progress` seed | `stack_effort_record_finding` under `findings/proof/` (build log, image tag, port); `stack_effort_record_capture` for terminal receipt | `stack_effort_audit` + `curl` health on declared port; `stack_thread_events_read` for `worker_run.turn_completed` |
| **CP-2 First eval** | Baseline rollout smoke on visible/train split; metrics + command recorded | Same criteria list; bind `stack effort benchmark` metadata if intake exists | `stack_effort_record_benchmark` or `stack_effort_record_capture`; research log entry | `stack_effort_remaining` — baseline criterion closed; monitor `monitor_headline` |
| **CP-3 Harness locked in** | Container contract frozen: rollout route, scorer wiring, StackEval task name if used | `stack_effort_record_repo` for cookbook/evals paths; note StackEval task in effort notes | `findings/code/` harness recipe; `stack_effort_record_finding` kind `proof` with `/rollout` receipt | `stack_effort_audit` — harness refs + proof folder; optional `bun run stackeval:run:prepare` receipt |
| **CP-4 Prompt locked in** | Champion candidate prompt/config saved under `findings/code/`; visible split evaluated | Claim **A1** in `task-classifier` template (`effort.toml` claims) | `stack_effort_record_optimizer_candidate` (local GEPA run id, score, path) | `stack_effort_audit` — A1 `needs_evidence` satisfied |
| **CP-5 Submission** | Handoff packet + acceptance summary; hosted graduation if applicable | Claim **Handoff** + optional A2–A4 in template | `stack_effort_write_handoff`; `stack_effort_record_acceptance` per claim; `stack artifacts publish` when ready | `stack_effort_audit` status `pass`; gardener reports open blockers only |

**Pre-register in one shot (Banking77 / task-classifier):**

```text
/g Create effort from template task-classifier (or use ON effort B77T202). stack_meta_thread_update_goal on the head worker with acceptance_criteria:
1) CP-1 Container built: Banking77 image builds and /health+/info pass on owned port.
2) CP-2 First eval: baseline visible-split rollout smoke with command, metrics, artifact paths.
3) CP-3 Harness locked in: rollout contract + scorer wiring frozen; StackEval task banking77-local-gepa named if used.
4) CP-4 Prompt locked in: candidate prompt under findings/code/ with local GEPA proof (A1).
5) CP-5 Submission: HANDOFF.md + acceptance-summary.md + recorded A1 claim.
Bind effort_ref, set monitor_profile engineering, enable monitor, open monitor panel.
```

Effort templates already seed **A0–A4** claims (`bundled/efforts/<template>/template.toml`). Operator checkpoints **CP-1..CP-5** are the browser-friendly slice on top — map CP-4 → **A1**, CP-5 → **Handoff** + optional **A2–A4**. Full template playbooks: `bundled/efforts/<template>/PLAYBOOK.md`; CLI mirror in [`USAGE.md`](./USAGE.md) § Efforts.

Monitor sidecar checkpoints (`.stack/actors/<thread>/monitors/*.json`, `monitor.checkpoint` events) advance on worker tool/turn triggers — separate from effort acceptance but visible in the monitor panel (`e` / goal `t`). Operator milestones should still be **written to the effort** so `stack_effort_audit` can pass without relying on monitor actor state alone.

### 6. End-to-end script — Banking77 (browser TUI)

Run each stage in **http://127.0.0.1:8765** (or your `browser_tui.py` port). One gardener message can span multiple CPs; below is the **checkpoint-gated** version for CI or human operators who want receipts per gate.

| Stage | Operator action | Gardener prompt (paste after `/g `) | Pass signal |
| --- | --- | --- | --- |
| **Boot** | §0 prerequisites + §1 spin up | `stack_status mode all. Confirm stackd worker-run routes 200, GEPA :8879, effort ON.` | Health 200; Lights show `◉ ON` |
| **Orient** | — | `Audit <effort-id>. stack_effort_remaining + stack_effort_audit. Reuse live Banking77 meta-thread or stack_worker_thread_create with effort_ref + monitor_profile engineering.` | Audit lists CP gaps; meta-thread + head `thread_id` |
| **Monitor** | — | `stack_meta_thread_set_monitor + stack_ui_open_panel panel=monitor for head thread.` | `worker_run.monitor_enabled`; monitor panel open |
| **CP-1** | — | `stack_worker_run head thread: build Banking77 container to spec, prove /health and /info on owned port. Report stack_worker_run_status after start.` Substantive work uses the default 100-turn budget and stops early on completion. | Image tag + port in effort proof; container health 200 |
| **CP-2** | Poll while running | `stack_worker_run_status + stack_thread_events_read. When idle, stack_worker_continue: run baseline visible-split rollout smoke, record command and metrics.` | Baseline capture in `findings/proof/` |
| **CP-3** | Start GEPA if needed | `Confirm harness locked: container /rollout smoke matches StackEval banking77-local-gepa contract. Record repo refs and findings/code recipe.` | `stack_effort_audit` harness refs present |
| **CP-4** | GEPA on `:8879` | `stack_worker_continue: start local GEPA (oss-gepa), save candidate under findings/code/, attach optimizer-candidate proof for A1.` | A1 claim evidence in audit |
| **CP-5** | Review handoff | `stack_effort_write_handoff + refresh acceptance-summary. stack_effort_audit must pass A0+A1. Report blockers only.` | `audit_status: pass` |

**While a worker run is active**, poll instead of double-starting:

```text
/g stack_worker_run_status for <thread_id> — report state, turns, last exit, stop_reason only.
```

**After each completed turn:**

```text
/g stack_thread_events_read for <thread_id> types worker_run.*,monitor.* limit 12. stack_effort_audit <effort-id>. Name which CP checkpoints are now satisfied.
```

**StackEval receipt (optional gate on CP-3):** `banking77-local-gepa` preset `smoke` — see [`QUALITY.md`](./QUALITY.md). Evidence lands under `.stack/evidence/stackeval/banking77-local-gepa/<stamp>/`.

### 7. Other efforts (same browser pattern)

| Template | Typical work | Effort playbook | Notes |
| --- | --- | --- | --- |
| **`task-classifier`** | Banking77, intent routing | `bundled/efforts/task-classifier/PLAYBOOK.md` | CP ladder above; A0+A1 required |
| **`system-optimizer`** | Reflexion, MAPO, memory | `bundled/efforts/system-optimizer/PLAYBOOK.md` | Replace CP-1/2 with mechanism scaffold + first optimizer eval |
| **`task-agentic`** | Long-horizon agents | `bundled/efforts/task-agentic/PLAYBOOK.md` | CP-2 = first trajectory eval; CP-4 = policy/recipe locked |
| **`engineering`** | Product shipping | `bundled/efforts/engineering/PLAYBOOK.md` | CP-5 = release artifact + handoff |
| **`research`** | Exploratory | `bundled/efforts/research/PLAYBOOK.md` | Lighter CP set — drop optimizer claims unless bound |

Generic browser opener (swap template + objective):

```text
/g stack_effort_templates. Create or resume effort <name> from template <id>.
stack_worker_thread_create with effort_ref + monitor_profile engineering.
Pre-register CP-1..CP-5 in goal acceptance_criteria matching bundled/efforts/<id>/PLAYBOOK.md.
stack_worker_run head thread: <first CP objective>. Report every tool receipt.
```

List templates from the TUI: `/efforts` panel, or gardener `stack_effort_templates`.

### 8. Browser automation checklist (agents / CI)

| Check | Command / probe |
| --- | --- |
| stackd worker routes | `curl -sf http://127.0.0.1:8792/threads/<id>/worker-run/status` |
| GEPA | `curl -sf http://127.0.0.1:8879/health` |
| Container | `curl -sf http://127.0.0.1:<port>/health` |
| Effort audit | Gardener `stack_effort_audit` → `pass` before CP-5 |
| Event log | `stack_thread_events_read` or `GET /threads/<id>/events` |
| TUI input | `#terminal` keydown + Enter (§3); poll `textContent` for `mcp_tool_call` receipts |

**GEPA SQLite:** if `synth-optimizers gepa service` fails on `idempotency_key`, use a fresh DB path (e.g. `.stack/optimizers/gepa-service-fresh.sqlite`) or migrate — stale DBs block CP-4.

---

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

**Gardener cannot spawn a new monitor Codex session** — only attach policy and enable the sidecar on a worker thread.

| Mechanism | What it does | Gardener access |
| --- | --- | --- |
| **`monitor_profile` at create time** | Writes monitor **policy** onto the meta-thread manifest (`default`, `engineering`, `research`, … from `bundled/monitors/`). | **`stack_worker_thread_create`** / **`stack_meta_thread_create`** optional arg |
| **`/monitor on`** on the worker thread | Enables the monitor sidecar runtime (Codex session + wake scheduler). | **Operator only** — or **`stack_meta_thread_set_monitor`** (gardener MCP) |
| Goal-mode auto-enable | When operator is on a worker with an active goal, Stack may auto-enable monitor once per objective (`syncGoalModeDefaults` in `src/tui/app.ts`). | TUI behavior, not gardener-callable |
| **`stack_monitor_goal_status`** | Monitor posts human-visible progress (`for_human: true` → `monitor_headline`). | **Monitor only** — not on gardener allow list |
| **`stack_sidecar_pause_for_restart`** | Monitor batch pause/wake. | **Monitor only** |

`monitor_profile` on the manifest is **policy**, not a guarantee the sidecar is running. For an existing worker, the operator must run **`/monitor on`** (or land on that worker in goal mode).

Bundled monitor profiles: `bundled/monitors/*.toml`.

### Review thread / monitor / effort state

#### Passive context (auto-injected every chat turn)

`buildGardenerChatPrompt` in `src/gardener-chat.ts` prepends this **without** tool calls (via `buildGardenerVisibilityPromptSections` in `src/gardener-visibility.ts`):

| Line | Content |
| --- | --- |
| **Worker threads** | 8-char id · turn count · display label — **no** stdout, tools, or events |
| **Meta-threads** | title · goal status · head thread id (8 chars) · optional `monitor_profile` / **`monitor_headline`** |
| **Default worker target** | Associated worker id (8 chars) from `src/tui/gardener-worker-association.ts` |
| **Target worker trace** | Recent prompts + last exit code (`readWorkerTraceDelta`) when a default worker target is set |
| **Recent monitor events** | Last 6 `monitor.*` lines from the target worker thread event log |
| **Effort audit snapshot** | Compact `auditEffort` summary for the target worker's bound effort (when `effort_ref` is set) |

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
| **`stack_meta_thread_set_monitor`** | Set `monitor_profile` on an existing meta-thread and enable the monitor sidecar on its head worker |
| **`stack_thread_events_read`** | Read recent thread meta-events (`monitor.*`, `worker_run.*`, filters, `for_human_only`) |

Full effort write surface is also on the allow list (`stack_effort_record_*`, `stack_effort_write_handoff`, …) for curation and operator-origin notes — not for reading live worker stdout.

#### What the gardener cannot read

| Surface | Gap |
| --- | --- |
| Worker transcript / stdout / tool calls | No MCP; not in chat prompt |
| **`monitor.*` event log** (live sidecar feed) | No MCP; not in chat prompt |
| Monitor sidecar chat / thread view | Operator-only via monitor panel |
| **`stack_thread_events_read`** (MCP) | **Yes** — gardener can pull bounded event slices on demand |
| Monitor enable on existing run | **`stack_meta_thread_set_monitor`** (profile + enable) or operator **`/monitor on`** |

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

Operator enables monitor on an **existing** worker with **`/monitor on`** on that thread, or the gardener calls **`stack_meta_thread_set_monitor`** (see [`USAGE.md`](./USAGE.md)).

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

1. **Thin passive context** — still no full worker stdout/tools in prompt; trace + monitor events + effort audit are compact snapshots only.
2. **Monitor is opt-in and one-way** — gardener sees recent `monitor.*` lines and `monitor_headline`; not a live pushed stream inside gardener chat.
3. **Evidence is partially passive** — effort audit snapshot is auto-injected when target worker has `effort_ref`; deeper audit still via `stack_effort_audit`.
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

| Gap | Status |
| --- | --- |
| Wire `readWorkerTraceDelta` + recent `monitor.*` into gardener prompt | **Done** — `src/gardener-visibility.ts` |
| Passive effort audit snapshot on wake | **Done** — compact audit for target worker effort |
| MCP to enable monitor on existing meta-thread | **Done** — `stack_meta_thread_set_monitor` + stackd `PATCH /meta-threads/:id/monitor` |
| Thread event read API | **Done** — `stack_thread_events_read` |
| Truncated ids in prompt/Lights | Open — show full target thread id where debugging needs it |
| Lights label confusion | Open — clarify **Actors** (codex subagents) vs **Agents** (durable workers) |
| Full worker stdout / tool tape in gardener prompt | Open — intentionally out of scope; use `stack_thread_events_read` or monitor panel |

---

## Code map

| Area | Path |
| --- | --- |
| Gardener MCP allow list + prompts | `src/gardener-config.ts` — `DEFAULT_GARDENER_CONFIG`, `GARDENER_*_PROMPT` |
| Gardener visibility helpers | `src/gardener-visibility.ts` — trace, monitor events, effort audit, event filters |
| Gardener chat prompt | `src/gardener-chat.ts` — `buildGardenerChatPrompt`, `liveMetaThreadLines` |
| Worker trace delta | `src/gardener-orchestrator.ts` — `readWorkerTraceDelta` |
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
| How does gardener **review** thread/monitor state? | Passive: worker summaries + meta-thread lines + target trace + monitor events + effort audit. Active MCP: **`stack_meta_thread_get`**, **`stack_thread_events_read`**, **`stack_effort_audit`**. |
| What tool **enables monitor** on existing worker? | **`stack_meta_thread_set_monitor`** or operator **`/monitor on`**. |
| Can gardener **subscribe** to monitor updates? | **Passive only** — `monitor_headline` on manifest each chat turn; no live stream. |
| Browser E2E playbook + checkpoints? | **§1–§8** — `browser_tui.py`, CP-1..CP-5 ladder, Banking77 script, other effort templates. |
| How should operator see live progress? | **Monitor panel** on worker thread; gardener opens it via **`stack_ui_open_panel`** or directs you there. |
| Why “no clue what’s going on”? | Thin auto context + monitor off/silent + empty effort receipts + prompt scoped to portfolio orientation, not worker tape. |
