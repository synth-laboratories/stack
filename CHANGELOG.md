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

## [0.2.0-dev.20260704.3] - 2026-07-04

Effort launch and Artifact Site cockpit release.

### Added

- **Scoped Effort launches.** `stack effort scope`, `stack effort launch`, and
  `stack_effort_launch` let an Effort declare which launch capabilities are in
  scope, then launch only those explicit capabilities. The first wired launch
  clients cover local GEPA, hosted GEPA, hosted SMR, and hosted container-pool
  rollout. Successful launches append a lane-explicit `{system, id, lane,
  role=launch}` ref and activity receipt to the Effort.
- **Local Artifact Sites.** `stack artifacts` creates, serves, lints, lists,
  opens, publishes, and shares local evidence pages from a bundled Next.js
  scaffold. Pages live under Stack artifact state, can be bound to an Effort,
  and can publish through hosted artifact routes when the selected Synth
  environment exposes them.
- **Artifact evidence adapter.** `stack effort artifact` and
  `stack_effort_record_artifact` promote the latest local Artifact Site manifest
  row into typed `artifact.webpage` Effort proof, preserving local, hosted, and
  public URLs, hosted artifact ids, page version, sha256, cited splits, and a
  source receipt for the rendered page.
- **Artifact authoring skill.** The bundled `artifact-authoring` skill gives
  agents a compact page-authoring contract for Stack Artifact Sites, including
  the kit API, page template, citation expectations, and no-secret/no-external
  request guardrails.
- **Hosted artifact status in live ops.** Remote SMR and hosted optimizer
  snapshots now surface hosted artifact rows and per-run hosted artifact status
  so the cockpit can show whether a run has a hosted page, public URL, or
  publishable artifact.

## [0.2.0-dev.20260704.2] - 2026-07-04

Install runtime hotfix for the Efforts nightly.

### Fixed

- **Pinned TUI runtime dependency in release artifacts.** The nightly package
  now pins `@opentui/core` exactly and verifies `bun.lock` is present in the
  tarball, preventing installed builds from auto-resolving a newer OpenTUI
  minor that has incompatible remount cleanup behavior.

## [0.2.0-dev.20260704.1] - 2026-07-04

Efforts acceptance hardening release.

### Added

- **Effort remaining-work command.** `stack effort remaining` and
  `stack_effort_remaining` expose the parsed "what remains?" state directly:
  open acceptance levels, latest unresolved blocker, next safe actions, and
  handoff/acceptance paths without requiring the full show/get payload.
- **Effort no-blocked lifecycle guard.** `stack effort status` and
  `stack_effort_update_status` now reject `blocked` with a recovery message that
  points operators and gardeners to blocker receipts instead of lifecycle state.
- **Effort receipt digest repair.** `stack effort audit` now has a documented
  companion repair path: `stack effort refresh-receipts <effort>` and
  `stack_effort_refresh_receipts` recompute current local file/directory digests
  for receipt-backed findings and update only stale sidecars after audit reports
  `finding_receipt_digests` drift.
- **Effort acceptance receipt audit.** `stack effort audit` now checks recorded
  acceptance levels against typed `effort.acceptance_recorded` receipts. Legacy
  A0/A1 bootstrap packets can remain accepted as explicit v1 bootstrap evidence,
  but recorded graduation levels require the typed acceptance writer. The audit
  also fails when an acceptance packet drifts from the latest typed receipt for
  that level, and acceptance writes now make custom status text parseable as the
  requested state.
- **Generic Effort refs.** `effort.toml` now records external system edges as
  open `[[refs]]` entries - `{system, id, lane, role}` - replacing the
  per-product `[hosted]` columns. Lanes (`hosted`/`local`) are declared
  explicitly at write time; nothing is inferred from id substrings. Legacy
  `[hosted]` blocks and registry `hosted_refs` are still read and migrate on
  the next write. `stack effort refs --system <system> --id <id> --lane
  hosted|local` and the matching `stack_effort_update_refs` args cover any
  system; the named `--*-id` flags remain as conveniences.
