# First-Class Stack State Runtime

Status: design note  
Date: 2026-06-29  
Owner: Stack

## Purpose

Stack needs a first-class runtime because the useful question is larger than
"what is currently running?" The runtime should eventually help answer:

- What work shipped?
- Who or what was exposed to it?
- What changed downstream?
- Was the change good, bad, or neutral?
- What evidence supports that claim?

V1 should not try to become the product analytics warehouse, experiment system,
or growth engine. It should make those future uses possible by giving Stack a
durable event stream, stable correlation fields, sensor-owned observations, and
a reducer-owned snapshot.

The immediate V1 target is still operational:

- Keep Stack's local GEPA, remote SMR, Factory, and hosted optimizer view current.
- Move duplicate TUI polling into `stackd`.
- Emit sensor events that monitors, StackEval, MCP, and the TUI can consume.
- Persist one Stack-owned factory snapshot.

The future target is impact correlation:

- Link shipped work, feature flags, deployments, StackEval packets, and launch
  checklists to downstream exposure and outcome measurements.
- Let later impact sensors append bounded receipts into the same runtime event
  stream without changing V1's authority model.

## Authority Model

Stack is an observer and cockpit. It must not become a second authority for
backend, optimizer, product analytics, billing, or experiment state.

```text
owner systems
  backend SMR / Factories / hosted optimizers
  local synth-optimizers GEPA service
  future analytics / flags / billing / support systems

        |
        v

stackd sensors
  read owner APIs
  diff against cursors
  append Stack-owned sensor events

        |
        v

stackd reducer
  fold events into one factory snapshot
  plan wakes for monitors/TUI
  never performs owner-system mutation

        |
        v

Stack consumers
  TUI panels
  Stack MCP
  monitor/gardener actors
  StackEval packets
```

Rules:

1. Sensors only observe.
2. Levers mutate owner systems through explicit owner routes or local wrappers.
3. Reducers are pure: event log plus prior snapshot in, snapshot plus planned
   wakes out.
4. Stack stores bounded receipts and projections, not raw warehouse-scale data.
5. Missing owner paths are hard failures or roadmap items, not permission to
   scrape databases, raw Redis keys, compatibility projections, or private
   local service state.

## V1 Runtime Shape

```text
                         stackd
              first-class runtime owner
                          |
                    factory tick
                          |
        +-----------------+-----------------+
        |                                   |
        v                                   v
  sensor.local_gepa                  synth_external runtime
  local GEPA service                 auth-gated Synth sync
        |                                   |
        v                                   v
  sensor.local_gepa.*                sensor.remote_synth.*
        |                                   |
        +-----------------+-----------------+
                          |
                          v
                 pure factory reducer
                          |
                          v
                  factory_snapshot
                          |
        +-----------------+-----------------+
        |                 |                 |
        v                 v                 v
       TUI             Stack MCP       monitors/StackEval
```

### Sensor: `local_gepa`

Authority: `synth-optimizers gepa service`.

V1 poll surface:

- `GET /health`
- `GET /workspace` with `/status` fallback
- `GET /runs?limit=12`

Current Stack source to migrate from:

- `stack/src/local/optimizers.ts`

V1 event examples:

- `sensor.local_gepa.service.reachable`
- `sensor.local_gepa.service.unreachable`
- `sensor.local_gepa.run.discovered`
- `sensor.local_gepa.run.phase_changed`
- `sensor.local_gepa.run.progress`
- `sensor.local_gepa.run.terminal`

Later enrichments, not V1 requirements:

- `/runs/{run_id}/state`
- `/runs/{run_id}/timings`
- `/runs/{run_id}/stats`
- `/runs/{run_id}/events` or WebSocket stream

### Sensor: `remote_synth`

Authority: Synth API for the selected Stack environment.

Runtime role: this is the first sensor in a dedicated **Synth external event
sync runtime**. It runs only when the selected Stack environment has Synth auth
(`environmentAuthStatus(config.environment).hasAuth`). When auth is missing, it
emits `sensor.remote.auth.missing` or stays quiescent; it must not synthesize
cloud state from cached UI data.

V1 poll surface:

