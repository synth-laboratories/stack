# Multi-layer style docs (org / repo / personal / app)

**Date:** 2026-06-29
**Status:** accepted
**Impact:** guidance / MCP

STACK_MEMORY|ts=2026-06-29T01:45:00Z|kind=learning|file=.stack/guidance/records/decisions/2026-06-29-style-layers.md|severity=LOW|source=codex

## Decision

Stack guidance discovery indexes **four style layers**, each allowing **multiple
markdown files**:

| Layer | Location |
| --- | --- |
| org | Synth Style source of truth and optional `.stack/guidance/style/org/*.md` |
| repo | `STYLE.md`, `.stack/guidance/style/repo/*.md` |
| personal | `~/.stack/guidance/style/*.md` (override via env) |
| app | `.stack/guidance/style/*` (Stack product norms) |

MCP exposes optional `style_layer` on `stack_guidance_list` and
`stack_search_guidance`. Results include `style_layer` in JSON.

## Precedence

On inject/steer conflicts: **personal > repo > app > org**.

## Context

Operators need org-wide synthstyle, team repo conventions, and personal prefs
without maintaining one monolithic style file or linking Stack to another
memory system.

## Consequences

- `stack/src/codex/guidance-layers.ts` resolves layer roots.
- Personal style is per-user and gitignored by default.
- Repo style is commit-friendly under `.stack/guidance/style/repo/`.