- **Declared Effort claims.** `effort.toml` and effort templates now declare
  acceptance levels as `[[claims]]` with `needs_refs` and `needs_evidence`
  requirements. One generic rule replaces all template-specific guards: a claim
  recorded as accepted must satisfy its declared requirements, and
  `stack effort acceptance` / `stack_effort_record_acceptance` reject recorded
  writes naming exactly what is missing. The audit's new `claims` check fails
  recorded-but-unmet claims, warns on open required claims, and keeps open
  optional claims visible without degrading the audit. The bundled
  task-classifier template ships the Banking77-style A0-A4 ladder as declared
  claims; the engine itself knows nothing about GEPA, SMR, or Tinker.
- **Effort handoff research-log summary.** Generated handoffs for research
  Efforts now include a compact `Research Log` section with the latest dated
  entries, summarized work, results, and next actions instead of only linking to
  `research_log.md`.
- **Effort handoff receipt summary.** Generated handoffs now include a compact
  `Receipt Summary` with sidecar count, readable receipt count, digest-backed
  receipt count, and source-kind/artifact-kind/environment totals. `stack effort
  audit` requires the section whenever an Effort has receipt sidecars.
- **Claim lanes in handoffs.** Generated handoffs for any Effort that declares
  `[[claims]]` include a `Claim Lanes` section listing each claim's state,
  requirement satisfaction, satisfied/missing requirements, and next action;
  audit requires the section whenever claims are declared.
- **Effort handoff idea graph.** Generated handoffs now include an `Idea Graph`
  section whenever an Effort has raw ideas or promoted idea findings. The
  section summarizes origin counts, raw `[HUMAN]`/`[AGENT]`/`[MIXED]` idea
  nodes, and promoted `findings/ideas` backlinks, and audit requires it when
  idea material exists.
- **Typed run evidence for any run system.** `stack effort run-evidence` plus
  `stack_effort_record_run_evidence` record run proof under `findings/proof/`
  with an open `--run-kind` system identifier (`smr`, `tinker`, `local`, ...),
  run/project/output ids, artifact name, metric, an optional claim label, and
  receipt-backed source provenance (`source_kind=run.<kind>`). The run id is
  attached to the manifest as a `{system: <kind>, id: <run-id>}` ref. Effort
  list/show, MCP get/list, `/efforts`, handoffs, audit, playbooks, and gardener
  profiles surface this path; claims that declare `run.<kind>` evidence are
  satisfied by it.
- **One evidence machine.** Optimizer candidates, run evidence, benchmark
  intake, and release artifact proof are all presets over a single generic
  evidence recorder with namespaced source kinds (`optimizer.candidate`,
  `run.<kind>`, `benchmark.intake`, `release.artifact`); legacy activity types
  and receipt kinds normalize into the same view, one audit validates all
  evidence records, and `stack effort audit` reports it as
  `evidence_receipts`. Presets enforce identifiability at write time: run
  evidence requires a run id, optimizer candidates require optimizer_run_id
  and candidate_id (and attach the optimizer ref to the manifest), and release
  artifact proof requires version and sha256.
- **Receipt refresh preserves provenance.** `stack effort refresh-receipts`
  now keeps the original `recorded_at` on refreshed sidecars and stamps
  `refreshed_at` separately, so digest repairs stay distinguishable from the
  original recording.
- **Banking77 effort-acceptance eval.** The Banking77 graduation policy moved
  out of Stack core into `stackeval/banking77-effort-acceptance/`, a hermetic
  lane that proves template-seeded claims, guard rejections, preset evidence
  satisfaction, open run kinds, explicit ref lanes, and green audit/handoff
  end-to-end against the shipped template.
- **Typed release artifact proof.** `stack effort release-artifact` plus
  `stack_effort_record_release_artifact` record release/nightly tarball proof
  under `findings/proof/` with version, channel, target, archive, sha256, size,
  manifest, release-site path, publishable state, publish blockers, and
  receipt-backed source provenance. Effort list/show, MCP get/list, generated
  handoffs, audit, docs, and playbooks now surface release proofs as first-class
  artifacts instead of generic proof captures.
- **Effort benchmark intake.** `stack effort benchmark` plus
  `stack_effort_record_benchmark` record benchmark source, license, task shape,
  splits, metrics, version, and metadata/source receipt provenance under
  `findings/data/`. Effort list/show, MCP get/list, `/efforts`, generated
  handoffs, audit, playbooks, and gardener profiles now surface benchmark
  adoption as first-class metadata instead of a generic capture.
