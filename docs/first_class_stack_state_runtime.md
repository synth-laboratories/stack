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
- `sensor.local_gepa.run.completed`
- `sensor.local_gepa.run.failed`
- `sensor.local_gepa.run.unobserved`

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
    "environment_name": "dev",
    "api_base_url": "http://127.0.0.1:8000",
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
  - read runtime snapshot/events; `stack_runtime_status` reports
    `events_status` separately so a snapshot can still be useful when event
    listing is temporarily unavailable
  - prepare cloud-promotion packet
  - create cloud launch only through explicit dry-run/confirm semantics
  - inspect/terminate cloud launch
  - list/respond to run questions and approvals
- Promotion packet shape: active StackEval packet + runtime snapshot +
  correlation ids + operator metadata.
- Keep cloud mutation in levers only; sensors and reducers remain read-only.
- Keep direct remote API fallback while the runtime projection stabilizes; when
  runtime state exists, TUI and MCP project/run/factory lists should treat the
  stackd snapshot as the authoritative cockpit source.

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
- Remote SMR TUI list projection: runtime supplies run/factory identity,
  status, association, and recency; direct owner API reads remain only for deep
  detail maps such as artifacts, WorkProducts, runtime messages, and hosted
  artifact status.

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
    pub id: String,
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
    pub optimizer_run_id: Option<String>,
    pub trace_id: Option<String>,
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
    pub control_state: String,
    pub local_gepa: LocalGepaSnapshot,
    pub remote_synth: RemoteSynthSnapshot,
    pub recent_events: Vec<RuntimeEventRef>,
}
```

The first reducer uses string-compatible control-state values so TypeScript and
JSON consumers do not need a Rust enum binding:

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
  subject_id TEXT NOT NULL,
  subject_json TEXT NOT NULL,
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
  id INTEGER PRIMARY KEY CHECK (id = 1),
  snapshot_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  events_appended INTEGER NOT NULL DEFAULT 0
);
```

Do not add per-product tables in V1. If query needs outgrow this schema, add
indexes first and only then consider shape changes.

### Sensor Poll Shape

V1 uses concrete async sensor functions instead of adding a trait dependency for
two sensors. Each sensor returns the same small output shape:

```rust
pub struct SensorPollOutput {
    pub events: Vec<RuntimeEventDraft>,
    pub cursor: serde_json::Value,
}
```

Keep this shape if a trait is added later.

### Local GEPA Cursor

V1 cursor:

```json
{
  "service_status": "reachable",
  "service_url": "http://127.0.0.1:8879",
  "runs": {
    "run_id": {
      "status": "running",
      "phase": "generation_start",
      "generation": 0,
      "candidate_count": 1,
      "best_candidate_id": null,
      "cost_usd": 0.0,
      "error": null
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
- successful terminal status: `sensor.local_gepa.run.completed`
- failed terminal status: `sensor.local_gepa.run.failed`
- previously active run disappears from bounded service result:
  `sensor.local_gepa.run.unobserved`

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
  "environment_name": "dev",
  "api_base_url": "http://127.0.0.1:8000",
  "auth_status": "ready",
  "projects": {
    "project_id": {
      "name": "Project",
      "alias": null,
      "updated_at": "..."
    }
  },
  "runs": {
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
  "optimizers": {
    "run_id": {
      "status": "running"
    }
  }
}
```

Diff rules:

- missing auth -> ready: `sensor.remote.auth.ready`
- ready -> missing auth: `sensor.remote.auth.missing`
- selected env/base URL changed: `sensor.remote.environment.selected`
- project changed: `sensor.remote.project.updated`
- project disappears from bounded result: `sensor.remote.project.unobserved`
- project run state/phase/updated_at changed: `sensor.remote.project_run.updated`
- project run enters terminal state: `sensor.remote.project_run.terminal`
- previously active project run disappears from a successfully fetched
  project-scoped result: `sensor.remote.project_run.unobserved`
- Factory status/next wake/project/run hint changed: `sensor.remote.factory.updated`
- Factory disappears from bounded result: `sensor.remote.factory.unobserved`
- Hosted optimizer status/finalize/cursor changed:
  `sensor.remote.hosted_optimizer.updated`
