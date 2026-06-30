# Stack distribution and downloads

Stack's public distribution target is a single first-party installer. Package
manager breadth is deferred until each channel has its own install, update,
rollback, and support proof.

## Public target

Stable:

```bash
curl -fsSL https://stack.usesynth.ai/install.sh | sh
stack
```

Nightly:

```bash
curl -fsSL https://stack.usesynth.ai/install.sh | sh -s -- --channel nightly
stack
```

These commands are the target shape. They should not be advertised as live until
release assets, manifests, and download telemetry are actually published.

## Installer contract

The installer implementation lives at `packaging/install.sh`. It is the planned
public script behind `https://stack.usesynth.ai/install.sh` once release assets
and channel manifests are published.

The installer:

1. Detect platform and architecture.
2. Resolve channel metadata from `stack.usesynth.ai`.
3. Fetch a manifest, not hard-coded release logic.
4. Select the matching artifact.
5. Download the artifact.
6. Verify checksum and, for stable, signature/provenance.
7. Unpack into a versioned directory.
8. Atomically move the `current` pointer.
9. Leave the previous version available for rollback.
10. Print the installed version and the next command.

Local contract proof:

```bash
make smoke-installer-contract
make smoke-installer-apply-rollback
make smoke-release-artifact-local
make smoke-release-site-contract
```

Dry-run proof against the example nightly manifest:

```bash
sh packaging/install.sh --channel nightly \
  --manifest packaging/manifests/nightly.example.json \
  --dry-run
```

This proof does not install Stack. It verifies platform detection, manifest
parsing, target artifact selection, and the planned install directories.

The apply/rollback smoke creates local fixture artifacts, installs two versions
into an isolated directory, verifies `current` points at the newer version, and
then rolls back to the previous version.

The local release-artifact smoke creates a tarball, checksum, manifest, and
local `release-site/` mirror under `.stack/evidence/release-artifact/<stamp>/`.
It validates required archive layout, but it is not a publish step.

The release-site contract smoke installs from the generated
`release-site/releases/<channel>.json` manifest into an isolated directory,
runs the installed `stack --version`, proves `stack doctor --json`, writes a
local `stack demo --json` receipt under isolated data, and proves read-only
`stack update --check --json`. This proves the first-party installer, channel
manifest, artifact archive, symlinked user bin, packaged launchers, and first
local value work together locally. The summary must still say
`publishable: true` before the artifact can be uploaded.

Target layout:

```text
~/.local/share/synth-stack/
  versions/
    0.1.0/
      bin/stack
      bin/stackd
      share/stack/VERSION
      share/stack/LICENSE
      share/stack/NOTICE
  current -> versions/0.1.0

~/.local/bin/
  stack -> ~/.local/share/synth-stack/current/bin/stack

~/.config/synth-stack/
  config.toml
```

Do not store credentials in release directories.

## Artifact contract

Stable artifacts should include:

```text
stack-${version}-${target}.tar.gz
stack-${version}-${target}.tar.gz.sha256
stack-${version}-${target}.tar.gz.sig
stack-${version}-${target}.tar.gz.intoto.jsonl
manifest.json
```

Nightly can start narrower, but every artifact must be immutable after publish.
The channel pointer may move; the artifact should not.

Nightly 1 uses an explicit security waiver while signature/provenance automation
is still being wired. The waiver lives in
[`NIGHTLY_1_SECURITY_WAIVER.md`](NIGHTLY_1_SECURITY_WAIVER.md), requires SHA256
verification, and does not apply to stable releases.

Initial supported targets:

```text
aarch64-apple-darwin
x86_64-unknown-linux-musl
```

Additional targets should be added only when install, update, and rollback proof
exists for that platform.

## Channel manifest shape

```json
{
  "schema_version": 1,
  "channel": "nightly",
  "version": "0.2.0-dev.20260629.1",
  "released_at": "2026-06-29T00:00:00Z",
  "yanked": false,
  "targets": {
    "aarch64-apple-darwin": {
      "url": "https://github.com/synth-laboratories/stack/releases/download/...",
      "sha256": "...",
      "size": 12345678
    }
  },
  "notes_url": "https://docs.usesynth.ai/stack/changelog"
}
```

Stable manifests add signature and provenance URLs before public promotion.

Current local artifact proof:

```text
.stack/evidence/release-artifact/20260629T231537Z-0a63dcb2/
.stack/evidence/release-artifact/20260629T233313Z-4c9fe3e4/
.stack/evidence/release-site-contract/20260629T233313Z/
```

The latest proof reports `publishable: true` for the local nightly artifact and
installed activation path. Do not advertise a public hosted installer until
signature/provenance automation or the Nightly 1 waiver, immutable hosting, and
download telemetry are in place.

## Update check contract

`stack update --check` is the non-mutating launch surface. It reads the selected
channel manifest, detects the local platform target, and reports whether an
artifact is available.

```bash
stack update --check
stack update --check --channel nightly
stack update --check --json
stack update --check --manifest packaging/manifests/nightly.example.json
```

The check does not download, unpack, activate, or mutate local install state.
Installer apply and rollback exist in `packaging/install.sh`, but public
Nightly 1 still requires real immutable artifacts, checksums, download
telemetry, and clean install/rollback proof against the selected public
candidate before the hosted installer URL is advertised as live.

## Download measurement

Track downloads without collecting local source code, prompts, transcripts,
artifact bodies, raw paths, secrets, or environment values.

Allowed acquisition events:

```text
stack_docs_cta_clicked
stack_download_clicked
stack_release_asset_downloaded
stack_installer_started
stack_installer_succeeded
stack_installer_failed
```

Download telemetry should be aggregate or browser/request-level. Local Stack
product telemetry remains controlled by the user's telemetry setting; see
[`TELEMETRY.md`](TELEMETRY.md) and the machine-readable
[`TELEMETRY_EVENTS.json`](TELEMETRY_EVENTS.json) allowlist.

Backend ingestion contract:

```bash
make smoke-growth-ingestion
```

The contract maps Stack-specific public acquisition events onto the existing
`POST /api/v1/growth/funnel-events` backend route. A live staging/prod POST
proof is still required before launch readout.
