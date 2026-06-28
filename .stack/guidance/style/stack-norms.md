# Stack norms

Stack is the operator control plane for Synth work. Prefer Stack MCP and
backend-owner routes over direct storage access.

JSTACK_HEATMAP|ts=2026-06-28T23:10:00Z|repo=stack|kind=learning|file=.stack/guidance/style/stack-norms.md|commit=379a3cc|severity=LOW|time_lost=unknown

## Boundaries

- Use Stack MCP for live SMR, Factory, hosted optimizer, local optimizer, and
  StackEval operator work.
- Do not recover by scraping Postgres, Redis, compatibility projections, or old
  persistence substrates across service boundaries.
- Preview remote outputs before downloading when inspection is enough.
- Do not print raw secrets; report only whether auth is present and where Stack
  expects to load it.

## Operator loop

1. Start with `stack_status` and choose `local`, `remote`, or `all`.
2. Load the relevant Stack skill before acting.
3. Search guidance for known friction ids before re-diagnosing a repeated issue.
4. Record useful skill/guidance reads with a `thread_id` so StackEval packets can
   prove the harness had the right context.
