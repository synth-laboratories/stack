#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="${1:-/tmp/stack-gepa-smoke-artifacts}"
RUN_ID="acceptance_openai_baseline_cost_stop_stacksmoke"
RUN_DIR="${OUT_DIR}/${RUN_ID}"

mkdir -p "${RUN_DIR}"

cat > "${RUN_DIR}/candidate_registry.json" <<'EOF'
{
  "candidates": [
    {
      "id": "gepa_2b5dcc0d4a39",
      "role": "seed",
      "train_score": 0.5,
      "heldout_score": 0.5
    },
    {
      "id": "gepa_e0b9ba3c2fc4",
      "role": "best",
      "train_score": 1.0,
      "heldout_score": 0.5,
      "accepted": true
    }
  ],
  "primary_delta": {
    "train": 0.5,
    "heldout": 0.0
  },
  "challenger_dominates": true
}
EOF

cat > "${RUN_DIR}/result_manifest.json" <<EOF
{
  "run_id": "${RUN_ID}",
  "final_state": "finished",
  "tier": "smoke",
  "profile": "openai_baseline",
  "mode": "cost_stop"
}
EOF

printf '%s\n' \
  "STACK_GEPA_SMOKE_OK" \
  "run_id=${RUN_ID}" \
  "seed_train=0.50" \
  "seed_heldout=0.50" \
  "best_train=1.00" \
  "best_heldout=0.50" \
  "train_uplift=+0.50" \
  "challenger_dominates=true" \
  "artifact_dir=${RUN_DIR}" \
  "tier=smoke"