- **Eval feedback input.** Eval mode feedback now supports `/feedback`,
  `/eval`, and `/eval-feedback` slash entry, editable keyboard text in the
  feedback modal, and safer voice-hold restart suppression so accidental repeat
  key events do not immediately restart recording.

## [0.2.0-dev.20260703.2] - 2026-07-03

Monitor Gardener Goal release.

### Added

- **Durable Efforts workstreams.** Stack now has local Effort containers for
  long-running research and engineering work across threads, optimizer runs,
  SMR refs, human ideas, research logs, findings, and handoff artifacts.
  Efforts create visible folders under `efforts/<slug>/`, with
  `effort.toml`, `PLAYBOOK.md`, `PROGRESS.md`, `ACTIVITY.jsonl`, optional
  `research_log.md`, origin-tagged `ideas/`, `human/`, `notes/`, `repos/`, and
  `findings/{ideas,code,data,proof,results}/`.
- **Effort templates, CLI, MCP, and TUI surface.** Bundled templates now cover
  research, engineering, system optimizer, task classifier, agentic task,
  non-verifiable task, and product workstreams. `stack effort ...` and
  `stack_effort_*` MCP tools share the same storage path, while `/efforts`
  shows active/archived Efforts, refs, bound thread context, recent progress,
  recent activity, latest unresolved blocker, handoff state, acceptance summaries, and
  engineering change-packet summaries. `stack effort list` now works as a compact
  scan view with grouped status, ref counts, audit status, handoff/acceptance
  markers, latest progress, latest activity, and latest unresolved blocker.
  The `/efforts` panel is now selectable: `j`/`k` move the selected Effort, `n`
  starts `/efforts new`, `h` refreshes its generated handoff packet, `a`
  archives or reactivates it, and `b` binds the current meta-thread via stackd
  before updating the Effort reverse index.
  `stack_meta_thread_create` and `stack_worker_thread_create` accept `effort_ref`
  so new or existing worker threads can enter an Effort at creation time. `stack
  effort audit` and `stack_effort_audit` run a read-only coherence check for
  scaffold, research-log shape, idea origin tags, promoted idea backlinks,
  timelines, blockers, findings, handoff, acceptance criteria coverage,
  task-classifier A0/A1 v1-bar evidence, optional hosted/SMR/Tinker graduation
  coverage, refs, and meta-thread `effort_ref` back-links, while
  `stack effort activity` and `stack_effort_activity` print/read a bounded activity
  timeline from `ACTIVITY.jsonl`. Bundled playbooks include resume/orientation
  guidance so agents read progress, activity, research logs, human context,
  ideas, findings, bound meta-threads, and refs before acting. Research
  playbooks explicitly route terminal receipts, browser captures, screenshots,
  screencaps, video links, monitor outputs, and ad hoc local artifacts into
  receipt-backed findings when no first-class adapter exists; system-optimizer
  playbooks cover Reflexion/MAPO configs, memory updates, policy events, monitor
  profiles, and MLDP lessons.
- **Parsed Effort acceptance packets.** `stack effort show --json`,
  `stack_effort_get`, and `stack_effort_list` now expose an `acceptance_packet`
  object when `findings/results/acceptance-summary.md` exists, including A0-A4
  level states, v1 status, graduation status, recorded levels, and open levels.
  `stack effort show`, `stack effort list`, generated handoffs, and `/efforts`
  display the same compact acceptance status so Banking77-style packets can be
  reviewed without opening the markdown file. Effort orientation payloads now
  include `remaining_work`, which combines open acceptance levels with the latest
  typed blocker next action; `stack effort show`, `stack effort list`, generated
  handoffs, `stack_effort_get`, `stack_effort_list`, and `/efforts` surface that
  summary so resume agents can see what remains without parsing markdown.
  Generated handoffs also derive Risks And Open Threads bullets from open
  acceptance levels and the latest unresolved blocker when callers do not provide
  explicit `--risk` entries, and `stack effort audit` now checks that generated
  handoff risks still reflect structured remaining work.
  `stack effort acceptance` and `stack_effort_record_acceptance` now update a
  single A-level section in `findings/results/acceptance-summary.md` and append a
  typed acceptance activity receipt, so A2/A3/A4 graduation evidence can be
  recorded through Stack after proof artifacts exist.
