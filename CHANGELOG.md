# Changelog

All notable changes to Stack are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This is the public technical changelog. Include user-visible behavior, install
changes, breaking changes, migration notes, and known limitations. Do not include
private launch gates, dogfood waivers, customer-specific incidents, raw evidence
transcripts, secret names, or internal planning IDs; those belong in Jstack and
private release ledgers.

## [Unreleased]

### Added

- **Sidecar monitor (goal mode)** — default **Sidecar events** feed in `/goal` mode; worker
  transcript is debug (`a`), not the primary view. Monitor posts human updates via
  `stack_monitor_goal_status` (`for_human`, headline, note, metric) → `monitor.goal_status`
  events; goal shutter shows a headline strip and milestone timeline.
- **Goal completion audit** — monitor may flip a goal to `done` with audited `goal_met`, or
  `blocked`/`goal_failed` when a worker done-claim fails proof; steer-once dedup via
  `trigger_signature`.
- **Gardener bundled defaults** — `bundled/gardeners/default.system.md` + `default.toml` seeded
  on first run; prompt states portfolio conductor role, routes per-run progress to the monitor
  Sidecar feed, and forbids using sidecar pause as thread archive.
- **Gardener meta-thread lifecycle** — `lifecycle_status` on stackd manifests,
  `PATCH /meta-threads/:id/lifecycle`, MCP `stack_meta_threads_list` / `stack_meta_thread_get` /
  `stack_meta_thread_set_lifecycle` (gardener-gated; monitor rejected), live meta-thread table in
  gardener chat, TUI lifecycle badges, monitor scheduler skips archived heads (`c364e2a`).
- **TUI remount coordinator** — coalesces OpenTUI full-tree remounts to reduce TextBuffer /
  SyntaxStyle allocation crashes during dev refresh and poll overlap.
- **Developer policy** — `docs/DEVELOPERS.md`: product-only `stack/` repo; verification lives in
  `testing/` and `evals/stackeval/`.
- **Release channels** — `version.json` with `stable` (public tags) and `dev` (nightly) channels
- **`make bump-dev`** — frequent dev version bumps (`0.2.0-dev.YYYYMMDD.N`)
- **`make release-promote VERSION=x.y.z`** — cut stable and reopen dev line
- **Homebrew** — `packaging/homebrew/stack.rb` (stable) and `stack-dev.rb` (HEAD main)
- **`make install-brew`** — libexec install path for Homebrew
- **StackEval 1 packet prep** — `bun run stackeval:banking77-local-gepa` creates
  the Banking77 local GEPA dogfood packet with prompt, metadata, model policy,
  waste ledger, and release guard placeholders

### Changed

- Goal shutter defaults to **Sidecar events** (`e`) instead of worker chat on resume in goal mode.
- Monitor wake cadence tightened for live-feeling feed during long runs (event batch + time +
  staleness layers in `.stack/monitors/default.toml`).
- Verification scripts canonical home: `~/Documents/GitHub/testing/stack/` (smokes, Bombadil B0,
  tmux E2E, acceptance). See `testing_stack.txt` in Jstack daily notes.

### Known limitations

- Sidecar feed quality depends on monitor model + prompt; full GE-MON acceptance matrix not yet
  green on all environments. When sidecar MCP is unavailable, runtime synthesizes audited
  `goal_met` / `goal_failed` from the sidecar summary text.
- `pause_worker`, `block_before_action`, and typed **wake-gardener** escalation are not fully
  wired — do not rely on pause-before-irreversible in production.
- Gardener bulk lifecycle (`stack_meta_threads_set_lifecycle`), typed **wake-gardener** escalation,
  and monitor headline rollup in gardener context are partial or follow-on (headline WIP unstaged).
- Sidecar pause is not archive; use `stack_meta_thread_set_lifecycle` to park meta-threads.
- No multi-goal portfolio rollup, ETA range, or headless monitor pass without the TUI attached.
- Bombadil B0 runner default timeout is 420s (sequential scroll/focus/crash scenarios); slow hosts
  may still need `STACK_BOMBADIL_B0_TIMEOUT_MS`.

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
