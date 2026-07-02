#!/usr/bin/env bash
# Publish a Stack nightly to BOTH GitHub Releases and the install host from ONE build.
#
# Why: the GitHub release asset and stack.usesynth.ai must serve the SAME tarball for a
# given version (G10 — don't rebuild between destinations, or the same version string ends
# up with two different binaries / sha256s). This script builds once and pushes that exact
# artifact to both.
#
# Prereqs:
#   - gh (authed to synth-laboratories/stack)
#   - wrangler (authed to the Cloudflare account that owns the `stack-install-host` Pages
#     project) — needed only for the host step.
#   - run from the stack repo root on the branch/commit you intend to release (main).
#
# Usage:  scripts/publish_nightly.sh [--skip-host] [--skip-github]
set -euo pipefail
cd "$(dirname "$0")/.."

SKIP_HOST=0
SKIP_GITHUB=0
for arg in "$@"; do
  case "$arg" in
    --skip-host) SKIP_HOST=1 ;;
    --skip-github) SKIP_GITHUB=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

PUBLIC_DOWNLOAD_BASE="${STACK_RELEASE_DOWNLOAD_BASE:-https://stack.usesynth.ai/releases/downloads}"
PAGES_PROJECT="${STACK_PAGES_PROJECT:-stack-install-host}"

VERSION="$(python3 -c 'import json;print(json.load(open("version.json"))["version"])')"
# Match the packager's channel mapping: stable stays stable, everything else (dev) is the nightly channel.
CHANNEL="$(python3 -c 'import json;c=json.load(open("version.json"))["channel"];print("stable" if c=="stable" else "nightly")')"
TAG="v${VERSION}"
echo "publishing Stack ${TAG} (channel ${CHANNEL})"

# 1) Build ONCE. The public download base bakes a branded, host-resolvable URL into the
#    channel manifest, paired with this build's sha256.
echo "==> building release artifact (one build for both destinations)"
STACK_RELEASE_DOWNLOAD_BASE="$PUBLIC_DOWNLOAD_BASE" bun run smoke:release-artifact:local >/dev/null
SITE="$(ls -dt .stack/evidence/release-artifact/*/release-site | head -1)"
OUTDIR="$(cd "$SITE/.." && pwd)"
ARCHIVE="$(ls "$OUTDIR"/stack-*.tar.gz | head -1)"
SHA_FILE="${ARCHIVE}.sha256"
echo "    archive: $ARCHIVE"
echo "    sha256:  $(cut -d' ' -f1 "$SHA_FILE")"

# 2) GitHub release — the SAME tarball + sidecar.
if [ "$SKIP_GITHUB" = "0" ]; then
  echo "==> creating GitHub prerelease ${TAG}"
  gh release create "$TAG" \
    --repo synth-laboratories/stack \
    --target main \
    --prerelease \
    --title "Stack ${TAG} (nightly)" \
    --notes "Nightly ${TAG} (channel ${CHANNEL}, macOS aarch64). Install: curl -fsSL https://stack.usesynth.ai/install.sh | sh — or download the tarball below and verify the .sha256. Same artifact served at stack.usesynth.ai." \
    "$ARCHIVE" "$SHA_FILE"
else
  echo "==> skipping GitHub (--skip-github)"
fi

# 3) Install host (Cloudflare Pages) — the SAME release-site (install.sh + manifests + tarball).
if [ "$SKIP_HOST" = "0" ]; then
  if ! command -v wrangler >/dev/null 2>&1; then
    echo "ERROR: wrangler not found; cannot deploy to the install host." >&2
    echo "       Install + auth wrangler (Cloudflare), then: wrangler pages deploy '$SITE' --project-name=$PAGES_PROJECT --branch=main" >&2
    exit 1
  fi
  echo "==> deploying release-site to Cloudflare Pages ($PAGES_PROJECT)"
  wrangler pages deploy "$SITE" --project-name="$PAGES_PROJECT" --branch=main
else
  echo "==> skipping host (--skip-host). Deploy later with:"
  echo "    wrangler pages deploy '$SITE' --project-name=$PAGES_PROJECT --branch=main"
fi

echo "done: ${TAG} published (one artifact to the selected destinations)"
echo "verify: curl -fsSL https://stack.usesynth.ai/releases/${CHANNEL}.json"
