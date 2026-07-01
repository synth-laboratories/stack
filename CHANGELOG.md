# Changelog

All notable changes to Stack are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This is the public technical changelog. Include user-visible behavior, install
changes, breaking changes, migration notes, and known limitations. Do not include
private launch gates, dogfood waivers, customer-specific incidents, raw evidence
transcripts, secret names, or internal planning IDs; those belong in Jstack and
private release ledgers.

**Ship rule:** every dev bump or stable release gets a **dated section here** before
push. Pair with `docs/USAGE.md` updates and Jstack release notes; see
`docs/RELEASE.md` § Changelog split.

## [Unreleased]

### Changed

- **Goal task context is now fully data-driven.** Stack no longer contains any
  benchmark- or eval-specific goal logic (the GameBench task detector, family lists,
  lane-name heuristics, and monitor prompt vocabulary are removed). A goal gains task
  context only from an explicitly referenced task contract — a `task.toml` named by
  path in the objective (sections `[goal]`, `[[goal.phases]]`, `[verdict]`,
  `[[verdict.gates]]`) — or from context supplied at goal binding. Done bars,
  milestone chains, honesty pitfalls, and phase hints are contract data; domain
  content lives beside the tasks it describes (e.g. evals lane files), not in Stack.
- `goalContext.gamebenchTask` → `goalContext.taskContext` (generic shape); monitor
  status serialization key `gamebench_task` → `task_context`.
- The fake-codex goal-shutter fixture no longer ships in the product artifact; the
  testing harness owns it.

## [0.2.0-dev.20260701.1] - 2026-07-01

Dev channel sidecar monitor release (`stack dev` @ `c55e68f`). Operator docs:
`docs/USAGE.md` § Stack Monitor and goal-mode keys (`e` / `t` / `a`).

### Added

- **Sidecar monitor (goal mode)** — default **Sidecar events** feed in `/goal` mode; worker
  transcript is debug (`a`), not the primary view. Monitor posts human updates via
  `stack_monitor_goal_status` (`for_human`, headline, note, metric) → `monitor.goal_status`
  events; goal shutter shows a headline strip and milestone timeline.
- **Goal completion audit** — monitor may flip a goal to `done` with audited `goal_met`, or
  `blocked`/`goal_failed` when a worker done-claim fails proof; steer-once dedup via
  `trigger_signature`.
- **Runtime check-ins** — quiet monitor passes emit dim `monitor.checkin` rows so the feed
  stays alive without faux progress noise.
- **Task-aware GameBench monitor context** — policy-opt, engine-rebuild, and puzzle-diagnosis
  goals carry task type, milestone chain, done bar, and honesty pitfalls into the monitor so
  `goal_met` is audited against the right bar instead of objective-text vibes.
- **Risky action supervision** — monitor detects imminent irreversible actions such as hard
  resets, destructive deletes, force pushes, prod-affecting commands, and schema drops, then
  emits a high-severity steer/pause-escalation signal once per category.
- **Headless monitor loop** — `monitor-daemon` can run monitor passes without the TUI attached,
  enabling server-side/event-log driven supervision loops.
- **Gardener bundled defaults** — `bundled/gardeners/default.system.md` + `default.toml` seeded
  on first run; prompt states portfolio conductor role, routes per-run progress to the monitor
  Sidecar feed, and forbids using sidecar pause as thread archive.
- **Gardener meta-thread lifecycle** — `lifecycle_status` on stackd manifests,
  `PATCH /meta-threads/:id/lifecycle`, MCP `stack_meta_threads_list` / `stack_meta_thread_get` /
  `stack_meta_thread_set_lifecycle` (gardener-gated; monitor rejected), live meta-thread table in
  gardener chat with latest monitor headline/status, TUI lifecycle badges, monitor scheduler skips
  archived heads.
- **Meta-thread title owner path** — `PATCH /meta-threads/:id/title` and MCP
  `stack_meta_thread_set_title` let gardener, monitor, and operator actors rename the
  human-editable meta-thread title while durable ids remain immutable.
- **TUI remount coordinator** — coalesces OpenTUI full-tree remounts to reduce TextBuffer /
  SyntaxStyle allocation crashes during dev refresh and poll overlap.
- **Client crash reporting (local + client path)** — fatal TUI/runtime crashes report to stackd
  and Synth cloud by default (`STACK_CRASH_REPORT=0` to disable). Local outbox at
  `.stack/telemetry/crashes.jsonl`; query via `stack crashes`, MCP `stack_crash_reports`, and
  `GET /api/v1/product/stack-crashes/summary` when the cloud route is deployed. See
  `docs/CRASH_INGESTION.md`.
- **Release channels** — `version.json` with `stable` (public tags) and `dev` (nightly) channels
- **`make bump-dev`** — frequent dev version bumps (`0.2.0-dev.YYYYMMDD.N`)
- **`make release-promote VERSION=x.y.z`** — cut stable and reopen dev line
- **Homebrew** — `packaging/homebrew/stack.rb` (stable) and `stack-dev.rb` (HEAD main)
- **`make install-brew`** — libexec install path for Homebrew

### Changed

- Goal shutter defaults to **Sidecar events** (`e`) instead of worker chat on resume in goal mode.
- Active thread rows prefer a bound meta-thread title or active-goal objective before falling
  back to session prompt text, reducing `(empty)` labels for titled meta-thread sessions.
- Monitor wake cadence tightened for live-feeling feed during long runs (event batch + time +
  staleness layers in `.stack/monitors/default.toml`); routine wakes honor `next_wake_on` and
  enforce `max_wakes_per_primary_turn`.
- **`docs/USAGE.md`** — sidecar monitor section, goal-mode keys, and pointer to Jstack UX spec SSOT.

### Known limitations

- Sidecar feed quality depends on monitor model + prompt. When sidecar MCP is unavailable,
  runtime synthesizes audited `goal_met` / `goal_failed` from the sidecar summary text.
- Typed **wake-gardener** escalation is not fully wired as a cross-actor path.
- Gardener bulk lifecycle (`stack_meta_threads_set_lifecycle`) is not shipped.
- Sidecar pause is not archive; use `stack_meta_thread_set_lifecycle` to park meta-threads.
- No full multi-goal portfolio rollup or ETA range.
- Cloud crash ingest requires backend route deploy (staging promote) before remote summary is
  live in all environments.

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

[Unreleased]: https://github.com/synth-laboratories/stack/compare/c55e68f...HEAD
[0.2.0-dev.20260701.1]: https://github.com/synth-laboratories/stack/commit/c55e68f
[0.1.0]: https://github.com/synth-laboratories/stack/releases/tag/v0.1.0
