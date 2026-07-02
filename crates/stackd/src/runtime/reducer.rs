use chrono::Utc;
use stack_core::runtime_event::RuntimeEvent;
use stack_core::runtime_state::{
    FactorySnapshot, RemoteDeploymentSnapshot, RemoteFactorySnapshot, RemoteGardenerPassSnapshot,
    RemoteHostedOptimizerSnapshot, RemoteProjectSnapshot, RemoteRunEventSnapshot,
    RemoteRunSnapshot, RemoteSmrRunBindingSnapshot, RemoteSyncRequestSnapshot, RuntimeEventRef,
};
use std::collections::{BTreeMap, BTreeSet};

pub fn reduce(events: &[RuntimeEvent]) -> FactorySnapshot {
    let mut snapshot = FactorySnapshot::empty(Utc::now().to_rfc3339());
    let mut local_runs = BTreeMap::<String, String>::new();
    let mut remote_runs = BTreeSet::<String>::new();
    let mut remote_factories = BTreeSet::<String>::new();
    let mut remote_hosted_optimizers = BTreeSet::<String>::new();
    let mut remote_project_map = BTreeMap::<String, RemoteProjectSnapshot>::new();
    let mut remote_run_map = BTreeMap::<String, RemoteRunSnapshot>::new();
    let mut remote_factory_map = BTreeMap::<String, RemoteFactorySnapshot>::new();
    let mut remote_hosted_optimizer_map = BTreeMap::<String, RemoteHostedOptimizerSnapshot>::new();
    let mut remote_deployment_map = BTreeMap::<String, RemoteDeploymentSnapshot>::new();
    let mut pending_push = Vec::<RemoteSyncRequestSnapshot>::new();
    let mut pending_pull = Vec::<RemoteSyncRequestSnapshot>::new();
    let mut remote_gardener_passes = Vec::<RemoteGardenerPassSnapshot>::new();
    let mut linked_smr_runs = BTreeMap::<String, RemoteSmrRunBindingSnapshot>::new();
    let mut remote_run_events = Vec::<RemoteRunEventSnapshot>::new();
    let mut sensor_degraded = false;

    for event in events {
        match event.event_type.as_str() {
            "sensor.local_gepa.service.reachable" => {
                snapshot.local_gepa.sync_enabled = true;
                snapshot.local_gepa.service_status = "running".to_string();
                snapshot.local_gepa.service_url = payload_string(event, "service_url");
                snapshot.local_gepa.last_error = None;
            }
            "sensor.local_gepa.service.unreachable" => {
                snapshot.local_gepa.sync_enabled = true;
                snapshot.local_gepa.service_status = "stopped".to_string();
                snapshot.local_gepa.service_url = payload_string(event, "service_url");
                snapshot.local_gepa.last_error = event
                    .payload
                    .get("error")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string);
                if !local_runs.is_empty() {
                    sensor_degraded = true;
                }
                local_runs.clear();
                snapshot.local_gepa.active_run_id = None;
            }
            "sensor.local_gepa.runs.fetch_failed" => {
                snapshot.local_gepa.last_error = event
                    .payload
                    .get("error")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string);
                if !local_runs.is_empty() {
                    sensor_degraded = true;
                }
            }
            "sensor.local_gepa.run.discovered"
            | "sensor.local_gepa.run.phase_changed"
            | "sensor.local_gepa.run.progress" => {
                if local_gepa_run_is_terminal(event) {
                    local_runs.remove(&event.subject.id);
                    if snapshot.local_gepa.active_run_id.as_deref()
                        == Some(event.subject.id.as_str())
                    {
                        snapshot.local_gepa.active_run_id = None;
                    }
                } else {
                    local_runs.insert(event.subject.id.clone(), event.event_type.clone());
                    snapshot.local_gepa.active_run_id = Some(event.subject.id.clone());
                }
                snapshot.local_gepa.last_progress_at = Some(event.observed_at.clone());
            }
            "sensor.local_gepa.run.completed" | "sensor.local_gepa.run.failed" => {
                local_runs.remove(&event.subject.id);
                if snapshot.local_gepa.active_run_id.as_deref() == Some(event.subject.id.as_str()) {
                    snapshot.local_gepa.active_run_id = None;
                }
                snapshot.local_gepa.last_progress_at = Some(event.observed_at.clone());
            }
            "sensor.local_gepa.run.unobserved" => {
                local_runs.remove(&event.subject.id);
                if snapshot.local_gepa.active_run_id.as_deref() == Some(event.subject.id.as_str()) {
                    snapshot.local_gepa.active_run_id = None;
                }
                snapshot.local_gepa.last_progress_at = Some(event.observed_at.clone());
            }
            "sensor.remote.auth.ready" => {
                snapshot.remote_synth.sync_enabled = true;
                snapshot.remote_synth.auth_status = "ready".to_string();
                snapshot.remote_synth.last_ok_at = Some(event.observed_at.clone());
            }
            "sensor.remote.environment.selected" => {
                snapshot.remote_synth.environment_name = payload_string(event, "environment");
                snapshot.remote_synth.api_base_url = payload_string(event, "api_base_url");
                remote_runs.clear();
                remote_factories.clear();
                remote_hosted_optimizers.clear();
                remote_project_map.clear();
                remote_run_map.clear();
                remote_factory_map.clear();
                remote_hosted_optimizer_map.clear();
                remote_deployment_map.clear();
                pending_push.clear();
                pending_pull.clear();
                remote_gardener_passes.clear();
                linked_smr_runs.clear();
                remote_run_events.clear();
                snapshot.remote_synth.sync_enabled = false;
                snapshot.remote_synth.auth_status = "unknown".to_string();
                snapshot.remote_synth.last_ok_at = None;
            }
            "sensor.remote.auth.missing" => {
                snapshot.remote_synth.sync_enabled = false;
                snapshot.remote_synth.auth_status = "missing".to_string();
                if !remote_runs.is_empty()
                    || !remote_factories.is_empty()
                    || !remote_hosted_optimizers.is_empty()
                    || !remote_deployment_map.is_empty()
                {
                    sensor_degraded = true;
                }
            }
            "sensor.remote.projects.fetch_failed"
            | "sensor.remote.project_runs.fetch_failed"
            | "sensor.remote_synth.run_events.fetch_failed"
            | "sensor.remote.factories.fetch_failed"
            | "sensor.remote.factory_projects.fetch_failed"
            | "sensor.remote.factory_status.fetch_failed"
            | "sensor.remote.hosted_optimizers.fetch_failed"
            | "sensor.remote.deployments.fetch_failed" => {
                if !remote_runs.is_empty()
                    || !remote_factories.is_empty()
                    || !remote_hosted_optimizers.is_empty()
                    || !remote_deployment_map.is_empty()
                {
                    sensor_degraded = true;
                }
            }
            "sensor.remote.project.updated" => {
                let project_id =
                    payload_string(event, "project_id").unwrap_or_else(|| event.subject.id.clone());
                remote_project_map.insert(
                    project_id.clone(),
                    RemoteProjectSnapshot {
                        project_id,
                        name: payload_string(event, "name")
                            .unwrap_or_else(|| event.subject.id.clone()),
                        alias: payload_string(event, "alias"),
                        updated_at: payload_string(event, "updated_at"),
                        active_run_id: payload_string(event, "active_run_id"),
                        run_ids: Vec::new(),
                        factory_ids: Vec::new(),
                    },
                );
            }
            "sensor.remote.project.unobserved" => {
                let project_id =
                    payload_string(event, "project_id").unwrap_or_else(|| event.subject.id.clone());
                remote_project_map.remove(&project_id);
            }
            "sensor.remote.project_run.updated" | "sensor.remote.smr_run.updated" => {
                remote_runs.insert(event.subject.id.clone());
                let run = remote_run_snapshot(event, false);
                remote_run_map.insert(run.run_id.clone(), run);
            }
            "sensor.remote.project_run.terminal" | "sensor.remote.smr_run.terminal" => {
                remote_runs.remove(&event.subject.id);
                let run = remote_run_snapshot(event, true);
                remote_run_map.insert(run.run_id.clone(), run);
            }
            "sensor.remote.project_run.unobserved" => {
                remote_runs.remove(&event.subject.id);
                let run_id =
                    payload_string(event, "run_id").unwrap_or_else(|| event.subject.id.clone());
                remote_run_map.remove(&run_id);
            }
            "sensor.remote.factory.updated" => {
                let factory = remote_factory_snapshot(event);
                if factory.is_running == Some(true) || factory.active_efforts.unwrap_or(0) > 0 {
                    remote_factories.insert(factory.factory_id.clone());
                } else {
                    remote_factories.remove(&factory.factory_id);
                }
                remote_factory_map.insert(factory.factory_id.clone(), factory);
            }
            "sensor.remote.factory.unobserved" => {
                remote_factories.remove(&event.subject.id);
                let factory_id =
                    payload_string(event, "factory_id").unwrap_or_else(|| event.subject.id.clone());
                remote_factory_map.remove(&factory_id);
            }
            "sensor.remote.hosted_optimizer.updated"
            | "sensor.remote.hosted_optimizer.unobserved" => {
                let optimizer = remote_hosted_optimizer_snapshot(event);
                if optimizer.terminal {
                    remote_hosted_optimizers.remove(&optimizer.run_id);
                } else {
                    remote_hosted_optimizers.insert(optimizer.run_id.clone());
                }
                if event.event_type == "sensor.remote.hosted_optimizer.unobserved" {
                    remote_hosted_optimizer_map.remove(&optimizer.run_id);
                } else {
                    remote_hosted_optimizer_map.insert(optimizer.run_id.clone(), optimizer);
                }
            }
            "sensor.remote.deployment.updated" => {
                let deployment = remote_deployment_snapshot(event);
                remote_deployment_map.insert(deployment.deployment_id.clone(), deployment);
            }
            "sensor.remote.deployment.unobserved" => {
                let deployment_id = payload_string(event, "deployment_id")
                    .unwrap_or_else(|| event.subject.id.clone());
                remote_deployment_map.remove(&deployment_id);
            }
            "lever.remote.push_requested" => {
                pending_push.push(remote_sync_request_snapshot(event, "push"));
            }
            "lever.remote.pull_requested" => {
                pending_pull.push(remote_sync_request_snapshot(event, "pull"));
            }
            "lever.remote_gardener.pass_recorded" => {
                remote_gardener_passes.push(remote_gardener_pass_snapshot(event));
            }
            "lever.remote_smr.run.bound" => {
                let binding = remote_smr_run_binding_snapshot(event);
                linked_smr_runs.insert(remote_smr_run_binding_key(&binding), binding);
            }
            "sensor.remote_synth.run_event" => {
                remote_run_events.push(remote_run_event_snapshot(event));
            }
            _ => {}
        }
    }

    snapshot.local_gepa.active_run_count = local_runs.len();
    snapshot.remote_synth.active_run_count = remote_runs.len();
    snapshot.remote_synth.active_factory_count = remote_factories.len();
    snapshot.remote_synth.active_hosted_optimizer_count = remote_hosted_optimizers.len();
    snapshot.remote_synth.deployment_count = remote_deployment_map.len();
    snapshot.remote_synth.degraded_deployment_count = remote_deployment_map
        .values()
        .filter(|deployment| deployment_is_degraded(deployment))
        .count();
    snapshot.control_state = control_state(&snapshot, sensor_degraded);
    for run in remote_run_map.values() {
        if let Some(project_id) = &run.project_id {
            if let Some(project) = remote_project_map.get_mut(project_id) {
                if !project.run_ids.contains(&run.run_id) {
                    project.run_ids.push(run.run_id.clone());
                }
            }
        }
    }
    for factory in remote_factory_map.values() {
        for project_id in factory_project_ids(factory) {
            if let Some(project) = remote_project_map.get_mut(project_id) {
                if !project.factory_ids.contains(&factory.factory_id) {
                    project.factory_ids.push(factory.factory_id.clone());
                }
            }
        }
    }
    snapshot.remote_synth.active_project_count = remote_project_map.len();
    let mut projects = remote_project_map.into_values().collect::<Vec<_>>();
    projects.sort_by(compare_remote_project_snapshot);
    snapshot.remote_synth.projects = projects.into_iter().take(20).collect();
    let mut runs = remote_run_map.into_values().collect::<Vec<_>>();
    runs.sort_by(compare_remote_run_snapshot);
    snapshot.remote_synth.runs = runs.into_iter().take(100).collect();
    let mut factories = remote_factory_map.into_values().collect::<Vec<_>>();
    factories.sort_by(compare_remote_factory_snapshot);
    snapshot.remote_synth.factories = factories.into_iter().take(50).collect();
    let mut hosted_optimizers = remote_hosted_optimizer_map
        .into_values()
        .collect::<Vec<_>>();
    hosted_optimizers.sort_by(compare_remote_hosted_optimizer_snapshot);
    snapshot.remote_synth.hosted_optimizers = hosted_optimizers.into_iter().take(50).collect();
    let mut deployments = remote_deployment_map.into_values().collect::<Vec<_>>();
    deployments.sort_by(compare_remote_deployment_snapshot);
    snapshot.remote_synth.deployments = deployments.into_iter().take(50).collect();
    pending_push.sort_by(compare_remote_sync_request_snapshot);
    snapshot.remote_synth.pending_push = pending_push.into_iter().take(20).collect();
    pending_pull.sort_by(compare_remote_sync_request_snapshot);
    snapshot.remote_synth.pending_pull = pending_pull.into_iter().take(20).collect();
    remote_gardener_passes.sort_by(compare_remote_gardener_pass_snapshot);
    snapshot.remote_synth.recent_remote_gardener_passes =
        remote_gardener_passes.into_iter().take(10).collect();
    let mut linked_smr_runs = linked_smr_runs.into_values().collect::<Vec<_>>();
    linked_smr_runs.sort_by(compare_remote_smr_run_binding_snapshot);
    snapshot.remote_synth.linked_smr_runs = linked_smr_runs.into_iter().take(50).collect();
    remote_run_events.sort_by(compare_remote_run_event_snapshot);
    snapshot.remote_synth.recent_run_events = remote_run_events.into_iter().take(20).collect();
    snapshot.recent_events = events
        .iter()
        .rev()
        .take(20)
        .map(|event| RuntimeEventRef {
            seq: event.seq,
            event_type: event.event_type.clone(),
            source: event.source.clone(),
            observed_at: event.observed_at.clone(),
            subject_kind: event.subject.kind.clone(),
            subject_id: event.subject.id.clone(),
        })
        .collect::<Vec<_>>();
    snapshot.recent_events.reverse();
    snapshot
}

