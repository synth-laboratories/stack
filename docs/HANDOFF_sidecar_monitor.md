# Sidecar Monitor — Product Spec & Engineering Handoff

**Audience:** the engineer owning the Stack sidecar monitor.
**Status:** 2026-07-01. Supervision + rich thread render + model display + clean human-facing events feed are built and tested. Read §2 (locked decisions) and §5–§6 (what the human sees) first.

---

## 0. One paragraph

The **worker** is a goal-seeking agent. The **monitor** ("sidecar") is a persistent Codex agent paired 1:1 with it. Its product job is to be **the human's window into a running goal**: a supervisor that watches the worker's event stream and produces a **human-facing feed that explains what the worker is doing and what progress toward the goal is being made**, intervenes on the worker within a bounded authority, and stays out of the way otherwise. It amplifies the operator's attention — one person can supervise a long autonomous run by reading the monitor, not the raw worker tape. It never does the task and never replaces the human's judgment on whether the goal is met.

---

## 1. Product vision

- **The monitor is an interpreter, not a logger.** It compresses the worker's raw activity (tool calls, turns, errors, output) into a narration a human actually wants: *"located the Craftax lane → baseline pinned at 0.0871 → worker stuck on a missing module, nudged it → candidate 0.11 is below the 0.17 target, rejected the done-claim."*
- **Two things the human wants from it, always:** (a) **what is the worker doing right now / just did**, and (b) **are we making progress toward the goal** (and if not, why — blocked, stuck, off-goal).
- **Amplify, don't automate.** The loop closes through the human for anything irreversible or identity/quality-level. The monitor surfaces and nudges; the human decides. (See the firm-wide principle: `feedback_no_code_actor_quality_verdicts` — agents own quality/completion verdicts, code owns only liveness/existence/proof.)

---

## 2. The three LOCKED design decisions (Josh, 2026-06-30)

These were decided explicitly. Do not silently change them.

1. **Authority = nudge + pause.** The monitor may (a) **steer** the worker with advisory nudges, and (b) **pause** the worker before a risky/irreversible action (a pause always escalates to human/gardener). It may **NOT** redirect the goal, edit criteria, or force a handoff. On a persistent stall it *wakes the gardener*, which owns handoffs. Monitor detects; gardener acts.
2. **Done = worker self-marks, monitor audits.** The **worker** owns the completion verdict and marks a criterion done. The monitor **audits** that claim against cited proof (verify/eval artifact) → `audit-clean` or `audit-failed`. Code marks nothing; the monitor marks nothing. A false/unproven claim → the monitor **refutes** it in the feed.
3. **Quiet by default — but produce a real narration feed.** This is the subtle one and the reconciliation of Josh's later reminders: **"quiet" means no NOISE, not "say nothing."** The feed must narrate the worker's *meaningful* activity and progress. What is banned is redundant/empty output: raw `NO_USER_UPDATE` lines, generic "checkpoint advanced" filler, restating unchanged status, re-steering an already-flagged issue. The test for any feed entry: *would a human watching want this?* If it adds no information, suppress it. If it explains a real step or a real progress change, emit it.

> **The volume bar, restated for the feed:** emit when the worker (a) starts a distinct new phase of work, (b) hits a milestone / criterion transition (with the concrete result — the number/artifact), (c) is stuck/blocked/off-goal (a concern), or (d) you steered/paused it (say what and why). Suppress routine tool churn, "no new progress," and repeats.

---

## 3. Behavior during goal-seeking — the per-wake contract

Each time the monitor wakes, the runtime hands it: **wake reason · goal objective + criteria + blockers · the event batch since its cursor · recent worker transcript tail · last checkpoint · elapsed goal time · elapsed since last worker event · pending operator messages · worker status.**

The monitor decides, in order:

