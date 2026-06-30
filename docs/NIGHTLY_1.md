# Stack Nightly 1 launch packet

This packet lines up the first public-facing nightly without launching it.
Nightly 1 is a dogfood/early-tester channel, not a stable release.

Status: Nightly 1 is not launched.

## Product promise

```text
Install Stack.
Run locally without Synth signup.
See local-ready state.
Run a first local workflow.
Get a receipt.
Sign in only for hosted Synth features.
```

Nightly 1 may carry rough edges. It must not ship with broken install metadata,
known Rust/TS contract drift, secret/privacy regressions, silent data corruption,
or docs that claim a live path that is not live.

## Public command targets

Nightly installer target, once assets and manifests are live:

```bash
curl -fsSL https://stack.usesynth.ai/install.sh | sh -s -- --channel nightly
stack
```

Contributor/internal fallback before public assets are live:

```bash
git clone git@github.com:synth-laboratories/stack.git
cd stack
make install
stack
```

## Readiness gates

| Stage | Nightly 1 requirement |
| --- | --- |
| `S0_SCOPE` | Channel, audience, known limits, and no-go claims are recorded. |
| `S1_STATIC` | `quality:static` exists and is runnable before candidate share. |
| `S2_RUST_SERVER` | stackd owns state; meta-thread contract drift is not known at ship time. |
| `S3_TS_CLIENT` | TUI remains a typed stackd client; no direct writes to stackd-owned resources. |
| `S4_TUI_BOMBADIL` | Bombadil B0 green before broad dogfood; B1 if handoff/update/auth flow is touched. |
| `S5_LOCAL_PRODUCT` | First local workflow and receipt path are available or explicitly excluded from Nightly 1. |
| `S6_DISTRIBUTION` | Installer/download path either works or docs clearly say source install only. |
| `S7_AUTH_GROWTH` | Auth is optional; anonymous telemetry is on by default, disclosed, and disabled with `stack telemetry off`. |
| `S8_DOCS_CHANGELOG` | README, docs, and changelog agree on channel and status. |
| `S9_SHIP_READOUT` | Dogfood readout records installs, activations, receipts, issues, and next owner. |

Run the inventory:

```bash
make launch-readiness
```

Write evidence for a candidate:

```bash
bun run launch:readiness -- --write-evidence
bun run launch:nightly1 -- --write-evidence
bun run launch:candidate -- --write-evidence
```

Freeze the candidate only after the worktree is clean and the SHA is the build
that will back the published manifest:

```bash
bun run launch:candidate -- --select --write-evidence
```

Rust/server contract proof for meta-thread handoffs:

```bash
bun run smoke:meta-threads:contract
bun run smoke:meta-threads:concurrency
```

These proofs exercise stackd create, goal update, seal, approve, continue,
fresh child-thread creation, and parallel meta-thread mutation. They are server
contract gates, not TUI rendering gates.

## Distribution and downloads

Distribution target: [`DISTRIBUTION.md`](DISTRIBUTION.md).

Nightly 1 should use one official installer path when public assets are ready.
Do not promote Homebrew, npm, Docker, Nix, AUR, Scoop, Chocolatey, or raw zip
install docs for Nightly 1.

Current installer contract surface:

```bash
make smoke-installer-contract
make smoke-installer-apply-rollback
make smoke-release-artifact-local
make smoke-release-site-contract
make smoke-artifact-security
sh packaging/install.sh --channel nightly --manifest packaging/manifests/nightly.example.json --dry-run
```

This proves the manifest-first installer plan without publishing or downloading
real release assets. The apply/rollback smoke uses local fixture artifacts to
prove versioned install directories, `current`, `previous`, and rollback
behavior. The release-site smoke proves the generated first-party `install.sh`,
channel manifest, local artifact URL, isolated install directory, symlinked user
bin, installed `doctor`, installed `demo` receipt, and installed read-only
update check work together.

Current local artifact proof:

```text
.stack/evidence/release-artifact/20260629T231537Z-0a63dcb2/
.stack/evidence/release-artifact/20260629T233313Z-4c9fe3e4/
.stack/evidence/release-site-contract/20260629T233313Z/
```

This proof produced a tarball, checksum, and manifest for the local target and
reports `publishable: true` for the local nightly artifact. Public hosted
installer publication still waits for the Nightly 1 artifact-security waiver or
real signatures/provenance, immutable hosting, and download telemetry.

Nightly 1 waiver:

```text
docs/NIGHTLY_1_SECURITY_WAIVER.md
```

Download metrics to line up:

