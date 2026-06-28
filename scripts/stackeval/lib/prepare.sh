#!/usr/bin/env bash
# Stage: prepare packet skeleton
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

prepare_packet() {
  local config_json="$1"
  local packet_dir="$2"
  local task_id preset_name prompt_file
  task_id="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['task']['id'])" "${config_json}")"
  preset_name="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['preset']['name'])" "${config_json}")"
  prompt_file="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['resolved']['prompt_file'])" "${config_json}")"

  mkdir -p "${packet_dir}/stack-session" "${packet_dir}/codex" "${packet_dir}/artifacts/gepa_runs"

  cp "${prompt_file}" "${packet_dir}/initial_prompt.txt"

  python3 "${SCRIPT_DIR}/prepare_packet.py" \
    --config-json "${config_json}" \
    --packet-dir "${packet_dir}" \
    --preset "${preset_name}"

  log "packet prepared at ${packet_dir}"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  prepare_packet "$1" "$2"
fi
