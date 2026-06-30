# Stack quality guide

**Audience:** Stack engineers preparing dev bumps, stable releases, and launch proof.  
**Acceptance SSOT:** [`Jstack/.jstack/product/specs/stack_acceptance.md`](../../Jstack/.jstack/product/specs/stack_acceptance.md)  
**Launch operator SSOT:** [`Jstack/.jstack/product/stack_and_tag_launch.md`](../../Jstack/.jstack/product/stack_and_tag_launch.md)  
**GameBench handoff experiment:** [`Jstack/.jstack/daily_notes/2026-06-29/stack_handoffs_blog_gamebench_experiment_plan.md`](../../Jstack/.jstack/daily_notes/2026-06-29/stack_handoffs_blog_gamebench_experiment_plan.md)

Win = **green smoke or filled proof packet** — not “looks plausible.” Every gate prints `stack_<area>_ok` or exits non-zero and writes evidence under `.stack/evidence/<area>/`.

**P0 product north star:** Stack must be hyper-productive with the **full Synth stack** — OSS (`synth-optimizers`, synth-dev, StackEval) and hosted (`synth-ai`, `usesynth.ai`) from one cockpit. See [`SYNTH_PRODUCTIVITY.md`](./SYNTH_PRODUCTIVITY.md).

---

## Code quality bar

Stack has two implementation layers with different responsibilities:

```text
Rust / stackd: core logic, persistence, state transitions, receipts, auth/update/telemetry boundaries
TypeScript / TUI: rendering, keyboard/mouse UX, operator flows, and thin client calls
```

The boundary is part of the product contract. Stackd owns mutable local Stack
state. The TUI renders stackd responses and sends typed requests; it should not
directly mutate stackd-owned resources such as meta-thread manifests, handoff
JSON, handoff artifacts, successor sessions, receipts, or update state.

Rust quality means:

- explicit state machines for lifecycle operations
- typed request/response contracts for TS consumers
- typed errors for invalid transitions
- no silent fallback across storage or service authority boundaries
- structured events and receipts for meaningful work
- privacy-preserving telemetry by default

TypeScript quality means:

- predictable terminal UX under dense event streams
- centralized stackd client types instead of ad hoc JSON parsing
- clear signed-out, signed-in, update, handoff, and error states
- no text overlap, focus traps, or layout shifts in common terminal sizes
- local-first copy: Stack works without Synth sign-in unless a hosted feature is requested

Every server/client feature should have two kinds of evidence:

- **Contract evidence:** live stackd response shape matches the TS client.
- **TUI evidence:** Bombadil or focused smoke coverage proves the operator flow remains usable.

---

## Quick reference

| When | Command | ~Time |
| --- | --- | --- |
| Every commit / dev bump | `bun run quality:static` | ~30s |
| Dev gate (CI-friendly, no keys) | `bun run quality:dev` | ~2–5m |
| Local substrate (keys + stackd + slot) | `bun run quality:local` | ~5–15m |
| Stable promote (before tag) | `bun run quality:release` | ~15–45m |
| Launch inventory | `bun run launch:readiness` | ~1s |
| Nightly 1 packet | `bun run launch:nightly1` | ~1s |
| StackEval dogfood smoke | `./bin/stackeval run banking77-local-gepa --preset smoke` | ~10–30m |
| GameBench handoff experiment | See §GameBench (P0 wiring pending) | hours |

Makefile aliases: `make check`, `make release-check`, `make release-guard-b0`, `make launch-readiness`, `make launch-nightly1`, `make quality-dev`, `make quality-local`.

---

## 1. Static / lint gates

Stack does **not** run eslint, biome, ruff, clippy, or rustfmt in CI today. Static quality is:

| Gate | What | Command |
| --- | --- | --- |
| **TypeScript** | Strict `tsc --noEmit` on `src/**/*.ts` | part of `bun run check` |
| **Rust** | `cargo build -p stackd` (workspace: `stack-core`, `stackd`) | part of `bun run check` |
| **Release metadata** | Semver sync, CHANGELOG section for stable, version.json ↔ package.json | `bun run release-check` |
| **Observability retention** | VL slot compose flags + live metrics (optional subgate) | `STACK_RELEASE_CHECK_OBSERVABILITY=1 bun run release-check` |

```bash
cd ~/Documents/GitHub/stack
bun run quality:static    # check + release-check
# or
make check && make release-check
```

**Config paths:** `tsconfig.json`, `Cargo.toml`, `scripts/release_check.ts`, `version.json`.

**Gap (known):** no repo CI workflow; no clippy/rustfmt. Do not skip `bun run check` before merge.

---

## 2. Bombadil (TUI invariants)

[Bombadil](https://github.com/antithesishq/bombadil) runs **property/invariant checks** against a local HTTP probe that simulates TUI states — no real terminal driving.

| ID | Command | Proof |
| --- | --- | --- |
| **AT-STACK-BOMBADIL-B0** | `bun run smoke:bombadil:b0` | `.stack/evidence/bombadil-b0/<stamp>/proof.json` |

Lower-level:

```bash
bun run smoke:bombadil:tui-b0      # probe + invariants only
make release-guard-b0              # same as smoke:bombadil:b0
```

**Environment**

- `STACK_BOMBADIL_BIN` — path to bombadil binary (default: `../synth-managed-research/tests/property/bombadil`)
- `STACK_BOMBADIL_B0_PROOF` — output proof JSON path

**Pass bar (B0):** scroll/focus/crash-cleanup scenarios pass; no OpenTUI buffer/mouse/memory crash signatures (`scripts/tui_crash_guard.ts`).

Bombadil should grow into the main terminal-UX confidence tool:

| Tier | Purpose | Example invariants |
| --- | --- | --- |
| **B0** | Basic terminal safety | app starts, focus moves, scroll works, no crash signatures, cleanup is clean |
| **B1** | Operator workflow safety | update center, handoff inbox, rail switching, approve/continue prompts, no overlap or stale focus |
| **B2** | State pressure | event bursts, long labels, narrow terminals, offline stackd, signed-out/signed-in auth transitions |
| **B3** | Launch replay | recorded dogfood traces preserve focus, layout, and receipt/event invariants |

**Planned:** `AT-STACK-BOMBADIL-B1` — operator flows (launch, pane nav, MCP visibility, handoff/update states). Not built.

**Scripts:** `scripts/bombadil_tui_b0.ts`, `scripts/bombadil_tui_b0_server.ts`, `scripts/smoke_bombadil_b0.ts`.

---

## 3. Acceptance smokes (AT-STACK-*)

Tier definitions match [`stack_acceptance.md`](../../Jstack/.jstack/product/specs/stack_acceptance.md):

- **T0** — headless, no API keys
- **T1** — local keys, stackd, synth-dev slot
- **T2** — live Codex / long dogfood eval
- **T3** — second machine, prod distribution

### T0 aggregate (dev gate)

```bash
bun run quality:dev
# equivalent to:
bun run smoke:acceptance:t0
```

Runs in order:

1. `bun run check`
2. `bun run smoke:voice:tui`
3. `bun run smoke:gardener:v1` → **AT-STACK-GARDENER-V1**
4. `bun run smoke:guidance:l2` → **AT-STACK-GUIDANCE-L2**
5. `bun run smoke:monitor:style-steer` → **AT-STACK-MONITOR-STYLE-STEER**
6. `bun run smoke:bombadil:b0` → **AT-STACK-BOMBADIL-B0**

### T1 aggregate (local substrate)

**Prerequisites:** stackd on `:8792`, ≥1 session for stackd smoke, synth-dev slot up, keys in env.

```bash
bun run quality:local
# equivalent to:
bun run smoke:acceptance:t1
```

Runs:

1. `bun run smoke:stackd` → **AT-STACK-STACKD-L1**
2. `bun run smoke:mcp:local-threads` → **AT-STACK-MCP-LOCAL-THREADS**
3. `bun run smoke:voice:gardener-demo` → **AT-STACK-VOICE-STT**
4. `bun run smoke:observability` → **AT-STACK-OBS-SYN3042**

After explicit operator approval for VL slot recreate:

```bash
bun run release-check:observability   # AT-STACK-OBS-RETENTION
```

### Other smokes (run ad hoc or before stable)

| Command | ID / purpose |
| --- | --- |
| `bun run smoke:tui` | Submit path |
| `bun run smoke:tui:scroll` | Scroll invariants |
| `bun run smoke:tui:focus` | Focus rail |
| `bun run smoke:tui:crash-cleanup` | Crash cleanup |
| `bun run smoke:tui:gepa` | GEPA mock TUI |
| `bun run smoke:tui:gepa:live` | GEPA live (keys) |
| `bun run smoke:tui:resilience` | Resilience |
| `bun run smoke:tui:all` | check + submit + scroll + gepa mock + resilience |
| `bun run smoke:stackd` | Local API |
| `bun run smoke:mcp:http` | HTTP MCP |
| `bun run smoke:agent-bridge` | Codex bridge |
| `bun run smoke:bootstrap` | Bootstrap |
| `bun run smoke:install-skills` | Codex skills install |

Expect scripts: `scripts/smoke_tui_*.expect`. Feature smokes: `scripts/smoke_*.ts`.

### Registered but not implemented

| ID | Command | Status |
| --- | --- | --- |
| AT-STACK-HANDOFF-HARNESS-001 | `bun run smoke:handoff-harness:bundle` | **missing script** |
| AT-STACK-HANDOFF-HARNESS-002 | `bun run smoke:handoff-harness:dev-split` | **missing script** |
| AT-PATH2-STACK-MCP | `scripts/path2_stack_mcp_acceptance.sh` | **not built** |

---

## 4. StackEval

StackEval is Stack’s **dogfood eval pipeline** — tmux harness + GEPA optimizer + trace harvest + grading.

**Config SSOT:** `.stack/stackeval/` (tasks, pipeline, HARNESS.md).  
**Registered task:** `banking77-local-gepa` only.

### Commands

```bash
cd ~/Documents/GitHub/stack

# Full pipeline (smoke = plumbing proof, no heldout lift claim)
./bin/stackeval run banking77-local-gepa --preset smoke

# Prepare only (config + dirs, no optimizer run)
./bin/stackeval prepare banking77-local-gepa --preset smoke

# Agent-driven TUI replay (Codex in tmux)
./bin/stackeval harness prepare banking77-local-gepa --preset smoke

# npm aliases
bun run stackeval:run              # ./bin/stackeval run banking77-local-gepa
bun run stackeval:run:prepare
bun run stackeval:harness
bun run stackeval:banking77-local-gepa   # legacy TS wrapper
```

### Presets

| Preset | Purpose |
| --- | --- |
| `smoke` | 8/8 split, 1 gen — proves plumbing + trace ( **launch minimum** ) |
| `dev` | ~50/50, multiple gens — optimization signal |
| `gate` | Heldout lift required — stable / external claims |

### Internal gates (SE-B77-*)

Documented in `.stack/stackeval/tasks/banking77-local-gepa.md`:

- SE-B77-1-HARNESS through SE-B77-6-LEVERAGE

### Acceptance mapping

| ID | Proof |
| --- | --- |
| **AT-STACK-MONITOR-L4** | Live StackEval packet with monitor profile `gepa-dogfood.toml` — see Jstack evidence `stack/.stack/evidence/stackeval/banking77-local-gepa/` |

### Prerequisites

- Local synth-dev slot (or orchestrator you control)
- `GEMINI_API_KEY` (policy model) + OpenAI/Codex keys per harness template
- `synth-optimizers`, `evals` checkouts on paths expected by pipeline
- Monitor profile `.stack/monitors/gepa-dogfood.toml` for L4 proof

**Evidence:** `.stack/evidence/stackeval/<task>/<stamp>/` + Jstack mirror `.jstack/evidence/stackeval/`.

---

## 5. GameBench + Stack

### Current state (2026-06-29)

- **No** `./bin/stackeval run craftax-*` task registered in Stack.
- Handoff harness scripts (`smoke:handoff-harness:*`) **not committed**.
- **Lane map (read this):** [`gamebench_lane_map_env_codegen.md`](../../Jstack/.jstack/daily_notes/2026-06-29/gamebench_lane_map_env_codegen.md)
- Stack evidence `tictactoe-code-dev-real` ran **code_policy hillclimb** (91-line policy) — **not** env codegen.
- **Correct env lane (Stack):** `tictactoe-harbor-env-rebuild` → Harbor bundle `gamebench/adapters/harbor/bundles/tictactoe_singleplayer_gold`.
- ReportBench `tictactoe_gamebench_engine_rebuild_1cand` is an SMR wrapper around the same Harbor deliverable — use Harbor/Stack directly for env codegen proof.

### TicTacToe env codegen (Harbor native — the lane you want)

| | Policy (wrong) | Harbor env rebuild (right) |
| --- | --- | --- |
| Task | `tictactoe_gamebench_code_policy_deo_hillclimb_1cand` | `tictactoe-harbor-env-rebuild` / Harbor `tictactoe-singleplayer` |
| Runner | `run_tictactoe_gamebench_hillclimb_task.py` | `bun run stackeval:tictactoe-harbor-env-rebuild` or `./adapters/harbor/run.sh dev codex tictactoe-singleplayer` |
| Output | `heuristic_policy.py` (~91 LoC) | `candidate/gold/` + `candidate/policies/` + `candidate/scripts/run_service.py` |
| Verifier | Win rate vs baseline | Harbor spectrum — 20 scenarios |

```bash
cd ~/Documents/GitHub/stack
bun run stackeval:tictactoe-harbor-env-rebuild:prepare
bun run stackeval:tictactoe-harbor-env-rebuild
# after Stack session:
bun run stackeval:tictactoe-harbor-env-rebuild:verify -- --packet-dir .stack/evidence/stackeval/tictactoe-harbor-env-rebuild/<stamp>
```

### Launch target (handoff blog experiment)

**Frozen suite:** `craftax_exotic_cybernetics_v20_dev_300`  
**Task family:** `runbench.gamebench.craftax_exotic_cybernetics`  
**Evals lane:** `evals/reportbench/lanes/craftax_gamebench_exotic_cybernetics_1cand`  
**Acceptance:** `AT-STACK-HANDOFF-GB-DEV-001` (9 runs: A0/A1/A2 × 3 reps)

| Arm | Handoffs | Purpose |
| --- | --- | --- |
| A0 | Off | Harness compaction only (control) |
| A1 | `handoff.preempt`, fixed medium successor | Replace compaction |
| A2 | `handoff.preempt`, routed effort | Fusion-like routing |

### Prerequisites (block GameBench runs until green)

| Gate | Check |
| --- | --- |
| stackd meta-thread API | `cargo check -p stack-core -p stackd` |
| AT-STACK-META-006 | Monitor `handoff.preempt` seal + continue |
| Monitor profile | `.stack/monitors/handoff-preempt-gamebench.toml` |
| GameBench lane | Craftax exotic cybernetics container smoke green |
| Slot headroom | `active_run_count=0`; no parallel GameBench watcher overload |

### Intended run flow (when harness lands)

```bash
# 1. Pin SHAs (stack, gamebench, evals, synth-dev) in run manifest
# 2. Export arm
export STACK_HANDOFF_ARM=a0   # or a1, a2
export STACK_MONITOR_PROFILE=handoff-preempt-gamebench

# 3. One-scenario smoke (T1 gate)
bun run smoke:handoff-harness:dev-split   # AT-STACK-HANDOFF-HARNESS-002

# 4. Full 9-run experiment (T2 gate)
# Via distributed harness bundle or SMR/ReportBench wrapper — see experiment plan §Run protocol

# 5. Evidence
# .jstack/evidence/stack-handoffs-gamebench-dev/<stamp>/
```

### Running GameBench without Stack (lane sanity)

Use synth-dev SMR/ReportBench wrappers against the frozen lane — proves container + scorer before Stack handoff wiring:

```bash
cd ~/Documents/GitHub/synth-dev
./scripts/runtime.py status                    # confirm slot ownership
# Follow evals/reportbench lane docs for craftax_gamebench_exotic_cybernetics_1cand
```

Stack involvement = worker session + monitor profile + meta-thread handoff events captured in export bundle alongside GameBench `eval_summary.json`.

---

## 6. Release checklists

### Dev bump (many times per day)

```bash
make bump-dev
bun run quality:static
bun run quality:dev
git add version.json package.json && git commit -m "..."
```

See [`RELEASE.md`](RELEASE.md).

### Stable promote

```bash
# CHANGELOG section for X.Y.Z first
make release-promote VERSION=X.Y.Z
bun run quality:release          # static + T0 + T1 + obs retention check
./bin/stackeval run banking77-local-gepa --preset smoke
make release-guard-b0            # redundant if quality:dev ran; required for ship citation
git tag -a vX.Y.Z -m "Stack X.Y.Z"
```

**Ship bundle citation:** record commands + evidence paths in Jstack ship log (`jsk ship testing-pass`).

### Launch-only (T3 / distribution)

From [`stack_and_tag_launch.md`](../../Jstack/.jstack/product/stack_and_tag_launch.md):

- `AC-STACK-SECOND-MACHINE`, `AT-STACK-INSTALL-PATH`
- `AT-STACK-MCP-TOOLS`, `AT-PATH2-STACK-MCP`
- `AT-STACK-BOMBADIL-B1`, `AT-STACK-DOCS-INSTALL`, `AT-STACK-HOMEBREW-INSTALL`
- `AT-STACK-HANDOFF-GB-DEV-001` when handoff experiment completes

---

## 7. Evidence layout

```text
.stack/evidence/
  guidance-l2/<stamp>/summary.json
  gardener-v1/<stamp>/summary.json
  monitor-style-steer/<stamp>/summary.json
  stackeval/banking77-local-gepa/<stamp>/   # StackEval packet
  stack-handoff-harness/<stamp>/            # planned
```

Bombadil: `.stack/evidence/bombadil-b0/<stamp>/proof.json` (or `STACK_BOMBADIL_B0_PROOF`).

Cross-repo audit mirror: `Jstack/.jstack/evidence/stackeval/`, `Jstack/.jstack/evidence/monitor-l4/`.

---

## 8. Known red / waived gates

| ID | Status | Notes |
| --- | --- | --- |
| AT-STACK-OBS-RETENTION | **red** | Until shared VL slot recreated via guarded helper |
| AT-STACK-SECOND-MACHINE | **open** | Blocks stack-v0.1.0 ship finish without waiver |
| AT-STACK-HANDOFF-* | **registered** | Scripts + GameBench wiring pending |
| AT-PATH2-STACK-MCP | **not built** | Tag delegate + receipt |

---

## 9. Package.json command index

| Script | Description |
| --- | --- |
| `check` | tsc + cargo build |
| `quality:static` | check + release-check |
| `quality:dev` | T0 acceptance aggregate |
| `quality:local` | T1 acceptance aggregate |
| `quality:release` | static + T0 + T1 + obs retention release-check |
| `launch:readiness` | S0-S9 launch inventory |
| `launch:nightly1` | first nightly launch packet |
| `smoke:acceptance:t0` | Same as quality:dev |
| `smoke:acceptance:t1` | T1 smokes only |
| `release-check` | Release metadata |
| `release-check:observability` | VL retention subgate |
| `smoke:bombadil:b0` | AT-STACK-BOMBADIL-B0 |
| `stackeval:run` | banking77-local-gepa pipeline |
