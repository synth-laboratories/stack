use crate::meta_thread::{read_manifest, MetaThreadManifest, MetaThreadError};
use crate::meta_thread_state::enrich_checkpoint;
use crate::session::{
    list_summaries, read_session_by_id, session_path, write_session, StackLocalSession,
    StackSessionSummary,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use thiserror::Error;
use tokio::fs;

pub const CHECKPOINT_SCHEMA: &str = "stack/checkpoint/v1";
pub const CHECKPOINT_VERSION: u32 = 1;

#[derive(Debug, Error)]
pub enum CheckpointError {
    #[error("checkpoint not found")]
    NotFound,
    #[error("invalid checkpoint: {0}")]
    Invalid(String),
    #[error(transparent)]
    MetaThread(#[from] MetaThreadError),
    #[error(transparent)]
    Session(#[from] crate::session::SessionError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StackResumeCheckpoint {
    #[serde(default = "checkpoint_version")]
    pub version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    pub saved_at: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta_thread_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub segment_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codex_thread_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub harness: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codex_transport: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub goal_shutter_worker_peek: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focus_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub harness_resume: Option<crate::meta_thread_state::HarnessResumeState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta_thread_state: Option<crate::meta_thread_state::MetaThreadCheckpointState>,
}

fn checkpoint_version() -> u32 {
    CHECKPOINT_VERSION
}

impl StackResumeCheckpoint {
    pub fn normalize(mut self) -> Self {
        if self.version == 0 {
            self.version = CHECKPOINT_VERSION;
        }
        if self.schema.is_none() {
            self.schema = Some(CHECKPOINT_SCHEMA.to_string());
        }
        self
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeBundle {
    pub checkpoint: StackResumeCheckpoint,
    pub session: StackLocalSession,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manifest: Option<MetaThreadManifest>,
    pub resume_token: String,
    pub resume_command: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveCheckpointResponse {
    pub checkpoint: StackResumeCheckpoint,
    pub resume_token: String,
    pub resume_command: String,
    pub paths: CheckpointPaths,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointPaths {
    pub latest: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thread: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta_thread: Option<String>,
}

pub fn checkpoints_dir(stack_dir: &Path) -> PathBuf {
    stack_dir.join("checkpoints")
}

pub fn latest_checkpoint_path(stack_dir: &Path) -> PathBuf {
    checkpoints_dir(stack_dir).join("latest.json")
}

pub fn legacy_resume_path(stack_dir: &Path) -> PathBuf {
    stack_dir.join("resume.json")
}

pub fn thread_checkpoint_path(stack_dir: &Path, thread_id: &str) -> Result<PathBuf, CheckpointError> {
    Ok(checkpoints_dir(stack_dir)
        .join("threads")
        .join(safe_checkpoint_segment(thread_id)?)
        .join("latest.json"))
}

pub fn meta_thread_checkpoint_path(
    stack_dir: &Path,
    meta_thread_id: &str,
) -> Result<PathBuf, CheckpointError> {
    Ok(checkpoints_dir(stack_dir)
        .join("meta-threads")
        .join(safe_checkpoint_segment(meta_thread_id)?)
        .join("latest.json"))
}

pub fn resume_token_from_checkpoint(checkpoint: &StackResumeCheckpoint) -> String {
    if let Some(meta_thread_id) = checkpoint.meta_thread_id.as_deref() {
        return resume_token_from_meta_thread_id(meta_thread_id);
    }
    checkpoint.session_id.chars().take(8).collect()
}

pub fn resume_token_from_meta_thread_id(meta_thread_id: &str) -> String {
    if let Some(numeric) = meta_thread_id
        .split(|ch: char| !ch.is_ascii_digit())
        .find(|part| part.len() >= 6)
    {
        return numeric.chars().take(12).collect();
    }
    meta_thread_id
        .trim_start_matches("mt_")
        .trim_start_matches("mt")
        .chars()
        .take(12)
        .collect()
}

pub fn resume_command_from_checkpoint(checkpoint: &StackResumeCheckpoint) -> String {
    format!("stack resume {}", resume_token_from_checkpoint(checkpoint))
}

pub async fn read_latest_checkpoint(stack_dir: &Path) -> Result<StackResumeCheckpoint, CheckpointError> {
    let primary = latest_checkpoint_path(stack_dir);
    if let Ok(checkpoint) = read_checkpoint_file(&primary).await {
        return Ok(checkpoint);
    }
    let legacy = legacy_resume_path(stack_dir);
    read_checkpoint_file(&legacy).await
}

pub async fn write_checkpoint(
    stack_dir: &Path,
    checkpoint: &StackResumeCheckpoint,
) -> Result<CheckpointPaths, CheckpointError> {
    let mut normalized = checkpoint.clone().normalize();
    normalized.saved_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    let latest = latest_checkpoint_path(stack_dir);
    write_checkpoint_file(&latest, &normalized).await?;

    let legacy = legacy_resume_path(stack_dir);
    write_checkpoint_file(&legacy, &normalized).await?;

    let thread = if normalized.session_id.trim().is_empty() {
        None
    } else {
        let path = thread_checkpoint_path(stack_dir, &normalized.session_id)?;
        write_checkpoint_file(&path, &normalized).await?;
        Some(path.to_string_lossy().to_string())
    };

    let meta_thread = if let Some(meta_thread_id) = normalized.meta_thread_id.as_deref() {
        let path = meta_thread_checkpoint_path(stack_dir, meta_thread_id)?;
        write_checkpoint_file(&path, &normalized).await?;
        Some(path.to_string_lossy().to_string())
    } else {
        None
    };

    Ok(CheckpointPaths {
        latest: latest.to_string_lossy().to_string(),
        thread,
        meta_thread,
    })
}

pub async fn resolve_checkpoint(
    stack_dir: &Path,
    session_log_dir: &Path,
    query: Option<&str>,
) -> Result<StackResumeCheckpoint, CheckpointError> {
    let trimmed = query.map(str::trim).filter(|value| !value.is_empty());
    if trimmed.is_none() {
        return read_latest_checkpoint(stack_dir).await;
    }
    let query = trimmed.unwrap();
    let lowered = query.to_lowercase();

    if let Ok(latest) = read_latest_checkpoint(stack_dir).await {
        if checkpoint_matches_query(&latest, query) {
            return Ok(latest);
        }
    }

    if let Ok(path) = meta_thread_checkpoint_path(stack_dir, query) {
        if let Ok(checkpoint) = read_checkpoint_file(&path).await {
            if checkpoint_matches_query(&checkpoint, query) {
                return Ok(checkpoint);
            }
        }
    }

    let summaries = list_summaries(session_log_dir).await?;
    for summary in summaries {
        if summary.id.to_lowercase().starts_with(&lowered)
            || summary
                .meta_thread_id
                .as_deref()
                .is_some_and(|id| id.to_lowercase().contains(&lowered))
            || summary
                .meta_thread_id
                .as_deref()
                .is_some_and(|id| resume_token_from_meta_thread_id(id).to_lowercase().starts_with(&lowered))
        {
            if let Ok(checkpoint) = read_thread_checkpoint(stack_dir, &summary.id).await {
                return Ok(checkpoint);
            }
            return Ok(checkpoint_from_summary(&summary));
        }
    }

    Err(CheckpointError::NotFound)
}

pub async fn read_thread_checkpoint(
    stack_dir: &Path,
    thread_id: &str,
) -> Result<StackResumeCheckpoint, CheckpointError> {
    read_checkpoint_file(&thread_checkpoint_path(stack_dir, thread_id)?).await
}

pub async fn read_meta_thread_checkpoint(
    stack_dir: &Path,
    meta_thread_id: &str,
) -> Result<StackResumeCheckpoint, CheckpointError> {
    read_checkpoint_file(&meta_thread_checkpoint_path(stack_dir, meta_thread_id)?).await
}

pub async fn build_resume_bundle(
    stack_dir: &Path,
    session_log_dir: &Path,
    checkpoint: StackResumeCheckpoint,
) -> Result<ResumeBundle, CheckpointError> {
    let checkpoint = checkpoint.normalize();
    let session = read_session_by_id(session_log_dir, &checkpoint.session_id).await?;
    let manifest = match checkpoint.meta_thread_id.as_deref() {
        Some(meta_thread_id) => read_manifest(stack_dir, meta_thread_id).await.ok(),
        None => None,
    };
    let transport = checkpoint.codex_transport.clone();
    let backend = checkpoint.codex_thread_id.clone();
    let checkpoint = enrich_checkpoint(
        checkpoint,
        &session,
        manifest.as_ref(),
        transport.as_deref(),
        backend.as_deref(),
    );
    let resume_token = resume_token_from_checkpoint(&checkpoint);
    let resume_command = resume_command_from_checkpoint(&checkpoint);
    Ok(ResumeBundle {
        checkpoint,
        session,
        manifest,
        resume_token,
        resume_command,
    })
}

pub async fn build_thread_resume_bundle(
    stack_dir: &Path,
    session_log_dir: &Path,
    thread_id: &str,
) -> Result<ResumeBundle, CheckpointError> {
    let checkpoint = match read_thread_checkpoint(stack_dir, thread_id).await {
        Ok(checkpoint) => checkpoint,
        Err(CheckpointError::NotFound) => {
            let session = read_session_by_id(session_log_dir, thread_id).await?;
            checkpoint_from_session(&session)
        }
        Err(error) => return Err(error),
    };
    build_resume_bundle(stack_dir, session_log_dir, checkpoint).await
}

pub async fn build_meta_thread_resume_bundle(
    stack_dir: &Path,
    session_log_dir: &Path,
    meta_thread_id: &str,
) -> Result<ResumeBundle, CheckpointError> {
    let manifest = read_manifest(stack_dir, meta_thread_id).await?;
    let checkpoint = match read_meta_thread_checkpoint(stack_dir, meta_thread_id).await {
        Ok(checkpoint) => checkpoint,
        Err(CheckpointError::NotFound) => {
            let session = read_session_by_id(session_log_dir, &manifest.head_thread_id).await?;
            let mut checkpoint = checkpoint_from_session(&session);
            checkpoint.meta_thread_id = Some(manifest.id.clone());
            checkpoint.segment_id = Some(manifest.head_segment_id.clone());
            checkpoint.display_name = checkpoint
                .display_name
                .or_else(|| Some(manifest.title.clone()));
            enrich_checkpoint(
                checkpoint,
                &session,
                Some(&manifest),
                None,
                session.codex_thread_id.as_deref(),
            )
        }
        Err(error) => return Err(error),
    };
    build_resume_bundle(stack_dir, session_log_dir, checkpoint).await
}

pub fn checkpoint_from_session(session: &StackLocalSession) -> StackResumeCheckpoint {
    let checkpoint = StackResumeCheckpoint {
        version: CHECKPOINT_VERSION,
        schema: Some(CHECKPOINT_SCHEMA.to_string()),
        saved_at: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        session_id: session.id.clone(),
        meta_thread_id: session.meta_thread_id.clone(),
        segment_id: session.segment_id.clone(),
        codex_thread_id: crate::session::thread_id_from_session(session),
        harness: session.harness.clone(),
        codex_transport: None,
        goal_shutter_worker_peek: None,
        focus_mode: None,
        display_name: session.display_name.clone(),
        harness_resume: None,
        meta_thread_state: None,
    };
    enrich_checkpoint(checkpoint, session, None, None, session.codex_thread_id.as_deref())
}

fn checkpoint_from_summary(summary: &StackSessionSummary) -> StackResumeCheckpoint {
    let checkpoint = StackResumeCheckpoint {
        version: CHECKPOINT_VERSION,
        schema: Some(CHECKPOINT_SCHEMA.to_string()),
        saved_at: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        session_id: summary.id.clone(),
        meta_thread_id: summary.meta_thread_id.clone(),
        segment_id: summary.segment_id.clone(),
        codex_thread_id: summary.codex_thread_id.clone(),
        harness: summary.harness.clone(),
        codex_transport: None,
        goal_shutter_worker_peek: None,
        focus_mode: None,
        display_name: summary.display_name.clone(),
        harness_resume: None,
        meta_thread_state: None,
    };
    let session = StackLocalSession {
        id: summary.id.clone(),
        workspace_root: String::new(),
        started_at: summary.started_at.clone(),
        codex_command: String::new(),
        codex_model: None,
        codex_thread_id: summary.codex_thread_id.clone(),
        harness: summary.harness.clone(),
        harness_model: None,
        role: None,
        display_name: summary.display_name.clone(),
        meta_thread_id: summary.meta_thread_id.clone(),
        segment_id: summary.segment_id.clone(),
        segment_role: summary.segment_role.clone(),
        predecessor_thread_id: None,
        usage_summary: summary.usage_summary.clone(),
        turns: Vec::new(),
    };
    enrich_checkpoint(
        checkpoint,
        &session,
        None,
        None,
        summary.codex_thread_id.as_deref(),
    )
}

pub fn checkpoint_matches_query(checkpoint: &StackResumeCheckpoint, query: &str) -> bool {
    let lowered = query.to_lowercase();
    if checkpoint.session_id.to_lowercase().starts_with(&lowered) {
        return true;
    }
    if checkpoint
        .meta_thread_id
        .as_deref()
        .is_some_and(|id| id.to_lowercase().contains(&lowered))
    {
        return true;
    }
    resume_token_from_checkpoint(checkpoint)
        .to_lowercase()
        .starts_with(&lowered)
}

async fn read_checkpoint_file(path: &Path) -> Result<StackResumeCheckpoint, CheckpointError> {
    let text = fs::read_to_string(path).await.map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            CheckpointError::NotFound
        } else {
            CheckpointError::Io(error)
        }
    })?;
    let parsed: StackResumeCheckpoint = serde_json::from_str(&text)?;
    if parsed.version != CHECKPOINT_VERSION || parsed.session_id.trim().is_empty() {
        return Err(CheckpointError::Invalid(
            "checkpoint version or session_id missing".to_string(),
        ));
    }
    Ok(parsed.normalize())
}

async fn write_checkpoint_file(
    path: &Path,
    checkpoint: &StackResumeCheckpoint,
) -> Result<(), CheckpointError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    let text = serde_json::to_string_pretty(checkpoint)?;
    fs::write(path, format!("{text}\n")).await?;
    Ok(())
}

fn safe_checkpoint_segment(value: &str) -> Result<String, CheckpointError> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err(CheckpointError::Invalid(format!(
            "invalid checkpoint segment: {value}"
        )));
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

pub async fn persist_checkpoint_with_session(
    stack_dir: &Path,
    session_log_dir: &Path,
    checkpoint: StackResumeCheckpoint,
    session: &StackLocalSession,
) -> Result<SaveCheckpointResponse, CheckpointError> {
    write_session(session_log_dir, session).await?;
    let paths = write_checkpoint(stack_dir, &checkpoint).await?;
    let checkpoint = read_latest_checkpoint(stack_dir).await?;
    let resume_token = resume_token_from_checkpoint(&checkpoint);
    let resume_command = resume_command_from_checkpoint(&checkpoint);
    Ok(SaveCheckpointResponse {
        checkpoint,
        resume_token,
        resume_command,
        paths,
    })
}

pub fn session_log_exists(session_log_dir: &Path, session_id: &str) -> bool {
    session_path(session_log_dir, session_id)
        .ok()
        .is_some_and(|path| path.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resume_token_prefers_meta_thread_numeric_suffix() {
        let checkpoint = StackResumeCheckpoint {
            version: 1,
            schema: None,
            saved_at: "now".to_string(),
            session_id: "thread_abc".to_string(),
            meta_thread_id: Some("mt_17828509_suffix".to_string()),
            segment_id: None,
            codex_thread_id: None,
            harness: None,
            codex_transport: None,
            goal_shutter_worker_peek: None,
            focus_mode: None,
            display_name: None,
            harness_resume: None,
            meta_thread_state: None,
        };
        assert_eq!(resume_token_from_checkpoint(&checkpoint), "17828509");
    }

    #[test]
    fn checkpoint_matches_session_prefix() {
        let checkpoint = StackResumeCheckpoint {
            version: 1,
            schema: None,
            saved_at: "now".to_string(),
            session_id: "thread_21ac7c1a".to_string(),
            meta_thread_id: None,
            segment_id: None,
            codex_thread_id: None,
            harness: None,
            codex_transport: None,
            goal_shutter_worker_peek: None,
            focus_mode: None,
            display_name: None,
            harness_resume: None,
            meta_thread_state: None,
        };
        assert!(checkpoint_matches_query(&checkpoint, "thread_2"));
    }
}
