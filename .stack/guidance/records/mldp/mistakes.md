# Stack mistakes

Repeatable operator/agent errors the monitor should catch.

STACK_MEMORY|ts=2026-06-29T01:45:00Z|kind=mistake|file=.stack/guidance/records/mldp/mistakes.md|severity=MED|source=codex

## Cross-authority recovery

Do not read Postgres, Redis, or compatibility projections when the typed
Stack MCP / backend route is missing. Add the path at the owner or hard fail.

## Stale StackEval grade artifacts

Grader/reviewer stages must delete stale `grade.json` / `review.json` before
invoking Codex — otherwise an old pass masks a real failure.

## Assuming dict-shaped GEPA registry

`candidate_registry.json` may be list-shaped. Harvest parsers must match the
emitter, not an assumed dict schema.

## Pasting megaprompts instead of search

Prefer `stack_search_guidance` + selective read over dumping full style trees
into worker context each turn.