- **Typed Effort blocker receipts.** `stack effort blocker` and
  `stack_effort_record_blocker` record external dependencies with blocker,
  evidence, next owner, and next safe action while keeping Effort status
  `active` or `paused`; the mutation writes `PROGRESS.md` and an
  `effort.blocker_recorded` activity receipt instead of introducing a
  `blocked` lifecycle state. `stack effort resolve-blocker` and
  `stack_effort_resolve_blocker` append an `effort.blocker_resolved` receipt so
  the original blocker remains in the historical trail while resolved blockers
  stop driving `latest_blocker`, `open_blocker_tail`, generated risks, and
  structured `remaining_work`. Generated handoffs now include a dedicated
  Recorded Blockers section from those receipts plus an embedded audit summary
  so the packet carries its own coherence status.
- **Machine-readable Effort artifact inventory.** `stack effort show --json`,
  `stack_effort_get`, and Effort mutation responses now include an
  `artifact_inventory` with generated files, ideas, human notes, repo pointers,
  findings, receipt sidecars, parsed `receipt_sources` provenance, and counts.
  `stack effort list` and `stack_effort_list` expose compact artifact and
  receipt-sidecar counts, and `stack effort audit --json` exposes receipt
  sidecars in structured audit counts. `stack effort show` and generated
  handoffs now list receipt source kind, finding path, workspace path, and
  digest when available, while `/efforts` shows the same count line plus
  idea, human-context, and receipt source-kind counts so agents and humans can
  orient around operator thinking and proof material without scraping
  `HANDOFF.md`.
- **Pulled and local artifacts can become Effort findings.** `stack effort
  finding --path` now writes an Effort-local source receipt sidecar for
  local/ad-hoc evidence, while `--receipt-path` and
  `stack_effort_record_finding` accept receipts from `stack_pull_artifact`,
  record the pulled `workspace_path` as the finding source, write the same
  Effort-local `.receipt.json` sidecar, and return or print provenance receipt
  metadata with the Effort orientation payload. Mutation responses include a
  generic `source_receipt` for both local and pulled evidence. Effort audit now
  validates those sidecars when present.
- **Capture-oriented Effort evidence.** `stack effort capture` and
  `stack_effort_record_capture` wrap the same receipt-backed finding path with
  explicit capture provenance for terminal, browser, screenshot, video, local,
  monitor, memory, text, benchmark, and optimizer evidence. Captures land under
  `findings/*`, default to proof evidence except benchmark captures default to
  data, and mark source receipts as `<capture-kind>_capture` so ad hoc evidence
  stays distinguishable from ordinary local path attachments.
- **Typed optimizer candidate evidence.** `stack effort optimizer-candidate` and
  `stack_effort_record_optimizer_candidate` record GEPA or hosted optimizer
  candidates under `findings/proof/` with optimizer run id, candidate id, score,
  score label, split, optional candidate notes, and source artifact receipts.
  Source sidecars are marked `optimizer_candidate` so Banking77-style acceptance
  packets can distinguish a scored candidate from a generic optimizer capture.
  `stack effort audit` now verifies task-classifier optimizer candidates through
  this typed activity receipt plus receipt sidecar. `stack effort show`,
  `stack effort list`, `stack_effort_get`, `stack_effort_list`, and `/efforts`
  surface the latest typed candidate id, run id, score, split, artifact path,
  and receipt ref during normal orientation.
- **Engineering Effort change packets.** `stack effort engineering-packet` and
  `stack_effort_write_engineering_packet` refresh
  `findings/results/engineering-change-summary.md` with changed files, git diff
  stat when a repo path is supplied, validation, skipped gates, risks, and next
  action. This gives engineering Efforts a stable answer to "what changed?"
  before handoff or release review. `/efforts` now surfaces that packet as a
  compact engineering row with changed-file, validation, skipped-gate, risk, and
  update-age signals.
- **Effort acceptance receipts.** `stack effort acceptance` and
  `stack_effort_record_acceptance` update
  `findings/results/acceptance-summary.md` for A0/A1/A2-style evidence, append a
  typed `effort.acceptance_recorded` activity receipt, and return the same
  orientation payload used by Effort list/show/handoff surfaces.
