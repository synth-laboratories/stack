# Stack telemetry and privacy

Stack is a local coding-agent cockpit. Telemetry must be boring, explicit, and
privacy-preserving.

## Default posture

Local Stack usage should work without Synth sign-in and without outbound local
product telemetry.

```text
Local ready · Synth sign-in optional
Telemetry: off by default for public local usage
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
  - sends local lifecycle events only when telemetry is enabled

TypeScript / TUI:
  - renders telemetry state
  - lets the operator inspect/change settings
  - does not construct outbound telemetry payloads directly

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
POST /telemetry/events
```

Validate the Rust/server route and TypeScript client shape:

```bash
make smoke-stackd-telemetry
```

`GET /telemetry/status` is read-only. It reports whether local product telemetry
is enabled, whether an endpoint is configured, the allowlisted event names, and
the forbidden fields.

`POST /telemetry/events` is the server-owned local emission boundary. It only
accepts `owner=stackd`, `class=local_product_opt_in` events from the allowlist,
rejects forbidden or non-allowlisted payload fields, rejects object/array
payload values, and writes to `.stack/telemetry/events.jsonl` only when
`STACK_TELEMETRY=1`. With default settings it validates the event and returns
`emitted=false` without writing.

Allowed local product events, subject to telemetry config:

| Event | Purpose |
| --- | --- |
| `stack_first_launch` | Activation count by version/channel/platform. |
| `stack_doctor_run` | Supportability and common environment failures. |
| `stack_local_demo_started` | First-win funnel. |
| `stack_local_demo_succeeded` | First-win completion. |
| `stack_receipt_created` | Proof that a run produced an auditable result. |
| `stack_meta_thread_created` | Continuity feature adoption. |
| `stack_handoff_sealed` | Handoff creation count by reason enum. |
| `stack_handoff_continued` | Handoff successor creation count. |
| `stack_update_check` | Update Center use and failure modes. |

Payloads should use enums, counts, booleans, version strings, and coarse buckets.
Hash ids before sending. Keep raw ids in local evidence only.

Development proof can isolate the outbox with `STACK_TELEMETRY_OUTBOX=<path>`.
Public outbound delivery/ingestion remains a separate hosted backend gate.
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

- Local product telemetry remains off unless explicitly enabled.
- Public docs/download events may use request-level attribution.
- If pseudonymous duplicate suppression is needed, use short-retention HMACs,
  not raw IP addresses and not unsalted hashes.

## First launch copy

The TUI should show a clear local-first posture:

```text
Local ready · Synth sign-in optional
Telemetry off
```

Hosted-only features ask for login at point of need. Basic local launch, local
demo, doctor, update check, and local receipts must not require login.
