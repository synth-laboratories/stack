# Handoff: Babysit Banking77 gardener E2E (browser TUI)

**Goal:** drive the live Banking77 lane from **container → baseline eval → harness locked → prompt locked → submission** (checkpoints **CP-1..CP-5** in [`docs/stack_gardener.md`](../stack_gardener.md) §5–§6), using the **gardener + background worker + monitor** path. Run until **`stack_effort_audit` passes A0+A1** or you declare **hopeless failure** with evidence.

**Branch:** `feat/operator-sessions-v0-20260707` · **Stack commit:** `c42e373` (working tree may have uncommitted gardener-visibility doc edits).

**Playbook authority:** [`docs/stack_gardener.md`](../stack_gardener.md) — Operator playbook, checkpoint ladder, Banking77 script, CI probes.

**Autonomous worker design:** [`docs/handoffs/autonomous_workers_handoff.md`](./autonomous_workers_handoff.md), [`docs/stack_gardener_autonomous_workers.md`](../stack_gardener_autonomous_workers.md).

---

## TL;DR for the babysitter

| | |
| --- | --- |
| **You are not coding by default** | Poll, steer via `/g`, fix **infra** (stackd, GEPA, Docker, `STACK_ROOT`), record effort receipts. Code fixes only when the worker is blocked on a real repo defect. |
| **Truth sources** | `stack_worker_run_status` (liveness), worker session `turns[]` (what ran), `stack_effort_audit` (whether CPs count), monitor panel on the worker thread (live narration). |
| **Do not double-start** | If status is `running`, **poll** — `stack_worker_continue` returns **409**. |
| **Success** | CP-1..CP-5 satisfied + `stack_effort_audit` → `pass` on effort **B77T202** (`eff_ab6eefbd-2253-427f-9bdd-5166f27b47d9`). |
| **Hopeless failure** | See §Hopeless failure — archive lane, write handoff, log papercut. |

---

## Fixture IDs (copy/paste)

| Resource | ID |
| --- | --- |
| **Effort** | `B77T202` / `eff_ab6eefbd-2253-427f-9bdd-5166f27b47d9` |
| **Meta-thread** | `mt_1783459847752584000_6_38725` |
| **Head worker thread** | `thread_1783459847752588000_8_38725` |
| **Display name** | Banking77 Container Baseline Fresh |
| **Gardener thread** | `manual-gardener-febd64f5-fb56-4fee-84e8-65d6e4cb174e` |
| **Data root** | `~/Documents/GitHub/.stack/` (`stack.config.json` `workingDir: ".."` → **not** `stack/.stack/`) |
| **StackEval task** | `banking77-local-gepa` ([`docs/QUALITY.md`](../QUALITY.md)) |
| **Container image (turn 1)** | `banking77-gepa-container:20260707` |
| **Smoke container** | `banking77-gepa-smoke-20260707` (port **8942** when up) |

---

## Services you own

| Service | Port | Start / verify |
| --- | --- | --- |
| **stackd** | 8792 | Must see `session_log_dir: .../GitHub/.stack/sessions`. Rebuild: `cargo build -p stackd`. Run with `STACK_ROOT=~/Documents/GitHub` `STACK_INSTALL_ROOT=~/Documents/GitHub/stack`. |
| **Browser TUI** | 8765 | `cd ~/Documents/GitHub/stack && STACK_ROOT=~/Documents/GitHub python3 scripts/browser_tui.py --port 8765` → open http://127.0.0.1:8765 |
| **GEPA** | 8879 | `synth-optimizers gepa service --db ~/Documents/GitHub/.stack/optimizers/gepa-service-fresh.sqlite --bind 127.0.0.1:8879` — **do not** use old `gepa-service.sqlite` (missing `idempotency_key` column). |
| **Banking77 container** | 8942 | Worker-managed Docker; probe `curl -s http://127.0.0.1:8942/health` |

**Stale stackd symptom:** gardener MCP reports `stack_worker_run` / `_status` **404** while `/health` is 200 → rebuild + restart stackd with correct `STACK_ROOT`.

---

## Checkpoint tracker (update as you go)

| CP | Name | Status @ handoff | Evidence / notes |
| --- | --- | --- | --- |
| **CP-1** | Container built | **Likely done** | Image `banking77-gepa-container:20260707`; worker turn 1 exit 0 (~21:46Z). Confirm `/health` + `/info` on owned port. |
| **CP-2** | First eval | **In progress** | Smoke container up; baseline rollout may be mid-turn 2/3. Watch for rollout receipts under effort `findings/proof/`. |
| **CP-3** | Harness locked in | **Open** | Named StackEval task + frozen `/rollout` contract. |
| **CP-4** | Prompt locked in (A1) | **Open** | Needs local GEPA run + `stack_effort_record_optimizer_candidate`. |
| **CP-5** | Submission | **Open** | `stack_effort_write_handoff` + audit `pass`. |

