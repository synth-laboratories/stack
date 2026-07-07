# Stack performance testing

**Audience:** Stack engineers and agents working on TUI latency, remount behavior, or operator UX.

**Principle:** If the perf bench is fast, the real app is fast. The default benchmark runs the **production** `runStackApp` → `mountView` → `createView` path — not routing stubs or isolated string formatters.

**Implementation handoff:** [`docs/handoffs/tui-perf-benchmark.md`](./handoffs/tui-perf-benchmark.md) (file map, budgets, migration notes).

---

## Quick start

From the Stack repo:

```bash
cd ~/Documents/GitHub/stack
./scripts/tui_perf.sh
```

Equivalent:

```bash
bun run tui:perf
stack tui-perf
```

Success prints an ASCII timing table and `tui_perf_ok`. A typical healthy run on current main takes **several minutes** (30 iterations across the default real-app scenario set).

For TUI shipping, run the regression battery and strict perf guard from the testing repo:

```bash
cd ~/Documents/GitHub/testing
STACK_REPO_ROOT=~/Documents/GitHub/stack make stack-tui-ship
```

That target runs deterministic transcript/slash/remount checks, PTY scroll smokes,
then `stack tui-perf --strict`. Running/thinking transcript scroll is covered by
the `real_running_scroll_pageup` and `real_running_scroll_end` benchmark assertions.

### Options

| Flag / env | Purpose |
| --- | --- |
| `STACK_TUI_PERF_ITERATIONS=20` | Fewer samples (faster run) |
| `STACK_TUI_PERF_BLOCKS=1200` | Heavier synthetic transcript (stress layout) |
| `./scripts/tui_perf.sh --session=<thread-id>` | Benchmark against a specific on-disk session |
| `./scripts/tui_perf.sh --json` | Machine-readable output |
| `STACK_TUI_PERF_REPORT=/tmp/tui_perf.json` | Write JSON report (default: `.stack/tui_perf_report.json`) |
| `./scripts/tui_perf.sh --strict` | Exit 1 if any scenario exceeds its p95 budget |
| `./scripts/tui_perf.sh --micro` | Routing-only microbench (~sub-ms; **not** representative of felt lag) |

### Safe to run in your terminal

Perf mode does **not** take over alternate screen, mouse tracking, or Kitty keyboard. Output is captured during the run; the shell should stay usable. If the terminal looks wrong after an older build, run `reset` and pull latest.

### Resource health

Latency is not the only perf signal. Stack perf work must also keep live process count, memory, swap, and `.stack` artifact growth under control.

Before and after long perf/regression runs, check:

```bash
pgrep -fl '^bun'
vm_stat
df -h /System/Volumes/Data
du -sh ~/.stack ~/Documents/GitHub/stack/.stack
```

Current incident baseline from 2026-07-07:

- 15+ orphaned `bun run .../stack/src/main.ts` processes exhausted swap (`30 GB total`, `29.5 GB used`).
- Several orphaned Stack Bun processes reached ~8.6-9.3 GB resident-equivalent footprints.
- Disk pressure was high (`/System/Volumes/Data` at 92% full, 37 GiB free).
- Product `.stack` state was 2.1 GB with ~24.6k files.

Normal TUI startup is guarded by [`src/startup-process-guard.ts`](../src/startup-process-guard.ts). Defaults:

| Env | Default | Meaning |
| --- | --- | --- |
| `STACK_MAX_LIVE_INSTANCES` | `3` | Refuse TUI startup when existing Stack Bun main processes exceed this |
| `STACK_MAX_ORPHANED_INSTANCES` | `1` | Refuse TUI startup when orphaned Stack Bun main processes exceed this |
| `STACK_STARTUP_PROCESS_GUARD=0` | unset | Disable the guard for intentional parallel runs only |

The TUI ship command also runs resource preflight/postflight checks. Defaults:

| Env | Default | Meaning |
| --- | --- | --- |
| `STACK_TUI_SHIP_MAX_EXISTING_STACK_BUN` | `0` | Fail ship checks if stale Stack Bun main processes already exist |
| `STACK_TUI_SHIP_MAX_ORPHANED_STACK_BUN` | `0` | Fail ship checks if any orphaned Stack Bun main process exists |
| `STACK_TUI_SHIP_MAX_SWAP_GIB` | `24` | Fail when macOS swap usage is near exhaustion |
| `STACK_TUI_SHIP_MIN_DISK_FREE_GIB` | `20` | Fail when local disk has too little free space for safe harness runs |
| `STACK_TUI_SHIP_MAX_STACK_STATE_GIB` | `8` | Fail when product `.stack` state needs retention cleanup |
| `STACK_TUI_PERF_TIMEOUT_MS` | `720000` | Bound the strict perf subprocess in the ship battery |

