use crate::handlers::ApiError;
use crate::server::AppState;
use crate::victorialogs::{query_logs, VictoriaLogsQueryRequest};
use axum::extract::{Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

const MCP_QUERY_LIMIT_MAX: u64 = 500;

#[derive(Debug, Deserialize)]
pub struct LogQuery {
    pub slot: Option<String>,
    pub query: Option<String>,
    pub event_domain: Option<String>,
    pub service: Option<String>,
    pub run_id: Option<String>,
    pub thread_id: Option<String>,
    pub minutes: Option<u64>,
    pub limit: Option<u64>,
    pub timeout_seconds: Option<u64>,
}

pub async fn query_logs_handler(
    State(state): State<Arc<AppState>>,
    Query(query): Query<LogQuery>,
) -> Result<Json<Value>, ApiError> {
    let slot = safe_value(query.slot.as_deref().unwrap_or("slot1"), "slot")?;
    let limit = query.limit.unwrap_or(100).clamp(1, MCP_QUERY_LIMIT_MAX);
    let minutes = query.minutes.unwrap_or(60).clamp(1, 10_080);
    let timeout_seconds = query.timeout_seconds.unwrap_or(20).clamp(1, 120);
    let logsql = build_log_query(&query)?;
    let stack_dir = state.paths.stack_dir.clone();
    let result = query_logs(
        &stack_dir,
        VictoriaLogsQueryRequest {
            slot: slot.clone(),
            query: logsql.clone(),
            limit,
            minutes,
            timeout_seconds,
            max_limit: MCP_QUERY_LIMIT_MAX,
        },
    )
    .await
    .map_err(ApiError::internal)?;

    Ok(Json(json!({
        "ok": true,
        "source": "stackd",
        "result": {
            "slot_id": result.slot_id,
            "victorialogs_url": result.victorialogs_url,
            "query": result.query,
            "records": result.records,
        },
    })))
}

fn build_log_query(query: &LogQuery) -> Result<String, ApiError> {
    let mut clauses = Vec::new();
    if let Some(value) = query
        .query
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        clauses.push(value.to_string());
    }
    if let Some(value) = query.event_domain.as_deref() {
        clauses.push(format!(
            "event_domain:{}",
            log_field_value(value, "event_domain")?
        ));
    }
    if let Some(value) = query.service.as_deref() {
        clauses.push(format!("service:{}", log_field_value(value, "service")?));
    }
    if let Some(value) = query.run_id.as_deref() {
        clauses.push(format!("run_id:{}", log_field_value(value, "run_id")?));
    }
    if let Some(value) = query.thread_id.as_deref() {
        clauses.push(format!(
            "thread_id:{}",
            log_field_value(value, "thread_id")?
        ));
    }
    Ok(if clauses.is_empty() {
        "*".to_string()
    } else {
        clauses.join(" AND ")
    })
}

fn log_field_value(value: &str, field: &str) -> Result<String, ApiError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ApiError::bad_request(format!("{field} cannot be empty")));
    }
    if trimmed.chars().all(|character| {
        character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.' | ':')
    }) {
        return Ok(trimmed.to_string());
    }
    Ok(format!(
        "\"{}\"",
        trimmed.replace('\\', "\\\\").replace('"', "\\\"")
    ))
}

fn safe_value(value: &str, field: &str) -> Result<String, ApiError> {
    let trimmed = value.trim();
    if !trimmed.is_empty()
        && trimmed.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.')
        })
    {
        Ok(trimmed.to_string())
    } else {
        Err(ApiError::bad_request(format!("invalid {field}: {value}")))
    }
}
