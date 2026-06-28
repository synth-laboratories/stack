use crate::handlers::ApiError;
use crate::server::AppState;
use axum::extract::{Path, State};
use axum::Json;
use serde::Serialize;
use serde_json::{json, Value};
use stack_core::codex_path::resolve_for_session;
use stack_core::session::{
    build_usage_summary, list_summaries, read_session_by_id, read_session_value_by_id,
    session_path, thread_id_from_session, trace_turns, StackSessionSummary,
    StackSessionUsageSummary, StackTraceTurn,
};
use std::sync::Arc;
use tokio::fs;

#[derive(Debug, Serialize)]
pub struct TraceResponse {
    pub stack_session_id: String,
    pub stack_session_path: String,
    pub codex_thread_id: Option<String>,
    pub codex_session_path: Option<String>,
    pub turn_count: usize,
    pub usage_summary: Option<StackSessionUsageSummary>,
    pub turns: Vec<StackTraceTurn>,
}

#[derive(Debug, Serialize)]
pub struct StackStatusResponse {
    pub ok: bool,
    pub stackd_version: &'static str,
    pub stack_version: Option<String>,
    pub channel: Option<String>,
    pub session_log_dir: String,
    pub runtime_status_path: String,
    pub session_count: usize,
    pub latest_session: Option<StackSessionSummary>,
    pub runtime: Option<Value>,
}

pub async fn list_threads(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<StackSessionSummary>>, ApiError> {
    Ok(Json(list_summaries(&state.paths.session_log_dir).await?))
}

pub async fn get_stack_status(
    State(state): State<Arc<AppState>>,
) -> Result<Json<StackStatusResponse>, ApiError> {
    let summaries = list_summaries(&state.paths.session_log_dir).await?;
    Ok(Json(StackStatusResponse {
        ok: true,
        stackd_version: env!("CARGO_PKG_VERSION"),
        stack_version: state.stack_version.clone(),
        channel: state.stack_channel.clone(),
        session_log_dir: state.paths.session_log_dir.to_string_lossy().to_string(),
        runtime_status_path: state
            .paths
            .runtime_status_path
            .to_string_lossy()
            .to_string(),
        session_count: summaries.len(),
        latest_session: summaries.first().cloned(),
        runtime: read_runtime_status(&state).await,
    }))
}

pub async fn get_thread(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        read_session_value_by_id(&state.paths.session_log_dir, &id).await?,
    ))
}

pub async fn get_trace(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<TraceResponse>, ApiError> {
    let session = read_session_by_id(&state.paths.session_log_dir, &id).await?;
    let stack_session_path = session_path(&state.paths.session_log_dir, &id)?;
    let (codex_thread_id, codex_session_path) =
        resolve_for_session(&session, &state.paths.codex_sessions_root()).await;
    Ok(Json(TraceResponse {
        stack_session_id: session.id.clone(),
        stack_session_path: stack_session_path.to_string_lossy().to_string(),
        codex_thread_id,
        codex_session_path: codex_session_path.map(|path| path.to_string_lossy().to_string()),
        turn_count: session.turns.len(),
        usage_summary: session
            .usage_summary
            .clone()
            .or_else(|| build_usage_summary(&session)),
        turns: trace_turns(&session),
    }))
}

pub async fn get_status(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let session = read_session_by_id(&state.paths.session_log_dir, &id).await?;
    let path = session_path(&state.paths.session_log_dir, &id)?;
    let metadata = fs::metadata(&path)
        .await
        .map_err(|error| ApiError::internal(error.to_string()))?;
    let updated_at = metadata
        .modified()
        .ok()
        .map(system_time_to_iso8601)
        .unwrap_or_else(|| session.started_at.clone());

    let runtime = read_matching_runtime_status(&state, &id).await;
    Ok(Json(json!({
        "stack_session_id": id,
        "stack_session_path": path.to_string_lossy(),
        "updated_at": updated_at,
        "turn_count": session.turns.len(),
        "codex_thread_id": thread_id_from_session(&session),
        "runtime": runtime,
    })))
}

async fn read_matching_runtime_status(state: &AppState, id: &str) -> Option<Value> {
    let value = read_runtime_status(state).await?;
    if value.get("stack_session_id").and_then(Value::as_str) == Some(id) {
        return Some(value);
    }
    None
}

async fn read_runtime_status(state: &AppState) -> Option<Value> {
    let text = fs::read_to_string(&state.paths.runtime_status_path)
        .await
        .ok()?;
    serde_json::from_str::<Value>(&text).ok()
}

fn system_time_to_iso8601(time: std::time::SystemTime) -> String {
    let datetime: chrono::DateTime<chrono::Utc> = time.into();
    datetime.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