fn control_state(snapshot: &FactorySnapshot, sensor_degraded: bool) -> String {
    let local_active = snapshot.local_gepa.active_run_count > 0;
    let remote_active = snapshot.remote_synth.active_run_count > 0
        || snapshot.remote_synth.active_factory_count > 0;
    let hosted_optimizer_active = snapshot.remote_synth.active_hosted_optimizer_count > 0;
    let any_remote_active = remote_active || hosted_optimizer_active;
    let degraded = sensor_degraded
        || (snapshot.local_gepa.service_status == "stopped" && local_active)
        || (snapshot.remote_synth.auth_status == "missing" && any_remote_active)
        || snapshot.remote_synth.degraded_deployment_count > 0;
    if degraded {
        "degraded"
    } else if local_active && any_remote_active {
        "dual_active"
    } else if local_active {
        "local_gepa_running"
    } else if hosted_optimizer_active {
        "hosted_optimizer_active"
    } else if remote_active {
        "remote_run_active"
    } else {
        "quiescent"
    }
    .to_string()
}

fn compare_remote_project_snapshot(
    left: &RemoteProjectSnapshot,
    right: &RemoteProjectSnapshot,
) -> std::cmp::Ordering {
    left.active_run_id
        .is_none()
        .cmp(&right.active_run_id.is_none())
        .then_with(|| {
            compare_optional_iso_desc(left.updated_at.as_deref(), right.updated_at.as_deref())
        })
        .then_with(|| left.project_id.cmp(&right.project_id))
}

