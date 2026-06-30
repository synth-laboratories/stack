use crate::runtime::sensors::SensorPoll;
use chrono::Utc;
use reqwest::Client;
use serde_json::{json, Value};
use stack_core::runtime_event::{RuntimeCorrelation, RuntimeEventDraft, RuntimeSubject};
use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

const DEFAULT_SYNTH_API_BASE_URL: &str = "https://api.usesynth.ai";
const REMOTE_SYNTH_TIMEOUT: Duration = Duration::from_secs(5);

pub async fn poll(client: &Client, prior_cursor: Value) -> SensorPoll {
    let mut cursor = RemoteSynthCursor::from_value(prior_cursor);
    let observed_at = Utc::now().to_rfc3339();
    let mut events = Vec::new();
    let api_key = std::env::var("SYNTH_API_KEY")
        .ok()
        .filter(|value| !value.trim().is_empty());
    let Some(api_key) = api_key else {
        if cursor.auth_status.as_deref() != Some("missing") {
            events.push(auth_event(
                "sensor.remote.auth.missing",
                &observed_at,
                "missing",
            ));
        }
        cursor.auth_status = Some("missing".to_string());
        return SensorPoll {
            events,
            cursor: cursor.into_value(),
        };
    };

    if cursor.auth_status.as_deref() != Some("ready") {
        events.push(auth_event(
            "sensor.remote.auth.ready",
            &observed_at,
            "ready",
        ));
    }
    cursor.auth_status = Some("ready".to_string());

    let base_url = std::env::var("STACK_SYNTH_API_BASE_URL")
        .or_else(|_| std::env::var("SYNTH_API_BASE_URL"))
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_SYNTH_API_BASE_URL.to_string());

    if let Ok(projects) = fetch_json(
        client,
        &api_key,
        &base_url,
        "/smr/projects?limit=6&include_archived=false",
    )
    .await
    {
        let mut observed_project_ids = BTreeSet::new();
        let mut observed_run_ids = BTreeSet::new();
        let mut successful_run_project_ids = BTreeSet::new();
        for project in read_projects(&projects) {
            observed_project_ids.insert(project.project_id.clone());
            let previous_project = cursor.projects.get(&project.project_id);
            if previous_project.is_none_or(|prior| project.changed(prior)) {
                events.push(project_event(
                    "sensor.remote.project.updated",
                    &project,
                    &observed_at,
                    previous_project.cloned(),
                ));
            }
            cursor
                .projects
                .insert(project.project_id.clone(), project.clone());
            if let Ok(runs_payload) = fetch_json(
                client,
                &api_key,
                &base_url,
                &format!("/smr/projects/{}/runs?limit=5", project.project_id),
            )
            .await
            {
                successful_run_project_ids.insert(project.project_id.clone());
                for run in read_runs(&runs_payload, Some(project.project_id.clone())) {
                    observed_run_ids.insert(run.run_id.clone());
                    let previous = cursor.runs.get(&run.run_id);
                    if previous.is_none_or(|prior| run.changed(prior)) {
                        events.push(run_event(
                            if run.is_terminal() {
                                "sensor.remote.project_run.terminal"
                            } else {
                                "sensor.remote.project_run.updated"
                            },
                            &run,
                            &observed_at,
                            previous.cloned(),
                        ));
                    }
                    cursor.runs.insert(run.run_id.clone(), run);
                }
            }
        }
        let unobserved_projects = cursor
            .projects
            .values()
            .filter(|project| !observed_project_ids.contains(&project.project_id))
            .cloned()
            .collect::<Vec<_>>();
        for project in unobserved_projects {
            events.push(project_event(
                "sensor.remote.project.unobserved",
                &project,
                &observed_at,
                Some(project.clone()),
            ));
            let project_runs = cursor
                .runs
                .values()
                .filter(|run| {
                    run.project_id.as_deref() == Some(project.project_id.as_str())
                        && !run.is_terminal()
                })
                .cloned()
                .collect::<Vec<_>>();
            for run in project_runs {
                events.push(run_event(
                    "sensor.remote.project_run.unobserved",
                    &run,
                    &observed_at,
                    Some(run.clone()),
                ));
                cursor.runs.remove(&run.run_id);
            }
            cursor.projects.remove(&project.project_id);
        }
        let unobserved_runs = cursor
            .runs
            .values()
            .filter(|run| {
                run.project_id
                    .as_ref()
                    .is_some_and(|project_id| successful_run_project_ids.contains(project_id))
                    && !observed_run_ids.contains(&run.run_id)
                    && !run.is_terminal()
            })
            .cloned()
            .collect::<Vec<_>>();
        for run in unobserved_runs {
            events.push(run_event(
                "sensor.remote.project_run.unobserved",
                &run,
                &observed_at,
                Some(run.clone()),
            ));
            cursor.runs.remove(&run.run_id);
        }
    }

    if let Ok(factories) = fetch_json(
        client,
        &api_key,
        &base_url,
        "/smr/factories?include_archived=false",
    )
    .await
    {
        let mut observed_factory_ids = BTreeSet::new();
        for mut factory in read_factories(&factories) {
            observed_factory_ids.insert(factory.factory_id.clone());
            if let Ok(project_links) = fetch_json(
                client,
                &api_key,
                &base_url,
                &format!("/smr/factories/{}/projects", factory.factory_id),
            )
            .await
            {
                factory.project_ids = read_factory_project_ids(&project_links);
            }
            if let Ok(status) = fetch_json(
                client,
                &api_key,
                &base_url,
                &format!("/smr/factories/{}/status", factory.factory_id),
            )
            .await
            {
                factory.apply_status_payload(&status);
            }
            let previous = cursor.factories.get(&factory.factory_id);
            if previous.is_none_or(|prior| factory.changed(prior)) {
                events.push(factory_event(
                    "sensor.remote.factory.updated",
                    &factory,
                    &observed_at,
                    previous.cloned(),
                ));
            }
            cursor.factories.insert(factory.factory_id.clone(), factory);
        }
        let unobserved_factories = cursor
            .factories
            .values()
            .filter(|factory| !observed_factory_ids.contains(&factory.factory_id))
            .cloned()
            .collect::<Vec<_>>();
        for mut factory in unobserved_factories {
            factory.status = Some("unobserved".to_string());
            factory.active_efforts = Some(0);
            factory.is_running = Some(false);
            events.push(factory_event(
                "sensor.remote.factory.unobserved",
                &factory,
                &observed_at,
                Some(factory.clone()),
            ));
            cursor.factories.remove(&factory.factory_id);
        }
    }

    if let Ok(optimizers) = fetch_json(
        client,
        &api_key,
        &base_url,
        "/api/v1/optimizers/runs?limit=12",
    )
    .await
    {
        let mut observed_optimizer_ids = BTreeSet::new();
        for optimizer in read_optimizers(&optimizers) {
            observed_optimizer_ids.insert(optimizer.run_id.clone());
            let previous = cursor.optimizers.get(&optimizer.run_id);
            if previous.is_none_or(|prior| optimizer.changed(prior)) {
                events.push(optimizer_event(
                    "sensor.remote.hosted_optimizer.updated",
                    &optimizer,
                    &observed_at,
                    previous.cloned(),
                ));
            }
            cursor
                .optimizers
                .insert(optimizer.run_id.clone(), optimizer);
        }
        let unobserved_optimizers = cursor
            .optimizers
            .values()
            .filter(|optimizer| {
                !observed_optimizer_ids.contains(&optimizer.run_id) && !optimizer.is_terminal()
            })
            .cloned()
            .collect::<Vec<_>>();
        for mut optimizer in unobserved_optimizers {
            optimizer.status = Some("unobserved".to_string());
            events.push(optimizer_event(
                "sensor.remote.hosted_optimizer.unobserved",
                &optimizer,
                &observed_at,
                Some(optimizer.clone()),
            ));
            cursor.optimizers.remove(&optimizer.run_id);
        }
    }

    cursor.checked_at = Some(observed_at);
    SensorPoll {
        events,
        cursor: cursor.into_value(),
    }
}

