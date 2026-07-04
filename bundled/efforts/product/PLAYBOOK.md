# Product Effort Playbook

## Purpose

Use this Effort for product discovery, rollout planning, and operator-visible product changes.

## Start

1. Define the user and outcome.
2. Record constraints and non-goals.
3. Capture human product ideas under `ideas/[HUMAN]-*.md`.
4. Name the evidence needed before shipping.

## Resume / Orientation

Before acting in an existing Effort:

1. Read `effort.toml`, this `PLAYBOOK.md`, `PROGRESS.md`, and recent `ACTIVITY.jsonl`.
2. Use `stack effort activity <effort> --limit 20` or `stack_effort_activity` when the timeline tail in `stack effort show` / `stack_effort_get` is not enough.
3. Inspect `human/`, `[HUMAN]` ideas, `notes/`, linked Efforts, and `findings/results/` before changing scope.
4. Check bound meta-threads and refs; bind the current thread or attach new run refs only through typed Stack tools.

## Loop

1. Pick the smallest user-visible decision or slice.
2. Record the user story, expected behavior, and non-goals.
3. Link engineering or research Efforts when deeper work is needed.
4. Capture evidence, demos, screenshots, feedback, or launch notes.
5. Promote decisions and accepted scope into `findings/results/`.
6. Leave parked ideas in `ideas/` with next-owner notes.

## Evidence Bar

A product claim needs target user, behavior or decision, evidence source,
launch/rollout implications, known risk, and next owner.

## Artifact Routing

- Put raw concepts and operator ideas in `ideas/`; mark operator ideas with `[HUMAN]`.
- Put notes, decisions, and release shape in `notes/`.
- Put screenshots, feedback, launch receipts, and validation evidence in `findings/proof/`.
- Put final product decisions, acceptance summaries, and rollout notes in `findings/results/`.

## Status Discipline

Use `active`, `paused`, `done`, or `archived`. Do not use `blocked`. If progress
depends on a credential, decision, capacity, or another owner, keep the Effort
active or paused and write the exact blocker, evidence, next owner, and next
safe action in `PROGRESS.md`.

## Done

Done means the product decision, shipped behavior or deferred scope, evidence, and follow-up are recorded.
