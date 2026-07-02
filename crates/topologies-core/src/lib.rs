use std::fmt;

use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use thiserror::Error;
use uuid::Uuid;

pub mod graph;

pub const WORKFLOW_SCHEMA_VERSION: &str = "topologies.workflow.v1";
pub const ARTIFACT_SCHEMA_VERSION: &str = "topologies.artifact_ref.v1";
pub const RESULT_SCHEMA_VERSION: &str = "topologies.result.v1";
pub const BUDGET_SCHEMA_VERSION: &str = "topologies.budget.v1";
pub const TOPOLOGY_SCHEMA_VERSION: &str = "topologies.staged_topology.v1";

#[derive(Debug, Error)]
pub enum TopologyError {
    #[error("validation failed: {0}")]
    Validation(String),
    #[error("budget admission rejected for {kind}: {reason}")]
    BudgetRejected { kind: String, reason: String },
    #[error("unsupported workflow task kind: {0}")]
    UnsupportedTaskKind(String),
    #[error("serialization failed: {0}")]
    Serialization(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, TopologyError>;

#[derive(
    Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema,
)]
#[serde(transparent)]
pub struct WorkflowRunId(String);

impl WorkflowRunId {
    pub fn new() -> Self {
        Self(format!("wf_{}", Uuid::now_v7().simple()))
    }

