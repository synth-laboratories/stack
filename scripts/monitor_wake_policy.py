"""Monty wake policy for Stack monitor scheduling.

The Rust scheduler invokes this through topologies-monty.  Keep this file
dependency-free so it can run inside the scheduler's lightweight Python bridge.
"""

from __future__ import annotations

import re
from typing import Any


IMMEDIATE_TYPES = {"agent.tool.failed", "agent.error", "monitor.operator_message"}
LOW_SIGNAL_TOOLS = {
    "read",
    "grep",
    "search",
    "find",
    "ls",
    "stat",
    "status",
    "jq",
    "sed",
    "nl",
    "cat",
}
IMPORTANT_COMMAND_PATTERNS = [
    r"\bapply_patch\b",
    r"\bpytest\b",
    r"\bbun\s+run\s+check\b",
    r"\bcargo\s+(test|check|build)\b",
    r"\bstackeval\b",
    r"\bgepa\b",
    r"\beval\b",
    r"\bdeploy\b",
    r"\bterraform\b",
    r"\bkubectl\b",
    r"\bdocker\b",
]
POLICY_RISK_PATTERNS = [
    r"\bgit\s+stash\b",
    r"\bgit\s+reset\s+--hard\b",
    r"\bgit\s+checkout\s+--\b",
    r"\brm\s+-rf\b",
    r"\bSYNTH_API_KEY\b",
    r"\bPOSTGRES\b",
    r"\bRedis\b",
    r"\braw\s+Redis\b",
]


def run(args: dict[str, Any], host: Any) -> dict[str, Any]:
    pending = [event for event in args.get("pending_events", []) if isinstance(event, dict)]
    triggered = set(args.get("triggered_event_ids", []))
    wake = args.get("wake", {}) if isinstance(args.get("wake"), dict) else {}
    actor = args.get("actor_state", {}) if isinstance(args.get("actor_state"), dict) else {}
    now_ms = _to_int(args.get("now_ms"), 0)

    decision = _pick_trigger(pending, triggered, wake, actor, now_ms)
    host.log("monitor_wake_policy", decision)
    return decision


def _pick_trigger(
    pending: list[dict[str, Any]],
    triggered: set[str],
    wake: dict[str, Any],
    actor: dict[str, Any],
    now_ms: int,
) -> dict[str, Any]:
    candidates = [_score_event(event, wake) for event in pending]
    candidates = [candidate for candidate in candidates if candidate["event_id"] not in triggered]

    for candidate in candidates:
        if candidate["priority"] == "immediate":
            return _decision(candidate, pending, wake, actor, now_ms)

    important = [candidate for candidate in candidates if candidate["priority"] == "important"]
    if important:
        return _decision(important[0], pending, wake, actor, now_ms)

    turn = [candidate for candidate in candidates if candidate["priority"] == "turn_checkpoint"]
    if turn and _cooldown_elapsed(actor, wake, now_ms, "turn_checkpoint"):
        return _decision(turn[0], pending, wake, actor, now_ms)

    threshold = _to_float(wake.get("weight_threshold"), _to_float(wake.get("delta_events"), 12.0))
    weight = sum(candidate["weight"] for candidate in candidates)
    if threshold > 0 and weight >= threshold and candidates:
        candidate = candidates[-1].copy()
        candidate["reason"] = "weighted_delta"
        candidate["score"] = weight
        return _decision(candidate, pending, wake, actor, now_ms)

    max_delay_ms = _to_int(wake.get("max_delay_ms"), 0)
    last_completed_ms = _timestamp_ms(actor.get("last_completed_at"))
    if max_delay_ms > 0 and last_completed_ms > 0 and now_ms - last_completed_ms >= max_delay_ms and candidates:
        candidate = candidates[-1].copy()
        candidate["reason"] = "max_delay"
        candidate["score"] = weight
        return _decision(candidate, pending, wake, actor, now_ms)

    return {
        "wake": False,
        "reason": "below_threshold",
        "trigger_event_ids": [],
        "pending_event_count": len(pending),
        "score": weight,
    }


