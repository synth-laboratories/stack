# System Optimizer Research Playbook

## Purpose

Use this Effort for optimizer systems such as Reflexion, MAPO, memory, intervention policies, or harness-level improvement loops.

## Start

1. Write the system hypothesis.
2. Define baseline behavior and failure mode.
3. Define the intervention surface.
4. Define attribution receipts before optimizing.
5. Add operator ideas under `ideas/[HUMAN]-*.md`.

## Resume / Orientation

Before acting in an existing Effort:

1. Read `effort.toml`, this `PLAYBOOK.md`, `PROGRESS.md`, `ACTIVITY.jsonl`, and `research_log.md`.
2. Use `stack effort activity <effort> --limit 20` or `stack_effort_activity` when the timeline tail in `stack effort show` / `stack_effort_get` is not enough.
3. Inspect `human/`, `[HUMAN]` ideas, `findings/proof/`, and prior mechanism reports before adding a new mechanism.
4. Check bound meta-threads and refs; bind the current thread or attach new optimizer/SMR/Tinker refs only through typed Stack tools.

## Loop

1. Build the smallest real substrate.
2. Run baseline.
3. Add one mechanism.
4. Measure win/harm/flat and delivery failures separately.
5. Record receipts, run artifacts, event/lever examples, and operator corrections in `research_log.md`.
6. Promote only mechanisms with evidence into `findings/ideas/` or `findings/code/`.

## Evidence Bar

A mechanism claim needs:

- baseline vs intervention
- attribution evidence
- delivery metrics
- harm accounting
- reproduce command
- artifact paths
- actual run/event examples; for Reflexion-style work, cite context updates and lever events from real rollouts

## Artifact Routing

- Keep raw mechanism ideas in `ideas/`; mark operator ideas with `[HUMAN]`.
- Put optimizer configs, prompts, policies, monitor profiles, memory formats,
  Reflexion/MAPO loop configs, and harness patches in `findings/code/`.
- Put traces, rollouts, failure stores, memory updates, policy events, monitor
  outputs, MLDP lessons, and labeled corpora in `findings/data/`.
- Put attribution receipts, scorecards, and heldout/transfer evidence in `findings/proof/`.
- Put mechanism reports and acceptance summaries in `findings/results/`.

## Status Discipline

Use `active`, `paused`, `done`, or `archived`. Do not use `blocked`. If progress
depends on a credential, decision, capacity, or another owner, keep the Effort
active or paused and write the exact blocker, evidence, next owner, and next
safe action in `PROGRESS.md`.

## Done

Done means the mechanism is reproducible, proof gaps are explicit, harms and
delivery misses are accounted for, and the next substrate or benchmark is named.
