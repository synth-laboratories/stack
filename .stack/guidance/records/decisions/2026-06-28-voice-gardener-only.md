# Voice dictation → Gardener inbox only

**Date:** 2026-06-28
**Status:** accepted
**Impact:** product / orchestration

STACK_MEMORY|ts=2026-06-28T23:30:00Z|kind=learning|file=.stack/guidance/records/decisions/2026-06-28-voice-gardener-only.md|severity=LOW|source=codex

## Decision

Operator voice dictation (Groq `whisper-large-v3-turbo`, OpenAI
`gpt-4o-mini-transcribe` fallback) **always** enqueues the Gardener inbox with
`source: voice`. It never opens or appends to a worker Codex thread directly.

## Context

Gardener is the operator orchestrator; worker Codex executes routed work.
Voice is high-bandwidth, ambiguous input — it needs triage before execution.

## Consequences

- TUI mic and smoke demo share `transcribeAndEnqueueGardenerVoice()`.
- Missing STT keys hard-fail; no silent local fallback.
- Gardener routes to worker after operator review (`enter` / `a` in TUI).
