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

  local session_id=""
  if [[ -f "${packet_dir}/codex/stack_session_id.txt" ]]; then
    session_id="$(tr -d '[:space:]' <"${packet_dir}/codex/stack_session_id.txt")"
  fi
  if [[ -z "${session_id}" ]]; then
    session_id="$(curl -fsS "${api_url}/status" | python3 -c "import json,sys; d=json.load(sys.stdin); s=d.get('latest_session') or {}; print(s.get('id',''))")"
  fi
  if [[ -z "${session_id}" ]]; then
    log "no latest session in stackd /status; skipping export"
    write_pipeline_state "${packet_dir}" "export" "skipped" "no session"
    return 0
  fi

  python3 "${SCRIPT_DIR}/trace_stackd.py" wait-monitor \
    --config-json "${config_json}" \
    --packet-dir "${packet_dir}" \
    --timeout-seconds 45 \
    --poll-seconds 1

  log "exporting stackd session ${session_id}"
  local export_json
  export_json="$(curl -fsS "${api_url}/threads/${session_id}/export")"
  local export_dir
  export_dir="$(EXPORT_JSON="${export_json}" python3 -c "import json,os; print(json.loads(os.environ['EXPORT_JSON'])['export_dir'])")"

  mkdir -p "${packet_dir}/stack-session"
  cp -R "${export_dir}/." "${packet_dir}/stack-session/stackd-export/" 2>/dev/null || true
  curl -fsS "${api_url}/threads/${session_id}/trace" >"${packet_dir}/codex/trace.json"
  mkdir -p "${packet_dir}/stack-runtime"
  if curl -fsS --max-time 5 "${api_url}/runtime/factory" >"${packet_dir}/stack-runtime/factory.json"; then
    log "exported runtime factory snapshot"
  else
    rm -f "${packet_dir}/stack-runtime/factory.json"
    log "runtime factory snapshot unavailable; continuing"
  fi
  if curl -fsS --max-time 5 "${api_url}/runtime/events?limit=1000" >"${packet_dir}/stack-runtime/events.json"; then
    log "exported runtime events"
  else
    rm -f "${packet_dir}/stack-runtime/events.json"
    log "runtime events unavailable; continuing"
  fi
  if curl -fsS --max-time 5 "${api_url}/status" >"${packet_dir}/stack-runtime/status.json"; then
    log "exported runtime status projection"
  else
    rm -f "${packet_dir}/stack-runtime/status.json"
    log "runtime status projection unavailable; continuing"
  fi
  echo "${session_id}" >"${packet_dir}/codex/stack_session_id.txt"
  write_pipeline_state "${packet_dir}" "export" "ok" "${session_id}"
  log "exported to ${packet_dir}/stack-session/stackd-export"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  export_stackd "$1" "$2"
fi
