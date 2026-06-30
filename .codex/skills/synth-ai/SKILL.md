---
name: synth-ai
title: synth-ai SDK and CLI
description: Use when working with Synth containers, rollouts, pools, and API access through the synth-ai Python SDK/CLI — install, auth, list/create containers, rollout smoke, and SDK patterns. Stack routes hosted ops through MCP when available; synth-ai is the typed client boundary.
owner: stack
allowed_actors: both
---

# synth-ai on Stack

**synth-ai** is the typed SDK/CLI for Synth API access — containers, rollouts, artifacts,
usage, and research helpers. Stack surfaces it through Local Research, environment auth,
and Stack MCP for live ops.

Load **`oss-gepa`** for local optimizer service. Load **`hosted-gepa`** when graduating
to hosted optimizers. Load **`stack-agent-bridge`** for TUI/MCP live operations.

## Install

```bash
pip install synth-ai
# research helpers when needed:
pip install "synth-ai[research]"
```

Stack dev bootstrap also expects `synth-optimizers` for local GEPA (`pip install synth-optimizers synth-ai`).

## Auth

```bash
export SYNTH_API_KEY=...   # from stack.config.json authEnvFile — never log value
```

Keys: https://usesynth.ai/keys · Docs: https://docs.usesynth.ai

## Container contract (required for optimizers)

Eval containers must implement:

- `GET /health` — liveness
- `GET /info` — task metadata
- `POST /rollout` — scored episode

Contract: `synth-ai/openapi/container-contract-v1.yaml`.

Local dev: prefer **synth-dev slots** (`./scripts/local.sh up slotN`) over ad hoc docker/uvicorn.

## CLI quick path

```bash
synth-ai containers list
synth-ai containers create ...
```

## Python quick path

```python
from synth_ai import SynthClient

client = SynthClient()
print(client.containers.list())
```

Do **not** reimplement container HTTP with raw `curl` when the SDK exposes the operation.

## Stack integration

| Need | Prefer |
| --- | --- |
| List/read skills | stackd `GET /skills` (registry is server-owned) |
| Live SMR / Factory / hosted optimizers | Stack MCP (`stack-agent-bridge`) |
| Local GEPA service | Local Research panel + `oss-gepa` |
| Container rollout smoke | synth-dev slot + SDK or CLI |

## Managed Research

Research interfaces live in **synth-ai** (not standalone managed-research). Follow backend
contract authority — SDK schemas track backend, not a second source of truth.
