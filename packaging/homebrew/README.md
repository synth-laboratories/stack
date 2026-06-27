# Homebrew tap — Stack

Formulas in this directory are the **source of truth** for the public tap. Copy or
symlink them into the tap repository:

```text
github.com/synth-laboratories/homebrew-tap/
  Formula/
    stack.rb       # stable — tagged releases
    stack-dev.rb   # dev/nightly — HEAD main
```

## User install

```bash
brew tap synth-laboratories/tap

# Public stable (latest tagged release)
brew install stack

# Dev/nightly (main branch — update many times per day)
brew install stack-dev
brew upgrade stack-dev
```

Requires [Bun](https://bun.sh) (`brew install bun`) and the Codex CLI.

## Maintainer workflow

### Dev channel (main branch — bump often)

```bash
cd ~/Documents/GitHub/stack
make bump-dev          # version.json → 0.2.0-dev.YYYYMMDD.N
make sync-version
git commit -am "stack dev bump"
```

Teammates on dev:

```bash
brew upgrade stack-dev
# or git pull && make install for source installs
```

### Stable channel (public release)

```bash
# 1) CHANGELOG section for VERSION
# 2) Promote version.json to stable and reopen dev line
make release-promote VERSION=0.2.0
make release-check

# 3) Tag and push
git tag -a v0.2.0 -m "Stack 0.2.0"
git push origin v0.2.0

# 4) Regenerate stable formula sha256 and publish tap
make homebrew-formulas FETCH_STABLE=1
cp packaging/homebrew/*.rb ../homebrew-tap/Formula/
cd ../homebrew-tap && git commit -am "stack v0.2.0" && git push
```

### Version files

| File | Role |
| --- | --- |
| `version.json` | Canonical channel + version + last stable `release` |
| `package.json` | Synced from `version.json` (`make sync-version`) |

`stack --version` prints version, channel, and stable release (when on dev).

## Local formula test (before tap push)

```bash
brew install ./packaging/homebrew/stack-dev.rb
stack --version
brew uninstall stack-dev
```

Stable tarball test (after tag exists):

```bash
make homebrew-formulas FETCH_STABLE=1
brew install ./packaging/homebrew/stack.rb
```
