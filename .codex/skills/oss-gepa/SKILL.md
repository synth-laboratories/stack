---
name: oss-gepa
title: OSS GEPA (research engineering)
description: Use when running local prompt optimization with synth-optimizers — install the CLI, start the GEPA service, wire eval containers, and read the full gepa skill from the optimizers repo. Stack is built for research engineering first; this is the default optimizer path in Local Research.
owner: stack
allowed_actors: both
---

# OSS GEPA on Stack

Stack is a **research engineering cockpit** first: eval containers, local GEPA,
StackEval receipts, and optimizer artifacts. General software engineering works
too, but the default skills and Local Research panel optimize for **prompt/search
loops with inspectable evidence**.

Load **`synth-via-stack`** for the full local → hosted optimizer mental model.
Load **`gepa`** (from the optimizers repo) for TOML profiles, proposer workspaces,
and cookbook containers.

## Install synth-optimizers (required for Local Research)

**PyPI CLI + service** (minimum for Stack Local panel):

```bash
pip install synth-optimizers synth-ai
synth-optimizers --help
```

Stack on **dev** auto-starts `synth-optimizers gepa service` when the CLI is on PATH
(disable: `STACK_AUTO_START_LOCAL_OPTIMIZER=0`).

Manual service:

```bash
synth-optimizers gepa service \
  --db .stack/optimizers/gepa-service.sqlite \
  --bind 127.0.0.1:8879
```

In Stack: **Tab → Local Research**, **Enter** on empty prompt to start GEPA.

## Optimizers repo (full GEPA skill + cookbooks)

For TOML configs, `run_acceptance.py`, Rust GEPA internals, and public cookbooks,
clone the **synth-optimizers** source repo (private org checkout today):

```bash
git clone git@github.com:synth-laboratories/optimizers.git ~/Documents/GitHub/optimizers
# or set STACK_SYNTH_OPTIMIZERS_ROOT=/path/to/optimizers
```

Stack symlinks `optimizers/skills/gepa` into `.stack/skills/gepa` on launch when that
path exists. Then agents should **`Read` the `gepa` skill** for profile selection,
rollout budgets, and heldout interpretation — not guess from memory.

Sibling layout (auto-detected):

```text
~/Documents/GitHub/
  stack/
  optimizers/          ← skills/gepa/SKILL.md
  synth-cookbooks-public/
  synth-dev/
```

Override detection: `export STACK_SYNTH_OPTIMIZERS_ROOT=/path/to/optimizers`

## Research engineering workflow in Stack

1. **Container contract** — `GET /health`, `GET /info`, `POST /rollout` (synth-ai YAML).
2. **Single rollout smoke** — prove scorer wiring before a search job.
3. **Local GEPA job** — Local Research panel or `synth-optimizers` CLI; pick smoke vs
   dev vs gate profile by the claim you need (see `synth-via-stack`).
4. **StackEval receipt** — `./bin/stackeval run banking77-local-gepa --preset smoke` when
   validating the Stack + optimizer path end-to-end.
5. **Hosted optimizers** — same container config after local proof.

## Stack MCP / skills tools

- `stack_skills_list` — includes `oss-gepa`, bundled Stack skills, and bridged `gepa`
  when the optimizers checkout is present
- `stack_skills_read` — load skill body before proposing optimizer commands
- `stack_skills_search` — query by `gepa`, `optimizers`, `stackeval`

Monitor may push skill context when GEPA/StackEval work is detected without a skill read.

## Guardrails

- Do not claim **optimized prompt proof** from a smoke profile (1 generation / tiny heldout).
- Never print raw API keys (`SYNTH_API_KEY` lives in `synth-ai/.env` on dev).
- Prefer `synth-optimizers` and synth-dev wrappers over ad-hoc compose/uvicorn for eval infra.