async fn fetch_json(
    client: &Client,
    api_key: &str,
    base_url: &str,
    path: &str,
) -> Result<Value, reqwest::Error> {
    client
        .get(format!("{}{}", base_url.trim_end_matches('/'), path))
        .bearer_auth(api_key)
        .timeout(REMOTE_SYNTH_TIMEOUT)
        .send()
        .await?
        .error_for_status()?
        .json::<Value>()
        .await
}

fn auth_event(event_type: &str, observed_at: &str, auth_status: &str) -> RuntimeEventDraft {
    RuntimeEventDraft {
        event_type: event_type.to_string(),
        source: "sensor.remote_synth".to_string(),
        observed_at: observed_at.to_string(),
        subject: RuntimeSubject {
            kind: "synth_auth".to_string(),
            id: "selected_environment".to_string(),
        },
        correlation: RuntimeCorrelation::default(),
        payload: json!({ "auth_status": auth_status }),
    }
}

fn project_event(
    event_type: &str,
    project: &RemoteProjectCursor,
    observed_at: &str,
    previous: Option<RemoteProjectCursor>,
) -> RuntimeEventDraft {
    RuntimeEventDraft {
        event_type: event_type.to_string(),
        source: "sensor.remote_synth".to_string(),
        observed_at: observed_at.to_string(),
        subject: RuntimeSubject {
            kind: "remote_project".to_string(),
            id: project.project_id.clone(),
        },
        correlation: RuntimeCorrelation {
            project_id: Some(project.project_id.clone()),
            ..RuntimeCorrelation::default()
        },
        payload: json!({
            "project_id": project.project_id,
            "name": project.name,
            "alias": project.alias,
            "updated_at": project.updated_at,
            "active_run_id": project.active_run_id,
            "previous": previous,
        }),
    }
}

