---
name: containers-coding
title: Synth coding containers
description: Use when operating or building coding-agent Synth containers, especially harbor_code pools, code rollouts, trace inspection, artifacts.zip retrieval, and patch/result readback through Stack and Synth hosted routes.
owner: stack
allowed_actors: both
---

# Synth Coding Containers

Use this skill for coding-agent containers and hosted code rollouts. Load the
`containers` skill first when implementing the container contract itself.

## Model

Coding containers are still Synth containers. The container owns repository setup,
task statement, sandbox policy, verifier, patch/result extraction, traces, and
artifacts. Stack should operate it through the public HTTP/Synth API boundary.

The hosted container type is `harbor_code` in the Synth SDK. The backend public
surface is pools and rollouts:

- `GET /v1/pools`
- `POST /v1/pools`
- `GET /v1/pools/{pool_id}/container/health`
- `GET /v1/pools/{pool_id}/container/program`
- `POST /v1/pools/{pool_id}/container/rollout`
- `POST /v1/rollouts`
- `GET /v1/rollouts/{rollout_id}`
- `GET /v1/rollouts/{rollout_id}/events`
- `GET /v1/rollouts/{rollout_id}/trace`
- `GET /v1/rollouts/{rollout_id}/artifacts.zip`
- `GET /v1/rollouts/{rollout_id}/summary`

Do not use `/v1/containers` as the backend path; it is an SDK naming mismatch,
not the live API route.

## Worked Examples

- `cookbooks/code/demos/banking77/` is the best local worked example.
- `cookbooks/code/demos/banking77/banking77_task_app.py` shows a complete task app.
- `cookbooks/code/demos/banking77/banking77_gepa_demo.toml` shows optimizer wiring.
- `cookbooks/dev/swe/task_app/` is a SWE fixture/data seed area, not a complete route app.

## Operating Flow

1. List or create a pool with type `harbor_code`.
2. Check pool health with `/v1/pools/{pool_id}/container/health`.
3. Read `/program` and `/metadata` before launching a rollout.
4. Launch one bounded rollout with explicit task inputs and model/auth settings.
5. Inspect `/events`, `/summary`, and `/trace`.
6. Download `/artifacts.zip`.
7. Extract the patch, report, logs, and verifier result from artifacts.

When using Stack MCP, prefer Stack-hosted artifact and WorkProduct tools for SMR
outputs, and use Synth API pool/rollout routes for container-native artifacts.

## Evidence Expectations

Every coding-container proof should preserve:

- Pool id and rollout id.
- Container metadata and health status.
- Task input or fixture id.
- Patch or final answer artifact path.
- Verifier pass/fail and score.
- Trace id or trace URL.
- Artifacts.zip receipt.
- Any model usage/cost fields returned by the rollout.

## Guardrails

- Never put secrets in task fixtures, traces, or artifacts.
- Do not claim a patch is validated without verifier output.
- Do not hide failed verifier output; it is useful training signal.
- Keep task/container semantics in the container, not in Stack glue code.
