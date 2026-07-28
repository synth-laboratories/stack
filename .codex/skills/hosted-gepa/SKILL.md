---
name: hosted-gepa
title: Hosted GEPA (usesynth.ai)
description: Use when graduating local GEPA proof to Synth hosted optimizers on api.usesynth.ai — same container config, hosted job lifecycle, and artifact handling through documented typed clients. Pair with oss-gepa for local proof and synth-ai for container SDK work.
owner: stack
allowed_actors: both
---

# Hosted GEPA on usesynth.ai

**Hosted optimizers** run the same GEPA search loop as local `synth-optimizers`, on Synth
infrastructure. Use documented typed clients rather than reimplementing optimizer HTTP.

Load **`oss-gepa`** for local proof first. Load **`synth-ai`** for container records and SDK
calls.

## Graduation invariant

```text
local container smoke → local GEPA job (oss-gepa) → hosted optimizer job (same container config)
```

Cite **both** run ids in handoffs and proof packets.

## Entry points

| Surface | How |
| --- | --- |
| TUI | Environment `[`/`]` → **Hosted Optimizers** panel |
| SDK | `synth-ai` client against `api.usesynth.ai` (selected env) |

Never print `SYNTH_API_KEY`. Read from `stack.config.json` → `environments.*.authEnvFile`.

## Hosted fast path

```bash
export SYNTH_API_KEY=...   # from auth env file — never log value
stack   # x remote mode · Tab → Hosted Optimizers
```

Python (when SDK path is clearer than MCP):

```bash
pip install "synth-ai[research]"
python -c "from synth_ai import SynthClient; c=SynthClient(); print('ok')"
```

## Environments

| Env | API |
| --- | --- |
| dev | local slot or `127.0.0.1:8000` |
| staging | `staging-api.usesynth.ai` |
| prod | `api.usesynth.ai` |

Docs: https://docs.usesynth.ai · Keys: https://usesynth.ai/keys