fn compare_remote_run_snapshot(
    left: &RemoteRunSnapshot,
    right: &RemoteRunSnapshot,
) -> std::cmp::Ordering {
    left.terminal
        .cmp(&right.terminal)
        .then_with(|| {
            compare_optional_iso_desc(left.updated_at.as_deref(), right.updated_at.as_deref())
        })
        .then_with(|| left.run_id.cmp(&right.run_id))
}

fn compare_remote_factory_snapshot(
    left: &RemoteFactorySnapshot,
    right: &RemoteFactorySnapshot,
) -> std::cmp::Ordering {
    (!factory_is_active(left))
        .cmp(&!factory_is_active(right))
        .then_with(|| {
            compare_optional_iso_desc(left.next_wake_at.as_deref(), right.next_wake_at.as_deref())
        })
        .then_with(|| left.factory_id.cmp(&right.factory_id))
}

fn compare_remote_hosted_optimizer_snapshot(
    left: &RemoteHostedOptimizerSnapshot,
    right: &RemoteHostedOptimizerSnapshot,
) -> std::cmp::Ordering {
    left.terminal
        .cmp(&right.terminal)
        .then_with(|| {
            compare_optional_iso_desc(left.updated_at.as_deref(), right.updated_at.as_deref())
        })
        .then_with(|| left.run_id.cmp(&right.run_id))
}

