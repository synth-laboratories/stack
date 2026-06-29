#!/usr/bin/env python3
"""StackEval tmux harness — stackd receipts + tmux pane capture for agent-driven UI testing."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def stack_api_url() -> str:
    return os.environ.get("STACK_API_URL", "http://127.0.0.1:8792").rstrip("/")


def fetch_json(path: str, timeout: float = 3.0) -> dict[str, Any] | list[Any] | None:
    try:
        with urllib.request.urlopen(f"{stack_api_url()}{path}", timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except Exception:
        return None


def tmux_capture(session: str, lines: int) -> str | None:
    if not session:
        return None
    try:
        proc = subprocess.run(
            ["tmux", "capture-pane", "-p", "-t", session, "-S", f"-{max(1, lines)}"],
            check=False,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        return None
    if proc.returncode != 0:
        return None
    return proc.stdout


def tmux_session_exists(session: str) -> bool:
    try:
        proc = subprocess.run(
            ["tmux", "has-session", "-t", session],
            check=False,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        return False
    return proc.returncode == 0


def read_stackeval_packet() -> dict[str, Any] | None:
    packet_dir = os.environ.get("STACKEVAL_PACKET", "").strip()
    if packet_dir:
        meta_path = Path(packet_dir) / "metadata.json"
        if meta_path.is_file():
            try:
                meta = json.loads(meta_path.read_text())
                return {
                    "task_id": meta.get("task_id"),
                    "packet_dir": packet_dir,
                    "preset": meta.get("preset"),
                    "status": meta.get("status"),
                }
            except Exception:
                return {"packet_dir": packet_dir}
    stack_root = os.environ.get("STACKEVAL_STACK_ROOT", "").strip()
    if not stack_root:
        return None
    latest_path = Path(stack_root) / ".stack" / "evidence" / "stackeval" / "latest.json"
    if not latest_path.is_file():
        return None
    try:
        return json.loads(latest_path.read_text())
    except Exception:
        return None


def build_snapshot(
    *,
    tmux_session: str | None,
    capture_lines: int,
    include_pane: bool,
) -> dict[str, Any]:
    health = fetch_json("/health")
    status = fetch_json("/status")
    threads = fetch_json("/threads")
    latest = None
    if isinstance(status, dict):
        latest_id = (status.get("latest_session") or {}).get("id")
        if isinstance(latest_id, str) and latest_id:
            latest = fetch_json(f"/threads/{latest_id}/trace")

    snapshot: dict[str, Any] = {
        "updated_at": utc_now(),
        "harness": "stackeval-tmux",
        "stack_api_url": stack_api_url(),
        "stackd": {
            "healthy": isinstance(health, dict) and health.get("ok") is True,
            "health": health,
            "status": status,
            "thread_count": len(threads) if isinstance(threads, list) else 0,
            "threads": threads if isinstance(threads, list) else [],
            "latest_trace": latest,
        },
        "stackeval_packet": read_stackeval_packet(),
        "tmux_session": tmux_session,
        "tmux_session_exists": tmux_session_exists(tmux_session) if tmux_session else False,
    }

    if include_pane and tmux_session:
        snapshot["pane_capture"] = tmux_capture(tmux_session, capture_lines)
        snapshot["pane_capture_lines"] = capture_lines

    return snapshot


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def cmd_status(args: argparse.Namespace) -> int:
    snapshot = build_snapshot(
        tmux_session=args.tmux_session,
        capture_lines=args.lines,
        include_pane=args.capture_pane,
    )
    text = json.dumps(snapshot, indent=2)
    if args.output:
        write_json(Path(args.output), snapshot)
        print(f"stackeval_harness_status_ok output={args.output}")
    else:
        print(text)
    return 0


def cmd_capture(args: argparse.Namespace) -> int:
    snapshot = build_snapshot(
        tmux_session=args.tmux_session,
        capture_lines=args.lines,
        include_pane=True,
    )
    output = Path(args.output)
    write_json(output, snapshot)
    pane_path = output.with_suffix(".pane.txt")
    pane_path.write_text(snapshot.get("pane_capture") or "")
    print(f"stackeval_harness_capture_ok output={output} pane={pane_path}")
    return 0


def cmd_export_thread(args: argparse.Namespace) -> int:
    thread_id = args.thread_id
    if not thread_id:
        status = fetch_json("/status")
        if isinstance(status, dict):
            latest = status.get("latest_session")
            if isinstance(latest, dict):
                thread_id = latest.get("id")
    if not thread_id:
        print("stackeval_harness_export_failed: no thread_id", file=sys.stderr)
        return 1
    try:
        with urllib.request.urlopen(
            f"{stack_api_url()}/threads/{thread_id}/export",
            timeout=30,
        ) as response:
            export = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        print(f"stackeval_harness_export_failed: HTTP {error.code}: {detail}", file=sys.stderr)
        return 1
    except Exception as error:
        print(f"stackeval_harness_export_failed: {error}", file=sys.stderr)
        return 1

    output = Path(args.output)
    write_json(output, {"thread_id": thread_id, "export": export})
    export_dir = export.get("export_dir")
    if args.packet_dir and export_dir:
        packet = Path(args.packet_dir)
        target = packet / "stack-session" / "stackd-export"
        target.mkdir(parents=True, exist_ok=True)
        src = Path(str(export_dir))
        if src.is_dir():
            subprocess.run(["cp", "-R", f"{src}/.", str(target)], check=False)
            print(f"stackeval_harness_export_ok thread_id={thread_id} copied_to={target}")
            return 0
    print(f"stackeval_harness_export_ok thread_id={thread_id} export_dir={export_dir}")
    return 0


def main() -> int:
    default_session = os.environ.get("STACKEVAL_HARNESS_SESSION", "stack-stackeval")
    parser = argparse.ArgumentParser(description="StackEval tmux harness helpers")
    sub = parser.add_subparsers(dest="command", required=True)

    def add_session_arg(subparser: argparse.ArgumentParser) -> None:
        subparser.add_argument(
            "--tmux-session",
            default=f"{default_session}:stack",
            help="tmux target (session:window)",
        )

    status = sub.add_parser("status", help="Write machine-readable harness debug snapshot")
    add_session_arg(status)
    status.add_argument("--output", "-o", help="Write JSON path (default: stdout)")
    status.add_argument("--lines", type=int, default=45, help="Pane history lines when --capture-pane")
    status.add_argument("--capture-pane", action="store_true", help="Include tmux capture-pane text")
    status.set_defaults(func=cmd_status)

    capture = sub.add_parser("capture", help="Capture pane + stackd snapshot to JSON")
    add_session_arg(capture)
    capture.add_argument("--output", "-o", required=True)
    capture.add_argument("--lines", type=int, default=80)
    capture.set_defaults(func=cmd_capture)

    export = sub.add_parser("export-thread", help="Export latest or given stackd thread into packet")
    add_session_arg(export)
    export.add_argument("--thread-id")
    export.add_argument("--output", "-o", required=True)
    export.add_argument("--packet-dir")
    export.set_defaults(func=cmd_export_thread)

    args = parser.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
