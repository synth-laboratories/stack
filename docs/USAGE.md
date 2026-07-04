# Stack — Usage & reference

> **Public docs:** [docs.usesynth.ai/stack](https://docs.usesynth.ai/stack/overview) —
> Quickstart, goal mode, cockpit, stackd, MCP, configuration.
> This file is the **engineer/operator deep reference** in the repo (includes smoke
> commands and internal paths). Keep user-facing Mintlify pages in sync when behavior
> changes.

> Controls, the stackd local API, the monitor, workspace config, and Stack MCP.
> For install and overview, see the [README](../README.md).

## Controls

- `Enter`: send the Agent prompt to local Codex
- `Tab`: switch between Agent input, model, effort, environment, Local
  Research, hosted optimizers, remote SMR, and session history
- `x`: toggle the Stack Agent Bridge between local-only and remote-only mode.
  Local mode shows local eval/optimizer state; remote mode shows auth, SMRs,
  Factories, hosted optimizers, and the mediation target the agent can operate
  through Stack MCP.
- Environment: `j` / `k` moves across dev, staging, and prod. `r` refreshes
  account, hosted optimizer, and remote SMR state for the selected environment.
- Local Research: `Enter` starts the local GEPA service, `r` refreshes, and
  `j` / `k` moves through recent optimizer jobs
- Hosted Optimizers: `r` refreshes and `j` / `k` moves through recent hosted
  optimizer jobs from the selected remote environment. `o` cycles known artifact
  names for the selected hosted job, `v` stages bounded artifact preview, `d`
  stages artifact download, and `c` stages cancel for the selected hosted
  optimizer job; `Enter` confirms the staged action.
- Remote SMR: `r` refreshes, `j` / `k` moves through recent remote jobs, and
  `f` moves through factories. `o` cycles the selected WorkProduct/artifact
  output for the selected run. `t` cycles the mediation target across the
  selected run, selected Factory, and selected hosted optimizer. Type a message
  draft in the Agent input, move focus to Remote SMR, then press `m` to stage a
  live run or Factory-project message. `O` opens the selected run's hosted
  artifact after a HEAD precheck when one is available. Type a local path in
  the Agent input, optionally as `local/path -> remote/path`, then press `a` to
  stage run-file upload for the selected run. `p`, `u`, `s`, `w`, `d`, `v`, and
  `l` stage other remote actions; `Enter` confirms the staged action. `v`
  previews a bounded slice of the selected output through the same backend owner
  content route used by downloads. `l` previews the latest saved download for
  the selected run from Stack's local download state. Confirmed downloads save under
  `.stack/downloads/<environment>/<run-id>/`, and the latest saved output is
  persisted in `.stack/downloads/<environment>/history.json` and shown in the
  Live Ops rail and selected-run detail across TUI restarts.
- During a Codex app-server turn, `Enter` steers with the current input,
  `Ctrl+Enter` queues the current input as the next turn, and `Esc` pauses the
  chat so you can scroll the transcript (`j`/`k`, Page Up/Down) and draft input.
  While paused, `Esc` again requests a turn interrupt. Outside an active turn,
  `Esc` clears the current input and never quits Stack.
- `/exit`: quit Stack explicitly.
- `/permissions`: review telemetry and privacy choices. Aliases: `/perm`,
  `/settings telemetry`. Until advanced telemetry is chosen, a one-line reminder
  appears above the worker input and in the footer.
- `/mode eng` or `/mode research` (`/work_mode` also works): records the
  intended work mode for future routing. It is intentionally a no-op today
  beyond updating the TUI state and status feedback.

### Slash commands

Type `/` in the active input to open the slash menu. The menu supports fuzzy
matching, aliases, and tab completion.

| Command | Purpose |
| --- | --- |
| `/help` / `/?` | Show available commands |
| `/exit` / `/quit` | Quit Stack |
| `/goal ...` | Show, set, pause, resume, clear, or edit goal criteria |
| `/gardener [message]` / `/g` | Focus the gardener in the core panel or send it a message |
| `/monitor on\|off\|show\|hide\|chat\|stream\|message` / `/m` | Toggle, show, hide, focus, or message the monitor |
| `/lights on\|off` | Open or close the Lights status panel |
| `/efforts` | Open the Efforts workstream panel |
| `/threads` / `/p` | Open thread navigation; `/threads new` starts a new thread |
| `/mode eng\|research` / `/work_mode` | Record the future work-mode flag |
| `/env dev\|staging\|prod` | Change the selected Stack environment |
| `/provider chatgpt\|cursor` | Change the worker provider |
| `/profile research\|engineering\|product` | Change the Stack profile |
| `/model [filter]` | Select a worker model |
| `/effort` | Cycle reasoning effort |
| `/subagents on\|off` | Toggle subagents |
| `/experimental` | Toggle experimental controls |
| `/usage daily\|weekly\|cumulative` | Refresh ChatGPT limits, token activity, and Synth plan usage |
| `/ops` | Open the ops panel |
| `/actors` | Toggle actor status |
| `/agent` | Focus worker chat |
| `/agent-view` / `/a` | Toggle the full agent event stream |
| `/permissions` / `/perm` | Review telemetry/privacy choices |
| `/settings telemetry` | Open telemetry settings |
| `/config` | Open editable Stack config |
| `/details` / `/d` | Toggle verbose transcript details |
| `/rails` / `/b` | Toggle side rails |
| `/clear` / `/c` | Clear the draft input |

### Lights panel

`/lights on` opens the right-panel cockpit without changing the active core
panel. The panel summarizes:

- **Threads:** live/current/goal status, relative age, token count when
  available, title or goal preview, viewed/unviewed state, and latest monitor
  headline.
- **Gardeners:** gardener lifecycle, inbox count, target thread, and workspace.
- **Actors:** active worker/runtime model counts.
- **Cloud:** selected environment, projects, factories, runs, deployments, and
  hosted optimizers.
- **Local:** local optimizer/container runtime status.
- **Usage:** account/rate-limit state.

Within Lights, the Threads section is independently scrollable and filterable.
Filters include `all`, `live`, `active`, `goal`, `paused`, `done`, `archived`,
`gardener`, `worker`, `viewed`, `unviewed`, and free-text title/id matches.
Selecting a worker thread opens it in the worker/aux lane; selecting a gardener
thread opens the gardener in the core panel. Viewed/unviewed markers persist
under `.stack/config/lights-thread-view.json`.

### Efforts

Efforts are durable workstream containers for long-running research and
engineering work. They give a project a stable home across many threads, runs,
handoffs, optimizer jobs, SMR runs, human ideas, research logs, and proof
artifacts. A human can start a serious workstream such as `banking77-top-score`
or `craftax-reflexion`, bind agents to it over time, preserve the operator's
thinking, collect local and hosted evidence, and hand off the work with a
coherent folder, timeline, artifacts, and acceptance packet.

An Effort is a sibling to a meta-thread, not a meta-thread kind. The Effort owns
the folder and accumulated project context. Meta-threads own agent execution,
goals, handoffs, and thread lifecycle; they can point at an Effort through
`effort_ref`.

`/efforts` opens the right-panel Efforts view. It shows active and archived
Efforts, a compact template starter row, status, bound thread counts,
local/hosted refs, bound meta-thread goal context with usage/time when
available, artifact counts, the latest progress line, the latest typed activity
receipt, and generated handoff packet availability when `HANDOFF.md` exists.
When an acceptance summary exists at
`findings/results/acceptance-summary.md`, the panel shows a separate acceptance
row with parsed v1 and graduation status. When an engineering change packet
exists at `findings/results/engineering-change-summary.md`, the panel shows a
separate engineering row with changed-file, validation, skipped-gate, risk, and
update-age signals. With the panel focused, `j`/`k` select an Effort, `n` starts
a new Effort command, `h` refreshes that Effort's `HANDOFF.md`, `a` archives or
reactivates the selected Effort, and `b` binds the current meta-thread to the
selected Effort through stackd before updating the Effort reverse index.
`/efforts new <slug> [--template <id>]`,
`/efforts archive <effort>`, and `/efforts activate <effort>` provide the same
create/archive lifecycle path from the slash command line.

CLI:

```bash
stack effort create banking77-top-score --template task-classifier
stack effort templates
stack effort list
stack effort show banking77-top-score
stack effort audit banking77-top-score
stack effort activity banking77-top-score --limit 20
stack effort bind banking77-top-score <meta-thread-id>
stack effort progress banking77-top-score "Baseline and split protocol recorded"
stack effort blocker banking77-top-score --blocker "Hosted graduation path not selected" --evidence "A0/A1 recorded; A2-A4 are optional graduation proofs" --owner operator --next "Choose hosted GEPA, SMR harness, or Tinker proof if stronger evidence is needed"
stack effort acceptance banking77-top-score A1 --state recorded --status "heldout proof recorded" --evidence "scorecard receipt <path>" --path findings/proof/local-gepa/heldout-score.txt --result "candidate beat baseline" --next "Review graduation path"
stack effort research-log banking77-top-score "Local GEPA smoke" --work-summary "Ran local optimizer and copied scorecard artifacts" --operator-message "Use Banking77 as the acceptance Effort"
stack effort handoff banking77-top-score --summary "Banking77 A0/A1 packet is ready for review" --next "Review heldout proof and decide hosted graduation"
stack effort engineering-packet stack-efforts --repo ../stack --summary "Efforts capture surface implemented" --validation "bunx tsc --noEmit --pretty false passed" --next "Review changed files and release notes"
stack effort idea banking77-top-score "Try transfer before full gate" --origin HUMAN
stack effort note banking77-top-score "Manual review notes" --kind human --body "Operator context to preserve for the next agent"
stack effort repo banking77-top-score --path ../evals/projectbench/factory_projects/banking77_simple_factory --repo-ref evals:banking77-simple
stack effort finding banking77-top-score "Local GEPA scorecard" --kind proof --path findings/proof/local-gepa
stack effort finding banking77-top-score "Pulled hosted scorecard" --kind proof --receipt-path .stack/evidence/roundtrip/<receipt>.json
stack effort capture banking77-top-score "Terminal heldout receipt" --capture-kind terminal --kind proof --path findings/proof/local-gepa/heldout-score.txt
stack effort optimizer-candidate banking77-top-score --optimizer-run-id <run-id> --candidate-id <candidate-id> --score <score> --score-label "heldout accuracy" --split heldout --path findings/proof/local-gepa/<candidate-file>
stack effort refs banking77-top-score --optimizer-run-id <run-id> --smr-run-id <run-id> --tinker-run-id <run-id>
stack effort status banking77-top-score active
stack effort archive banking77-top-score
```

`stack effort show` prints the same orientation cues as `stack_effort_get`: key
file paths, acceptance summary when present, bound meta-thread context, latest
progress, latest activity, latest blocker, parsed acceptance packet state,
receipt-source provenance when
present, and small progress/activity/blocker tails. Use `stack effort activity
<effort> --limit <n>` for a dedicated human-readable or JSON activity timeline
from `ACTIVITY.jsonl`.

`stack effort audit <effort>` is the read-only coherence check for handoff and
acceptance review. It reports `pass`, `warn`, or `fail` checks for scaffold
files, manifest/registry agreement, research-log shape, progress and activity
timelines, structured blocker receipts, human context, idea origin tags,
promoted idea backlinks, promoted findings, generated handoff sections,
acceptance summary presence, acceptance criteria coverage, task-classifier
A0/A1 v1-bar evidence, optional hosted/SMR/Tinker graduation coverage,
thread/repo/run refs, receipt-sidecar counts, and local meta-thread
`effort_ref` back-links.

`stack effort acceptance <effort> <A0|A1|A2...>` records or updates one
acceptance level in `findings/results/acceptance-summary.md`. Use `--state
recorded|pending|not_recorded`, `--status`, repeated `--evidence`, repeated
`--path`, `--result`, `--decision`, and `--next` to preserve the proof and next
action. Stack also appends a typed `effort.acceptance_recorded` activity record,
so acceptance updates show up in orientation payloads and generated handoffs.

`stack effort list` is the human scan view. It groups Efforts by status and
shows the template, bound-thread count, repo/optimizer/SMR/Tinker ref counts
when present, audit status, handoff and acceptance markers, latest progress,
latest activity, latest typed optimizer candidate, latest blocker, last update
time, and visible folder ref. JSON mode includes the same orientation fields for
scripts and review packets.

`stack effort engineering-packet <effort>` writes or refreshes
`findings/results/engineering-change-summary.md`. It is the Engineering Effort
answer to "what changed?": changed files, optional git diff stat, validation,
skipped gates, risks, and next action in one stable review packet. Pass
`--repo <path>` to read a local git worktree, `--base <ref>` to diff against a
base ref, or use repeated `--file`, `--validation`, `--skipped-gate`, and
`--risk` flags for a manual packet.

For `stack effort finding --path`, relative paths resolve inside the Effort
folder first, then from the current shell directory, then from the Stack working
directory. Existing Effort-local paths are recorded in place; external files or
directories are copied into the selected `findings/*` folder. Path-based
findings write a local-source `.receipt.json` sidecar next to the recorded
finding, including source kind, workspace path, and a file or directory digest
where available. `stack effort finding --receipt-path` accepts a
`stack_pull_artifact` receipt, reads the pulled `workspace_path`, records that
artifact as the finding source, and preserves the hosted/saved artifact receipt
metadata in the same sidecar shape.

Local/ad-hoc evidence can be terminal output, CLI receipts, JSONL traces,
scorecards, prompts, configs, candidate files, local folders, browser captures,
screenshots, screencaps, video links, copied notes, memory updates, monitor
outputs, MLDP entries, or policy/reflection artifacts. Use a first-class
artifact adapter when one exists; otherwise attach the local file or folder
immediately so the Effort preserves source provenance.

`stack effort capture` is the capture-oriented alias for this path. It records
terminal, browser, screenshot, video, local, monitor, memory, text, benchmark,
or optimizer evidence into `findings/*` and marks the receipt `source_kind` as
`<capture-kind>_capture`. Use `--kind` to override the target finding bucket;
otherwise captures default to proof evidence, except benchmark captures default
to data. Use `--body` for quick terminal/text excerpts, `--path` for local files
or folders, and `--receipt-path` for previously pulled hosted/saved artifacts.

`stack effort optimizer-candidate` is the first-class adapter for GEPA and hosted
optimizer candidate proof. It records into `findings/proof/`, preserves
`optimizer_run_id`, `candidate_id`, `score`, `score_label`, and `split` in the
activity receipt and MCP response, and marks any source sidecar as
`source_kind=optimizer_candidate`. Use `--path` for local GEPA candidate files or
`--receipt-path` after `stack_pull_artifact` for hosted optimizer artifacts.
For `task-classifier` Efforts, `stack effort audit` requires this typed
optimizer-candidate receipt before the optimizer-candidate check passes.
`stack effort show` prints recent typed candidates, and `stack effort list`
prints the latest candidate line for quick Banking77-style scans.

For MCP workflows, `stack_effort_record_finding` accepts the same
`path` or `receipt_path` inputs and returns receipt metadata alongside the usual
Effort orientation payload, including the Effort-local `source_receipt_path` and
generic `source_receipt` object. `artifact_receipt` is populated for
`stack_pull_artifact` receipts as a compatibility alias for hosted/saved pulls.
`stack_effort_record_capture` is the MCP twin of `stack effort capture` and
returns the same orientation payload plus `capture_kind`.
`stack_effort_record_optimizer_candidate` is the MCP twin of
`stack effort optimizer-candidate` and returns the same orientation payload plus
candidate id, optimizer run id, score, score label, split, and receipt metadata.
`stack_effort_get` includes an `optimizer_candidates` tail, and
`stack_effort_list` includes `latest_optimizer_candidate`.
`stack_effort_record_acceptance` is the MCP twin of `stack effort acceptance`;
it updates `acceptance-summary.md`, appends a typed acceptance activity receipt,
and returns the current Effort orientation payload.
`stack_effort_write_engineering_packet` is the MCP twin of
`stack effort engineering-packet`.

For `stack effort repo --path`, relative paths use the same resolution rule.
File paths are copied under `repos/`; directory paths write a small pointer
record instead of recursively copying the whole worktree.

Default folder:

```text
efforts/<slug>/
  effort.toml
  PLAYBOOK.md
  HANDOFF.md             # generated by stack effort handoff
  PROGRESS.md
  ACTIVITY.jsonl         # typed append-only activity receipts
  research_log.md        # research templates only
  ideas/
  human/
  notes/
  repos/
  findings/
    ideas/
    code/
    data/
    proof/
    results/
```

`effort.toml` is the manifest and ref authority. `PROGRESS.md` is the terse
operator/gardener status log. `ACTIVITY.jsonl` is the typed append-only receipt
trail for Effort mutations, suitable for agents and future cockpit timelines.
`PLAYBOOK.md` is copied from the selected template
and tells agents how that Effort type should be worked and resumed. Each bundled
playbook includes a `Resume / Orientation` section that points agents at
`PROGRESS.md`, `ACTIVITY.jsonl`, `research_log.md` when present, operator
context, ideas, findings, bound meta-threads, and refs before taking action.
Research-derived
templates also include `research_log.md`, a chronological lab notebook modeled
after the Craftax Reflexion research log: operator messages stay verbatim, agent
work is summarized, and metrics, runs, evidence, open threads, key paths, and
reproduce commands are recorded over time. Use it for actual run examples,
operator corrections, and research decisions; do not let high-level architecture
notes substitute for observed behavior with run ids or artifact paths.

Use `human/` for operator context that should survive handoffs, and `repos/` for
local repo, worktree, and evidence-packet pointers.

Research Efforts are for uncertain, evidence-seeking work: optimization, evals,
model behavior, Reflexion/MAPO systems, classifier/task-family exploration, or
rubric-scored research. They advance by hypotheses, experiments, failures,
metrics, and proof artifacts. Engineering Efforts are for implementation and
delivery: product features, integrations, refactors, release work, and
multi-slice bug fixes. They advance by scoped changes, notes, validation status,
docs/release impact, and rollout risk.

Every Effort has an `ideas/` inbox. Mark idea origin in brackets in filenames and
headings:

```text
ideas/[HUMAN]-try-transfer-before-full-gate.md
ideas/[AGENT]-mine-rare-tier-failures.md
ideas/[MIXED]-gate-headroom-rule.md
```

Human phrasing should remain visible when an idea is promoted. Once an idea has
evidence, a concrete artifact, or a reusable conclusion, record the promoted
claim under `findings/ideas/` and link back to the original idea file.

Findings are promoted artifacts:

- `findings/ideas/`: promoted hypotheses, design routes, and negative results
- `findings/code/`: prompts, configs, harness recipes, patches
- `findings/data/`: seeds, splits, corpora, traces
- `findings/proof/`: scorecards, receipts, run packets, heldout proof,
  screenshots, screencaps, browser captures, video links, terminal receipts,
  monitor outputs, and proof packets
- `findings/results/`: summaries, acceptance reports, final writeups

Bundled templates live under `bundled/efforts/`:

| Template | Used for |
| --- | --- |
| `research` | general uncertain research and eval exploration |
| `engineering` | product/system implementation and release work |
| `system-optimizer` | Reflexion, MAPO, memory, policy/intervention systems |
| `task-classifier` | Banking77-style classification optimization |
| `task-agentic` | long-horizon task agents |
| `task-nonverifiable` | rubric-graded or subjective work |
| `product` | future product/ops workstream stub |

Built-in template IDs resolve from `bundled/efforts/` so product updates such as
acceptance criteria are not hidden by stale first-run copies. Custom installed
template IDs can live under `.stack/efforts-templates/`.

Use `stack effort templates` to list the available playbooks. The output shows
whether the template is bundled or installed, whether it includes a research log,
how many findings folders it seeds, and whether it carries acceptance criteria.

Stack MCP exposes the same Effort storage to gardeners and agents:

- `stack_effort_templates`
- `stack_effort_create`
- `stack_effort_list`
- `stack_effort_get`
- `stack_effort_audit`
- `stack_effort_activity`
- `stack_effort_bind_thread`
- `stack_effort_update_progress`
- `stack_effort_record_blocker`
- `stack_effort_record_acceptance`
- `stack_effort_record_research_log`
- `stack_effort_write_handoff`
- `stack_effort_record_idea`
- `stack_effort_record_note`
- `stack_effort_record_repo`
- `stack_effort_record_finding`
- `stack_effort_record_capture`
- `stack_effort_record_optimizer_candidate`
- `stack_effort_write_engineering_packet`
- `stack_effort_update_refs`
- `stack_effort_update_status`

Use `stack_pull_artifact` before `stack_effort_record_finding`,
`stack_effort_record_capture`, or `stack_effort_record_optimizer_candidate` when
evidence comes from a hosted optimizer artifact or saved SMR/WorkProduct
download. Pass the returned `receipt_path` instead of unpacking the receipt by
hand. For local/ad-hoc evidence, pass `path`; Stack writes the Effort-local
source receipt sidecar directly. The CLI equivalents are `stack effort finding
--receipt-path <receipt>`, `stack effort capture --receipt-path <receipt>`,
`stack effort optimizer-candidate --receipt-path <receipt>`, and their `--path`
variants.

Thread creation tools can bind directly into an Effort too. Pass `effort_ref` to
`stack_meta_thread_create` when binding an existing session or to
`stack_worker_thread_create` when spawning a new worker. Stack writes
`effort_ref` on the stackd meta-thread manifest and appends the meta-thread id
to the Effort in the same call, so the new thread appears in `/efforts`,
`stack_effort_get`, and future handoffs without a separate bind step.

Use `stack_effort_get` as the compact orientation call. It returns the manifest,
registry record, workspace path refs for `PLAYBOOK.md`, `PROGRESS.md`,
`ACTIVITY.jsonl`,
`research_log.md` when present, `ideas/`, `findings/*`, and
`acceptance_summary` when `findings/results/acceptance-summary.md` exists, plus
a parsed `acceptance_packet` with A0-A4 level states, v1 status, graduation
status, recorded levels, and open levels. It also returns a machine-readable
`artifact_inventory` covering generated files, ideas, human
notes, repo pointers, findings, receipt sidecar paths, and parsed
`receipt_sources` provenance with source kind, workspace path, finding path,
and digest when available. It also returns typed optimizer candidates, the
latest progress line, latest blocker, `remaining_work`, small
progress/activity/blocker tails, and compact `bound_meta_threads` context for
each bound meta-thread. `remaining_work` combines open acceptance levels with the
latest typed blocker next action. Effort MCP mutation responses return the same
orientation context after applying the change.
`stack_effort_list` is also an orientation surface: each row includes path refs,
audit status, latest progress, latest activity, latest blocker,
latest typed optimizer candidate, repo/optimizer/SMR/Tinker ref counts, artifact
counts, `remaining_work`, and handoff/acceptance markers so gardeners can choose
the right Effort before calling `stack_effort_get`.
The `/efforts` TUI panel keeps the same scan lightweight but also surfaces
preserved idea and human-context counts, and annotates receipt counts with
parsed source-kind counts when available, such as local path or hosted artifact
provenance. Efforts with typed optimizer candidates show a compact candidate row,
and Efforts with open acceptance or blocker next-action work show a compact
remaining row. Engineering Efforts with `engineering-change-summary.md` show a
compact changed-file/validation row. The panel also keeps a selected Effort row
so an operator can refresh the selected handoff packet, create a new Effort,
archive/reactivate an Effort, or bind the current meta-thread without leaving the
cockpit.
Use `stack_effort_activity` when a gardener or agent needs a bounded timeline
larger than the compact orientation tail.
Use `stack_effort_audit` before handoff or review when the question is whether
the Effort packet is structurally coherent rather than what the latest event was.
The audit validates receipt sidecars when present, including schema,
`receipt_path`, `workspace_path`, and the Effort-local finding they document.

Use `active`, `paused`, `done`, or `archived` for Effort status. Do not use
`blocked`. When progress depends on a decision, credential, hosted capacity, or
another owner, keep the Effort active or paused and write the exact blocker,
evidence, next owner, and next safe action in `PROGRESS.md`. Prefer
`stack effort blocker` or `stack_effort_record_blocker` for this so the same
entry also appears in `ACTIVITY.jsonl` as `effort.blocker_recorded`.

Banking77 is the acceptance Effort. A0 proves scaffold, CLI/MCP/TUI visibility,
a bound meta-thread, a `[HUMAN]` idea, and progress capture. A1 proves local
GEPA artifacts can be attached to the Effort: run id, candidate artifact,
visible result, heldout scorecard, and research log entry. A2 records hosted
GEPA graduation when available. A3 records synth-ai SMR harness proof. A4
records synth-ai SMR/Tinker proof. `stack effort refs` and
`stack_effort_update_refs` can attach optimizer, SMR, and Tinker run ids. The
`task-classifier` template seeds these
criteria into `effort.toml` unless explicit criteria are provided at create time.
A0 + A1 are the required v1 product bar; A2-A4 are stronger full-stack proofs.
The default route is local GEPA first, Synth hosted GEPA after local proof when
auth/capacity/cost allow it, synth-ai SMR harness proof for direct execution
evidence, and SMR/Tinker proof for training-style model/data/run artifacts.
Refs alone do not satisfy A2-A4: hosted graduation needs proof artifacts under
`findings/proof/`, configs or recipes under `findings/code/`, and a
`research_log.md` entry naming the run id, environment, result, and caveats.
After those proof artifacts exist, use `stack effort acceptance <effort> <A#>`
or `stack_effort_record_acceptance` to update the matching acceptance section
and append a typed `effort.acceptance_recorded` activity receipt.
Generated handoffs include dedicated Acceptance Packet, Audit, and Recorded
Blockers sections, plus a Remaining Work section that summarizes open acceptance
levels and the latest blocker next action. The packet points at
`findings/results/acceptance-summary.md` when present, embeds the latest
coherence audit status, and surfaces recent `effort.blocker_recorded` receipts
from `ACTIVITY.jsonl`. Handoffs also show receipt-sidecar counts and a dedicated
Receipt Sidecars artifact section.

Stack writes local session logs under `.stack/sessions/`. Current release includes
read-only remote SMR visibility for jobs, run artifacts, WorkProducts, and
factories, hosted optimizer job visibility/detail, and local optimizer job
visibility. The implemented remote action surface covers live SMR/Factory
messages, SMR lifecycle controls, run-file
upload, WorkProduct/artifact preview/download, persisted saved-download
preview, hosted optimizer cancel, and hosted optimizer artifact
preview/download.

### stackd local API

`stackd` is the localhost control plane for local Stack state. It indexes local
threads, serves Stack MCP, appends Stack-side events, exports traces, and owns
local Stack persistence for meta-thread and handoff lifecycle resources. Codex
still owns JSONL transcripts under `~/.codex/sessions/`; Stack projects those
transcripts into typed stackd views instead of treating them as the Stack state
owner.

```bash
./bin/stackd serve
curl -s http://127.0.0.1:8792/health
curl -s http://127.0.0.1:8792/telemetry/status
curl -s -X POST http://127.0.0.1:8792/telemetry/config -H 'content-type: application/json' -d '{"advanced_product":"declined"}'
curl -s -X POST http://127.0.0.1:8792/telemetry/flush
curl -s "http://127.0.0.1:8792/telemetry/crashes?limit=5"
curl -s http://127.0.0.1:8792/.well-known/mcp.json
bun run smoke:stackd
bun run smoke:mcp:http
bun run smoke:stackd:telemetry
bun run smoke:telemetry:approval
bun run smoke:usage-ingestion
bun run smoke:stackd:crash-report
stack crashes --json
stack crashes --remote --json
stack telemetry digest --remote --json
```

When `stackd` is healthy it also hosts **live Stack MCP** at `http://127.0.0.1:8792/mcp`
(streamable HTTP). Cursor and other MCP clients can attach to that URL instead of
stdio `stack-mcp`. The `/health` response includes `mcp_url`; discovery lives at
`/.well-known/mcp.json`. Disable the sidecar with `STACKD_MCP=0`.

`./bin/stack` auto-starts `stackd` when `/health` is unavailable, exports
`STACK_API_URL` as `http://127.0.0.1:8792`, and continues without the sidecar if
startup fails. Logs are written to `.stack/runtime/stackd.log`.

The TUI is a client of stackd for local thread lists, trace, export,
meta-threads, handoffs, and event streams. It may render cached/degraded views
when the sidecar is unavailable, but stackd owns local Stack persistence
mutations. Client code should not directly write stackd-owned resources such as
`.stack/meta-threads/**`, handoff JSON, handoff artifacts, successor sessions,
receipts, or update state.

Routes in L1: `/health`, `/mcp`, `/.well-known/mcp.json`, `/threads`, `/threads/:id`,
`/threads/:id/status`, `/threads/:id/events`, `/threads/:id/actors`,
`/events/stream`,
`/threads/:id/monitors/:monitorId/pause`,
`/threads/:id/monitors/:monitorId/resume`,
`/threads/:id/monitors/:monitorId/mode`, `/threads/:id/trace`,
`/threads/:id/export`, `/logs/query`, `/telemetry/status`,
`/telemetry/events`, `/telemetry/crashes`, and
`/doc` (`/openapi.json`). Export writes
`.stack/exports/<session-id>/<stamp>/` with `manifest.json`, redacted
`session.json`, `metadata.json`, optional `codex.jsonl`, and optional
`meta-events.jsonl`, `monitor_usage.json`, and `actors.json`. Thread core-agent
and meta-harness events live at `.stack/events/threads/<session-id>.jsonl` and
capture Stack-side events such as `agent.tool.completed`, `agent.tool.failed`,
`agent.turn.completed`, `skill.read`, `monitor.wake`, `monitor.summary`,
`monitor.queued`, `monitor.usage`, `monitor.checkpoint`, and
`monitor.skill_context_push`.
Monitor actor checkpoints live under
`.stack/actors/<session-id>/monitors/<monitor-actor-id>.json`.
`POST /threads/:id/events` appends core or meta events through stackd, filling
missing `thread_id`, `event_id`, `observed_at`, and `payload` defaults.
`GET /events/stream?thread_id=<id>&after_event_id=<event>` provides an SSE feed
over the same thread event log for TUI, monitor, and exporter subscribers.
stackd also runs a monitor scheduler over the same event log by default; it
dedupes trigger event ids, advances actor checkpoints, and emits
`monitor.wake`/`monitor.summary`/`monitor.usage`/`monitor.checkpoint` when
non-TUI producers append core events. The scheduler always wakes the persistent
Codex sidecar monitor. Set `STACKD_MONITOR_SCHEDULER=0` to disable it or
`STACKD_MONITOR_POLL_MS=<ms>` to tune polling.

### Stack Monitor

The monitor runtime runs inside the Stack TUI while Codex execution is still
owned there. It records Codex JSONL as normalized `agent.*` events, subscribes
to tool/turn triggers, writes durable monitor actor checkpoints, emits
thread-scoped `monitor.*` events, and shows the latest monitor status in the
left rail.

**Sidecar (shipped):** in **`/goal` mode**, the default center view is **Sidecar
events** — a curated feed of human-facing monitor updates, not the raw worker
transcript. The worker tape is **thinking traces**; the sidecar is the higher-level
stream: what the worker is doing, what milestone landed, what went wrong.

| Key | View |
| --- | --- |
| `e` | **Sidecar events** (default) — `monitor.goal_status` rows with `for_human: true`, steers, errors |
| `t` | **Sidecar thread** — monitor Codex reasoning (how it decided) |
| `a` | **Agent tape** — full `agent.*` + `monitor.*` interleave for debug |

Monitor posts operator-visible updates through the Stack MCP tool
**`stack_monitor_goal_status`** (`status`, `headline`, `note`, `for_human`, optional
`metric`). The goal shutter also shows a **headline strip** and **milestone timeline**
from typed `monitor.goal_status` events. The monitor **audits** worker done-claims before
emitting `goal_met`; bogus claims surface as `goal_failed` / `blocked`.

Profiles (seeded into `.stack/monitors/` on first run from `bundled/monitors/`):

- `default` — primary monitor actor
- `progress-narrator` — passive human progress updates (`operator_update` on `monitor.summary`)

Useful overrides:

- `STACK_MONITOR_PROFILE=progress-narrator`
- `STACK_MONITOR_ENABLED=0`
- `STACK_MONITOR_STRICTNESS=passive|conservative|aggressive`
- In the TUI, `M` cycles the current thread through
  `off -> passive -> conservative -> aggressive -> off` and records
  `monitor.paused`, `monitor.resumed`, or `monitor.mode_changed`.

**Not yet shipped:** full multi-goal portfolio view, ETA/progress rate, bulk archive,
and cross-actor wake-gardener escalation. Risky-pending actions are surfaced as
high-severity monitor signals for pause/escalation; sidecar pause
(`stack_sidecar_pause_for_restart`) sleeps the monitor until the next wake — it
does not archive threads. Use gardener-owned meta-thread lifecycle controls to
archive or revive threads.

The monitor pass is event-backed: it checks enabled focus areas such as style,
goal progress, skills, tool use, scope control, and acceptance.
The monitor is always a persistent Codex sidecar thread. Stack wakes that same
Codex thread for event batches and operator sidecar chat. There are no monitor
worker overrides.
When the skills focus detects Stack/Synth work without a recorded skill use and
`skill_context_push` is enabled, the monitor emits a visible
`monitor.skill_context_push` message for the primary actor instead of silently
mutating context.

Style steering is guidance-backed. When a primary turn trips a Synth/Stack style
rule such as `git stash`, destructive git cleanup, opportunistic cleanup,
cross-authority storage scraping, or raw secret paste, the monitor searches the
bounded Stack guidance index, records `guidance.query`, and emits at most one
`monitor.steer` per rule with the selected `guidance_id` and excerpt. The same
guidance index includes app/repo/personal style plus org Synth Style when that
workspace source is present; see `.stack/guidance/monitor-visible-context.md`
for the exact monitor-visible sources and exclusions.

Monitor verification (run from `~/Documents/GitHub/testing`, not from `stack/`):

```bash
export STACK_REPO_ROOT=~/Documents/GitHub/stack
bun run stack/smoke/smoke_goal_shutter.ts
bun run stack/smoke/smoke_sidecar_render.ts
bun run stack/end_to_end/monitor_feed/tmux_monitor_feed_proof.ts
```

### Actors Preview

The right ops panel opens in **Actors** mode for the F2/L5 subagent preview. Press
`p` to cycle `Actors -> Local -> Synth Hosted`, or press `a` while focused on the
ops panel to return to Actors. The panel shows the current Codex
`features.multi_agent=<bool>` launch override, whether launch args are locked by
`STACK_CODEX_ARGS`, the configured Stack subagent model policy, the primary
actor state, and transcript-derived worker subagents parsed from
`spawn_agent` / `wait_agent`.

Press `enter` in Actors mode to toggle subagents for the next Codex launch when
`STACK_CODEX_ARGS` is not set. The bottom control row also exposes worker model,
effort, and on/off chips; tab to a worker chip and use `j/k`, arrows, space, or
enter to change the subagent policy for future launches. Stack syncs model and
effort choices into project custom agents under `.codex/agents/` for `default`,
`worker`, and `explorer`. Override the default before launch with
`STACK_CODEX_SUBAGENTS=0` or `STACK_CODEX_SUBAGENTS=1`,
`STACK_CODEX_SUBAGENT_MODEL`, and `STACK_CODEX_SUBAGENT_REASONING_EFFORT`.

Env:

- `STACK_ROOT`: app root; defaults to current directory for `stackd`
- `STACK_API_URL`: client URL; defaults to `http://127.0.0.1:8792`
- `STACK_API_BIND`: bind host; defaults to `127.0.0.1`, with `0.0.0.0` only by explicit opt-in
- `STACK_API_PORT`: port; defaults to `8792`
- `CODEX_HOME`: Codex home; defaults to `~/.codex`

### Workspace Config

Stack reads `stack.config.json` from this repo. `workingDir` controls where
Codex runs and what the Agent pane shows as `cwd`; relative paths resolve from
the Stack repo root. Point `environments.dev.apiBaseUrl` at your Synth API
(or a local backend if you run one).

```json
{
  "workingDir": "..",
  "defaultEnvironment": "dev",
  "environments": {
    "dev": {
      "label": "Dev",
      "apiBaseUrl": "http://127.0.0.1:8000",
      "authEnv": "SYNTH_API_KEY",
      "optimizerDbPath": ".stack/optimizers/gepa-service.sqlite",
      "optimizerServiceUrl": "http://127.0.0.1:8879"
    },
    "staging": {
      "label": "Staging",
      "apiBaseUrl": "https://api-dev.usesynth.ai",
      "authEnv": "SYNTH_API_KEY",
      "authEnvFile": "../synth-ai/.env"
    },
    "prod": {
      "label": "Prod",
      "apiBaseUrl": "https://api.usesynth.ai",
      "authEnv": "SYNTH_API_KEY"
    }
  }
}
```

Override it for one run with `STACK_WORKING_DIR=/path/to/workspace ./bin/stack`.
Stack passes `--skip-git-repo-check` to Codex by default so parent workspaces
such as `~/Documents/GitHub` can be used even though they are not single git
repositories.

The Agent pane includes a Stack Agent Bridge strip above chat. It shows the
active bridge mode, the Stack MCP status tool Codex should start from, selected
environment, backend-owner route/MCP readiness, current mediation target, any
message draft, and pending action. The left rail is an Agent Bridge status rail
for local optimizers, hosted optimizer runs, live SMR runs, Factories, and the
current mediation target. Local-only and remote-only mode deliberately hide the
inactive side so Codex and the human operator do not mix local service actions
with remote owner-route actions. The Sessions panel shows the selected remote account
profile, API base URL, auth environment variable, health status, hosted
optimizer jobs, recent remote SMR jobs, selected-run artifact and WorkProduct
summaries, selected-run file mounts, and remote factories. Local optimizer state remains local; hosted
optimizers, remote SMR, and Factory views use the selected environment profile.

Stack does not launch eval tasks. Create remote SMR runs from the owning
`evals` or `synth-dev` workflow, then use Stack to inspect the resulting
run/project ids:

```bash
# Example when STACK_SYNTH_DEV_ROOT points at a synth-dev checkout:
# $STACK_SYNTH_DEV_ROOT/scripts/eval.sh run smr/suites/readme_smoke_docker_codex.toml \
#   --target local-dockerized --instance slot1
```

Stack refreshes the remote SMR snapshot so created runs can be monitored from
the same cockpit. The selected run view shows the active WorkProduct/artifact
index, id, status/type, linked artifact id, creation time, preview text, hosted
artifact status, and latest saved download path.

### Stack MCP

Agents can use the same backend-owner live operations surface through the Stack
MCP stdio server:

```bash
./bin/stack-mcp
```

The server reads `stack.config.json` and supports both JSONL and
`Content-Length` JSON-RPC framing. It exposes:

- `stack_status`: concise Stack Agent Bridge status for Codex, including
  local optimizer state, remote SMR/Factory state, hosted optimizer state,
  auth, README-smoke state, and suggested next actions
- `stack_list_live_smrs`: list recent live SMR runs with output/message/file
  counts
- `stack_list_factories`: list remote Research Factories with routable
  project/run hints
- `stack_list_hosted_optimizer_runs`: list hosted optimizer runs with selected
  detail, artifact names, events, and cancellation hints
- `stack_list_remote_projects`: list hosted projects from the stackd runtime
  snapshot when available, including linked runs, Factories, deployments, and
  remote-sync receipt summaries
- `stack_live_status`: account health, live SMR runs, Factories, hosted
  optimizer runs, and suggested next actions
- `stack_message_live_run`: send an operator message to a live SMR run
- `stack_message_factory_project`: send an operator message through the
  Factory-owned message route
- `stack_control_live_run`: pause, resume, or stop a live SMR run
- `stack_wake_factory`: request a confirmed Factory wake through the Factory
  owner route and record a Stack receipt
- `stack_control_factory`: pause or resume a Factory through the Factory owner
  route and record a Stack receipt
- `stack_meta_thread_bind_smr_run`: bind a local meta-thread to a hosted SMR
  run and emit cross-navigation receipts
- `stack_remote_sync_request`: record a bounded push or pull request receipt
  for remote gardener review
- `stack_remote_gardener_pass`: record remote gardener sync narration and the
  next safe action in the local thread event stream
- `stack_cancel_hosted_optimizer`: cancel a hosted optimizer run
- `stack_preview_hosted_optimizer_artifact`: preview bounded text from a hosted
  optimizer artifact through the optimizer owner route
- `stack_download_hosted_optimizer_artifact`: download a hosted optimizer
  artifact through the optimizer owner route into Stack download state
- `stack_download_run_output`: download a run WorkProduct or artifact through
  owner content routes into `.stack/downloads/<environment>/<run-id>/`
- `stack_preview_run_output`: preview bounded WorkProduct or artifact text
  through owner content routes without saving a local file
- `stack_list_saved_downloads`: list persisted Stack download history for the
  selected environment
- `stack_preview_saved_download`: preview bounded text from a previously saved
  Stack download without calling the backend
- `stack_upload_run_file`: upload a local file to a live SMR run through the
  run-file owner route
- `stack_query_logs`: query VictoriaLogs through stackd's native LogSQL client for
  Stack/GEPA/meta-harness telemetry. Defaults to `slot1`, `minutes=60`, and
  `limit=100`; supports `event_domain`, `service`, `run_id`, and `thread_id`
  filters. Stack projects thread meta events to VL with
  `event_domain=meta_harness` when a slot VictoriaLogs endpoint is discoverable
  or `VICTORIA_LOGS_WRITE_URL` is set. Disable projection with
  `STACK_VL_META_PROJECT=0`; set `STACK_VL_SLOT=slot2` to target another local
  slot. Validate the local path with `bun run smoke:observability`. Validate the
  live local retention contract with `bun run smoke:observability:retention`;
  it inspects the running VictoriaLogs container args, `/metrics` flags, and
  `/victoria-logs-data` size without restarting the slot. For release gating,
  use `bun run release-check:observability`; it runs the normal release metadata
  checks plus the live retention smoke. Set
  `STACK_OBSERVABILITY_EVIDENCE_DIR=<packet-dir>` to persist
  `retention_smoke_result.json` beside the release packet. If the static
  compose flags are present but the live slot container predates them, recreate the
  VictoriaLogs service in your local observability stack, then rerun the gate.
- `stack_run_with_logs`: run a bounded local command without shell expansion and
  emit `harness-cmd` start/exit summaries to VictoriaLogs with
  `event_domain=local_optimizer` and a `run_id`.
- `stack_skills_list`: list first-class Stack skills from `.stack/skills/`
  plus bridged Codex/plugin skill roots
- `stack_skills_read`: read a skill's `SKILL.md` content and metadata; pass
  `thread_id` to record a `skill.read` meta event for that thread
- `stack_skills_search`: search skills by id, title, description, owner, and path
- `stack_guidance_list`: list searchable Stack guidance from `.stack/guidance/`
  plus configured workspace sources such as Synth Style
- `stack_search_guidance`: search guidance by query and optional scope; pass
  `thread_id` to record a `guidance.query` meta event
- `stack_guidance_read`: read a guidance item by id or path; pass `thread_id`
  to record a `guidance.read` meta event
- `stack_guidance_record_event`: record guidance lifecycle, usage, or impact
  events such as doc added/updated/deleted, used, and impact judged
- `stack_guidance_events`: list the local guidance SQLite event ledger
- `stack_skills_push_context`: record a visible monitor-to-primary skill context
  push and append it to the thread meta-harness event log
- `stack_inference_catalog`: list Synth inference lanes visible to Stack,
  including free aux, billed GLM, billing tier, role eligibility, and the
  primary-worker opt-in invariant
- `stack_inference_usage`: read Synth inference usage and free-aux budget
  summaries from backend owner endpoints without prompts or transcripts

Codex should load **`synth-stack-productivity`** first, then domain skills:

- **`synth-stack-productivity`** — OSS + hosted map (load first)
- **`oss-gepa`** — local GEPA install, optimizers repo checkout
- **`synth-via-stack`** — containers, local → hosted optimizer graduation
- **`stack-agent-bridge`** — live MCP on usesynth.ai (SMR, Factory, hosted optimizers)
- **`stack-local-setup`** — install, bootstrap, auth env files
- **`gepa`** — full Rust GEPA skill (when `optimizers/` sibling checkout is present)

- **`synth-via-stack`** — optimizers (local GEPA + hosted), **synth-ai** SDK/CLI, eval
  container contract (`/health`, `/info`, `/rollout`), local → hosted graduation
- **`stack-agent-bridge`** — Stack MCP operator workflow (SMR, Factory, previews, downloads)

Bundled source skills live in `.codex/skills/`. Stack syncs them into the global
`~/.stack/skills/` catalog and mirrors custom skills into the workspace
`.codex/skills/` directory so Codex discovers them via cwd-walk. Stack **never**
writes to `~/.codex/skills`. Stack MCP exposes the same catalog to primary and
monitor actors.

Validate skill install with:

```bash
bun run smoke:install-skills
```

Codex should use **`stack-agent-bridge`** for live operator actions and **`synth-via-stack`**
when explaining or executing optimizer/container workflows. Start live ops with
`stack_status`, explicitly choose local or remote mode before live actions,
preview outputs before downloads, and avoid bypassing Stack/backend owner
routes.

Validate the agent bridge with:

```bash
bun run smoke:agent-bridge
```

That smoke launches a real Codex turn with Stack MCP registered, invokes
`$stack-agent-bridge`, requires read-only Stack MCP calls to `stack_status` and
`stack_list_live_smrs`, checks the Codex JSONL event stream for those MCP tool
calls, and writes proof artifacts under `/tmp/stack-agent-bridge-proof/`.

Validate OpenTUI goal flows from the sibling testing repo. These runs must use
real Stack + real Codex; substituted Codex TUI acceptance scripts do not live in
Stack.

```bash
cd ../testing
bun run stack/end_to_end/tui_goal/tmux_goal_craftax_real.ts
```

Validate the first release UI guard with Bombadil:

```bash
bun run smoke:bombadil:b0
```

That command wraps the current scroll smoke as `AT-STACK-BOMBADIL-B0` and writes
a ship-readable proof JSON at `/tmp/stack-bombadil-b0-proof.json` by default.
Override with `STACK_BOMBADIL_B0_PROOF=/path/to/proof.json`.

**StackEval lives in the `evals` repo** (`synth-laboratories/evals`) at
`evals/stackeval/` and is driven from that checkout, not from Stack:

```bash
cd ../evals
STACK_REPO_ROOT=/path/to/stack stackeval/bin/stackeval run banking77-local-gepa --preset smoke
```

Stack ships no eval tasks, wrappers, or launch scripts; see the evals repo for
the task catalog, presets, harness, and run packets.

For local dev, export `SYNTH_API_KEY` (from [usesynth.ai/keys](https://usesynth.ai/keys))
before using hosted MCP tools. The server does not read SMR databases, raw Redis
keys, or compatibility projections; it uses typed backend routes and fails closed
when an owner route rejects the operation.

Stack also registers this MCP server automatically for Codex turns launched
from the Agent pane. Override the command with `STACK_MCP_COMMAND`, or disable
that per-turn MCP registration with `STACK_CODEX_STACK_MCP=0`.

Remote reads are deliberately backend-authoritative:

- account health: `GET <api>/health`
- hosted optimizer jobs: `GET <api>/api/v1/optimizers/runs?limit=12`
- hosted optimizer detail:
  `GET <api>/api/v1/optimizers/runs/{run_id}` and
  `GET <api>/api/v1/optimizers/runs/{run_id}/state`
- hosted optimizer events:
  `GET <api>/api/v1/optimizers/runs/{run_id}/events?stream=false&limit=20`
- recent jobs: `GET <api>/smr/jobs?limit=8`
- live run messages:
  `GET <api>/smr/runs/{run_id}/runtime/messages?limit=20`, or the
  project-scoped run path when available
- run artifacts: `GET <api>/smr/runs/{run_id}/artifacts?limit=20`
- run WorkProducts:
  `GET <api>/smr/projects/{project_id}/runs/{run_id}/work-products`
- run file mounts: `GET <api>/smr/runs/{run_id}/file-mounts`
- factories: `GET <api>/smr/factories?include_archived=false`
- factory schedule/status preview: `GET <api>/smr/factories/{factory_id}/status`

Remote actions are also backend-authoritative and require an explicit staged
confirmation in the TUI:

- pause run: `POST <api>/smr/runs/{run_id}/pause`, or the project-scoped run
  path when the selected run has a project id
- resume run: `POST <api>/smr/runs/{run_id}/resume`, or the project-scoped run
  path when available
- stop run: `POST <api>/smr/runs/{run_id}/stop`, or the project-scoped run
  path when available
- live run message:
  `POST <api>/smr/runs/{run_id}/runtime/messages`
- Factory/project message:
  `POST <api>/smr/factories/{factory_id}/messages`; the backend resolves the
  active, non-archived linked project and delegates to project message fanout
- factory wake preview: `POST <api>/smr/factories/{factory_id}/wake-due` with
  `dry_run: true`
- WorkProduct download:
  `GET <api>/smr/work-products/{work_product_id}/content?disposition=attachment`
- artifact download:
  `GET <api>/smr/artifacts/{artifact_id}/content?disposition=attachment`
- run file upload:
  `POST <api>/smr/runs/{run_id}/files:upload`
- hosted optimizer cancel:
  `POST <api>/api/v1/optimizers/runs/{run_id}/cancel`
- hosted optimizer artifact preview/download:
  `GET <api>/api/v1/optimizers/runs/{run_id}/artifacts/{artifact_name}`

Current push order is intentionally staged: improve local job UX first, then
remote SMR run UX, then remote Factory UX, then authenticated remote actions
for file-flow expansion and hosted optimizer control. Hosted optimizer jobs and
cancel are read/executed through the backend optimizer owner surface, not the
local GEPA service DB and not SMR compatibility projections.

## Easy start (local + hosted)

Stack reduces setup friction on the ops panel (`p` toggles **Local** vs **Synth Hosted**).
Load the bundled **`stack-local-setup`** Codex skill for install and optimizer workflows.

| What | Behavior |
| --- | --- |
| **Auth** | Reads `SYNTH_API_KEY` from the env var named in `stack.config.json` or from `authEnvFile` when set |
| **Local GEPA** | On **dev**, can auto-start `synth-optimizers gepa service` if installed (`STACK_AUTO_START_LOCAL_OPTIMIZER=0` to disable) |
| **Disable auto-start** | `STACK_AUTO_START=0` |
| **Hosted data** | Projects, containers, and hosted optimizers refresh when account is connected |
| **API keys** | Create at **[usesynth.ai/keys](https://usesynth.ai/keys)** — never commit keys |

Minimal path:

```bash
git clone https://github.com/synth-laboratories/stack.git
cd stack
make install
export SYNTH_API_KEY="..."   # from usesynth.ai/keys — or use authEnvFile in stack.config.json
stack doctor
stack
```

### Terminal auth (`stack auth`)

Signed-out install stays local-first; hosted SMR/Factory/optimizers need a Synth account.

```bash
stack login --no-browser           # print Synth sign-in URL without starting stackd
stack signup                       # open optional Synth signup
stack whoami --json                # alias for auth verification/status
stack auth urls --json              # signup/signin/keys URLs (product=stack attribution)
stack auth open signup              # open browser (or --no-browser to print URL only)
stack auth status --json            # remote account snapshot; exit 0 when connected or local-only
stack auth test signin              # optional Playwright harness (testing repo)
```

Signup/signin URLs carry `product=stack` for activation funnel rollup. Synth sign-in remains
optional for local goal mode — `stack doctor` reports `synth_sign_in_optional: true`.

### Local-only and hosted unlocks

Stack's local path does not require a Synth account. A signed-out install can
launch the cockpit, run the local Codex worker, use `/goal`, read local threads,
start local GEPA when installed, and inspect local receipts. Hosted SMR,
Factory, hosted optimizers, remote sync, and Synth inference catalog calls show
point-of-need connect copy instead of blocking boot.

`stack doctor --json` reports both sides:

- `local_ready=true` means the local cockpit path is usable.
- `synth_sign_in_optional=true` means missing Synth auth is not a local blocker.
- The inference section says the primary worker remains Codex/BYOK unless an
  explicit Synth inference profile opts in.

Use `stack auth open signin` when you want cloud features. Keep keys in the
environment or `authEnvFile`; do not paste them into prompts, tickets, or logs.

### Local to cloud sync

stackd is the local to cloud boundary. Remote sensors observe hosted projects,
SMR runs, Factories, deployments, and hosted optimizers through backend owner
routes, then reduce events into the runtime snapshot. TUI and MCP surfaces read
that snapshot first.

Stack-side levers record receipts such as:

- `lever.remote.push_requested` and `lever.remote.pull_requested`
- `lever.remote_gardener.pass_recorded`
- `lever.remote_smr.run.bound`
- `lever.remote_factory.wake_requested`
- `lever.remote_factory.paused` and `lever.remote_factory.resumed`

Those receipts are local audit records. They do not claim that the laptop owns
cloud scheduling or backend persistence. Cloud mutations still go through typed
owner routes and require explicit confirmation.

### Synth inference through Stack

Stack exposes Synth inference as an optional hosted lane. The default worker
stays Codex/BYOK.

```bash
stack inference list
stack inference usage
stack inference list --json
stack inference usage --json
```

The catalog has two lanes when the backend route is deployed:

| Lane | Route | Default roles |
| --- | --- | --- |
| Free aux | `/api/v1/stack-aux/openai/v1/responses` | monitor, gardener, remote gardener, aux |
| Billed GLM | `/api/v1/stack-inference/openai/v1/responses` | monitor, gardener, remote gardener; worker only with explicit opt-in |

Monitor and gardener Synth profiles are opt-in:

```bash
STACK_AUX_INFERENCE=1 STACK_MONITOR_PROFILE=free-aux stack
STACK_SYNTH_INFERENCE=1 STACK_MONITOR_PROFILE=billed-glm stack
STACK_AUX_INFERENCE=1 STACK_GARDENER_PROFILE=free-aux stack
STACK_SYNTH_INFERENCE=1 STACK_GARDENER_PROFILE=billed-glm stack
```

If a selected Synth monitor route is unavailable, Stack falls back to the Codex
app-server monitor and records a visible fallback notice. A selected Synth
gardener profile fails visibly instead of silently switching providers. Usage
views show spend/budget summaries only; they do not include prompts or
transcripts.

Optional: install [synth-optimizers](https://pypi.org/project/synth-optimizers/) for local GEPA.
Advanced Synth monorepo eval wrappers now live outside Stack. Launch those from
the owning checkout, then inspect the resulting SMR runs through Stack remote
panels or MCP tools.

Bootstrap logs: `.stack/bootstrap/dev-slot.log`, `.stack/optimizers/gepa-service.log`.

## Local Optimizers

Stack uses the existing optimizer service instead of duplicating optimizer
state. The Local Optimizers panel starts and reads:

```bash
synth-optimizers gepa service --db .stack/optimizers/gepa-service.sqlite --bind 127.0.0.1:8879
```

The left panel is `Local Research` and leads with the local optimizer job list:
total, active, queued, completed, failed, selected job, and recent jobs. Service
reachability, worker/queue counters, and storage details sit underneath that job view. Stack reads
`/health`, `/workspace`, and `/runs`; older local services fall back to
`/status`. Stack passes `--workers` only when the installed optimizer CLI
advertises that flag.

Useful overrides:

- `STACK_OPTIMIZER_COMMAND`: command to run, default `synth-optimizers`
- `STACK_OPTIMIZER_BIND`: host:port, default `127.0.0.1:8879`
- `STACK_OPTIMIZER_WORKERS`: worker pool size, default `4`
- `STACK_OPTIMIZER_DB`: SQLite service DB path
- `STACK_OPTIMIZER_SERVICE_URL`: read endpoint if different from `--bind`

The status bar shows the agent model and reasoning effort from
`~/.codex/config.toml` when `STACK_HARNESS=codex` (default). Override them for a run with `STACK_CODEX_MODEL` and
`STACK_CODEX_REASONING_EFFORT`.

**Cursor harness** (`STACK_HARNESS=cursor`):

- `STACK_CURSOR_COMMAND`: default `cursor`
- `STACK_CURSOR_MODEL`: default `composer-2.5`
- `STACK_CURSOR_AUTH_PLAN`: account label in the status row, default `Cursor`
- Requires `cursor agent login` (or `CURSOR_API_KEY`); Stack talks to `cursor agent acp` over JSON-RPC
- Proof: `bun run scripts/smoke_cursor_acp.ts`
