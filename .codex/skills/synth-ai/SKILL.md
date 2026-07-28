---
name: synth-ai
title: synth-ai SDK and CLI
description: Use when working with Synth containers, rollouts, pools, and API access through the synth-ai Python SDK/CLI — install, auth, list/create containers, rollout smoke, and SDK patterns. synth-ai is the typed client boundary.
owner: stack
allowed_actors: both
---

# synth-ai SDK and CLI

**synth-ai** is the typed SDK/CLI for Synth API access — containers, rollouts, artifacts,
usage, and research helpers.

Load **`oss-gepa`** for local optimizer service. Load **`hosted-gepa`** when graduating
to hosted optimizers.

## Install

```bash
pip install synth-ai
# research helpers when needed:
pip install "synth-ai[research]"
```

Local GEPA workflows also use `synth-optimizers` (`pip install synth-optimizers synth-ai`).

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

## Ownership

Use the public synth-ai SDK/CLI for supported operations. For a surface that is not
implemented by synth-ai, use the owning repository's documented typed workflow or fail
loudly; do not infer an unavailable bridge or scrape backend persistence.

## Managed Research

Research interfaces live in **synth-ai** (not standalone managed-research). Follow backend
contract authority — SDK schemas track backend, not a second source of truth.