- **Interactive `/efforts` panel controls.** The TUI Efforts panel now supports
  `j/k` selection, `n` new-Effort command drafting, `h` handoff refresh, `a`
  archive/reactivate, `b` binding of the current meta-thread to the selected
  Effort through stackd, and `r` refresh. `/efforts new <slug> [--template
  <id>]`, `/efforts archive <effort>`, and `/efforts activate <effort>` provide
  direct slash-command lifecycle actions from the cockpit.
- **Typed Tinker refs for Efforts.** Effort manifests, `stack effort refs`,
  `stack_effort_update_refs`, generated handoffs, and the `/efforts` panel can
  now carry Tinker/training-style run ids separately from optimizer and SMR run
  ids.
- **Banking77 acceptance Effort.** The `task-classifier` template seeds the
  Banking77 A0-A4 acceptance ladder. The current acceptance packet records A0
  human walkthrough proof and A1 local GEPA artifact-capture proof, including a
  typed `optimizer_candidate` receipt for the accepted smoke candidate; hosted
  GEPA, SMR harness, and SMR/Tinker proofs remain optional graduation evidence.
  The A2-A4 sections require proof artifacts, configs/recipes, and research-log
  evidence rather than refs alone. The documented route is local GEPA first,
  hosted GEPA after local proof when available, SMR harness proof for direct
  execution evidence, and SMR/Tinker proof for training-style artifacts.

### Known limitations

- Efforts are local cockpit/workspace records in this release. Hosted
  Factory/Effort/Project ids can be attached as refs, but Stack does not create
  or mutate hosted Effort records by default.
- Banking77 A1 proves local optimizer artifact capture, not a launch-grade
  Banking77 prompt lift; the heldout score in the recorded packet is flat
  versus the seed candidate.

### Fixed

- `stack effort handoff` and other Effort CLI commands now preserve repeated
  list-style flags such as multiple `--risk`, `--metric`, or `--path` values
  instead of silently keeping only the last value.

### Added

- **Lights panel for live cockpit status.** `/lights on` opens a dedicated right
  panel with thread, gardener, actor, cloud, local runtime, and usage status.
  `/lights off` closes it without changing the active worker or gardener view.
- **Actionable thread inventory.** The Lights thread section is scrollable,
  status-filterable, and click/keyboard navigable. It shows live/current/goal
  status, relative age, token counts when available, goal/title previews, and
  viewed/unviewed state.
- **Durable gardener thread tools.** Stack MCP now exposes
  `stack_worker_thread_create`, `stack_meta_thread_create`, and
  `stack_meta_thread_update_goal` so the gardener can create a Stack-visible
  worker thread, bind an existing session to a meta-thread, or assign/update a
  goal through the stackd owner route instead of claiming an out-of-band spawn.
- **Lights thread view MCP.** `stack_lights_thread_view` lets approved agents
  mark threads viewed/unviewed, change thread filters, and request the Lights
  panel through the same UI vocabulary as other panels.
- **Expanded slash command surface.** The TUI slash command menu now includes
  `/help`/`/?`, `/exit`/`/quit`, `/goal`, `/g`/`/gardener`, `/monitor`/`/m`,
  `/lights`, `/env`, `/provider`/`/harness`, `/profile`,
  `/work_mode`/`/mode`, `/model`, `/usage`, `/experimental`, `/effort`,
  `/subagents`, `/config`, `/details`/`/d`, `/rails`/`/b`,
  `/threads`/`/p`, `/ops`, `/permissions`/`/perm`, `/settings telemetry`,
  `/actors`, `/agent`, `/agent-view`/`/a`, and `/clear`/`/c`.
- **Work mode flag.** `/mode eng|research` and `/work_mode eng|research` record
  the intended mode in TUI state for future routing. The setting is intentionally
  non-operative in this release.
- **Persistent UX state.** Stack stores right-panel width, Lights open/collapsed
  state, threads-only mode, selected thread, and viewed thread ids under
  `.stack/config/`.
- **Target-aware voice controls.** Voice input is enabled by default and now
  reports whether it is targeting the worker, monitor, or gardener lane.

### Changed

- **Gardener opens in the core panel.** `/gardener` now focuses the gardener in
  the primary workspace instead of forcing it into the side panel, matching the
  worker chat model.
