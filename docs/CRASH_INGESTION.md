# Stack Crash Ingestion

Stack reports fatal TUI/runtime crashes to Synth cloud by default so operator
crashes (for example OpenTUI `Failed to create optimized buffer`) are visible
without opt-in product telemetry.

## Pipeline

```text
Stack TUI fatal handler
  -> POST stackd /telemetry/crashes
  -> local `.stack/telemetry/crashes.jsonl`
  -> POST {apiBaseUrl}/api/v1/product/stack-crashes
  -> Postgres `stack_client_crashes`
```

Cloud ingest stores:

- `observed_at` from the client
- `recorded_at` server timestamp
- `source_ip` and `source_ip_hash` derived server-side from the outbound request
- coarse metadata only (`goal_mode`, `terminal_rows`, `crash_class`, `surface`, …)

Crash payloads never include prompts, transcripts, raw paths, secrets, or command
bodies. Error messages are path-redacted before upload.

## Visibility

| Surface | Local | Prod |
| --- | --- | --- |
| Outbox tail | `GET stackd /telemetry/crashes?limit=N` | n/a |
| Status | `GET stackd /telemetry/status` → `crash_reporting` | n/a |
| CLI | `stack crashes [--json] [--remote]` | `--remote` uses Synth auth |
| MCP | `stack_crash_reports` | remote summary when auth present |
| Doctor | `stack doctor` → `crash-reporting` check | warns when cloud endpoint unset |
| Cloud summary | n/a | `GET /api/v1/product/stack-crashes/summary` (Bearer) |
| Cloud list | n/a | `GET /api/v1/product/stack-crashes` (Bearer) |

Prod query routes require a valid Synth API key. Ingest `POST` remains open to
clients (like growth funnel ingest) and deduplicates on `client_event_id`.

## Controls

Disable reporting with `STACK_CRASH_REPORT=0`.

Override cloud URL with `STACK_CRASH_REPORT_URL`.

Local-only proof path: `STACK_CRASH_REPORT_OUTBOX=<path>`.

## Smokes

Local stackd outbox + redaction:

```bash
make smoke-stackd-crash-report
```

Contract + optional live backend proof:

```bash
make smoke-crash-ingestion
bun run smoke:crash-ingestion -- --live-url https://staging-api.usesynth.ai
```

Live prod POST is guarded the same way as growth ingestion; do not pass
`--allow-prod-post` until the candidate is approved.

## Operator triage

1. Reproduce or inspect local outbox: `stack crashes --json`
2. Check prod volume by class: `stack crashes --remote --window-days 7`
3. Filter prod rows: `GET /api/v1/product/stack-crashes?crash_class=opentui_buffer`
4. Correlate with Bombadil/TUI smokes using `testing/stack/scripts/tui_crash_guard.ts`
