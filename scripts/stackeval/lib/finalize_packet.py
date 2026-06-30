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
        if load_json(path) is not None:
            latest[name.replace(".json", "")] = str(path)
    trace_root.mkdir(parents=True, exist_ok=True)
    (trace_root / "latest.json").write_text(json.dumps(latest, indent=2) + "\n")

    meta_path = packet / "metadata.json"
    if meta_path.is_file():
        meta = json.loads(meta_path.read_text())
        meta["status"] = "pipeline_complete"
        meta["finished_at"] = utc_now()
        meta_path.write_text(json.dumps(meta, indent=2) + "\n")
    update_acceptance(packet, config)
    update_waste(packet)
    return 0


def score_present(harvest: dict | None) -> bool:
    if not harvest:
        return False
    result = harvest.get("result")
    if not isinstance(result, dict):
        return False
    if result.get("heldout_accuracy") is not None:
        return True
    if result.get("heldout_accuracy_percent") is not None:
        return True
    return result.get("heldout_reward") is not None


def gate_rows(
    gate_ids: list[str],
    packet: Path,
    harvest: dict | None,
    grade: dict | None,
    review: dict | None,
    export_manifest: Path,
    preset: dict | None,
) -> list[tuple[str, bool, str]]:
    checks: dict[str, tuple[bool, str]] = {}
    harness_ok, harness_evidence = harness_receipt_ok(packet)
    for gate_id in gate_ids:
        if gate_id.endswith("-HARNESS") or "-HARNESS" in gate_id:
            checks[gate_id] = (harness_ok, harness_evidence)
        elif gate_id.endswith("-RUN") or "-RUN" in gate_id:
            checks[gate_id] = (
                nested(harvest, "result", "terminal_status") == "completed",
                "harvest.json terminal_status=completed",
            )
        elif gate_id.endswith("-SCORE") or "-SCORE" in gate_id:
            checks[gate_id] = (score_present(harvest), "harvest.json heldout score")
        elif gate_id.endswith("-ARTIFACTS") or "-ARTIFACTS" in gate_id:
            checks[gate_id] = (
                bool(nested(harvest, "artifacts", "manifest")),
                "harvest.json artifacts.manifest",
            )
        elif gate_id.endswith("-TRACE") or "-TRACE" in gate_id:
            runtime_ok, runtime_evidence = runtime_trace_ok(packet, export_manifest)
            checks[gate_id] = (runtime_ok, runtime_evidence)
        elif gate_id.endswith("-LEVERAGE") or "-LEVERAGE" in gate_id:
            leverage_ok, leverage_evidence = grade_review_ok(grade, review, preset)
            checks[gate_id] = (leverage_ok, leverage_evidence)
        else:
            checks[gate_id] = (False, "unknown gate kind")
    return [(gate_id, checks[gate_id][0], checks[gate_id][1]) for gate_id in gate_ids]


def grade_review_ok(
    grade: dict | None,
    review: dict | None,
    preset: dict | None,
) -> tuple[bool, str]:
    if grade is None or review is None:
        return False, "missing grade.json or review.json"

    min_task = numeric_score(nested(preset, "min_task_outcome_score"))
    min_stack = numeric_score(nested(preset, "min_stack_leverage_score"))
    if min_task is None:
        min_task = 0.0
    if min_stack is None:
        min_stack = 0.0

    task_score = effective_reviewed_score(review, grade, "task_outcome_score")
    stack_score = effective_reviewed_score(review, grade, "stack_leverage_score")
    review_status = str(
        nested(review, "verdict")
        or nested(review, "status")
        or nested(review, "review_status")
        or "unknown"
    ).lower()
    review_rejected = review_status in {"reject", "rejected", "fail", "failed"}
    scores_ok = (
        task_score is not None
        and stack_score is not None
        and task_score >= min_task
        and stack_score >= min_stack
    )
    evidence = (
        "grade.json; review.json "
        f"task={score_label(task_score)}/{score_label(min_task)} "
        f"stack={score_label(stack_score)}/{score_label(min_stack)} "
        f"review={review_status}"
    )
    if review_rejected:
        return False, evidence + "; reviewer rejected grade"
    if not scores_ok:
        return False, evidence + "; below preset minimum score"
    return True, evidence


def effective_reviewed_score(review: dict, grade: dict, score_key: str) -> float | None:
    reviewed = nested(review, "reviewed_scores")
    adjusted_key = f"adjusted_{score_key}"
    for value in [
        nested(reviewed, score_key),
        nested(review, adjusted_key),
        nested(review, score_key),
        nested(grade, score_key),
    ]:
        score = numeric_score(value)
        if score is not None:
            return score
    return None