- `/smr/jobs?limit=...`
- `/smr/factories?include_archived=false`
- `/smr/projects?limit=...`
- `/smr/projects/{project_id}/runs?limit=...`
- `/api/v1/optimizers/runs?limit=...`

Current Stack sources to migrate from:

- `stack/src/remote/research.ts`
- `stack/src/remote/optimizers.ts`

V1 event examples:

- `sensor.remote.auth.ready`
- `sensor.remote.auth.missing`
- `sensor.remote.smr_run.updated`
- `sensor.remote.smr_run.terminal`
- `sensor.remote.project_run.updated`
- `sensor.remote.project_run.terminal`
- `sensor.remote.factory.updated`
- `sensor.remote.hosted_optimizer.updated`

Later enrichments, not V1 requirements:

- Backend optimizer event streams.
- Backend optimizer state slices.
- Product usage and exposure sensors.
- PostHog, Statsig, billing, docs, support, and customer-signal sensors.

## Events

V1 should define one small event envelope. It should be specific enough for
future correlation, but not force unimplemented systems into the codebase.

```json
{
  "event_id": "evt_...",
  "seq": 123,
  "type": "sensor.local_gepa.run.phase_changed",
  "source": "sensor.local_gepa",
  "observed_at": "2026-06-29T12:00:00Z",
  "subject": {
    "kind": "local_gepa_run",
    "id": "run_..."
  },
  "correlation": {
    "stack_session_id": "optional",
    "stackeval_packet_id": "optional",
    "run_id": "optional",
    "project_id": "optional",
    "factory_id": "optional",
    "commit_sha": "optional",
    "feature_id": "optional",
    "flag_key": "optional",
    "variant": "optional"
  },
  "payload": {}
}
```

The `correlation` object is the future-enabler. V1 should store it and set only
the values it actually knows. Do not add fake impact sensors or placeholder
experiment code just because these fields exist.

## Factory Snapshot

V1 should reduce runtime events into one Stack-owned snapshot:

```json
{
  "schema": "stack.factory_snapshot.v1",
  "updated_at": "2026-06-29T12:00:00Z",
  "control_state": "quiescent",
  "local_gepa": {
    "enabled": true,
    "service_status": "running",
    "service_url": "http://127.0.0.1:8879",
    "active_run_id": null,
    "last_ok_at": "2026-06-29T12:00:00Z",
    "last_error": null
  },
  "remote_synth": {
    "enabled": true,
    "environment": "dev",
    "auth_status": "ready",
    "active_smr_count": 0,
    "active_factory_count": 0,
    "active_hosted_optimizer_count": 0,
    "last_ok_at": "2026-06-29T12:00:00Z",
    "last_error": null
  }
}
```

Initial `control_state` values:

- `quiescent`
- `local_gepa_running`
- `remote_run_active`
- `hosted_optimizer_active`
- `dual_active`
- `degraded`

Avoid adding product-impact state in V1. The snapshot should be shaped so a
future reducer can add `impact` later, but V1 should not ship empty impact
panels or unused experiment abstractions.

## Persistence

Use Stack-owned runtime persistence under `.stack/runtime/`.

Preferred V1 target:

```text
.stack/runtime/factory.sqlite
  runtime_events
  runtime_cursors
  factory_snapshot

.stack/runtime/status.json
  compatibility projection for existing stackd /status consumers
```

The SQLite store is for durable local event reduction. It is not an analytics
warehouse. Large payloads should stay in owner systems, artifacts, or bounded
StackEval packets.

## Levers

Levers are explicit actions, not sensors.

V1 levers can remain in the existing TUI/MCP TypeScript paths while the runtime
is introduced. When a lever does real operator work, it may append a bounded
`lever.*` receipt through `POST /runtime/events`; external callers may not
append `sensor.*` events.

- Start local GEPA service.
- Launch StackEval Banking77 local GEPA.
- Cancel hosted optimizer.
- Preview/download hosted optimizer artifact.
- Message or control SMR runs and Factories through backend owner routes.

After a lever runs, sensors observe the owner-system result on the next factory
tick. That separation is what allows later impact measurement: the lever event
says "we acted"; the sensor event says "the world changed."

## Gardener Skills And MCPs

