# Stack release process

Stack ships on **two channels**:

| Channel | Audience | Version shape | Update cadence |
| --- | --- | --- | --- |
| **stable** | Public users / teammates who want supported releases | `0.1.0`, `0.2.0` | Rare — CHANGELOG + git tag + GitHub Release + first-party installer |
| **dev / nightly** | Synth engineers, dogfooders, and early testers on main | `0.2.0-dev.20260626.42` | Often — `make bump-dev` many times per day; nightly pointer may move daily |

**Canonical source:** `version.json` (synced to `package.json` via `make sync-version`).

## Release lifecycle

```text
main commit -> dev bump -> nightly/dev install -> release candidate -> stable tag -> stable update
```

The channels have different standards because they make different promises.
Dev/nightly is for learning quickly with clear rollback paths. Stable is for
users who expect the documented install, update, and support story to hold.

| Standard | Dev / nightly | Stable |
| --- | --- | --- |
| User promise | Latest usable Stack from main; may have rough edges. | Supported public release with documented install, upgrade, and recovery path. |
| Version source | `X.Y.Z-dev.YYYYMMDD.N` from `version.json`. | Semver `X.Y.Z` tag and release notes. |
| Distribution | First-party installer with `--channel nightly` when published; source clone for contributors. | First-party installer backed by GitHub Release assets and checksums. |
| Required checks | `quality:static`; `quality:dev` before sharing broadly; focused `cargo check` when Rust changed. | `quality:release`; StackEval smoke when claims cite eval behavior; install proof; docs proof. |
| Docs bar | README/release notes mention user-visible changes and known sharp edges. | README, Mintlify, CHANGELOG, and GitHub Release agree on install channel and support posture. |
| Update behavior | Update Center may offer "latest dev" with dirty-check warnings. | Update Center offers stable updates by default and shows release notes / restart needs. |
| Telemetry/readout | Count separately as `dev` channel; useful for dogfood learning. | Count separately as `stable` channel; used for launch/readout decisions. |
| Rollback | Reinstall previous commit or previous dev version. | Reinstall previous stable release asset; migration notes must say whether rollback is safe. |

Use a short-lived release-candidate window when a stable release is near:

- candidate comes from a dev/nightly build that already passed `quality:dev`;
- no feature churn except fixes, docs, packaging, and evidence capture;
- any server/client contract change restarts candidate evidence;
- promote only after the stable checklist below has concrete proof.

## Version file

```json
{
  "version": "0.2.0-dev.20260626.1",
  "channel": "dev",
  "release": "0.1.0"
}
```

- **`release`** — last public stable semver
- **`version`** — what this build reports (`stack --version`)
- **`channel`** — `stable` | `dev`

Override at runtime (rare): `STACK_CHANNEL=stable`.

## Dev / nightly workflow (main)

Bump as often as needed while main remains usable:

```bash
cd ~/Documents/GitHub/stack
make bump-dev          # same UTC day → increments .N; new day → new date stamp
make quality-static
make sync-version      # if you edited version.json by hand
stack --version
```

Before telling other people to install a dev/nightly build, run the dev gate:

```bash
make quality-dev
```

Dev/nightly can ship with known limitations, but not with a broken install,
broken version metadata, or a known Rust/TS contract mismatch.

Source install update for contributors:

```bash
git pull && make install && stack --version
```

Public nightly installer target, once published:

```bash
curl -fsSL https://stack.usesynth.ai/install.sh | sh -s -- --channel nightly
stack --version
stack doctor
stack demo
stack update --check --channel nightly
make smoke-first-run-local
```

Installer contract proof before publishing the hosted URL:

```bash
make smoke-installer-contract
make smoke-installer-apply-rollback
make smoke-release-artifact-local
make smoke-release-site-contract
make smoke-first-run-local
make smoke-launch-docs-alignment
make smoke-telemetry-contract
make smoke-stackd-telemetry
make smoke-growth-ingestion
```

## Stable / public release

1. Add `CHANGELOG.md` section `## [X.Y.Z] - YYYY-MM-DD`.
2. Promote and reopen dev line:

```bash
make release-promote VERSION=0.2.0
make release-check
make check
```

Run the stable gate:

```bash
make quality-release
```

3. Tag and GitHub Release:

