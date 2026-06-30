#!/usr/bin/env bash
# Stage: second Codex reviewer pass on grade.json
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

run_reviewer() {
  local config_json="$1"
  local packet_dir="$2"
  local enabled
  enabled="$(python3 -c "import json,sys; print('yes' if json.load(open(sys.argv[1]))['reviewer'].get('enabled') else 'no')" "${config_json}")"
  if [[ "${enabled}" != "yes" ]]; then
    log "reviewer disabled in pipeline.toml"
    write_pipeline_state "${packet_dir}" "review" "skipped" "disabled"
    return 0
  fi

  if [[ ! -f "${packet_dir}/grade.json" ]]; then
    log "no grade.json; skipping reviewer"
    write_pipeline_state "${packet_dir}" "review" "skipped" "no grade.json"
    return 0
  fi

  local model prompt_path skip_git
  model="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['reviewer']['model'])" "${config_json}")"
  prompt_path="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['resolved']['reviewer_prompt'])" "${config_json}")"
  skip_git="$(python3 -c "import json,sys; print('yes' if json.load(open(sys.argv[1]))['reviewer'].get('skip_git_repo_check') else 'no')" "${config_json}")"

  if ! command -v codex >/dev/null 2>&1; then
    die "codex CLI not found"
  fi

  local prompt_body user_msg
  prompt_body="$(cat "${prompt_path}")"
  user_msg="Review the StackEval grade for packet ${packet_dir}. Write review.json and review.md into that directory."

  local -a codex_args=(exec -m "${model}")
  if [[ "${skip_git}" == "yes" ]]; then
    codex_args+=(--skip-git-repo-check)
  fi

  log "running reviewer (${model})"
  CODEX_PROMPT="${prompt_body}

${user_msg}"
  rm -f "${packet_dir}/review.json" "${packet_dir}/review.md"
  pushd "${packet_dir}" >/dev/null
  codex "${codex_args[@]}" "${CODEX_PROMPT}" >"${packet_dir}/review.stdout.log" 2>"${packet_dir}/review.stderr.log" || true
  popd >/dev/null

  if [[ ! -f "${packet_dir}/review.json" ]]; then
    write_pipeline_state "${packet_dir}" "review" "failed" "missing review.json"
    log "reviewer did not write review.json"
    return 1
  fi
  if ! python3 -m json.tool "${packet_dir}/review.json" >/dev/null 2>"${packet_dir}/review.json.error"; then
    write_pipeline_state "${packet_dir}" "review" "failed" "invalid review.json"
    log "reviewer wrote invalid review.json; check ${packet_dir}/review.json.error"
    return 1
  fi
  write_pipeline_state "${packet_dir}" "review" "ok" "${packet_dir}/review.json"
  log "reviewer wrote ${packet_dir}/review.json"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  run_reviewer "$1" "$2"
fi
