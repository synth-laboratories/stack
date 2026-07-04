# Engineering Effort Playbook

## Purpose

Use this Effort for product/system implementation, refactors, integrations, release work, or multi-slice bug fixes.

## Start

1. Define the user-visible outcome.
2. Identify files and runtime surfaces in scope.
3. Record non-goals.
4. Identify ordering constraints and dirty-worktree risks.
5. Define the smallest useful implementation slice.

## Resume / Orientation

Before acting in an existing Effort:

1. Read `effort.toml`, this `PLAYBOOK.md`, `PROGRESS.md`, and recent `ACTIVITY.jsonl`.
2. Use `stack effort activity <effort> --limit 20` or `stack_effort_activity` when the timeline tail in `stack effort show` / `stack_effort_get` is not enough.
3. Inspect `human/`, `[HUMAN]` ideas, `notes/`, `repos/`, and `findings/results/` before changing code.
4. Check bound meta-threads and refs; bind the current thread or attach new run refs only through typed Stack tools.

## Loop

1. Read local code patterns before editing.
2. Make scoped changes only.
3. Update `PROGRESS.md` at meaningful milestones.
4. Record design notes under `notes/`.
5. Put release or verification evidence under `findings/proof/`.

## Evidence Bar

A shipped engineering claim needs:

- changed behavior
- changed surfaces
- validation command/result or explicit skipped-gate reason
- docs/changelog impact when user-visible
- known risks
- next safe action

## Artifact Routing

- Put scope notes, decisions, and design sketches in `notes/`.
- Put operator-provided inputs in `human/`.
- Put raw implementation ideas in `ideas/`; mark operator ideas with `[HUMAN]`.
- Put patches, recipes, config snippets, or migration notes in `findings/code/`.
- Put validation output, release evidence, screenshots, and receipts in `findings/proof/`.
- Put handoff summaries and acceptance reports in `findings/results/`.

## Status Discipline

Use `active`, `paused`, `done`, or `archived`. Do not use `blocked`. If progress
depends on a credential, decision, capacity, or another owner, keep the Effort
active or paused and write the exact blocker, evidence, next owner, and next
safe action in `PROGRESS.md`.

## Done

Done means implementation landed or was intentionally stopped by the operator,
validation status is recorded, docs/changelog impact is handled, and handoff
explains behavior, evidence, risks, and follow-up.
