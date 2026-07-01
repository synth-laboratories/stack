---
name: synth-stack-productivity
title: Synth stack productivity (OSS + hosted)
description: Load first for Stack work. Use when the operator needs hyper-productive access to the full Synth stack — OSS (synth-optimizers, synth-dev, StackEval, local containers) and hosted (synth-ai SDK, api.usesynth.ai, usesynth.ai SMR/Factory/hosted optimizers). Routes to oss-gepa, synth-via-stack, and stack-agent-bridge. Stack top priority is one cockpit for research engineering across both stacks.
owner: stack
allowed_actors: both
---

# Synth stack productivity

**Top priority:** Stack exists to make operators and agents hyper-productive with the
**entire Synth stack** — open-source local paths **and** closed hosted paths — without
repo archaeology or ad hoc HTTP.

Full reference: `stack/docs/SYNTH_PRODUCTIVITY.md`.

## Two stacks, one cockpit

| Lane | What | Stack entry |
| --- | --- | --- |
| **OSS / local** | `synth-optimizers`, optimizers repo, synth-dev slots, StackEval, local containers | Local Research · `evals/stackeval` · `oss-gepa` skill |
| **Hosted / closed** | `synth-ai` SDK, `api.usesynth.ai`, usesynth.ai (keys, signup), SMR, Factory, hosted optimizers | Environment selector · Hosted/Remote panels · `stack-agent-bridge` MCP |

**Graduation:** same container config locally → hosted job → cite both run ids in summaries.

## Load order (do not skip)

1. **This skill** — pick OSS vs hosted vs both
2. **`oss-gepa`** — if any GEPA/optimizer work (`pip install synth-optimizers`, optimizers clone)
3. **`synth-via-stack`** — container contract, rollout smoke, profile sizing
4. **`stack-agent-bridge`** — if remote SMR, Factory, hosted optimizer, or MCP actions
5. **`gepa`** — when `../optimizers` checkout exists (auto-bridged into `.stack/skills/gepa`)

## Environment selector

Read `stack.config.json` → `environments`:

- **dev** — local API (`127.0.0.1:8000`), auth from `synth-ai/.env`, auto slot + local GEPA
- **staging** — `staging-api.usesynth.ai`
- **prod** — `api.usesynth.ai`

In Stack TUI: `[` / `]` cycle environment; `r` refresh remote state. Never print `SYNTH_API_KEY`.

## OSS fast path (research engineering)

```bash
pip install synth-optimizers synth-ai
# optional full GEPA skill:
git clone git@github.com:synth-laboratories/optimizers.git ~/Documents/GitHub/optimizers

cd ~/Documents/GitHub/synth-dev && ./scripts/local.sh up slot1
stack   # Tab → Local Research · Enter starts GEPA if needed
```

StackEval receipt:

```bash
bun run stackeval:run
```

## Hosted fast path (usesynth.ai)

```bash
export SYNTH_API_KEY=...   # from environments.*.authEnvFile — never log value
stack   # x → remote mode · Tab → Hosted Optimizers or Remote SMR
```

Prefer Stack MCP: `stack_status` → `stack_list_hosted_optimizer_runs` /
`stack_list_live_smrs` → preview before download.

Python:

```bash
pip install "synth-ai[research]"
python -c "from synth_ai import SynthClient; c=SynthClient(); print(c.containers.list())"
```

Docs: https://docs.usesynth.ai · Keys: https://usesynth.ai/keys

## MCP first rule

If Stack MCP is available, use it for live ops. Do not scrape backend DB, Redis, or
compatibility projections. If MCP is missing, ask the user to run `stack` with stackd up.

## Productivity anti-patterns (fail loud)

- Starting bare `uvicorn` or ad-hoc docker compose when synth-dev slot wrapper exists
- Claiming optimized prompt proof from smoke-tier GEPA profiles
- Mixing staging auth with prod API URLs
- Implementing container HTTP when synth-ai SDK has the operation
- Skipping skill read on GEPA/StackEval/SMR turns (monitor may warn)

## Guardrails

- Research engineering first; general coding second — but same cockpit for both.
- Concrete ids in every handoff: run id, artifact name, container id, meta_thread_id.
- Code-only user requests: implement without running evals unless asked.