1. **Progress verdict** — one of: `advancing` · `working` · `stalled` · `stuck` · `off-goal` · `blocked` · `risky-pending` · `done-claimed`. Assess from evidence (events / transcript / worker output); **never fabricate progress**.
2. **Audit** — for any `done-claimed` criterion, confirm/refute against cited proof (§2.2).
3. **Narrate to the human?** — emit a feed update when there is real signal (§2.3 bar). Cite the concrete outcome (score/number/artifact), not "progress made."
4. **Steer?** — on `stuck` / `off-goal` / missing-next-step, emit a concise nudge. **Once per issue** (don't repeat a steer for the same unresolved failure).
5. **Pause?** — on `risky-pending` (irreversible action imminent), pause + escalate.
6. **Checkpoint** — update internal state, advance cursor.
7. **Sleep** — call `stack_sidecar_pause_for_restart` and yield.

**Worked example (the canonical craftax goal — "find the setting, baseline on 100 seeds, grind a candidate to 2×"):** the feed should read, over the run:
- *"Worker located the Craftax code-policy lane in `gamebench/NOTES.md`; policy summary scores 0.1355 / 14 achievements. No blocker."*
- *"Baseline pinned: `heuristic_baseline.py` = 0.0871 on the 100-seed sweep. Runtime knob confirmed. Moving to candidate selection."*
- *(worker hits the same `ModuleNotFoundError` 3×)* → **steer** *"stop retrying the missing module; find the real Craftax entrypoint."*
- *(worker about to `git reset --hard` the eval dir)* → **pause + escalate** *"worker wants to hard-reset the eval dir — confirm?"*
- *(worker marks 2× done with candidate 0.11)* → **refute** *"candidate 0.11 is below the 0.17 2× target — criterion not met."*

---

## 4. Wake / sleep / event-sync — the runtime loop

The monitor is a **self-scheduling agent**: it wakes on a cursor, does a pass, sleeps. Two parallel implementations share the on-disk actor-state schema (`stack/monitor-actor-state/v1`) and delegate the wake decision to one hot-swappable Python policy (`scripts/monitor_wake_policy.py`).

- **TS in-process:** `src/monitor.ts` (`nextWakeCandidate`, `runMonitorForNewEvents`), driven by the TUI.
- **Rust scheduler:** `crates/stackd/src/monitor_scheduler.rs`, polls ~500ms, **only queues** (`monitor.trigger_queued`) — the TUI/JS runs the actual LLM pass. (A headless self-scheduling monitor would need a server-side pass runner — noted gap.)

**Wake layers** (all in `[wake]` config, `.stack/monitors/*.toml`): immediate (tool_failed / error / turn_completed / operator_message / goal_change) · event-batch (every K worker events, K=8, min-interval 30s) · time cadence (≥ every 3m while goal active + worker running) · staleness (5m of worker silence). Dedup: already-running → merge into one queued trigger.

**Sleep:** `stack_sidecar_pause_for_restart` (`src/mcp/server.ts`) appends `monitor.pause_for_restart` and yields. Note `next_wake_on` is currently written and **not read** — the monitor cannot yet choose its own next-wake time (gap).

**Event-sync:** per-actor cursor `last_event_id` on `.stack/actors/<threadId>/monitors/<actorId>.json`; a classifier drops the monitor's own `monitor.*` events so it never wakes on its own noise.

---

## 5. Events the monitor writes — the taxonomy (HUMAN-FACING vs INTERNAL)

The monitor's LLM emits three markers in its message text — `PROGRESS_UPDATE: …`, `STEER_WORKER: …`, `NO_USER_UPDATE` — parsed by `parseSidecarDirectives` (`src/monitor.ts`) and turned into typed events. All emitted `monitor.*` event types:

| Event | Meaning | Surface |
| --- | --- | --- |
| **`monitor.progress`** | a human-facing progress narration | **HUMAN — the feed** |
| **`monitor.steer`** | a nudge sent to the worker (payload: message, `trigger_signature`, source) | **HUMAN — the feed** (say what + why) |
| **`monitor.summary`** | per-pass checkpoint summary; carries `summary`/`goal_snapshot`/`focus_results`. Sometimes just `NO_USER_UPDATE` | **MIXED** — show only when substantive |
| `monitor.wake` | the runtime woke the monitor (reason + wake_id) | INTERNAL |
| `monitor.trigger_queued` | a wake merged while the monitor was busy | INTERNAL |
| `monitor.checkpoint` | cursor advanced after review | INTERNAL |
| `monitor.pause_for_restart` | the monitor went back to sleep | INTERNAL |
| `monitor.usage` | token/cost of the pass | INTERNAL (drives the cost strip) |
| `monitor.queued` | a queued intervention item | INTERNAL/rare |
| `monitor.skill_context_push` | monitor pushed a skill to the worker | HUMAN (rare) |
| `monitor.operator_message` / `monitor.chat.request` / `monitor.chat.reply` | operator↔sidecar chat | HUMAN (chat) |
| `monitor.error` | a monitor pass failed | HUMAN (surface the failure class) |
| `monitor.paused` / `monitor.resumed` / `monitor.mode_changed` | monitor lifecycle | INTERNAL |

**Design rule for the feed:** the human-facing events feed shows the **HUMAN** rows (progress, steer, substantive summary, concerns, chat, errors) and **suppresses the INTERNAL mechanics** (wake, trigger_queued, checkpoint, pause_for_restart, usage) and the empty `NO_USER_UPDATE` summaries. Today it does NOT — that's the main open task (§8).

**Future consideration:** the monitor currently narrates only via its final message markers. A cleaner model is a **dedicated feed-write tool** the monitor calls explicitly (e.g. `monitor_note(kind, text, evidence)`) so a feed entry is a deliberate typed action with evidence ids, not a parsed prefix. Consider this when you touch the prompt.

---

## 6. The two TUI surfaces — what the human should see

In goal mode the operator toggles between two sub-views inside the sidecar panel (`t` thread / `e` events), plus a `chat`/`progress` view tab.

### 6a. `Sidecar thread` — the monitor's own transcript (the "how")
Renders the monitor's Codex conversation **exactly like the worker chat**: interleaved **thinking** + grouped **tool calls** + its **message**, via the shared renderer (`blocksFromTurnStdout` + `renderTranscriptStyledView`, `src/tui/transcript.ts`). Purpose: see *how the monitor is reasoning*. As of this session it:
- renders rich (worker-grade), not the old flat line list;
- **filters runtime mechanics**: drops the `stack_sidecar_pause_for_restart` tool + its output, de-dups the bridge's start+complete double-emit, drops `NO_USER_UPDATE` quiet wakes, strips the `PROGRESS_UPDATE:`/`STEER_WORKER:` prefixes so the message reads as prose (`cleanSidecarStdout` in `src/tui/monitor-thread.ts`);
- **shows the monitor's model** on a line inside the box (`monitor · gpt-5.4-mini · medium`). (Kept out of the border title on purpose — a long title gets truncated in the narrow split layout and clips the "Sidecar thread" anchor.)

### 6b. `Sidecar events` — the human-facing narration FEED (the "what")
This is the feed the human reads to follow the run: **what the worker is doing + progress toward goal.** Renderer: `renderGoalShutterStreamStyled` (`src/tui/monitor-thread.ts`). The goal shutter now defaults here, not to the raw sidecar thread. It shows only the HUMAN-facing events from §5 (progress / steer / concern / audit / chat reply / errors) and suppresses internal mechanics: `NO_USER_UPDATE`, wake/checkpoint/pause/usage rows, raw worker tool churn, and repetitive "checkpoint advanced" filler. The raw worker/monitor event tape remains available through `a agent tape`; the sidecar's own reasoning remains available through `t thread`.

### 6c. Header / cost
The goal strip shows `status · criteria X/Y · elapsed · worker $ · monitor $` (consolidated to one line to give the thread room). Monitor cost comes from `monitor.usage`.

---

## 7. Invariants (musts / must-nots)

**Musts:** feed narrates real worker activity + progress · every assessment cites evidence · `done` needs `audit-clean` proof · steer once per issue (code-enforced via `trigger_signature` dedup) · a pause always escalates · the monitor's own events never wake it or count as worker progress · secrets in worker output are redacted before entering the event log (`redactSecrets`, `src/core-agent-events.ts`).
**Must-nots:** not a logger (interprets, never transcribes) · not a second worker · never hard-blocks except via the granted `pause_worker` · never redirects the goal · never forces a handoff · never a code-level quality verdict · never shows runtime mechanics (pause tool, checkpoints) or `NO_USER_UPDATE` in the human feed.

**Monitor grant set** (its `[tools] allow` under the locked decisions): `{ progress_update, steer, pause_worker, block_before_action, escalate, audit, wake-gardener }` — explicitly **not** `{ mark_done, redirect_goal, handoff.force, edit_criteria }`. Widening this grant is an autonomy-ladder move, gated.

---

## 8. Current implementation state

**Built + tested this session:**
- Goal mode defaults to the clean `Sidecar events` feed + compact goal summary; `t` opens the persistent sidecar Codex thread/chat, `e` returns to events, `a` toggles the raw agent/monitor tape, and resume no longer forces the worker chat open just because prior turns exist.
- The default events feed filters runtime mechanics and quiet markers (`NO_USER_UPDATE`, checkpoint/pause/wake/usage rows, raw worker tool churn) while preserving human-facing `monitor.progress`, `monitor.steer`, substantive summaries, chat replies, skill pushes, and errors.
- Real supervision proven with a real brain (not canned): progress-with-specifics, steer-on-stuck, audit-refutes-bogus-done-claim, quiet-on-trivia — `scripts/accept_monitor_supervision.ts` (`smoke:monitor:supervision`, real gpt-5.4-mini, 5 scenarios, stable).
- Layered wake cadence (event-batch + time + staleness); steer-once dedup keyed on the failing-command **`trigger_signature`** (robust to rewording); no-progress-announcement suppression; secret redaction across the whole event pipeline (JWT/Stripe/Google/AWS/PEM/URL-creds/JSON-form, redact-before-truncate).
- Two root-split bug fixes: `monitorRuntimeRoot` fails loud instead of silently falling back to `appRoot`; the sidecar transcript co-locates with events/actor-state under `stackDataRoot`.
- **Thread panel** rich render (worker-grade) + model display (§6a).
- Better slash-command errors (a registered command is never "unknown"; typos get "did you mean").
- Deterministic guardrail tests: `smoke:monitor:logic` (38), `smoke:sidecar:render` (19), `smoke:slash:errors` (11), `smoke:goal-shutter` — no LLM, milliseconds.
- TUI acceptance: `smoke:tui:e2e:layout` verifies default events controls, switching into `Sidecar thread`, sidecar input placement, and no quiet/runtime leakage.
- End-to-end GameBench UX acceptance: `smoke:goal-mode:ux` starts the Craftax code-policy goal, verifies the default monitor feed + goal summary, persisted sidecar transcript under `stackDataRoot`, and operator↔sidecar chat request/reply.

**PENDING — do these next:**
1. **Make the monitor narrate worker *activity* more richly, not only criterion transitions.** It now emits clean human-facing rows, but the prompt should keep improving toward *"worker is now searching for the baseline eval script"* level updates. Consider a dedicated `monitor_note` feed-write tool (§5) so the model writes typed feed entries with evidence instead of prefix-parsed message text.
2. **Structural per-criterion state machine** (`open → worker-marked-done → audit-clean|failed`) — criteria are still a flat `done/total` count; the audit is prompt-level, not typed.
3. **`risky-pending` → pause+escalate** is prompt-level only; `pause_worker` exists as a permission/flag but there's no wired "pause before irreversible action" emission path.
4. **Self-scheduling gaps:** honor a model-supplied next-wake (`next_wake_on` is dead data); server-side pass runner so wake→run doesn't require the TUI attached; enforce `max_wakes_per_primary_turn` (written, not enforced).

---

## 9. Key files

| Area | Path |
| --- | --- |
| Monitor pass / wake / dedup / audit-parse | `src/monitor.ts` |
| Sidecar Codex runner + developer prompt | `src/monitor-sidecar-codex.ts` |
| Worker→event pipeline + redaction | `src/core-agent-events.ts` |
| Wake policy (hot-swappable) | `scripts/monitor_wake_policy.py` |
| Rust scheduler (queues triggers) | `crates/stackd/src/monitor_scheduler.rs` |
| Monitor actor state / cursor | `crates/stack-core/src/meta_thread_state.rs`, `.stack/actors/<t>/monitors/<a>.json` |
| **Thread panel render** (rich) + feed render | `src/tui/monitor-thread.ts` (`renderGoalSidecarThreadRich`, `cleanSidecarStdout`, `renderGoalShutterStreamStyled`, `monitorRuntimeWakeMessage`) |
| Shared transcript renderer | `src/tui/transcript.ts` (`blocksFromTurnStdout`, `renderTranscriptStyledView`) |
| Goal shutter layout (panels + strip + model line) | `src/tui/goal-shutter.ts` |
| Sidecar options wiring | `src/tui/app.ts` (`sidecarTranscriptRenderOptions`) |
| Monitor profiles (`[wake]`, permissions) | `.stack/monitors/*.toml` (`default`, `progress-narrator`, `handoff-preempt-gamebench`) |
| Pause tool | `src/mcp/server.ts` (`stack_sidecar_pause_for_restart`) |
| Tests | `scripts/smoke_monitor_logic.ts`, `scripts/smoke_sidecar_render.ts`, `scripts/accept_monitor_supervision.ts`, `scripts/accept_goal_mode_ux.ts` |

---

## 10. Open decisions for the engineer

1. **Feed authoring model:** keep parsing markers from the message, or move to an explicit `monitor_note(kind, text, evidence_ids)` tool? (Recommend the tool — deliberate typed feed entries with evidence beat prefix-parsing.)
2. **How chatty is "narrate activity"?** §2.3 sets the bar (meaningful phases + progress + concerns), but the exact granularity of "what the worker is doing" is a taste call — pick a target and encode it in the prompt + a real-brain acceptance scenario.
3. **Events feed vs thread panel division of labor:** confirm thread = monitor's reasoning, events = human narration. Should the events feed also surface a compact worker-activity line (from `agent.*` events) so the human sees worker actions even between monitor updates?
4. **Model/effort routing:** the monitor runs `gpt-5.4-mini medium` by default; is that the right tier for narration quality, or bump for the audit/steer judgment?

**How to validate any change:** `bunx tsc --noEmit` · `cargo check -p stackd` / `cargo build -p stackd` when touching TUI e2e · deterministic smokes (`smoke:monitor:logic`, `smoke:sidecar:render`, `smoke:slash:errors`, `smoke:goal-shutter`) · `smoke:tui:e2e:layout` (panel layout) · `smoke:goal-mode:ux` (full TUI GameBench flow) · `smoke:monitor:supervision` (real-brain behavior). Add a real-brain acceptance scenario for any new feed behavior — event *counts* from a faked sidecar prove plumbing, not supervision.