fn run_event(
    event_type: &str,
    run: &RemoteRunCursor,
    observed_at: &str,
    previous: Option<RemoteRunCursor>,
) -> RuntimeEventDraft {
    RuntimeEventDraft {
        event_type: event_type.to_string(),
        source: "sensor.remote_synth".to_string(),
        observed_at: observed_at.to_string(),
        subject: RuntimeSubject {
            kind: "remote_smr_run".to_string(),
            id: run.run_id.clone(),
        },
        correlation: RuntimeCorrelation {
            project_id: run.project_id.clone(),
            run_id: Some(run.run_id.clone()),
            ..RuntimeCorrelation::default()
        },
        payload: json!({
            "run_id": run.run_id,
            "project_id": run.project_id,
            "state": run.state,
            "phase": run.phase,
            "runbook": run.runbook,
            "updated_at": run.updated_at,
            "previous": previous,
        }),
    }
}

fn factory_event(
    event_type: &str,
    factory: &RemoteFactoryCursor,
    observed_at: &str,
    previous: Option<RemoteFactoryCursor>,
) -> RuntimeEventDraft {
    RuntimeEventDraft {
        event_type: event_type.to_string(),
        source: "sensor.remote_synth".to_string(),
        observed_at: observed_at.to_string(),
        subject: RuntimeSubject {
            kind: "remote_factory".to_string(),
            id: factory.factory_id.clone(),
        },
        correlation: RuntimeCorrelation {
            factory_id: Some(factory.factory_id.clone()),
            ..RuntimeCorrelation::default()
        },
        payload: json!({
            "factory_id": factory.factory_id,
            "name": factory.name,
            "kind": factory.kind,
            "status": factory.status,
            "canonical_project_id": factory.canonical_project_id,
            "latest_project_id": factory.latest_project_id,
            "latest_run_id": factory.latest_run_id,
            "next_wake_at": factory.next_wake_at,
            "active_efforts": factory.active_efforts,
            "has_cloud_dev_env": factory.has_cloud_dev_env,
            "cloud_dev_label": factory.cloud_dev_label,
            "is_running": factory.is_running,
            "project_ids": factory.project_ids,
            "previous": previous,
        }),
    }
}

