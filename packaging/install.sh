#!/bin/sh
set -eu

CHANNEL="stable"
CHANNEL_EXPLICIT="0"
MANIFEST=""
DRY_RUN="0"
ROLLBACK="0"
INSTALL_DIR="${STACK_INSTALL_DIR:-$HOME/.local/share/synth-stack}"
BIN_DIR="${STACK_BIN_DIR:-$HOME/.local/bin}"
RELEASE_BASE="${STACK_RELEASE_BASE:-https://stack.usesynth.ai/releases}"

usage() {
  printf '%s\n' "usage: install.sh [--channel stable|nightly] [--manifest <url-or-path>] [--install-dir <dir>] [--bin-dir <dir>] [--dry-run] [--rollback]"
}

fail() {
  printf 'stack installer failed: %s\n' "$1" >&2
  exit 1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --channel)
      [ "$#" -ge 2 ] || fail "missing value for --channel"
      CHANNEL="$2"
      CHANNEL_EXPLICIT="1"
      shift 2
      ;;
    --manifest)
      [ "$#" -ge 2 ] || fail "missing value for --manifest"
      MANIFEST="$2"
      shift 2
      ;;
    --install-dir)
      [ "$#" -ge 2 ] || fail "missing value for --install-dir"
      INSTALL_DIR="$2"
      shift 2
      ;;
    --bin-dir)
      [ "$#" -ge 2 ] || fail "missing value for --bin-dir"
      BIN_DIR="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN="1"
      shift
      ;;
    --rollback)
      ROLLBACK="1"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      fail "unknown argument $1"
      ;;
  esac
done

rollback_install() {
  previous_link="$INSTALL_DIR/previous"
  current_link="$INSTALL_DIR/current"
  [ -L "$previous_link" ] || fail "no previous Stack version recorded"
  previous_target="$(readlink "$previous_link")"
  [ -n "$previous_target" ] || fail "previous Stack version is empty"
  [ -d "$previous_target" ] || fail "previous Stack version directory is missing"
  rm -f "$current_link.next"
  ln -s "$previous_target" "$current_link.next"
  rm -f "$current_link"
  mv -f "$current_link.next" "$current_link"
  ln -sfn "$current_link/bin/stack" "$BIN_DIR/stack"
  ln -sfn "$current_link/bin/stackd" "$BIN_DIR/stackd"
  printf 'rolled_back: %s\n' "$previous_target"
  printf 'current: %s\n' "$current_link"
  printf '%s\n' "stack_installer_rollback_ok"
}

if [ "$ROLLBACK" = "1" ]; then
  [ "$DRY_RUN" = "0" ] || fail "--rollback cannot be combined with --dry-run"
  rollback_install
  exit 0
fi

case "$CHANNEL" in
  stable|nightly) ;;
  dev) CHANNEL="nightly" ;;
  *) fail "unsupported channel $CHANNEL" ;;
esac

detect_target() {
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "$arch" in
    arm64|aarch64) arch="aarch64" ;;
    x86_64|amd64) arch="x86_64" ;;
  esac
  case "$os" in
    darwin) printf '%s\n' "${arch}-apple-darwin" ;;
    linux) printf '%s\n' "${arch}-unknown-linux-musl" ;;
    *) fail "unsupported operating system $os" ;;
  esac
}

require_json_runtime() {
  if command -v python3 >/dev/null 2>&1; then
    printf '%s\n' "python3"
    return 0
  fi
  if command -v node >/dev/null 2>&1; then
    printf '%s\n' "node"
    return 0
  fi
  fail "python3 or node is required to parse the release manifest"
}

json_top() {
  runtime="$1"
  manifest_file="$2"
  key="$3"
  if [ "$runtime" = "python3" ]; then
    python3 -c 'import json,sys; v=json.load(open(sys.argv[1])).get(sys.argv[2],""); print("" if v is None else str(v).lower() if isinstance(v,bool) else v)' "$manifest_file" "$key"
  else
    node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const v=d[process.argv[2]]; process.stdout.write(v === undefined || v === null ? "" : String(v));' "$manifest_file" "$key"
  fi
}

json_target() {
  runtime="$1"
  manifest_file="$2"
  target="$3"
  key="$4"
  if [ "$runtime" = "python3" ]; then
    python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); v=d.get("targets",{}).get(sys.argv[2],{}).get(sys.argv[3],""); print("" if v is None else str(v))' "$manifest_file" "$target" "$key"
  else
    node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const v=((d.targets||{})[process.argv[2]]||{})[process.argv[3]]; process.stdout.write(v === undefined || v === null ? "" : String(v));' "$manifest_file" "$target" "$key"
  fi
}

download() {
  source="$1"
  dest="$2"
  case "$source" in
    http://*|https://*)
      command -v curl >/dev/null 2>&1 || fail "curl is required"
      curl -fsSL "$source" -o "$dest"
      ;;
    *)
      cp "$source" "$dest"
      ;;
  esac
}

verify_sha256() {
  expected="$1"
  file="$2"
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$file" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$file" | awk '{print $1}')"
  else
    fail "sha256sum or shasum is required"
  fi
  [ "$actual" = "$expected" ] || fail "checksum mismatch for downloaded artifact"
}

target="$(detect_target)"
runtime="$(require_json_runtime)"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/stack-install.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT INT TERM HUP

manifest_file="$tmp_dir/manifest.json"
if [ -n "$MANIFEST" ]; then
  manifest_source="$MANIFEST"
  download "$manifest_source" "$manifest_file"