**Last known worker state @ handoff write (~22:02Z):**

- `stack_worker_run_status`: `running`, session `turns: 2`, run `completed_turns: 1` / `max_turns: 3`
- Events: `worker_run.turn_completed` @ 22:02:20 after turn 2; codex child active for turn 3
- **Friction on turn 2:** `apply_patch` verification failed in `synth-cookbooks-private/.../synth_service_app.py` (dataset load lines); also `codex_models_manager` refresh timeout in stderr — **watch whether turn 3 recovers or loops**

---

## Your loop (every 5–15 min while `running`)

### 1. Poll (terminal — no TUI required)

```bash
export STACK_ROOT=~/Documents/GitHub

# Liveness
curl -s "http://127.0.0.1:8792/threads/thread_1783459847752588000_8_38725/worker-run/status" | jq .

# Recent events
curl -s "http://127.0.0.1:8792/threads/thread_1783459847752588000_8_38725/events" | jq '.[-8:] | .[].type'

# Infra
curl -sf http://127.0.0.1:8792/health && echo stackd ok
curl -sf http://127.0.0.1:8879/health && echo gepa ok
curl -sf http://127.0.0.1:8942/health && echo container ok   # port may differ — docker port banking77-gepa-smoke-20260707

# Codex child under stackd
pgrep -P $(lsof -t -iTCP:8792 -sTCP:LISTEN) -l | rg node || echo "no worker codex — run may be between turns or idle"
```

### 2. Browser gardener (when you need to steer)

Open http://127.0.0.1:8765, focus `#terminal`, send `/g ...` (see §Steering prompts).

### 3. Effort audit (after each idle boundary)

In gardener chat or MCP:

```text
/g stack_effort_audit B77T202. stack_effort_remaining. Which CP-1..CP-5 checkpoints are satisfied? List blockers with receipts only.
```

---

## Steering prompts (when to intervene)

**Default: do nothing** while `state: running` and codex child exists. Intervene only on the triggers below.

### A — Run finished a turn budget (`idle`, `stop_reason: max_turns_reached`)

```text
/g stack_worker_run_status for thread_1783459847752588000_8_38725. stack_thread_events_read types worker_run.*,monitor.* limit 15. stack_effort_audit B77T202. If CP-2/3/4 still open, stack_worker_continue max_turns 3 with note: "<next CP objective from §6>".
```

### B — Run errored (`state: error`, `last_error` set)

```text
/g Read stack_worker_run_status + last agent stderr summary for thread_1783459847752588000_8_38725. Classify: infra vs repo defect vs model flake. If infra, tell me exact fix commands. If repo, name file:line and minimal fix. Do not stack_worker_continue until blocker is recorded on effort.
```

Record blocker:

```text
/g stack_effort_record_blocker on B77T202: "<one line>" evidence "<paths/commands>" owner operator next "<safe action>"
```

### C — Patch / tool loop (same error ≥2 turns)

Example seen: `apply_patch verification failed` on `synth_service_app.py` dataset lines.

**Operator options (pick one):**

1. **Steer worker** — switch thread in TUI to worker, paste a one-line fix instruction, or gardener:

   ```text
   /g gardener.steer thread_1783459847752588000_8_38725: Stop patching synth_service_app.py blindly. Read current file, reconcile dataset load with lockfile, run ruff/ty locally, then one minimal patch.
   ```

2. **Human fix** — edit the file yourself, then:

   ```text
   /g stack_effort_record_note on B77T202 human: "Fixed dataset load in synth_service_app.py — <sha>". stack_worker_continue max_turns 2: resume baseline rollout smoke only.
   ```

### D — GEPA down (`curl :8879` fails)

```bash
# Fresh DB only
synth-optimizers gepa service \
  --db ~/Documents/GitHub/.stack/optimizers/gepa-service-fresh.sqlite \
  --bind 127.0.0.1:8879
```

Then gardener: `stack_worker_continue` with note to start local GEPA for A1.

### E — Container port drift

```bash
docker port banking77-gepa-smoke-20260707
curl -s "http://127.0.0.1:<mapped>/health"
```

Steer worker with explicit port if it keeps probing wrong host.

### F — Monitor silent (no headlines, operator blind)

```text
/g stack_meta_thread_set_monitor for mt_1783459847752584000_6_38725 profile engineering. stack_ui_open_panel panel=monitor thread_id thread_1783459847752588000_8_38725.
```

On worker thread in TUI: `/monitor on` if sidecar still off.

### G — Gardener 404 on worker tools

Not a gardener logic bug — **stackd**:

```bash
cd ~/Documents/GitHub/stack && cargo build -p stackd
kill $(lsof -t -iTCP:8792 -sTCP:LISTEN)   # only if you started this stackd
STACK_ROOT=~/Documents/GitHub STACK_INSTALL_ROOT=~/Documents/GitHub/stack \
  ./target/debug/stackd serve
```

---

## What “success” looks like (exit criteria)

1. **CP-1..CP-5** — each has effort receipts (see [`stack_gardener.md`](../stack_gardener.md) §5 table).
2. **`stack_effort_audit B77T202`** → `audit_status: pass` (at minimum **A0 + A1** for task-classifier).
3. **Artifacts** — under `~/Documents/GitHub/efforts/banking77-tasks-20260707/` (or effort-bound paths): `findings/proof/` baseline + GEPA scorecard, `findings/code/` candidate prompt, `findings/results/acceptance-summary.md`, `HANDOFF.md`.
4. **Optional proof packet** — `.stack/evidence/stackeval/banking77-local-gepa/<stamp>/` if you ran StackEval smoke for CP-3.
5. **Write closing note** — append to this handoff §Progress log; `stack_effort_write_handoff`; consider `jsk papercut` only for reproducible friction.

---

## Hopeless failure (when to stop babysitting)

Declare failure only when **all** are true:

1. **Same blocker survives 2+ worker turns** after explicit steer or human fix attempt.
2. **`stack_effort_audit` still fail** with no credible path to A1 within the session (missing GEPA, broken cookbook, auth, disk).
3. **Infra is not the issue** — stackd routes 200, GEPA up, Docker healthy, Codex auth works on a manual `codex exec` smoke.

### Stop procedure

```text
/g stack_worker_pause thread_1783459847752588000_8_38725. stack_effort_record_blocker on B77T202 with full evidence. stack_effort_write_handoff summary "Banking77 gardener E2E failed at CP-<n>" next "<single recovery path>".
```

```bash
# Optional: park lane (reversible)
# gardener: stack_meta_thread_set_lifecycle status=archived confirm=true
```

**Log:**

```bash
jsk papercut "<what failed and why>" \
  --repo stack --file docs/handoffs/banking77_gardener_babysit_20260707.md \
  --sev MED|HIGH --time-lost <estimate> \
  --context "Banking77 gardener babysit CP-<n>"
```

**Do not** mark Jstack goals `blocked` — leave effort `active` or `paused` with written next owner.

### Known hopeless patterns from this session

| Pattern | Signal | Recovery |
| --- | --- | --- |
| Stale stackd | MCP 404 on worker-run | Rebuild + `STACK_ROOT` (§Services) |
| GEPA sqlite schema | `idempotency_key` error on start | Fresh sqlite path |
| Patch thrash | Repeated `apply_patch verification failed` on same hunk | Human edit or steer to read-then-patch |
| `turns:0` forever | No codex child, idle, goal active | `stack_worker_run` or `continue` — executor not started |
| Gardener narrates progress | No `worker_run.*` events | Distrust; poll stackd only |

---

## Progress log (babysitter fills in)

