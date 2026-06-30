#!/usr/bin/env python3
"""Run StackEval GEPA through the local synth-optimizers service."""

from __future__ import annotations

import argparse
import json
import os
import shlex
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    import tomllib
except ImportError:  # pragma: no cover
    import tomli as tomllib  # type: ignore


TERMINAL_STATUSES = {"succeeded", "failed", "cancelled", "canceled", "completed", "complete", "done", "error"}


@dataclass(frozen=True)
class ServiceStartSpec:
    command: list[str]
    cwd: str | None
    db_path: str


@dataclass
class OwnedService:
    process: subprocess.Popen[str]
    start: ServiceStartSpec
    log_path: Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config-json", required=True)
    parser.add_argument("--packet-dir", required=True)
    parser.add_argument("--gepa-config", required=True)
    parser.add_argument("--service-url", default=os.environ.get("STACK_OPTIMIZER_SERVICE_URL", "http://127.0.0.1:8879"))
    parser.add_argument("--timeout-seconds", type=int, default=int(os.environ.get("STACKEVAL_GEPA_SERVICE_TIMEOUT_SECONDS", "1200")))
    parser.add_argument("--poll-seconds", type=float, default=float(os.environ.get("STACKEVAL_GEPA_SERVICE_POLL_SECONDS", "2")))
    args = parser.parse_args()

    packet_dir = Path(args.packet_dir)
    config = json.loads(Path(args.config_json).read_text())
    gepa_config_path = Path(args.gepa_config)
    gepa_config = load_toml(gepa_config_path)
    service_url = args.service_url.rstrip("/")
    service_log = packet_dir / "gepa_optimizer_service.log"
    owned_service = ensure_service(service_url, config, packet_dir, service_log)
    request = service_request(gepa_config)
    request_path = packet_dir / "gepa_service_request.json"
    request_path.write_text(json.dumps(request, indent=2) + "\n")

    service_gepa_config_path = packet_dir / "gepa_config.service.toml"
    write_service_native_toml(gepa_config_path, gepa_config, service_gepa_config_path)
    config_path_request = {"config_path": str(service_gepa_config_path), "priority": 0}
    config_path_request_path = packet_dir / "gepa_service_config_path_request.json"
    config_path_request_path.write_text(json.dumps(config_path_request, indent=2) + "\n")

    container = gepa_config.get("container") or {}
    container_url = str(container.get("url") or "").rstrip("/")
    container_log = packet_dir / "gepa_service_container.log"
    container_proc: subprocess.Popen[str] | None = None
    try:
        if service_prefers_json_runs(service_url):
            command = service_container_command(container)
            container_proc = start_container(command, container.get("cwd"), container_log)
            wait_for_container(container_url, int(container.get("startup_timeout_seconds") or 120))
            tick_stackd(config)
            run = submit_json_run(service_url, request, packet_dir.name)
            request_path_for_harness = request_path
            submit_mode = "json"
        else:
            run = submit_config_path_run(service_url, config_path_request, packet_dir.name)
            request_path_for_harness = config_path_request_path
            submit_mode = "config_path"
        run = normalize_run_response(run)
        run_id = str(run.get("run_id") or "")
        if not run_id:
            raise RuntimeError(f"service response missing run_id: {run}")
        update_harness(
            packet_dir,
            run_id,
            service_url,
            container_url,
            request_path_for_harness,
            run,
            submit_mode,
            owned_service,
        )
        print(json.dumps({"event": "service_run_submitted", "run_id": run_id, "status": run.get("status"), "submit_mode": submit_mode}))
        terminal = poll_run(service_url, run_id, config, args.timeout_seconds, args.poll_seconds)
        update_harness(
            packet_dir,
            run_id,
            service_url,
            container_url,
            request_path_for_harness,
            terminal,
            submit_mode,
            owned_service,
        )
        status = str(terminal.get("status") or "").lower()
        print(json.dumps({"event": "service_run_terminal", "run_id": run_id, "status": status}))
        return 0 if status in {"succeeded", "completed", "complete", "done"} else 2
    finally:
        stop_container(container_proc)
        stop_container(owned_service.process if owned_service else None)