- previously active hosted optimizer disappears from bounded result:
  `sensor.remote.hosted_optimizer.unobserved`

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
full durable runtime event log
```

Reducer output:

```text
next snapshot
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
4. Poll `remote_synth`; when Synth auth is missing, emit the auth-missing
   observation and do not poll owner resources.
5. Append events in one transaction.
6. Reduce the full durable event log into `factory_snapshot`.
7. Write `.stack/runtime/status.json` compatibility projection.
8. Persist sensor cursors only after append, reduction, snapshot save, and
   status projection succeed.

Runtime writers share a stackd-owned async write lock. Scheduler ticks,
`POST /runtime/tick`, MCP/TUI-triggered ticks, StackEval export ticks, and
`POST /runtime/events` lever writes must not overlap, because overlapping
append/reduce/snapshot writes can otherwise briefly overwrite newer reduced
state with an older reduction.

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

Successful `POST /runtime/events` responses include `events_appended`, matching
the number of accepted lever receipts in that request.

V1 append bounds:

- `event_type`, `source`, and `subject.kind`: max 160 bytes each.
- `subject.id`: max 512 bytes.
- `observed_at`: max 128 bytes.
- serialized `payload`: max 64 KiB.

`GET /runtime/events` uses the same 160-byte bound for the optional `source`
filter and clamps `limit` to the store page bounds.

`POST /runtime/tick` is for local debugging and StackEval proofs. It should run
one bounded tick and return `events_appended` plus snapshot. It should not
start services or mutate owner systems beyond Stack's local runtime store.

`GET /runtime/factory` should return the latest stored snapshot plus the latest
stored `events_appended` metadata from the runtime store.

### Compatibility Projection

Top-level `/status.runtime` should prefer the latest factory snapshot from the
Stack-owned runtime store, then fall back to `.stack/runtime/status.json` for
older file-only projections. Keep the field while migrating so existing status
consumers can move gradually.

When `/status.runtime` is rebuilt from SQLite, it should preserve the latest
stored `events_appended` metadata instead of hardcoding a zero-count projection.

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
- TUI Remote SMR now prefers `remote_synth.runs` and
  `remote_synth.factories` from the factory snapshot for the run/factory list
  while preserving direct owner API detail maps for artifacts, WorkProducts,
  runtime messages, file mounts, and hosted artifact status.
- Stack MCP and TUI remote levers now append best-effort runtime receipts after
  owner actions: SMR run messages, Factory messages, SMR run pause/resume/stop,
  SMR run-file upload requests, and hosted optimizer cancellation. Sensors
  still observe owner-system state on a later tick; reducers do not mutate
  remote systems.
- Runtime reduction now reads the full durable event log rather than the public
  `/runtime/events` page size, so snapshots continue to include events after
  the first 10,000 receipts. Public event listing remains bounded.
- Sensor cursors are now committed only after event append, full reduction,
  snapshot save, and status projection succeed. A failed tick may retry an
  observation, but it should not advance past an observation that was never
  durably appended.
- Partial owner-list fetch failures now emit `*.fetch_failed` sensor events
  instead of silently preserving stale active state. The reducer keeps
  last-known owner state but marks the factory snapshot `degraded` when an
  active local GEPA, remote SMR/Factory, or hosted optimizer lane loses its
  list surface.
- Per-Factory enrichment fetch failures now emit
  `sensor.remote.factory_projects.fetch_failed` and
  `sensor.remote.factory_status.fetch_failed` with `factory_id` correlation.
  The sensor preserves prior enrichment fields for that Factory instead of
  erasing linked projects, cloud-dev badge state, or active-effort status after
  a partial subrequest miss.
- `sensor.local_gepa` now reads run rows from the real service through
  `/runs?limit=12`, then falls back within the same service authority to
  `/workspace` and `/status`. The installed `synth-optimizers gepa service`
  tested in smoke exposed `/status` but returned 404 for `/runs`.
- The local GEPA run parser understands service-managed list/status envelopes:
  raw arrays, `/runs` page `items`, `/workspace` or `/status` `runs`, and the
  real service `run_requests` queue. This keeps the sensor compatible with
  both CLI-managed GEPA runs and StackEval service-mode runs submitted through
  `POST /runs`.