If perf or regression work creates orphaned Stack Bun processes, treat it as a release-blocking dev-loop bug until explained. The likely fix belongs in the launcher/test harness lifecycle, not in manual cleanup. Storage growth also needs an explicit retention policy for `.stack` evidence, garden, session, and capture artifacts before it becomes routine operator friction.

---

## How to read the table

Example:

```text
scenario                  path     samples  p50_ms  p95_ms  speed      min_ms  max_ms  budget  ok
real_full_remount         remount  30       14.1    31.5    fast       12.1    36.1    50.0    ok
real_scroll_pagedown      remount  30       11.6    19.4    fast       10.2    23.4    50.0    ok
real_running_worker_char  remount  30       11.3    14.6    fast       10.4    15.7    50.0    ok
real_gardener_char        remount  30       10.7    13.0    fast       8.7     16.9    50.0    ok
real_paint_only           paint    30       0.0     0.0     fast       0.0     0.1     5.0     ok

speed summary: fast=52 tolerable=0 slow=0
```

| Column | Meaning |
| --- | --- |
| `p50_ms` / `p95_ms` | Primary signals — median and tail latency |
| `path` | `remount` = full tree rebuild; `paint` = `scheduleRender` only; `native` = OpenTUI input handoff / no remount |
| `speed` | Felt-latency label: `fast`, `tolerable`, or `slow` |
| `budget` | p95 regression guard; `--strict` fails when exceeded |
| `ok` | p95 ≤ budget |

`--strict` now enforces the fast floor for the embedded real-app benchmark: remount rows use a 50ms p95 budget, while native/paint rows use 5ms. Speed labels still show the wider felt-latency bands: remount rows are `fast` at p95 ≤ 50ms, `tolerable` at p95 ≤ 150ms, and `slow` above 150ms; native/paint/micro rows are `fast` at p95 ≤ 5ms, `tolerable` at p95 ≤ 16ms, and `slow` above 16ms.

**Current rating (2026-07-07, 30-iteration real-app run):**

- **52/52 scenarios green** against fast-threshold budgets in the goal-backed verified run.
- **Speed summary:** **52 fast / 0 tolerable / 0 slow**.
- **Native worker input:** p50 ~0.1-0.2ms.
- **Paint-only path:** p50 ~0ms.
- **Common remounts:** p50 ~10-20ms after hidden gardener transcript work was skipped, meta-event/session reads were cached, and repeated gardener transcript construction was cached.
- **Strict guard:** remount budget is capped at 50ms p95, matching the `fast` threshold.
- **Visible gardener transcript paths:** now fast after cached gardener transcript reuse (`real_gardener_chat_scroll` p50 ~9ms, p95 ~16ms in the verified run).
- **Efforts/projects panels:** now fast after avoiding rich file-backed effort detail generation beyond the visible row budget.

When you land a perf fix, re-run the bench and **tighten budgets** in `runEmbeddedTuiPerfBench` (`src/tui/app.ts`) so regressions show up as `FAIL`.

---

## What runs under the hood

```text
./scripts/tui_perf.sh
  → stack tui-perf  (src/tui/perf-benchmark.ts)
    → STACK_TUI_PERF_BENCH=1, STACK_TUI_SMOKE_NO_AUTOMATION=1
    → runStackApp (real bootstrap: config, session, gardener, harness probe)
      → OpenTUI renderer (perf-safe: capture-stdout, no mouse/alternate screen)
      → seed 800-block heavy transcript into state.blocks
      → runEmbeddedTuiPerfBench (src/tui/app.ts)
      → graceful teardown → print table → tui_perf_ok
```

### Key files (product repo)

| File | Role |
| --- | --- |
| [`scripts/tui_perf.sh`](../scripts/tui_perf.sh) | **Canonical entrypoint** |
| [`src/tui/perf-benchmark.ts`](../src/tui/perf-benchmark.ts) | CLI orchestration, `--micro` delegate |
| [`src/tui/perf-harness.ts`](../src/tui/perf-harness.ts) | Session picker, fixture seed, result store |
| [`src/tui/perf-fixture.ts`](../src/tui/perf-fixture.ts) | Heavy transcript fixture builder |
| [`src/tui/perf.ts`](../src/tui/perf.ts) | Table formatter, optional live `STACK_TUI_PERF=1` hooks |
| [`src/tui/app.ts`](../src/tui/app.ts) | `runEmbeddedTuiPerfBench` — real scenarios |
| [`scripts/tui_perf_benchmark.ts`](../scripts/tui_perf_benchmark.ts) | `--micro` routing regression guard |

