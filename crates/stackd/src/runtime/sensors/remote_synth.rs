use crate::runtime::sensors::SensorPoll;
use chrono::Utc;
use reqwest::Client;
use serde_json::{json, Value};
use stack_core::config::StackPaths;
use stack_core::runtime_event::{RuntimeCorrelation, RuntimeEventDraft, RuntimeSubject};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::PathBuf;
use std::time::Duration;

const DEFAULT_SYNTH_API_BASE_URL: &str = "https://api.usesynth.ai";
const REMOTE_SYNTH_TIMEOUT: Duration = Duration::from_secs(5);

pub async fn poll(client: &Client, prior_cursor: Value, paths: &StackPaths) -> SensorPoll {
    let mut cursor = RemoteSynthCursor::from_value(prior_cursor);
    let observed_at = Utc::now().to_rfc3339();
    let mut events = Vec::new();
    let profile = RemoteSynthProfile::resolve(paths);
    if cursor.environment_name.as_deref() != Some(profile.environment_name.as_str())
        || cursor.api_base_url.as_deref() != Some(profile.api_base_url.as_str())
    {
        events.push(environment_event(&observed_at, &profile));
        cursor.auth_status = None;
        cursor.projects.clear();
        cursor.runs.clear();
        cursor.factories.clear();
        cursor.optimizers.clear();
        cursor.deployments.clear();
    }
    cursor.environment_name = Some(profile.environment_name.clone());
    cursor.api_base_url = Some(profile.api_base_url.clone());
    let api_key = profile.auth_token();
    let Some(api_key) = api_key else {
        if cursor.auth_status.as_deref() != Some("missing") {
            events.push(auth_event(
                "sensor.remote.auth.missing",
                &observed_at,
                "missing",
                &profile,
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
            &profile,
        ));
    }
    cursor.auth_status = Some("ready".to_string());
    let base_url = profile.api_base_url.clone();

    match fetch_json(
        client,
        &api_key,
        &base_url,
        "/smr/projects?limit=6&include_archived=false",
    )
    .await
    {
        Ok(projects) => {
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
                        &profile,
                        previous_project.cloned(),
                    ));
                }
                cursor
                    .projects
                    .insert(project.project_id.clone(), project.clone());
                match fetch_json(
                    client,
                    &api_key,
                    &base_url,
                    &format!("/smr/projects/{}/runs?limit=5", project.project_id),
                )
                .await
                {
                    Ok(runs_payload) => {
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
                                    &profile,
                                    previous.cloned(),
                                ));
                            }
                            cursor.runs.insert(run.run_id.clone(), run);
                        }
                    }
                    Err(error) => events.push(fetch_failed_event(
                        "sensor.remote.project_runs.fetch_failed",
                        "remote_project",
                        &project.project_id,
                        &observed_at,
                        &format!("/smr/projects/{}/runs?limit=5", project.project_id),
                        error,
                        &profile,
                        RuntimeCorrelation {
                            project_id: Some(project.project_id.clone()),
                            ..RuntimeCorrelation::default()
                        },
                    )),
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
                    &profile,
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
                        &profile,
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
                    &profile,
                    Some(run.clone()),
                ));
                cursor.runs.remove(&run.run_id);
            }
        }
        Err(error) => events.push(fetch_failed_event(
            "sensor.remote.projects.fetch_failed",
            "remote_project_list",
            "projects",
            &observed_at,
            "/smr/projects?limit=6&include_archived=false",
            error,
            &profile,
            RuntimeCorrelation::default(),
        )),
    }

    match fetch_json(
        client,
        &api_key,
        &base_url,
        "/smr/factories?include_archived=false",
    )
    .await
    {
        Ok(factories) => {
            let mut observed_factory_ids = BTreeSet::new();
            for mut factory in read_factories(&factories) {
                observed_factory_ids.insert(factory.factory_id.clone());
                let previous = cursor.factories.get(&factory.factory_id).cloned();
                match fetch_json(
                    client,
                    &api_key,
                    &base_url,
                    &format!("/smr/factories/{}/projects", factory.factory_id),
                )
                .await
                {
                    Ok(project_links) => {
                        factory.project_ids = read_factory_project_ids(&project_links);
                    }
                    Err(error) => events.push(fetch_failed_event(
                        "sensor.remote.factory_projects.fetch_failed",
                        "remote_factory",
                        &factory.factory_id,
                        &observed_at,
                        &format!("/smr/factories/{}/projects", factory.factory_id),
                        error,
                        &profile,
                        RuntimeCorrelation {
                            factory_id: Some(factory.factory_id.clone()),
                            ..RuntimeCorrelation::default()
                        },
                    )),
                }
                match fetch_json(
                    client,
                    &api_key,
                    &base_url,
                    &format!("/smr/factories/{}/status", factory.factory_id),
                )
                .await
                {
                    Ok(status) => {
                        factory.apply_status_payload(&status);
                    }
                    Err(error) => events.push(fetch_failed_event(
                        "sensor.remote.factory_status.fetch_failed",
                        "remote_factory",
                        &factory.factory_id,
                        &observed_at,
                        &format!("/smr/factories/{}/status", factory.factory_id),
                        error,
                        &profile,
                        RuntimeCorrelation {
                            factory_id: Some(factory.factory_id.clone()),
                            ..RuntimeCorrelation::default()
                        },
                    )),
                }
                if let Some(prior) = previous.as_ref() {
                    factory.preserve_missing_enrichment(prior);
                }
                if previous.as_ref().is_none_or(|prior| factory.changed(prior)) {
                    events.push(factory_event(
                        "sensor.remote.factory.updated",
                        &factory,
                        &observed_at,
                        &profile,
                        previous.clone(),
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
                    &profile,
                    Some(factory.clone()),
                ));
                cursor.factories.remove(&factory.factory_id);
            }
        }
        Err(error) => events.push(fetch_failed_event(
            "sensor.remote.factories.fetch_failed",
            "remote_factory_list",
            "factories",
            &observed_at,
            "/smr/factories?include_archived=false",
            error,
            &profile,
            RuntimeCorrelation::default(),
        )),
    }

    match fetch_json(
        client,
        &api_key,
        &base_url,
        "/api/v1/optimizers/runs?limit=12",
    )
    .await
    {
        Ok(optimizers) => {
            let mut observed_optimizer_ids = BTreeSet::new();
            for optimizer in read_optimizers(&optimizers) {
                observed_optimizer_ids.insert(optimizer.run_id.clone());
                let previous = cursor.optimizers.get(&optimizer.run_id);
                if previous.is_none_or(|prior| optimizer.changed(prior)) {
                    events.push(optimizer_event(
                        "sensor.remote.hosted_optimizer.updated",
                        &optimizer,
                        &observed_at,
                        &profile,
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
                    &profile,
                    Some(optimizer.clone()),
                ));
                cursor.optimizers.remove(&optimizer.run_id);
            }
        }
        Err(error) => events.push(fetch_failed_event(
            "sensor.remote.hosted_optimizers.fetch_failed",
            "hosted_optimizer_list",
            "hosted_optimizers",
            &observed_at,
            "/api/v1/optimizers/runs?limit=12",
            error,
            &profile,
            RuntimeCorrelation::default(),
        )),
    }

    match fetch_json(
        client,
        &api_key,
        &base_url,
        "/smr/deployments?limit=20&include_archived=false",
    )
    .await
    {
        Ok(deployments) => {
            let mut observed_deployment_ids = BTreeSet::new();
            for deployment in read_deployments(&deployments) {
                observed_deployment_ids.insert(deployment.deployment_id.clone());
                let previous = cursor.deployments.get(&deployment.deployment_id);
                if previous.is_none_or(|prior| deployment.changed(prior)) {
                    events.push(deployment_event(
                        "sensor.remote.deployment.updated",
                        &deployment,
                        &observed_at,
                        &profile,
                        previous.cloned(),
                    ));
                }
                cursor
                    .deployments
                    .insert(deployment.deployment_id.clone(), deployment);
            }
            let unobserved_deployments = cursor
                .deployments
                .values()
                .filter(|deployment| !observed_deployment_ids.contains(&deployment.deployment_id))
                .cloned()
                .collect::<Vec<_>>();
            for mut deployment in unobserved_deployments {
                deployment.status = Some("unobserved".to_string());
                deployment.ready = Some(false);
                events.push(deployment_event(
                    "sensor.remote.deployment.unobserved",
                    &deployment,
                    &observed_at,
                    &profile,
                    Some(deployment.clone()),
                ));
                cursor.deployments.remove(&deployment.deployment_id);
            }
        }
        Err(error) => events.push(fetch_failed_event(
            "sensor.remote.deployments.fetch_failed",
            "remote_deployment_list",
            "deployments",
            &observed_at,
            "/smr/deployments?limit=20&include_archived=false",
            error,
            &profile,
            RuntimeCorrelation::default(),
        )),
    }

    cursor.checked_at = Some(observed_at);
    SensorPoll {
        events,
        cursor: cursor.into_value(),
    }
}

#[derive(Debug, Clone)]
struct RemoteSynthProfile {
    environment_name: String,
    api_base_url: String,
    auth_env: String,
    auth_env_file: Option<PathBuf>,
}

impl RemoteSynthProfile {
    fn resolve(paths: &StackPaths) -> Self {
        let config = fs::read_to_string(paths.app_root.join("stack.config.json"))
            .ok()
            .and_then(|text| serde_json::from_str::<Value>(&text).ok())
            .unwrap_or_else(|| json!({}));
        let environment_name = std::env::var("STACK_ENVIRONMENT")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| read_string(&config, "defaultEnvironment"))
            .filter(|value| matches!(value.as_str(), "dev" | "staging" | "prod"))
            .unwrap_or_else(|| "dev".to_string());
        let defaults = default_remote_environment(&environment_name);
        let environment = config
            .get("environments")
            .and_then(|value| value.get(&environment_name));
        let api_base_url = std::env::var("STACK_SYNTH_API_BASE_URL")
            .or_else(|_| std::env::var("SYNTH_API_BASE_URL"))
            .ok()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| environment.and_then(|value| read_string(value, "apiBaseUrl")))
            .unwrap_or(defaults.api_base_url);
        let auth_env = environment
            .and_then(|value| read_string(value, "authEnv"))
            .unwrap_or(defaults.auth_env);
        let auth_env_file = environment
            .and_then(|value| read_string(value, "authEnvFile"))
            .or(defaults.auth_env_file)
            .map(|path| resolve_config_path(&paths.app_root, &path));
        Self {
            environment_name,
            api_base_url,
            auth_env,
            auth_env_file,
        }
    }

    fn auth_token(&self) -> Option<String> {
        std::env::var(&self.auth_env)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .or_else(|| {
                self.auth_env_file
                    .as_ref()
                    .and_then(|path| read_env_file_value(path, &self.auth_env))
            })
    }
}