- `sensor.remote_synth` now resolves the selected Stack environment from
  `STACK_ENVIRONMENT` / `stack.config.json`, reads that environment's auth env
  or auth file, and emits `sensor.remote.environment.selected` as a reducer
  boundary. Switching environments clears prior remote projection before new
  remote Synth events are reduced. The factory snapshot carries
  `remote_synth.environment_name` and `remote_synth.api_base_url`, and
  runtime-first TUI/MCP projections render those snapshot values instead of
  relabeling old runtime state with the current UI config.
- The factory snapshot also carries `local_gepa.service_url` from the local GEPA
  service sensor, and the TUI Local Research runtime projection renders that
  observed service URL before falling back to static config.
- Runtime reducer output is ordered for cockpit consumption before bounded
  truncation: active/non-terminal remote runs and optimizers first, active
  factories first, then newest available timestamp, then stable id. Consumers
  should not depend on raw map/key order.
- Remote Synth resource events (`project`, `project_run`, `factory`, hosted
  optimizer) carry the selected `environment` and `api_base_url` in their
  payload, so exported event streams remain self-describing even outside the
  reduced snapshot.
- Cloud lever receipts from MCP/TUI carry the same `environment` and
  `api_base_url` pair, so "Stack acted" events can be correlated with later
  `sensor.remote_synth.*` observations without relying on ambient UI config.
- Local GEPA service lever receipts carry the observed service URL plus bind,
  command, DB path, log path, PID path, worker count, and workspace root so
  StackEval exports can distinguish same-host optimizer services.
- StackEval GEPA lever receipts carry packet id, task id, preset, Stack session
  id, StackEval run id, GEPA config path, command, phase, logs, and exit code
  when available, so the local optimizer proof can be interpreted from the
  runtime export alone.
- StackEval export now runs one bounded `/runtime/tick` before collecting
  runtime evidence and saves the response as `stack-runtime/tick.json`, so trace
  packets contain a fresh tick receipt with `events_appended`.
- StackEval `*-TRACE` gates now require `stack-runtime/tick.json` alongside the
  factory/events/status runtime files, the filtered
  `stack-runtime/stackeval-events.json` lever receipt export, and the thread
  export manifest.
- StackEval `*-TRACE` gates now validate runtime export content, not just file
  presence: ready tick, ready factory snapshot, non-empty runtime events, and a
  packet-matching `lever.stackeval.gepa.*` runtime receipt plus a
  `/status.runtime.factory` projection with `events_appended`.
- Isolated finalizer smoke proved the stricter `SE-B77-5-TRACE` gate passes on
  a synthetic packet only when `stack-runtime/stackeval-events.json` contains a
  packet-matching `lever.stackeval.gepa.*` receipt; generated acceptance
  evidence reported `stackeval_events=1`. The paired negative fixture rewrote
  the receipt to a wrong packet id and the gate failed with
  `stackeval_events=0`.
- Live real-service smoke started `synth-optimizers gepa service` against a
  temp SQLite DB on `127.0.0.1:19879`, ran isolated stackd on `127.0.0.1:18892`,
  appended a real `lever.stackeval.gepa.started` receipt through
  `trace_stackd.py`, exported runtime evidence, and finalized
  `/tmp/stack-real-gepa-smoke.Sc2ORf/packet-live-stackd`. `SE-B77-5-TRACE`
  passed with `events=4`, `stackeval_events=1`, and
  `local_gepa.service_status=running`.
- Full real StackEval smoke ran `./bin/stackeval run banking77-local-gepa
  --preset smoke --packet-dir /tmp/stack-real-gepa-e2e.e5tsD2/packet-real
  --no-grade` against isolated stackd on `127.0.0.1:18893` and a real
  `synth-optimizers gepa service` on `127.0.0.1:19880`. The GEPA CLI completed
  40 Banking77 rollouts plus one Codex proposer job, accepted
  `gepa_330ebd9b916d`, reported heldout `0.750 -> 0.750`, and finalized the
  packet after the trace-root directory fix. Acceptance passed
  `SE-B77-1-HARNESS` through `SE-B77-5-TRACE`; `SE-B77-6-LEVERAGE` failed only
  because grader/reviewer were intentionally skipped with `--no-grade`.
