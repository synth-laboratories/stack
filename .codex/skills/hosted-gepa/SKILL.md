---
name: hosted-gepa
title: Hosted GEPA (usesynth.ai)
description: Use when graduating local GEPA proof to Synth hosted optimizers on api.usesynth.ai — same container config, hosted job lifecycle, artifact preview/download via Stack MCP. Pair with oss-gepa for local proof and synth-ai for container SDK work.
owner: stack
allowed_actors: both
---

# Hosted GEPA on usesynth.ai

**Hosted optimizers** run the same GEPA search loop as local `synth-optimizers`, on Synth
infrastructure. Stack is the cockpit — do not reimplement optimizer HTTP ad hoc.

Load **`oss-gepa`** for local proof first. Load **`synth-ai`** for container records and SDK
calls. Load **`stack-agent-bridge`** for live MCP on SMR, Factory, and hosted optimizer panels.

## Graduation invariant

```text
local container smoke → local GEPA job (oss-gepa) → hosted optimizer job (same container config)
```

Cite **both** run ids in handoffs and proof packets.

## Stack entry points

| Surface | How |
| --- | --- |
| TUI | Environment `[`/`]` → **Hosted Optimizers** panel |
| MCP | `stack_submit_hosted_optimizer` → `stack_list_hosted_optimizer_runs` → preview → download |
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

## MCP first rule

Prefer Stack MCP tools over raw backend HTTP:

1. `stack_status` — confirm env + remote connectivity
2. `stack_submit_hosted_optimizer` — submit GEPA with the Stack-selected API base/auth env
3. `stack_list_hosted_optimizer_runs` — list jobs with ids
4. Preview artifact before download
5. Record run ids in thread meta / handoff summary

## SynthTunnel submit

Use the Stack MCP wrapper when a local container needs to be exposed to hosted GEPA:

```text
stack_submit_hosted_optimizer(
  config_path="gepa.toml",
  tunnel_url="http://127.0.0.1:8765",
  tunnel_provider="synth_tunnel",
  follow=true
)
```

`follow=true` is required for `tunnel_url`; the underlying `synth-optimizers gepa submit`
process keeps the SynthTunnel lease open until the hosted run reaches a terminal status.
Without a tunnel, use `container_pool`/`container_task_id` for an existing hosted pool or omit
both for configs that already point at hosted resources.

## Environments

| Env | API |
| --- | --- |
| dev | local slot or `127.0.0.1:8000` |
| staging | `staging-api.usesynth.ai` |
| prod | `api.usesynth.ai` |

Docs: https://docs.usesynth.ai · Keys: https://usesynth.ai/keys

## Stack skills API

stackd owns the skill registry (first-class):

- `GET /skills` — list preinstalled + custom skills
- `GET /skills/hosted-gepa` — read this skill
- `POST /skills` — register custom skills (gardener: `skills.register` tool)