struct RemoteEnvironmentDefaults {
    api_base_url: String,
    auth_env: String,
    auth_env_file: Option<String>,
}

fn default_remote_environment(environment_name: &str) -> RemoteEnvironmentDefaults {
    match environment_name {
        "dev" => RemoteEnvironmentDefaults {
            api_base_url: "http://127.0.0.1:8000".to_string(),
            auth_env: "SYNTH_API_KEY".to_string(),
            auth_env_file: Some("../synth-ai/.env".to_string()),
        },
        "staging" => RemoteEnvironmentDefaults {
            api_base_url: "https://api-dev.usesynth.ai".to_string(),
            auth_env: "SYNTH_STAGING_API_KEY".to_string(),
            auth_env_file: None,
        },
        _ => RemoteEnvironmentDefaults {
            api_base_url: DEFAULT_SYNTH_API_BASE_URL.to_string(),
            auth_env: "SYNTH_API_KEY".to_string(),
            auth_env_file: None,
        },
    }
}

fn resolve_config_path(app_root: &std::path::Path, path: &str) -> PathBuf {
    let path = PathBuf::from(path);
    if path.is_absolute() {
        path
    } else {
        app_root.join(path)
    }
}

fn read_env_file_value(path: &std::path::Path, key: &str) -> Option<String> {
    for line in fs::read_to_string(path).ok()?.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line);
        let Some((name, value)) = line.split_once('=') else {
            continue;
        };
        if name.trim() != key {
            continue;
        }
        let value = unquote_env_value(value.trim());
        if !value.is_empty() {
            return Some(value);
        }
    }
    None
}

