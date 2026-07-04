# Agentic Task Research Playbook

## Purpose

Use this Effort for long-horizon agentic tasks where trajectories, tool use, and recovery behavior matter.

## Start

1. Define the task family and success metric.
2. Freeze baseline agents/configs.
3. Separate visible exploration from heldout proof.
4. Record human hypotheses under `ideas/[HUMAN]-*.md`.

## Resume / Orientation

Before acting in an existing Effort:

1. Read `effort.toml`, this `PLAYBOOK.md`, `PROGRESS.md`, `ACTIVITY.jsonl`, and `research_log.md`.
2. Use `stack effort activity <effort> --limit 20` or `stack_effort_activity` when the timeline tail in `stack effort show` / `stack_effort_get` is not enough.
3. Inspect `human/`, `[HUMAN]` ideas, trajectory data, `findings/proof/`, and acceptance reports before changing the agent recipe.
4. Check bound meta-threads and refs; bind the current thread or attach new run refs only through typed Stack tools.

## Loop

1. Pick one task slice or failure mode.
2. Run baseline trajectories.
3. Change one agent policy, tool affordance, memory, prompt, or harness condition.
4. Compare success, recovery, tool use, cost, and failure taxonomy.
5. Save trajectories and receipts before generalizing.
6. Promote durable lessons into `findings/ideas/`, `findings/code/`, or `findings/proof/`.

## Evidence Bar

An agentic-task claim needs baseline trajectories, candidate trajectories,
success/failure labels, tool-use evidence, cost/time notes, and heldout or
transfer proof when relevant.

## Artifact Routing

- Put trajectories, traces, task instances, and failure stores in `findings/data/`.
- Put agent prompts, policies, tools, configs, and harness recipes in `findings/code/`.
- Put scorecards, receipts, heldout/transfer runs, and replay evidence in `findings/proof/`.
- Put summaries and acceptance reports in `findings/results/`.

## Status Discipline

Use `active`, `paused`, `done`, or `archived`. Do not use `blocked`. If progress
depends on a credential, decision, capacity, or another owner, keep the Effort
active or paused and write the exact blocker, evidence, next owner, and next
safe action in `PROGRESS.md`.

## Done

Done means there is a reproducible recipe, trajectory evidence, and a clear heldout or transfer result.
