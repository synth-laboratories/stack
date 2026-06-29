# StackEval Grader Prompt

You are grading one StackEval packet. Use only the packet files and referenced
local artifacts as evidence. Do not trust the agent's final prose unless it is
backed by paths, command output, manifests, logs, or trace files.

## Inputs

- Packet path
- Task spec under `.stack/stackeval/tasks/`
- Packet files such as `acceptance.md`, `run.md`, `metadata.json`,
  `preflight.json`, `model_policy.md`, `waste.md`, and `release_guard.md`
- Referenced result artifacts, logs, manifests, prompt/config files, and traces

## Required Checks

1. Identify the requested task objective and exact requested model/policy.
2. Verify every acceptance gate from packet evidence.
3. Check whether the exact requested run succeeded, failed, or was replaced by
   an override/equivalent.
4. Verify the benchmark score from a manifest or scorer artifact.
5. Verify selected prompt/model/config paths exist or are quoted with enough
   context to reproduce.
6. Verify trace quality: Stack session, Codex transcript, command logs, or
   equivalent operator trace.
7. Extract wasted time and classify which issues should become release guards.

## Scores

Return two 0-5 scores:

- `task_outcome_score`: benchmark objective quality.
- `stack_leverage_score`: how much Stack helped the operator.

Use `status` from this set:

- `pass`
- `pass_with_override`
- `partial`
- `fail_with_evidence`
- `fail_without_evidence`

Rules:

- Use `pass` only when the exact requested run reaches the objective, packet
  evidence is complete, and both scores are at least 4/5.
- Use `pass_with_override` only when a fresh run reaches the objective with a
  minor justified override, packet evidence is complete, and both scores are at
  least 4/5.
- Use `partial` when there is useful progress but either score is below 4/5,
  including cases where the packet accepts a prior/equivalent result after the
  exact fresh run failed.
- Use `fail_with_evidence` when the task fails but the packet clearly captures
  owner, evidence, and next action.
- Use `fail_without_evidence` when the packet is too incomplete to judge.

Caps:

- If the exact requested fresh run failed and the packet uses a prior/equivalent
  result, cap `task_outcome_score` at 3.
- If a material model/policy override was required, cap `task_outcome_score` at
  3 unless the task explicitly allowed that override before launch.
- If the operator had to do significant manual packet discovery, broad workspace
  search, model-route debugging, or terminal-equivalent selection, cap
  `stack_leverage_score` at 3.
- Reserve 4/5 and 5/5 for clear or near successes. 80%+ must mean launch-grade
  or very close to launch-grade, not merely useful progress.

## Output

Write `grade.json` and `grade.md` into the packet directory.
