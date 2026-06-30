#!/usr/bin/env python3
"""Parse GEPA result_manifest into harvest.json and update acceptance rows."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def find_manifest(output_dir: Path, run_id: str) -> Path | None:
    direct = output_dir / run_id / "result_manifest.json"
    if direct.is_file():
        return direct
    for candidate in output_dir.rglob("result_manifest.json"):
        if run_id in str(candidate):
            return candidate
    manifests = sorted(output_dir.rglob("result_manifest.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    return manifests[0] if manifests else None


def load_json(path: Path) -> object:
    return json.loads(path.read_text())


def normalize_registry(raw: object) -> dict:
    if isinstance(raw, list):
        return {"candidates": raw}
    if isinstance(raw, dict):
        candidates = raw.get("candidates")
        if candidates is None:
            raw = {**raw, "candidates": []}
        return raw
    return {"candidates": []}


def terminal_status(manifest: dict) -> str:
    terminal = manifest.get("terminal_status") or manifest.get("status")
    if terminal:
        return str(terminal)
    state_history = manifest.get("state_history")
    if isinstance(state_history, list) and state_history:
        last = state_history[-1]
        if isinstance(last, dict):
            return str(last.get("to") or last.get("status") or "unknown")
    return "unknown"


def candidate_id(row: object) -> str | None:
    if isinstance(row, dict):
        value = row.get("candidate_id")
        return str(value) if value else None
    return None


def candidate_heldout(row: object) -> object:
    if not isinstance(row, dict):
        return None
    return row.get("heldout_accuracy") if row.get("heldout_accuracy") is not None else row.get("heldout_reward")


def candidate_acceptance_reason(row: object) -> str | None:
    if not isinstance(row, dict):
        return None
    metadata = row.get("acceptance_metadata")
    if isinstance(metadata, dict) and metadata.get("acceptance_reason"):
        return str(metadata["acceptance_reason"])
    score = row.get("acceptance_score")
    if isinstance(score, dict) and score.get("acceptance_reason"):
        return str(score["acceptance_reason"])
    reason = row.get("acceptance_reason")
    return str(reason) if reason else None


def candidate_accepted(row: object) -> bool:
    if not isinstance(row, dict):
        return False
    score = row.get("acceptance_score")
    if isinstance(score, dict) and score.get("accepted") is not None:
        return bool(score.get("accepted"))
    status = str(row.get("status") or "").lower()
    return status == "accepted"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--packet-dir", required=True)
    parser.add_argument("--preset-json", required=True, help="path to merged preset section JSON")
    args = parser.parse_args()

    packet_dir = Path(args.packet_dir)
    preset = json.loads(Path(args.preset_json).read_text())
    harness = json.loads((packet_dir / "harness.json").read_text())
    run_id = harness["run_id"]
    output_dir = Path(harness["output_dir"])

    manifest_path = find_manifest(output_dir, run_id)
    if not manifest_path:
        harvest = {"status": "failed", "error": "result_manifest.json not found", "run_id": run_id}
        (packet_dir / "harvest.json").write_text(json.dumps(harvest, indent=2) + "\n")
        print(json.dumps(harvest))
        return 1

    manifest_raw = load_json(manifest_path)
    if not isinstance(manifest_raw, dict):
        harvest = {"status": "failed", "error": "result_manifest.json is not an object", "run_id": run_id}
        (packet_dir / "harvest.json").write_text(json.dumps(harvest, indent=2) + "\n")
        print(json.dumps(harvest))
        return 1
    manifest = manifest_raw
    run_dir = manifest_path.parent
    registry_path = run_dir / "candidate_registry.json"
    best_path = run_dir / "best_candidate.json"
    registry = normalize_registry(load_json(registry_path) if registry_path.is_file() else {})
    best_raw = load_json(best_path) if best_path.is_file() else {}
    best = best_raw if isinstance(best_raw, dict) else {}

    terminal = terminal_status(manifest)
    reward_info = manifest.get("container", {}).get("reward_info") or manifest.get("reward_info") or {}
    heldout = reward_info.get("classification_accuracy")
    if heldout is None:
        heldout = reward_info.get("heldout_accuracy")
    if heldout is None and isinstance(reward_info.get("heldout"), dict):
        heldout = reward_info["heldout"].get("classification_accuracy")
    best_from_manifest = manifest.get("best_candidate")
    if heldout is None and isinstance(best_from_manifest, dict):
        heldout = best_from_manifest.get("heldout_accuracy") or best_from_manifest.get("heldout_reward")

    heldout_reward = None
    if reward_info.get("classification_accuracy") is None and heldout is not None:
        heldout_reward = heldout

    candidates = registry.get("candidates") or []
    if not isinstance(candidates, list):
        candidates = []
    best_id = best.get("candidate_id")
    if not best_id and isinstance(best_from_manifest, dict):
        best_id = best_from_manifest.get("candidate_id")

    proposed = registry.get("proposed_candidate") or {}
    if not isinstance(proposed, dict):
        proposed = {}
    if not proposed and best_id:
        for row in candidates:
            if candidate_id(row) == str(best_id) and isinstance(row, dict) and row.get("parent_id") is not None:
                proposed = row
                break
    if not proposed:
        for row in candidates:
            if isinstance(row, dict) and candidate_accepted(row):
                proposed = row
                break

    acceptance_reason = candidate_acceptance_reason(proposed) or registry.get("acceptance_reason")
    prompt_accepted = candidate_accepted(proposed)

    seed_heldout = None
    for row in candidates:
        if isinstance(row, dict) and (row.get("is_seed") or row.get("parent_id") is None):
            seed_heldout = candidate_heldout(row)
            break

    heldout_lift = False
    if heldout is not None and seed_heldout is not None:
        try:
            heldout_lift = float(heldout) > float(seed_heldout)
        except (TypeError, ValueError):
            heldout_lift = False

    harvest = {
        "schema": "stackeval_harvest.v1",
        "status": "completed" if terminal in ("completed", "complete", "success", "accepted") else str(terminal),
        "run_id": run_id,
        "manifest_path": str(manifest_path),
        "result": {
            "heldout_accuracy": heldout,
            "heldout_reward": heldout_reward,
            "heldout_accuracy_percent": round(float(heldout) * 100, 2) if heldout is not None else None,
            "terminal_status": terminal,
            "prompt_accepted": prompt_accepted,
            "acceptance_reason": acceptance_reason,
            "heldout_lift_vs_seed": heldout_lift,
            "seed_candidate_id": candidate_id(candidates[0]) if candidates else None,
            "seed_heldout_accuracy": seed_heldout,
            "best_candidate_id": best_id,
            "proposed_candidate_id": proposed.get("candidate_id"),
        },
        "artifacts": {
            "manifest": str(manifest_path),
            "candidate_registry": str(registry_path) if registry_path.is_file() else None,
            "best_candidate": str(best_path) if best_path.is_file() else None,
            "events": str(run_dir / "events.jsonl") if (run_dir / "events.jsonl").is_file() else None,
        },
        "preset_gates": {
            "require_prompt_accepted": preset.get("require_prompt_accepted", False),
            "require_heldout_lift": preset.get("require_heldout_lift", False),
            "prompt_accepted_ok": (not preset.get("require_prompt_accepted")) or prompt_accepted,
            "heldout_lift_ok": (not preset.get("require_heldout_lift")) or heldout_lift,
        },
    }

    (packet_dir / "harvest.json").write_text(json.dumps(harvest, indent=2) + "\n")

    # Update acceptance.md summary block
    acc_path = packet_dir / "acceptance.md"
    if acc_path.is_file():
        lines = acc_path.read_text().splitlines()
        verdict = []
        verdict.append("## Pipeline Harvest Verdict")
        verdict.append("")
        verdict.append(f"- Terminal status: **{harvest['status']}**")
        verdict.append(f"- Heldout accuracy: **{harvest['result'].get('heldout_accuracy_percent', 'n/a')}%**")
        verdict.append(f"- Prompt accepted: **{prompt_accepted}** ({acceptance_reason or 'n/a'})")
        verdict.append(f"- Preset gates: prompt_ok={harvest['preset_gates']['prompt_accepted_ok']} heldout_lift_ok={harvest['preset_gates']['heldout_lift_ok']}")
        verdict.append("")
        if not lines or "## Pipeline Harvest Verdict" not in acc_path.read_text():
            acc_path.write_text(acc_path.read_text().rstrip() + "\n\n" + "\n".join(verdict) + "\n")

    print(json.dumps(harvest))
    return 0 if harvest["status"] == "completed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
