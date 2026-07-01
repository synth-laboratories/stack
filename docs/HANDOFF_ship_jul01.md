# Ship Handoff — 2026-07-01

**All remaining work (operator + deploy + post-ship):** `Jstack/.jstack/daily_notes/2026-07-01/HANDOFF_remaining_work_jul01.md`

**Blog:** decoupled from this release — ships with the next release (see remaining-work handoff § P4).

**Audience:** engineer wrapping and shipping the current Stack + backend slice.
**Scope:** sidecar monitor check-ins, goal-shutter crash fix + Bombadil, client crash reporting + prod/local visibility.

---

## 0. TL;DR

Three independent threads landed in one dirty tree:

| Thread | User-visible outcome | Ship blocker? |
| --- | --- | --- |
| **Monitor check-in** | Sidecar events show `· no change · reviewed N events` on quiet monitor passes instead of looking dead | No — stack-only |
| **Goal shutter fix** | Fixes `Failed to create optimized buffer: 178x15` in `/goal` Sidecar events panel | No — stack + testing smokes |
| **Crash reporting** | Fatal TUI crashes → stackd → cloud Postgres with IP hash, metadata, timestamps; operator can query local + prod | **Yes — backend migration required before prod ingest/query works** |

**Before you merge/promote:** run the validation block below, apply backend migrations on target env, rebuild and **restart** `stackd` (see §10).

### Validation proof (2026-07-01 debug session)

| Check | Result |
| --- | --- |
| `bunx tsc --noEmit` | Pass |
| `cargo build -p stackd` | Pass |
| `make smoke-stackd-crash-report` | Pass |
| `make smoke-crash-ingestion` | Pass |
| `make smoke-stackd-telemetry` | Pass |
| `smoke_monitor_logic` (47 checks) | Pass |
| `smoke_sidecar_render` (23 checks) | Pass |
| `smoke_tui_goal_shutter.expect` | Pass (~22s) |
| `smoke_bombadil_goal_shutter.ts` | Pass |
| **Full Bombadil B0** (4 scenarios, 600s timeout) | **Pass (~54s)** — `stack_bombadil_b0_ok` |
| `stack crashes` against live `:8792` stackd | **Fails** — stale binary (see §10) |
| Fresh stackd on test port + `STACK_ROOT=stack` | Pass |
| Staging/prod live crash POST | **Not run** |
| Backend alembic on staging/prod | **Not run** |

---

## 1. Monitor check-in (`monitor.checkin`)

**Problem:** Monitor was waking and doing real work but Sidecar events looked empty — quiet passes only wrote internal `monitor.summary` with `NO_USER_UPDATE`.

**Fix:** After each monitor pass with no human feed row, emit `monitor.checkin` with `no change · reviewed N events`.

| Area | Files |
| --- | --- |
| Emission | `src/monitor.ts` |
| Feed render | `src/tui/monitor-thread.ts` |
| Prompt guard | `src/monitor-sidecar-codex.ts` (LLM must not narrate "no update") |
| Spec | `docs/HANDOFF_sidecar_monitor.md` §2.3 |
| Smokes | `testing/stack/smoke/smoke_monitor_logic.ts`, `smoke_sidecar_render.ts` |

**Validate:**

```bash
cd ~/Documents/GitHub/stack
bunx tsc --noEmit
cd ~/Documents/GitHub/testing/stack
bun run smoke:monitor:logic
bun run smoke:sidecar:render
```

---

## 2. Goal shutter OpenTUI buffer crash

**Problem:** `Error: Failed to create optimized buffer: 178x15` in goal mode on Sidecar events (`progress` tab). Sidecar events rendered in a tight flex slot without subtracting goal-progress chrome from stream budget.

**Fix:** Wrap Sidecar events in `anchorTranscriptBox`; subtract `progressChromeRows` (~4) from visible row budget in `goal-shutter.ts` and scroll tail in `app.ts`.

| Area | Files |
| --- | --- |
| Fix | `src/tui/goal-shutter.ts`, `src/tui/app.ts` |
| Crash SSOT | `src/telemetry/crash-artifacts.ts` (shared with smokes + crash reporter) |
| Bombadil | `testing/stack/scripts/smoke_tui_goal_shutter.expect`, `fake_codex_goal_shutter.ts`, `smoke_bombadil_goal_shutter.ts`, B0 server wiring |
| Crash guard | `testing/stack/scripts/tui_crash_guard.ts` (re-exports crash-artifacts) |

