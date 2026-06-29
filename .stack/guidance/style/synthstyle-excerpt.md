# Synth Style excerpt for Stack

Source of truth: `backend/specifications/tanha/references/synthstyle.md`.
This file is a Stack-local kickoff pointer, not a fork of Synth Style.

STACK_MEMORY|ts=2026-06-28T23:10:00Z|kind=learning|file=.stack/guidance/style/synthstyle-excerpt.md|severity=LOW|source=legacy

## High-signal principles for Stack

- **Push interface complexity inward.** Stack should present simple operator and
  MCP surfaces while hiding backend/live-ops complexity behind contracts.
- **API-first, UX second.** Make the Stack MCP and stackd contracts strong, then
  let the TUI display those contracts.
- **Keep user config minimal.** Defaults should encode optimizer, eval, and
  harness setup when the operator intent is clear.
- **Start at high-signal chokepoints.** Guidance should target recurring
  friction ids and release gates, not become a general notes dump.
- **Manage scarce resources with one typology.** Treat model tokens, Codex
  accounts, local optimizer workers, containers, slots, and hosted jobs as
  resources with owners, receipts, and cleanup paths.

Use `stack_search_guidance` for the local excerpt and `style/synthstyle-source`
for the full source document when the monorepo checkout is present.
