# Stack guidance

Searchable operator memory for this Stack app root. Stack is inspired by local
operator-memory systems, but runtime guidance is Stack-owned and writes only
under `.stack/`.

## Map

| Path | Contents |
| --- | --- |
| `style/` | Layered style docs — see `style/README.md` (org/repo/personal/app) |
| `style/repo/` | Committable repo-team style files (multiple `.md` OK) |
| `records/mldp/` | Workspace learnings, mistakes, and desires |
| `records/papercuts/` | Friction log with grep-stable `STACK_MEMORY` lines |
| `records/decisions/` | Local Stack ADRs |
| `workflows/` | Optional prose; prefer `.stack/skills/` for executable procedures |

## Search

- Stack MCP: `stack_search_guidance`
- Local files: `.stack/guidance/`

## Monitor-visible Context

The monitor does not receive a raw dump of local notes. It can retrieve bounded,
searchable guidance through the same guidance index used by Stack MCP.

Stable manifest: [`monitor-visible-context.md`](monitor-visible-context.md).

Indexed from Stack/workspace when present:

- `backend/specifications/tanha/references/synthstyle.md` as org Synth Style.
- `specifications/old/tanha/references/synthstyle.md` as a historical org
  Synth Style copy when that checkout exists.
- `.stack/guidance/records/mldp/*.md`, `records/papercuts/*.md`, and
  `records/decisions/*.md` as local high-signal records.

Not indexed by default: arbitrary daily notes, external evidence packets, full
product specs, lints, or secrets. Copy only the specific high-signal record into
`.stack/guidance/records/` when a monitor, StackEval run, or rollout harness
should see it.

## Events

Stack keeps guidance maintenance telemetry in local SQLite at
`.stack/guidance/events.sqlite`.

Use Stack MCP:

- `stack_guidance_record_event` for `guidance.doc_added`,
  `guidance.doc_updated`, `guidance.doc_deleted`, `guidance.used`,
  `guidance.impact_judged`, and `guidance.query`.
- `stack_guidance_events` to inspect the ledger.

`stack_search_guidance` records `guidance.query` automatically.
`stack_guidance_read` records `guidance.used` automatically and can also append
per-thread JSONL events when a `thread_id` is supplied.

## Write

- Local Stack operator memory goes here when it should be visible to Stack
  monitor, StackEval, or rollout harnesses.
