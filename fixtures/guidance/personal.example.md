# Personal coding style

Operator-local preferences. Stack indexes this file from `~/.stack/guidance/style/`.

JSTACK_HEATMAP|ts=2026-06-29T01:30:00Z|repo=stack|kind=learning|file=fixtures/guidance/personal.example.md|commit=pending|severity=LOW|time_lost=unknown

## Defaults

- Prefer small diffs; say no to drive-by cleanup.
- Run named SDLC wrappers (`./scripts/ci.sh ruff-ty`) — not ad-hoc test sweeps.
- When blocked, log papercuts immediately (`jsk papercut` or Gardener friction mirror).

## Voice / orchestration

- Voice goes to **Gardener only** — never direct to worker Codex.
- Review Gardener inbox before routing destructive work.

## Providers

- STT: Groq primary, OpenAI fallback.
- Codex ChatGPT sub for worker; Synth API for hosted ops.