def load_toml(path: Path) -> dict[str, Any]:
    with path.open("rb") as handle:
        return tomllib.load(handle)


def ensure_service(
    service_url: str,
    config: dict[str, Any],
    packet_dir: Path,
    log_path: Path,
) -> OwnedService | None:
    if service_reachable(service_url):
        return None
    start = service_start_command(service_url, config, packet_dir)
    service_db_parent = Path(start.db_path).expanduser().parent
    service_db_parent.mkdir(parents=True, exist_ok=True)
    process = start_process(start.command, start.cwd, log_path)
    try:
        wait_for_service(service_url, process, log_path, int(os.environ.get("STACKEVAL_GEPA_SERVICE_STARTUP_TIMEOUT_SECONDS", "120")))
    except Exception:
        stop_container(process)
        raise
    print(json.dumps({"event": "service_started", "service_url": service_url, "pid": process.pid, "log": str(log_path)}))
    return OwnedService(process=process, start=start, log_path=log_path)


def service_reachable(service_url: str) -> bool:
    try:
        get_json(f"{service_url}/health", timeout=3)
        return True
    except Exception:
        return False


def service_start_command(
    service_url: str,
    config: dict[str, Any],
    packet_dir: Path,
) -> ServiceStartSpec:
    explicit = os.environ.get("STACKEVAL_GEPA_SERVICE_COMMAND", "").strip()
    service_db = os.environ.get(
        "STACKEVAL_GEPA_SERVICE_DB",
        str(packet_dir / "artifacts" / "gepa-service.sqlite"),
    )
    bind = service_bind_addr(service_url)
    if explicit:
        command_text = explicit.format(
            bind=bind,
            db=service_db,
            packet_dir=str(packet_dir),
            service_url=service_url,
        )
        cwd = os.environ.get("STACKEVAL_GEPA_SERVICE_CWD", "").strip() or None
        return ServiceStartSpec(command=shlex.split(command_text), cwd=cwd, db_path=service_db)

    optimizers_root = source_optimizers_root(config)
    if optimizers_root is None:
        raise RuntimeError(
            f"GEPA service is not reachable at {service_url}; set STACK_OPTIMIZER_SERVICE_URL "
            "to a running service or provide STACKEVAL_GEPA_SERVICE_COMMAND"
        )
    return ServiceStartSpec(
        command=[
            "uv",
            "run",
            "synth-optimizers",
            "gepa",
            "service",
            "--db",
            service_db,
            "--bind",
            bind,
        ],
        cwd=str(optimizers_root),
        db_path=service_db,
    )


def source_optimizers_root(config: dict[str, Any]) -> Path | None:
    for value in [
        os.environ.get("STACKEVAL_GEPA_SERVICE_CWD", "").strip(),
        os.environ.get("STACK_SYNTH_OPTIMIZERS_ROOT", "").strip(),
    ]:
        if value:
            path = Path(value).expanduser()
            if (path / "pyproject.toml").is_file():
                return path
    workspace_root = config.get("paths", {}).get("workspace_root")
    if workspace_root:
        path = Path(str(workspace_root)).expanduser() / "optimizers"
        if (path / "pyproject.toml").is_file():
            return path
    return None


def service_bind_addr(service_url: str) -> str:
    parsed = urllib.parse.urlparse(service_url)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    return f"{host}:{port}"


def wait_for_service(
    service_url: str,
    process: subprocess.Popen[str],
    log_path: Path,
    timeout_seconds: int,
) -> None:
    deadline = time.monotonic() + timeout_seconds
    last_error = ""
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(
                f"GEPA service exited before becoming healthy; exit={process.returncode}; "
                f"log_tail={tail_text(log_path)}"
            )
        try:
            get_json(f"{service_url}/health", timeout=2)
            return
        except Exception as error:
            last_error = str(error)
            time.sleep(1)
    raise TimeoutError(f"GEPA service not ready at {service_url}: {last_error}; log_tail={tail_text(log_path)}")