def numeric_score(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def score_label(value: float | None) -> str:
    if value is None:
        return "missing"
    if value.is_integer():
        return str(int(value))
    return str(value)


def harness_receipt_ok(packet: Path) -> tuple[bool, str]:
    gepa_config = packet / "gepa_config.toml"
    harness_path = packet / "harness.json"
    metadata = load_json(packet / "metadata.json") or {}
    harness = load_json(harness_path)
    if not gepa_config.is_file() or harness is None:
        return False, "missing gepa_config.toml or harness.json"

    harness_mode = str(metadata.get("harness_mode") or harness.get("harness_mode") or "cli")
    if harness_mode != "service":
        return True, "gepa_config.toml; harness.json"

    service_status = str(harness.get("service_status") or "").lower()
    service_phase = str(harness.get("service_phase") or "").lower()
    service_autostarted = bool(harness.get("service_autostarted"))
    service_run = harness.get("service_run") if isinstance(harness.get("service_run"), dict) else {}
    required = {
        "service_receipt_schema": harness.get("service_receipt_schema") == "stackeval.gepa.service_receipt.v1",
        "service_run_schema": harness.get("service_run_schema") == "stackeval.gepa.service_run_summary.v1",
        "service_url": nonempty_str(harness.get("service_url")),
        "container_url": nonempty_str(harness.get("container_url")),
        "service_submit_mode": str(harness.get("service_submit_mode") or "") in {"json", "config_path"},
        "service_request_path": nonempty_str(harness.get("service_request_path")),
        "run_id": nonempty_str(harness.get("run_id")),
        "service_status": service_status in {"succeeded", "completed", "complete", "done"},
        "service_phase": service_phase in {"completed", "complete", "done", "succeeded"},
        "service_run": bool(service_run),
    }
    if required["service_run"]:
        required["service_run.run_id"] = service_run.get("run_id") == harness.get("run_id")
        required["service_run.status"] = str(service_run.get("status") or "").lower() == service_status

    if service_autostarted:
        required.update(
            {
                "service_pid": isinstance(harness.get("service_pid"), int),
                "service_log": nonempty_str(harness.get("service_log")),
                "service_start_command": nonempty_str_list(harness.get("service_start_command")),
                "service_start_cwd": nonempty_str(harness.get("service_start_cwd")),
                "service_db_path": nonempty_str(harness.get("service_db_path")),
            }
        )

    missing = [key for key, ok in required.items() if not ok]
    evidence = (
        "gepa_config.toml; harness.json "
        f"harness_mode=service submit={harness.get('service_submit_mode')} "
        f"status={harness.get('service_status')} autostarted={service_autostarted}"
    )
    if missing:
        return False, evidence + "; missing/invalid " + ", ".join(missing)
    return True, evidence


def runtime_trace_ok(packet: Path, export_manifest: Path) -> tuple[bool, str]:
    runtime_dir = packet / "stack-runtime"
    trace_path = packet / "codex" / "trace.json"
    tick_path = runtime_dir / "tick.json"
    factory_path = runtime_dir / "factory.json"
    events_path = runtime_dir / "events.json"
    stackeval_events_path = runtime_dir / "stackeval-events.json"
    status_path = runtime_dir / "status.json"
    required = [
        export_manifest,
        trace_path,
        tick_path,
        factory_path,
        events_path,
        stackeval_events_path,
        status_path,
    ]
    missing = [str(path.relative_to(packet)) for path in required if not path.is_file()]
    if missing:
        return False, append_trace_diagnostics(packet, "missing " + ", ".join(missing))

    tick = load_json(tick_path)
    factory = load_json(factory_path)
    events_doc = load_json(events_path)
    stackeval_events_doc = load_json(stackeval_events_path)
    status = load_json(status_path)
    if (
        tick is None
        or factory is None
        or events_doc is None
        or stackeval_events_doc is None
        or status is None
    ):
        return False, append_trace_diagnostics(packet, "runtime export contains invalid JSON")

    event_count = len(events_doc.get("events") or []) if isinstance(events_doc.get("events"), list) else -1
    stackeval_event_count = stackeval_runtime_event_count(stackeval_events_doc, packet.name)
    status_runtime = status.get("runtime") if isinstance(status.get("runtime"), dict) else {}
    status_factory = status_runtime.get("factory") if isinstance(status_runtime.get("factory"), dict) else None
    checks = [
        tick.get("status") == "ready",
        isinstance(tick.get("events_appended"), int),
        isinstance(tick.get("snapshot"), dict),
        factory.get("status") == "ready",
        isinstance(factory.get("events_appended"), int),
        isinstance(factory.get("snapshot"), dict),
        event_count > 0,
        stackeval_event_count > 0,
        isinstance(status_factory, dict),
        isinstance(status_runtime.get("events_appended"), int),
    ]
    evidence = (
        "stack-session/stackd-export/manifest.json; "
        "codex/trace.json; "
        f"stack-runtime/tick.json status={tick.get('status')} events_appended={tick.get('events_appended')}; "
        f"stack-runtime/factory.json status={factory.get('status')} events_appended={factory.get('events_appended')}; "
        f"stack-runtime/events.json events={event_count} stackeval_events={stackeval_event_count}; "
        "stack-runtime/stackeval-events.json source=lever.stackeval; "
        "stack-runtime/status.json runtime.factory"
    )
    if not all(checks):
        return False, append_trace_diagnostics(packet, evidence + "; runtime content check failed")
    return True, evidence


def append_trace_diagnostics(packet: Path, evidence: str) -> str:
    diagnostics = trace_diagnostics(packet)
    if not diagnostics:
        return evidence
    return evidence + "; diagnostics: " + "; ".join(diagnostics)


def trace_diagnostics(packet: Path) -> list[str]:
    diagnostics: list[str] = []
    pipeline = load_json(packet / "pipeline.json") or {}
    stages = pipeline.get("stages")
    if isinstance(stages, list):
        for stage in reversed(stages):
            if not isinstance(stage, dict) or stage.get("stage") != "export":
                continue
            status = stage.get("status")
            detail = stage.get("detail")
            if status and status != "ok":
                diagnostics.append(f"pipeline export={status} detail={detail or 'none'}")
            break

    for path in sorted((packet / "stack-session").glob("*-error.log")):
        diagnostics.append(error_log_summary(packet, path))
    for path in sorted((packet / "stack-runtime").glob("*-error.log")):
        diagnostics.append(error_log_summary(packet, path))
    return [item for item in diagnostics if item]


def error_log_summary(packet: Path, path: Path) -> str:
    try:
        text = path.read_text(errors="replace").strip().splitlines()
    except OSError:
        return ""
    first_line = text[0].strip() if text else "empty"
    if len(first_line) > 160:
        first_line = first_line[:157] + "..."
    return f"{path.relative_to(packet)}: {first_line}"


def stackeval_runtime_event_count(events_doc: dict, packet_id: str) -> int:
    events = events_doc.get("events")
    if not isinstance(events, list):
        return 0
    count = 0
    for event in events:
        if not isinstance(event, dict):
            continue
        event_type = str(event.get("event_type") or "")
        if not event_type.startswith("lever.stackeval.gepa."):
            continue
        payload = event.get("payload")
        if not isinstance(payload, dict):
            continue
        if payload.get("stackeval_packet_id") == packet_id:
            count += 1
    return count


def update_acceptance(packet: Path, config: dict | None = None) -> None:
    acc_path = packet / "acceptance.md"
    harvest = load_json(packet / "harvest.json")
    grade = load_json(packet / "grade.json")
    review = load_json(packet / "review.json")
    export_manifest = packet / "stack-session" / "stackd-export" / "manifest.json"
    acceptance = (config or {}).get("acceptance") or {}
    gate_ids = acceptance.get("gates")
    if not isinstance(gate_ids, list) or not gate_ids:
        gate_ids = [
            "SE-B77-1-HARNESS",
            "SE-B77-2-RUN",
            "SE-B77-3-SCORE",
            "SE-B77-4-ARTIFACTS",
            "SE-B77-5-TRACE",
            "SE-B77-6-LEVERAGE",
        ]
    score_name = acceptance.get("score_label", "Heldout accuracy")
    score_unit = acceptance.get("score_unit", "accuracy_percent")
    gates = gate_rows(gate_ids, packet, harvest, grade, review, export_manifest, (config or {}).get("preset"))
    lines = [
        "# Acceptance Checklist",
        "",
        "| Gate | Status | Evidence |",
        "| --- | --- | --- |",
    ]
    for gate, ok, evidence in gates:
        lines.append(f"| {gate} | {'pass' if ok else 'fail'} | {evidence} |")
    if harvest:
        score_value = nested(harvest, "result", "heldout_accuracy")
        if score_value is None:
            score_value = nested(harvest, "result", "heldout_reward")
        if score_unit == "accuracy_percent":
            score_display = f"{nested(harvest, 'result', 'heldout_accuracy_percent') or 'n/a'}%"
        else:
            score_display = str(score_value if score_value is not None else "n/a")
        lines.extend([
            "",
            "## Pipeline Harvest Verdict",
            "",
            f"- Terminal status: **{nested(harvest, 'status') or 'unknown'}**",
            f"- {score_name}: **{score_display}**",
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
        review_status = (
            nested(review, "status")
            or nested(review, "review_status")
            or nested(review, "verdict")
            or "unknown"
        )
        reviewed_task_score = effective_reviewed_score(review, grade or {}, "task_outcome_score")
        reviewed_stack_score = effective_reviewed_score(review, grade or {}, "stack_leverage_score")
        lines.extend([
            "",
            "## Review",
            "",
            f"- Status: **{review_status}**",
            f"- Task outcome: **{score_label(reviewed_task_score)}/5**",
            f"- Stack leverage: **{score_label(reviewed_stack_score)}/5**",
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
    try:
        value = json.loads(path.read_text())
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def nested(value: object, *keys: str) -> object:
    node = value
    for key in keys:
        if not isinstance(node, dict):
            return None
        node = node.get(key)
    return node


def nonempty_str(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def nonempty_str_list(value: object) -> bool:
    return isinstance(value, list) and bool(value) and all(nonempty_str(item) for item in value)


def table_cell(value: object) -> str:
    return str(value).replace("|", "\\|").replace("\n", " ").strip()


if __name__ == "__main__":
    raise SystemExit(main())