fn optimizer_event(
    event_type: &str,
    optimizer: &RemoteOptimizerCursor,
    observed_at: &str,
    previous: Option<RemoteOptimizerCursor>,
) -> RuntimeEventDraft {
    RuntimeEventDraft {
        event_type: event_type.to_string(),
        source: "sensor.remote_synth".to_string(),
        observed_at: observed_at.to_string(),
        subject: RuntimeSubject {
            kind: "hosted_optimizer_run".to_string(),
            id: optimizer.run_id.clone(),
        },
        correlation: RuntimeCorrelation {
            optimizer_run_id: Some(optimizer.run_id.clone()),
            ..RuntimeCorrelation::default()
        },
        payload: json!({
            "run_id": optimizer.run_id,
            "status": optimizer.status,
            "updated_at": optimizer.updated_at,
            "previous": previous,
        }),
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct RemoteSynthCursor {
    auth_status: Option<String>,
    checked_at: Option<String>,
    #[serde(default)]
    projects: BTreeMap<String, RemoteProjectCursor>,
    #[serde(default)]
    runs: BTreeMap<String, RemoteRunCursor>,
    #[serde(default)]
    factories: BTreeMap<String, RemoteFactoryCursor>,
    #[serde(default)]
    optimizers: BTreeMap<String, RemoteOptimizerCursor>,
}

impl RemoteSynthCursor {
    fn from_value(value: Value) -> Self {
        serde_json::from_value(value).unwrap_or(Self {
            auth_status: None,
            checked_at: None,
            projects: BTreeMap::new(),
            runs: BTreeMap::new(),
            factories: BTreeMap::new(),
            optimizers: BTreeMap::new(),
        })
    }

    fn into_value(self) -> Value {
        serde_json::to_value(self).unwrap_or_else(|_| json!({}))
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct RemoteProjectCursor {
    project_id: String,
    name: Option<String>,
    alias: Option<String>,
    updated_at: Option<String>,
    active_run_id: Option<String>,
}

impl RemoteProjectCursor {
    fn changed(&self, prior: &Self) -> bool {
        self.name != prior.name
            || self.alias != prior.alias
            || self.updated_at != prior.updated_at
            || self.active_run_id != prior.active_run_id
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct RemoteRunCursor {
    run_id: String,
    project_id: Option<String>,
    state: Option<String>,
    phase: Option<String>,
    runbook: Option<String>,
    updated_at: Option<String>,
}

impl RemoteRunCursor {
    fn changed(&self, prior: &Self) -> bool {
        self.project_id != prior.project_id
            || self.state != prior.state
            || self.phase != prior.phase
            || self.runbook != prior.runbook
            || self.updated_at != prior.updated_at
    }

    fn is_terminal(&self) -> bool {
        let state = format!(
            "{}{}",
            self.state.as_deref().unwrap_or_default(),
            self.phase
                .as_deref()
                .map(|phase| format!("/{phase}"))
                .unwrap_or_default()
        )
        .to_ascii_lowercase();
        state.contains("done")
            || state.contains("complete")
            || state.contains("failed")
            || state.contains("cancel")
            || state.contains("terminal")
            || state.contains("stopped")
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct RemoteFactoryCursor {
    factory_id: String,
    name: Option<String>,
    kind: Option<String>,
    status: Option<String>,
    canonical_project_id: Option<String>,
    latest_project_id: Option<String>,
    latest_run_id: Option<String>,
    next_wake_at: Option<String>,
    active_efforts: Option<i64>,
    has_cloud_dev_env: Option<bool>,
    cloud_dev_label: Option<String>,
    is_running: Option<bool>,
    #[serde(default)]
    project_ids: Vec<String>,
}

impl RemoteFactoryCursor {
    fn changed(&self, prior: &Self) -> bool {
        self.name != prior.name
            || self.kind != prior.kind
            || self.status != prior.status
            || self.canonical_project_id != prior.canonical_project_id
            || self.latest_project_id != prior.latest_project_id
            || self.latest_run_id != prior.latest_run_id
            || self.next_wake_at != prior.next_wake_at
            || self.active_efforts != prior.active_efforts
            || self.has_cloud_dev_env != prior.has_cloud_dev_env
            || self.cloud_dev_label != prior.cloud_dev_label
            || self.is_running != prior.is_running
            || self.project_ids != prior.project_ids
    }

    fn apply_status_payload(&mut self, payload: &Value) {
        let factory = payload.get("factory").unwrap_or(payload);
        self.status = read_string(factory, "status").or_else(|| self.status.clone());
        self.next_wake_at =
            read_string(payload, "next_wake_at").or_else(|| self.next_wake_at.clone());
        self.active_efforts = payload
            .get("efforts_by_status")
            .and_then(|value| value.get("active"))
            .and_then(Value::as_i64)
            .or(self.active_efforts);
        self.latest_run_id = payload
            .get("latest_runs")
            .and_then(Value::as_array)
            .and_then(|runs| runs.first())
            .and_then(|run| read_string(run, "run_id"))
            .or_else(|| self.latest_run_id.clone());
        let active_projects = active_factory_project_ids(payload);
        if !active_projects.is_empty() {
            self.project_ids = active_projects;
        }
        self.canonical_project_id = self
            .project_ids
            .first()
            .cloned()
            .or_else(|| self.canonical_project_id.clone());
        self.latest_project_id = self
            .canonical_project_id
            .clone()
            .or_else(|| self.latest_project_id.clone());
        let cloud = read_cloud_dev(payload);
        self.has_cloud_dev_env = Some(cloud.0);
        self.cloud_dev_label = cloud.1;
        self.is_running = Some(factory_is_running(
            self.status.as_deref(),
            payload
                .get("runtime")
                .and_then(|runtime| read_string(runtime, "state"))
                .as_deref(),
            payload
                .get("runtime")
                .and_then(|runtime| runtime.get("enabled"))
                .and_then(Value::as_bool),
            self.active_efforts,
        ));
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct RemoteOptimizerCursor {
    run_id: String,
    status: Option<String>,
    updated_at: Option<String>,
}

impl RemoteOptimizerCursor {
    fn changed(&self, prior: &Self) -> bool {
        self.status != prior.status || self.updated_at != prior.updated_at
    }

    fn is_terminal(&self) -> bool {
        let status = self
            .status
            .as_deref()
            .unwrap_or_default()
            .to_ascii_lowercase();
        status.contains("complete")
            || status.contains("done")
            || status.contains("failed")
            || status.contains("cancel")
            || status.contains("terminal")
            || status.contains("unobserved")
    }
}

fn read_projects(value: &Value) -> Vec<RemoteProjectCursor> {
    array_payload(value)
        .into_iter()
        .filter_map(|item| {
            let project_id =
                read_string(&item, "project_id").or_else(|| read_string(&item, "id"))?;
            Some(RemoteProjectCursor {
                project_id,
                name: read_string(&item, "name").or_else(|| read_string(&item, "project_alias")),
                alias: read_string(&item, "project_alias"),
                updated_at: read_string(&item, "updated_at"),
                active_run_id: read_string(&item, "active_run_id"),
            })
        })
        .collect()
}

fn read_runs(value: &Value, fallback_project_id: Option<String>) -> Vec<RemoteRunCursor> {
    array_payload(value)
        .into_iter()
        .filter_map(|item| {
            let run_id = read_string(&item, "run_id").or_else(|| read_string(&item, "id"))?;
            Some(RemoteRunCursor {
                run_id,
                project_id: read_string(&item, "project_id")
                    .or_else(|| fallback_project_id.clone()),
                state: read_string(&item, "public_state").or_else(|| read_string(&item, "status")),
                phase: read_string(&item, "liveness_phase"),
                runbook: read_string(&item, "runbook"),
                updated_at: read_string(&item, "updated_at")
                    .or_else(|| read_string(&item, "started_at"))
                    .or_else(|| read_string(&item, "created_at")),
            })
        })
        .collect()
}

fn read_factories(value: &Value) -> Vec<RemoteFactoryCursor> {
    array_payload(value)
        .into_iter()
        .filter_map(|item| {
            let factory_id =
                read_string(&item, "factory_id").or_else(|| read_string(&item, "id"))?;
            Some(RemoteFactoryCursor {
                factory_id,
                name: read_string(&item, "name"),
                kind: read_string(&item, "kind"),
                status: read_string(&item, "status"),
                canonical_project_id: read_string(&item, "canonical_project_id"),
                latest_project_id: read_string(&item, "latest_project_id"),
                latest_run_id: read_string(&item, "latest_run_id"),
                next_wake_at: read_string(&item, "next_wake_at"),
                active_efforts: None,
                has_cloud_dev_env: None,
                cloud_dev_label: None,
                is_running: None,
                project_ids: Vec::new(),
            })
        })
        .collect()
}

fn read_optimizers(value: &Value) -> Vec<RemoteOptimizerCursor> {
    array_payload(value)
        .into_iter()
        .filter_map(|item| {
            let run_id = read_string(&item, "run_id").or_else(|| read_string(&item, "id"))?;
            Some(RemoteOptimizerCursor {
                run_id,
                status: read_string(&item, "status"),
                updated_at: read_string(&item, "updated_at")
                    .or_else(|| read_string(&item, "created_at")),
            })
        })
        .collect()
}

fn read_factory_project_ids(value: &Value) -> Vec<String> {
    array_payload(value)
        .into_iter()
        .filter_map(|item| {
            let project = item.get("project").unwrap_or(&item);
            read_string(&item, "project_id").or_else(|| read_string(project, "project_id"))
        })
        .collect()
}

fn active_factory_project_ids(value: &Value) -> Vec<String> {
    let mut ids = Vec::new();
    for key in ["linked_projects", "projects"] {
        for item in value
            .get(key)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
        {
            let project = item.get("project").unwrap_or(&item);
            if let Some(project_id) =
                read_string(&item, "project_id").or_else(|| read_string(project, "project_id"))
            {
                if !ids.contains(&project_id) {
                    ids.push(project_id);
                }
            }
        }
    }
    ids
}

fn factory_is_running(
    factory_status: Option<&str>,
    runtime_state: Option<&str>,
    runtime_enabled: Option<bool>,
    active_efforts: Option<i64>,
) -> bool {
    if factory_status != Some("active") {
        return false;
    }
    if runtime_enabled == Some(false) {
        return false;
    }
    if active_efforts.unwrap_or(0) > 0 {
        return true;
    }
    matches!(runtime_state.unwrap_or_default(), "due" | "scheduled")
}

fn read_cloud_dev(value: &Value) -> (bool, Option<String>) {
    if let Some(slot) = find_string_deep(value, &["cloud_slot_id", "cloud_slot"]) {
        return (true, Some(short_cloud_label(&slot)));
    }
    if let Some(kind) = find_string_deep(value, &["host_kind", "substrate_kind", "kind"]) {
        let normalized = kind.to_ascii_lowercase();
        if normalized != "local"
            && normalized != "docker"
            && normalized != "local-dockerized"
            && normalized != "local_dockerized"
        {
            return (true, Some(short_cloud_label(&kind)));
        }
    }
    (false, None)
}

fn find_string_deep(value: &Value, keys: &[&str]) -> Option<String> {
    if let Some(object) = value.as_object() {
        for key in keys {
            if let Some(found) = object.get(*key).and_then(Value::as_str) {
                return Some(found.to_string());
            }
        }
        for nested in object.values() {
            if let Some(found) = find_string_deep(nested, keys) {
                return Some(found);
            }
        }
    }
    if let Some(array) = value.as_array() {
        for item in array {
            if let Some(found) = find_string_deep(item, keys) {
                return Some(found);
            }
        }
    }
    None
}

fn short_cloud_label(value: &str) -> String {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.contains("railway") {
        return "railway".to_string();
    }
    if normalized.contains("daytona") {
        return "daytona".to_string();
    }
    if normalized.contains("exe_dev") || normalized.contains("exedev") {
        return "exe.dev".to_string();
    }
    value.chars().take(10).collect()
}

fn array_payload(value: &Value) -> Vec<Value> {
    value
        .as_array()
        .cloned()
        .or_else(|| value.get("items").and_then(Value::as_array).cloned())
        .or_else(|| value.get("runs").and_then(Value::as_array).cloned())
        .or_else(|| value.get("projects").and_then(Value::as_array).cloned())
        .or_else(|| value.get("factories").and_then(Value::as_array).cloned())
        .unwrap_or_default()
}

fn read_string(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}