Gardener should interact with Synth resources through first-class skills and
MCP tools, not through hidden HTTP calls or copied API clients inside gardener
logic.

Boundary:

- **`synth_external` runtime:** observes Synth state when logged in and appends
  `sensor.remote_synth.*` events.
- **Gardener:** reads Stack runtime snapshots/events, explains state, proposes
  next actions, and invokes typed Stack/Synth skills or MCP tools for actions.
- **Synth owner systems:** remain authoritative for projects, SMR runs,
  Factories, Tag, hosted optimizers, WorkProducts, traces, and account usage.

Required gardener-facing capabilities:

- List live SMR projects and associated live runs.
- List and inspect Factories, efforts, scheduler state, cloud substrate, and
  linked projects.
- List hosted optimizer runs and inspect/download artifacts.
- Inspect WorkProducts, traces, run logs, questions, approvals, and terminal
  reasons.
- Start, pause, resume, terminate, or message SMR/Factory work only through
  typed owner routes exposed by Stack MCP or synth-ai SDK backed tools.
- Promote a local proof packet to cloud work only through an explicit promotion
  lever; no implicit cloud mutation from sensor observations.

This keeps the runtime dependable: sensors sync external events; gardener acts
through declared capabilities; reducers never mutate Synth resources.

## Impact Correlation Roadmap

The impact model is:

```text
work event
  PR merged / deploy / flag enabled / StackEval passed / checklist cleared

        |
        v

exposure event
  user/org/project saw feature X, variant A, version SHA, flag state

        |
        v

behavior event
  usage, activation, retention, task completion, run success, cost, latency

        |
        v

impact reducer
  compare against baseline, cohort, flag variant, or A/B assignment

        |
        v

impact snapshot
  feature X appears to have moved metric Y by Z with confidence C
```

Future sensor family:

```text
sensor.product_impact
  feature exposure
  usage per user/org
  activation and retention
  billing or revenue receipt
  support burden
  docs or onboarding conversion
  customer-signal receipts
```

Future reducer:

```text
impact reducer
  work provenance + exposure + metrics + guardrails -> impact snapshot
```

V1 should enable this by preserving stable IDs:

- `feature_id`
- `flag_key`
- `variant`
- `commit_sha`
- `deployment_id`
- `stackeval_packet_id`
- `launch_checklist_id`
- `project_id`
- `run_id`
- `factory_id`
- privacy-preserving user/org identifiers when owner systems provide them

Do not build product-impact polling in V1 unless there is a real owner system,
real metric, and real consumer already using it.

## V1 Implementation Plan

1. Add Stack runtime event and snapshot types in `stack-core`.
2. Add a `stackd` runtime store under `.stack/runtime/factory.sqlite`.
3. Add `sensor.local_gepa` using the current TypeScript snapshot shape as the
   behavior reference.
4. Add a pure reducer and write `factory_snapshot`.
5. Add `GET /runtime/factory` and `GET /runtime/events`.
6. Have Stack MCP `stack_status` include the factory snapshot.
7. Point the TUI Local Research panel at `stackd` with the current TypeScript
   poller as a temporary fallback.
8. Add `sensor.remote_synth`.
9. Point hosted optimizer and remote SMR panels at `stackd`.
10. Remove duplicated TUI polling after the `stackd` path is stable.

## Scope Split

### Push 1: Remote Factories / Projects / Runs

Goal: give the operator and Gardener a first-class, typed view of the cloud
factory node without waiting for the full runtime migration.

Build now:

- Active projects panel: remote projects, associated live/recent SMR runs, and
  linked Factory/cloud badges.
- Stack MCP project/run/factory tools:
  - list remote projects
  - inspect live run details
  - read runtime snapshot/events
  - prepare cloud-promotion packet
  - create cloud launch only through explicit dry-run/confirm semantics
  - inspect/terminate cloud launch
  - list/respond to run questions and approvals
- Promotion packet shape: active StackEval packet + runtime snapshot +
  correlation ids + operator metadata.
- Keep cloud mutation in levers only; sensors and reducers remain read-only.
- Keep direct remote API fallback while the runtime projection stabilizes.

This push should answer:

```text
What cloud projects/factories/runs are live?
Which runs are associated with each project/factory?
Can Gardener/Codex inspect details and handle human questions/approvals?
Can we prepare a local-to-cloud promotion receipt without inventing orchestration?
```

### Push 2: Systems Runtime / State Machine / Events

Goal: move observation into `stackd` as a durable system runtime instead of
duplicated TUI/MCP polling.

Build now or next:

- Runtime event and snapshot types in `stack-core`.
- SQLite-backed `stackd` runtime store.
- `local_gepa` sensor and cursor diffing.
- `sensor.remote_synth` inside the dedicated auth-gated `synth_external`
  runtime.
- Pure reducer for local GEPA, remote project/run/factory, and hosted optimizer
  operational state.
- Runtime scheduler behind `STACKD_RUNTIME_SCHEDULER`.
- `GET /runtime/factory`, `GET /runtime/events`, `POST /runtime/tick`.
- `.stack/runtime/status.json` compatibility projection.
- TUI/MCP migration to the factory snapshot, keeping owner-API fallback until
  the projection has soaked.

This push should answer:

```text
Is stackd observing local GEPA and remote Synth through owner APIs?
Did it emit durable sensor events?
Did it reduce those events into a useful factory snapshot?
Can Stack/MCP/StackEval consume that snapshot instead of owning duplicate polls?
```

### Keep As Notes For Later

These are deliberate follow-ups, not hidden work in either push:

- Tag-specific local/cloud agent runtime.
- WorkProduct and trace sync beyond concise run detail inspection.
- Full Factory effort lifecycle controls beyond owner-route messages and launch
  termination.
- Gardener closed-loop mediation over synced cloud events.
- Monitor wake policies over runtime events.
- Runtime event export in StackEval packets beyond local GEPA proof.
- Product-impact sensors.
- Feature-flag exposure receipts.
- A/B or rollout analysis reducers.
- Usage-per-user, activation, retention, billing, support, docs, or
  customer-signal correlation.
- Generic sensor registration/plugin system.

The later work should reuse the same event envelope, correlation fields, store,
and reducer boundary. It should not force extra empty fields, fake data sources,
or placeholder UI into the V1 implementation.

## Not V1

Do not implement these until there is a concrete owner, data source, and
consumer:

- Product-impact sensors.
- A/B test reducers.
- Feature-flag assignment storage.
- PostHog or Statsig ingestion.
- Billing or revenue attribution.
- Growth dashboard panels.
- Empty `impact` fields in the factory snapshot.
- Generic "sensor plugin" machinery before the second real non-Synth sensor.

V1 should make these possible by preserving correlation IDs and keeping the
event/reducer boundary clean. It should not pretend they already exist.

## Implementation Prep

This section is the handoff from design to code. It fixes names and boundaries
for the first implementation pass.

### Crate Layout

Add pure types to `stack-core`:

```text
stack/crates/stack-core/src/runtime_event.rs
stack/crates/stack-core/src/runtime_state.rs
```

Add I/O and scheduling to `stackd`:

```text
stack/crates/stackd/src/runtime/mod.rs
stack/crates/stackd/src/runtime/store.rs
stack/crates/stackd/src/runtime/reducer.rs
stack/crates/stackd/src/runtime/scheduler.rs
stack/crates/stackd/src/runtime/sensors/mod.rs
stack/crates/stackd/src/runtime/sensors/local_gepa.rs
stack/crates/stackd/src/runtime/sensors/remote_synth.rs
stack/crates/stackd/src/handlers/runtime.rs
```

Do not create plugin machinery or product-impact modules in V1.

### Core Types

`RuntimeEvent`:

```rust
pub struct RuntimeEvent {
    pub event_id: String,
    pub seq: i64,
    pub event_type: String,
    pub source: String,
    pub observed_at: String,
    pub subject: RuntimeSubject,
    pub correlation: RuntimeCorrelation,
    pub payload: serde_json::Value,
}
```

`RuntimeSubject`:

```rust
pub struct RuntimeSubject {
    pub kind: String,
    pub id: Option<String>,
}
```

`RuntimeCorrelation`:

```rust
pub struct RuntimeCorrelation {
    pub stack_session_id: Option<String>,
    pub stackeval_packet_id: Option<String>,
    pub run_id: Option<String>,
    pub project_id: Option<String>,
    pub factory_id: Option<String>,
    pub commit_sha: Option<String>,
    pub feature_id: Option<String>,
    pub flag_key: Option<String>,
    pub variant: Option<String>,
}
```

`FactorySnapshot`:

```rust
pub struct FactorySnapshot {
    pub schema: String,
    pub updated_at: String,
    pub control_state: FactoryControlState,
    pub local_gepa: LocalGepaSnapshot,
    pub remote_synth: RemoteSynthSnapshot,
}
```

`FactoryControlState`:

```rust
pub enum FactoryControlState {
    Quiescent,
    LocalGepaRunning,
    RemoteRunActive,
    HostedOptimizerActive,
    DualActive,
    Degraded,
}
```

Keep the first reducer string-compatible with these values:

```text
quiescent
local_gepa_running
remote_run_active
hosted_optimizer_active
dual_active
degraded
```

### Persistence Schema

Use `rusqlite` in `stackd`. Add it to `Cargo.toml` only when implementation
starts.

```sql
CREATE TABLE IF NOT EXISTS runtime_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  subject_kind TEXT NOT NULL,
  subject_id TEXT,
  correlation_json TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runtime_events_type_seq
  ON runtime_events(event_type, seq);

CREATE INDEX IF NOT EXISTS idx_runtime_events_source_seq
  ON runtime_events(source, seq);

CREATE TABLE IF NOT EXISTS runtime_cursors (
  sensor_id TEXT PRIMARY KEY,
  cursor_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS factory_snapshot (
  id TEXT PRIMARY KEY CHECK (id = 'singleton'),
  snapshot_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Do not add per-product tables in V1. If query needs outgrow this schema, add
indexes first and only then consider shape changes.

### Sensor Trait

The V1 scheduler can use a simple internal trait:

```rust
pub trait RuntimeSensor {
    fn sensor_id(&self) -> &'static str;

