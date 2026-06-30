#!/usr/bin/env bash
# Verify a Stack Harbor env-rebuild packet (Docker Harbor test.sh — authoritative).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

usage() {
  cat <<'EOF'
Usage: tictactoe_harbor_verify.sh <packet_dir> [output_json]

Runs Harbor tictactoe_singleplayer_gold tests/test.sh against packet/workspace/candidate.
Uses the Harbor Docker image (same path as ./adapters/harbor/run.sh dev codex).

Environment:
  GAMEBENCH_ROOT              default ~/Documents/GitHub/gamebench
  GAMEBENCH_HARBOR_IMAGE      default gamebench-harbor-ttt-gold:latest
  GAMEBENCH_HARBOR_VERIFY     docker (default) | host
  GAMEBENCH_CANDIDATE_PORT    host mode only, default 19081
EOF
}

PACKET_DIR="${1:-}"
OUTPUT_JSON="${2:-}"

if [[ -z "${PACKET_DIR}" ]] || [[ "${PACKET_DIR}" == "-h" ]] || [[ "${PACKET_DIR}" == "--help" ]]; then
  usage
  exit 0
fi

GAMEBENCH_ROOT="${GAMEBENCH_ROOT:-${HOME}/Documents/GitHub/gamebench}"
HARBOR_BUNDLE="${GAMEBENCH_ROOT}/adapters/harbor/bundles/tictactoe_singleplayer_gold"
CANDIDATE_ROOT="${PACKET_DIR}/workspace/candidate"
VERIFY_DIR="${PACKET_DIR}/verifier"
IMAGE="${GAMEBENCH_HARBOR_IMAGE:-gamebench-harbor-ttt-gold:latest}"
MODE="${GAMEBENCH_HARBOR_VERIFY:-}"
if [[ -z "${MODE}" ]]; then
  if command -v docker >/dev/null 2>&1 && docker image inspect "${IMAGE}" >/dev/null 2>&1; then
    MODE="docker"
  else
    MODE="host"
  fi
fi

if [[ ! -d "${CANDIDATE_ROOT}" ]]; then
  echo "missing candidate workspace: ${CANDIDATE_ROOT}" >&2
  exit 1
fi

if [[ ! -f "${CANDIDATE_ROOT}/scripts/run_service.py" ]]; then
  echo "missing ${CANDIDATE_ROOT}/scripts/run_service.py" >&2
  exit 1
fi

mkdir -p "${VERIFY_DIR}"

if [[ -z "${OUTPUT_JSON}" ]]; then
  OUTPUT_JSON="${VERIFY_DIR}/result.json"
fi

verify_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker not found; set GAMEBENCH_HARBOR_VERIFY=host to use host spectrum_eval" >&2
    exit 1
  fi

  echo "building Harbor image ${IMAGE} (context ${GAMEBENCH_ROOT})"
  docker build -t "${IMAGE}" -f "${HARBOR_BUNDLE}/environment/Dockerfile" "${GAMEBENCH_ROOT}" >/dev/null

  docker run --rm \
    -v "${CANDIDATE_ROOT}:/workspace/candidate:ro" \
    -v "${VERIFY_DIR}:/logs/verifier" \
    -e "GAMEBENCH_CANDIDATE_ROOT=/workspace/candidate" \
    -e "HARBOR_LOG_DIR=/logs/verifier" \
    "${IMAGE}" \
    bash /task/tests/test.sh

  if [[ ! -f "${VERIFY_DIR}/result.json" ]]; then
    echo "verifier did not write ${VERIFY_DIR}/result.json" >&2
    exit 1
  fi

  if [[ ! -f "${OUTPUT_JSON}" ]] && [[ "${OUTPUT_JSON}" != "${VERIFY_DIR}/result.json" ]]; then
    cp "${VERIFY_DIR}/result.json" "${OUTPUT_JSON}"
  fi
}

verify_host() {
  local task_lane="${GAMEBENCH_ROOT}/tasks/tictactoe-singleplayer"
  local venv_py="${GAMEBENCH_ROOT}/.venv/bin/python"

  if [[ ! -x "${venv_py}" ]]; then
    python3 -m venv "${GAMEBENCH_ROOT}/.venv"
    "${GAMEBENCH_ROOT}/.venv/bin/pip" install -q fastapi uvicorn httpx pydantic
  fi

  local board_src="${GAMEBENCH_ROOT}/tasks/tictactoe-multiplayer/gold/board.py"
  local board_dst="${CANDIDATE_ROOT}/gold/board.py"
  if [[ ! -f "${board_dst}" ]] && [[ -f "${board_src}" ]]; then
    mkdir -p "${CANDIDATE_ROOT}/gold"
    cp "${board_src}" "${board_dst}"
  fi

  cd "${task_lane}"
  export PYTHONPATH=.
  export GAMEBENCH_ROOT="${GAMEBENCH_ROOT}"

  "${venv_py}" scripts/spectrum_eval.py \
    --lane http \
    --candidate-root "${CANDIDATE_ROOT}" \
    --candidate-port "${GAMEBENCH_CANDIDATE_PORT:-19081}" \
    --output "${OUTPUT_JSON}"
}

case "${MODE}" in
  docker) verify_docker ;;
  host) verify_host ;;
  *)
    echo "unknown GAMEBENCH_HARBOR_VERIFY=${MODE}" >&2
    exit 1
    ;;
esac

REWARD="$(
  python3 - "${VERIFY_DIR}/result.json" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
if not path.is_file():
    raise SystemExit("missing result.json")
report = json.loads(path.read_text())
print(float(report.get("harbor_reward", report.get("mean_nev_hit_rate", 0.0))))
PY
)"

printf '%s\n' "${REWARD}" >"${VERIFY_DIR}/reward.txt"

python3 - "${VERIFY_DIR}/result.json" "${VERIFY_DIR}/summary.json" "${CANDIDATE_ROOT}" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

result_path = Path(sys.argv[1])
summary_path = Path(sys.argv[2])
candidate_root = sys.argv[3]
report = json.loads(result_path.read_text())
result_summary = report.get("summary") or {}
reward = float(report.get("harbor_reward", result_summary.get("mean_nev_hit_rate", 0.0)))
summary = {
    "verified_at": datetime.now(timezone.utc).isoformat(),
    "candidate_root": candidate_root,
    "harbor_reward": reward,
    "mean_nev_hit_rate": result_summary.get("mean_nev_hit_rate"),
    "mean_public_hit_rate": result_summary.get("mean_public_hit_rate"),
    "mean_checkpoint_hit_rate": result_summary.get("mean_checkpoint_hit_rate"),
    "resolved_scenario_count": result_summary.get("resolved_count"),
    "almost_resolved_count": result_summary.get("almost_count"),
    "scenario_count": result_summary.get("scenario_count"),
    "result_json": str(result_path),
}
summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
print(f"harbor_reward={reward}")
PY

echo "stackeval_verify_complete reward=${REWARD} result=${VERIFY_DIR}/result.json mode=${MODE}"