Live TUI sessions can append timing events to `.stack/tui_perf.jsonl` when `STACK_TUI_PERF=1` (hooks in `remount-coordinator.ts`). The default bench does not require a live session.

---

## Current scenarios (v2)

The default scenarios execute **inside** `runStackApp` after the first real mount. Goal-backed sessions include one extra goal-tab row; the 2026-07-07 verified run emits **52** rows.

| Scenario | Operator action proxied | Code path |
| --- | --- | --- |
| `real_full_remount` | Background refresh / arbitrary state bump | `remount()` → `mountView` → `createView` |
| `real_scroll_pagedown` | Page down in agent transcript | `handleAgentScrollKey` + remount |
| `real_scroll_pageup` | Page up in agent transcript | `handleAgentScrollKey` + remount |
| `real_scroll_home` | Jump to oldest agent transcript line | `handleAgentScrollKey` + remount |
| `real_scroll_end` | Jump back to live tail | `handleAgentScrollKey` + remount |
| `real_idle_worker_char` | Type in idle worker prompt | Native input handoff / no remount |
| `real_idle_worker_backspace` | Delete in idle worker prompt | Native input handoff / no remount |
| `real_slash_open` | Open `/` menu from native worker input | `noteInputBufferEdit` + remount |
| `real_slash_filter_char` | Type inside open slash menu | slash-menu edit + remount |
| `real_slash_select_tab` | Select/complete from slash menu | `handleRawInput` + remount |
| `real_slash_close` | Close slash menu by clearing buffer | slash-menu edit + remount |
| `real_running_worker_char` | Type while worker is running (steer draft) | `handleRawInput` → remount per char |
| `real_running_worker_backspace` | Delete while worker is running | `handleRawInput` → remount |
| `real_running_scroll_pageup` | Page up while worker is running/thinking | `handleAgentScrollKey` pauses live tail-follow + remount |
| `real_running_scroll_end` | Return to live tail while worker is running/thinking | `handleAgentScrollKey` resumes tail-follow + remount |
| `real_paste_small` | Paste short text into worker prompt | paste buffer update + remount |
| `real_paste_large` | Paste large multiline text into worker prompt | paste buffer update + remount |
| `real_gardener_char` | Type in gardener prompt | `handleRawGardenerInput` → remount |
| `real_monitor_char` | Type in monitor prompt | `handleRawMonitorInput` → remount |
| `real_focus_cycle_tab` | Press Tab from agent chat | `handleRawInput` focus cycle + remount |
| `real_focus_agent_to_gardener` | Focus gardener panel | focus state change + remount |
| `real_focus_agent_to_monitor` | Focus monitor panel | focus state change + remount |
| `real_focus_mode_switch_sequence` | Agent → gardener → monitor → ops sequence | focus state changes + remount |
| `real_model_panel_open` | Open model picker | selector panel remount |
| `real_config_panel_open` | Open config panel | selector panel remount |
| `real_config_panel_scroll` | Move config panel selection | `handleConfigKey` + remount |
| `real_environment_panel_open` | Open environment panel | selector panel remount |
| `real_account_panel_open` | Open account panel | selector panel remount |
| `real_projects_panel_open` | Open projects panel | projects panel remount |
| `real_projects_panel_scroll` | Move projects selection | `handleProjectsFocusKey` + remount |
| `real_lights_panel_open` | Open Lights panel shape | panel state change + remount |
| `real_threads_panel_open` | Open threads panel | panel state change + remount |
| `real_threads_panel_scroll` | Scroll threads panel | `handleThreadsMouseScroll` + remount |
| `real_efforts_panel_open` | Open efforts panel | panel state change + remount |
| `real_efforts_panel_scroll` | Move efforts selection | `handleEffortsKey` + remount |
| `real_ops_panel_open` | Open local ops panel | ops panel remount |
| `real_ops_panel_scroll` | Scroll local ops panel | `handleOpsKey` + remount |
| `real_ops_actors_panel_open` | Open actors ops panel | ops panel remount |
| `real_optimizers_panel_open` | Open local optimizers focus | ops panel remount |
| `real_hosted_panel_open` | Open hosted optimizers panel | hosted panel remount |
| `real_hosted_panel_scroll` | Move hosted optimizer selection | `handleHostedOptimizerKey` + remount |
| `real_remote_panel_open` | Open remote SMR/factory panel | remote panel remount |
| `real_remote_panel_scroll` | Move remote selection | `handleRemoteKey` + remount |
| `real_right_panel_close` | Close an open right panel | panel state change + remount |
| `real_gardener_chat_scroll` | Scroll gardener chat transcript | `handleGardenerChatScrollKey` + remount |
| `real_gardener_events_scroll` | Scroll gardener event stream | `scrollGardenerPane` + remount |
| `real_monitor_pane_scroll` | Scroll monitor panel | `handleMonitorScrollKey` + remount |
| `real_goal_tab_switch` | Worker chat → goal tab | `selectWorkerPanelView` + remount; emitted only for goal-backed sessions |
| `real_spinner_tick` | Spinner frame changes | `scheduleRender` only |
| `real_paint_only` | Spinner tick / unchanged tree | `scheduleRender` only |
| `real_large_meta_events` | Render many meta events | synthetic meta event state + remount |
| `real_large_transcript_remount` | Full remount with larger synthetic transcript | fixture reseed + remount |
| `real_running_transcript` | Running worker transcript with live thinking | running state + remount |

