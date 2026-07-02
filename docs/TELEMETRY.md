# Stack telemetry and privacy

Stack is a local coding-agent cockpit. Telemetry must be boring, explicit, and
privacy-preserving.

## Default posture

Local Stack usage works without Synth sign-in. Product telemetry has two local
tiers:

- Basic DAU is on by default and can be turned off.
- Advanced product telemetry is off until the operator accepts it.

```text
Local ready · Synth sign-in optional
Telemetry: basic DAU on · advanced product asks first
```

Authenticated hosted Synth API calls may create backend service events because
they are part of operating the hosted service. Those events should still avoid
prompts, transcripts, source code, file contents, artifact bodies, raw paths,
secrets, environment values, and raw command bodies.

## Ownership boundary

```text
Rust / stackd:
  - reads telemetry config
  - owns event emission
  - owns redaction and allowlisted payloads
  - sends basic DAU events unless turned off
  - sends advanced product events only after approval
  - flushes local outbox rows to the configured backend endpoint

TypeScript / TUI:
  - renders telemetry state
  - lets the operator inspect/change settings
  - asks for advanced approval and calls stackd config routes
  - does not write telemetry config or upload payloads directly

docs/frontend/backend:
  - own public docs/download/signup funnel events
  - send public Stack acquisition events through `/api/v1/growth/funnel-events`
```

## Local event allowlist

Machine-readable contract: [`TELEMETRY_EVENTS.json`](TELEMETRY_EVENTS.json).

Validate the contract:

```bash
make smoke-telemetry-contract
```

stackd exposes the local privacy posture and event allowlist through the server
boundary:

```text
GET /telemetry/status
POST /telemetry/config
POST /telemetry/events
POST /telemetry/flush
```

Validate the Rust/server route and TypeScript client shape:

```bash
make smoke-stackd-telemetry
make smoke-telemetry-approval
```

`GET /telemetry/status` is read-only. It reports whether local product telemetry
is enabled, tier choices, whether an endpoint is configured, the allowlisted
event names, and the forbidden fields.

`POST /telemetry/config` is the only persisted tier-choice boundary. It accepts:

- `basic_dau: "on" | "off"`
- `advanced_product: "unset" | "accepted" | "declined"`
- `asked_version` for first-launch/ask-later prompt suppression

`POST /telemetry/events` is the server-owned local emission boundary. It only
accepts `owner=stackd`, `class=local_basic_dau` or
`class=local_advanced_product` events from the allowlist, rejects forbidden or
non-allowlisted payload fields, rejects object/array payload values, and writes
to `.stack/telemetry/events.jsonl` only when the tier gate permits it.

`POST /telemetry/flush` reads unsent local outbox rows, posts one consolidated
payload to the Stack usage-ingestion endpoint, and appends sent event ids to
`.stack/telemetry/events.sent.jsonl`. By default stackd sends to
`https://api.usesynth.ai/api/v1/product/stack-usage-events`. Override with
`STACK_TELEMETRY_ENDPOINT`, or set `STACK_TELEMETRY_API_BASE_URL` /
`STACK_TELEMETRY_ENVIRONMENT` for staging/dev proof paths.

The Synth backend accepts flushed local usage rows at
`POST /api/v1/product/stack-usage-events`; the Stack funnel rollup reads them at
`GET /api/v1/growth/funnel/stack` and reports `usage_dau.unique_actors`.
Validate that contract with `make smoke-usage-ingestion`.

Allowed local product events, subject to telemetry config:

| Event | Purpose |
| --- | --- |
| `stack_first_launch` | Basic DAU first-launch count by version/channel/platform. |
| `stack_session_started` | Basic DAU session count by version/channel/platform/backend. |
| `stack_first_agent_turn` | Advanced activation moment after approval. |
| `stack_session_ended` | Advanced coarse session-length bucket after approval. |
| `stack_session_heartbeat` | Advanced low-rate foreground session marker after approval. |
| `stack_feature_used` | Advanced allowlisted feature adoption after approval (`goal_mode`, side panels, hosted ops, remote sync, Synth inference, local optimizer, handoff). |
| `stack_doctor_run` | Advanced supportability and common environment failures. |
| `stack_meta_thread_created` | Advanced continuity feature adoption. |
| `stack_handoff_sealed` | Advanced handoff creation count by reason enum. |
| `stack_handoff_continued` | Advanced handoff successor creation count. |
| `stack_optimizer_run_started` | Advanced local optimizer adoption. |