- A separate source-backed service smoke ran the checked-out
  `optimizers` service (`0.2.6.dev20260626`) on `127.0.0.1:19882` with isolated
  stackd on `127.0.0.1:18895` and
  `STACKEVAL_GEPA_HARNESS_MODE=service`. StackEval submitted the run through
  `POST /runs`, the service managed the run as
  `gepa_3d7d640253c841f292c86dfed35a7162`, completed with
  `status=succeeded`, `best_candidate_id=gepa_1c284a9e221e`, heldout `0.75`,
  and 24 rollouts, and finalized
  `/tmp/stack-service-gepa-e2e.JmhHH3/packet-service-v2`. The exported runtime
  event tape had 15 events, including `sensor.local_gepa.run.discovered`,
  multiple `phase_changed`/`progress` events,
  `sensor.local_gepa.run.completed`, and matching StackEval lever
  start/complete receipts. Acceptance passed `SE-B77-1-HARNESS` through
  `SE-B77-5-TRACE`; `SE-B77-6-LEVERAGE` failed only because the smoke used
  `--no-grade`.
- Service mode is now a first-class StackEval switch:
  `./bin/stackeval run banking77-local-gepa --preset smoke --harness-mode service`.
  The pipeline exports `STACKEVAL_GEPA_HARNESS_MODE`, packet metadata records
  `harness_mode`, and StackEval lever receipts carry the same mode so exported
  evidence distinguishes CLI-managed GEPA from service-managed GEPA without
  relying on ambient shell state.
- Service mode now starts the real optimizer service when the configured
  `STACK_OPTIMIZER_SERVICE_URL` is not reachable. By default it launches
  `uv run synth-optimizers gepa service` from the sibling `optimizers` checkout,
  writes the service SQLite DB under the StackEval packet, records
  `service_autostarted`, `service_pid`, `service_log`,
  `service_start_command`, `service_start_cwd`, and `service_db_path` in
  `harness.json`, and stops only the process it started during harness cleanup.
  Operators can override this with `STACKEVAL_GEPA_SERVICE_COMMAND`,
  `STACKEVAL_GEPA_SERVICE_CWD`, and `STACKEVAL_GEPA_SERVICE_DB`.
- Service-mode `harness.json` now stores
  `service_receipt_schema=stackeval.gepa.service_receipt.v1`,
  `service_run_schema=stackeval.gepa.service_run_summary.v1`, and a bounded
  run summary instead of the raw service projection. Large service-owned state
  such as limit event arrays stays in the optimizer workspace and runtime
  evidence points at run ids/artifacts rather than copying the full service
  state into the StackEval packet. `SE-B77-1-HARNESS` now validates those
  service-mode fields instead of accepting a bare `harness.json` file.
- The installed `synth-optimizers` uv tool on this machine is
  `0.1.0-alpha.0` and still uses the older `config_path` service submit path.
  The service-mode harness keeps a narrow compatibility render for that path,
  but the current cookbook container advertises
  `synth_optimizers.gepa.v2`; real service-managed StackEval proof should use
  the checked-out optimizer service until the installed tool is upgraded.
- Autostart real-service proof ran isolated stackd with
  `STACK_OPTIMIZER_SERVICE_URL=http://127.0.0.1:19884` and then ran
  `./bin/stackeval run banking77-local-gepa --preset smoke --harness-mode service
  --packet-dir /tmp/stackeval-real-service-sensor-autostart --no-grade`.
  The harness started the optimizer service itself, submitted
  `gepa_10e248ff78e04493a10d6f2293a0aaca` through JSON `POST /runs`, completed
  with `status=succeeded`, `phase=completed`, `best_candidate_id=gepa_1c284a9e221e`,
  heldout `0.75`, and 40 rollouts. The runtime export included
  `sensor.local_gepa.service.unreachable`, `.reachable`,
  `sensor.local_gepa.run.discovered`, phase/progress events,
  `sensor.local_gepa.run.completed`, the matching StackEval lever start/complete
  receipts, and a final service-unreachable event after harness cleanup.