- **Goal mode keeps chat usable.** Worker chat remains open in goal mode so
  operators can keep using slash commands and direct messages while the monitor
  sidecar is visible.
- **Monitor chat remains available.** The monitor side panel can show chat,
  events, and goal context without losing the worker input lane.
- **Right panel behavior is non-invasive.** Opening, closing, resizing, or
  clicking the Lights panel no longer steals the active main-panel thread.
- **Gardener defaults know the new owner tools.** Bundled gardener profiles now
  include the Lights/thread orientation tool and durable meta-thread creation
  tools in their allow-list guidance.
- **Account usage visibility.** The header and Lights usage section read richer
  account/rate-limit information when available.

### Fixed

- **Blackspace and input placement.** Worker, monitor, gardener, and resumed
  goal transcripts keep input controls anchored at the bottom and avoid the
  artificial top/bottom gaps seen during live dogfood sessions.
- **Blank resumed transcripts.** Rollout transcript reads retry briefly so
  resumed goal threads do not first-paint as empty while the JSONL projection
  catches up.
- **Terminal exit cleanup.** Exiting Stack now restores the terminal alternate
  screen more reliably after source and packaged launches.
- **Goal status normalization.** Legacy `blocked` goal states are not rendered
  as an agent-owned current status; the UI keeps the operator-owned distinction
  explicit.

### Known limitations

- This is a dev/nightly release packet. Stable promotion still requires the
  release gate, installer, and published evidence steps in `docs/RELEASE.md`.
- `/mode` / `/work_mode` records state only; no routing behavior changes yet.
- Heavily customized gardener profiles may need manual allow-list review if
  they intentionally diverged from the bundled defaults.

## [0.2.0-dev.20260703.1] - 2026-07-03

### Added

- **Artifact round-trip verbs.** `stack pull`, `stack apply`, and `stack push`
  move optimizer artifacts between hosted runs and the local workspace with
  typed receipts (sha256 digest, git SHA, backend target) recorded for every
  transfer, plus a `stack_list_hosted_artifacts` MCP tool for enumerating what
  a hosted run produced.
- **Hosted run watch.** `stack watch` follows a hosted optimizer run from the
  CLI, and the TUI gains a hosted-watch panel; both support `--once` snapshots
  and `--replay` over a finished run.
- **Per-task doctor.** `stack doctor --task <task.toml>` preflights a single
  task pack and reports failures classified as auth, quota, config, or
  transient, so a broken lane is diagnosable before launching a run.
- **One-keystroke papercut capture.** `ctrl+f` (or `/papercut`) records a
  papercut into the existing ledger without leaving the session.

### Fixed

- `/profile` now cycles through all four seeded profiles (the `default`
  profile was previously unreachable from the cycle).

## [0.2.0-dev.20260702.4] - 2026-07-02

### Fixed

- **Hosted optimizer artifact names.** Artifact name projection for hosted
  optimizer runs no longer mangles names, so downloaded artifacts match what
  the backend reports. (Hotfix nightly; no other changes over
  0.2.0-dev.20260702.3.)

## [0.2.0-dev.20260702.3] - 2026-07-02

### Added

- **Stack 0.4 profiles and research tools.** Added research, engineering, and
  product operator profiles, profile switching, hosted optimizer submit helpers,
  hosted container pool and rollout tools, and Synth inference-aware gardener
  profiles.
- **Container and hosted GEPA skills.** Added bundled guidance for Synth
  containers, coding containers, hosted GEPA submit flows, and public pool /
  rollout route usage.

### Changed

- Hosted optimizer and container panels now read richer owner-route snapshots,
  clarify `/v1/pools` as the live backend route, and redact command diagnostics
  before surfacing optimizer failures.

### Added

- **Agents own the side panels.** The monitor and gardener profiles now grant
  `stack_ui_open_panel`/`stack_ui_close_panel` (plus the monitor's
  `stack_monitor_goal_status`, `stack_sidecar_pause_for_restart`, and
  `stack_meta_thread_set_title`), so the sidecar can pull its feed in front of
  the operator at review moments and the gardener can open the portfolio panel
  when orienting. Existing untouched default profiles upgrade automatically;
  customized profiles are left alone.
