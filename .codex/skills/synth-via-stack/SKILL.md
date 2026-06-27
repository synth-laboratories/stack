---
name: synth-via-stack
description: Use when helping a Stack user work with Synth — local GEPA via synth-optimizers, hosted optimizer jobs, eval containers through synth-ai SDK/CLI, container health/info/rollout contracts, or graduating from local proof to hosted optimization. Load this skill at the start of Stack agent turns and before proposing optimizer, container, or synth-ai workflows.
---

# Synth via Stack

Stack is the operator cockpit; **synth-ai** is the SDK/CLI for containers and API access;
**synth-optimizers** is the local OSS optimizer service; **hosted optimizers** run the same
search on Synth infrastructure.

Read **`stack-agent-bridge`** when the task is live Stack TUI/MCP operations (SMR, Factory,
hosted job lists, previews, downloads).

## Mental model

```text
Eval container (health + info + /rollout)
    → local proof (synth-optimizers GEPA via Stack Local Research)
    → hosted job (backend optimizer API / Stack hosted panel / synth-ai client)
    → artifacts + metric deltas + usage receipts
```

Three surfaces:

| Surface | Who runs it | Stack UI | Primary tools |
| --- | --- | --- | --- |
| **Local OSS optimizers** | Your machine | Local Research panel | `synth-optimizers`, Stack local GEPA service |
| **Hosted optimizers** | Synth infra | Hosted Optimizers panel | Backend `/api/v1/optimizers/*`, Stack MCP |
| **Containers** | Synth-hosted or local slot | — | `synth-ai` CLI/SDK, container contract |

## Container contract (required for optimizers)

Optimizers score candidates by calling your eval container. The container must implement:

- **`GET /health`** — liveness
- **`GET /info`** — task metadata (task id, schema hints)
- **`POST /rollout`** — run one scored episode; return metrics the optimizer can compare

Contract reference: `synth-ai/openapi/container-contract-v1.yaml`.

Local dev often uses **synth-dev slots** (`./scripts/local.sh up slotN`) to run backend +
worker + container side by side. Do not ad-hoc `docker compose` or bare `uvicorn` when a
canonical synth-dev wrapper exists.

## synth-ai (SDK + CLI)

Install: `pip install synth-ai` (or use the repo checkout).

```bash
# Auth — use the env var from stack.config.json for the selected environment
export SYNTH_API_KEY=...   # never print the value

# Containers
synth-ai containers list
synth-ai containers create ...

# Python
python -c "from synth_ai import SynthClient; print(SynthClient().containers.list())"
```

Use **synth-ai** for:

- Listing/creating hosted container records
- Pools, rollouts, artifacts, usage summaries
- API paths under `/v1/containers/*`

Do **not** reimplement container HTTP with raw `curl` when the SDK exposes the operation.

Docs: https://docs.usesynth.ai/sdk/containers

## Local optimizers (OSS / GEPA)

Stack starts the local service (default):

```bash
synth-optimizers gepa service \
  --db .stack/optimizers/gepa-service.sqlite \
  --bind 127.0.0.1:8879
```

In Stack: **Tab → Local Research**, `Enter` to start service, `j/k` to browse jobs.

Overrides (env): `STACK_OPTIMIZER_COMMAND`, `STACK_OPTIMIZER_BIND`, `STACK_OPTIMIZER_DB`,
`STACK_OPTIMIZER_SERVICE_URL`.

Workflow:

1. Prove the container contract locally (single rollout smoke).
2. Register the container URL with the local GEPA service / cookbook config.
3. Run a small visible split; keep held-out rows out of search.
4. Inspect job list, metrics, and saved candidates in Stack or service DB.
5. Only then launch hosted jobs with the same container config.

Package: **`synth-optimizers`** on PyPI. Public cookbooks show end-to-end GEPA loops.

## Hosted optimizers

Hosted jobs use the **same container config** as local proof. Synth runs GEPA/GELO/MAPO/MIPRO
(or related search) and returns metric deltas + candidate artifacts + billable usage on a run id.

From Stack:

- **Tab → Hosted Optimizers** — list jobs, preview/download artifacts, cancel
- **Stack MCP** — `stack_list_hosted_optimizer_runs`, `stack_preview_hosted_optimizer_artifact`,
  `stack_download_hosted_optimizer_artifact`, `stack_cancel_hosted_optimizer`

Backend owner routes (use typed clients / Stack MCP — do not scrape DB or Redis):

- `GET /api/v1/optimizers/runs?limit=N`
- `GET /api/v1/optimizers/runs/{run_id}`
- `GET /api/v1/optimizers/runs/{run_id}/artifacts/{artifact_name}`
- `POST /api/v1/optimizers/runs/{run_id}/cancel`

Environment comes from Stack's dev/staging/prod selector (`stack.config.json`).

## Recommended agent flow in Stack

1. Read `stack.config.json` for `workingDir`, environments, optimizer URLs.
2. Load **stack-agent-bridge**; call `stack_status` with `mode: "all"`.
3. Classify the ask: container authoring, local GEPA proof, hosted job, or live SMR/Factory.
4. For containers → synth-ai + contract YAML.
5. For local optimize → Local Research + synth-optimizers.
6. For hosted optimize → Hosted Optimizers panel or Stack MCP; preview before download.
7. Report concrete ids (run id, artifact name, container id) and which surface was used.

## Guardrails

- Never print raw API keys.
- Never bypass Stack/backend owner routes (no raw Postgres, Redis, SMR DB scraping).
- Prefer preview tools before downloads.
- Say explicitly when a gate or environment is missing instead of guessing endpoints.
- When the user says **code only**, stay on implementation; do not run evals unless asked.

## Stack skill install

Bundled skills live in `<stack-repo>/.codex/skills/`. Stack symlinks them into
`~/.codex/skills/` on install and first launch so Codex injects them into agent context.
Required pair for Stack operators: **`stack-local-setup`**, **`synth-via-stack`**, and
**`stack-agent-bridge`**.