def service_prefers_json_runs(service_url: str) -> bool:
    try:
        runs = get_json(f"{service_url}/runs?limit=1", timeout=5)
        if isinstance(runs.get("items"), list):
            return True
    except Exception:
        pass
    try:
        workspace = get_json(f"{service_url}/workspace", timeout=5)
        scheduler = workspace.get("scheduler")
        run_status = workspace.get("run_status")
        if isinstance(scheduler, dict) or isinstance(run_status, dict):
            return True
    except Exception:
        pass
    return False


def service_container_command(container: dict[str, Any]) -> list[str]:
    command = container.get("command")
    if not isinstance(command, list) or not all(isinstance(part, str) for part in command):
        raise RuntimeError("GEPA service JSON request requires [container].command as a string array")
    if not str(container.get("url") or "").rstrip("/"):
        raise RuntimeError("GEPA service JSON request requires [container].url")
    return command


def write_service_native_toml(source_path: Path, gepa_config: dict[str, Any], output_path: Path) -> None:
    source = source_path.read_text()
    taskset = gepa_config.get("taskset")
    if not isinstance(taskset, dict):
        output_path.write_text(source)
        return

    dataset_lines = [
        "[dataset]",
        f"train_split = {json.dumps(str(taskset.get('train_split') or 'train'))}",
        f"heldout_split = {json.dumps(str(taskset.get('heldout_split') or 'test'))}",
        f"train_seeds = {json.dumps(task_ids_to_seeds(taskset.get('train_ids') or []))}",
        f"heldout_seeds = {json.dumps(task_ids_to_seeds(taskset.get('heldout_ids') or []))}",
    ]

    lines = source.splitlines()
    rendered: list[str] = []
    skipping: str | None = None
    inserted_dataset = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            if skipping:
                skipping = None
            if stripped == "[taskset]":
                rendered.extend(dataset_lines)
                inserted_dataset = True
                skipping = "taskset"
                continue
            if stripped == "[gepa.task_pools]":
                skipping = "gepa.task_pools"
                continue
        if skipping:
            continue
        if service_native_unsupported_line(stripped):
            continue
        rendered.append(service_native_line(line, stripped))
    if not inserted_dataset:
        raise RuntimeError(f"could not render service-native dataset section from {source_path}")
    output_path.write_text("\n".join(rendered).rstrip() + "\n")


def service_native_unsupported_line(stripped: str) -> bool:
    unsupported_keys = {
        "codex_home",
        "rollout_chunk_size",
        "rollout_submission_mode",
    }
    key, separator, _ = stripped.partition("=")
    return bool(separator) and key.strip() in unsupported_keys


def service_native_line(line: str, stripped: str) -> str:
    if stripped == 'auth_mode = "chatgpt"':
        indent = line[: len(line) - len(line.lstrip())]
        return f'{indent}auth_mode = "host"'
    return line


def task_ids_to_seeds(values: object) -> list[int]:
    if not isinstance(values, list):
        raise RuntimeError("task ids must be a list")
    seeds: list[int] = []
    for value in values:
        text = str(value)
        _, _, suffix = text.rpartition(":")
        seed_text = suffix or text
        try:
            seeds.append(int(seed_text))
        except ValueError as error:
            raise RuntimeError(f"service-native GEPA config requires integer task id suffixes, got {text!r}") from error
    return seeds