Fixture: **800 synthetic blocks** (user, thinking, tool, agent, stack) with large paragraphs, seeded after bootstrap. Session: largest on-disk session by turn count (or `--session=`).

### Micro mode (`--micro`)

Sub-millisecond checks that routing invariants still hold (`shouldUseNativeAgentInput`, slash remount decisions). Use for **regression guards**, not product latency proof. Complements [`smoke:tui-input-fuzz`](../package.json) (routing fuzz).

---

## Scenarios still outside default coverage

The product repo now covers the app's main panels, input paths, scroll paths, selector panels, paint path, and data-weight stress through the embedded real-app benchmark. Remaining gaps are either known-broken under perf mode or belong in `testing/`.

| Proposed scenario | Why |
| --- | --- |
| `real_lights_panel_scroll` | Right-panel thread list scroll; currently exits perf mode before remount completes (see Jstack papercut) |
| `pty_key_to_paint` | `testing/stack/smoke/tui_perf_live.ts` (future) |
| `pty_scroll_in_running_session` | Future key-to-pixel proof for live terminal scroll while a worker is running |
| `cold_start_to_first_paint` | Time from `stack` launch to first frame |
| `real_long_session_restore` | Needs a restore/cold-start harness, not the already-mounted embedded bench |

Product repo owns **microbench + real-app bench**; `testing/` owns terminal integration proof.

---

## Known issues (bench-validated)

These are the dominant costs today. The bench exists to prove each fix.

### 1. Full remount on most interactions

**Symptom:** many layout/focus changes still call `remount()`, although the common hidden-panel remount floor is now ~10-20ms.

**Cause:** `refresh()` → `remountCoordinator.remountNow()` → `mountView()` destroys the entire OpenTUI tree and re-runs `createView()` (~1500 lines, all panels).

**Target fix:** Scroll and plain typing use `scheduleRender` or in-place `Text` updates; reserve remount for layout/focus changes.

**Target metric:** `real_scroll_pagedown` p50 **< 20ms**; char scenarios **< 10ms**.

---

### 2. Native input only on idle worker

**Symptom:** `real_idle_worker_char` stays near 0ms, but `real_running_worker_char` / gardener / monitor still pay the remount floor.

**Cause:** `shouldUseNativeAgentInput` returns true only for `status === "idle"`. Other modes use `handleRawTextInputSequence`, which calls `refresh()` on **every character** ([`src/tui/input-paste.ts`](../src/tui/input-paste.ts)).

**Target fix:** Extend native OpenTUI `Input` to gardener/monitor/running steer; remount only when `slashMenuEditNeedsRemount` (pattern already used for idle via `inputFastPathNeedsRemount`).

**Target metric:** char scenarios p50 **< 5ms** for plain text.

---

### 3. Double transcript layout on scroll

**Symptom:** Scroll path pays full remount plus redundant layout work inside `createView`.

**Cause:** `maxTranscriptScrollOffset` runs during scroll handling and again during transcript render; scroll always triggers remount.

**Target fix:** Cache scroll bounds in `AppState`; invalidate on blocks/tools/viewport change; scroll updates offset + paint only.

---

### 4. Rich visible panels still do full file-backed summaries

