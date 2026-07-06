# Assembly Lines

An **AssemblyLine** is the process layer above Efforts. An Effort captures the
working substance of one initiative (goals, evidence, findings, handoffs); an
AssemblyLine captures the *process position* of that initiative: which station
it sits at, whether a standards gate is open, who owns the next move, and what
the next safe action is. Assembly Lines never replace Efforts, Runs, Projects,
Tasks, or meta-threads — they bind to them.

Owner of record: `stackd` (SQLite under `.stack/runtime/assembly.sqlite`).
Core types and transition rules live in `stack_core::assembly_line`.

## Station schema

There is exactly **one** station schema. A station is:

| field | meaning |
| --- | --- |
| `id` | stable snake_case station id, unique within the preset |
| `title` | operator-facing name |
| `requires_evidence` | whether `assembly.station_completed` must carry at least one evidence artifact path |

Stations are strictly ordered by the preset. A line is always at exactly one
station (its *current station*) until the final station completes.

## Presets

Two presets instantiate the schema:

**`ship`** — the shipping pipeline:

```
intake → problem_selection → scope_lock → build → internal_proof
       → quality_review → staging → prod → readout
```

**`effort`** — the general Effort lifecycle:

```
intake → plan → execute → validate → review → ship → monitor → follow_up
```

In both presets `intake` is the only station that completes without evidence;
every later station requires at least one evidence artifact path.

The *ship station* of a preset (`prod` for `ship`, `ship` for `effort`) is the
station whose completion unlocks the `assembly.shipped` event.

## Typed transition events

Every state change is a typed event appended to the line's event log. The
projection (snapshot) is derived from the log; there is no second write path.

| event | meaning | requirements |
| --- | --- | --- |
| `assembly.created` | line exists at the preset's first station | written once by create; never accepted on the transition endpoint |
| `assembly.station_started` | work opened on the current station | station must be the current station and not already started |
| `assembly.station_completed` | current station done; line advances | station must be current and started; no open gate; evidence paths present when the station requires evidence |
| `assembly.gate_failed` | a standards gate on the current station failed | verdict `concern` or `fail`; **must** carry `next_owner` and `next_safe_action` |
| `assembly.gate_passed` | the open gate cleared | verdict `pass` or `n_a`; requires an open gate on that station |
| `assembly.shipped` | the initiative shipped | preset's ship station must be completed; at most once |
| `assembly.follow_up_due` | a follow-up obligation is on the clock | only after `assembly.shipped` |

Invalid transitions are rejected with a typed error that surfaces the failure
class: `unknown_station`, `invalid_transition` (skipping stations, completing
an unstarted station, double-start, gate operations out of order),
`missing_evidence`, `invalid_gate_event`, `not_found`. There are no fallback
paths: one correct transition per state, everything else is an error.

## Standards gate verdicts

Gate verdicts are the closed set `pass | concern | fail | n_a` — never
"blocked". A failed gate does not freeze the line into an untyped limbo; it
opens a gate that carries its own routing:

- `next_owner` — the actor id who owns resolving the gate, and
- `next_safe_action` — the one concrete action that owner takes next.

Both fields are required on every `assembly.gate_failed` event.

## Bindings

An AssemblyLine binds to the records that carry the substance:

| binding | contents |
| --- | --- |
| `effort_ids` | Stack Effort ids |
| `meta_thread_ids` | meta-thread ids |
| `worker_ids` / `gardener_ids` / `monitor_ids` | actor ids by role |
| `evidence_paths` | evidence artifact paths declared on the line (event-level evidence accumulates in the snapshot as well) |
| `ship_bundle_path` | path to the external Jstack markdown ship bundle — a **linked record**, not a second source of truth; the assembly log never mirrors its contents |
| gate verdicts | live on `gate_failed` / `gate_passed` events, verdict set above |

Worker and effort bindings follow the same association authority as the rest
of Stack: the worker's meta-thread manifest (`gardener_thread_id`,
`effort_ref`, lifecycle) is the authority for which gardener and Effort a
worker belongs to. An Effort's reverse index (`links.meta_thread_refs`) is a
consistency check only. Any assembly surface that lists workers must exclude
workers without manifest association metadata, or show them only in a
separate unassociated-workers debug section.

## Design decisions

- **Monitors audit and recommend; they do not own gate verdicts.** A monitor
  may bind to a line and record findings, but gate events are issued by the
  owner or gardener acting on typed evidence.
- **Gardeners may propose, queue, and route station actions**, but a typed
  station completion always requires evidence plus an explicit transition
  event. Nothing advances by narration.
- **Station completion without evidence is rejected** whenever the station
  schema requires evidence (all stations after `intake`).
- **Decisions come from typed transition events**, never from phrase-matching
  model output.

## HTTP surface (stackd)

- `GET /assembly-lines` — list line snapshots
- `POST /assembly-lines` — create (`title`, `preset`, `owner`, optional `bindings`)
- `GET /assembly-lines/:id` — record plus full event log
- `GET /assembly-lines/:id/snapshot` — projection: current station, open gate, owner, age, bindings, last event, next action
- `POST /assembly-lines/:id/events` — append one typed transition event
- `PATCH /assembly-lines/:id/bindings` — merge a typed bindings update: list
  fields append (deduplicated, order preserved), `ship_bundle_path` replaces,
  and an empty update is rejected as `invalid_field`. Bindings link records —
  the update never touches the event log or process state.

## MCP surface (Stack MCP)

- `stack_assembly_create`
- `stack_assembly_list`
- `stack_assembly_get`
- `stack_assembly_transition`
- `stack_assembly_bind`

## Cockpit surface (TUI)

`/assembly` opens the Assembly Lines panel: a lane view (one row per line —
id, title, preset, current station, owner, age, open gate, next action) and a
detail view (stations walked with timestamps, bindings, gate history with
`next_owner`/`next_safe_action`, standards verdicts, recent events). Panel
actions — create, start/complete station, bind the ON Effort, attach ship
bundle path or evidence, route to gardener, request quality review, generate a
markdown handback under `.stack/assembly/handbacks/<line-id>/` — are typed
calls against the surfaces above. See `docs/USAGE.md` for keys.

## Actor integration

- **Gardener** — `stack_assembly_list` and `stack_assembly_get` are in the
  default gardener tool allow-list, and the garden workspace doc carries an
  `assembly_lines: N` counter plus a compact `## Assembly lines` section so
  routing can key off station and gate state.
- **Monitor** — when the monitored worker's meta-thread or Effort is bound to
  a line, `monitor.summary` and the human `monitor.goal_status` payloads carry
  a typed `assembly_line` object (`line_id`, `title`, `preset`,
  `current_station`, `next_action`) and the monitor rail renders
  `line <id> · station <station>`. Monitors audit and recommend; they never
  write gate verdicts or advance stations.

## CLI surface

`stack assembly list` renders one row per line: line id, preset, current
station, owner, age, open gate, next action. `stack assembly get <id>` shows
the snapshot plus recent events. `stack assembly transition <id> ...` appends
one typed event. Read and transition only.
