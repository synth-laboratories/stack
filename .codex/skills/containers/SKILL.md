---
name: containers
title: Synth containers
description: Use when building, debugging, or operating Synth task containers through the public synth-containers HTTP contract, including GEPA-compatible rollout services, task_info/program/dataset routes, traces, artifacts, and hosted pool rollout surfaces.
owner: stack
allowed_actors: both
---

# Synth Containers On Stack

Use this skill when the work touches public Synth task containers: local HTTP task
services, GEPA-compatible rollout contracts, hosted pools, rollout traces, and
container artifacts.

## First Files

Read only what is needed for the current container:

- `containers/README.md` for the canonical contract.
- `containers/openapi/container-contract-v1.yaml` for wire details.
- `containers/src/synth_containers/http_adapter.py` when using the FastAPI adapter.
- `containers/src/synth_containers/formats.py` when matching shared response shapes.
- `cookbooks/code/demos/banking77/README.md` and `banking77_task_app.py` for a worked coding/classification container.
- `optimizers/skills/gepa/SKILL.md` when wiring a container into GEPA.

## Contract

The task container owns task semantics: dataset loading, observations, policy calls,
actions, verifier/scoring logic, traces, and public-safe artifacts. Optimizers and
agents should talk to it through HTTP only.

Required routes for GEPA and most eval consumers:

- `GET /health`
- `GET /metadata`
- `GET /task_info`
- `GET /program`
- `GET /dataset`
- `POST /dataset/rows`
- `POST /rollout`

Optional async routes are valid only when implemented for real:

- `POST /rollouts`
- `GET /rollouts/{id}`
- `GET /rollouts/{id}/summary`
- `GET /rollouts/{id}/usage`
- `GET /rollouts/{id}/artifacts`
- `GET /rollouts/{id}/events`
- `GET /rollouts/{id}/trace`

Do not claim checkpoint, resume, pause, terminate, or branching support unless the
container actually implements it.

## Stack And Hosted Routes

For hosted Synth access, use the live backend routes:

- `GET /v1/pools`
- `POST /v1/pools`
- `GET /v1/pools/{pool_id}/container/health`
- `POST /v1/pools/{pool_id}/container/rollout`
- `POST /v1/rollouts`
- `GET /v1/rollouts/{rollout_id}/events`
- `GET /v1/rollouts/{rollout_id}/trace`
- `GET /v1/rollouts/{rollout_id}/artifacts.zip`

Do not build against `/v1/containers`; that SDK prefix is not the live backend
router. Document the naming mismatch if it appears in user-facing context.

## Task Info

`/task_info` should give a general proposer enough context to improve behavior:

- `task_id`, task family, and objective.
- What the policy sees and what it must output.
- Valid labels, actions, patches, or tool-call schema.
- Primary metric and partial-credit rules.
- Dataset split and seed semantics.
- Public-safe examples and failure modes.
- Proposal guidance and overfitting hazards.
- Constraints: time, tokens, sandbox, verifier, and safety limits.

For closed-output tasks, include the output space. For open-output tasks, describe
procedures and verifier expectations instead of leaking train targets.

## Program And Dataset

`/program` should expose narrow mutable fields, a seed candidate, objective names,
and the candidate overlay schema. Do not make environment constants, verifier code,
or dataset selection mutable unless the optimization task explicitly requires it.

Prefer deterministic seed-to-row resolution:

- `GET /dataset` declares splits, row counts, and seed policy.
- `POST /dataset/rows` accepts split plus explicit seeds.
- Preserve requested seeds and return resolved row ids in stable order.
- Keep train and heldout sampling independent.

## Rollout Evidence

`POST /rollout` should return:

- Candidate id or overlay id.
- Row id, seed, and split.
- Scores by objective and primary reward.
- Prediction, action trace, patch, answer, or final output.
- Expected output or verifier target when public-safe.
- Failure reason and verifier details.
- Usage: tokens, model calls, wall time, and cost when available.
- Trace, event, or artifact references when produced.

Use real verifiers and environments. Tiny fixtures are acceptable only for explicit
contract smoke tests.

## Validation

Respect repo instructions about tests. Do not add automated test files unless the
user asked for tests.

Narrow checks for a container change:

- Syntax: `python -m py_compile synth_service_app.py`.
- Route smoke: start the container and check `/health`, `/metadata`, `/task_info`,
  `/program`, and `/dataset`.
- Dataset smoke: request explicit train and heldout seeds.
- Rollout smoke: run one tiny rollout with a seed candidate overlay.
- GEPA smoke: run the cookbook smoke profile only when the change is intended for GEPA.

## Guardrails

- Never write API keys into TOML, README, event logs, traces, or artifacts.
- Keep public examples independent of private local auth state.
- Keep generated run artifacts in ignored run directories unless deliberately
  publishing a sample.
- Use capability metadata conservatively.
