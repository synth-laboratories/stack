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
- `stack_create_runnable_project`: create a runnable Managed Research project through `POST /smr/projects:runnable`.
- `stack_create_factory`: create a Managed Research Factory through `POST /smr/factories`.
- `stack_deploy_container_pool_runtime`: create a pool runtime image release and bind it; returns the `release_id` needed for pool-backed scoring.
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
- `stack_message_gardener`: durably send an idempotent message to a registered local gardener. Acceptance is asynchronous so the gardener can safely call nested Stack MCP tools; follow with `stack_thread_events_read` and `stack_worker_run_status`.

## README-Smoke

- `stack_launch_read_smoke`: start the configured README-smoke eval.
- `stack_start_readme_smoke_eval`: lower-level alias for launch.
- `stack_readme_smoke_eval_status`: launcher status, parsed ids, verifier context, and output tail.

## Remote SMR

- `stack_prepare_cloud_promotion_packet`: build the cloud-promotion receipt from active local evidence and runtime state.
- `stack_launch_cloud_promotion`: dry-run or explicitly confirmed canonical SMR launch.
- `stack_get_cloud_launch`: read `/smr/runs/{run_id}` with legacy `/smr/v1/launches/{run_id}` fallback.
- `stack_terminate_cloud_launch`: stop `/smr/runs/{run_id}` with legacy `/smr/v1/launches/{run_id}/terminate` fallback.
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

## Container Pools

- `stack_list_container_pools`: list visible container pools through `/v1/pools`.
- `stack_container_health`: read pool or task-scoped `/container/health`.
- `stack_container_rollout`: run pool or task-scoped `/container/rollout`.
- `stack_deploy_container_pool_runtime`: create `/runtime_image_releases`, bind the returned release, and return `release_id`.

## Hosted Optimizers

- `stack_preview_hosted_optimizer_artifact`: preview a hosted optimizer artifact.
- `stack_download_hosted_optimizer_artifact`: save a hosted optimizer artifact.
- `stack_cancel_hosted_optimizer`: request hosted optimizer cancellation.

Remote mutation tools append best-effort `lever.*` runtime receipts after the
owner-route action returns. Sensors still observe the remote state transition on
the next runtime tick.

## Round-Trip Artifacts

Typed artifact kinds: `champion_prompt`, `adapter_weights`, `dataset`, `eval_table`.
Every verb writes a provenance receipt (run id, sha256 digest, backend target,
git SHA) under `.stack/evidence/roundtrip/`.

- `stack_pull_artifact`: pull a typed hosted or saved artifact into the workspace.
- `stack_apply_artifact`: patch a pulled champion_prompt into a harness config.
- `stack_push_artifact`: upload a typed workspace artifact to an SMR run.

## Saved Downloads

- `stack_list_saved_downloads`: list Stack's persisted download history.
- `stack_preview_saved_download`: preview a previously saved download without calling the backend.
