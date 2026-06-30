# Stack MCP Tool Reference

Use these tools through the Stack MCP server when available.

## Overview

- `stack_status`: concise Codex-facing bridge status. Use first; remote/hosted summaries are runtime-first with direct API fallback.
- `stack_runtime_status`: stackd runtime factory snapshot and recent sensor
  events. Check `events_status`; an empty `events` list is only authoritative
  when `events_status: "ready"`. With `tick: true`, `events_appended` reports
  how many runtime events the tick appended.
- `stack_live_status`: full live-ops payload. Use when the concise status is not enough.
- `stack_list_remote_projects`: Synth projects with associated live/recent SMR runs and linked Factory/cloud badges; runtime-first with direct API fallback, supports `tick`.
- `stack_prepare_cloud_promotion_packet`: local-to-cloud promotion packet from StackEval + runtime state; no mutation.
- `stack_launch_cloud_promotion`: create a cloud launch from a promotion packet; dry-run by default and requires explicit confirm to mutate.
- `stack_get_cloud_launch`: inspect one Managed Research cloud launch.
- `stack_terminate_cloud_launch`: terminate one Managed Research cloud launch.
- `stack_list_live_smrs`: recent remote SMR runs; runtime-first with direct API fallback for output/message/file counts, supports `tick`.
- `stack_inspect_live_run`: one SMR run with WorkProducts, artifacts, runtime messages, file mounts, and hosted artifact status.
- `stack_list_run_interactions`: pending/filtered run questions and approvals.
- `stack_respond_run_question`: answer one run question.
- `stack_decide_run_approval`: approve or deny one run approval.
- `stack_list_factories`: remote Research Factories with project/run routing hints; runtime-first with direct API fallback, supports `tick`.
- `stack_list_hosted_optimizer_runs`: hosted optimizer runs; runtime-first with direct API fallback for artifact/event hints, supports `tick`.

## README-Smoke

- `stack_launch_read_smoke`: start the configured README-smoke eval.
- `stack_start_readme_smoke_eval`: lower-level alias for launch.
- `stack_readme_smoke_eval_status`: launcher status, parsed ids, verifier context, and output tail.

## Remote SMR

- `stack_prepare_cloud_promotion_packet`: build the cloud-promotion receipt from active local evidence and runtime state.
- `stack_launch_cloud_promotion`: dry-run or explicitly confirmed `/smr/v1/launches` creation.
- `stack_get_cloud_launch`: read `/smr/v1/launches/{run_id}`.
- `stack_terminate_cloud_launch`: terminate `/smr/v1/launches/{run_id}`.
- `stack_message_live_run`: send an operator message to a run.
- `stack_control_live_run`: pause, resume, or stop a run.
- `stack_upload_run_file`: upload a local file to a run.
- `stack_list_run_interactions`: list human questions and approvals for a run.
- `stack_respond_run_question`: respond to a pending run question.
- `stack_decide_run_approval`: approve or deny a pending run approval.
- `stack_preview_run_output`: preview a WorkProduct or artifact.
- `stack_download_run_output`: save a WorkProduct or artifact.

## Factories

- `stack_message_factory_project`: send an operator message through the Factory-owned route.

## Hosted Optimizers

- `stack_preview_hosted_optimizer_artifact`: preview a hosted optimizer artifact.
- `stack_download_hosted_optimizer_artifact`: save a hosted optimizer artifact.
- `stack_cancel_hosted_optimizer`: request hosted optimizer cancellation.

Remote mutation tools append best-effort `lever.*` runtime receipts after the
owner-route action returns. Sensors still observe the remote state transition on
the next runtime tick.

## Saved Downloads

- `stack_list_saved_downloads`: list Stack's persisted download history.
- `stack_preview_saved_download`: preview a previously saved download without calling the backend.