def service_request(gepa_config: dict[str, Any]) -> dict[str, Any]:
    container = gepa_config.get("container") or {}
    run = gepa_config.get("run") or {}
    policy = gepa_config.get("policy") or {}
    proposer = gepa_config.get("proposer") or {}
    taskset = gepa_config.get("taskset") or {}
    gepa = gepa_config.get("gepa") or {}
    pipeline = gepa.get("pipeline") or {}
    task_pools = gepa.get("task_pools") or {}

    max_total_rollouts = int(gepa.get("max_total_rollouts") or 1)
    stop_conditions: list[dict[str, Any]] = [
        {
            "kind": "max_rollouts",
            "n": max_total_rollouts,
            "train": int(gepa.get("max_train_rollouts") or max_total_rollouts),
            "heldout": int(gepa.get("max_heldout_rollouts") or 1),
        },
        {"kind": "max_generations", "n": int(gepa.get("max_generations") or 1)},
    ]
    max_cost_usd = float(gepa.get("max_cost_usd") or 0)
    if max_cost_usd > 0:
        stop_conditions.append({"kind": "max_cost_usd", "value": max_cost_usd})

    policy_api_key_env = str(policy.get("api_key_env") or "GEMINI_API_KEY")
    proposer_auth_mode = str(proposer.get("auth_mode") or "chatgpt")
    proposer_credentials_env = str(proposer.get("api_key_env") or "OPENAI_API_KEY")

    request: dict[str, Any] = {
        "container_url": str(container["url"]),
        "output_dir": str(run.get("output_dir") or ""),
        "policy": {
            "provider": str(policy.get("provider") or "openai"),
            "model": str(policy.get("model") or "gemini-3.1-flash-lite"),
            "api_family": str(policy.get("api_family") or "chat_completions"),
            "credentials": {"resolver": "env", "env_var": policy_api_key_env},
            "base_url": policy.get("base_url"),
            "inference_url": policy.get("inference_url"),
            "disable_reasoning": str(policy.get("disable_reasoning") or "auto"),
        },
        "proposer": {
            "provider": str(proposer.get("provider") or "openai"),
            "model": str(proposer.get("model") or "gpt-5.4-mini"),
            "api_family": str(proposer.get("api_family") or "chat_completions"),
            "auth_mode": proposer_auth_mode,
            "credentials": {"resolver": "env", "env_var": proposer_credentials_env},
            "copy_host_auth": bool(proposer.get("copy_host_auth", proposer_auth_mode in {"chatgpt", "host"})),
            "codex_home": proposer.get("codex_home"),
            "base_url": proposer.get("base_url"),
        },
        "taskset": {
            "train_ids": list(taskset.get("train_ids") or []),
            "heldout_ids": list(taskset.get("heldout_ids") or []),
        },
        "task_pools": {
            "pareto": list(task_pools.get("pareto") or taskset.get("train_ids") or []),
            "minibatch": list(task_pools.get("minibatch") or taskset.get("train_ids") or []),
            "reflection": list(task_pools.get("reflection") or taskset.get("train_ids") or []),
            "heldout": list(task_pools.get("heldout") or taskset.get("heldout_ids") or []),
        },
        "manual_step": False,
        "stop_conditions": stop_conditions,
        "advanced": {
            "pipeline": {
                "mode": pipeline.get("mode", "sync_serial"),
                "max_generations": int(gepa.get("max_generations") or 1),
                "proposals_per_generation": int(gepa.get("proposals_per_generation") or 1),
                "minibatch_size": int(gepa.get("minibatch_size") or 1),
                "rollout_chunk_size": int(gepa.get("rollout_chunk_size") or gepa.get("minibatch_size") or 1),
            },
            "budgets": {
                "max_train_rollouts": int(gepa.get("max_train_rollouts") or max_total_rollouts),
                "max_heldout_rollouts": int(gepa.get("max_heldout_rollouts") or len(taskset.get("heldout_ids") or []) or 1),
            },
            "proposer_io": {
                "timeout_seconds": int(proposer.get("timeout_seconds") or 300),
                "codex_home": proposer.get("codex_home"),
            },
            "adaptive_rollout_concurrency": False,
        },
    }
    if not request["output_dir"]:
        request.pop("output_dir")
    return strip_none(request)


