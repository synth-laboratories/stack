#!/usr/bin/env python3
"""Render GEPA config from StackEval template + preset."""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
from datetime import datetime, timezone
from pathlib import Path

from config import expand


def id_list(prefix: str, count: int) -> list[str]:
    return [f"{prefix}:{index}" for index in range(count)]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config-json", required=True, help="merged config JSON path")
    parser.add_argument("--packet-dir", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    merged = json.loads(Path(args.config_json).read_text())
    preset = merged["preset"]
    harness = merged["harness"]
    paths = merged["paths"]
    packet_dir = Path(args.packet_dir)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_id = f"stackeval_{merged['task']['id']}_{stamp}"
    output_dir = packet_dir / "artifacts" / "gepa_runs"
    output_dir.mkdir(parents=True, exist_ok=True)

    port_base = int(harness.get("container_port_base", 28800))
    container_port = port_base + random.randint(1, 999)

    train_sample = int(preset["train_sample"])
    test_sample = int(preset["test_sample"])

    template_path = Path(merged["resolved"]["gepa_template"])
    template = template_path.read_text()
    is_crafter = "crafter" in template_path.name.lower()

    if is_crafter:
        train_seed_start = int(harness.get("train_seed_start", 11))
        heldout_seed_start = int(harness.get("heldout_seed_start", 101))
        train_seeds = list(range(train_seed_start, train_seed_start + train_sample))
        heldout_seeds = list(range(heldout_seed_start, heldout_seed_start + test_sample))
        train_ids = [f"train:{seed}" for seed in train_seeds]
        heldout_ids = [f"test:{seed}" for seed in heldout_seeds]
    else:
        train_seeds = []
        heldout_seeds = []
        train_ids = id_list("train", train_sample)
        heldout_ids = id_list("test", test_sample)

    replacements = {
        "{{run_id}}": run_id,
        "{{output_dir}}": str(output_dir),
        "{{seed}}": str(harness.get("seed", 0)),
        "{{container_port}}": str(container_port),
        "{{train_sample}}": str(train_sample),
        "{{test_sample}}": str(test_sample),
        "{{policy_concurrency}}": str(harness.get("policy_concurrency", 4)),
        "{{policy_timeout_seconds}}": str(harness.get("policy_timeout_seconds", 30)),
        "{{rollout_timeout_seconds}}": str(harness.get("rollout_timeout_seconds", 35)),
        "{{policy_model}}": harness.get("policy_model", "gemini-3.1-flash-lite"),
        "{{policy_provider}}": harness.get("policy_provider", "openai"),
        "{{policy_api_key_env}}": harness.get("policy_api_key_env", "GEMINI_API_KEY"),
        "{{policy_base_url}}": harness.get(
            "policy_base_url",
            "https://generativelanguage.googleapis.com/v1beta/openai",
        ),
        "{{gepa_cookbook_root}}": paths["gepa_cookbook_root"],
        "{{container_startup_timeout_seconds}}": str(harness.get("container_startup_timeout_seconds", 120)),
        "{{train_ids_json}}": json.dumps(train_ids),
        "{{heldout_ids_json}}": json.dumps(heldout_ids),
        "{{seed_prompt}}": harness.get("seed_prompt", "").replace('"', '\\"'),
        "{{proposer_timeout_seconds}}": str(harness.get("proposer_timeout_seconds", 900)),
        "{{proposer_model}}": harness.get("proposer_model", "gpt-5.4-mini"),
        "{{proposer_reasoning_effort}}": harness.get("proposer_reasoning_effort", "medium"),
        "{{codex_home}}": expand(str(Path.home() / ".codex")),
        "{{max_generations}}": str(preset["max_generations"]),
        "{{proposals_per_generation}}": str(preset["proposals_per_generation"]),
        "{{minibatch_size}}": str(preset["minibatch_size"]),
        "{{rollout_chunk_size}}": str(preset.get("rollout_chunk_size", preset["minibatch_size"])),
        "{{max_train_rollouts}}": str(preset["max_train_rollouts"]),
        "{{max_heldout_rollouts}}": str(preset["max_heldout_rollouts"]),
        "{{max_total_rollouts}}": str(preset["max_total_rollouts"]),
        "{{max_cost_usd}}": str(preset["max_cost_usd"]),
        "{{train_seeds_json}}": json.dumps(train_seeds),
        "{{heldout_seeds_json}}": json.dumps(heldout_seeds),
        "{{crafter_max_turns}}": str(harness.get("crafter_max_turns", 12)),
        "{{crafter_min_batch}}": str(harness.get("crafter_min_batch", 1)),
        "{{crafter_max_batch}}": str(harness.get("crafter_max_batch", 5)),
        "{{rollout_async_timeout_seconds}}": str(harness.get("rollout_async_timeout_seconds", 300)),
        "{{gepa_pipeline_mode}}": harness.get("gepa_pipeline_mode", "async_pipelined"),
        "{{max_in_flight_candidates}}": str(harness.get("max_in_flight_candidates", 1)),
        "{{rollout_workers}}": str(harness.get("rollout_workers", 4)),
        "{{rollout_workers_max}}": str(harness.get("rollout_workers_max", 8)),
    }

    rendered = template
    for key, value in replacements.items():
        rendered = rendered.replace(key, value)

    output_path = Path(args.output)
    output_path.write_text(rendered)

    meta = {
        "run_id": run_id,
        "gepa_config_path": str(output_path),
        "output_dir": str(output_dir),
        "container_port": container_port,
        "preset": preset["name"],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    (packet_dir / "harness.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(json.dumps(meta))
    return 0


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    raise SystemExit(main())
