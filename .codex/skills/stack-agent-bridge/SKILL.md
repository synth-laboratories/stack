---
name: stack-agent-bridge
description: Use when Codex operates the Stack cockpit or Stack MCP bridge for Synth live ops — local/remote mode, auth checks, README-smoke SMR evals, live SMRs or Factories, hosted optimizer runs, WorkProduct preview/download, or explaining Stack TUI status. Pair with synth-via-stack for optimizer and container workflows.
---

# Stack Agent Bridge

Use Stack as the control plane between Codex and Synth live operations. Prefer the Stack MCP tools over direct backend calls whenever they are available.

## First Move

1. Call `stack_status` with `mode: "all"` unless the user explicitly asks for local-only or remote-only work.
2. If auth is missing, report the missing env var and expected env-file source without printing secret values.
3. Choose a mode before acting:
   - `local`: local optimizer service, local eval wrapper state, local files.
   - `remote`: remote SMR runs, Factories, hosted optimizer runs, WorkProducts, artifacts.
   - `all`: status overview only; narrow before mutating anything.

If Stack MCP tools are unavailable, read the Stack repo `README.md`, but do not recreate remote actions by scraping databases, Redis, compatibility projections, or backend persistence. Ask the user to launch Stack or expose its MCP server if a live action is required.

For optimizer + container concepts (GEPA, synth-ai, rollout contract), read **`synth-via-stack`**.

## Operator Workflow

For remote SMR work:

1. Call `stack_status` with `mode: "remote"`.
2. Use `stack_list_live_smrs` to choose a run.
3. Use `stack_preview_run_output` before downloading when the user only needs inspection.
4. Use `stack_message_live_run` only when the target run is explicit.
5. Use `stack_control_live_run` only for explicit pause/resume/stop requests.

For Factory work:

1. Call `stack_list_factories`.
2. Prefer factories with `canonical_project_id` or `latest_project_id`.
3. Use `stack_message_factory_project` for operator messages.
4. Include the factory id and project id in the final summary.

For README-smoke proof:

1. Call `stack_launch_read_smoke`.
2. Poll `stack_readme_smoke_eval_status`.
3. Once a run id is known, call `stack_list_live_smrs`.
4. Preview the first WorkProduct with `stack_preview_run_output`.
5. Report project id, run id, terminal status, verifier failures, and preview/download evidence.

For hosted optimizers:

1. Call `stack_list_hosted_optimizer_runs`.
2. If artifact names exist, preview with `stack_preview_hosted_optimizer_artifact`.
3. Use `stack_download_hosted_optimizer_artifact` only when the user asks to save the artifact.
4. Use `stack_cancel_hosted_optimizer` only for explicit cancellation.

For local optimizer work:

1. Use `stack_status` with `mode: "local"`.
2. Treat local optimizer state as local Stack state, not backend state.
3. Do not start or stop shared services outside Stack/synth-dev wrappers unless explicitly asked.

## Guardrails

- Never print raw `SYNTH_API_KEY` or other secrets.
- Never bypass Stack owner routes by reading remote Postgres, raw Redis keys, local SMR databases, or compatibility projections.
- Prefer preview tools before download tools.
- Before mutating a live run, factory, hosted optimizer, or local service, identify the target id in plain language.
- When reporting results, include concrete ids and the Stack tool evidence used.

## Tool Reference

Read `references/mcp-tools.md` when choosing exact Stack MCP tool names, adding bridge tools, or debugging an MCP contract mismatch.
