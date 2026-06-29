# Stack

Synth operator cockpit: local OpenTUI + Codex agent pane + Stack MCP for SMR,
Research Factory, optimizers, containers, and WorkProduct exchange across dev,
staging, and prod.

**Version:** `stack --version` shows **channel** (`stable` | `dev`) and last public
**release** on dev builds · [CHANGELOG.md](CHANGELOG.md) · [docs/RELEASE.md](docs/RELEASE.md)

## Notes

**Status (2026-06-26):** Stack is a **private** Synth Labs repo. There is **no public
release yet** — no git tag published, no GitHub Release, and no live Homebrew tap.
Versioning and tap formulas are **prepared** (`version.json`, `packaging/homebrew/`,
[docs/RELEASE.md](docs/RELEASE.md)) for when we go public.

| Today | Planned (not live yet) |
| --- | --- |
| Private `git clone` + `make install` for teammates with repo access | `brew tap synth-laboratories/tap` + `brew install stack` |
| **dev** channel on `main` (`make bump-dev`) | **stable** channel on tagged `vX.Y.Z` releases |
| Stack-owned release notes + evidence packets | Public GitHub Release + tap push |

Until the first public release: use **git clone** (below), not Homebrew. Stable channel
in `version.json` (`release: 0.1.0`) is the intended first public version — not shipped
externally yet.

- [SMR code TUI sketch](notes/2026-06-19-smr-code.txt)

## Install

