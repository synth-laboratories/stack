#!/usr/bin/env bash
# StackEval tmux harness — Codex/agent-driven Stack TUI testing (ncode-style).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="${SCRIPT_DIR}/lib"
# shellcheck source=lib/common.sh
source "${LIB_DIR}/common.sh"

SESSION="${STACKEVAL_HARNESS_SESSION:-stack-stackeval}"
STACKD_WINDOW="stackd"
STACK_WINDOW="stack"
CAPTURE_LINES="${STACKEVAL_HARNESS_CAPTURE_LINES:-80}"
STACK_API_PORT="${STACK_API_PORT:-8792}"
STACK_API_URL="${STACK_API_URL:-http://127.0.0.1:${STACK_API_PORT}}"

usage() {
  printf '%s\n' \
    "Usage: stackeval harness <command> [options]" \
    "" \
    "Commands:" \
    "  prepare TASK [--preset smoke|dev|gate]   prepare packet + operator pickup + tmux up" \
    "  up [--packet-dir PATH]                 start tmux session (stackd + Stack TUI)" \
    "  down                                   kill harness tmux session" \
    "  attach                                 attach to harness tmux session" \
    "  status [--capture-pane] [-o PATH]        stackd + optional pane snapshot JSON" \
    "  capture [-o PATH] [--lines N]          pane + stackd snapshot for Codex" \
    "  export-thread [--thread-id ID]         stackd export into packet dir" \
    "" \
    "Environment:" \
    "  STACKEVAL_PACKET          active StackEval packet directory" \
    "  STACKEVAL_HARNESS_SESSION tmux session name (default: stack-stackeval)" \
    "  STACK_API_URL             stackd base URL (default: http://127.0.0.1:8792)" \
    "" \
    "Codex loop (similar to ncode tmux testing):" \
    "  tail -80 \"\${STACKEVAL_PACKET}/harness.debug.json\"" \
    "  ./bin/stackeval harness capture -o \"\${STACKEVAL_PACKET}/harness.capture.json\"" \
    "  ./bin/stackeval harness export-thread -o \"\${STACKEVAL_PACKET}/harness.export.json\" --packet-dir \"\${STACKEVAL_PACKET}\""
}

require_tmux() {
  command -v tmux >/dev/null 2>&1 || die "tmux is required for StackEval harness"
}

stackd_healthy() {
  curl -fsS "${STACK_API_URL}/health" >/dev/null 2>&1
}

stackd_bin() {
  if [[ -x "${STACK_ROOT}/target/debug/stackd" ]]; then
    echo "${STACK_ROOT}/target/debug/stackd"
    return
  fi
  if [[ -x "${STACK_ROOT}/target/release/stackd" ]]; then
    echo "${STACK_ROOT}/target/release/stackd"
    return
  fi
  die "stackd binary not found; run: cd ${STACK_ROOT} && bun run check"
}

