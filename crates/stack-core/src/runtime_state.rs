use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FactorySnapshot {
    pub schema: String,
    pub updated_at: String,
    pub control_state: String,
    pub local_gepa: LocalGepaSnapshot,
    pub remote_synth: RemoteSynthSnapshot,
    pub recent_events: Vec<RuntimeEventRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalGepaSnapshot {
    pub sync_enabled: bool,
    pub service_status: String,
    pub service_url: Option<String>,
    pub active_run_id: Option<String>,
    pub active_run_count: usize,
    pub last_progress_at: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteSynthSnapshot {
    pub sync_enabled: bool,
    pub auth_status: String,
    pub environment_name: Option<String>,
    pub api_base_url: Option<String>,
    pub active_project_count: usize,
    pub active_run_count: usize,
    pub active_factory_count: usize,
    pub active_hosted_optimizer_count: usize,
    pub last_ok_at: Option<String>,
    pub projects: Vec<RemoteProjectSnapshot>,
    pub runs: Vec<RemoteRunSnapshot>,
    pub factories: Vec<RemoteFactorySnapshot>,
    pub hosted_optimizers: Vec<RemoteHostedOptimizerSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteProjectSnapshot {
    pub project_id: String,
    pub name: String,
    pub alias: Option<String>,
    pub updated_at: Option<String>,
    pub active_run_id: Option<String>,
    pub run_ids: Vec<String>,
    pub factory_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteRunSnapshot {
    pub run_id: String,
    pub project_id: Option<String>,
    pub state: String,
    pub phase: Option<String>,
    pub runbook: Option<String>,
    pub updated_at: Option<String>,
    pub terminal: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteFactorySnapshot {
    pub factory_id: String,
    pub name: String,
    pub kind: Option<String>,
    pub status: Option<String>,
    pub canonical_project_id: Option<String>,
    pub latest_project_id: Option<String>,
    pub latest_run_id: Option<String>,
    pub next_wake_at: Option<String>,
    pub active_efforts: Option<i64>,
    pub has_cloud_dev_env: Option<bool>,
    pub cloud_dev_label: Option<String>,
    pub is_running: Option<bool>,
    pub project_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteHostedOptimizerSnapshot {
    pub run_id: String,
    pub status: String,
    pub updated_at: Option<String>,
    pub terminal: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeEventRef {
    pub seq: i64,
    pub event_type: String,
    pub source: String,
    pub observed_at: String,
    pub subject_kind: String,
    pub subject_id: String,
}

impl FactorySnapshot {
    pub fn empty(updated_at: String) -> Self {
        Self {
            schema: "stack.factory_snapshot.v1".to_string(),
            updated_at,
            control_state: "quiescent".to_string(),
            local_gepa: LocalGepaSnapshot {
                sync_enabled: true,
                service_status: "unknown".to_string(),
                service_url: None,
                active_run_id: None,
                active_run_count: 0,
                last_progress_at: None,
                last_error: None,
            },
            remote_synth: RemoteSynthSnapshot {
                sync_enabled: false,
                auth_status: "unknown".to_string(),
                environment_name: None,
                api_base_url: None,
                active_project_count: 0,
                active_run_count: 0,
                active_factory_count: 0,
                active_hosted_optimizer_count: 0,
                last_ok_at: None,
                projects: Vec::new(),
                runs: Vec::new(),
                factories: Vec::new(),
                hosted_optimizers: Vec::new(),
            },
            recent_events: Vec::new(),
        }
    }
}