fn compare_remote_deployment_snapshot(
    left: &RemoteDeploymentSnapshot,
    right: &RemoteDeploymentSnapshot,
) -> std::cmp::Ordering {
    deployment_is_degraded(right)
        .cmp(&deployment_is_degraded(left))
        .then_with(|| {
            compare_optional_iso_desc(left.updated_at.as_deref(), right.updated_at.as_deref())
        })
        .then_with(|| left.deployment_id.cmp(&right.deployment_id))
}

fn compare_remote_sync_request_snapshot(
    left: &RemoteSyncRequestSnapshot,
    right: &RemoteSyncRequestSnapshot,
) -> std::cmp::Ordering {
    right.seq.cmp(&left.seq)
}

fn compare_remote_gardener_pass_snapshot(
    left: &RemoteGardenerPassSnapshot,
    right: &RemoteGardenerPassSnapshot,
) -> std::cmp::Ordering {
    right.seq.cmp(&left.seq)
}

fn compare_remote_smr_run_binding_snapshot(
    left: &RemoteSmrRunBindingSnapshot,
    right: &RemoteSmrRunBindingSnapshot,
) -> std::cmp::Ordering {
    right.seq.cmp(&left.seq)
}

fn compare_remote_run_event_snapshot(
    left: &RemoteRunEventSnapshot,
    right: &RemoteRunEventSnapshot,
) -> std::cmp::Ordering {
    right.seq.cmp(&left.seq)
}