```text
stack_docs_cta_clicked
stack_download_clicked
stack_release_asset_downloaded
stack_installer_started
stack_installer_succeeded
stack_installer_failed
```

These are acquisition/download events, not local code telemetry.

Current update check surface:

```bash
stack update --check
stack update --check --channel nightly
stack update --check --manifest packaging/manifests/nightly.example.json
```

`stack update --check` is read-only. It can prove manifest resolution and target
selection before installer downloads, artifact activation, and rollback are
implemented.

## Telemetry and auth

Telemetry target: [`TELEMETRY.md`](TELEMETRY.md).
Event allowlist: [`TELEMETRY_EVENTS.json`](TELEMETRY_EVENTS.json).

```bash
make smoke-telemetry-contract
make smoke-stackd-telemetry
make smoke-growth-ingestion
```

Nightly 1 auth posture:

```text
Local ready · Synth sign-in optional
Telemetry on (anonymous) · stack telemetry off to disable
```

Login unlocks hosted Synth features. Login must not be required for:

```text
stack
stack --version
stack doctor
stack doctor --json
stack demo
stack demo --json
stack update --check
local receipts
```

Current local support surface:

```bash
stack doctor
stack doctor --json
```

`stack doctor` checks version/channel, local-ready posture, stackd health, auth
presence as a boolean, git availability, and launch docs. It does not send
telemetry and does not print secrets.

Current stackd privacy and opt-in local emission surface:

```bash
make smoke-stackd-telemetry
```

`GET /telemetry/status` returns the server-owned telemetry posture and allowlist
through the typed TS client. `POST /telemetry/events` validates stackd-owned
local product events, stays off by default, and writes an outbox event only when
`STACK_TELEMETRY=1`.

`make smoke-growth-ingestion` validates the public docs/download/installer
payload contract for `/api/v1/growth/funnel-events`. Live staging/prod POST
proof remains a separate launch gate.

Live proof commands:

```bash
bun run smoke:growth-ingestion -- --live-url https://staging-api.usesynth.ai
bun run smoke:growth-ingestion -- --live-url https://api.usesynth.ai
```

Current first-value surface:

```bash
stack demo
stack demo --json
make smoke-first-run-local
```

`stack demo` runs locally without Synth signup, writes a work product, writes a
trace, and emits a receipt under `.stack/runs/<run_id>/receipt.json`.
`make smoke-first-run-local` proves the complete first-run path with isolated
local Stack data: `stack doctor --json`, `stack demo --json`, and read-only
`stack update --check --json`.

## Docs

Public docs that must agree before Nightly 1 is announced:

| Surface | File |
| --- | --- |
| Repo README | `README.md` |
| Release process | `docs/RELEASE.md` |
| Quality bar | `docs/QUALITY.md` |
| Launch readiness | `docs/LAUNCH_READINESS.md` |
| Distribution | `docs/DISTRIBUTION.md` |
| Telemetry/privacy | `docs/TELEMETRY.md` |
| Mintlify overview | `docs/docs/stack/overview.mdx` in the docs repo |
| Mintlify changelog | `docs/docs/stack/changelog.mdx` in the docs repo |

Validate repo docs, Mintlify docs, and the growth marketing draft packet:

```bash
make smoke-launch-docs-alignment
```

## Marketing

Nightly 1 marketing should be specific and conservative:

```text
Stack is a local coding-agent cockpit for research engineering.
It makes long runs observable and creates receipts.
It works locally without signup.
Hosted Synth features are optional.
```

Do not publish broader handoff performance claims until the declared evidence
packet is complete. The current handoff blog packet is:

```text
growth/src/marketing/blogs/planned/stack-handoffs/
growth/src/marketing/blogs/planned/stack-handoffs/NIGHTLY1_MARKETING.md
growth/src/marketing/blogs/draft/stack-handoffs/index.mdx
```

CTA target for Nightly 1 should use campaign attribution once the installer
exists:

```text
utm_campaign=stack-nightly-1
utm_source=docs|blog|github
utm_medium=cta
```

## Not launchable until

- Candidate channel is selected.
- Candidate SHA is frozen with `launch:candidate -- --select --write-evidence`.
- Installer/download story is truthful.
- README and Mintlify docs agree.
- Telemetry copy says local telemetry is on by default (anonymous), disclosed on first run, and disabled with `stack telemetry off`.
- Local-first auth state is visible.
- At least one first-value path is defined and exercised from the install path:
  installed local demo receipt or StackEval receipt.
- A Jstack ship record has owner, evidence, and next action for every partial
  or not-started gate.
