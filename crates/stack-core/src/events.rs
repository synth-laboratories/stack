use serde_json::Value;
use std::path::{Path, PathBuf};
use tokio::{fs, io::AsyncWriteExt};

#[derive(Debug, thiserror::Error)]
pub enum EventLogError {
    #[error("thread id contains invalid path characters: {0}")]
    InvalidThreadId(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

pub fn thread_event_log_path(stack_dir: &Path, thread_id: &str) -> Result<PathBuf, EventLogError> {
    let safe = safe_thread_id(thread_id)?;
    Ok(stack_dir
        .join("events")
        .join("threads")
        .join(format!("{safe}.jsonl")))
}

pub fn thread_monitor_actor_dir_path(
    stack_dir: &Path,
    thread_id: &str,
) -> Result<PathBuf, EventLogError> {
    let safe = safe_thread_id(thread_id)?;
    Ok(stack_dir.join("actors").join(safe).join("monitors"))
}

pub async fn read_thread_events(
    stack_dir: &Path,
    thread_id: &str,
) -> Result<Vec<Value>, EventLogError> {
    let path = thread_event_log_path(stack_dir, thread_id)?;
    let text = match fs::read_to_string(path).await {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };

    let mut events = Vec::new();
    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        events.push(serde_json::from_str::<Value>(line)?);
    }
    Ok(events)
}

pub async fn append_thread_event(
    stack_dir: &Path,
    thread_id: &str,
    event: &Value,
) -> Result<PathBuf, EventLogError> {
    let path = thread_event_log_path(stack_dir, thread_id)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    let line = serde_json::to_string(event)?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .await?;
    file.write_all(line.as_bytes()).await?;
    file.write_all(b"\n").await?;
    Ok(path)
}

pub async fn read_thread_monitor_actor_states(
    stack_dir: &Path,
    thread_id: &str,
) -> Result<Vec<Value>, EventLogError> {
    let dir = thread_monitor_actor_dir_path(stack_dir, thread_id)?;
    let mut entries = match fs::read_dir(dir).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    let mut actors = Vec::new();
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let text = fs::read_to_string(path).await?;
        actors.push(serde_json::from_str::<Value>(&text)?);
    }
    Ok(actors)
}

pub(crate) fn safe_thread_id(thread_id: &str) -> Result<String, EventLogError> {
    let trimmed = thread_id.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err(EventLogError::InvalidThreadId(thread_id.to_string()));
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