- **Monitor profile is authoritative for sidecar tools.** The sidecar Codex
  session now receives the profile's `[tools]` allow/deny as its Stack MCP
  tool filter, matching how the gardener has always been scoped.
- **`pause_before_action`.** When a monitor profile sets
  `[permissions] pause_worker = true`, a risky-pending verdict (destructive
  command about to run) requests a worker pause; the TUI interrupts the
  in-flight turn and records an audited pause receipt. Off by default.
- **Activity density knob.** `[monitor] activity_density = "quiet" | "rich"`:
  rich adds phase-level "what the worker is doing now" updates to the events
  feed without licensing no-progress filler. Default stays quiet.
- **Audited panel walk.** The TUI emits `ui.panel_opened` when it opens a
  panel itself (`/goal` auto-open, goal sidecar chat) and `ui.panel_focus`
  when it applies an agent-opened panel from stackd, so every panel the
  operator sees is provable from the thread event log.

## [0.3.0] - 2026-07-02 (pre-ship)

### Added

- **Hosted Synth cockpit surfaces.** Stack now treats hosted SMR runs,
  projects, Factories, cloud deployments, and hosted optimizers as first-class
  remote state in the ops panel and Stack MCP. The surfaces are environment
  aware (`dev`, `staging`, `prod`) and remain separate from the local research
  loop.
- **Local to cloud sync receipts.** stackd records typed remote-sync receipts
  for push/pull requests, remote gardener passes, Factory wake/pause/resume
  requests, and meta-thread to SMR-run binding. TUI and MCP projections read
  those receipts from the runtime snapshot instead of scraping backend storage.
- **Remote gardener actor foundation.** Stack adds a `remote_gardener` role,
  default remote gardener profile, bounded sync narration receipts, and MCP
  tools for recording remote gardener passes.
- **Synth inference through Stack.** `stack inference list` and
  `stack inference usage` show the Synth inference catalog, free aux lane,
  billed GLM lane, usage visibility, and the invariant that the primary worker
  stays Codex/BYOK unless an explicit Synth inference profile opts in.
- **Opt-in monitor profiles for Synth inference.** `free-aux` routes monitor
  turns to the free aux endpoint when `STACK_AUX_INFERENCE=1`; `billed-glm`
  routes monitor turns to the billed GLM gateway when `STACK_SYNTH_INFERENCE=1`.
  If the selected Synth monitor route is unavailable, Stack falls back to the
  Codex app-server monitor with a visible notice.
- **Prominent optional Synth auth.** The TUI header, hosted empty states,
  inference catalog, and `stack doctor` now say local is ready while pointing to
  `stack auth open signin` for hosted unlocks.
- **Feature telemetry allowlist for `.3`.** Advanced product telemetry can now
  count hosted ops, remote sync, and Synth inference feature usage after the
  operator approves advanced telemetry.

### Changed

- Remote SMR, Factory, hosted optimizer, and deployment rows prefer stackd
  runtime snapshots and owner-route receipts over direct UI polling when
  snapshot state is available.
- Factory levers now require explicit confirmation and record Stack-side
  receipts after owner-route calls.
- `GET /api/v1/synth/models` can advertise both free aux and billed GLM Stack
  inference lanes when the backend gateway is deployed.

### Known limitations

- This `.3` section is a pre-ship release note. Live staging/prod write proofs,
  billed GLM usage-row proof, telemetry flush/rollup proof, crash route proof,
  and the final `0.3.0` package cut remain tracked in the private release
  packet until ship.
- The default primary worker remains Codex/BYOK. Synth billed inference for a
  primary worker is intentionally not automatic and requires an explicit
  opt-in profile.

## [0.2.0-dev.20260701.4] - 2026-07-02

### Fixed

- **First-launch approval raw keys.** The telemetry approval modal now handles raw
  `a`/`d`/`l` key sequences before agent input, matching the parsed key path.

## [0.2.0-dev.20260701.3] - 2026-07-02

### Fixed

- **Release launcher stackd autostart.** Packaged installs now preserve the
  checkout launcher behavior that starts `stackd` before the TUI, so fresh
  installs can read telemetry status and show the first-launch approval modal.

## [0.2.0-dev.20260701.2] - 2026-07-01

### Added