fn factory_is_active(factory: &RemoteFactorySnapshot) -> bool {
    factory.is_running == Some(true) || factory.active_efforts.unwrap_or(0) > 0
}

fn deployment_is_degraded(deployment: &RemoteDeploymentSnapshot) -> bool {
    if deployment.degraded_reason.is_some() {
        return true;
    }
    let status = deployment
        .status
        .as_deref()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let preflight = deployment
        .preflight_status
        .as_deref()
        .unwrap_or_default()
        .to_ascii_lowercase();
    matches!(
        status.as_str(),
        "degraded" | "failed" | "error" | "unhealthy" | "disabled"
    ) || matches!(preflight.as_str(), "failed" | "error" | "unhealthy")
}

fn compare_optional_iso_desc(left: Option<&str>, right: Option<&str>) -> std::cmp::Ordering {
    let left = left.unwrap_or("");
    let right = right.unwrap_or("");
    right.cmp(left)
}

fn remote_hosted_optimizer_snapshot(event: &RuntimeEvent) -> RemoteHostedOptimizerSnapshot {
    let status = payload_string(event, "status").unwrap_or_else(|| "unknown".to_string());
    RemoteHostedOptimizerSnapshot {
        run_id: payload_string(event, "run_id").unwrap_or_else(|| event.subject.id.clone()),
        terminal: is_terminal_optimizer_status(&status),
        status,
        updated_at: payload_string(event, "updated_at"),
    }
}

