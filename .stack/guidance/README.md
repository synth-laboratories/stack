# Stack guidance

Searchable operator memory for this Stack app root. It is not a copy of all
Jstack; it is a small local index of high-signal style, papercuts, decisions,
and workflow pointers that Stack MCP can search.

## Map

| Path | Contents |
| --- | --- |
| `style/` | Synth Style pointers and Stack MCP/TUI norms |
| `records/mldp/` | Workspace learnings, mistakes, and desires |
| `records/papercuts/` | Friction log with grep-stable `JSTACK_HEATMAP` lines |
| `records/decisions/` | Local ADRs when a Jstack checkout is absent |
| `workflows/` | Optional prose; prefer `.stack/skills/` for executable procedures |

## Search

- Stack MCP: `stack_search_guidance`
- Local files: `.stack/guidance/`
- Co-located Jstack: `Jstack/.jstack/`

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

- Org-wide bugs and papercuts stay in Jstack via `jsk papercut`.
- Local Stack operator memory may be mirrored here when it should be visible to
  Stack monitor, StackEval, or rollout harnesses.

Spec: `Jstack/.jstack/product/specs/stack_guidance.md`.
