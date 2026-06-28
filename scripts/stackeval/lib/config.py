#!/usr/bin/env python3
"""StackEval config loader — merge pipeline.toml + task.toml + preset."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

try:
    import tomllib
except ImportError:
    import tomli as tomllib  # type: ignore


def expand(path: str) -> str:
    return os.path.expanduser(os.path.expandvars(path))


def load_toml(path: Path) -> dict:
    with path.open("rb") as handle:
        return tomllib.load(handle)


def deep_merge(base: dict, overlay: dict) -> dict:
    out = dict(base)
    for key, value in overlay.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = deep_merge(out[key], value)
        else:
            out[key] = value
    return out


def jstack_path(root: Path, rel: str) -> Path:
    rel = rel.strip()
    if rel.startswith(".jstack/"):
        return root / rel
    return root / rel.lstrip("./")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--jstack-root", required=True)
    parser.add_argument("--task", required=True)
    parser.add_argument("--preset", default="")
    parser.add_argument("--field", default="")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    jstack_root = Path(expand(args.jstack_root))
    pipeline_path = jstack_root / ".jstack/product/stackeval/pipeline.toml"
    task_path = jstack_root / ".jstack/product/stackeval/tasks" / f"{args.task}.toml"

    if not pipeline_path.is_file():
        print(f"missing pipeline config: {pipeline_path}", file=sys.stderr)
        return 1
    if not task_path.is_file():
        print(f"missing task config: {task_path}", file=sys.stderr)
        return 1

    pipeline = load_toml(pipeline_path)
    task = load_toml(task_path)

    preset_name = args.preset or pipeline.get("pipeline", {}).get("default_preset", "smoke")
    presets = task.get("presets", {})
    if preset_name not in presets:
        print(f"unknown preset: {preset_name}", file=sys.stderr)
        return 1

    merged = deep_merge(pipeline, task)
    merged["preset"] = deep_merge({"name": preset_name}, presets[preset_name])

    paths = merged.get("paths", {})
    for key, value in list(paths.items()):
        paths[key] = expand(str(value))

    merged["paths"] = paths
    merged["resolved"] = {
        "task_id": task.get("task", {}).get("id", args.task),
        "preset": preset_name,
        "prompt_file": jstack_root / ".jstack/product/stackeval/tasks" / task["task"]["prompt_file"],
        "grader_prompt": jstack_path(jstack_root, str(merged["grader"]["prompt"])),
        "reviewer_prompt": jstack_path(jstack_root, str(merged["reviewer"]["prompt"])),
        "gepa_template": jstack_root / ".jstack/product/stackeval/templates" / task["harness"]["template"],
        "trace_root": Path(paths["trace_root"]) / merged["task"]["id"],
    }

    if args.field:
        node: object = merged
        for part in args.field.split("."):
            if part == "":
                continue
            if not isinstance(node, dict) or part not in node:
                print("", end="")
                return 0
            node = node[part]
        if isinstance(node, (dict, list)):
            print(json.dumps(node))
        else:
            print(node)
        return 0

    if args.json:
        print(json.dumps(merged, indent=2, default=str))
    else:
        print(json.dumps(merged, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
