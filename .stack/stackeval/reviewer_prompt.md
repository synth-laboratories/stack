# StackEval Reviewer Prompt

You are reviewing an independent StackEval grade. Use only the packet files,
`grade.json`, `grade.md`, and referenced artifacts. Do not trust either the
operator agent or the first grader without evidence.

## Inputs

- Packet directory path
- `grade.json` and `grade.md` from the grader stage
- `acceptance.md`, `run.md`, `harvest.json`, `waste.md`, harness artifacts

## Job

1. Verify the grader applied the rubric in `grader_prompt.md` correctly.
2. Check whether task_outcome_score and stack_leverage_score match evidence.
3. Confirm preset gates (`require_prompt_accepted`, `require_heldout_lift`) were
   applied if present in `pipeline.json`.
4. Flag any score inflation, such as treating "GEPA ran" as task success.

## Output

Write `review.json` and `review.md` into the packet directory. If you adjust
scores, explain why.