    pub fn from_static(value: impl Into<String>) -> Result<Self> {
        let value = value.into();
        require_non_empty("workflow_run_id", &value)?;
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for WorkflowRunId {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for WorkflowRunId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

#[derive(
    Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema,
)]
#[serde(transparent)]
pub struct SpawnCallId(String);

impl SpawnCallId {
    pub fn new(value: impl Into<String>) -> Result<Self> {
        let value = value.into();
        require_non_empty("spawn_call_id", &value)?;
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowTaskKind {
    Deepsearch,
    PutnamBenchInterleaved,
    ProgramBench,
    FailureModeMining,
    Custom,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TopologyHookKind {
    RolloutCompleted,
    ProposerCheckpointReady,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TopologyStatus {
    Staged,
    Armed,
    Fired,
    Completed,
    Cancelled,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct WorkflowSpec {
    pub schema_version: String,
    pub task_kind: WorkflowTaskKind,
    pub title: String,
    pub script: WorkflowScript,
    #[serde(default)]
    pub args: Value,
    #[serde(default)]
    pub budget: BudgetEnvelope,
    #[serde(default)]
    pub metadata: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct TopologyTrigger {
    pub hook: TopologyHookKind,
    pub min_completed_rollouts: u64,
    #[serde(default = "default_fire_once")]
    pub fire_once: bool,
    #[serde(default)]
    pub rollout_batch_size: Option<u64>,
}

impl TopologyTrigger {
    pub fn validate(&self) -> Result<()> {
        if self.min_completed_rollouts == 0 {
            return Err(TopologyError::Validation(
                "min_completed_rollouts must be positive".to_string(),
            ));
        }
        if matches!(self.rollout_batch_size, Some(0)) {
            return Err(TopologyError::Validation(
                "rollout_batch_size must be positive when set".to_string(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct StagedTopologySpec {
    pub schema_version: String,
    pub topology_id: String,
    pub proposer_id: String,
    pub optimizer_run_id: String,
    pub trigger: TopologyTrigger,
    pub workflow: WorkflowSpec,
    #[serde(default)]
    pub metadata: Value,
}

impl StagedTopologySpec {
    pub fn new(
        topology_id: impl Into<String>,
        proposer_id: impl Into<String>,
        optimizer_run_id: impl Into<String>,
        trigger: TopologyTrigger,
        workflow: WorkflowSpec,
    ) -> Result<Self> {
        let topology_id = topology_id.into();
        let proposer_id = proposer_id.into();
        let optimizer_run_id = optimizer_run_id.into();
        require_non_empty("topology_id", &topology_id)?;
        require_non_empty("proposer_id", &proposer_id)?;
        require_non_empty("optimizer_run_id", &optimizer_run_id)?;
        trigger.validate()?;
        workflow.validate()?;
        Ok(Self {
            schema_version: TOPOLOGY_SCHEMA_VERSION.to_string(),
            topology_id,
            proposer_id,
            optimizer_run_id,
            trigger,
            workflow,
            metadata: Value::Object(Default::default()),
        })
    }

    pub fn validate(&self) -> Result<()> {
        if self.schema_version != TOPOLOGY_SCHEMA_VERSION {
            return Err(TopologyError::Validation(format!(
                "unsupported staged topology schema_version {:?}",
                self.schema_version
            )));
        }
        require_non_empty("topology_id", &self.topology_id)?;
        require_non_empty("proposer_id", &self.proposer_id)?;
        require_non_empty("optimizer_run_id", &self.optimizer_run_id)?;
        self.trigger.validate()?;
        self.workflow.validate()?;
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct OptimizerRolloutRef {
    pub rollout_id: String,
    #[serde(default)]
    pub candidate_id: Option<String>,
    #[serde(default)]
    pub environment: Option<String>,
    #[serde(default)]
    pub reward: Option<f64>,
    #[serde(default)]
    pub trace_uri: Option<String>,
    #[serde(default)]
    pub metadata: Value,
}

impl OptimizerRolloutRef {
    pub fn validate(&self) -> Result<()> {
        require_non_empty("rollout_id", &self.rollout_id)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct OptimizerHookEvent {
    pub hook: TopologyHookKind,
    pub optimizer_run_id: String,
    pub completed_rollout_count: u64,
    #[serde(default)]
    pub rollouts: Vec<OptimizerRolloutRef>,
    #[serde(default)]
    pub metadata: Value,
}

impl OptimizerHookEvent {
    pub fn validate(&self) -> Result<()> {
        require_non_empty("optimizer_run_id", &self.optimizer_run_id)?;
        for rollout in &self.rollouts {
            rollout.validate()?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct TopologyFireRecord {
    pub topology_id: String,
    pub run_id: WorkflowRunId,
    pub hook: TopologyHookKind,
    pub completed_rollout_count: u64,
    pub rollout_count: u64,
    pub at: DateTime<Utc>,
    #[serde(default)]
    pub metadata: Value,
}

impl WorkflowSpec {
    pub fn new(
        task_kind: WorkflowTaskKind,
        title: impl Into<String>,
        script: WorkflowScript,
    ) -> Result<Self> {
        let title = title.into();
        require_non_empty("title", &title)?;
        Ok(Self {
            schema_version: WORKFLOW_SCHEMA_VERSION.to_string(),
            task_kind,
            title,
            script,
            args: Value::Null,
            budget: BudgetEnvelope::default(),
            metadata: Value::Object(Default::default()),
        })
    }

    pub fn validate(&self) -> Result<()> {
        if self.schema_version != WORKFLOW_SCHEMA_VERSION {
            return Err(TopologyError::Validation(format!(
                "unsupported workflow schema_version {:?}",
                self.schema_version
            )));
        }
        require_non_empty("title", &self.title)?;
        self.script.validate()?;
        self.budget.validate()?;
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WorkflowScript {
    MontyPython {
        source: String,
    },
    Template {
        name: String,
        revision: Option<String>,
    },
}

impl WorkflowScript {
    pub fn monty(source: impl Into<String>) -> Result<Self> {
        let source = source.into();
        require_non_empty("source", &source)?;
        Ok(Self::MontyPython { source })
    }

    pub fn validate(&self) -> Result<()> {
        match self {
            Self::MontyPython { source } => require_non_empty("source", source),
            Self::Template { name, .. } => require_non_empty("template.name", name),
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct BudgetEnvelope {
    pub schema_version: Option<String>,
    pub max_prompt_tokens: Option<u64>,
    pub max_completion_tokens: Option<u64>,
    pub max_total_tokens: Option<u64>,
    pub max_cost_usd: Option<f64>,
    pub max_wall_seconds: Option<u64>,
    pub max_agents: Option<u64>,
}

impl BudgetEnvelope {
    pub fn validate(&self) -> Result<()> {
        if let Some(schema_version) = &self.schema_version {
            if schema_version != BUDGET_SCHEMA_VERSION {
                return Err(TopologyError::Validation(format!(
                    "unsupported budget schema_version {schema_version:?}"
                )));
            }
        }
        if matches!(self.max_cost_usd, Some(value) if value < 0.0) {
            return Err(TopologyError::Validation(
                "max_cost_usd must be non-negative".to_string(),
            ));
        }
        Ok(())
    }

    pub fn admit(&self, request: &BudgetRequest) -> Result<BudgetAdmission> {
        self.validate()?;
        let mut breaches = Vec::new();
        if exceeds(self.max_prompt_tokens, request.prompt_tokens) {
            breaches.push("prompt_tokens");
        }
        if exceeds(self.max_completion_tokens, request.completion_tokens) {
            breaches.push("completion_tokens");
        }
        if exceeds(self.max_total_tokens, request.total_tokens) {
            breaches.push("total_tokens");
        }
        if exceeds_f64(self.max_cost_usd, request.cost_usd) {
            breaches.push("cost_usd");
        }
        if exceeds(self.max_wall_seconds, request.wall_seconds) {
            breaches.push("wall_seconds");
        }
        if exceeds(self.max_agents, request.agents) {
            breaches.push("agents");
        }
        if breaches.is_empty() {
            Ok(BudgetAdmission::Admitted)
        } else {
            Ok(BudgetAdmission::Rejected {
                reason: breaches.join(","),
            })
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct BudgetRequest {
    pub prompt_tokens: Option<u64>,
    pub completion_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
    pub cost_usd: Option<f64>,
    pub wall_seconds: Option<u64>,
    pub agents: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BudgetAdmission {
    Admitted,
    Rejected { reason: String },
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ArtifactRef {
    pub schema_version: String,
    pub path: String,
    pub kind: String,
    pub sha256: String,
    pub bytes: u64,
    pub retention: String,
}

impl ArtifactRef {
    pub fn from_bytes(
        path: impl Into<String>,
        kind: impl Into<String>,
        retention: impl Into<String>,
        bytes: &[u8],
    ) -> Result<Self> {
        let kind = kind.into();
        require_non_empty("artifact.kind", &kind)?;
        let mut digest = Sha256::new();
        digest.update(bytes);
        Ok(Self {
            schema_version: ARTIFACT_SCHEMA_VERSION.to_string(),
            path: path.into(),
            kind,
            sha256: format!("{:x}", digest.finalize()),
            bytes: bytes.len() as u64,
            retention: retention.into(),
        })
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct SpawnRequest {
    pub actor: Value,
    pub inputs: Value,
    #[serde(default)]
    pub isolation: Option<String>,
    #[serde(default)]
    pub output_schema: Option<Value>,
}

impl SpawnRequest {
    pub fn journal_key(
        &self,
        run_id: &WorkflowRunId,
        call_id: &SpawnCallId,
        ordinal: u64,
    ) -> Result<JournalKey> {
        JournalKey::for_spawn(run_id, call_id, ordinal, self)
    }
}

#[derive(
    Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema,
)]
#[serde(transparent)]
pub struct JournalKey(String);

impl JournalKey {
    pub fn for_spawn(
        run_id: &WorkflowRunId,
        call_id: &SpawnCallId,
        ordinal: u64,
        request: &SpawnRequest,
    ) -> Result<Self> {
        let stable_request = serde_json::to_vec(request)?;
        let mut digest = Sha256::new();
        digest.update(run_id.as_str().as_bytes());
        digest.update(call_id.as_str().as_bytes());
        digest.update(ordinal.to_le_bytes());
        digest.update(stable_request);
        Ok(Self(format!("journal_{:x}", digest.finalize())))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowStatus {
    Planned,
    Running,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct WorkflowResult {
    pub schema_version: String,
    pub run_id: WorkflowRunId,
    pub status: WorkflowStatus,
    #[serde(default)]
    pub result: Value,
    #[serde(default)]
    pub artifacts: Vec<ArtifactRef>,
    #[serde(default)]
    pub citations: Vec<Citation>,
    #[serde(default)]
    pub usage: UsageSummary,
    #[serde(default)]
    pub error: Option<WorkflowError>,
    #[serde(default)]
    pub metadata: Value,
}

impl WorkflowResult {
    pub fn completed(run_id: WorkflowRunId, result: Value) -> Self {
        Self {
            schema_version: RESULT_SCHEMA_VERSION.to_string(),
            run_id,
            status: WorkflowStatus::Completed,
            result,
            artifacts: Vec::new(),
            citations: Vec::new(),
            usage: UsageSummary::default(),
            error: None,
            metadata: Value::Object(Default::default()),
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct UsageSummary {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub total_tokens: u64,
    pub cost_usd: f64,
    pub agent_count: u64,
    pub wall_seconds: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct Citation {
    pub label: String,
    pub artifact: ArtifactRef,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct WorkflowError {
    pub error_type: String,
    pub message: String,
    pub retryable: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct WorkflowCheckpoint {
    pub run_id: WorkflowRunId,
    pub sequence: u64,
    pub status: WorkflowStatus,
    pub at: DateTime<Utc>,
    pub note: String,
}

fn require_non_empty(field: &str, value: &str) -> Result<()> {
    if value.trim().is_empty() {
        Err(TopologyError::Validation(format!(
            "{field} must be non-empty"
        )))
    } else {
        Ok(())
    }
}

fn default_fire_once() -> bool {
    true
}

fn exceeds(limit: Option<u64>, requested: Option<u64>) -> bool {
    matches!((limit, requested), (Some(limit), Some(requested)) if requested > limit)
}

fn exceeds_f64(limit: Option<f64>, requested: Option<f64>) -> bool {
    matches!((limit, requested), (Some(limit), Some(requested)) if requested > limit)
}
