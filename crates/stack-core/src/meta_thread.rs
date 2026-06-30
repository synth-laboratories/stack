use crate::session::{StackSessionUsageSummary, StackSessionUsageTotals};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use thiserror::Error;
use tokio::fs;

pub const META_THREAD_SCHEMA: &str = "stack/meta-thread/v1";
pub const HANDOFF_SCHEMA: &str = "stack/handoff/v1";

#[derive(Debug, Error)]
pub enum MetaThreadError {
    #[error("meta-thread not found: {0}")]
    NotFound(String),
    #[error("handoff not found: {0}")]
    HandoffNotFound(String),
    #[error("invalid path segment: {0}")]
    InvalidPathSegment(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

/// Runtime harness + model binding for worker, gardener, or monitor at a segment boundary.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfig {
    pub agent_role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub segment_role: Option<String>,
    pub harness: String,
    pub model: String,
    pub reasoning_effort: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub harness_command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub monitor_profile: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub segment_id: Option<String>,
}

impl AgentConfig {
    pub fn worker(
        segment_role: impl Into<String>,
        harness: impl Into<String>,
        model: impl Into<String>,
        reasoning_effort: impl Into<String>,
    ) -> Self {
        Self {
            agent_role: "worker".to_string(),
            segment_role: Some(segment_role.into()),
            harness: harness.into(),
            model: model.into(),
            reasoning_effort: reasoning_effort.into(),
            harness_command: None,
            workspace_root: None,
            monitor_profile: None,
            thread_id: None,
            segment_id: None,
        }
    }

    pub fn with_thread(
        mut self,
        thread_id: impl Into<String>,
        segment_id: impl Into<String>,
    ) -> Self {
        self.thread_id = Some(thread_id.into());
        self.segment_id = Some(segment_id.into());
        self
    }

    pub fn from_segment(segment: &MetaThreadSegment) -> Self {
        Self {
            agent_role: segment.agent_role.clone(),
            segment_role: Some(segment.role.clone()),
            harness: segment.harness.clone(),
            model: segment.model.clone(),
            reasoning_effort: segment.reasoning_effort.clone(),
            harness_command: None,
            workspace_root: None,
            monitor_profile: None,
            thread_id: Some(segment.thread_id.clone()),
            segment_id: Some(segment.segment_id.clone()),
        }
    }
}

/// First-class handoff record: compact summary + parent/child agent configs + timestamps.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Handoff {
    pub schema: String,
    pub id: String,
    pub meta_thread_id: String,
    /// Operator/agent-facing compact state — not the full parent transcript.
    pub summary: String,
    pub parent: AgentConfig,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub child: Option<AgentConfig>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub artifact_ids: Vec<String>,
    pub status: HandoffStatus,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sealed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approved_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub continued_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HandoffStatus {
    Draft,
    NeedsReview,
    Approved,
    Continued,
    Rejected,
    Superseded,
}

impl Handoff {
    pub fn new(
        id: impl Into<String>,
        meta_thread_id: impl Into<String>,
        summary: impl Into<String>,
        parent: AgentConfig,
        created_at: impl Into<String>,
    ) -> Self {
        Self {
            schema: HANDOFF_SCHEMA.to_string(),
            id: id.into(),
            meta_thread_id: meta_thread_id.into(),
            summary: summary.into(),
            parent,
            child: None,
            artifact_ids: Vec::new(),
            status: HandoffStatus::NeedsReview,
            created_at: created_at.into(),
            sealed_at: None,
            approved_at: None,
            continued_at: None,
            approved_by: None,
        }
    }

    pub fn seal(mut self, sealed_at: impl Into<String>, artifact_ids: Vec<String>) -> Self {
        self.sealed_at = Some(sealed_at.into());
        self.artifact_ids = artifact_ids;
        self.status = HandoffStatus::NeedsReview;
        self
    }

    pub fn approve(
        mut self,
        approved_at: impl Into<String>,
        approved_by: impl Into<String>,
    ) -> Self {
        self.approved_at = Some(approved_at.into());
        self.approved_by = Some(approved_by.into());
        self.status = HandoffStatus::Approved;
        self
    }