fn remote_deployment_snapshot(event: &RuntimeEvent) -> RemoteDeploymentSnapshot {
    RemoteDeploymentSnapshot {
        deployment_id: payload_string(event, "deployment_id")
            .unwrap_or_else(|| event.subject.id.clone()),
        name: payload_string(event, "name").unwrap_or_else(|| event.subject.id.clone()),
        status: payload_string(event, "status"),
        preflight_status: payload_string(event, "preflight_status"),
        degraded_reason: payload_string(event, "degraded_reason"),
        project_id: payload_string(event, "project_id"),
        factory_id: payload_string(event, "factory_id"),
        topology: payload_string(event, "topology"),
        substrate: payload_string(event, "substrate"),
        updated_at: payload_string(event, "updated_at"),
        ready: event
            .payload
            .get("ready")
            .and_then(serde_json::Value::as_bool),
    }
}

fn remote_run_snapshot(event: &RuntimeEvent, terminal: bool) -> RemoteRunSnapshot {
    RemoteRunSnapshot {
        run_id: payload_string(event, "run_id").unwrap_or_else(|| event.subject.id.clone()),
        project_id: payload_string(event, "project_id"),
        state: payload_string(event, "state").unwrap_or_else(|| "unknown".to_string()),
        phase: payload_string(event, "phase"),
        runbook: payload_string(event, "runbook"),
        updated_at: payload_string(event, "updated_at"),
        terminal,
    }
}

