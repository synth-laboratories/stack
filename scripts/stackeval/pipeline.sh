#!/usr/bin/env bash
# StackEval full pipeline orchestrator (TOML-configured)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="${SCRIPT_DIR}/lib"
# shellcheck source=lib/common.sh
source "${LIB_DIR}/common.sh"

usage() {
  printf '%s\n' \
    "Usage: stackeval run <task-id> [options]" \
    "" \
    "Options:" \
    "  --preset NAME       smoke | dev | gate (default from pipeline.toml)" \
    "  --packet-dir PATH   reuse existing packet directory" \
    "  --from-stage NAME   resume from stage (prepare|preflight|harness|harvest|export|grade|review|finalize)" \
    "  --skip STAGES       comma-separated stages to skip" \
    "  --prepare-only      create packet and exit" \
    "  --no-grade          skip grader + reviewer" \
    "  --no-harness        skip GEPA harness (export/grade only)" \
    "  -h, --help" \
    "" \
    "Examples:" \
    "  stackeval run banking77-local-gepa --preset smoke" \
    "  stackeval run banking77-local-gepa --preset gate --from-stage harvest"
}

TASK=""
PRESET=""
PACKET_DIR=""
FROM_STAGE="prepare"
SKIP_STAGES=""
PREPARE_ONLY=0
NO_GRADE=0
NO_HARNESS=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    run)
      shift
      TASK="${1:-}"
      shift || true
      ;;
    --preset)
      PRESET="$2"
      shift 2
      ;;
    --packet-dir)
      PACKET_DIR="$2"
      shift 2
      ;;
    --from-stage)
      FROM_STAGE="$2"
      shift 2
      ;;
    --skip)
      SKIP_STAGES="$2"
      shift 2
      ;;
    --prepare-only)
      PREPARE_ONLY=1
      shift
      ;;
    --no-grade)
      NO_GRADE=1
      shift
      ;;
    --no-harness)
      NO_HARNESS=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      if [[ -z "${TASK}" ]]; then
        TASK="$1"
      fi
      shift
      ;;
  esac
done

[[ -n "${TASK}" ]] || { usage; exit 1; }

CONFIG_JSON="$(mktemp)"
trap 'rm -f "${CONFIG_JSON}"' EXIT

load_config_json "${TASK}" "${PRESET}" "${STACK_ROOT}" "${CONFIG_JSON}"

if [[ -z "${PRESET}" ]]; then
  PRESET="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['preset']['name'])" "${CONFIG_JSON}")"
fi

if [[ -z "${PACKET_DIR}" ]]; then
  TRACE_ROOT="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['resolved']['trace_root'])" "${CONFIG_JSON}")"
  PACKET_DIR="${TRACE_ROOT}/$(utc_stamp)"
fi
mkdir -p "${PACKET_DIR}"

should_run() {
  local stage="$1"
  if [[ ",${SKIP_STAGES}," == *",${stage},"* ]]; then
    return 1
  fi
  local order="prepare preflight harness harvest export grade review finalize"
  local from_idx=-1 stage_idx=-1
  local i=0
  for s in ${order}; do
    [[ "${s}" == "${FROM_STAGE}" ]] && from_idx=${i}
    [[ "${s}" == "${stage}" ]] && stage_idx=${i}
    i=$((i + 1))
  done
  [[ ${stage_idx} -ge ${from_idx} ]]
}

log "task=${TASK} preset=${PRESET} packet=${PACKET_DIR}"

if should_run prepare; then
  write_pipeline_state "${PACKET_DIR}" "prepare" "running" ""
  "${LIB_DIR}/prepare.sh" "${CONFIG_JSON}" "${PACKET_DIR}"
  write_pipeline_state "${PACKET_DIR}" "prepare" "ok" "${PACKET_DIR}"
fi

if [[ ${PREPARE_ONLY} -eq 1 ]]; then
  log "prepare-only; packet ready"
  echo "stackeval_packet_ready ${PACKET_DIR}"
  exit 0
fi

if should_run preflight; then
  write_pipeline_state "${PACKET_DIR}" "preflight" "running" ""
  SYNTH_ENV="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['paths']['synth_ai_env'])" "${CONFIG_JSON}")"
  if [[ ! -f "${SYNTH_ENV}" ]]; then
    log "warning: ${SYNTH_ENV} missing"
  fi
  if ! command -v uv >/dev/null 2>&1; then
    die "uv not found"
  fi
  write_pipeline_state "${PACKET_DIR}" "preflight" "ok" ""
fi

if should_run harness && [[ ${NO_HARNESS} -eq 0 ]]; then
  write_pipeline_state "${PACKET_DIR}" "harness" "running" ""
  "${LIB_DIR}/run_harness.sh" "${CONFIG_JSON}" "${PACKET_DIR}"
  write_pipeline_state "${PACKET_DIR}" "harness" "ok" ""
fi

if should_run harvest; then
  write_pipeline_state "${PACKET_DIR}" "harvest" "running" ""
  PRESET_JSON="$(mktemp)"
  python3 -c "import json,sys; json.dump(json.load(open(sys.argv[1]))['preset'], open(sys.argv[2],'w'), indent=2)" "${CONFIG_JSON}" "${PRESET_JSON}"
  python3 "${LIB_DIR}/harvest_manifest.py" --packet-dir "${PACKET_DIR}" --preset-json "${PRESET_JSON}"
  rm -f "${PRESET_JSON}"
  write_pipeline_state "${PACKET_DIR}" "harvest" "ok" "${PACKET_DIR}/harvest.json"
fi

if should_run export; then
  write_pipeline_state "${PACKET_DIR}" "export" "running" ""
  "${LIB_DIR}/export_stackd.sh" "${CONFIG_JSON}" "${PACKET_DIR}" || true
fi

if should_run grade && [[ ${NO_GRADE} -eq 0 ]]; then
  write_pipeline_state "${PACKET_DIR}" "grade" "running" ""
  "${LIB_DIR}/run_grader.sh" "${CONFIG_JSON}" "${PACKET_DIR}" || true
fi

if should_run review && [[ ${NO_GRADE} -eq 0 ]]; then
  write_pipeline_state "${PACKET_DIR}" "review" "running" ""
  "${LIB_DIR}/run_reviewer.sh" "${CONFIG_JSON}" "${PACKET_DIR}" || true
fi

if should_run finalize; then
  write_pipeline_state "${PACKET_DIR}" "finalize" "running" ""
  "${LIB_DIR}/finalize.sh" "${CONFIG_JSON}" "${PACKET_DIR}"
  write_pipeline_state "${PACKET_DIR}" "finalize" "ok" ""
fi

log "pipeline complete: ${PACKET_DIR}"
echo "stackeval_pipeline_complete ${PACKET_DIR}"
