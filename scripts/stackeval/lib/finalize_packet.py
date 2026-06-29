#!/usr/bin/env python3
"""Finalize a StackEval packet and update latest.json."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config-json", required=True)
    parser.add_argument("--packet-dir", required=True)
    args = parser.parse_args()

    config = json.loads(Path(args.config_json).read_text())
    packet = Path(args.packet_dir)
    trace_root = Path(config["paths"]["trace_root"])
    latest = {
        "task_id": config["task"]["id"],
        "packet_dir": str(packet),
        "stamp": packet.name,
        "preset": config["preset"]["name"],
        "status": "pipeline_complete",
        "updated_at": utc_now(),
    }
    for name in ("harvest.json", "grade.json", "review.json", "harness.json"):
        path = packet / name
        if path.is_file():
            latest[name.replace(".json", "")] = str(path)
    (trace_root / "latest.json").write_text(json.dumps(latest, indent=2) + "\n")

    meta_path = packet / "metadata.json"
    if meta_path.is_file():
        meta = json.loads(meta_path.read_text())
        meta["status"] = "pipeline_complete"
        meta["finished_at"] = utc_now()
        meta_path.write_text(json.dumps(meta, indent=2) + "\n")
    update_acceptance(packet)
    update_waste(packet)
    return 0


def update_acceptance(packet: Path) -> None:
    acc_path = packet / "acceptance.md"
    harvest = load_json(packet / "harvest.json")
    grade = load_json(packet / "grade.json")
    review = load_json(packet / "review.json")
    export_manifest = packet / "stack-session" / "stackd-export" / "manifest.json"
    gates = [
        ("SE-B77-1-HARNESS", (packet / "gepa_config.toml").is_file() and (packet / "harness.json").is_file(), "gepa_config.toml; harness.json"),
        ("SE-B77-2-RUN", nested(harvest, "result", "terminal_status") == "completed", "harvest.json terminal_status=completed"),
        ("SE-B77-3-SCORE", nested(harvest, "result", "heldout_accuracy_percent") is not None, "harvest.json heldout_accuracy_percent"),
        ("SE-B77-4-ARTIFACTS", bool(nested(harvest, "artifacts", "manifest")), "harvest.json artifacts.manifest"),
        ("SE-B77-5-TRACE", export_manifest.is_file(), "stack-session/stackd-export/manifest.json"),
        ("SE-B77-6-LEVERAGE", grade is not None and review is not None, "grade.json; review.json"),
    ]
    lines = [
        "# Acceptance Checklist",
        "",
        "| Gate | Status | Evidence |",
        "| --- | --- | --- |",
    ]
    for gate, ok, evidence in gates:
        lines.append(f"| {gate} | {'pass' if ok else 'fail'} | {evidence} |")
    if harvest:
        lines.extend([
            "",
            "## Pipeline Harvest Verdict",
            "",
            f"- Terminal status: **{nested(harvest, 'status') or 'unknown'}**",
            f"- Heldout accuracy: **{nested(harvest, 'result', 'heldout_accuracy_percent') or 'n/a'}%**",
            f"- Prompt accepted: **{nested(harvest, 'result', 'prompt_accepted')}** ({nested(harvest, 'result', 'acceptance_reason') or 'n/a'})",
            f"- Preset gates: prompt_ok={nested(harvest, 'preset_gates', 'prompt_accepted_ok')} heldout_lift_ok={nested(harvest, 'preset_gates', 'heldout_lift_ok')}",
        ])
    if grade:
        lines.extend([
            "",
            "## Grade",
            "",
            f"- Status: **{nested(grade, 'status') or 'unknown'}**",
            f"- Task outcome: **{nested(grade, 'task_outcome_score')}/5**",
            f"- Stack leverage: **{nested(grade, 'stack_leverage_score')}/5**",
        ])
    if review:
        reviewed = nested(review, "reviewed_scores") or {}
        lines.extend([
            "",
            "## Review",
            "",
            f"- Status: **{nested(review, 'status') or 'unknown'}**",
            f"- Task outcome: **{nested(reviewed, 'task_outcome_score')}/5**",
            f"- Stack leverage: **{nested(reviewed, 'stack_leverage_score')}/5**",
        ])
    acc_path.write_text("\n".join(lines) + "\n")


def update_waste(packet: Path) -> None:
    waste_path = packet / "waste.md"
    grade = load_json(packet / "grade.json") or {}
    items = nested(grade, "waste", "items")
    lines = [
        "# Waste Ledger",
        "",
        "| Friction | Time lost | Evidence | Stack leverage that would help |",
        "| --- | --- | --- | --- |",
    ]
    if isinstance(items, list) and items:
        for item in items:
            if not isinstance(item, dict):
                continue
            lines.append(
                "| "
                + " | ".join(
                    [
                        table_cell(item.get("friction", "unknown")),
                        table_cell(item.get("time_lost", "unknown")),
                        table_cell(item.get("evidence", "unknown")),
                        table_cell(item.get("stack_leverage_that_would_help", item.get("guard", "none"))),
                    ]
                )
                + " |"
            )
    else:
        lines.append("| none observed | 0m | grade.json; review.json | n/a |")
    waste_path.write_text("\n".join(lines) + "\n")


def load_json(path: Path) -> dict | None:
    if not path.is_file():
        return None
    value = json.loads(path.read_text())
    return value if isinstance(value, dict) else None


def nested(value: object, *keys: str) -> object:
    node = value
    for key in keys:
        if not isinstance(node, dict):
            return None
        node = node.get(key)
    return node


def table_cell(value: object) -> str:
    return str(value).replace("|", "\\|").replace("\n", " ").strip()


if __name__ == "__main__":
    raise SystemExit(main())
