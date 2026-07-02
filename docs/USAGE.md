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
  live run or Factory-project message. `e` stages a README smoke SMR eval launch
  when `STACK_SYNTH_DEV_ROOT` and `STACK_EVAL_COMMAND` point at a Synth eval
  wrapper (optional advanced setup). Type a local path in
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
  `Ctrl+Enter` queues the current input as the next turn, and `Esc` requests a
  turn interrupt. Outside an active turn, `Esc` clears the current input and
  never quits Stack.
- `/exit`: quit Stack explicitly.

Stack writes local session logs under `.stack/sessions/`. Current release includes
read-only remote SMR visibility for jobs, run artifacts, WorkProducts, and
factories, hosted optimizer job visibility/detail, and local optimizer job
visibility. The implemented remote action surface covers live SMR/Factory
messages, SMR lifecycle controls, README-smoke eval launch/status, run-file
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
      "apiBaseUrl": "https://staging-api.usesynth.ai",
      "authEnv": "SYNTH_STAGING_API_KEY"
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

The Remote SMR `e` action starts the configured README smoke when
`STACK_EVAL_COMMAND` is set (optional — requires a Synth eval checkout):

```bash
# Example when STACK_SYNTH_DEV_ROOT points at a synth-dev checkout:
# $STACK_SYNTH_DEV_ROOT/scripts/eval.sh run smr/suites/readme_smoke_docker_codex.toml \
#   --target local-dockerized --instance slot1
```

Stack persists README-smoke launch state under
`.stack/evals/readme-smoke-<environment>.json`, keeps a bounded stdout/stderr
tail in the Live Ops rail, keeps recent failure lines from the wrapper, parses
run/project ids and post-terminal verifier fields when the wrapper emits them,
and refreshes the remote SMR snapshot so the created run can be monitored from
the same cockpit. If the wrapper emits only a project id, Stack correlates it to
the recent remote job list to recover the run id. When the run is known and
present in the remote snapshot, Stack selects it as the current remote run and
mediation target. The selected run view shows the active WorkProduct/artifact
index, id, status/type, linked artifact id, creation time, preview text, and
latest saved download path. Override the launch path with `STACK_SYNTH_DEV_ROOT`,
`STACK_EVAL_COMMAND`,
`STACK_README_SMOKE_SUITE`, `STACK_README_SMOKE_TARGET`, and
`STACK_README_SMOKE_INSTANCE`.

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
- `stack_launch_read_smoke`: launch the configured README-smoke SMR eval
- `stack_live_status`: account health, live SMR runs, Factories, hosted
  optimizer runs, and README-smoke launch state
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
- `stack_start_readme_smoke_eval`: launch the configured README-smoke SMR eval
- `stack_readme_smoke_eval_status`: read the persisted launcher status,
  parsed verifier context, and bounded output tail
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
stack auth urls --json              # signup/signin/keys URLs (product=stack attribution)
stack auth open signup              # open browser (or --no-browser to print URL only)
stack auth verify --json            # remote account snapshot; exit 0 when connected
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

Monitor profiles are opt-in:

```bash
STACK_AUX_INFERENCE=1 STACK_MONITOR_PROFILE=free-aux stack
STACK_SYNTH_INFERENCE=1 STACK_MONITOR_PROFILE=billed-glm stack
```

If a selected Synth monitor route is unavailable, Stack falls back to the Codex
app-server monitor and records a visible fallback notice. Usage views show
spend/budget summaries only; they do not include prompts or transcripts.

Optional: install [synth-optimizers](https://pypi.org/project/synth-optimizers/) for local GEPA.
Advanced Synth monorepo eval wrappers are optional — set `STACK_SYNTH_DEV_ROOT` and
`STACK_EVAL_COMMAND` only if you use them.

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
