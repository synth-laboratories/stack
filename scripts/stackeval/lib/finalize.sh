#!/usr/bin/env bash
# Stage: finalize latest.json pointer + pipeline summary
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

finalize_packet() {
  local config_json="$1"
  local packet_dir="$2"
  python3 "${SCRIPT_DIR}/finalize_packet.py" \
    --config-json "${config_json}" \
    --packet-dir "${packet_dir}"
  log "finalized ${packet_dir} → latest.json updated"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  finalize_packet "$1" "$2"
fi