**Validate:**

```bash
cd ~/Documents/GitHub/testing/stack
STACK_REPO_ROOT=~/Documents/GitHub/stack expect scripts/smoke_tui_goal_shutter.expect
# fast gate (~25s):
STACK_REPO_ROOT=~/Documents/GitHub/stack bun run scripts/smoke_bombadil_goal_shutter.ts
# full B0 (4 scenarios, needs ~600s timeout):
STACK_BOMBADIL_B0_TIMEOUT_MS=600000 STACK_REPO_ROOT=~/Documents/GitHub/stack bun run scripts/smoke_bombadil_tui_b0.ts
```

**Proof (2026-07-01):** `smoke_tui_goal_shutter.expect` passed in ~22s. Full B0 passed in ~54s with `STACK_BOMBADIL_B0_TIMEOUT_MS=600000` (native `bombadil` binary still exits 1 — smoke runner warns but server proof passes).

---

## 3. Crash reporting + visibility

**On by default** (unlike opt-in product telemetry). Disable with `STACK_CRASH_REPORT=0`.

### Pipeline

```text
Stack TUI fatal (uncaughtException / unhandledRejection)
  → reportStackCrash()                    src/telemetry/crash-report.ts
  → POST stackd /telemetry/crashes
  → .stack/telemetry/crashes.jsonl
  → POST {apiBaseUrl}/api/v1/product/stack-crashes
  → Postgres stack_client_crashes
```

Cloud stores `observed_at`, server `recorded_at`, server-derived `source_ip` + `source_ip_hash`, coarse metadata only. Client never sends raw IP, paths, prompts, or secrets.

### Stack (client + stackd)

| Piece | Path |
| --- | --- |
| Fatal hook | `src/tui/terminal-cleanup.ts` |
| Runtime context | `src/tui/app.ts` (`setCrashRuntimeContext` each render) |
| Reporter | `src/telemetry/crash-report.ts`, `crash-artifacts.ts` |
| stackd ingest + forward | `crates/stackd/src/handlers/telemetry.rs` |
| stackd list local | `GET /telemetry/crashes?limit=N` |
| stackd status | `GET /telemetry/status` → `crash_reporting` block |
| TS client | `src/client/stackd.ts` |
| CLI | `stack crashes [--json] [--remote]` → `src/crash-reports.ts` (stale-stackd detection + local outbox fallback) |
| Doctor | `src/doctor.ts` → `crash-reporting` check (actionable stale-stackd hint) |
| MCP | `stack_crash_reports` tool; `stack_status` includes `crash_reporting` |

### Backend (must deploy)

| Piece | Path |
| --- | --- |
| Model | `backend/core/data/db/models/product.py` → `StackClientCrash` |
| Migrations | `20260701_add_stack_client_crashes.py`, `20260701_stack_client_crashes_dedup.py` |
| Ingest | `POST /api/v1/product/stack-crashes` (dedup on `client_event_id`) |
| Query (Bearer) | `GET /api/v1/product/stack-crashes/summary`, `GET /api/v1/product/stack-crashes` |
| Router | `backend/app/api/v1/routes_product.py`, mounted in `app/api/app.py` |

**Deploy backend before expecting prod crashes:**

```bash
cd ~/Documents/GitHub/backend
alembic upgrade head
# verify routes on target env:
curl -s https://<api>/api/v1/product/stack-crashes/ready
```

**Validate stack side:**

```bash
cd ~/Documents/GitHub/stack
cargo build -p stackd
bunx tsc --noEmit
make smoke-stackd-crash-report
make smoke-crash-ingestion
make smoke-stackd-telemetry
stack crashes --json
stack doctor --json   # look for crash-reporting check
```

**Optional live backend proof:**

```bash
cd ~/Documents/GitHub/stack
bun run smoke:crash-ingestion -- --live-url https://staging-api.usesynth.ai
# prod only with explicit guard:
bun run smoke:crash-ingestion -- --live-url https://api.usesynth.ai --allow-prod-post
```

### Docs

- `docs/CRASH_INGESTION.md` — operator runbook
- `docs/TELEMETRY.md` — crash section + visibility
- `docs/USAGE.md` — routes + `stack crashes`
- `CHANGELOG.md` — unreleased entry added

### Env knobs