- **MetaHarness runtime core.** `POST /meta/tick` runs one serialized tick — actor
  schedulers queue triggers (monitor, plus a gardener queue fed by
  `monitor.handoff_requested` and operator chat), a pure reducer folds every live
  thread into a `MetaHarnessSnapshot` (goal phase, per-actor cursor/queued
  triggers/next-wake hints, `ui.*` side-panel slot, human headline), and the
  projection lands at `.stack/meta/status.json`. `GET /meta/status` serves the same
  snapshot. Roles are data on `stack-core::actor_runtime::ActorRole`; the monitor
  scheduler runs on the shared cursor/dedupe/wake-hint machinery. Contract:
  `docs/META_HARNESS_RUNTIME.md`.
- **Agents open UI, humans override.** MCP levers `stack_ui_open_panel` /
  `stack_ui_close_panel` backed by the UI vocabulary registry
  (`src/ui/vocabulary.ts`): monitor/gardener may open only allowed panels with a
  required reason, close only panels they opened; the operator closes anything.
  Every open/close is an audited `ui.panel_opened`/`ui.panel_closed` event. The
  monitor may open its panel once per high-signal review moment (audited
  goal_met/goal_failed, blocked, steer, risky pending) — never for routine progress.
- **Agent-first TUI default.** Fresh Stack opens on the worker chat with side panels
  closed. Goal progress/shutter now lives in the monitor side panel; `Esc` closes
  operator panels and records `ui.panel_closed`.
- **Gardener pass completion through stackd.** `POST /threads/:id/gardeners/:gardener_id/pass-complete`
  records gardener wake consumption, advances the gardener cursor, and drains queued
  handoff triggers without TypeScript writing actor state directly.
- **Telemetry tiers.** Basic DAU (`stack_first_launch`, `stack_session_started`)
  on by default and turn-offable; advanced product telemetry (feature usage,
  coarse session length) only after explicit approval. stackd owns the choice in
  `.stack/config/telemetry.json` with a pseudonymous `install_id`. New advanced
  events: `stack_session_ended` (duration bucket), `stack_session_heartbeat`,
  `stack_feature_used` (enum feature ids). The TUI exposes `/settings telemetry`;
  stackd adds `POST /telemetry/config` and `POST /telemetry/flush`; `stack telemetry
  digest` reports pending vs sent upload cursor counts. Backend ingestion lands at
  `/api/v1/product/stack-usage-events` and feeds the Stack funnel `usage_dau`
  rollup.
- Goal bind names the thread: bound goals never show `(empty)` in the threads rail.

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
- **StackEval moved out of the product — it lives in the `evals` repo.** Removed the
  StackEval evidence-packet reader (`stack_status`/promotion packets no longer carry
  `stackeval_packet`), the README-smoke eval launcher (MCP tools
  `stack_start_readme_smoke_eval`, `stack_readme_smoke_eval_status`,
  `stack_launch_read_smoke`, the TUI "Read Smoke Eval" panel and `e` action), the 12
  `stackeval:*` package scripts that reached into a sibling checkout, the
  `STACK_EVAL_COMMAND`/README-smoke config defaults that pointed at synth-dev, and
  the `stackeval` seed dir and monitor skill hints. stackd: `RuntimeCorrelation`
  drops `stackeval_packet_id`; local thread export manifest schema is now
  `stack/export/v1`. Config: `readmeSmoke.instance` → top-level `devSlotInstance`
  (`STACK_DEV_SLOT_INSTANCE`). Drive evals from the evals checkout:
  `evals/stackeval/bin/stackeval`.

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

[Unreleased]: https://github.com/synth-laboratories/stack/compare/HEAD...HEAD
[0.3.0]: https://github.com/synth-laboratories/stack/compare/v0.2.0-dev.20260701.4...HEAD
[0.2.0-dev.20260701.4]: https://github.com/synth-laboratories/stack/releases/tag/v0.2.0-dev.20260701.4
[0.2.0-dev.20260701.3]: https://github.com/synth-laboratories/stack/releases/tag/v0.2.0-dev.20260701.3
[0.2.0-dev.20260701.2]: https://github.com/synth-laboratories/stack/compare/c55e68f...HEAD
[0.2.0-dev.20260701.1]: https://github.com/synth-laboratories/stack/commit/c55e68f
[0.1.0]: https://github.com/synth-laboratories/stack/releases/tag/v0.1.0
