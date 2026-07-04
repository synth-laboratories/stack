# Task Classifier Research Playbook

## Purpose

Use this Effort for classifier/task-family optimization such as Banking77: prompt, model, data, harness, and scoring improvements.

## Start

1. Freeze the baseline.
2. Define visible/train split.
3. Define heldout/proof split.
4. Record the scoring metric.
5. Save seed inputs under `findings/data/`.
6. Add initial hypotheses under `ideas/`.

## Resume / Orientation

Before acting in an existing Effort:

1. Read `effort.toml`, this `PLAYBOOK.md`, `PROGRESS.md`, `ACTIVITY.jsonl`, and `research_log.md`.
2. Use `stack effort activity <effort> --limit 20` or `stack_effort_activity` when the timeline tail in `stack effort show` / `stack_effort_get` is not enough.
3. Inspect `human/`, `[HUMAN]` ideas, `findings/results/acceptance-summary.md`, `findings/proof/`, and prior candidate configs before changing the classifier route.
4. Check bound meta-threads and refs; bind the current thread or attach new optimizer/SMR/Tinker refs only through typed Stack tools.

## Loop

1. Record candidate prompt/model/data/harness config.
2. Run visible split.
3. Compare to baseline.
4. Track win/harm/flat and variance.
5. Promote only promising candidates to heldout.
6. Save scorecards under `findings/proof/`.

## Watchouts

- Do not tune on heldout.
- Do not call visible-only wins final.
- Do not hide failed candidates if they teach something.
- Do not overclaim from one lucky run.

## Done

Done means champion recipe in `findings/code/`, heldout scorecard in `findings/proof/`, final report in `findings/results/`, and unresolved ideas left in `ideas/`.

## Banking77 Acceptance

For the Banking77 Efforts acceptance run, fill `findings/results/acceptance-summary.md`.
The task-classifier template seeds the A0-A4 criteria into `effort.toml`; keep
that list current as evidence is attached.

- A0 proves scaffold, CLI/MCP/TUI visibility, a bound meta-thread, one `[HUMAN]` idea, and a progress entry.
- A1 proves local optimizer evidence: run id, candidate artifact, visible result, heldout scorecard, and research log entry.
- A2 proves hosted GEPA graduation when available.
- A3 proves synth-ai SMR harness evidence.
- A4 proves synth-ai SMR/Tinker evidence.

A0 + A1 are required for Efforts v1. A2-A4 are stronger full-stack proofs.
Record hosted optimizer, SMR, Factory, Project, or Tinker refs through
`stack effort refs` / `stack_effort_update_refs`; use `--tinker-run-id` or
`tinker_run_id` for Tinker-backed proof.

Refs alone do not satisfy A2-A4. A hosted graduation claim also needs artifact
evidence under `findings/proof/`, the config or recipe under `findings/code/`,
and a research-log entry that names the run id, environment, result, and caveats.
When evidence starts as a hosted optimizer artifact or saved SMR/WorkProduct
download, pull it with `stack_pull_artifact` and attach the returned receipt
with `stack effort finding --receipt-path <receipt>` or
`stack_effort_record_finding receipt_path=<receipt>`. For local/ad-hoc
evidence, use `stack effort finding --path <file-or-directory>` or
`stack_effort_record_finding path=<file-or-directory>`; Stack writes the
Effort-local source receipt sidecar directly.

## Artifact Routing

- Save visible/train examples, heldout examples, traces, and splits under `findings/data/`.
- Save candidate prompts, model configs, hosted GEPA configs, Tinker configs,
  and harness recipes under `findings/code/`.
- Save scorecards, receipts, hosted artifact downloads/previews, SMR
  WorkProduct receipts, and heldout evidence under `findings/proof/`.
- Prefer pulled-artifact receipts for hosted/saved/local evidence that should
  be traceable across local and hosted lanes; keep the generated `.receipt.json`
  sidecar with the finding.
- Save acceptance summaries and final reports under `findings/results/`.
- Keep raw hypotheses in `ideas/`; mark operator ideas with `[HUMAN]`.

## Status Discipline

Use `active`, `paused`, `done`, or `archived`. Do not use `blocked`. If progress
depends on a credential, decision, capacity, or another owner, keep the Effort
active or paused and write the exact blocker, evidence, next owner, and next
safe action in `PROGRESS.md`.
