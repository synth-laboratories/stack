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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
