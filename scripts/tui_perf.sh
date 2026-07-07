#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export STACK_TUI_PERF=1
export STACK_TUI_PERF_BLOCKS="${STACK_TUI_PERF_BLOCKS:-800}"
export STACK_TUI_PERF_ITERATIONS="${STACK_TUI_PERF_ITERATIONS:-30}"
export STACK_TUI_PERF_REPORT="${STACK_TUI_PERF_REPORT:-$ROOT/.stack/tui_perf_report.json}"

mkdir -p "$(dirname "$STACK_TUI_PERF_REPORT")"

# Heavy benchmark by default (real transcript + disk meta events + optional live OpenTUI).
# Pass --micro for the old routing-only microbench.
exec bun run src/main.ts tui-perf "$@"
