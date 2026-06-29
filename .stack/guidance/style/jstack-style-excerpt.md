# Jstack style excerpt

STACK_MEMORY|ts=2026-06-29T04:25:00Z|repo=stack|kind=learning|file=.stack/guidance/style/jstack-style-excerpt.md|commit=pending|severity=LOW|time_lost=unknown

Curated Stack-owned excerpt from Jstack style and standards for monitor
visibility. Stack does not index raw `Jstack/.jstack/**`; high-signal Jstack
context must be copied here or under `.stack/guidance/records/**`.

## A Week Coding With Synth

Before touching code, orient by loading recent memory, decisions, papercuts, and
standards. The feedback loop is the work: build a deterministic signal, make the
smallest aligned change, validate the actual claim, and record friction as it is
observed.

## DB Transaction Discipline

DB units do DB I/O only. Keep Redis, HTTP, Temporal, S3, sleeps, and other
external effects outside database transactions. When a downstream projection
must follow a committed row, use an after-commit callback or outbox pattern
rather than performing cross-system writes inside the transaction.

## Monitor Use

Use this excerpt for style steering and review hints when an agent skips
orientation, repeats a known papercut, broadens scope opportunistically, or
crosses a persistence/authority boundary. For deeper context, the human operator
or a Jstack-aware agent should read the source records directly.