    pub fn continue_with(mut self, child: AgentConfig, continued_at: impl Into<String>) -> Self {
        self.child = Some(child);
        self.continued_at = Some(continued_at.into());
        self.status = HandoffStatus::Continued;
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HandoffRef {
    pub id: String,
    pub parent_segment_id: String,
    pub parent_thread_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub child_segment_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub child_thread_id: Option<String>,
    pub status: HandoffStatus,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MetaThreadManifest {
    pub schema: String,
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_ref: Option<String>,
    #[serde(default)]
    pub repo_refs: Vec<String>,
    #[serde(default)]
    pub worktree_refs: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub segments: Vec<MetaThreadSegment>,
    pub head_segment_id: String,
    pub head_thread_id: String,
    #[serde(default)]
    pub artifacts: Vec<MetaThreadArtifactRef>,
    #[serde(default)]
    pub handoffs: Vec<HandoffRef>,
    #[serde(default)]
    pub decisions: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gardener_thread_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub monitor_profile: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_goal: Option<MetaThreadActiveGoal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_summary: Option<StackSessionUsageSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MetaThreadActiveGoal {
    pub objective: String,
    pub status: String,
    #[serde(default)]
    pub acceptance_criteria: Vec<String>,
    #[serde(default)]
    pub blockers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MetaThreadSegment {
    pub segment_id: String,
    pub thread_id: String,
    pub role: String,
    pub agent_role: String,
    pub model: String,
    pub reasoning_effort: String,
    pub harness: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handoff_out: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub handoff_in: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub predecessor_segment_id: Option<String>,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sealed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_summary: Option<StackSessionUsageSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MetaThreadArtifactRef {
    pub id: String,
    pub meta_thread_id: String,
    pub artifact_type: String,
    pub path: String,
    pub version: u64,
    pub created_by_segment_id: String,
    pub created_by_thread_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handoff_id: Option<String>,
}

pub fn meta_thread_dir(stack_dir: &Path, id: &str) -> Result<PathBuf, MetaThreadError> {
    Ok(stack_dir.join("meta-threads").join(safe_segment(id)?))
}

pub fn manifest_path(stack_dir: &Path, id: &str) -> Result<PathBuf, MetaThreadError> {
    Ok(meta_thread_dir(stack_dir, id)?.join("manifest.json"))
}

pub fn handoff_path(
    stack_dir: &Path,
    meta_thread_id: &str,
    handoff_id: &str,
) -> Result<PathBuf, MetaThreadError> {
    Ok(meta_thread_dir(stack_dir, meta_thread_id)?
        .join("handoffs")
        .join(format!("{}.json", safe_segment(handoff_id)?)))
}

pub fn meta_events_path(stack_dir: &Path, id: &str) -> Result<PathBuf, MetaThreadError> {
    Ok(meta_thread_dir(stack_dir, id)?.join("events.jsonl"))
}

pub async fn read_manifest(
    stack_dir: &Path,
    id: &str,
) -> Result<MetaThreadManifest, MetaThreadError> {
    let path = manifest_path(stack_dir, id)?;
    let text = fs::read_to_string(&path).await?;
    Ok(serde_json::from_str(&text)?)
}

pub async fn write_manifest(
    stack_dir: &Path,
    manifest: &MetaThreadManifest,
) -> Result<(), MetaThreadError> {
    let path = manifest_path(stack_dir, &manifest.id)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    let text = serde_json::to_string_pretty(manifest)?;
    fs::write(path, format!("{text}\n")).await?;
    Ok(())
}

pub fn build_meta_thread_usage_summary(
    manifest: &MetaThreadManifest,
) -> Option<StackSessionUsageSummary> {
    let mut totals = StackSessionUsageTotals {
        input_tokens: 0,
        cached_input_tokens: 0,
        output_tokens: 0,
        reasoning_output_tokens: 0,
        turn_count_with_usage: 0,
    };
    let mut model: Option<String> = None;
    let mut mixed_model = false;

    for segment in &manifest.segments {
        let Some(summary) = &segment.usage_summary else {
            continue;
        };
        totals.input_tokens += summary.totals.input_tokens;
        totals.cached_input_tokens += summary.totals.cached_input_tokens;
        totals.output_tokens += summary.totals.output_tokens;
        totals.reasoning_output_tokens += summary.totals.reasoning_output_tokens;
        totals.turn_count_with_usage += summary.totals.turn_count_with_usage;
        match &model {
            Some(existing) if existing != &summary.model => mixed_model = true,
            None => model = Some(summary.model.clone()),
            _ => {}
        }
    }

    if totals.turn_count_with_usage == 0 {
        return None;
    }

    Some(StackSessionUsageSummary {
        model: if mixed_model {
            "mixed".to_string()
        } else {
            model?
        },
        totals,
        estimated_spend_usd: None,
    })
}

pub async fn read_handoff(
    stack_dir: &Path,
    meta_thread_id: &str,
    handoff_id: &str,
) -> Result<Handoff, MetaThreadError> {
    let path = handoff_path(stack_dir, meta_thread_id, handoff_id)?;
    let text = fs::read_to_string(&path).await.map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            MetaThreadError::HandoffNotFound(handoff_id.to_string())
        } else {
            MetaThreadError::Io(error)
        }
    })?;
    Ok(serde_json::from_str(&text)?)
}

pub async fn write_handoff(
    stack_dir: &Path,
    handoff: &Handoff,
) -> Result<PathBuf, MetaThreadError> {
    let path = handoff_path(stack_dir, &handoff.meta_thread_id, &handoff.id)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    let text = serde_json::to_string_pretty(handoff)?;
    fs::write(&path, format!("{text}\n")).await?;
    Ok(path)
}

pub fn handoff_ref(handoff: &Handoff) -> HandoffRef {
    HandoffRef {
        id: handoff.id.clone(),
        parent_segment_id: handoff.parent.segment_id.clone().unwrap_or_default(),
        parent_thread_id: handoff.parent.thread_id.clone().unwrap_or_default(),
        child_segment_id: handoff
            .child
            .as_ref()
            .and_then(|child| child.segment_id.clone()),
        child_thread_id: handoff
            .child
            .as_ref()
            .and_then(|child| child.thread_id.clone()),
        status: handoff.status.clone(),
        created_at: handoff.created_at.clone(),
    }
}

pub fn safe_segment(value: &str) -> Result<String, MetaThreadError> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err(MetaThreadError::InvalidPathSegment(value.to_string()));
    }
    Ok(trimmed
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' || ch == '.' {
                ch
            } else {
                '_'
            }
        })
        .collect())
}