- Strict finalizer proof ran isolated stackd on `127.0.0.1:18897` with the
  local GEPA sensor pointed at `127.0.0.1:19885`, then ran
  `./bin/stackeval run banking77-local-gepa --preset smoke --harness-mode service
  --packet-dir /tmp/stackeval-real-service-strict-finalizer --no-grade`.
  The harness autostarted the source-backed optimizer service, recorded
  `service_receipt_schema`, command/cwd/db/pid receipt fields, submitted
  `gepa_9a751f9638764f469c4d3a56721d686d` through JSON `POST /runs`, and
  finalized with `SE-B77-1-HARNESS` through `SE-B77-5-TRACE` passing. The
  acceptance row for `SE-B77-1-HARNESS` used the stricter evidence
  `harness_mode=service submit=json status=succeeded autostarted=True`, and
  `SE-B77-5-TRACE` reported `events=41`, `stackeval_events=2`, and
  `events_appended=1`.
- Full service-mode StackEval proof under `/tmp/stackeval-real-service-live`
  completed the end-to-end smoke path with the checked-out optimizer service
  owned by the harness. The packet autostarted the source-backed service,
  submitted `gepa_1ee614918d3b46b696af9fbe6c0e4842` through JSON
  `POST /runs`, completed `status=succeeded` / `phase=completed`, reported
  heldout accuracy `75.0%`, exported `55` runtime events with `2`
  packet-matching StackEval lever events, and finalized all six gates
  `SE-B77-1-HARNESS` through `SE-B77-6-LEVERAGE` as passing. The independent
  grader/reviewer confirmed `task_outcome_score=4/5` and
  `stack_leverage_score=3/5`; `SE-B77-6-LEVERAGE` now requires parseable
  grade/review JSON, no reviewer rejection, and effective task/leverage scores
  meeting the preset minima (`task=4/2`, `stack=3/2` for this smoke packet).
  This remains a smoke/plumbing proof, not an optimized-prompt-lift claim.
- Fresh full service-mode packet
  `.stack/evidence/stackeval/banking77-local-gepa/20260630T070710Z` reran the
  same proof against an isolated current stackd (`STACK_API_URL` on port
  `18992`) and source-backed optimizer service (`STACK_OPTIMIZER_SERVICE_URL`
  on port `18899`). The harness submitted
  `gepa_39e4e00a9c434112bab47acae5e42dff` through JSON `POST /runs`, completed
  `status=succeeded` / `phase=completed`, accepted proposed candidate
  `gepa_1dafd84fe4fd`, and reported heldout accuracy `75.0%`. The packet
  finalized all six gates passing, including runtime trace export with
  `codex/trace.json`, `stack-runtime/tick.json`, `factory.json`, `events.json`,
  `stackeval-events.json`, and `status.json` (`events=83`,
  `stackeval_events=2`). Grade gave task `3/5` and Stack leverage `4/5`; review
  confirmed both scores. This is the preferred current receipt.
- StackEval export now treats the monitor checkpoint wait as best effort. When
  a monitor checkpoint is absent, hard stackd runs such as
  `STACKEVAL_REQUIRE_STACKD=1` still copy stackd session export plus
  `stack-runtime/tick.json`, `factory.json`, `events.json`,
  `stackeval-events.json`, and `status.json`; the monitor wait traceback is
  captured in `stack-session/monitor-wait.log`.
- StackEval export now also treats stackd session export, thread trace, and
  runtime endpoints as independent receipts. A shared older stackd can pass
  `/health` and `/status` while returning 404 on newer trace/runtime routes; in
  that case export writes route-specific diagnostics under `stack-session/`,
  continues collecting whatever runtime/status evidence is available, and marks
  the pipeline export stage `partial` instead of leaving it `running`. The
  finalizer now requires `codex/trace.json` as part of the `SE-B77-5-TRACE`
  bundle and includes route diagnostics in failed trace evidence rows, so
  partial trace packets explain the missing session or runtime routes directly.
- StackEval grader/reviewer stages now validate generated JSON before marking
  the stage `ok`, finalization ignores malformed optional grade/review JSON
  instead of crashing, and the active grader/reviewer prompts specify strict
  JSON schemas plus stage-order guidance.
- Static integration check after the real-service and score-aware finalizer
  changes: `bun run check` passed (`tsc --noEmit` plus `cargo build -p
  stackd`). StackEval harness syntax also passed: `python3 -m py_compile`
  over the touched Python helpers and `bash -n` over the touched shell
  pipeline helpers.
