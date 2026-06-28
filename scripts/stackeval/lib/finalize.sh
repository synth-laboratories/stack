#!/usr/bin/env bash
# Stage: finalize latest.json pointer + pipeline summary
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

finalize_packet() {
  local config_json="$1"
  local packet_dir="$2"
  python3 - "${config_json}" "${packet_dir}" <<'PY'
import json, sys
from datetime import datetime, timezone
from pathlib import Path

config = json.loads(Path(sys.argv[1]).read_text())
packet = Path(sys.argv[2])
task_id = config["task"]["id"]
trace_root = Path(config["paths"]["trace_root"])
latest = {
    "task_id": task_id,
    "packet_dir": str(packet),
    "stamp": packet.name,
    "preset": config["preset"]["name"],
    "status": "pipeline_complete",
    "updated_at": datetime.now(timezone.utc).isoformat(),
}
for name in ("harvest.json", "grade.json", "review.json", "harness.json"):
    p = packet / name
    if p.is_file():
        latest[name.replace(".json", "")] = str(p)
(trace_root / "latest.json").write_text(json.dumps(latest, indent=2) + "\n")
meta_path = packet / "metadata.json"
if meta_path.is_file():
    meta = json.loads(meta_path.read_text())
    meta["status"] = "pipeline_complete"
    meta["finished_at"] = datetime.now(timezone.utc).isoformat()
    meta_path.write_text(json.dumps(meta, indent=2) + "\n")
PY
  log "finalized ${packet_dir} → latest.json updated"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  finalize_packet "$1" "$2"
fi