def _score_event(event: dict[str, Any], wake: dict[str, Any]) -> dict[str, Any]:
    event_type = str(event.get("type") or "")
    event_id = str(event.get("event_id") or "")
    payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
    text = _event_text(event)

    if event_type in IMMEDIATE_TYPES:
        return _candidate(event_id, event_type, "immediate", _reason_from_type(event_type), 99.0)
    if _matches(text, POLICY_RISK_PATTERNS):
        return _candidate(event_id, event_type, "immediate", "policy_risk", 50.0)
    if event_type == "agent.tool.completed":
        if wake.get("on_tool_completed") is False:
            return _candidate(event_id, event_type, "batch", "tool_completed_suppressed", 0.25)
        if _important_tool(payload, text):
            return _candidate(event_id, event_type, "important", "important_tool_completed", 3.0)
        return _candidate(event_id, event_type, "batch", "low_signal_tool_completed", 0.25)
    if event_type == "agent.turn.completed":
        if wake.get("on_turn_completed") is False:
            return _candidate(event_id, event_type, "batch", "turn_completed_suppressed", 0.25)
        if _matches(text, POLICY_RISK_PATTERNS):
            return _candidate(event_id, event_type, "immediate", "policy_risk", 50.0)
        return _candidate(event_id, event_type, "turn_checkpoint", "turn_completed", 1.0)
    if event_type in {"agent.message.delta", "agent.message.completed"}:
        return _candidate(event_id, event_type, "batch", "message_noise", 0.0)
    if event_type == "agent.tool.started":
        return _candidate(event_id, event_type, "batch", "tool_started", 0.25)
    return _candidate(event_id, event_type, "batch", "low_signal_delta", 0.5)


def _candidate(event_id: str, event_type: str, priority: str, reason: str, weight: float) -> dict[str, Any]:
    return {
        "event_id": event_id,
        "event_type": event_type,
        "priority": priority,
        "reason": reason,
        "weight": weight,
        "score": weight,
    }


def _decision(
    candidate: dict[str, Any],
    pending: list[dict[str, Any]],
    wake: dict[str, Any],
    actor: dict[str, Any],
    now_ms: int,
) -> dict[str, Any]:
    if candidate["priority"] not in {"immediate", "important"}:
        if not _cooldown_elapsed(actor, wake, now_ms, candidate["priority"]):
            return {
                "wake": False,
                "reason": "cooldown",
                "trigger_event_ids": [],
                "pending_event_count": len(pending),
                "score": candidate["score"],
                "priority": candidate["priority"],
            }
    return {
        "wake": True,
        "reason": candidate["reason"],
        "priority": candidate["priority"],
        "trigger_event_ids": [candidate["event_id"]] if candidate["event_id"] else [],
        "pending_event_count": len(pending),
        "score": candidate["score"],
        "event_type": candidate["event_type"],
    }


def _cooldown_elapsed(actor: dict[str, Any], wake: dict[str, Any], now_ms: int, priority: str) -> bool:
    if now_ms <= 0:
        return True
    if priority == "immediate":
        return True
    cooldown_ms = _to_int(wake.get("cooldown_ms"), 0)
    if priority == "turn_checkpoint":
        cooldown_ms = _to_int(wake.get("turn_cooldown_ms"), cooldown_ms)
    if priority == "batch":
        cooldown_ms = _to_int(wake.get("batch_cooldown_ms"), cooldown_ms)
    if cooldown_ms <= 0:
        return True
    last_ms = _timestamp_ms(actor.get("last_completed_at"))
    return last_ms <= 0 or now_ms - last_ms >= cooldown_ms


def _important_tool(payload: dict[str, Any], text: str) -> bool:
    tool_name = str(payload.get("tool_name") or payload.get("name") or payload.get("tool") or "")
    lowered_tool = tool_name.lower()
    if lowered_tool in {"command_execution", "exec_command", "shell", "terminal"}:
        return _matches(text, IMPORTANT_COMMAND_PATTERNS)
    if lowered_tool and not any(token in lowered_tool for token in LOW_SIGNAL_TOOLS):
        return True
    return _matches(text, IMPORTANT_COMMAND_PATTERNS)


def _event_text(event: dict[str, Any]) -> str:
    payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
    chunks = [str(event.get("type") or "")]
    for key in ("summary", "message", "command", "stdout", "stderr", "tool_name", "name", "tool"):
        value = payload.get(key)
        if isinstance(value, str):
            chunks.append(value)
    return "\n".join(chunks)


def _matches(text: str, patterns: list[str]) -> bool:
    return any(re.search(pattern, text, re.IGNORECASE) for pattern in patterns)


def _reason_from_type(event_type: str) -> str:
    return event_type.replace("agent.", "").replace(".", "_").replace("monitor_", "")


def _to_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _to_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _timestamp_ms(value: Any) -> int:
    if not isinstance(value, str) or not value:
        return 0
    try:
        from datetime import datetime

        normalized = value.replace("Z", "+00:00")
        return int(datetime.fromisoformat(normalized).timestamp() * 1000)
    except ValueError:
        return 0
