# Non-verifiable Task Research Playbook

## Purpose

Use this Effort for rubric-graded or judgment-heavy tasks where measurement quality is part of the research.

## Start

1. Define the rubric and evaluator.
2. Record calibration examples.
3. Separate visible development from proof examples.
4. Track human rubric ideas under `ideas/[HUMAN]-*.md`.

## Resume / Orientation

Before acting in an existing Effort:

1. Read `effort.toml`, this `PLAYBOOK.md`, `PROGRESS.md`, `ACTIVITY.jsonl`, and `research_log.md`.
2. Use `stack effort activity <effort> --limit 20` or `stack_effort_activity` when the timeline tail in `stack effort show` / `stack_effort_get` is not enough.
3. Inspect `human/`, `[HUMAN]` ideas, calibration examples, judge outputs, and `findings/proof/` before changing rubric or candidate behavior.
4. Check bound meta-threads and refs; bind the current thread or attach new run refs only through typed Stack tools.

## Loop

1. Pick one candidate behavior or rubric dimension.
2. Run examples through the evaluator.
3. Inspect calibration failures and disagreements.
4. Change one prompt, rubric, judge, sampling, or evidence policy.
5. Save examples and evaluator outputs.
6. Promote only claims with calibration evidence into `findings/`.

## Evidence Bar

A nonverifiable-task claim needs rubric version, evaluator identity, calibration
examples, candidate outputs, judge outputs, disagreement notes, caveats, and
proof examples that were not tuned directly.

## Artifact Routing

- Put calibration examples, proof examples, and judge traces in `findings/data/`.
- Put rubric versions, evaluator prompts, candidate prompts, and harness configs in `findings/code/`.
- Put judge outputs, review receipts, and proof packets in `findings/proof/`.
- Put summaries and acceptance reports in `findings/results/`.

## Status Discipline

Use `active`, `paused`, `done`, or `archived`. Do not use `blocked`. If progress
depends on a credential, decision, capacity, or another owner, keep the Effort
active or paused and write the exact blocker, evidence, next owner, and next
safe action in `PROGRESS.md`.

## Done

Done means the rubric, evaluator behavior, candidate recipe, and proof examples are recorded with caveats.
