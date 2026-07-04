# Research Effort Playbook

## Purpose

Use this Effort for uncertain, evidence-seeking work: optimization, evals, model behavior, retrieval, Reflexion, task-family exploration, or research prototypes.

## Start

1. Write the research question in `PROGRESS.md`.
2. Record the baseline and current best known result.
3. Identify visible/train data and heldout/proof data.
4. Start `research_log.md`.
5. Add initial ideas under `ideas/`; mark operator ideas with `[HUMAN]`.

## Resume / Orientation

Before acting in an existing Effort:

1. Read `effort.toml`, this `PLAYBOOK.md`, `PROGRESS.md`, `ACTIVITY.jsonl`, and `research_log.md`.
2. Use `stack effort activity <effort> --limit 20` or `stack_effort_activity` when the timeline tail in `stack effort show` / `stack_effort_get` is not enough.
3. Inspect `human/`, `[HUMAN]` ideas, `findings/results/`, and `findings/proof/` before proposing the next experiment.
4. Check bound meta-threads and refs; bind the current thread or attach new run refs only through typed Stack tools.

## Loop

1. Pick one hypothesis or idea.
2. Run the smallest experiment that can move belief.
3. Record run id, config, seeds, result, and artifact paths.
4. Log the narrative in `research_log.md`: verbatim operator messages, summarized agent work, actual run/evidence table, operator corrections or decisions, and next step.
5. Promote evidence-backed claims into `findings/`.
6. Write the next concrete experiment.

## Evidence Bar

A research claim needs:

- baseline
- intervention/config
- metric
- result
- artifact path
- proof split or heldout evidence when relevant
- caveats and known variance
- actual run ids or artifact paths; do not substitute architecture prose for observed behavior

## Artifact Routing

- Keep raw hypotheses in `ideas/`.
- Mark operator ideas with `[HUMAN]` in the filename and heading.
- Put seeds, splits, traces, and corpora in `findings/data/`.
- Put prompts, configs, harness recipes, and policies in `findings/code/`.
- Put scorecards, receipts, heldout runs, and proof packets in `findings/proof/`.
- Put interim reports and final summaries in `findings/results/`.

## Status Discipline

Use `active`, `paused`, `done`, or `archived`. Do not use `blocked`. If progress
depends on a credential, decision, capacity, or another owner, keep the Effort
active or paused and write the exact blocker, evidence, next owner, and next
safe action in `PROGRESS.md`.

## Done

Done means one of:

- reproducible champion recipe
- falsified route with useful negative result
- clear next experiment requiring new substrate
- handoff with open issues, proof gaps, and reproduce commands
