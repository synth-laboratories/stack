# Stack desires

Improvements noticed but not actionable this session.

STACK_MEMORY|ts=2026-06-29T01:45:00Z|kind=desire|file=.stack/guidance/records/mldp/desires.md|severity=LOW|source=codex

## TUI hold-to-talk voice

Wire hold-`V` mic capture in Stack TUI → Groq/OpenAI STT → Gardener inbox
(same path as `smoke:voice:gardener-demo`).

## LLM Gardener pass

Deterministic Gardener v1 routes and tidies; v2 should summarize inbox,
dedupe friction, and propose papercut/MLDP lines for operator approval.

## External search connectors in stack_search_guidance

Future connectors can optionally fan out to external org memory services while
keeping Stack runtime writes and first-class guidance records under `.stack/`.
