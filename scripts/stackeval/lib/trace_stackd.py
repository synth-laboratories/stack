#!/usr/bin/env python3
"""StackEval trace integration for stackd thread events."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def load_config(path: str) -> dict[str, Any]:
    return json.loads(Path(path).read_text())


def safe_segment(value: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", value.strip())
    if not safe or safe in {".", ".."}:
        raise ValueError(f"invalid segment: {value}")
    return safe


def stack_root(config: dict[str, Any]) -> Path:
    return Path(config["paths"]["stack_root"]).expanduser()


def api_url(config: dict[str, Any]) -> str:
    return str(config["stack"]["stack_api_url"]).rstrip("/")


def require_stackd() -> bool:
    return os.environ.get("STACKEVAL_REQUIRE_STACKD", "").lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def stackd_healthy(config: dict[str, Any]) -> bool:
    try:
        with urllib.request.urlopen(f"{api_url(config)}/health", timeout=2) as response:
            return 200 <= response.status < 300
    except Exception:
        return False


def thread_id_for(config: dict[str, Any], packet_dir: Path) -> str:
    id_path = packet_dir / "codex" / "stack_session_id.txt"
    if id_path.is_file():
        existing = id_path.read_text().strip()
        if existing:
            return existing
    task = safe_segment(str(config["task"]["id"]))
    stamp = safe_segment(packet_dir.name)
    return f"stackeval-{task}-{stamp}"


def session_path(config: dict[str, Any], thread_id: str) -> Path:
    return stack_root(config) / ".stack" / "sessions" / f"{safe_segment(thread_id)}.json"


def ensure_session(config: dict[str, Any], packet_dir: Path) -> str:
    thread_id = thread_id_for(config, packet_dir)
    path = session_path(config, thread_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    now = utc_now()
    if path.is_file():
        try:
            session = json.loads(path.read_text())
        except Exception:
            session = {}
    else:
        session = {}
    session.update(
        {
            "id": thread_id,
            "workspaceRoot": str(stack_root(config)),
            "startedAt": session.get("startedAt") or now,
            "codexCommand": "stackeval pipeline",
            "codexModel": config["task"].get("default_model"),
            "turns": session.get("turns") or [],
        }
    )
    path.write_text(json.dumps(session, indent=2) + "\n")
    (packet_dir / "codex").mkdir(parents=True, exist_ok=True)
    (packet_dir / "codex" / "stack_session_id.txt").write_text(thread_id + "\n")
    return thread_id


def post_event(
    config: dict[str, Any],
    packet_dir: Path,
    event_type: str,
    actor_id: str,
    actor_role: str,
    payload: dict[str, Any],
) -> dict[str, Any] | None:
    thread_id = ensure_session(config, packet_dir)
    if not stackd_healthy(config):
        message = f"stackd not healthy at {api_url(config)}"
        if require_stackd():
            raise RuntimeError(message)
        print(f"[stackeval] warning: {message}; trace event skipped", file=sys.stderr)
        return None

    body = json.dumps(
        {
            "type": event_type,
            "actor_id": actor_id,
            "actor_role": actor_role,
            "payload": payload,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{api_url(config)}/threads/{thread_id}/events",
        data=body,
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            data = response.read().decode("utf-8")
            return json.loads(data) if data else None
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"stackd event append failed: HTTP {error.code}: {detail}") from error


def read_trace(config: dict[str, Any], thread_id: str) -> dict[str, Any]:
    with urllib.request.urlopen(f"{api_url(config)}/threads/{thread_id}/trace", timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def wait_monitor(args: argparse.Namespace) -> int:
    config = load_config(args.config_json)
    packet_dir = Path(args.packet_dir)
    thread_id = ensure_session(config, packet_dir)
    if not stackd_healthy(config):
        message = f"stackd not healthy at {api_url(config)}"
        if require_stackd():
            raise RuntimeError(message)
        print(f"[stackeval] warning: {message}; monitor wait skipped", file=sys.stderr)
        return 0

    deadline = time.monotonic() + args.timeout_seconds
    last_trace: dict[str, Any] = {}
    while time.monotonic() < deadline:
        last_trace = read_trace(config, thread_id)
        events = last_trace.get("meta_events") or []
        trigger_index = latest_trigger_index(events)
        if trigger_index is None:
            return 0
        later = events[trigger_index + 1 :]
        has_checkpoint = any(event.get("type") == "monitor.checkpoint" for event in later)
        has_usage = any(event.get("type") == "monitor.usage" for event in later)
        if has_checkpoint and has_usage:
            return 0
        time.sleep(args.poll_seconds)

    message = f"monitor checkpoint not observed for {thread_id} within {args.timeout_seconds}s"
    if require_stackd():
        raise RuntimeError(message)
    print(f"[stackeval] warning: {message}", file=sys.stderr)
    return 0


def latest_trigger_index(events: list[Any]) -> int | None:
    triggers = {
        "agent.tool.completed",
        "agent.tool.failed",
        "agent.turn.completed",
        "agent.error",
    }
    latest = None
    for index, event in enumerate(events):
        if isinstance(event, dict) and event.get("type") in triggers:
            latest = index
    return latest


def find_skill(config: dict[str, Any], skill_id: str) -> tuple[Path, str]:
    root = stack_root(config)
    candidates = [
        root / ".stack" / "skills" / skill_id / "SKILL.md",
        root / ".codex" / "skills" / skill_id / "SKILL.md",
        Path.home() / ".codex" / "skills" / skill_id / "SKILL.md",
    ]
    for path in candidates:
        if path.is_file():
            origin = "stack" if ".stack" in path.parts else "codex"
            return path, origin
    raise FileNotFoundError(f"skill not found: {skill_id}")


def record_skill(args: argparse.Namespace) -> int:
    config = load_config(args.config_json)
    packet_dir = Path(args.packet_dir)
    started = utc_now()
    monotonic_started = time.monotonic()
    source_path, origin = find_skill(config, args.skill_id)
    content = source_path.read_bytes()
    completed = utc_now()
    duration_ms = max(0, round((time.monotonic() - monotonic_started) * 1000))
    payload = {
        "skill_id": args.skill_id,
        "skill_name": args.skill_id,
        "source_path": str(source_path),
        "origin": origin,
        "max_bytes": args.max_bytes,
        "truncated": len(content) > args.max_bytes,
        "content_bytes": min(len(content), args.max_bytes),
        "started_at": started,
        "completed_at": completed,
        "duration_ms": duration_ms,
        "reason": args.reason,
    }
    post_event(config, packet_dir, "skill.read", args.actor_id, args.actor_role, payload)
    post_event(config, packet_dir, "skill.used", args.actor_id, args.actor_role, payload)
    return 0


def harness_event(args: argparse.Namespace) -> int:
    config = load_config(args.config_json)
    packet_dir = Path(args.packet_dir)
    payload: dict[str, Any] = {
        "tool": "stackeval.gepa",
        "phase": args.phase,
        "command": "uv run --project <gepa_evals_project> synth-optimizers gepa run --config <gepa_config>",
        "gepa_config": args.gepa_config,
    }
    if args.exit_code is not None:
        payload["exit_code"] = args.exit_code
    if args.stdout_log:
        payload["stdout_log"] = args.stdout_log
        payload["stdout_tail"] = read_tail(args.stdout_log)
    if args.stderr_log:
        payload["stderr_log"] = args.stderr_log
        payload["stderr_tail"] = read_tail(args.stderr_log)
    event_type = {
        "started": "agent.tool.started",
        "completed": "agent.tool.completed",
        "failed": "agent.tool.failed",
    }[args.phase]
    post_event(config, packet_dir, event_type, "primary_stackeval", "primary", payload)
    return 0


def read_tail(path: str, limit: int = 4000) -> str:
    file_path = Path(path)
    if not file_path.is_file():
        return ""
    text = file_path.read_text(errors="replace")
    return text[-limit:]


def generic_event(args: argparse.Namespace) -> int:
    config = load_config(args.config_json)
    payload: dict[str, Any] = {}
    if args.payload_json:
        payload.update(json.loads(args.payload_json))
    if args.payload_file:
        payload.update(json.loads(Path(args.payload_file).read_text()))
    post_event(config, Path(args.packet_dir), args.type, args.actor_id, args.actor_role, payload)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    ensure = subparsers.add_parser("ensure-session")
    ensure.add_argument("--config-json", required=True)
    ensure.add_argument("--packet-dir", required=True)

    skill = subparsers.add_parser("record-skill")
    skill.add_argument("--config-json", required=True)
    skill.add_argument("--packet-dir", required=True)
    skill.add_argument("--skill-id", required=True)
    skill.add_argument("--actor-id", default="primary_stackeval")
    skill.add_argument("--actor-role", default="primary")
    skill.add_argument("--reason", default="stackeval_trace")
    skill.add_argument("--max-bytes", type=int, default=50000)

    harness = subparsers.add_parser("harness-event")
    harness.add_argument("--config-json", required=True)
    harness.add_argument("--packet-dir", required=True)
    harness.add_argument("--phase", choices=["started", "completed", "failed"], required=True)
    harness.add_argument("--gepa-config", required=True)
    harness.add_argument("--exit-code", type=int)
    harness.add_argument("--stdout-log")
    harness.add_argument("--stderr-log")

    event = subparsers.add_parser("event")
    event.add_argument("--config-json", required=True)
    event.add_argument("--packet-dir", required=True)
    event.add_argument("--type", required=True)
    event.add_argument("--actor-id", default="system")
    event.add_argument("--actor-role", default="system")
    event.add_argument("--payload-json")
    event.add_argument("--payload-file")

    wait = subparsers.add_parser("wait-monitor")
    wait.add_argument("--config-json", required=True)
    wait.add_argument("--packet-dir", required=True)
    wait.add_argument("--timeout-seconds", type=float, default=45)
    wait.add_argument("--poll-seconds", type=float, default=1)

    args = parser.parse_args()
    if args.command == "ensure-session":
        config = load_config(args.config_json)
        thread_id = ensure_session(config, Path(args.packet_dir))
        print(thread_id)
        return 0
    if args.command == "record-skill":
        return record_skill(args)
    if args.command == "harness-event":
        return harness_event(args)
    if args.command == "event":
        return generic_event(args)
    if args.command == "wait-monitor":
        return wait_monitor(args)
    raise AssertionError(args.command)


if __name__ == "__main__":
    raise SystemExit(main())
