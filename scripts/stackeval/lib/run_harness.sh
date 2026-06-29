#!/usr/bin/env bash
# Stage: run pinned GEPA harness from TOML
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

run_harness() {
  local config_json="$1"
  local packet_dir="$2"
  local gepa_config="${packet_dir}/gepa_config.toml"
  local stdout_log="${packet_dir}/gepa_stdout.log"
  local stderr_log="${packet_dir}/gepa_stderr.log"

  local meta
  meta="$(python3 "${SCRIPT_DIR}/render_gepa_config.py" \
    --config-json "${config_json}" \
    --packet-dir "${packet_dir}" \
    --output "${gepa_config}")"

  local gepa_evals_project synth_env
  gepa_evals_project="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['paths']['gepa_evals_project'])" "${config_json}")"
  synth_env="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['paths']['synth_ai_env'])" "${config_json}")"

  source_env_file "${synth_env}"
  local policy_api_key_env
  policy_api_key_env="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['harness'].get('policy_api_key_env','GEMINI_API_KEY'))" "${config_json}")"
  export BANKING77_POLICY_API_KEY_ENV="${BANKING77_POLICY_API_KEY_ENV:-${policy_api_key_env}}"

  log "running GEPA: ${gepa_config}"
  python3 "${SCRIPT_DIR}/trace_stackd.py" ensure-session \
    --config-json "${config_json}" \
    --packet-dir "${packet_dir}" >/dev/null
  if [[ "${STACKEVAL_MONITOR_SKILL_PUSH_PROBE:-0}" =~ ^(1|true|yes|on)$ ]]; then
    python3 "${SCRIPT_DIR}/trace_stackd.py" event \
      --config-json "${config_json}" \
      --packet-dir "${packet_dir}" \
      --type "agent.turn.completed" \
      --actor-id "primary_stackeval" \
      --actor-role "primary" \
      --payload-json "{\"prompt\":\"Run StackEval banking77 local GEPA with synth-optimizers.\",\"summary\":\"Starting local StackEval GEPA coding run before loading Stack skills.\",\"tool\":\"stackeval.gepa\",\"requires_skill_context\":true}"
    python3 "${SCRIPT_DIR}/trace_stackd.py" wait-monitor \
      --config-json "${config_json}" \
      --packet-dir "${packet_dir}" \
      --timeout-seconds 45 \
      --poll-seconds 1 \
      --require-skill-push "synth-via-stack"
  fi
  python3 "${SCRIPT_DIR}/trace_stackd.py" record-skill \
    --config-json "${config_json}" \
    --packet-dir "${packet_dir}" \
    --skill-id "stack-agent-bridge" \
    --actor-id "primary_stackeval" \
    --actor-role "primary" \
    --reason "stackeval_harness_start"
  python3 "${SCRIPT_DIR}/trace_stackd.py" record-skill \
    --config-json "${config_json}" \
    --packet-dir "${packet_dir}" \
    --skill-id "synth-via-stack" \
    --actor-id "primary_stackeval" \
    --actor-role "primary" \
    --reason "stackeval_harness_start"
  python3 "${SCRIPT_DIR}/trace_stackd.py" harness-event \
    --config-json "${config_json}" \
    --packet-dir "${packet_dir}" \
    --phase started \
    --gepa-config "${gepa_config}"
  set +e
  (
    cd "${gepa_evals_project}/.." || exit 1
    uv run --project "${gepa_evals_project}" synth-optimizers gepa run --config "${gepa_config}"
  ) >"${stdout_log}" 2>"${stderr_log}"
  local rc=$?
  set -e

  echo "${meta}" >"${packet_dir}/harness.meta.json"
  if [[ ${rc} -ne 0 ]]; then
    python3 "${SCRIPT_DIR}/trace_stackd.py" harness-event \
      --config-json "${config_json}" \
      --packet-dir "${packet_dir}" \
      --phase failed \
      --gepa-config "${gepa_config}" \
      --exit-code "${rc}" \
      --stdout-log "${stdout_log}" \
      --stderr-log "${stderr_log}"
    die "GEPA harness failed (exit ${rc}); see ${stderr_log}"
  fi
  python3 "${SCRIPT_DIR}/trace_stackd.py" harness-event \
    --config-json "${config_json}" \
    --packet-dir "${packet_dir}" \
    --phase completed \
    --gepa-config "${gepa_config}" \
    --exit-code "${rc}" \
    --stdout-log "${stdout_log}" \
    --stderr-log "${stderr_log}"
  log "GEPA harness completed"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  run_harness "$1" "$2"
fi
