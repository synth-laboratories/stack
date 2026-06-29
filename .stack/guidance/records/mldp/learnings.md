# Stack learnings

Workspace-scoped MLDP learnings mirrored for Stack MCP search.

STACK_MEMORY|ts=2026-06-29T01:45:00Z|kind=learning|file=.stack/guidance/records/mldp/learnings.md|severity=LOW|source=codex

## GEPA ran ≠ prompt improved

A green smoke GEPA run proves plumbing (registry harvest, grader wiring), not
that the prompt beat the seed on heldout. Gate presets need explicit heldout
measurement and enough proposals before claiming uplift.

## Smoke vs gate presets

StackEval smoke presets exist to fail fast on env and harness shape. Do not
treat smoke success as release or launch evidence — copy gate preset ids into
proof packets when making uplift claims.

## Guidance layers compound

Org synthstyle + repo `STYLE.md` + personal `~/.stack/guidance/style/` stack
without duplication. Search all layers; inject narrower layers first when
steering a worker thread.

## Voice lands in Gardener only

Operator voice dictation enqueues Gardener inbox (`source: voice`), never a
worker Codex thread directly. Route through Gardener after review.