write_operator_pickup() {
  local packet_dir="$1"
  local task="$2"
  local preset="$3"
  mkdir -p "${packet_dir}/harness"
  cat >"${packet_dir}/harness/OPERATOR.md" <<EOF
# StackEval tmux harness — operator pickup

Task: \`${task}\` · preset: \`${preset}\`
Packet: \`${packet_dir}\`

## Start (if not already running)

\`\`\`bash
cd ${STACK_ROOT}
export STACKEVAL_PACKET="${packet_dir}"
./bin/stackeval harness up --packet-dir "${packet_dir}"
\`\`\`

## Codex inspection loop (ncode-style)

Structured state (prefer this over raw pane text):

\`\`\`bash
./bin/stackeval harness status --capture-pane -o "${packet_dir}/harness.debug.json"
tail -80 "${packet_dir}/harness.debug.json"
\`\`\`

Terminal snapshot:

\`\`\`bash
./bin/stackeval harness capture -o "${packet_dir}/harness.capture.json" --lines ${CAPTURE_LINES}
tail -80 "${packet_dir}/harness.capture.pane.txt"
\`\`\`

stackd export into packet (SE-B77-5-TRACE):

\`\`\`bash
./bin/stackeval harness export-thread \\
  --packet-dir "${packet_dir}" \\
  -o "${packet_dir}/harness.export.json"
\`\`\`

## Finish pipeline after human/agent work

\`\`\`bash
cd ${STACK_ROOT}
./bin/stackeval run ${task} --preset ${preset} --packet-dir "${packet_dir}" --from-stage harvest
\`\`\`

Prompt file: \`${packet_dir}/initial_prompt.txt\`
EOF
}

cmd_prepare() {
  local task="" preset="" packet_dir=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --preset)
        preset="$2"
        shift 2
        ;;
      --packet-dir)
        packet_dir="$2"
        shift 2
        ;;
      -h | --help)
        usage
        exit 0
        ;;
      -*)
        die "unknown prepare flag: $1"
        ;;
      *)
        [[ -z "${task}" ]] && task="$1" || die "unexpected prepare argument: $1"
        shift
        ;;
    esac
  done
  [[ -n "${task}" ]] || { usage; exit 1; }

  if [[ -z "${packet_dir}" ]]; then
    local config_json
    config_json="$(mktemp)"
    trap 'rm -f "${config_json}"' RETURN
    load_config_json "${task}" "${preset}" "${STACK_ROOT}" "${config_json}"
    if [[ -z "${preset}" ]]; then
      preset="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['preset']['name'])" "${config_json}")"
    fi
    local trace_root
    trace_root="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['resolved']['trace_root'])" "${config_json}")"
    packet_dir="${trace_root}/$(utc_stamp)"
  fi

  "${SCRIPT_DIR}/pipeline.sh" run "${task}" --preset "${preset}" --packet-dir "${packet_dir}" --prepare-only
  write_operator_pickup "${packet_dir}" "${task}" "${preset}"
  export STACKEVAL_PACKET="${packet_dir}"
  cmd_up "${packet_dir}"
  log "operator pickup: ${packet_dir}/harness/OPERATOR.md"
  echo "stackeval_harness_prepare_ok packet=${packet_dir}"
}

cmd_up() {
  local packet_dir="${1:-${STACKEVAL_PACKET:-}}"
  require_tmux

  if tmux has-session -t "${SESSION}" 2>/dev/null; then
    log "tmux session ${SESSION} already exists"
  else
    local stackd_cmd stack_cmd
    stackd_cmd="cd '${STACK_ROOT}' && export STACK_API_PORT='${STACK_API_PORT}' STACK_API_URL='${STACK_API_URL}' STACKD_MONITOR_SCHEDULER=0; $(stackd_bin) serve"
    stack_cmd="cd '${STACK_ROOT}' && export STACK_API_URL='${STACK_API_URL}'"
    if [[ -n "${packet_dir}" ]]; then
      stack_cmd+=" STACKEVAL_PACKET='${packet_dir}' STACKEVAL_STACK_ROOT='${STACK_ROOT}'"
    fi
    stack_cmd+="; ./bin/stack"

    if stackd_healthy; then
      log "stackd already healthy at ${STACK_API_URL}; starting Stack pane only"
      tmux new-session -d -s "${SESSION}" -n "${STACK_WINDOW}" "${stack_cmd}"
    else
      tmux new-session -d -s "${SESSION}" -n "${STACKD_WINDOW}" "${stackd_cmd}"
      tmux new-window -t "${SESSION}:" -n "${STACK_WINDOW}" "${stack_cmd}"
      local deadline=$((SECONDS + 15))
      while [[ ${SECONDS} -lt ${deadline} ]]; do
        if stackd_healthy; then
          break
        fi
        sleep 0.5
      done
      stackd_healthy || die "stackd did not become healthy at ${STACK_API_URL}"
    fi
    log "tmux session ${SESSION} started (attach: stackeval harness attach)"
  fi

  if [[ -n "${packet_dir}" ]]; then
    export STACKEVAL_PACKET="${packet_dir}"
  python3 "${LIB_DIR}/tmux_harness.py" \
    status --tmux-session "${SESSION}:${STACK_WINDOW}" \
    --capture-pane \
    -o "${packet_dir}/harness.debug.json" \
    --lines "${CAPTURE_LINES}" >/dev/null
    log "debug snapshot: ${packet_dir}/harness.debug.json"
  fi

  echo "stackeval_harness_up_ok session=${SESSION} stack_api=${STACK_API_URL}"
}

cmd_down() {
  require_tmux
  if tmux has-session -t "${SESSION}" 2>/dev/null; then
    tmux kill-session -t "${SESSION}"
    log "killed tmux session ${SESSION}"
  else
    log "no tmux session ${SESSION}"
  fi
  echo "stackeval_harness_down_ok"
}

cmd_attach() {
  require_tmux
  tmux has-session -t "${SESSION}" 2>/dev/null || die "no harness session ${SESSION}; run: stackeval harness up"
  exec tmux attach -t "${SESSION}"
}

cmd_status() {
  local output="" capture_pane=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -o | --output)
        output="$2"
        shift 2
        ;;
      --capture-pane)
        capture_pane=1
        shift
        ;;
      --lines)
        CAPTURE_LINES="$2"
        shift 2
        ;;
      *)
        shift
        ;;
    esac
  done
  local args=(status --tmux-session "${SESSION}:${STACK_WINDOW}" --lines "${CAPTURE_LINES}")
  [[ ${capture_pane} -eq 1 ]] && args+=(--capture-pane)
  [[ -n "${output}" ]] && args+=(-o "${output}")
  python3 "${LIB_DIR}/tmux_harness.py" "${args[@]}"
}

cmd_capture() {
  local output=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -o | --output)
        output="$2"
        shift 2
        ;;
      --lines)
        CAPTURE_LINES="$2"
        shift 2
        ;;
      *)
        shift
        ;;
    esac
  done
  [[ -n "${output}" ]] || output="${STACKEVAL_PACKET:-/tmp}/harness.capture.json"
  python3 "${LIB_DIR}/tmux_harness.py" \
    capture --tmux-session "${SESSION}:${STACK_WINDOW}" \
    -o "${output}" --lines "${CAPTURE_LINES}"
}

cmd_export_thread() {
  local output="" thread_id="" packet_dir="${STACKEVAL_PACKET:-}"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -o | --output)
        output="$2"
        shift 2
        ;;
      --thread-id)
        thread_id="$2"
        shift 2
        ;;
      --packet-dir)
        packet_dir="$2"
        shift 2
        ;;
      *)
        shift
        ;;
    esac
  done
  [[ -n "${output}" ]] || output="${packet_dir}/harness.export.json"
  local args=(export-thread -o "${output}")
  [[ -n "${thread_id}" ]] && args+=(--thread-id "${thread_id}")
  [[ -n "${packet_dir}" ]] && args+=(--packet-dir "${packet_dir}")
  python3 "${LIB_DIR}/tmux_harness.py" "${args[@]}"
}

COMMAND="${1:-}"
shift || true

case "${COMMAND}" in
  prepare)
    cmd_prepare "$@"
    ;;
  up)
    packet=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --packet-dir)
          packet="$2"
          shift 2
          ;;
        *)
          shift
          ;;
      esac
    done
    cmd_up "${packet}"
    ;;
  down)
    cmd_down
    ;;
  attach)
    cmd_attach
    ;;
  status)
    cmd_status "$@"
    ;;
  capture)
    cmd_capture "$@"
    ;;
  export-thread)
    cmd_export_thread "$@"
    ;;
  -h | --help | help | "")
    usage
    ;;
  *)
    die "unknown harness command: ${COMMAND}"
    ;;
esac