fn unquote_env_value(value: &str) -> String {
    let bytes = value.as_bytes();
    if bytes.len() >= 2
        && ((bytes[0] == b'"' && bytes[bytes.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[bytes.len() - 1] == b'\''))
    {
        value[1..value.len() - 1].to_string()
    } else {
        value.to_string()
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

fn environment_event(observed_at: &str, profile: &RemoteSynthProfile) -> RuntimeEventDraft {
    RuntimeEventDraft {
        event_type: "sensor.remote.environment.selected".to_string(),
        source: "sensor.remote_synth".to_string(),
        observed_at: observed_at.to_string(),
        subject: RuntimeSubject {
            kind: "synth_environment".to_string(),
            id: profile.environment_name.clone(),
        },
        correlation: RuntimeCorrelation::default(),
        payload: json!({
            "environment": profile.environment_name,
            "api_base_url": profile.api_base_url,
            "auth_env": profile.auth_env,
        }),
    }
}

fn auth_event(
    event_type: &str,
    observed_at: &str,
    auth_status: &str,
    profile: &RemoteSynthProfile,
) -> RuntimeEventDraft {
    RuntimeEventDraft {
        event_type: event_type.to_string(),
        source: "sensor.remote_synth".to_string(),
        observed_at: observed_at.to_string(),
        subject: RuntimeSubject {
            kind: "synth_auth".to_string(),
            id: "selected_environment".to_string(),
        },
        correlation: RuntimeCorrelation::default(),
        payload: json!({
            "auth_status": auth_status,
            "environment": profile.environment_name,
            "api_base_url": profile.api_base_url,
            "auth_env": profile.auth_env,
        }),
    }
}

fn fetch_failed_event(
    event_type: &str,
    subject_kind: &str,
    subject_id: &str,
    observed_at: &str,
    path: &str,
    error: reqwest::Error,
    profile: &RemoteSynthProfile,
    correlation: RuntimeCorrelation,
) -> RuntimeEventDraft {
    RuntimeEventDraft {
        event_type: event_type.to_string(),
        source: "sensor.remote_synth".to_string(),
        observed_at: observed_at.to_string(),
        subject: RuntimeSubject {
            kind: subject_kind.to_string(),
            id: subject_id.to_string(),
        },
        correlation,
        payload: json!({
            "path": path,
            "error": error.to_string(),
            "environment": profile.environment_name,
            "api_base_url": profile.api_base_url,
        }),
    }
}

fn project_event(
    event_type: &str,
    project: &RemoteProjectCursor,
    observed_at: &str,
    profile: &RemoteSynthProfile,
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
            "environment": profile.environment_name,
            "api_base_url": profile.api_base_url,
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
    profile: &RemoteSynthProfile,
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
            "environment": profile.environment_name,
            "api_base_url": profile.api_base_url,
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
    profile: &RemoteSynthProfile,
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
            "environment": profile.environment_name,
            "api_base_url": profile.api_base_url,
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
    profile: &RemoteSynthProfile,
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
            "environment": profile.environment_name,
            "api_base_url": profile.api_base_url,
            "run_id": optimizer.run_id,
            "status": optimizer.status,
            "updated_at": optimizer.updated_at,
            "previous": previous,
        }),
    }
}

