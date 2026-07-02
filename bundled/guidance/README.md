# Stack guidance

Searchable operator memory for this Stack workspace. Runtime guidance is
Stack-owned and writes only under `.stack/guidance/`.

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

## Monitor-visible context

The monitor does not receive a raw dump of local notes. It can retrieve bounded,
searchable guidance through the same guidance index used by Stack MCP.

Stable manifest: [`monitor-visible-context.md`](monitor-visible-context.md).

Copy only high-signal excerpts into `.stack/guidance/` when a monitor, eval
harness, or rollout harness should see them.

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
  monitor, eval, or rollout harnesses.