def strip_none(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: strip_none(item) for key, item in value.items() if item is not None}
    if isinstance(value, list):
        return [strip_none(item) for item in value]
    return value


def start_container(command: list[str], cwd: object, log_path: Path) -> subprocess.Popen[str]:
    return start_process(command, str(cwd) if cwd else None, log_path)


def start_process(command: list[str], cwd: str | None, log_path: Path) -> subprocess.Popen[str]:
    log = log_path.open("w")
    try:
        process = subprocess.Popen(
            command,
            cwd=cwd,
            stdout=log,
            stderr=subprocess.STDOUT,
            text=True,
            start_new_session=True,
            env=os.environ.copy(),
        )
    finally:
        log.close()
    return process


def tail_text(path: Path, max_bytes: int = 2000) -> str:
    if not path.is_file():
        return ""
    data = path.read_bytes()
    return data[-max_bytes:].decode("utf-8", errors="replace")


def wait_for_container(container_url: str, timeout_seconds: int) -> None:
    deadline = time.monotonic() + timeout_seconds
    last_error = ""
    while time.monotonic() < deadline:
        try:
            get_json(f"{container_url}/health", timeout=2)
            get_json(f"{container_url}/program", timeout=5)
            return
        except Exception as error:
            last_error = str(error)
            time.sleep(1)
    raise TimeoutError(f"container not ready at {container_url}: {last_error}")


def submit_config_path_run(service_url: str, request: dict[str, Any], idempotency_key: str) -> dict[str, Any]:
    return post_run(service_url, request, idempotency_key)


def submit_json_run(service_url: str, request: dict[str, Any], idempotency_key: str) -> dict[str, Any]:
    return post_run(service_url, request, idempotency_key)


def post_run(service_url: str, request: dict[str, Any], idempotency_key: str) -> dict[str, Any]:
    body = json.dumps(request).encode("utf-8")
    http_request = urllib.request.Request(
        f"{service_url}/runs",
        data=body,
        headers={"content-type": "application/json", "idempotency-key": idempotency_key},
        method="POST",
    )
    return request_json(http_request, timeout=30)


def normalize_run_response(response: dict[str, Any]) -> dict[str, Any]:
    if response.get("run_id"):
        return response
    request = response.get("request")
    if isinstance(request, dict) and request.get("run_id"):
        merged = dict(request)
        for key, value in response.items():
            if key != "request":
                merged[key] = value
        return merged
    return response


def poll_run(service_url: str, run_id: str, config: dict[str, Any], timeout_seconds: int, poll_seconds: float) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_seconds
    last: dict[str, Any] = {}
    while time.monotonic() < deadline:
        last = normalize_run_response(get_run(service_url, run_id))
        status = str(last.get("status") or "").lower()
        print(json.dumps({"event": "service_run_status", "run_id": run_id, "status": status, "phase": last.get("phase")}))
        tick_stackd(config)
        if status in TERMINAL_STATUSES:
            return last
        time.sleep(poll_seconds)
    raise TimeoutError(f"GEPA service run {run_id} did not finish within {timeout_seconds}s; last={last}")


def get_run(service_url: str, run_id: str) -> dict[str, Any]:
    try:
        return get_json(f"{service_url}/runs/{quote_path(run_id)}", timeout=10)
    except Exception:
        for path in ["/runs?limit=100", "/status", "/workspace"]:
            try:
                status = get_json(f"{service_url}{path}", timeout=10)
            except Exception:
                continue
            for value in run_values(status):
                if isinstance(value, dict) and str(value.get("run_id") or value.get("runId") or "") == run_id:
                    return value
        raise


def tick_stackd(config: dict[str, Any]) -> None:
    api_url = str(config.get("stack", {}).get("stack_api_url") or "").rstrip("/")
    if not api_url:
        return
    try:
        http_request = urllib.request.Request(f"{api_url}/runtime/tick", data=b"", method="POST")
        request_json(http_request, timeout=10)
    except Exception:
        return


