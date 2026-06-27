# Stack MCP Tool Reference

Use these tools through the Stack MCP server when available.

## Overview

- `stack_status`: concise Codex-facing bridge status. Use first.
- `stack_live_status`: full live-ops payload. Use when the concise status is not enough.
- `stack_list_live_smrs`: recent remote SMR runs with output/message/file counts.
- `stack_list_factories`: remote Research Factories with project/run routing hints.
- `stack_list_hosted_optimizer_runs`: hosted optimizer runs with artifact/event hints.

## README-Smoke

- `stack_launch_read_smoke`: start the configured README-smoke eval.
- `stack_start_readme_smoke_eval`: lower-level alias for launch.
- `stack_readme_smoke_eval_status`: launcher status, parsed ids, verifier context, and output tail.

## Remote SMR

- `stack_message_live_run`: send an operator message to a run.
- `stack_control_live_run`: pause, resume, or stop a run.
- `stack_upload_run_file`: upload a local file to a run.
- `stack_preview_run_output`: preview a WorkProduct or artifact.
- `stack_download_run_output`: save a WorkProduct or artifact.

## Factories

- `stack_message_factory_project`: send an operator message through the Factory-owned route.

## Hosted Optimizers

- `stack_preview_hosted_optimizer_artifact`: preview a hosted optimizer artifact.
- `stack_download_hosted_optimizer_artifact`: save a hosted optimizer artifact.
- `stack_cancel_hosted_optimizer`: request hosted optimizer cancellation.

## Saved Downloads

- `stack_list_saved_downloads`: list Stack's persisted download history.
- `stack_preview_saved_download`: preview a previously saved download without calling the backend.