fn remote_factory_snapshot(event: &RuntimeEvent) -> RemoteFactorySnapshot {
    let canonical_project_id = payload_string(event, "canonical_project_id");
    let latest_project_id = payload_string(event, "latest_project_id");
    let mut project_ids = event
        .payload
        .get("project_ids")
        .and_then(serde_json::Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    push_unique(&mut project_ids, canonical_project_id.as_deref());
    push_unique(&mut project_ids, latest_project_id.as_deref());
    RemoteFactorySnapshot {
        factory_id: payload_string(event, "factory_id").unwrap_or_else(|| event.subject.id.clone()),
        name: payload_string(event, "name").unwrap_or_else(|| event.subject.id.clone()),
        kind: payload_string(event, "kind"),
        status: payload_string(event, "status"),
        canonical_project_id,
        latest_project_id,
        latest_run_id: payload_string(event, "latest_run_id"),
        next_wake_at: payload_string(event, "next_wake_at"),
        active_efforts: event
            .payload
            .get("active_efforts")
            .and_then(serde_json::Value::as_i64),
        has_cloud_dev_env: event
            .payload
            .get("has_cloud_dev_env")
            .and_then(serde_json::Value::as_bool),
        cloud_dev_label: payload_string(event, "cloud_dev_label"),
        is_running: event
            .payload
            .get("is_running")
            .and_then(serde_json::Value::as_bool),
        project_ids,
    }
}

fn remote_sync_request_snapshot(
    event: &RuntimeEvent,
    fallback_direction: &str,
) -> RemoteSyncRequestSnapshot {
    RemoteSyncRequestSnapshot {
        event_id: event.event_id.clone(),
        seq: event.seq,
        observed_at: event.observed_at.clone(),
        direction: payload_string(event, "direction")
            .unwrap_or_else(|| fallback_direction.to_string()),
        intent: payload_string(event, "intent").unwrap_or_else(|| event.subject.id.clone()),
        subject_kind: event.subject.kind.clone(),
        subject_id: event.subject.id.clone(),
        environment_name: payload_string(event, "environment"),
        api_base_url: payload_string(event, "api_base_url"),
        project_id: payload_string(event, "project_id")
            .or_else(|| event.correlation.project_id.clone()),
        run_id: payload_string(event, "run_id").or_else(|| event.correlation.run_id.clone()),
        factory_id: payload_string(event, "factory_id")
            .or_else(|| event.correlation.factory_id.clone()),
        deployment_id: payload_string(event, "deployment_id")
            .or_else(|| event.correlation.deployment_id.clone()),
        meta_thread_id: payload_string(event, "meta_thread_id"),
        thread_id: payload_string(event, "thread_id")
            .or_else(|| event.correlation.stack_session_id.clone()),
        actor_role: payload_string(event, "actor_role"),
        actor_id: payload_string(event, "actor_id"),
        note: payload_string(event, "note"),
    }
}

fn remote_gardener_pass_snapshot(event: &RuntimeEvent) -> RemoteGardenerPassSnapshot {
    RemoteGardenerPassSnapshot {
        event_id: event.event_id.clone(),
        seq: event.seq,
        observed_at: event.observed_at.clone(),
        subject_kind: event.subject.kind.clone(),
        subject_id: event.subject.id.clone(),
        environment_name: payload_string(event, "environment")
            .or_else(|| payload_object_string(event, "pass", "environment")),
        api_base_url: payload_string(event, "api_base_url")
            .or_else(|| payload_object_string(event, "pass", "api_base_url")),
        actor_role: payload_string(event, "actor_role"),
        actor_id: payload_string(event, "actor_id"),
        meta_thread_id: payload_string(event, "meta_thread_id"),
        thread_id: payload_string(event, "thread_id")
            .or_else(|| event.correlation.stack_session_id.clone()),
        project_id: payload_string(event, "project_id")
            .or_else(|| event.correlation.project_id.clone()),
        run_id: payload_string(event, "run_id").or_else(|| event.correlation.run_id.clone()),
        factory_id: payload_string(event, "factory_id")
            .or_else(|| event.correlation.factory_id.clone()),
        deployment_id: payload_string(event, "deployment_id")
            .or_else(|| event.correlation.deployment_id.clone()),
        narration: payload_object_string(event, "pass", "narration"),
        next_action: payload_object_string(event, "pass", "next_action"),
        runtime_status: payload_object_string(event, "pass", "runtime_status"),
        auth_status: payload_object_string(event, "pass", "auth_status"),
    }
}

fn remote_smr_run_binding_snapshot(event: &RuntimeEvent) -> RemoteSmrRunBindingSnapshot {
    RemoteSmrRunBindingSnapshot {
        event_id: event.event_id.clone(),
        seq: event.seq,
        observed_at: event.observed_at.clone(),
        environment_name: payload_string(event, "environment"),
        api_base_url: payload_string(event, "api_base_url"),
        meta_thread_id: payload_string(event, "meta_thread_id"),
        thread_id: payload_string(event, "thread_id")
            .or_else(|| event.correlation.stack_session_id.clone()),
        project_id: payload_string(event, "project_id")
            .or_else(|| event.correlation.project_id.clone()),
        run_id: payload_string(event, "run_id")
            .or_else(|| event.correlation.run_id.clone())
            .unwrap_or_else(|| event.subject.id.clone()),
        factory_id: payload_string(event, "factory_id")
            .or_else(|| event.correlation.factory_id.clone()),
        deployment_id: payload_string(event, "deployment_id")
            .or_else(|| event.correlation.deployment_id.clone()),
        binding_id: payload_string(event, "binding_id"),
        objective: payload_string(event, "objective"),
        remote_status: payload_string(event, "remote_status"),
        actor_role: payload_string(event, "actor_role"),
        actor_id: payload_string(event, "actor_id"),
    }
}

fn remote_run_event_snapshot(event: &RuntimeEvent) -> RemoteRunEventSnapshot {
    RemoteRunEventSnapshot {
        event_id: event.event_id.clone(),
        seq: event.seq,
        observed_at: event.observed_at.clone(),
        environment_name: payload_string(event, "environment"),
        api_base_url: payload_string(event, "api_base_url"),
        message_id: payload_string(event, "message_id").unwrap_or_else(|| event.subject.id.clone()),
        project_id: payload_string(event, "project_id")
            .or_else(|| event.correlation.project_id.clone()),
        run_id: payload_string(event, "run_id")
            .or_else(|| event.correlation.run_id.clone())
            .unwrap_or_else(|| event.subject.id.clone()),
        status: payload_string(event, "status"),
        mode: payload_string(event, "mode"),
        sender: payload_string(event, "sender"),
        target: payload_string(event, "target"),
        action: payload_string(event, "action"),
        body: payload_string(event, "body"),
        created_at: payload_string(event, "created_at"),
    }
}

fn remote_smr_run_binding_key(binding: &RemoteSmrRunBindingSnapshot) -> String {
    format!(
        "{}:{}",
        binding.meta_thread_id.as_deref().unwrap_or(""),
        binding.run_id
    )
}

fn factory_project_ids(factory: &RemoteFactorySnapshot) -> Vec<&str> {
    let mut ids = Vec::new();
    for project_id in &factory.project_ids {
        if !ids.contains(&project_id.as_str()) {
            ids.push(project_id.as_str());
        }
    }
    if let Some(project_id) = factory.canonical_project_id.as_deref() {
        if !ids.contains(&project_id) {
            ids.push(project_id);
        }
    }
    if let Some(project_id) = factory.latest_project_id.as_deref() {
        if !ids.contains(&project_id) {
            ids.push(project_id);
        }
    }
    ids
}

fn push_unique(values: &mut Vec<String>, value: Option<&str>) {
    if let Some(value) = value {
        if !values.iter().any(|item| item == value) {
            values.push(value.to_string());
        }
    }
}

fn is_terminal_optimizer_status(status: &str) -> bool {
    let status = status.to_ascii_lowercase();
    status.contains("complete")
        || status.contains("done")
        || status.contains("failed")
        || status.contains("cancel")
        || status.contains("terminal")
        || status.contains("unobserved")
}

fn local_gepa_run_is_terminal(event: &RuntimeEvent) -> bool {
    for key in ["status", "phase"] {
        if let Some(value) = payload_string(event, key) {
            let value = value.to_ascii_lowercase();
            if matches!(
                value.as_str(),
                "completed"
                    | "complete"
                    | "done"
                    | "succeeded"
                    | "failed"
                    | "error"
                    | "cancelled"
                    | "canceled"
                    | "stopped"
                    | "expired"
                    | "rejected"
            ) {
                return true;
            }
        }
    }
    false
}

fn payload_string(event: &RuntimeEvent, key: &str) -> Option<String> {
    event
        .payload
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

fn payload_object_string(event: &RuntimeEvent, object_key: &str, key: &str) -> Option<String> {
    event
        .payload
        .get(object_key)
        .and_then(|value| value.get(key))
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}
