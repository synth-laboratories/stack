# Stack release process

Stack ships on **two channels**:

| Channel | Audience | Version shape | Update cadence |
| --- | --- | --- | --- |
| **stable** | Public / teammates who want tagged releases | `0.1.0`, `0.2.0` | Rare — CHANGELOG + git tag + Homebrew stable |
| **dev** | Synth engineers on main | `0.2.0-dev.20260626.42` | Often — `make bump-dev` many times per day |

**Canonical source:** `version.json` (synced to `package.json` via `make sync-version`).

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

Bump as often as you like:

```bash
cd ~/Documents/GitHub/stack
make bump-dev          # same UTC day → increments .N; new day → new date stamp
make sync-version      # if you edited version.json by hand
stack --version
```

Source install update:

```bash
git pull && make install && stack --version
```

Homebrew dev:

```bash
brew upgrade stack-dev
```

## Stable / public release

1. Add `CHANGELOG.md` section `## [X.Y.Z] - YYYY-MM-DD`.
2. Promote and reopen dev line:

```bash
make release-promote VERSION=0.2.0
make release-check
make check
```

3. Tag and GitHub Release:

```bash
git tag -a v0.2.0 -m "Stack 0.2.0"
git push origin v0.2.0
```

4. Homebrew stable formula + tap:

```bash
make homebrew-formulas FETCH_STABLE=1
cp packaging/homebrew/*.rb ../homebrew-tap/Formula/
cd ../homebrew-tap && git commit -am "stack v0.2.0" && git push
```

See `packaging/homebrew/README.md` for tap layout.

## Homebrew install (users)

```bash
brew tap synth-laboratories/tap
brew install stack          # stable — tagged release
brew install stack-dev      # dev/nightly — tracks main
```

Requires `brew install bun` and local Codex CLI.

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

**Dev bump**

- [ ] `make bump-dev`
- [ ] commit `version.json` + `package.json`

**Stable release**

- [ ] `CHANGELOG.md` — `[X.Y.Z]`
- [ ] `make release-promote VERSION=X.Y.Z`
- [ ] `make release-check` + smokes
- [ ] git tag `vX.Y.Z` + GitHub Release
- [ ] `make homebrew-formulas FETCH_STABLE=1` + tap push
