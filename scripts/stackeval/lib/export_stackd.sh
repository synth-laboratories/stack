#!/usr/bin/env bash
# Stage: export latest stackd session into packet (when stackd is up)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

export_stackd() {
  local config_json="$1"
  local packet_dir="$2"
  local api_url
  api_url="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['stack']['stack_api_url'])" "${config_json}")"

  if ! curl -fsS --max-time 2 "${api_url}/health" >/dev/null 2>&1; then
    log "stackd not healthy at ${api_url}; skipping export (SE-B77-5-TRACE may be partial)"
    write_pipeline_state "${packet_dir}" "export" "skipped" "stackd unavailable"
    return 0
  fi

  mkdir -p "${packet_dir}/stack-session" "${packet_dir}/stack-runtime"

  local session_id=""
  if [[ -f "${packet_dir}/codex/stack_session_id.txt" ]]; then
    session_id="$(tr -d '[:space:]' <"${packet_dir}/codex/stack_session_id.txt")"
  fi
  if [[ -z "${session_id}" ]]; then
    local status_json="${packet_dir}/stack-runtime/status-for-session.json"
    local status_error="${packet_dir}/stack-session/status-error.log"
    if curl -fsS --max-time 5 "${api_url}/status" >"${status_json}" 2>"${status_error}"; then
      session_id="$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); s=d.get('latest_session') or {}; print(s.get('id',''))" "${status_json}")"
      rm -f "${status_json}"
      rm -f "${status_error}"
    else
      rm -f "${status_json}"
      log "stackd /status unavailable while looking for latest session; continuing with runtime export"
    fi
  fi

  local session_export_ok=0
  local trace_ok=0
  if [[ -n "${session_id}" ]]; then
    local monitor_wait_log="${packet_dir}/stack-session/monitor-wait.log"
    if ! python3 "${SCRIPT_DIR}/trace_stackd.py" wait-monitor \
      --config-json "${config_json}" \
      --packet-dir "${packet_dir}" \
      --timeout-seconds 45 \
      --poll-seconds 1 >"${monitor_wait_log}" 2>&1; then
      log "monitor checkpoint wait did not complete; exporting available stackd/runtime evidence (${monitor_wait_log})"
    fi

    log "exporting stackd session ${session_id}"
    local export_json_path="${packet_dir}/stack-session/export-response.json"
    local export_error="${packet_dir}/stack-session/export-error.log"
    if curl -fsS --max-time 10 "${api_url}/threads/${session_id}/export" >"${export_json_path}" 2>"${export_error}"; then
      rm -f "${export_error}"
      local export_dir
      export_dir="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('export_dir',''))" "${export_json_path}")"
      if [[ -n "${export_dir}" ]]; then
        mkdir -p "${packet_dir}/stack-session/stackd-export"
        cp -R "${export_dir}/." "${packet_dir}/stack-session/stackd-export/" 2>/dev/null || true
        if [[ -f "${packet_dir}/stack-session/stackd-export/manifest.json" ]]; then
          session_export_ok=1
        fi
      fi
    else
      rm -f "${export_json_path}"
      log "stackd session export unavailable for ${session_id}; continuing with runtime export"
    fi

    local trace_error="${packet_dir}/stack-session/trace-error.log"
    if curl -fsS --max-time 10 "${api_url}/threads/${session_id}/trace" >"${packet_dir}/codex/trace.json" 2>"${trace_error}"; then
      rm -f "${trace_error}"
      trace_ok=1
    else
      rm -f "${packet_dir}/codex/trace.json"
      log "stackd thread trace unavailable for ${session_id}; continuing with runtime export"
    fi
    echo "${session_id}" >"${packet_dir}/codex/stack_session_id.txt"
  else
    log "no stack session id available; exporting runtime evidence only"
  fi

  local runtime_ok=1
  local runtime_tick_error="${packet_dir}/stack-runtime/tick-error.log"
  if curl -fsS --max-time 10 -X POST "${api_url}/runtime/tick" >"${packet_dir}/stack-runtime/tick.json" 2>"${runtime_tick_error}"; then
    rm -f "${runtime_tick_error}"
    log "exported fresh runtime tick"
  else
    rm -f "${packet_dir}/stack-runtime/tick.json"
    runtime_ok=0
    log "runtime tick unavailable; exporting last stored runtime state"
  fi
  local runtime_factory_error="${packet_dir}/stack-runtime/factory-error.log"
  if curl -fsS --max-time 5 "${api_url}/runtime/factory" >"${packet_dir}/stack-runtime/factory.json" 2>"${runtime_factory_error}"; then
    rm -f "${runtime_factory_error}"
    log "exported runtime factory snapshot"
  else
    rm -f "${packet_dir}/stack-runtime/factory.json"
    runtime_ok=0
    log "runtime factory snapshot unavailable; continuing"
  fi
  local runtime_events_error="${packet_dir}/stack-runtime/events-error.log"
  if curl -fsS --max-time 5 "${api_url}/runtime/events?limit=1000" >"${packet_dir}/stack-runtime/events.json" 2>"${runtime_events_error}"; then
    rm -f "${runtime_events_error}"
    log "exported runtime events"
  else
    rm -f "${packet_dir}/stack-runtime/events.json"
    runtime_ok=0
    log "runtime events unavailable; continuing"
  fi
  local stackeval_events_error="${packet_dir}/stack-runtime/stackeval-events-error.log"
  if curl -fsS --max-time 5 "${api_url}/runtime/events?limit=1000&source=lever.stackeval" >"${packet_dir}/stack-runtime/stackeval-events.json" 2>"${stackeval_events_error}"; then
    rm -f "${stackeval_events_error}"
    log "exported StackEval runtime lever events"
  else
    rm -f "${packet_dir}/stack-runtime/stackeval-events.json"
    runtime_ok=0
    log "StackEval runtime lever events unavailable; continuing"
  fi
  local runtime_status_error="${packet_dir}/stack-runtime/status-error.log"
  if curl -fsS --max-time 5 "${api_url}/status" >"${packet_dir}/stack-runtime/status.json" 2>"${runtime_status_error}"; then
    rm -f "${runtime_status_error}"
    log "exported runtime status projection"
  else
    rm -f "${packet_dir}/stack-runtime/status.json"
    runtime_ok=0
    log "runtime status projection unavailable; continuing"
  fi
  if [[ ${session_export_ok} -eq 1 && ${trace_ok} -eq 1 && ${runtime_ok} -eq 1 ]]; then
    write_pipeline_state "${packet_dir}" "export" "ok" "${session_id}"
    log "exported to ${packet_dir}/stack-session/stackd-export"
  else
    write_pipeline_state "${packet_dir}" "export" "partial" "${session_id:-runtime-only}"
    log "stackd export partial; acceptance will evaluate available trace/runtime evidence"
  fi
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  export_stackd "$1" "$2"
fi