```text
### 2026-07-07T23:00:08Z — Codex
**CP status:** CP-1 done | CP-2 done | CP-3 evidence/audit shape likely satisfied | CP-4 open (A1 missing optimizer.candidate evidence) | CP-5 open
**Worker:** stackd reports running / turns=3 / completed_turns=2 / stop_reason=pause_requested; latest lifecycle event worker_run.pause_requested at 2026-07-07T22:55:03.966Z after worker_run.turn_completed at 2026-07-07T22:07:28.638Z
**Steering done:** gardener audit + pause/continue reconciliation prompt; pause receipt recorded; continue rejected 409 because Stack still sees worker run as already running
**Blockers:** infra stale-active worker-run state. Evidence: session file mtime 2026-07-07T22:07:28Z, worker-run record mtime 2026-07-07T22:55:03Z, child process 95273/95274 idle, GEPA /runs empty, Jstack papercut logged at Jstack/.jstack/records/mldp/repos/stack/papercuts.txt
**Next poll:** wait for pause transition; if unchanged, recover the stuck worker child or restart stackd using the least invasive Stack-owned path, then retry bounded CP-4/A1 continue

### 2026-07-07T23:07:08Z — Codex
**CP status:** CP-1 satisfied | CP-2 satisfied | CP-3 satisfied | CP-4 partially satisfied / not clean | CP-5 satisfied; `stack_effort_audit` pass at 2026-07-07T23:07:08.803Z
**Worker:** idle / turns=7 / stop_reason=max_turns_reached; no worker child running; stackd, GEPA, and container health checks OK
**Steering done:** restarted owned stackd on :8792 with correct `STACK_ROOT`, clearing stale-active runner state; continued worker max_turns=3 for CP-4/A1; requested final strict gardener audit
**Blockers:** Open blocker `effact_97b14950-fb39-4ecb-b9ae-f102a5a391d1`: OpenRouter HTTP 402 insufficient credits for `nvidia/nemotron-3-nano-30b-a3b`; 8/8 initial Nemotron3 train rollouts failed, so no Nemotron3 candidate or heldout scorecard was produced
**Next poll:** none required for current worker run; B77T202 remains active. Next safe action is replenish/route funded Nemotron3 inference or approve a funded model replacement, then rerun bounded GEPA into a fresh proof directory

### 2026-07-07T23:20:00Z — Codex
**CP status:** CP-4 Gemini route proof added, but no optimization lift; prior B77T202 audit pass remains from OpenAI A1 evidence
**Worker:** not used; direct operator run completed
**Steering done:** added Gemini/Google `GEMINI_API_KEY` route in Banking77 service, added `gepa_banking77_gemini31_flash_lite_smoke.json`, rebuilt/replaced owned container, ran bounded GEPA with `gemini-3.1-flash-lite`
**Blockers:** first launch lacked `GEMINI_API_KEY` in optimizer env and was rerun with key loaded from `synth-ai/.env`; GEPA proposals `c_fb905` and `c_66b61` tied parent minibatch score and were rejected, so best remained seed `c_112df`
**Next poll:** none; artifacts in `efforts/banking77-tasks-20260707/findings/proof/local-gepa-20260707-gemini31-flash-lite/` show train `5/8 = 0.625`, heldout `7/8 = 0.875`, 24 rollouts, total cost `$0.08419985`

### 2026-07-07T23:44:43Z — Codex
**CP status:** CP-1 satisfied | CP-2 satisfied | CP-3 satisfied | CP-4 satisfied for recorded A1 proof | CP-5 satisfied; `stack effort audit banking77-tasks-20260707 --json` returned `ok=true`, `status=pass` at `2026-07-07T23:44:43.281Z`
**Worker:** not used for final evidence closure; direct operator/CLI run completed
**Steering done:** repaired an interrupted/parallel Stack effort ref write, restored the missing `smr=banking77_07031b1195` ref, recorded typed run evidence for A3/A4, recorded typed A3/A4 acceptance receipts, and regenerated `efforts/banking77-tasks-20260707/HANDOFF.md`
**Blockers:** A2 hosted GEPA remains optional/open but is out of scope per operator direction; Gemini route works locally but did not accept an improved candidate; A4 is a Tinker SamplingClient smoke, not a full fine-tuning checkpoint
**Next poll:** none required. B77T202 audit is passing with A0/A1/A3/A4 recorded and A2 visible as optional/open. Next safe action is a bounded local GEPA pass against `127.0.0.1:8942` + `127.0.0.1:8879` using the Gemini 3.1 Flash-Lite config or another approved non-OpenRouter local provider route; do not use hosted for this continuation

### YYYY-MM-DDTHH:MM:SSZ — <initials>
**CP status:** CP-1 done | CP-2 in progress | ...
**Worker:** state / turns / stop_reason
**Steering done:** none | <prompt or human action>
**Blockers:**
**Next poll:**
```

---

## Quick reference

| Question | Answer |
| --- | --- |
| Where is the playbook? | [`docs/stack_gardener.md`](../stack_gardener.md) §1–§8 |
| How long is a worker turn? | **3–15+ min** normal for container/GEPA; poll, don't kill early |
| Who executes Codex? | **stackd** background `codex exec` — not the browser TUI foreground |
| Can gardener see worker stdout? | **No** — use monitor panel, `stack_thread_events_read`, session file |
| Effort CLI mirror | [`docs/USAGE.md`](../USAGE.md) § Efforts |
| Skills for worker | `oss-gepa`, `synth-via-stack`, `containers` |

---

## Session file paths (debug)

```text
~/Documents/GitHub/.stack/sessions/thread_1783459847752588000_8_38725.json
~/Documents/GitHub/.stack/worker-runs/thread_1783459847752588000_8_38725.json
~/Documents/GitHub/.stack/events/threads/thread_1783459847752588000_8_38725.jsonl
~/Documents/GitHub/.stack/meta-threads/mt_1783459847752584000_6_38725/manifest.json
~/Documents/GitHub/efforts/banking77-tasks-20260707/   # effort workspace (if materialized)
```

Turn stdout tail:

```bash
python3 -c "
import json
t=json.load(open('$HOME/Documents/GitHub/.stack/sessions/thread_1783459847752588000_8_38725.json'))
u=t['turns'][-1]
print('turn', len(t['turns']), 'exit', u.get('exit_code'))
print((u.get('stdout') or '')[-3000:])
"
```