else
  manifest_source="${RELEASE_BASE}/${CHANNEL}.json"
  if ! download "$manifest_source" "$manifest_file" 2>/dev/null; then
    # The default channel (stable) has no published manifest yet — e.g. only nightlies are
    # out. Fall back to nightly so the bare `curl … | sh` one-liner still installs, instead of
    # failing on a 404. An explicit --channel is never silently overridden.
    if [ "$CHANNEL_EXPLICIT" = "0" ] && [ "$CHANNEL" = "stable" ]; then
      CHANNEL="nightly"
      manifest_source="${RELEASE_BASE}/${CHANNEL}.json"
      printf 'no stable release is published yet; falling back to the nightly channel\n' >&2
      download "$manifest_source" "$manifest_file"
    else
      fail "could not download release manifest: $manifest_source"
    fi
  fi
fi

schema_version="$(json_top "$runtime" "$manifest_file" "schema_version")"
[ "$schema_version" = "1" ] || fail "unsupported manifest schema $schema_version"

manifest_channel="$(json_top "$runtime" "$manifest_file" "channel")"
version="$(json_top "$runtime" "$manifest_file" "version")"
yanked="$(json_top "$runtime" "$manifest_file" "yanked")"
artifact_url="$(json_target "$runtime" "$manifest_file" "$target" "url")"
artifact_sha256="$(json_target "$runtime" "$manifest_file" "$target" "sha256")"
notes_url="$(json_top "$runtime" "$manifest_file" "notes_url")"

[ -n "$version" ] || fail "manifest missing version"
[ "$yanked" != "true" ] || fail "manifest $version is yanked"
[ -n "$artifact_url" ] || fail "manifest has no artifact for $target"
[ -n "$artifact_sha256" ] || fail "manifest target $target is missing sha256"

printf 'Stack installer · channel %s · manifest %s\n' "$CHANNEL" "$manifest_source"
printf 'version: %s\n' "$version"
printf 'manifest_channel: %s\n' "$manifest_channel"
printf 'target: %s\n' "$target"
printf 'artifact: %s\n' "$artifact_url"
printf 'install_dir: %s\n' "$INSTALL_DIR"
printf 'bin_dir: %s\n' "$BIN_DIR"
if [ -n "$notes_url" ]; then
  printf 'notes: %s\n' "$notes_url"
fi

if [ "$DRY_RUN" = "1" ]; then
  printf '%s\n' "dry_run: true"
  printf '%s\n' "stack_installer_plan_ok"
  exit 0
fi

command -v tar >/dev/null 2>&1 || fail "tar is required"

archive="$tmp_dir/stack.tar.gz"
download "$artifact_url" "$archive"
verify_sha256 "$artifact_sha256" "$archive"

versions_dir="$INSTALL_DIR/versions"
version_dir="$versions_dir/$version"
tmp_version_dir="$versions_dir/.tmp-$version-$$"
mkdir -p "$versions_dir" "$BIN_DIR"
rm -rf "$tmp_version_dir"
mkdir -p "$tmp_version_dir"
tar -xzf "$archive" -C "$tmp_version_dir"

[ -x "$tmp_version_dir/bin/stack" ] || fail "artifact missing executable bin/stack"
[ -x "$tmp_version_dir/bin/stackd" ] || fail "artifact missing executable bin/stackd"

if [ -L "$INSTALL_DIR/current" ]; then
  current_target="$(readlink "$INSTALL_DIR/current")"
  if [ -n "$current_target" ] && [ "$current_target" != "$version_dir" ]; then
    rm -f "$INSTALL_DIR/previous.next"
    ln -s "$current_target" "$INSTALL_DIR/previous.next"
    mv -f "$INSTALL_DIR/previous.next" "$INSTALL_DIR/previous"
  fi
fi

rm -rf "$version_dir"
mv "$tmp_version_dir" "$version_dir"
rm -f "$INSTALL_DIR/current.next"
ln -s "$version_dir" "$INSTALL_DIR/current.next"
rm -f "$INSTALL_DIR/current"
mv -f "$INSTALL_DIR/current.next" "$INSTALL_DIR/current"
ln -sfn "$INSTALL_DIR/current/bin/stack" "$BIN_DIR/stack"
ln -sfn "$INSTALL_DIR/current/bin/stackd" "$BIN_DIR/stackd"

# Best-effort install funnel signal so real installs show in the Stack activation
# funnel (download stage). Opt out with STACK_NO_TELEMETRY=1. Never blocks or fails
# the install.
if [ -z "${STACK_NO_TELEMETRY:-}" ] && command -v curl >/dev/null 2>&1; then
  _tlm_base="${STACK_TELEMETRY_BASE:-https://api.usesynth.ai}"
  _tlm_body="{\"event_name\":\"skill_download_clicked\",\"correlation_id\":\"installer-${version}-$$\",\"product\":\"stack\",\"metadata\":{\"source\":\"installer\",\"version\":\"${version}\",\"target\":\"${target}\"}}"
  curl -fsS --max-time 4 -X POST "$_tlm_base/api/v1/growth/funnel-events" \
    -H 'content-type: application/json' -d "$_tlm_body" >/dev/null 2>&1 || true
fi

printf 'installed: %s\n' "$version_dir"
printf 'current: %s\n' "$INSTALL_DIR/current"
printf '%s\n' "next: stack doctor"
printf '%s\n' "stack_installer_ok"