- `finalize_packet.py` now creates the configured StackEval trace root before
  writing `latest.json`, so isolated `STACKEVAL_TRACE_ROOT` runs do not fail
  after the harness/export stages have already produced a valid packet.
- `POST /runtime/events` now enforces the V1 bounded receipt contract:
  short event/source/subject identifiers, short `observed_at`, and max 64 KiB
  serialized payload. Large raw logs/artifacts stay in owner systems or packet
  files, with runtime events carrying pointers/tails only.
- `GET /runtime/events` now enforces the same source-filter bound before
  querying SQLite, so read-side filters cannot become an unbounded runtime API
  input.
- The stackd OpenAPI document now describes the same `POST /runtime/events`
  receipt bounds and the `GET /runtime/events` source-filter bound so
  MCP/TUI/StackEval clients have the public contract at the HTTP boundary.
- The TypeScript `stackdRuntimeAppendEvent` client exports the same V1 bounds
  and validates requests before sending, so MCP/TUI/local GEPA receipts fail
  locally instead of discovering oversize payloads only through stackd 400s.
- The TypeScript `stackdRuntimeEvents` client validates the optional source
  filter against the same exported source bound.
- `stack_runtime_status` now surfaces event-listing failures as
  `events_status: "unavailable"` plus `events_error`, instead of returning an
  indistinguishable empty event list when the factory snapshot read succeeds but
  `/runtime/events` fails.
- `POST /runtime/tick` now returns `events_appended` alongside the updated
  snapshot, making no-op ticks and sensor-diff ticks distinguishable in
  StackEval proofs and MCP/TUI debugging.
- `stack_runtime_status({ tick: true })` now carries that `events_appended`
  value through the Gardener-facing MCP tool response.
- `/status.runtime` now preserves the latest stored `events_appended` value
  when it prefers the SQLite factory snapshot, so status readers and file
  projection readers agree on the last tick's append count.
- `GET /runtime/factory` now returns the same latest stored `events_appended`
  metadata as the status projection, so MCP/TUI callers can inspect the factory
  snapshot without losing tick proof metadata.
- TUI Active Projects now keeps the `/runtime/factory` `events_appended`
  metadata in state and renders it in the runtime line as `tick:+N`, making
  no-op versus eventful ticks visible in the cockpit.
- Runtime writes are now serialized behind a stackd async lock, so the
  scheduler, manual `/runtime/tick`, MCP/TUI tick calls, StackEval export tick,
  and `POST /runtime/events` lever writes cannot overlap append/reduce/snapshot
  windows.
- `POST /runtime/events` now returns `events_appended` in the HTTP response,
  matching the count persisted in the snapshot/status projection for the lever
  append.
- Runtime store migration now upgrades existing `.stack/runtime/factory.sqlite`
  files that predate `runtime_events.subject_json`, backfills the JSON subject
  from `subject_kind` / `subject_id`, and adds `factory_snapshot.events_appended`
  when missing. Probe proof used `/tmp/stack-runtime-migration.aXgbn3`: an
  old-shape DB accepted `POST /runtime/events`, returned `events_appended=1`,
  exposed the event through `GET /runtime/events`, and returned the factory
  snapshot through `GET /runtime/factory`.
- `sensor.remote_synth` env-file auth parsing now skips malformed non-comment
  lines instead of treating them as an absent key, so a later valid
  `SYNTH_API_KEY=` / environment-specific auth entry remains discoverable.
- `sensor.remote_synth` list parsing now handles direct arrays, top-level
  `items`, direct `runs` / `projects` / `factories` / `optimizers` arrays, and
  nested `{ key: { items: [...] } }` envelopes so owner API pagination wrappers
  do not look like empty successful reads.
- `sensor.local_gepa` and the TypeScript local optimizer fallback reader now
  handle nested `{ runs: { items: [...] } }` / `{ run_requests: { items: [...] } }`
  envelopes, matching the StackEval service harness parser and avoiding false
  empty run lists from compatible service responses.
- `sensor.local_gepa` run parsing now aligns with the TypeScript fallback for
  service-managed runs: `runId` / `run_id` / `id` / `request_id` identity,
  `status` / `request_status`, `usage.cost_usd`, `usage.total_tokens`, and
  structured `error.message` / `error.reason`. Token changes now emit
  `sensor.local_gepa.run.progress` alongside candidate/cost changes.
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
