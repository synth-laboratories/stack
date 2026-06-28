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

  local session_id
  session_id="$(curl -fsS "${api_url}/status" | python3 -c "import json,sys; d=json.load(sys.stdin); s=d.get('latest_session') or {}; print(s.get('id',''))")"
  if [[ -z "${session_id}" ]]; then
    log "no latest session in stackd /status; skipping export"
    write_pipeline_state "${packet_dir}" "export" "skipped" "no session"
    return 0
  fi

  log "exporting stackd session ${session_id}"
  local export_json
  export_json="$(curl -fsS "${api_url}/threads/${session_id}/export")"
  local export_dir
  export_dir="$(python3 -c "import json,sys; print(json.load(sys.stdin)['export_dir'])" <<<"${export_json}")"

  mkdir -p "${packet_dir}/stack-session"
  cp -R "${export_dir}/." "${packet_dir}/stack-session/stackd-export/" 2>/dev/null || true
  curl -fsS "${api_url}/threads/${session_id}/trace" >"${packet_dir}/codex/trace.json"
  echo "${session_id}" >"${packet_dir}/codex/stack_session_id.txt"
  write_pipeline_state "${packet_dir}" "export" "ok" "${session_id}"
  log "exported to ${packet_dir}/stack-session/stackd-export"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  export_stackd "$1" "$2"
fi
