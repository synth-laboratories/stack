#!/usr/bin/env python3
"""Update StackEval pipeline.json stage state."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--packet-dir", required=True)
    parser.add_argument("--stage", required=True)
    parser.add_argument("--status", required=True)
    parser.add_argument("--detail", default="")
    args = parser.parse_args()

    packet = Path(args.packet_dir)
    path = packet / "pipeline.json"
    state = {"stages": [], "updated_at": utc_now()}
    if path.is_file():
        state = json.loads(path.read_text())

    state["stages"] = [
        row for row in state.get("stages", []) if row.get("stage") != args.stage
    ]
    state["stages"].append(
        {
            "stage": args.stage,
            "status": args.status,
            "detail": args.detail,
            "at": utc_now(),
        }
    )
    state["updated_at"] = utc_now()
    path.write_text(json.dumps(state, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