Payloads should use enums, counts, booleans, version strings, and coarse buckets.
Hash ids before sending. Keep raw ids in local evidence only.

Development proof can isolate the outbox with `STACK_TELEMETRY_OUTBOX=<path>`
and the sent cursor with `STACK_TELEMETRY_SENT_CURSOR=<path>`. Configure upload
with `STACK_TELEMETRY_ENDPOINT=<url>` or route by base URL/environment using the
override envs above.
The Nightly 1 payload contract for public acquisition events is documented in
[`GROWTH_INGESTION.md`](GROWTH_INGESTION.md) and validated by
`make smoke-growth-ingestion`.

## Forbidden data

Never send:

```text
prompts
transcripts
source files
artifact bodies
raw file paths
git remotes
secrets
environment values
full command bodies
terminal contents
```

## Identity

Signed in:

- Backend events may associate usage with the authenticated Synth user/org.
- Local Stack should not send raw Clerk ids.
- Hosted service usage events should be tied to backend-authenticated identity.

Signed out:

- Local basic DAU uses a pseudonymous install id from `.stack/config/telemetry.json`.
- Advanced local telemetry remains off unless explicitly accepted.
- Public docs/download events may use request-level attribution.
- If pseudonymous duplicate suppression is needed, use short-retention HMACs,
  not raw IP addresses and not unsalted hashes.

## First launch copy

The TUI should show a clear local-first posture:

```text
Local ready · Synth sign-in optional
Telemetry basic DAU on · advanced asks first
```

Advanced approval copy:

```text
Can we also collect feature usage and session length to improve Stack?
Accept · Decline · Ask later
```

Operators can change choices from `/settings telemetry`. Hosted-only features
ask for login at point of need.

## Client crash reporting

Stack reports fatal TUI/runtime crashes to Synth cloud by default so operator
crashes (for example OpenTUI `Failed to create optimized buffer`) are visible in
prod without opt-in product telemetry.

Flow:

```text
Stack TUI fatal handler
  -> POST stackd /telemetry/crashes
  -> local `.stack/telemetry/crashes.jsonl`
  -> POST {apiBaseUrl}/api/v1/product/stack-crashes
```

Cloud ingest stores:

- `observed_at` from the client
- `recorded_at` server timestamp
- `source_ip` and `source_ip_hash` derived server-side from the outbound request
- coarse metadata only (`goal_mode`, `terminal_rows`, `crash_class`, `surface`, …)

Disable with `STACK_CRASH_REPORT=0`. Override cloud URL with
`STACK_CRASH_REPORT_URL`. Local-only proof path:
`STACK_CRASH_REPORT_OUTBOX=<path>`.

Crash payloads never include prompts, transcripts, raw paths, secrets, or command
bodies. Error messages are path-redacted before upload.

Visibility:

- Local outbox tail: `GET stackd /telemetry/crashes?limit=N`
- Local status: `GET stackd /telemetry/status` → `crash_reporting`
- CLI: `stack crashes [--json] [--remote]`
- MCP: `stack_crash_reports`
- Prod summary/list: `GET /api/v1/product/stack-crashes/summary` and `/stack-crashes` (Bearer)

See `docs/CRASH_INGESTION.md` for operator triage and smokes (`make smoke-stackd-crash-report`, `make smoke-crash-ingestion`).

## Daily operator digest (CLI)

Agents and operators can summarize **local + remote** telemetry for a UTC day:

```bash
# Today (UTC) — local outbox counts + stackd posture
stack telemetry digest

# JSON for scripts / ship evidence
stack telemetry digest --json

# Include prod growth funnel + cloud crash summary (needs SYNTH_API_KEY)
STACK_ENVIRONMENT=prod stack telemetry digest --remote --window-days 1

# Specific date + write evidence under .stack/evidence/telemetry-digest/
stack telemetry digest --date 2026-07-01 --remote --write-evidence --json
```

Flags: `--date YYYY-MM-DD` · `--remote` · `--window-days N` (default 1 for remote rollup) · `--env dev|staging|prod` · `--write-evidence` · `--json`.

The digest reports local product outbox totals plus upload cursor counts:
`pending=<n>` and `sent=<n>`.

Jstack inventory: `Jstack/.jstack/daily_notes/2026-07-01/stack_telemetry_20260701.md`.
