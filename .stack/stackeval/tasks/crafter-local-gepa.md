# StackEval Task: Crafter Local GEPA (Gemini 3.1 Flash Lite)

**Task id:** `crafter-local-gepa`  
**Owner/operator:** Josh  
**Mode:** local Stack + local GEPA  
**Default model:** `gpt-5.5-low`  
**Status:** draft  
**Active packet pointer:** `.jstack/evidence/stackeval/crafter-local-gepa/latest.json`  
**Primary question:** Can Stack help an operator run a local Crafter GEPA loop with **gemini-3.1-flash-lite** as the policy model — and keep receipts — without re-deriving the cookbook path?

## Objective

Use Stack (and/or the pinned StackEval harness) to complete an end-to-end Crafter ReAct prompt optimization loop:

1. Boot the public Crafter GEPA container (`crafter_container`).
2. Run local GEPA via `synth-optimizers gepa run` with **gemini-3.1-flash-lite** policy.
3. Produce a selected `react_system_prompt` and heldout mean episode reward.
4. Preserve Stack / stackd trace when running stack mode.
5. Feed v1 **local_gepa sensor** runtime with observable run phases (future `stackd` work).

## Why this task (next after Banking77)

| Banking77 (`banking77-local-gepa`) | Crafter (`crafter-local-gepa`) |
| --- | --- |
| Classification container | Game env ReAct container |
| Cheap rollouts | Expensive Craftax episodes |
| Heldout **accuracy** | Heldout **mean episode reward** |
| Same policy pin: `gemini-3.1-flash-lite` | Same policy pin |

This is the natural second local-optimizer StackEval: it exercises **GameBench-adjacent** optimization while reusing the same Gemini policy wiring pattern.

## Starting Prompt

Use this as the initial Stack agent prompt:

```text
We are running StackEval task crafter-local-gepa.

Goal: use local GEPA on the public Crafter container to optimize the ReAct system prompt for policy model gemini-3.1-flash-lite. I need the final heldout mean episode reward, the selected react_system_prompt, artifact paths, and enough command history to reproduce the run.

Rules:
- Start from synth-cookbooks-public cookbooks/optimizers/gepa/crafter_container and established synth-optimizers gepa run commands.
- Prefer ./bin/stackeval run crafter-local-gepa --preset smoke over inventing a new harness.
- Policy must stay gemini-3.1-flash-lite via GEMINI_API_KEY unless you document a blocker and override.
- Use Stack / Stack MCP / local optimizer panels where they save time; name missing affordances explicitly.
- Record every command that matters.
- Do not print secrets.
- At the end, summarize: heldout reward, artifacts, wall-clock time, time wasted, and the one Stack feature that would have saved the most time.
```

## Commands

```bash
cd ~/Documents/GitHub/stack
./bin/stackeval run crafter-local-gepa --preset smoke
./bin/stackeval run crafter-local-gepa --preset dev
./bin/stackeval run crafter-local-gepa --preset gate
```

Prepare only:

```bash
./bin/stackeval prepare crafter-local-gepa --preset smoke
```

Legacy interactive prep (stack mode packet):

```bash
bun run stackeval:crafter-local-gepa:prepare
```

## Known starting points

| Surface | Path / hint |
| --- | --- |
| Crafter GEPA container | `synth-cookbooks-public/cookbooks/optimizers/gepa/crafter_container/` |
| Crafter smoke profile | `crafter_container/run_profiles/smoke.toml` |
| Horserace reference config | `cookbooks/optimizers/gepa/configs/horserace/crafter.toml` |
| Local GEPA service (TUI) | `127.0.0.1:8879` · `.stack/optimizers/gepa-service.sqlite` |
| Banking77 StackEval precedent | `banking77-local-gepa` task + `gepa-smoke.toml.template` |
| Factory runtime note | `.jstack/daily_notes/2026-06-29/first_class_stack_state_runtime.md` |

## P0 dependency: Gemini policy in Crafter container

The Crafter container historically hard-coded `OPENAI_API_KEY`. This task requires **OpenAI-compatible Gemini** routing:

- `CRAFTER_POLICY_API_KEY_ENV=GEMINI_API_KEY`
- `CRAFTER_POLICY_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`
- `CRAFTER_POLICY_MODEL=gemini-3.1-flash-lite`

Mirror the Banking77 container client init if not already landed in `crafter_container/synth_service_app.py`.

## Presets

| Preset | Intent |
| --- | --- |
| `smoke` | 2 train / 1 heldout seed, 1 generation — proves container + Gemini + GEPA plumbing |
| `dev` | 4/2 seeds, 3 generations — look for reward signal |
| `gate` | 6/3 seeds, lift required — acceptance-grade run |

## Acceptance gates

| Gate | Proves |
| --- | --- |
| SE-CRF-1-HARNESS | Rendered `gepa_config.toml` + `harness.json` |
| SE-CRF-2-RUN | GEPA terminal status completed |
| SE-CRF-3-SCORE | Heldout mean episode reward captured in `harvest.json` |
| SE-CRF-4-ARTIFACTS | `result_manifest.json` + candidate registry |
| SE-CRF-5-TRACE | stackd export manifest (when stack mode / export enabled) |
| SE-CRF-6-LEVERAGE | grade + review JSON |

## Auth / cost notes

- **Required:** `GEMINI_API_KEY` (policy rollouts inside container).
- **Proposer:** Codex app server (`chatgpt` auth) unless harness overrides.
- Crafter smoke is **not free** — budget caps in preset TOML; do not run gate on shared CI without approval.

## Evidence layout

```text
.jstack/evidence/stackeval/crafter-local-gepa/<stamp>/
  gepa_config.toml
  harness.json
  harvest.json
  acceptance.md
  artifacts/gepa_runs/<run_id>/result_manifest.json
```