| Var | Purpose |
| --- | --- |
| `STACK_CRASH_REPORT=0` | Disable reporting |
| `STACK_CRASH_REPORT_URL` | Override cloud ingest URL |
| `STACK_CRASH_REPORT_OUTBOX` | Local JSONL path (smokes use this) |
| `SYNTH_API_KEY` | Bearer for cloud forward + remote query |

---

## 4. Repos / dirty tree warning

### Stack (`~/Documents/GitHub/stack`)

All changes above plus **other in-flight work** in the same tree (gardener lifecycle, meta-thread title MCP, remount coordinator, threads rail, etc.). **Review diff before commit** — do not blindly commit entire `git status`.

Suggested commit split (4 PRs or 4 commits):

1. `monitor.checkin` — monitor + sidecar render + spec + smokes
2. `goal-shutter buffer fix` — goal-shutter + app scroll + testing bombadil/expect
3. `crash reporting ingest` — telemetry/*, stackd, terminal-cleanup, client, backend model/routes/migrations
4. `crash visibility` — doctor, MCP, CLI, docs, Makefile/package.json smokes, launch_readiness

### Backend (`~/Documents/GitHub/backend`)

**Only ship crash-related files** unless you intend a broader backend release:

- `app/api/v1/routes_product.py` (new)
- `app/api/app.py` (router mount)
- `core/data/db/models/product.py` (new)
- `core/data/db/models/__init__.py` (`StackClientCrash` import)
- `alembic/versions/20260701_add_stack_client_crashes.py`
- `alembic/versions/20260701_stack_client_crashes_dedup.py`

Backend tree has **many unrelated dirty files** — do not commit wholesale.

### Testing (`~/Documents/GitHub/testing`)

- New: `smoke_stackd_crash_report.ts`, `smoke_stack_crash_ingestion.ts`, `smoke_tui_goal_shutter.expect`, `fake_codex_goal_shutter.ts`, `smoke_bombadil_goal_shutter.ts`
- Modified: `tui_crash_guard.ts`, `tui_smoke_common.tcl`, bombadil B0 scripts, monitor smokes, `smoke_stackd_telemetry.ts` (STACK_REPO_ROOT fix + crash_reporting check)

---

## 5. Launch readiness / release gates

`scripts/launch_readiness.ts` now tracks crash reporting when:

- `smoke:stackd:crash-report` and `smoke:crash-ingestion` exist in stack `package.json`
- `docs/CRASH_INGESTION.md` exists
- Evidence under `.stack/evidence/stackd-crash-report/latest.json` and `crash-ingestion/latest.json` show `ok: true`

Run after smokes:

```bash
cd ~/Documents/GitHub/stack
make smoke-stackd-crash-report smoke-crash-ingestion
bun run launch:readiness --write-evidence
```

S7 gate text updated to mention crash ingest/query — still **partial** until staging/prod live POST proof.

---

## 6. Known gaps / not done

| Item | Notes |
| --- | --- |
| Prod migration applied | Migrations exist in repo; deploy status unknown |
| Prod live crash POST proof | Contract smoke passes locally; staging/prod `--live-url` not run |
| **Stale stackd on :8792** | PID 32576, cwd `~/Documents/GitHub` (not stack repo). Old binary: status **500**, `/telemetry/crashes` **404**. Restart per §10. |
| Native bombadil property invariants | B0 expect scenarios pass via HTTP server; native binary can't load TS spec (exits 1) |
| Native SIGSEGV / abrupt exit | Only `uncaughtException` / `unhandledRejection` hooked — segfaults may bypass reporter |
| Dashboard / Datadog | No o11y export wired; query via API/MCP/CLI only |
| Unrelated dirty files | Gardener, meta-thread MCP, backend SMR/runtime — separate ship decisions |

---

## 7. Operator triage cheat sheet (post-deploy)

```bash
# Local recent crashes
stack crashes --json

# Prod summary (needs SYNTH_API_KEY)
stack crashes --remote --window-days 7

# MCP (from Codex agent pane)
stack_crash_reports

# Filter prod by class (Bearer)
curl -H "Authorization: Bearer $SYNTH_API_KEY" \
  "https://api.usesynth.ai/api/v1/product/stack-crashes?crash_class=opentui_buffer&limit=20"
```

---

## 8. Quick validation script (copy-paste)

```bash
set -e
STACK=~/Documents/GitHub/stack
TEST=~/Documents/GitHub/testing/stack
export STACK_REPO_ROOT="$STACK"

cd "$STACK"
bunx tsc --noEmit
cargo build -p stackd
make smoke-stackd-crash-report smoke-crash-ingestion smoke-stackd-telemetry

cd "$TEST"
bun run smoke:monitor:logic
bun run smoke:sidecar:render
STACK_REPO_ROOT="$STACK" expect scripts/smoke_tui_goal_shutter.expect
STACK_BOMBADIL_B0_TIMEOUT_MS=600000 STACK_REPO_ROOT="$STACK" bun run scripts/smoke_bombadil_tui_b0.ts

echo "ship_handoff_validation_ok"
```

---

## 9. Ship owner checklist (do in order)

This is the minimum path from “code landed locally” to “operators can see crashes in prod.”

### Step 1 — Rebuild stackd (already done on dev machine)

```bash
cd ~/Documents/GitHub/stack
cargo build -p stackd
```

### Step 2 — Restart stackd with correct `STACK_ROOT`

**Problem today:** stackd on `127.0.0.1:8792` is an old binary with `cwd=~/Documents/GitHub`. It cannot find `docs/TELEMETRY_EVENTS.json` and lacks `GET /telemetry/crashes`.

**Only restart if you own this process** (shared machine — confirm no one else depends on PID 32576).

```bash
# verify what's running
lsof -i :8792
ps eww -p <pid> | tr ' ' '\n' | rg '^STACK_'

# stop owned stackd
kill <pid>   # or kill the Stack TUI session that autostarted it

# start fresh (from stack checkout)
cd ~/Documents/GitHub/stack
STACK_ROOT="$PWD" ./target/debug/stackd serve --port 8792 &

# verify
curl -s http://127.0.0.1:8792/telemetry/status | python3 -m json.tool | rg crash_reporting -A6
curl -s "http://127.0.0.1:8792/telemetry/crashes?limit=1"
./bin/stack crashes --json
./bin/stack doctor --json | python3 -m json.tool | rg crash -A3
```

Expected after restart: status **200**, `crash_reporting.enabled: true`, outbox path under `stack/.stack/telemetry/crashes.jsonl`.

### Step 3 — Backend migrations (staging first, then prod)

```bash
cd ~/Documents/GitHub/backend
# point DATABASE_URL at staging, then:
alembic upgrade head

# verify ready endpoint on target env
curl -s https://staging-api.usesynth.ai/api/v1/product/stack-crashes/ready
```

Migrations to apply (in order):

1. `alembic/versions/20260701_add_stack_client_crashes.py`
2. `alembic/versions/20260701_stack_client_crashes_dedup.py`

### Step 4 — Staging live ingest proof

```bash
cd ~/Documents/GitHub/stack
export SYNTH_API_KEY="$(awk -F= '/^SYNTH_API_KEY=/{print $2; exit}' ~/Documents/GitHub/synth-ai/.env)"
bun run smoke:crash-ingestion -- --live-url https://staging-api.usesynth.ai
```

Evidence lands under `.stack/evidence/crash-ingestion/<stamp>/`.

### Step 5 — Prod (after staging green)

```bash
# migrate prod DB (same alembic upgrade head with prod DATABASE_URL)
bun run smoke:crash-ingestion -- --live-url https://api.usesynth.ai --allow-prod-post
stack crashes --remote --window-days 7
```

### Step 6 — Commit / PR split

Do **not** commit entire dirty trees. Split per §4:

1. Monitor check-in
2. Goal shutter + Bombadil smokes
3. Crash reporting ingest (stack + stackd + backend)
4. Crash visibility (CLI, doctor, MCP, docs, Makefile)

### Step 7 — Launch readiness evidence

```bash
cd ~/Documents/GitHub/stack
make smoke-stackd-crash-report smoke-crash-ingestion
bun run launch:readiness --write-evidence
```

---

## 10. Contacts / references

- Sidecar monitor spec: `docs/HANDOFF_sidecar_monitor.md`
- Crash runbook: `docs/CRASH_INGESTION.md`
- Growth ingest pattern (parallel): `docs/GROWTH_INGESTION.md`
- Release checklist: `docs/RELEASE.md`

**Questions for ship owner:** (1) Split PRs or one nightly? (2) Full Bombadil B0 is green — good for dogfood gate. (3) Who owns restart of `:8792` stackd on shared dev machine?