fn deployment_event(
    event_type: &str,
    deployment: &RemoteDeploymentCursor,
    observed_at: &str,
    profile: &RemoteSynthProfile,
    previous: Option<RemoteDeploymentCursor>,
) -> RuntimeEventDraft {
    RuntimeEventDraft {
        event_type: event_type.to_string(),
        source: "sensor.remote_synth".to_string(),
        observed_at: observed_at.to_string(),
        subject: RuntimeSubject {
            kind: "remote_deployment".to_string(),
            id: deployment.deployment_id.clone(),
        },
        correlation: RuntimeCorrelation {
            project_id: deployment.project_id.clone(),
            factory_id: deployment.factory_id.clone(),
            deployment_id: Some(deployment.deployment_id.clone()),
            ..RuntimeCorrelation::default()
        },
        payload: json!({
            "environment": profile.environment_name,
            "api_base_url": profile.api_base_url,
            "deployment_id": deployment.deployment_id,
            "name": deployment.name,
            "status": deployment.status,
            "preflight_status": deployment.preflight_status,
            "degraded_reason": deployment.degraded_reason,
            "project_id": deployment.project_id,
            "factory_id": deployment.factory_id,
            "topology": deployment.topology,
            "substrate": deployment.substrate,
            "updated_at": deployment.updated_at,
            "ready": deployment.ready,
            "previous": previous,
        }),
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct RemoteSynthCursor {
    environment_name: Option<String>,
    api_base_url: Option<String>,
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
    #[serde(default)]
    deployments: BTreeMap<String, RemoteDeploymentCursor>,
}

impl RemoteSynthCursor {
    fn from_value(value: Value) -> Self {
        serde_json::from_value(value).unwrap_or(Self {
            environment_name: None,
            api_base_url: None,
            auth_status: None,
            checked_at: None,
            projects: BTreeMap::new(),
            runs: BTreeMap::new(),
            factories: BTreeMap::new(),
            optimizers: BTreeMap::new(),
            deployments: BTreeMap::new(),
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

    fn preserve_missing_enrichment(&mut self, prior: &Self) {
        if self.status.is_none() {
            self.status = prior.status.clone();
        }
        if self.canonical_project_id.is_none() {
            self.canonical_project_id = prior.canonical_project_id.clone();
        }
        if self.latest_project_id.is_none() {
            self.latest_project_id = prior.latest_project_id.clone();
        }
        if self.latest_run_id.is_none() {
            self.latest_run_id = prior.latest_run_id.clone();
        }
        if self.next_wake_at.is_none() {
            self.next_wake_at = prior.next_wake_at.clone();
        }
        if self.active_efforts.is_none() {
            self.active_efforts = prior.active_efforts;
        }
        if self.has_cloud_dev_env.is_none() {
            self.has_cloud_dev_env = prior.has_cloud_dev_env;
        }
        if self.cloud_dev_label.is_none() {
            self.cloud_dev_label = prior.cloud_dev_label.clone();
        }
        if self.is_running.is_none() {
            self.is_running = prior.is_running;
        }
        if self.project_ids.is_empty() {
            self.project_ids = prior.project_ids.clone();
        }
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

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct RemoteDeploymentCursor {
    deployment_id: String,
    name: Option<String>,
    status: Option<String>,
    preflight_status: Option<String>,
    degraded_reason: Option<String>,
    project_id: Option<String>,
    factory_id: Option<String>,
    topology: Option<String>,
    substrate: Option<String>,
    updated_at: Option<String>,
    ready: Option<bool>,
}

impl RemoteDeploymentCursor {
    fn changed(&self, prior: &Self) -> bool {
        self.name != prior.name
            || self.status != prior.status
            || self.preflight_status != prior.preflight_status
            || self.degraded_reason != prior.degraded_reason
            || self.project_id != prior.project_id
            || self.factory_id != prior.factory_id
            || self.topology != prior.topology
            || self.substrate != prior.substrate
            || self.updated_at != prior.updated_at
            || self.ready != prior.ready
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

fn read_deployments(value: &Value) -> Vec<RemoteDeploymentCursor> {
    array_payload(value)
        .into_iter()
        .filter_map(|item| {
            let deployment_id = read_string(&item, "cloud_deployment_id")
                .or_else(|| read_string(&item, "deployment_id"))
                .or_else(|| read_string(&item, "id"))?;
            let status = read_string(&item, "status");
            let preflight_status =
                read_string(&item, "preflight_status").or_else(|| read_string(&item, "health"));
            let degraded_reason = read_string(&item, "degraded_reason")
                .or_else(|| read_string(&item, "failure_reason"))
                .or_else(|| read_string(&item, "message"));
            Some(RemoteDeploymentCursor {
                deployment_id,
                name: read_string(&item, "name").or_else(|| read_string(&item, "display_name")),
                ready: read_bool(&item, "ready").or_else(|| {
                    let status = status.as_deref().unwrap_or_default().to_ascii_lowercase();
                    let preflight = preflight_status
                        .as_deref()
                        .unwrap_or_default()
                        .to_ascii_lowercase();
                    if status.is_empty() && preflight.is_empty() {
                        None
                    } else {
                        Some(
                            matches!(status.as_str(), "ready" | "active" | "healthy")
                                || matches!(preflight.as_str(), "ready" | "passed" | "pass"),
                        )
                    }
                }),
                status,
                preflight_status,
                degraded_reason,
                project_id: read_string(&item, "project_id")
                    .or_else(|| read_string(&item, "linked_project_id")),
                factory_id: read_string(&item, "factory_id")
                    .or_else(|| read_string(&item, "default_factory_id")),
                topology: read_string(&item, "topology_ref")
                    .or_else(|| read_string(&item, "environment_name"))
                    .or_else(|| read_string(&item, "environment")),
                substrate: read_string(&item, "preferred_substrate")
                    .or_else(|| read_string(&item, "substrate"))
                    .or_else(|| read_string(&item, "host_kind")),
                updated_at: read_string(&item, "updated_at")
                    .or_else(|| read_string(&item, "last_preflight_at"))
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
    if let Some(values) = value.as_array() {
        return values.clone();
    }
    if let Some(values) = value.get("items").and_then(Value::as_array) {
        return values.clone();
    }
    for key in [
        "runs",
        "projects",
        "factories",
        "optimizers",
        "deployments",
        "cloud_deployments",
    ] {
        if let Some(values) = value.get(key).and_then(Value::as_array) {
            return values.clone();
        }
        if let Some(values) = value
            .get(key)
            .and_then(|nested| nested.get("items"))
            .and_then(Value::as_array)
        {
            return values.clone();
        }
    }
    Vec::new()
}

fn read_string(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

fn read_bool(value: &Value, key: &str) -> Option<bool> {
    value.get(key).and_then(Value::as_bool)
}
