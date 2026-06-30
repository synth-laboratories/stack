#!/usr/bin/env python3
"""Prepare a StackEval packet skeleton from merged config JSON."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path


def git_rev(root: str | None) -> str | None:
    if not root:
        return None
    try:
        return subprocess.check_output(
            ["git", "-C", root, "rev-parse", "HEAD"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except Exception:
        return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config-json", required=True)
    parser.add_argument("--packet-dir", required=True)
    parser.add_argument("--preset", required=True)
    args = parser.parse_args()

    config = json.loads(Path(args.config_json).read_text())
    packet = Path(args.packet_dir)
    preset = args.preset
    now = datetime.now(timezone.utc).isoformat()
    harness_mode = os.environ.get("STACKEVAL_GEPA_HARNESS_MODE", "cli").strip() or "cli"

    packet.mkdir(parents=True, exist_ok=True)
    (packet / "stack-session").mkdir(parents=True, exist_ok=True)
    (packet / "codex").mkdir(parents=True, exist_ok=True)
    (packet / "artifacts" / "gepa_runs").mkdir(parents=True, exist_ok=True)

    prompt_file = Path(config["resolved"]["prompt_file"])
    (packet / "initial_prompt.txt").write_text(prompt_file.read_text())

    meta = {
        "task_id": config["task"]["id"],
        "created_at": now,
        "status": "pipeline_running",
        "preset": preset,
        "pipeline_mode": config["preset"].get(
            "mode", config["pipeline"].get("default_mode", "harness")
        ),
        "harness_mode": harness_mode,
        "default_model": config["task"].get(
            "default_model", config["stack"]["default_model"]
        ),
        "stack_commit": git_rev(config["paths"].get("stack_root")),
        "packet_dir": str(packet),
        "config_snapshot": config,
    }
    (packet / "metadata.json").write_text(json.dumps(meta, indent=2) + "\n")
    (packet / "preflight.json").write_text(
        json.dumps({"generated_at": now, "preset": preset}, indent=2) + "\n"
    )
    (packet / "acceptance.md").write_text(
        "\n".join(
            [
                "# Acceptance Checklist",
                "",
                "| Gate | Status | Evidence |",
                "| --- | --- | --- |",
                "| SE-B77-1-HARNESS | pending | pipeline harness stage |",
                "| SE-B77-2-RUN | pending | pipeline harness stage |",
                "| SE-B77-3-SCORE | pending | harvest stage |",
                "| SE-B77-4-ARTIFACTS | pending | harvest stage |",
                "| SE-B77-5-TRACE | pending | export stage |",
                "| SE-B77-6-LEVERAGE | pending | grade stage |",
                "",
            ]
        )
    )
    (packet / "waste.md").write_text(
        "\n".join(
            [
                "# Waste Ledger",
                "",
                "| Friction | Time lost | Evidence | Stack leverage that would help |",
                "| --- | --- | --- | --- |",
                "| pending | pending | pending | pending |",
                "",
            ]
        )
    )
    (packet / "run.md").write_text(
        f"# StackEval Run: {config['task']['title']}\n\n"
        f"**Preset:** `{preset}`\n**Status:** pipeline_running\n"
    )
    (packet / "model_policy.md").write_text(
        "\n".join(
            [
                "# Model Policy",
                "",
                f"Default StackEval model: `{meta['default_model']}`",
                "",
                "Harness policy:",
                "",
                f"- Policy model: `{config['harness'].get('policy_model')}`",
                f"- Policy provider: `{config['harness'].get('policy_provider')}`",
                f"- Proposer model: `{config['harness'].get('proposer_model')}`",
                f"- Proposer reasoning effort: `{config['harness'].get('proposer_reasoning_effort')}`",
                "",
                "Monitor policy:",
                "",
                "- Monitor: persistent Codex sidecar thread",
                "- Model: `gpt-5.4-mini`",
                "- Reasoning effort: `medium`",
                "",
                "| Override | Reason | Scope |",
                "| --- | --- | --- |",
                "| none | n/a | n/a |",
                "",
            ]
        )
    )
    (packet / "release_guard.md").write_text(
        "\n".join(
            [
                "# Release Guard",
                "",
                "| Finding | Guard | Evidence |",
                "| --- | --- | --- |",
                "| pending | docs gate, Bombadil, API smoke, or not_applicable | pending |",
                "",
            ]
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