Requires [Bun](https://bun.sh) and the local Codex CLI. Synth workspace repos
(`synth-dev`, `synth-ai`, etc.) are needed for full local/hosted ops — see the
bundled **`stack-local-setup`** Codex skill.

**Private repo access required today.**

### Git clone (current — private development)

```bash
git clone git@github.com:synth-laboratories/stack.git   # private; org access required
cd stack
make install
stack --version
```

### Homebrew (planned — after public release)

Not available yet. When the repo is public and `v0.1.0` (or later) is tagged:

```bash
brew tap synth-laboratories/tap
brew install stack          # stable — tagged public releases
brew install stack-dev      # dev/nightly — main branch
stack --version
```

Maintainer prep lives in `packaging/homebrew/README.md`. Dev channel on main:
`make bump-dev` · stable cuts: `docs/RELEASE.md`.

### Direct repo launch (no install)

```bash
bun install
./bin/stack
./bin/stack --version
```

### Sharing with others (internal, today)

Teammates need **private repo access**, then `make install`. Each user edits
`stack.config.json` for their checkout paths and auth env files (`SYNTH_API_KEY` in
`synth-ai/.env` for dev). Never commit secrets.

To update an existing install:

```bash
cd ~/Documents/GitHub/stack   # or your clone path
git pull
make install
stack --version
```

**After first public release:** git tags `vX.Y.Z`, GitHub Release notes from
`CHANGELOG.md`, and Homebrew tap publish — see `docs/RELEASE.md`.

Then from any terminal:

```bash
stack
```

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
  live run or Factory-project message. `e` stages a local README smoke SMR eval
  launch through the canonical `synth-dev` eval wrapper. Type a local path in
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

`stackd` is a read-only localhost indexer/exporter over `.stack/sessions/*.json`.
The TUI still writes session files directly, and Codex still owns JSONL
transcripts under `~/.codex/sessions/`.

```bash
./bin/stackd serve
curl -s http://127.0.0.1:8792/health
bun run smoke:stackd
```

`./bin/stack` auto-starts `stackd` when `/health` is unavailable, exports
`STACK_API_URL` as `http://127.0.0.1:8792`, and continues without the sidecar if
startup fails. Logs are written to `.stack/runtime/stackd.log`.

The TUI threads rail and local-thread MCP tools read through stackd first, so
the API is the normal source of truth for local thread lists, trace, and export.
If stackd is unavailable, the TUI rail falls back to the local session files as a
degraded offline path.

Routes in L1: `/health`, `/threads`, `/threads/:id`,
`/threads/:id/status`, `/threads/:id/events`, `/threads/:id/actors`,
`/events/stream`,
`/threads/:id/monitors/:monitorId/pause`,
`/threads/:id/monitors/:monitorId/resume`,
`/threads/:id/monitors/:monitorId/mode`, `/threads/:id/trace`,
`/threads/:id/export`, `/logs/query`, and
`/doc` (`/openapi.json`). Export writes
`.stack/exports/<session-id>/<stamp>/` with `manifest.json`, redacted
`session.json`, `metadata.json`, optional `codex.jsonl`, and optional
`meta-events.jsonl`, `monitor_usage.json`, and `actors.json`. Thread core-agent
and meta-harness events live at `.stack/events/threads/<session-id>.jsonl` and
capture Stack-side events such as `agent.tool.completed`, `agent.tool.failed`,
`agent.turn.completed`, `skill.read`, `monitor.wake`, `monitor.summary`,
`monitor.queued`, `monitor.usage`, `monitor.model_fallback`,
`monitor.checkpoint`, and `monitor.skill_context_push`.
Monitor actor checkpoints live under
`.stack/actors/<session-id>/monitors/<monitor-actor-id>.json`.
`POST /threads/:id/events` appends core or meta events through stackd, filling
missing `thread_id`, `event_id`, `observed_at`, and `payload` defaults.
`GET /events/stream?thread_id=<id>&after_event_id=<event>` provides an SSE feed
over the same thread event log for TUI, monitor, and exporter subscribers.
stackd also runs a monitor scheduler over the same event log by default; it
dedupes trigger event ids, advances actor checkpoints, and emits
`monitor.wake`/`monitor.summary`/`monitor.usage`/`monitor.checkpoint` when
non-TUI producers append core events. With
`STACK_MONITOR_MODEL_WORKER=openai_responses` or `worker = "openai_responses"`,
the scheduler calls OpenAI Responses and persists `monitor_thread_id` so later
wakes continue the same monitor actor thread. Set `STACKD_MONITOR_SCHEDULER=0`
to disable it or `STACKD_MONITOR_POLL_MS=<ms>` to tune polling.

### Stack Monitor

The monitor runtime runs inside the Stack TUI while Codex execution is still
owned there. It records Codex JSONL as normalized `agent.*` events, subscribes
to tool/turn triggers, writes durable monitor actor checkpoints, emits
thread-scoped `monitor.*` events, and shows the latest monitor status in the
left rail.

Profiles:

- `.stack/monitors/default.toml`
- `.stack/monitors/gepa-dogfood.toml`

Useful overrides:

- `STACK_MONITOR_PROFILE=gepa-dogfood`
- `STACK_MONITOR_ENABLED=0`
- `STACK_MONITOR_STRICTNESS=passive|conservative|aggressive`
- In the TUI, `M` cycles the current thread through
  `off -> passive -> conservative -> aggressive -> off` and records
  `monitor.paused`, `monitor.resumed`, or `monitor.mode_changed`.

The monitor pass is event-backed: it checks enabled focus areas such as style,
goal progress, skills, tool use, scope control, and acceptance.
The configured model slot is `gpt-5.4-mini` with medium reasoning. With
`worker = "auto"`, Stack uses OpenAI Responses when `OPENAI_API_KEY` is
available and persists the returned response id as `monitor_thread_id`; without
credentials it falls back to the deterministic pass, emits
`monitor.model_fallback` when the model worker was explicitly requested, and
keeps the same `agent.*`, `monitor.*`, actor checkpoint, API, and export
contract.
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

Monitor proof commands:

- `bun run smoke:guidance:l2` proves guidance layers and rejects external
  guidance roots.
- `bun run smoke:monitor:style-steer` proves `app/style/stack-norms` steering
  and conservative tool-failure summary without steer.

Model-worker overrides:

- TOML: `[model] worker = "auto" | "deterministic" | "openai_responses"`
- Env: `STACK_MONITOR_MODEL_WORKER=auto|deterministic|openai_responses`

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
the Stack repo root. The dev API defaults to the local backend port used by
`synth-dev` eval launches.

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

The Remote SMR `e` action starts the configured README smoke through:

```bash
<synth-dev>/scripts/eval.sh run smr/suites/readme_smoke_docker_codex.toml --target local-dockerized --instance slot1
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
- `stack_launch_read_smoke`: launch the configured README-smoke SMR eval
- `stack_live_status`: account health, live SMR runs, Factories, hosted
  optimizer runs, and README-smoke launch state
- `stack_message_live_run`: send an operator message to a live SMR run
- `stack_message_factory_project`: send an operator message through the
  Factory-owned message route
- `stack_control_live_run`: pause, resume, or stop a live SMR run
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
  compose flags are present but the live slot container predates them, use
  `bun run observability:apply-retention -- --execute --evidence-dir <packet-dir>`
  after operator approval; the helper verifies slot activity, recreates only the
  VictoriaLogs service through `synth-dev`, then reruns the observability gate.
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

Codex should load the bundled Stack skills for Synth work:

- **`synth-via-stack`** — optimizers (local GEPA + hosted), **synth-ai** SDK/CLI, eval
  container contract (`/health`, `/info`, `/rollout`), local → hosted graduation
- **`stack-agent-bridge`** — Stack MCP operator workflow (SMR, Factory, previews, downloads)

Bundled source skills live in `.codex/skills/`. Every Stack launch syncs them into
the first-class `.stack/skills/` catalog and symlinks the catalog entries into
`~/.codex/skills/` so Codex injects them into agent context. Stack MCP exposes
the same catalog to primary and monitor actors. The TUI context rail shows
detected skill usage with the skill name and use time when Codex traces expose it.

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

Validate the OpenTUI agent pane end-to-end without manual dogfood:

```bash
bun run smoke:tui:gepa          # mock Banking77 GEPA receipt through PTY (~15s, no API)
bun run smoke:tui:resilience    # 196-col live-turn/spinner stress (OpenTUI crash regression)
bun run smoke:tui:all           # submit + scroll + gepa + resilience
bun run smoke:tui:gepa:live       # optional real run_acceptance.py (~50s; skips without key)
```

The GEPA smoke uses `scripts/fake_codex_banking77_gepa.ts` as `STACK_CODEX_COMMAND`,
submits a Banking77 prompt, asserts uplift markers in the terminal, validates
session JSON, and fails if raw Codex JSONL leaks or OpenTUI throws
`Failed to create optimized buffer`.

Validate the first release UI guard with Bombadil:

```bash
bun run smoke:bombadil:b0
```

That command wraps the current scroll smoke as `AT-STACK-BOMBADIL-B0` and writes
a ship-readable proof JSON at `/tmp/stack-bombadil-b0-proof.json` by default.
Override with `STACK_BOMBADIL_B0_PROOF=/path/to/proof.json`.

Prepare the first human dogfood packet (interactive TUI):

```bash
bun run stackeval:banking77-local-gepa
```

For the **full TOML + shell pipeline** (pinned GEPA harness, harvest, stackd export,
Codex grader + reviewer):

```bash
./bin/stackeval run banking77-local-gepa --preset smoke
./bin/stackeval prepare banking77-local-gepa --preset smoke   # packet only
```

StackEval runtime state and acceptance notes live under `.stack/evals/`; the
pipeline implementation lives in `scripts/stackeval/`.
During harness runs, StackEval creates a stackd session for the packet, records
live `skill.read`/`skill.used` and `agent.tool.*` events, waits for monitor
checkpoint evidence before export, and copies `/trace` plus the stackd export
bundle into the packet. Use `STACK_API_URL=<url>` to point the pipeline at an
isolated stackd instance, and set `STACKEVAL_REQUIRE_STACKD=1` when trace capture
is an acceptance requirement.

Legacy interactive prep (`bun run stackeval:banking77-local-gepa:prepare`) writes
a Stack-owned packet with the starting prompt, metadata, preflight, operator
pickup, acceptance, model policy, waste ledger, and release guard files. The task
root also gets `latest.json` pointing at the newest packet.
The default StackEval model is `gpt-5.5-low`; override only with
`STACKEVAL_MODEL` and record why in the packet.

For local dev, load `SYNTH_API_KEY` before starting the MCP server. The server
does not read SMR databases, raw Redis keys, or compatibility projections; it
uses the same typed backend routes as the TUI and fails closed when an owner
route rejects the operation. Codex turns launched from Stack register this MCP
server with `STACK_ENVIRONMENT` set to the selected TUI environment, so tool
calls without an explicit `environment` argument still follow the visible
dev/staging/prod selector.

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

## Easy start (local + hosted ops panel)

Stack tries to remove setup friction on the right ops panel (`p` toggles **Local** vs **Synth Hosted**).
Load the bundled **`stack-local-setup`** Codex skill for full copy-paste install/serve/Docker commands.

| What | Behavior |
| --- | --- |
| **Auth** | Loads `SYNTH_API_KEY` from the env file in `stack.config.json` (e.g. `../synth-ai/.env`) automatically |
| **Docker + dev slot** | On **dev**, if API offline: checks `docker info`, runs `synth-dev/scripts/local.sh up slot1` (disable with `STACK_AUTO_START_DEV_SLOT=0`) |
| **Local GEPA** | On **dev**, auto-starts `synth-optimizers gepa service` if not running (disable with `STACK_AUTO_START_LOCAL_OPTIMIZER=0`) |
| **Disable all auto-start** | `STACK_AUTO_START=0` |
| **Start GEPA manually** | Local panel + empty prompt + **Enter** |
| **Hosted data** | Projects, containers, and hosted optimizers refresh every 20s when account is connected |
| **Setup hints** | Right panel shows copy-paste next steps when auth, Docker, API, CLI, or GEPA is missing |

One-shot install:

```bash
make -C ~/Documents/GitHub/stack install
pip install synth-optimizers synth-ai
docker info
cd ~/Documents/GitHub/synth-dev && ./scripts/local.sh up slot1
stack
```

Dockerized eval smoke:

```bash
cd ~/Documents/GitHub/synth-dev
./scripts/eval.sh run smr/suites/readme_smoke_docker_codex.toml \
  --target local-dockerized --instance slot1
```

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

The status bar shows the Codex model and reasoning effort from
`~/.codex/config.toml`. Override them for a run with `STACK_CODEX_MODEL` and
`STACK_CODEX_REASONING_EFFORT`.
