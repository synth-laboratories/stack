#!/usr/bin/env bash
# StackEval shared shell helpers
set -euo pipefail

STACKEVAL_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACKEVAL_ROOT="$(cd "${STACKEVAL_LIB_DIR}/.." && pwd)"
STACK_ROOT="$(cd "${STACKEVAL_ROOT}/../.." && pwd)"

log() {
  printf '[stackeval] %s\n' "$*"
}

die() {
  printf '[stackeval] ERROR: %s\n' "$*" >&2
  exit 1
}

resolve_jstack_root() {
  if [[ -n "${JSTACK_ROOT:-}" ]]; then
    printf '%s' "$(cd "${JSTACK_ROOT}" && pwd)"
    return 0
  fi
  local candidate="${STACK_ROOT}/../Jstack"
  if [[ -d "${candidate}/.jstack" ]]; then
    printf '%s' "$(cd "${candidate}" && pwd)"
    return 0
  fi
  die "JSTACK_ROOT not set and default ${candidate} missing"
}

utc_stamp() {
  date -u +%Y%m%dT%H%M%SZ
}

load_config_json() {
  local task="$1"
  local preset="$2"
  local jstack_root="$3"
  local out="$4"
  python3 "${STACKEVAL_LIB_DIR}/config.py" \
    --jstack-root "${jstack_root}" \
    --task "${task}" \
    --preset "${preset}" \
    --json >"${out}"
}

config_field() {
  local config_json="$1"
  local field="$2"
  python3 -c "import json,sys; c=json.load(open(sys.argv[1])); v=c${field}; print(v if not isinstance(v,(dict,list)) else json.dumps(v))" "${config_json}" 2>/dev/null || true
}

source_env_file() {
  local env_file="$1"
  if [[ -f "${env_file}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${env_file}"
    set +a
  fi
}

write_pipeline_state() {
  local packet_dir="$1"
  local stage="$2"
  local status="$3"
  local detail="${4:-}"
  python3 "${STACKEVAL_LIB_DIR}/pipeline_state.py" \
    --packet-dir "${packet_dir}" \
    --stage "${stage}" \
    --status "${status}" \
    --detail "${detail}"
}
