#!/usr/bin/env bash
# Prepare Stack for the public OSS flip (Track 2 A5).
# Run only after A1–A4 are merged and Track 1 quality gates are green.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

echo "[prepare_public_flip] validating tree..."
bun run check
bun run scripts/check_version_drift.ts
make sync-version

echo "[prepare_public_flip] optional smokes (set SKIP_SMOKES=1 to skip)..."
if [[ "${SKIP_SMOKES:-0}" != "1" ]]; then
  bun run scripts/smoke_install_skills.ts
  bun run scripts/smoke_guidance_l2.ts
  make smoke-first-run-local
fi

echo ""
echo "=== Manual steps (operator) ==="
echo "1. Commit all public-prep changes on your release branch."
echo "2. Squash to a clean root commit (O3) when ready — example:"
echo "     git checkout --orphan public-root"
echo "     git add -A"
echo "     git commit -m 'Stack public alpha'"
echo "     git branch -M main"
echo "3. Re-cut nightly candidate: make bump-dev && make launch-candidate (or your cut runbook)."
echo "4. Prove essentials: make launch-nightly1-essentials"
echo "5. LAST — flip GitHub repo visibility to public (Settings → Danger zone)."
echo ""
echo "Do not flip public before steps 1–4 are green."