def get_json(url: str, timeout: int) -> dict[str, Any]:
    return request_json(urllib.request.Request(url, method="GET"), timeout=timeout)


def request_json(request: urllib.request.Request, timeout: int) -> dict[str, Any]:
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {error.code}: {detail}") from error
    value = json.loads(data) if data else {}
    if not isinstance(value, dict):
        raise RuntimeError(f"expected JSON object from {request.full_url}")
    return value


def quote_path(value: str) -> str:
    return urllib.parse.quote(value, safe="")


def update_harness(
    packet_dir: Path,
    run_id: str,
    service_url: str,
    container_url: str,
    request_path: Path,
    run: dict[str, Any],
    submit_mode: str,
    owned_service: OwnedService | None,
) -> None:
    path = packet_dir / "harness.json"
    harness = json.loads(path.read_text()) if path.is_file() else {}
    service_autostarted = owned_service is not None
    harness.update(
        {
            "run_id": run_id,
            "service_url": service_url,
            "container_url": container_url,
            "service_receipt_schema": "stackeval.gepa.service_receipt.v1",
            "service_submit_mode": submit_mode,
            "service_autostarted": service_autostarted,
            "service_log": str(owned_service.log_path) if owned_service else None,
            "service_pid": owned_service.process.pid if owned_service else None,
            "service_start_command": owned_service.start.command if owned_service else None,
            "service_start_cwd": owned_service.start.cwd if owned_service else None,
            "service_db_path": owned_service.start.db_path if owned_service else None,
            "service_request_path": str(request_path),
            "service_status": run.get("status"),
            "service_phase": run.get("phase"),
            "service_run_schema": "stackeval.gepa.service_run_summary.v1",
            "service_run": summarize_service_run(run),
        }
    )
    path.write_text(json.dumps(harness, indent=2) + "\n")


def run_values(payload: dict[str, Any]) -> list[Any]:
    if isinstance(payload.get("items"), list):
        return list(payload["items"])
    if isinstance(payload.get("run_requests"), list):
        return list(payload["run_requests"])
    if isinstance(payload.get("runs"), list):
        return list(payload["runs"])
    runs = payload.get("runs")
    if isinstance(runs, dict) and isinstance(runs.get("items"), list):
        return list(runs["items"])
    return []


def summarize_service_run(run: dict[str, Any]) -> dict[str, Any]:
    summary: dict[str, Any] = {}
    for key in [
        "run_id",
        "request_id",
        "status",
        "phase",
        "generation",
        "candidate_count",
        "best_candidate_id",
        "cost_usd",
        "started_at",
        "finished_at",
        "submitted_at",
        "updated_at",
        "worker_id",
        "result_manifest_path",
        "run_dir",
        "run_workspace_db_path",
        "error",
        "outcome",
        "totals",
        "usage",
        "timing_summary",
    ]:
        if key in run:
            summary[key] = run[key]
    limits = run.get("limits")
    if isinstance(limits, dict):
        summary["limits"] = {
            "nearest_limit": limits.get("nearest_limit"),
            "limit_count": len(limits.get("limits") or []) if isinstance(limits.get("limits"), list) else None,
            "event_count": len(limits.get("events") or []) if isinstance(limits.get("events"), list) else None,
        }
    config = run.get("config")
    if isinstance(config, dict):
        summary["config"] = {
            "container_url": config.get("container_url"),
            "manual_step": config.get("manual_step"),
            "policy": config.get("policy"),
            "proposer": config.get("proposer"),
            "taskset": config.get("taskset"),
            "stop_conditions": config.get("stop_conditions"),
        }
    return summary


def stop_container(process: subprocess.Popen[str] | None) -> None:
    if process is None or process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            return
        process.wait(timeout=5)


if __name__ == "__main__":
    raise SystemExit(main())
