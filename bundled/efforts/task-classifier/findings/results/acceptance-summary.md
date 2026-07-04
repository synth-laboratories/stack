# Acceptance summary

## A0 - Effort walkthrough

Status: pending

Evidence to record:

- Effort id:
- Folder ref:
- Template:
- Created by:
- Visible in CLI:
- Visible in MCP:
- Visible in TUI:
- Bound meta-thread id:
- Human idea file:
- Progress entry:

## A1 - local optimizer proof

Status: pending

Evidence to record:

- Local optimizer run id:
- Container/config path:
- Candidate artifact path:
- Visible split result:
- Heldout scorecard path:
- Research log entry:

## A2 - hosted GEPA graduation

Status: optional, not recorded

Evidence to record:

- Hosted optimizer run id:
- Environment:
- Factory id:
- Project id:
- Hosted/backend Effort id:
- Submitted config path:
- Candidate artifact path:
- Hosted artifact preview/download path:
- Pull receipt path:
- Effort-local receipt sidecar path:
- Scorecard or event-log path:
- Effort refs updated:
- Research log entry:

Decision:

- Same or equivalent container/config path as A1: pending

## A3 - synth-ai SMR harness proof

Status: optional, not recorded

Evidence to record:

- SMR run id:
- Environment:
- Project id:
- Harness/container ref:
- Run receipt path:
- WorkProduct or artifact path:
- Pull receipt path:
- Effort-local receipt sidecar path:
- Scorecard path:
- Effort refs updated:
- Research log entry:

Decision:

- SMR harness reproduced the task-classifier evidence path: pending

## A4 - synth-ai SMR/Tinker proof

Status: optional, not recorded

Evidence to record:

- Tinker run id or equivalent SMR run id:
- Environment:
- Model/data refs:
- Training or optimization config path:
- Output artifact path:
- Pull receipt path:
- Effort-local receipt sidecar path:
- Evaluation or scorecard path:
- Caveats:
- Effort refs updated:
- Research log entry:

Decision:

- Tinker or training-style proof is strong enough to cite: pending

## Graduation rule

Refs in `effort.toml` are navigation only. A2-A4 require proof artifacts under
`findings/proof/`, recipes/configs under `findings/code/`, and a
`research_log.md` entry naming the run id, environment, result, and caveats.
When evidence comes from `stack_pull_artifact`, record the returned receipt with
`stack effort finding --receipt-path` or `stack_effort_record_finding`. When
evidence is local/ad-hoc, record it with `stack effort finding --path` or
`stack_effort_record_finding path=<file-or-directory>`. Cite the generated
Effort-local `.receipt.json` sidecar in the section above.

## Decision

Effort primitive passed A0/A1: pending
