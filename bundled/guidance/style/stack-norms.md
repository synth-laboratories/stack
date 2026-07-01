# Stack norms

Stack is the operator control plane for Synth work. Prefer Stack MCP and
backend-owner routes over direct storage access.

STACK_MEMORY|ts=2026-06-28T23:10:00Z|kind=learning|file=.stack/guidance/style/stack-norms.md|severity=LOW|source=legacy

## Boundaries

- Use Stack MCP for live SMR, Factory, hosted optimizer, local optimizer, and
  eval-harness operator work.
- Do not use `git stash` to preserve work. Use explicit commits, patch files,
  worktrees, or another operator-approved path.
- Do not run destructive git cleanup such as `git reset --hard` unless the
  operator explicitly requested that exact operation.
- Keep requested implementation scope tight; do not perform opportunistic or
  unrelated cleanup while landing a feature/refactor.
- Do not recover by scraping Postgres, Redis, compatibility projections, or old
  persistence substrates across service boundaries.
- Preview remote outputs before downloading when inspection is enough.
- Do not print raw secrets; report only whether auth is present and where Stack
  expects to load it.

## Operator loop

1. Start with `stack_status` and choose `local`, `remote`, or `all`.
2. Load the relevant Stack skill before acting.
3. Search guidance for known friction ids before re-diagnosing a repeated issue.
4. Record useful skill/guidance reads with a `thread_id` so eval-harness packets can
   prove the harness had the right context.
