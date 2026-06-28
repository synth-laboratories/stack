use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use tokio::fs;

#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    #[error("session not found: {0}")]
    NotFound(String),
    #[error("session id contains invalid path characters: {0}")]
    InvalidId(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StackSessionUsageTotals {
    pub input_tokens: u64,
    pub cached_input_tokens: u64,
    pub output_tokens: u64,
    pub reasoning_output_tokens: u64,
    pub turn_count_with_usage: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StackSessionUsageSummary {
    pub model: String,
    pub totals: StackSessionUsageTotals,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_spend_usd: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StackCodexUsage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cached_input_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_output_tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StackCodexTurn {
    pub id: String,
    pub prompt: String,
    #[serde(default)]
    pub selected_paths: Vec<String>,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<StackCodexUsage>,
    #[serde(default)]
    pub stdout: String,
    #[serde(default)]
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StackLocalSession {
    pub id: String,
    pub workspace_root: String,
    pub started_at: String,
    pub codex_command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codex_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codex_thread_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_summary: Option<StackSessionUsageSummary>,
    #[serde(default)]
    pub turns: Vec<StackCodexTurn>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StackSessionSummary {
    pub id: String,
    pub path: String,
    pub started_at: String,
    pub updated_at: String,
    pub turn_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codex_thread_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_summary: Option<StackSessionUsageSummary>,
}

#[derive(Debug, Clone, Serialize)]
pub struct StackTraceTurn {
    pub index: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_preview: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
}

pub async fn read_session(path: &Path) -> Result<StackLocalSession, SessionError> {
    let text = fs::read_to_string(path).await?;
    Ok(serde_json::from_str(&text)?)
}

pub async fn read_session_value(path: &Path) -> Result<Value, SessionError> {
    let text = fs::read_to_string(path).await?;
    Ok(serde_json::from_str(&text)?)
}

pub fn session_path(session_log_dir: &Path, id: &str) -> Result<PathBuf, SessionError> {
    if id.contains('/') || id.contains('\\') || id == "." || id == ".." || id.trim().is_empty() {
        return Err(SessionError::InvalidId(id.to_string()));
    }
    Ok(session_log_dir.join(format!("{id}.json")))
}

pub async fn read_session_by_id(
    session_log_dir: &Path,
    id: &str,
) -> Result<StackLocalSession, SessionError> {
    let path = session_path(session_log_dir, id)?;
    match read_session(&path).await {
        Ok(session) => Ok(session),
        Err(SessionError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
            Err(SessionError::NotFound(id.to_string()))
        }
        Err(error) => Err(error),
    }
}

pub async fn read_session_value_by_id(
    session_log_dir: &Path,
    id: &str,
) -> Result<Value, SessionError> {
    let path = session_path(session_log_dir, id)?;
    match read_session_value(&path).await {
        Ok(session) => Ok(session),
        Err(SessionError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
            Err(SessionError::NotFound(id.to_string()))
        }
        Err(error) => Err(error),
    }
}

pub async fn list_summaries(
    session_log_dir: &Path,
) -> Result<Vec<StackSessionSummary>, SessionError> {
    let mut entries = match fs::read_dir(session_log_dir).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };

    let mut summaries = Vec::new();
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let Ok(session) = read_session(&path).await else {
            continue;
        };
        let Ok(meta) = entry.metadata().await else {
            continue;
        };
        let updated_at = meta
            .modified()
            .ok()
            .map(system_time_to_iso8601)
            .unwrap_or_else(|| session.started_at.clone());
        let last_prompt = session.turns.last().map(|turn| turn.prompt.clone());
        let codex_thread_id = thread_id_from_session(&session);
        let usage_summary = session
            .usage_summary
            .clone()
            .or_else(|| build_usage_summary(&session));
        summaries.push(StackSessionSummary {
            id: session.id,
            path: path.to_string_lossy().to_string(),
            started_at: session.started_at,
            updated_at,
            turn_count: session.turns.len(),
            last_prompt,
            codex_thread_id,
            usage_summary,
        });
    }

    summaries.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(summaries)
}

pub fn thread_id_from_session(session: &StackLocalSession) -> Option<String> {
    session
        .codex_thread_id
        .as_ref()
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .or_else(|| extract_codex_thread_id_from_turns(&session.turns))
}

pub fn trace_turns(session: &StackLocalSession) -> Vec<StackTraceTurn> {
    session
        .turns
        .iter()
        .enumerate()
        .map(|(index, turn)| StackTraceTurn {
            index,
            prompt_preview: Some(prompt_preview(&turn.prompt)),
            exit_code: turn.exit_code,
            started_at: turn.started_at.clone(),
            finished_at: turn.finished_at.clone(),
        })
        .collect()
}

pub fn build_usage_summary(session: &StackLocalSession) -> Option<StackSessionUsageSummary> {
    let mut totals = StackSessionUsageTotals {
        input_tokens: 0,
        cached_input_tokens: 0,
        output_tokens: 0,
        reasoning_output_tokens: 0,
        turn_count_with_usage: 0,
    };

    for turn in &session.turns {
        let usage = turn
            .usage
            .clone()
            .or_else(|| read_usage_from_stdout(&turn.stdout));
        let Some(usage) = usage else {
            continue;
        };
        totals.input_tokens += usage.input_tokens.unwrap_or(0);
        totals.cached_input_tokens += usage.cached_input_tokens.unwrap_or(0);
        totals.output_tokens += usage.output_tokens.unwrap_or(0);
        totals.reasoning_output_tokens += usage.reasoning_output_tokens.unwrap_or(0);
        totals.turn_count_with_usage += 1;
    }

    if totals.turn_count_with_usage == 0 {
        return None;
    }

    Some(StackSessionUsageSummary {
        model: session
            .codex_model
            .clone()
            .unwrap_or_else(|| infer_codex_model(&session.codex_command)),
        totals,
        estimated_spend_usd: None,
    })
}

fn extract_codex_thread_id_from_turns(turns: &[StackCodexTurn]) -> Option<String> {
    for turn in turns {
        for line in turn.stdout.lines().filter(|line| !line.trim().is_empty()) {
            let Ok(record) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            if record.get("type").and_then(Value::as_str) != Some("thread.started") {
                continue;
            }
            if let Some(thread_id) = record.get("thread_id").and_then(Value::as_str) {
                let thread_id = thread_id.trim();
                if !thread_id.is_empty() {
                    return Some(thread_id.to_string());
                }
            }
        }
    }
    None
}

fn read_usage_from_stdout(stdout: &str) -> Option<StackCodexUsage> {
    for line in stdout.lines().filter(|line| !line.trim().is_empty()) {
        let Ok(record) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if record.get("type").and_then(Value::as_str) != Some("turn.completed") {
            continue;
        }
        let usage = record.get("usage")?;
        return Some(StackCodexUsage {
            input_tokens: usage.get("input_tokens").and_then(Value::as_u64),
            cached_input_tokens: usage.get("cached_input_tokens").and_then(Value::as_u64),
            output_tokens: usage.get("output_tokens").and_then(Value::as_u64),
            reasoning_output_tokens: usage.get("reasoning_output_tokens").and_then(Value::as_u64),
        });
    }
    None
}

fn infer_codex_model(codex_command: &str) -> String {
    let mut parts = codex_command.split_whitespace();
    while let Some(part) = parts.next() {
        if part == "-m" {
            if let Some(model) = parts.next() {
                return model.to_string();
            }
        }
    }
    "gpt-5.4-mini".to_string()
}

fn prompt_preview(prompt: &str) -> String {
    const MAX_CHARS: usize = 240;
    let mut preview = prompt.replace('\n', " ");
    if preview.chars().count() > MAX_CHARS {
        preview = preview.chars().take(MAX_CHARS - 1).collect::<String>();
        preview.push_str("...");
    }
    preview
}

fn system_time_to_iso8601(time: std::time::SystemTime) -> String {
    let datetime: chrono::DateTime<chrono::Utc> = time.into();
    datetime.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
