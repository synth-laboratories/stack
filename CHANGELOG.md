# Changelog

All notable changes to Stack are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Release channels** — `version.json` with `stable` (public tags) and `dev` (nightly) channels
- **`make bump-dev`** — frequent dev version bumps (`0.2.0-dev.YYYYMMDD.N`)
- **`make release-promote VERSION=x.y.z`** — cut stable and reopen dev line
- **Homebrew** — `packaging/homebrew/stack.rb` (stable) and `stack-dev.rb` (HEAD main)
- **`make install-brew`** — libexec install path for Homebrew

## [0.1.0] - 2026-06-26

First distributable release of Stack — the Synth operator cockpit (OpenTUI + Codex +
Stack MCP).

### Added

- OpenTUI cockpit with Codex agent pane, session history, and transcript tooling
- Stack MCP server (`stack-mcp`) for live SMR, Factory, hosted optimizer, and local ops
- Dev / staging / prod environment switcher with auth loaded from configured env files
- Right ops panel: **Local** (containers + local GEPA) and **Synth Hosted** (projects +
  hosted optimizers)
- Local GEPA integration via `synth-optimizers` with auto-start on dev launch
- Dev slot auto-start via `synth-dev/scripts/local.sh up slot1` when the dev API is offline
- Bundled Codex skills: `stack-local-setup`, `synth-via-stack`, `stack-agent-bridge`
- OpenAI model pricing cache for live token spend estimates in the TUI
- Agent context rail (skills on disk vs injected vs used)
- Codex ChatGPT budget display on the auth chip
- README smoke eval launch and remote SMR/Factory action surface
- `stack --version` / `stack -V` and matching MCP version reporting

### Changed

- Product label in transcript harness: **Stack · semver** (replacing “Prototype 0 · 0.0.0”)

[Unreleased]: https://github.com/synth-laboratories/stack/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/synth-laboratories/stack/releases/tag/v0.1.0