**Symptom:** visible gardener transcript rows and efforts/projects panels were the slowest rows even after hidden-panel work was skipped.

**Cause:** gardener transcript rendering rebuilt rich chat blocks for visible gardener views; efforts panel rendered artifact/audit/progress details for every effort before slicing to visible rows.

**Landed:** hidden gardener transcript work is gated by visible surfaces; center panels read gardener events without building gardener chat; `readThreadMetaEvents` and gardener session-turn reads use mtime/size caches; gardener chat transcript construction is cached; efforts panel detail generation stops once the visible row budget is full.

**Next target:** scroll/input fast paths that avoid remount entirely, then tighten scenario budgets to keep the new all-fast floor.

**Verified metric:** `real_gardener_chat_scroll` p50 **~9ms**; `real_efforts_panel_open` p50 **~20ms** in the 2026-07-07 30-iteration run.

---

### 5. Paint path works — expand it

**Symptom:** `real_paint_only` ~0ms.

**Cause:** `scheduleRender` → `requestRender` without tree rebuild (see `remount-coordinator.ts`).

**Action:** Route spinner ticks, scroll, and native input display through this path; shrink remount surface area.

---

## Recommended fix order

| Phase | Work | Primary scenarios affected |
| --- | --- | --- |
| **P0** | Scroll fast-path | `real_scroll_pagedown`, `real_scroll_pageup`, `real_scroll_home`, `real_scroll_end` |
| **P1** | Native input extension | `real_running_worker_char`, `real_gardener_char`, `real_monitor_char` |
| **P2** | Meta-event cache + lazy panels (partly landed) | `real_full_remount`, `real_large_transcript_remount`, focus/panel scenarios |
| **P3** | Incremental mount / stable shell | All remount scenarios |
| **P4** | PTY harness in `testing/` | key-to-pixel, cold start |

After each phase: run `./scripts/tui_perf.sh`, paste p50/p95 into the PR, tighten budgets.

---

## Developer workflow

### Before starting TUI perf work

1. Run `./scripts/tui_perf.sh` and save the table (or JSON report).
2. Note machine, terminal emulator, and `session=` if not default.
3. Identify which scenario matches the UX you are fixing.

### While implementing

- Prefer changes that move a scenario from `remount` path to `paint` or `native`.
- Do not lower budgets without measured improvement.
- Add a new scenario when you fix a surface not covered by the default set.

### Before merge

1. Re-run `./scripts/tui_perf.sh`.
2. Compare p50/p95 for affected scenarios.
3. Update budgets in `runEmbeddedTuiPerfBench` if targets moved permanently.
4. Mention perf delta in PR description (numbers, not vibes).

### Optional strict gate

```bash
./scripts/tui_perf.sh --strict
```

Use locally or in CI **outside** this repo when a release train wants a hard fail. Stack product repo keeps `--strict` opt-in so informational budgets do not block unrelated work.

---

## Repo boundaries

| In `stack` (this doc) | Outside `stack` |
| --- | --- |
| `./scripts/tui_perf.sh`, `stack tui-perf` | PTY driving, expect/tmux harnesses |
| Real-app embedded bench in `app.ts` | `testing/stack/smoke/*` integration smokes |
| Routing microbench (`--micro`) | `synth-dev` CI wrappers |
| Live hooks → `.stack/tui_perf.jsonl` | Release proof packets in Jstack |

See [`DEVELOPERS.md`](./DEVELOPERS.md) — microbench/probe scripts in `stack/scripts/` are product tooling; full verification harnesses stay in `testing/`, `evals/`, `synth-dev/`.

---

## Related commands

```bash
# Routing invariant fuzz (fast, not latency)
bun run smoke:tui-input-fuzz

# Typecheck product
bun run check
```

---

## Glossary

| Term | Meaning |
| --- | --- |
| **Remount** | Full OpenTUI tree destroy + `createView` rebuild |
| **Paint** | `scheduleRender` / `requestRender` only |
| **Native input** | OpenTUI `Input` widget; typing without remount |
| **Real-app bench** | `STACK_TUI_PERF_BENCH=1` path through `runStackApp` |
| **Fixture blocks** | Synthetic transcript seeded into `state.blocks` for stress |

---

## Agent instruction

When changing TUI input, scroll, or remount behavior:

1. Run `./scripts/tui_perf.sh` before and after.
2. Cite scenario names and p50/p95 deltas in the PR.
3. Add scenarios for new surfaces; tighten budgets when fixes stick.
4. Do not add PTY harness code to `stack/` — propose it for `testing/` instead.
