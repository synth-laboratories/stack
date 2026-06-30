use chrono::Utc;
use stack_core::runtime_event::RuntimeEvent;
use stack_core::runtime_state::{
    FactorySnapshot, RemoteFactorySnapshot, RemoteHostedOptimizerSnapshot, RemoteProjectSnapshot,
    RemoteRunSnapshot, RuntimeEventRef,
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
    let mut sensor_degraded = false;

    for event in events {
        match event.event_type.as_str() {
            "sensor.local_gepa.service.reachable" => {
                snapshot.local_gepa.sync_enabled = true;
                snapshot.local_gepa.service_status = "running".to_string();
                snapshot.local_gepa.last_error = None;
            }
            "sensor.local_gepa.service.unreachable" => {
                snapshot.local_gepa.sync_enabled = true;
                snapshot.local_gepa.service_status = "stopped".to_string();
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
            "sensor.local_gepa.run.discovered"
            | "sensor.local_gepa.run.phase_changed"
            | "sensor.local_gepa.run.progress" => {
                local_runs.insert(event.subject.id.clone(), event.event_type.clone());
                snapshot.local_gepa.active_run_id = Some(event.subject.id.clone());
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
            "sensor.remote.auth.missing" => {
                snapshot.remote_synth.sync_enabled = false;
                snapshot.remote_synth.auth_status = "missing".to_string();
                if !remote_runs.is_empty()
                    || !remote_factories.is_empty()
                    || !remote_hosted_optimizers.is_empty()
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
            _ => {}
        }
    }

    snapshot.local_gepa.active_run_count = local_runs.len();
    snapshot.remote_synth.active_run_count = remote_runs.len();
    snapshot.remote_synth.active_factory_count = remote_factories.len();
    snapshot.remote_synth.active_hosted_optimizer_count = remote_hosted_optimizers.len();
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
    snapshot.remote_synth.projects = remote_project_map.into_values().take(20).collect();
    snapshot.remote_synth.runs = remote_run_map.into_values().take(100).collect();
    snapshot.remote_synth.factories = remote_factory_map.into_values().take(50).collect();
    snapshot.remote_synth.hosted_optimizers =
        remote_hosted_optimizer_map.into_values().take(50).collect();
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
        || (snapshot.remote_synth.auth_status == "missing" && any_remote_active);
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

fn remote_hosted_optimizer_snapshot(event: &RuntimeEvent) -> RemoteHostedOptimizerSnapshot {
    let status = payload_string(event, "status").unwrap_or_else(|| "unknown".to_string());
    RemoteHostedOptimizerSnapshot {
        run_id: payload_string(event, "run_id").unwrap_or_else(|| event.subject.id.clone()),
        terminal: is_terminal_optimizer_status(&status),
        status,
        updated_at: payload_string(event, "updated_at"),
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

fn payload_string(event: &RuntimeEvent, key: &str) -> Option<String> {
    event
        .payload
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}
