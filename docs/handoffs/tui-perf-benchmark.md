# Handoff: Stack TUI perf benchmark

**Operator guide (canonical):** [`docs/PERFORMANCE_TESTING.md`](../PERFORMANCE_TESTING.md)

**Goal:** one shell script whose timings correlate with real Stack TUI latency. If the bench is fast, the app is fast.

**Status:** v2 **real-app** benchmark ships. It boots `runStackApp`, seeds a heavy transcript, and measures the actual `mountView` → `createView` remount path for scroll and keystroke scenarios. As of 2026-07-07, the goal-backed verified run emits 52 rows and all pass current budgets.

---

## Run it

```bash
cd ~/Documents/GitHub/stack
./scripts/tui_perf.sh
```

Options:

```bash
STACK_TUI_PERF_ITERATIONS=20 ./scripts/tui_perf.sh
STACK_TUI_PERF_BLOCKS=1200 ./scripts/tui_perf.sh
./scripts/tui_perf.sh --session=<thread-id>
./scripts/tui_perf.sh --json
./scripts/tui_perf.sh --strict          # exit 1 when any budget fails
./scripts/tui_perf.sh --micro           # routing-only microbench (not representative)
```

Defaults: `iterations=30`, `transcript_blocks=800`, largest on-disk session by turn count.

Takes ~1–2 minutes. Safe to run in Ghostty/iTerm — perf mode uses captured output (no alternate screen, no mouse tracking).

Shipping TUI work should run the external regression + perf bundle:

```bash
cd ~/Documents/GitHub/testing
STACK_REPO_ROOT=~/Documents/GitHub/stack make stack-tui-ship
```

---

## What v2 measures (default)

The default scenarios use the **production code path** inside `runStackApp`:

| Scenario | What it measures |
|----------|------------------|
| `real_full_remount` | `remount()` → full `mountView` / `createView` tree rebuild |
| `real_scroll_pagedown` / `real_scroll_pageup` | transcript page scroll + remount |
| `real_scroll_home` / `real_scroll_end` | transcript jump scroll + remount |
| `real_idle_worker_char` / `real_idle_worker_backspace` | native idle worker input handoff, no remount |
| `real_slash_open` / `real_slash_filter_char` / `real_slash_select_tab` / `real_slash_close` | slash menu edits from native worker input + remount |
| `real_running_worker_char` / `real_running_worker_backspace` | `handleRawInput` edits during running worker + remount |
| `real_running_scroll_pageup` / `real_running_scroll_end` | running/thinking transcript scroll pause + tail resume |
| `real_paste_small` / `real_paste_large` | paste buffer update + remount |
| `real_gardener_char` | gardener input char + remount |
| `real_monitor_char` | monitor input char + remount |
| `real_focus_cycle_tab` / `real_focus_mode_switch_sequence` | focus movement + remount |
| `real_focus_agent_to_gardener` / `real_focus_agent_to_monitor` | side-panel focus remount baselines |
| `real_model_panel_open` / `real_config_panel_open` / `real_config_panel_scroll` | selector/config panel rendering |
| `real_environment_panel_open` / `real_account_panel_open` | environment/account selector rendering |
| `real_projects_panel_open` / `real_projects_panel_scroll` | projects panel rendering and navigation |
| `real_lights_panel_open` | Lights panel layout remount |
| `real_threads_panel_open` / `real_threads_panel_scroll` | threads panel rendering and scroll |
| `real_efforts_panel_open` / `real_efforts_panel_scroll` | efforts panel rendering and navigation |
| `real_ops_panel_open` / `real_ops_panel_scroll` / `real_ops_actors_panel_open` | local ops panel rendering and scroll |
| `real_optimizers_panel_open` / `real_hosted_panel_open` / `real_hosted_panel_scroll` | optimizer panel rendering and navigation |
| `real_remote_panel_open` / `real_remote_panel_scroll` | remote SMR/factory panel rendering and navigation |
| `real_right_panel_close` | panel close remount |
| `real_gardener_chat_scroll` / `real_gardener_events_scroll` | gardener chat and event stream scroll |
| `real_monitor_pane_scroll` | monitor panel scroll |
| `real_goal_tab_switch` | worker chat → goal tab, only when the session has goal metadata |
| `real_spinner_tick` | spinner frame paint-only path |
| `real_paint_only` | `scheduleRender` paint-only path (spinner ticks) |
| `real_large_meta_events` | large synthetic meta-event render stress |
| `real_large_transcript_remount` | larger synthetic transcript remount stress |
| `real_running_transcript` | running worker transcript with live thinking |

Fixture: 800 synthetic transcript blocks seeded into `state.blocks` after real app bootstrap (disk reads, panels, meta events — same as live session).

**Correlation:** proxy microbenches showed 0–10ms while the real app felt 200ms+. The expanded real bench initially showed p50 ~230–350ms for remount scenarios on this machine. After hidden gardener transcript gating, mtime/size caches, gardener transcript reuse, visible-row budgeting for effort detail rendering, and running-scroll pause coverage, the default 30-iteration goal-backed run reports **52 fast / 0 tolerable / 0 slow**.

---

## Example output

```
scenario                  path     samples  p50_ms  p95_ms  speed  budget  ok
real_full_remount         remount  30       14.1    31.5    fast   50.0    ok
real_scroll_pagedown      remount  30       11.6    19.4    fast   50.0    ok
real_running_worker_char  remount  30       11.3    14.6    fast   50.0    ok
real_paint_only           paint    30       0.0     0.5     fast   5.0     ok

speed summary: fast=52 tolerable=0 slow=0
```

---

## Architecture

```
./scripts/tui_perf.sh
  → stack tui-perf
    → runTuiPerfBenchmark (perf-benchmark.ts)
      → runStackApp with STACK_TUI_PERF_BENCH=1
        → runEmbeddedTuiPerfBench (app.ts) after first mount
          → scenarios → storeTuiPerfBenchResults → exit
```

Key files:

| File | Role |
|------|------|
| `scripts/tui_perf.sh` | Entrypoint |
| `src/tui/perf-benchmark.ts` | CLI orchestration |
| `src/tui/perf-harness.ts` | Session picker, fixture seed, result store |
| `src/tui/app.ts` | `runEmbeddedTuiPerfBench` — real remount/input paths |
| `scripts/tui_perf_benchmark.ts` | `--micro` routing-only guard |

---

## Budgets (p95, strict guards)

| Scenario | Budget ms | Notes |
|----------|-----------|-------|
| remount rows | 50 | matches the `fast` p95 threshold |
| `real_idle_worker_*` | 5 | native handoff / no remount |
| `real_paint_only`, `real_spinner_tick` | 5 | spinner paint path |

Budgets are informational in a normal run and hard failures with `--strict`.

---

## Fix work (bench validates these)

1. Full remount on scroll + most keystrokes
2. Double transcript layout on scroll
3. Native Input only on idle worker
4. Keep gardener transcript cache invalidation tied to event/session file changes
5. Tighten budgets now that the full default row set is fast

When fixes land, re-run `./scripts/tui_perf.sh` and tighten budgets.

---

## v3 follow-up (testing repo)

PTY harness in `testing/stack/smoke/` for key-to-pixel latency with `.stack/tui_perf.jsonl` from live sessions.
