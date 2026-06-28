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

  python3 - "${config_json}" "${packet_dir}" "${preset_name}" <<'PY'
import json, sys
from datetime import datetime, timezone
from pathlib import Path

config = json.loads(Path(sys.argv[1]).read_text())
packet = Path(sys.argv[2])
preset = sys.argv[3]
now = datetime.now(timezone.utc).isoformat()
meta = {
    "task_id": config["task"]["id"],
    "created_at": now,
    "status": "pipeline_running",
    "preset": preset,
    "pipeline_mode": config["preset"].get("mode", config["pipeline"].get("default_mode", "harness")),
    "default_model": config["task"].get("default_model", config["stack"]["default_model"]),
    "stack_commit": None,
    "jstack_commit": None,
    "packet_dir": str(packet),
    "config_snapshot": config,
}
for repo_key, meta_key in [("stack_root", "stack_commit"), ("jstack_root", "jstack_commit")]:
    import subprocess
    root = config["paths"].get(repo_key)
    if not root:
        continue
    try:
        sha = subprocess.check_output(["git", "-C", root, "rev-parse", "HEAD"], text=True).strip()
        meta[meta_key] = sha
    except Exception:
        pass
(packet / "metadata.json").write_text(json.dumps(meta, indent=2) + "\n")
(packet / "preflight.json").write_text(json.dumps({"generated_at": now, "preset": preset}, indent=2) + "\n")
acceptance = """# Acceptance Checklist

| Gate | Status | Evidence |
| --- | --- | --- |
| SE-B77-1-HARNESS | pending | pipeline harness stage |
| SE-B77-2-RUN | pending | pipeline harness stage |
| SE-B77-3-SCORE | pending | harvest stage |
| SE-B77-4-ARTIFACTS | pending | harvest stage |
| SE-B77-5-TRACE | pending | export stage |
| SE-B77-6-LEVERAGE | pending | grade stage |
"""
(packet / "acceptance.md").write_text(acceptance)
(packet / "waste.md").write_text("# Waste Ledger\n\n| Friction | Time lost | Evidence | Stack leverage that would help |\n| --- | --- | --- | --- |\n| pending | pending | pending | pending |\n")
(packet / "run.md").write_text(f"# StackEval Run: {config['task']['title']}\n\n**Preset:** `{preset}`\n**Status:** pipeline_running\n")
PY

  log "packet prepared at ${packet_dir}"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  prepare_packet "$1" "$2"
fi
