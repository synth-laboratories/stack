#!/usr/bin/env bash
# Stage: codex exec independent grader
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

run_grader() {
  local config_json="$1"
  local packet_dir="$2"
  local model prompt_path skip_git
  model="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['grader']['model'])" "${config_json}")"
  prompt_path="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['resolved']['grader_prompt'])" "${config_json}")"
  skip_git="$(python3 -c "import json,sys; print('yes' if json.load(open(sys.argv[1]))['grader'].get('skip_git_repo_check') else 'no')" "${config_json}")"

  if ! command -v codex >/dev/null 2>&1; then
    die "codex CLI not found; install Codex to run grader stage"
  fi

  local prompt_body
  prompt_body="$(cat "${prompt_path}")"
  local user_msg
  user_msg="Grade StackEval packet at ${packet_dir}. Write grade.json and grade.md into that directory. Preset and harvest metadata are in metadata.json, harvest.json, pipeline.json, acceptance.md, run.md, waste.md."

  local -a codex_args=(exec -m "${model}")
  if [[ "${skip_git}" == "yes" ]]; then
    codex_args+=(--skip-git-repo-check)
  fi

  log "running grader (${model})"
  CODEX_PROMPT="${prompt_body}

${user_msg}"
  rm -f "${packet_dir}/grade.json" "${packet_dir}/grade.md"
  pushd "${packet_dir}" >/dev/null
  codex "${codex_args[@]}" "${CODEX_PROMPT}" >"${packet_dir}/grade.stdout.log" 2>"${packet_dir}/grade.stderr.log" || true
  popd >/dev/null

  if [[ ! -f "${packet_dir}/grade.json" ]]; then
    log "grader did not write grade.json; check ${packet_dir}/grade.stderr.log"
    write_pipeline_state "${packet_dir}" "grade" "failed" "missing grade.json"
    return 1
  fi
  write_pipeline_state "${packet_dir}" "grade" "ok" "${packet_dir}/grade.json"
  log "grader wrote ${packet_dir}/grade.json"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  run_grader "$1" "$2"
fi