```bash
git tag -a v0.2.0 -m "Stack 0.2.0"
git push origin v0.2.0
```

4. First-party installer / release asset:

```bash
# Publish signed/checksummed GitHub Release assets, then point installer at vX.Y.Z.
curl -fsSL https://stack.usesynth.ai/install.sh | sh
stack --version
stack doctor
stack demo
stack update --check --channel stable
```

Homebrew/npm/Docker/OS package-manager channels are deferred until they have
their own install, update, rollback, and support gates.

## Public install target

```bash
curl -fsSL https://stack.usesynth.ai/install.sh | sh
stack --version
```

The installer is the intended default public path once release assets are live.
It should install Stack, report the installed channel/version, and print the
next command. Source clone remains the contributor path.

## What reports the version

| Surface | Output |
| --- | --- |
| CLI | `stack --version` — version, channel, stable release (dev) |
| MCP | `serverInfo.version` = `version.json` version |
| Transcript | `Stack · {version}` |

## Source install (git clone)

```bash
git clone https://github.com/synth-laboratories/stack.git
cd stack
make install
stack --version
```

`make install` — symlinks wrappers to your checkout (best for active development).  
`make install-brew` — copies tree to `libexec` (used by Homebrew formulas).

## Checklists

**Quality guide:** [`QUALITY.md`](QUALITY.md) — lint, Bombadil, acceptance tiers, StackEval, GameBench.

**Distribution:** [`DISTRIBUTION.md`](DISTRIBUTION.md) — installer/download contract.

**Telemetry:** [`TELEMETRY.md`](TELEMETRY.md) — local telemetry and privacy posture.

**Changelog split**

- Public repo changelog: [`CHANGELOG.md`](../CHANGELOG.md) — user-visible
  additions, fixes, breaking changes, migrations, known limitations, and channel
  status.
- Public docs changelog: `/stack/changelog` — shorter user-facing summary for
  website/docs readers.
- Private changelog: Jstack / `synth-dev` release ledgers — richer operational
  context, launch gates, evidence packets, waivers, regressions, and internal
  owner decisions.

**Dev bump**

- [ ] `make bump-dev`
- [ ] `make quality-static`
- [ ] `make launch-readiness`
- [ ] `make launch-nightly1`
- [ ] `bun run launch:candidate -- --write-evidence`
- [ ] `bun run launch:candidate -- --select --write-evidence` after the worktree is clean and the candidate SHA is the one to advertise
- [ ] `make smoke-installer-contract`
- [ ] `make smoke-installer-apply-rollback`
- [ ] `make smoke-release-artifact-local`
- [ ] `make smoke-release-site-contract`
- [ ] `make smoke-artifact-security`
- [ ] `make smoke-launch-docs-alignment`
- [ ] `make smoke-telemetry-contract`
- [ ] `make smoke-stackd-telemetry`
- [ ] `make smoke-growth-ingestion`
- [ ] `bun run smoke:meta-threads:contract` when handoff/meta-thread behavior is in scope
- [ ] `bun run smoke:meta-threads:concurrency` when handoff/meta-thread behavior is in scope
- [ ] `make quality-dev` before sharing outside the immediate development loop
- [ ] commit `version.json` + `package.json`
- [ ] note any known limitations in `CHANGELOG.md` or the private ship ledger

**Stable release**

- [ ] `CHANGELOG.md` — `[X.Y.Z]`
- [ ] `make release-promote VERSION=X.Y.Z`
- [ ] `make launch-readiness`
- [ ] `make smoke-installer-contract`
- [ ] `make smoke-installer-apply-rollback`
- [ ] `make smoke-release-artifact-local`
- [ ] `make smoke-release-site-contract`
- [ ] `make smoke-artifact-security`
- [ ] `make smoke-launch-docs-alignment`
- [ ] `make smoke-telemetry-contract`
- [ ] `make smoke-stackd-telemetry`
- [ ] `make smoke-growth-ingestion`
- [ ] `make quality-release`
- [ ] `./bin/stackeval run banking77-local-gepa --preset smoke`
- [ ] git tag `vX.Y.Z` + GitHub Release
- [ ] installer points to signed/checksummed `vX.Y.Z` asset
- [ ] clean install/update proof for the advertised channel
- [ ] README, Mintlify, CHANGELOG, and GitHub Release agree
