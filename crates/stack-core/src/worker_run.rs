use crate::meta_thread::MetaThreadActiveGoal;
use crate::session::{StackCodexTurn, StackLocalSession};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use tokio::fs;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkerRunState {
    Idle,
    Running,
    Paused,
    Blocked,
    Done,
    Error,
}

#[derive(Debug, thiserror::Error)]
pub enum WorkerRunError {
    #[error("thread id contains invalid path characters: {0}")]
    InvalidThreadId(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkerRunRecord {
    pub schema: String,
    pub thread_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta_thread_id: Option<String>,
    pub run_id: String,
    pub state: WorkerRunState,
    pub started_at: String,
    pub updated_at: String,
    pub max_turns: u32,
    pub completed_turns: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pause_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkerRunStatus {
    pub thread_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta_thread_id: Option<String>,
    pub state: WorkerRunState,
    pub turns: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_goal_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_turn_exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_agent_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_run_event_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_run_event_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_run_observed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_turns: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_turns: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pause_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_reason: Option<String>,
}

pub fn derive_worker_run_status(
    session: &StackLocalSession,
    events: &[Value],
    active_goal: Option<&MetaThreadActiveGoal>,
    record: Option<&WorkerRunRecord>,
) -> WorkerRunStatus {
    let latest_run_event = latest_worker_run_event(events);
    let latest_run_event_type = latest_run_event
        .and_then(|event| event.get("type"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let active_goal_status = active_goal
        .map(|goal| goal.status.trim())
        .filter(|status| !status.is_empty())
        .map(str::to_string);
    let normalized_goal_status = active_goal_status
        .as_deref()
        .map(|status| status.to_ascii_lowercase());
    let last_turn = session.turns.last();

    let record_state = record.map(|record| record.state);
    let state = match record_state {
        Some(WorkerRunState::Running) => WorkerRunState::Running,
        Some(WorkerRunState::Paused) => WorkerRunState::Paused,
        Some(WorkerRunState::Error) => WorkerRunState::Error,
        Some(WorkerRunState::Blocked) => WorkerRunState::Blocked,
        Some(WorkerRunState::Done) => WorkerRunState::Done,
        Some(WorkerRunState::Idle) | None => match latest_run_event_type.as_deref() {
            Some("worker_run.started") => WorkerRunState::Running,
            Some("worker_run.failed") => WorkerRunState::Error,
            Some("worker_run.paused") => WorkerRunState::Paused,
            Some("worker_run.blocked") => WorkerRunState::Blocked,
            Some("worker_run.done") => WorkerRunState::Done,
            _ => goal_or_turn_state(normalized_goal_status.as_deref(), active_goal, last_turn),
        },
    };

    WorkerRunStatus {
        thread_id: session.id.clone(),
        meta_thread_id: session.meta_thread_id.clone(),
        state,
        turns: session.turns.len(),
        active_goal_status,
        last_turn_exit_code: last_turn.and_then(|turn| turn.exit_code),
        last_agent_message: last_agent_message(&session.turns),
        latest_run_event_type,
        latest_run_event_id: latest_run_event
            .and_then(|event| event.get("event_id"))
            .and_then(Value::as_str)
            .map(str::to_string),
        latest_run_observed_at: latest_run_event
            .and_then(|event| event.get("observed_at"))
            .and_then(Value::as_str)
            .map(str::to_string),
        run_id: record.map(|record| record.run_id.clone()),
        completed_turns: record.map(|record| record.completed_turns),
        max_turns: record.map(|record| record.max_turns),
        pause_reason: record.and_then(|record| record.pause_reason.clone()),
        stop_reason: record.and_then(|record| record.stop_reason.clone()),
    }
}

fn goal_or_turn_state(
    normalized_goal_status: Option<&str>,
    active_goal: Option<&MetaThreadActiveGoal>,
    last_turn: Option<&StackCodexTurn>,
) -> WorkerRunState {
    match normalized_goal_status {
        Some("done" | "complete" | "completed") => WorkerRunState::Done,
        Some("paused") => WorkerRunState::Paused,
        Some("blocked") => WorkerRunState::Blocked,
        _ if active_goal
            .map(|goal| !goal.blockers.is_empty())
            .unwrap_or(false) =>
        {
            WorkerRunState::Blocked
        }
        _ if last_turn
            .and_then(|turn| turn.exit_code)
            .map(|code| code != 0)
            .unwrap_or(false) =>
        {
            WorkerRunState::Error
        }
        _ => WorkerRunState::Idle,
    }
}

pub fn worker_run_record_path(
    stack_dir: &Path,
    thread_id: &str,
) -> Result<PathBuf, WorkerRunError> {
    let safe = safe_thread_id(thread_id)?;
    Ok(stack_dir.join("worker-runs").join(format!("{safe}.json")))
}

pub async fn read_worker_run_record(
    stack_dir: &Path,
    thread_id: &str,
) -> Result<Option<WorkerRunRecord>, WorkerRunError> {
    let path = worker_run_record_path(stack_dir, thread_id)?;
    let text = match fs::read_to_string(path).await {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    Ok(Some(serde_json::from_str(&text)?))
}

pub async fn write_worker_run_record(
    stack_dir: &Path,
    record: &WorkerRunRecord,
) -> Result<PathBuf, WorkerRunError> {
    let path = worker_run_record_path(stack_dir, &record.thread_id)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    fs::write(
        &path,
        format!("{}\n", serde_json::to_string_pretty(record)?),
    )
    .await?;
    Ok(path)
}

pub async fn cleanup_running_worker_run_records(
    stack_dir: &Path,
    updated_at: &str,
) -> Result<usize, WorkerRunError> {
    let dir = stack_dir.join("worker-runs");
    let mut entries = match fs::read_dir(&dir).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(error.into()),
    };
    let mut cleaned = 0usize;
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let text = fs::read_to_string(&path).await?;
        let mut record = serde_json::from_str::<WorkerRunRecord>(&text)?;
        if record.state != WorkerRunState::Running {
            continue;
        }
        record.state = WorkerRunState::Idle;
        record.stop_reason = Some("stackd_restart_cleanup".to_string());
        record.updated_at = updated_at.to_string();
        fs::write(
            &path,
            format!("{}\n", serde_json::to_string_pretty(&record)?),
        )
        .await?;
        cleaned += 1;
    }
    Ok(cleaned)
}

fn safe_thread_id(thread_id: &str) -> Result<String, WorkerRunError> {
    let trimmed = thread_id.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err(WorkerRunError::InvalidThreadId(thread_id.to_string()));
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

fn latest_worker_run_event(events: &[Value]) -> Option<&Value> {
    events.iter().rev().find(|event| {
        event
            .get("type")
            .and_then(Value::as_str)
            .map(|event_type| event_type.starts_with("worker_run."))
            .unwrap_or(false)
    })
}

fn last_agent_message(turns: &[StackCodexTurn]) -> Option<String> {
    for turn in turns.iter().rev() {
        for line in turn.stdout.lines().rev() {
            let Ok(record) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            if let Some(text) = agent_message_text(&record) {
                return Some(truncate_one_line(&text, 1200));
            }
        }
        let stderr = turn.stderr.trim();
        if !stderr.is_empty() {
            return Some(truncate_one_line(stderr, 1200));
        }
    }
    None
}

fn agent_message_text(record: &Value) -> Option<String> {
    if matches!(
        record.get("type").and_then(Value::as_str),
        Some("event_msg" | "response_item")
    ) {
        return record.get("payload").and_then(agent_message_text);
    }
    if record.get("type").and_then(Value::as_str) != Some("agent_message") {
        return None;
    }
    record
        .get("text")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn truncate_one_line(value: &str, max_chars: usize) -> String {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.chars().count() <= max_chars {
        return normalized;
    }
    let mut truncated = normalized
        .chars()
        .take(max_chars.saturating_sub(1))
        .collect::<String>();
    truncated.push('…');
    truncated
}