    async fn poll(
        &self,
        input: SensorPollInput,
    ) -> anyhow::Result<SensorPollOutput>;
}
```

`SensorPollInput`:

```rust
pub struct SensorPollInput {
    pub now: String,
    pub prior_cursor: Option<serde_json::Value>,
    pub prior_snapshot: Option<FactorySnapshot>,
}
```

`SensorPollOutput`:

```rust
pub struct SensorPollOutput {
    pub next_cursor: serde_json::Value,
    pub events: Vec<RuntimeEventDraft>,
}
```

Use `async_trait` only if needed. If the scheduler can call concrete async
functions directly for the first two sensors, prefer that over adding a trait
dependency.

### Local GEPA Cursor

V1 cursor:

```json
{
  "schema": "stack.sensor.local_gepa.cursor.v1",
  "service_status": "running",
  "runs": {
    "run_id": {
      "status": "running",
      "phase": "generation_start",
      "generation": 0,
      "candidate_count": 1,
      "best_candidate_id": null,
      "cost_usd": 0.0,
      "total_tokens": 0
    }
  }
}
```

Diff rules:

- stopped -> running: `sensor.local_gepa.service.reachable`
- running -> stopped/error: `sensor.local_gepa.service.unreachable`
- unseen run id: `sensor.local_gepa.run.discovered`
- phase/generation/status changed: `sensor.local_gepa.run.phase_changed`
- candidate/cost/token changed: `sensor.local_gepa.run.progress`
- status enters terminal set: `sensor.local_gepa.run.terminal`

Terminal status set:

```text
succeeded
completed
failed
cancelled
canceled
```

### Remote Synth Cursor

V1 cursor:

```json
{
  "schema": "stack.sensor.remote_synth.cursor.v1",
  "auth_status": "ready",
  "smr_runs": {
    "run_id": {
      "state": "running",
      "phase": "working",
      "updated_at": "..."
    }
  },
  "factories": {
    "factory_id": {
      "status": "active",
      "next_wake_at": "..."
    }
  },
  "hosted_optimizers": {
    "run_id": {
      "status": "running",
      "finalize_state": "none",
      "cursor_seq": 123
    }
  }
}
```

Diff rules:

- missing auth -> ready: `sensor.remote.auth.ready`
- ready -> missing auth: `sensor.remote.auth.missing`
- SMR run state/phase/updated_at changed: `sensor.remote.smr_run.updated`
- SMR run enters terminal state: `sensor.remote.smr_run.terminal`
- Factory status/next wake/project/run hint changed: `sensor.remote.factory.updated`
- Hosted optimizer status/finalize/cursor changed:
  `sensor.remote.hosted_optimizer.updated`

Remote terminal status set:

```text
completed
succeeded
failed
stopped
cancelled
canceled
terminal
```

### Reducer Rules

Reducer input:

```text
prior snapshot + new runtime events since prior seq
```

Reducer output:

```text
next snapshot + optional wake reasons
```

V1 control-state precedence:

1. Any sensor reports degraded/unreachable while it was previously enabled and
   active -> `degraded`.
2. Active local GEPA and active remote/hosted work -> `dual_active`.
3. Active local GEPA -> `local_gepa_running`.
4. Active hosted optimizer -> `hosted_optimizer_active`.
5. Active SMR run or active Factory -> `remote_run_active`.
6. Otherwise -> `quiescent`.

The reducer should not infer product impact, run quality, benchmark lift, or
optimization success. It only renders operational control state.

### Runtime Scheduler

Add a scheduler beside `monitor_scheduler`:

```rust
pub fn spawn_runtime_scheduler(state: Arc<AppState>) {
    // disabled with STACKD_RUNTIME_SCHEDULER=0
}
```

Initial poll interval:

```text
STACKD_RUNTIME_POLL_MS, default 2000, clamp 500..30000
```

Tick:

1. Open runtime store.
2. Load prior snapshot and cursors.
3. Poll `local_gepa`.
4. Poll `remote_synth` if auth/env config is available.
5. Append events in one transaction.
6. Persist cursors in the same transaction.
7. Reduce new events into `factory_snapshot`.
8. Write `.stack/runtime/status.json` compatibility projection.

If one sensor fails, emit or persist a degraded observation for that sensor and
continue the tick for the other sensor. Do not fail the entire runtime tick
unless the store itself is unavailable.

### API Routes

Add to `stackd`:

```text
GET /runtime/factory
GET /runtime/events?after_seq=<n>&limit=<n>&source=<source>
POST /runtime/events
POST /runtime/tick
```

`POST /runtime/events` accepts bounded `lever.*` events from Stack-owned
operator tools. It rejects `sensor.*` writes because sensors append through
stackd-owned pollers.

`POST /runtime/tick` is for local debugging and StackEval proofs. It should run
one bounded tick and return appended event count plus snapshot. It should not
start services or mutate owner systems beyond Stack's local runtime store.

### Compatibility Projection

Top-level `/status.runtime` should prefer the latest factory snapshot from the
Stack-owned runtime store, then fall back to `.stack/runtime/status.json` for
older file-only projections. Keep the field while migrating so existing status
consumers can move gradually.

The file projection remains:

```json
{
  "schema": "stack.runtime_status.v1",
  "updated_at": "...",
  "factory": {
    "control_state": "local_gepa_running",
    "snapshot_path": ".stack/runtime/factory.sqlite"
  }
}
```

Do not remove the existing `/status.runtime` field while migrating.

### Consumer Migration

V1 implementation order for consumers:

1. Stack MCP `stack_status` reads `/runtime/factory` when available and falls
   back to existing direct snapshot readers.
2. TUI Local Research panel reads the factory snapshot and keeps
   `readOptimizerSnapshot` fallback.
3. TUI hosted/remote panels read the factory snapshot and keep current fallback.
4. Once stable, remove duplicate interval pollers from the TUI.

### Current Code Cutline

This implementation has two acceptable cuts:

1. **Remote visibility/control cut:** Active projects, associated runs,
   Factory badges, Stack MCP inspection tools, promotion packet dry-run, and
   explicitly confirmed cloud launch/interaction levers.
2. **Runtime systems cut:** runtime types, SQLite store, `local_gepa`,
   `sensor.remote_synth`, reducer, scheduler, and `/runtime/*`.

Neither cut should include:

- Product-impact fields beyond the passive `RuntimeCorrelation` type.
- Product analytics, A/B, billing, support, or usage sensors.
- Placeholder UI for unimplemented future sensors.
- Reducer-side cloud mutation.
- Tests unless explicitly requested.

### Current Smoke Evidence

Non-network mock Synth smoke, 2026-06-30:

```text
POST /runtime/tick
GET  /runtime/factory
GET  /runtime/events
```

Proved in the local mock:

- `sensor.remote.auth.ready`
- `sensor.remote.project.updated`
- `sensor.remote.project_run.updated`
- `sensor.remote.factory.updated`
- `sensor.remote.hosted_optimizer.updated`
- factory snapshot links `project -> run_ids`
- factory snapshot links `project -> factory_ids`
- factory snapshot carries hosted optimizer status and active count
- factory snapshot carries cloud-dev label (`daytona`) and running state
- `stack_list_remote_projects({tick:true})` reads the runtime snapshot first and
  returns `source: runtime` with the associated project/run/factory payload
- `stack_status` reads runtime remote/hosted summaries first and returns
  `source: runtime`, with direct API fallback preserved
- Counter smoke proved `stack_status` does not call remote Synth project,
  factory, or hosted optimizer APIs when runtime state is available
- Counter smoke proved `stack_list_live_smrs` reads `remote_synth.runs` from the
  runtime snapshot and does not call remote Synth APIs when runtime run rows are
  available
- Counter smoke proved `stack_list_factories` and
  `stack_list_hosted_optimizer_runs` read runtime rows first and do not call
  remote Synth APIs when those rows are available

Status-surface smoke, 2026-06-30:

- Temp stackd root on port `8799`, scheduler and MCP sidecar disabled.
- Before the first tick, `GET /status` returned `runtime=null`.
- After `POST /runtime/tick`, `GET /status` returned
  `runtime.schema=stack.runtime_status.v1` and
  `runtime.factory.schema=stack.factory_snapshot.v1`.
- `GET /runtime/factory` returned the same stored factory snapshot.
- Focused checks passed: `cargo check -p stackd`, `bunx tsc --noEmit`.

Lever-event smoke, 2026-06-30:

- `POST /runtime/events` accepted `lever.cloud_promotion.prepared` from
  `lever.stack_mcp` with project, StackEval packet, and feature correlations.
- `GET /runtime/events?source=lever.stack_mcp` returned the persisted lever
  receipt.
- `GET /status` returned the same receipt in `runtime.factory.recent_events`.
- A direct attempt to append `sensor.remote.fake` returned `400 Bad Request`.
- `stack_launch_cloud_promotion` now records best-effort runtime receipts for
  dry-run packet preparation and confirmed cloud launch attempts.
- `startOptimizerService` now records best-effort `lever.local_gepa.service.*`
  receipts when the local GEPA service start path acts.
- A clean temp-root smoke with a nonexistent optimizer command returned
  `status=error`, emitted `lever.local_gepa.service.start_failed`, and surfaced
  that receipt in `/status.runtime.factory.recent_events`.
- That smoke also fixed a local start classification bug where Bun could emit
  async `spawn` `ENOENT` after the previous `try/catch` path had already
  reported `starting`.
- `scripts/stackeval/lib/trace_stackd.py harness-event` now records
  `lever.stackeval.gepa.started`, `.completed`, and `.failed` receipts alongside
  existing Stack thread and VictoriaLogs records.
- Isolated trace smoke posted StackEval `started` and `completed` phases and
  read them back from `/runtime/events?source=lever.stackeval` with
  `stack_session_id`, `stackeval_packet_id`, and StackEval run id correlation.
- `scripts/stackeval/lib/export_stackd.sh` now exports runtime evidence into
  each packet under `stack-runtime/factory.json`, `stack-runtime/events.json`,
  and `stack-runtime/status.json`.
- Isolated export smoke created a temp StackEval packet, posted
  `lever.stackeval.gepa.started`, ran `export_stackd.sh`, and verified the
  packet contained the three `stack-runtime/*` files with that lever receipt in
  both `events.json` and the factory snapshot `recent_events`.
- `finalize_packet.py` now requires the runtime export bundle for `*-TRACE`
  acceptance gates: `stack-runtime/factory.json`, `stack-runtime/events.json`,
  and `stack-runtime/status.json` in addition to the thread export manifest.
- Isolated finalize smoke generated `acceptance.md` with `SE-B77-5-TRACE` pass
  evidence naming all four files.
- TUI Local Research now prefers `stackd` factory snapshot `local_gepa` state
  for optimizer status/counts and keeps the direct GEPA poll as fallback/details.
- Isolated mock GEPA + temp stackd smoke reduced to
  `control_state=local_gepa_running`, `local_gepa.active_run_id=gepa-smoke-run`,
  and `active_run_count=1`, which is the runtime projection consumed by the TUI.
- TUI Hosted Optimizers now prefers `remote_synth.hosted_optimizers` from the
  factory snapshot for hosted run list/status and keeps direct owner API data as
  fallback/details for artifacts.
- Isolated mock Synth + temp stackd smoke reduced to
  `control_state=hosted_optimizer_active`,
  `remote_synth.active_hosted_optimizer_count=1`, and hosted run
  `hosted-opt-smoke`, which is the runtime projection consumed by the TUI.
- Stack MCP remote levers now append best-effort runtime receipts after owner
  actions: SMR run messages, Factory messages, SMR run pause/resume/stop, and
  hosted optimizer cancellation. Sensors still observe owner-system state on a
  later tick; reducers do not mutate remote systems.
- Focused checks passed after formatting: `cargo check -p stackd`,
  `bunx tsc --noEmit`, `python3 -m py_compile scripts/stackeval/lib/trace_stackd.py`,
  `python3 -m py_compile scripts/stackeval/lib/finalize_packet.py`,
  `bash -n scripts/stackeval/lib/export_stackd.sh`.

Missing local GEPA smoke, 2026-06-30:

- `STACK_OPTIMIZER_SERVICE_URL=http://127.0.0.1:19879`
- `POST /runtime/tick`
- emitted `sensor.local_gepa.service.unreachable`
- reduced `local_gepa.service_status` to `stopped`
- emitted `sensor.remote.auth.missing` when no Synth auth was present

Sensor owner-API reads are bounded:

- `local_gepa`: 2 second per-request timeout
- `remote_synth`: 5 second per-request timeout

Stale-resource smoke, 2026-06-30:

- Tick 1 mock returned active local GEPA run, remote project/run/factory, hosted
  optimizer.
- Tick 2 mock returned successful empty lists.
- Runtime emitted:
  - `sensor.local_gepa.run.unobserved`
  - `sensor.remote.project.unobserved`
  - `sensor.remote.project_run.unobserved`
  - `sensor.remote.factory.unobserved`
  - `sensor.remote.hosted_optimizer.unobserved`
- Runtime reduced active counts to zero for local GEPA, remote runs, remote
  factories, hosted optimizers, and projects.

`*.unobserved` events are absence receipts from a successful owner-list read.
Fetch failures do not erase prior state.

Projection cleanup smoke, 2026-06-30:

- A project/run observed on tick 1 and omitted from a successful project list on
  tick 2 reduced `remote_synth.projects.length=0` and
  `remote_synth.runs.length=0`.
- Real terminal run events may remain as recent run rows; `project_run.unobserved`
  removes disappeared runs from the projection.

Control-state smoke, 2026-06-30:

- Active local GEPA + active remote project/run/factory + active hosted
  optimizer reduced to `control_state=dual_active`.
- Successful empty owner-list reads after active state emitted `*.unobserved`
  receipts and reduced to `control_state=quiescent`.
- Owner API loss after active state emitted
  `sensor.local_gepa.service.unreachable`, cleared stale local active ids, kept
  last-known remote active state, and reduced to `control_state=degraded`.

First-seen terminal local GEPA smoke, 2026-06-30:

- Mock GEPA service first returned only `status=completed`.
- Runtime emitted `sensor.local_gepa.run.completed`, not
  `sensor.local_gepa.run.discovered`.
- Runtime kept `local_gepa.active_run_count=0`, `active_run_id=null`, and
  `control_state=quiescent`.
