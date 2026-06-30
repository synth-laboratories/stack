use crate::handlers::ApiError;
use crate::runtime;
use crate::runtime::store::RuntimeStore;
use crate::server::AppState;
use axum::extract::{Query, State};
use axum::Json;
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Value};
use stack_core::runtime_event::{RuntimeCorrelation, RuntimeEventDraft, RuntimeSubject};
use std::sync::Arc;

const MAX_RUNTIME_EVENT_TYPE_LEN: usize = 160;
const MAX_RUNTIME_EVENT_SOURCE_LEN: usize = 160;
const MAX_RUNTIME_EVENT_SUBJECT_KIND_LEN: usize = 160;
const MAX_RUNTIME_EVENT_SUBJECT_ID_LEN: usize = 512;
const MAX_RUNTIME_EVENT_OBSERVED_AT_LEN: usize = 128;
const MAX_RUNTIME_EVENT_PAYLOAD_BYTES: usize = 64 * 1024;

#[derive(Debug, Deserialize)]
pub struct EventsQuery {
    after_seq: Option<i64>,
    limit: Option<usize>,
    source: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RuntimeEventAppendRequest {
    event_type: String,
    source: String,
    observed_at: Option<String>,
    subject: RuntimeSubject,
    #[serde(default)]
    correlation: RuntimeCorrelation,
    #[serde(default)]
    payload: Value,
}

pub async fn get_runtime_factory(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Value>, ApiError> {
    let store =
        RuntimeStore::open(&state.paths).map_err(|error| ApiError::internal(error.to_string()))?;
    let record = store
        .load_snapshot_record()
        .map_err(|error| ApiError::internal(error.to_string()))?;
    let status = if record.is_some() { "ready" } else { "empty" };
    let events_appended = record
        .as_ref()
        .map(|record| record.events_appended)
        .unwrap_or(0);
    let snapshot = record.map(|record| record.snapshot);
    Ok(Json(json!({
        "snapshot": snapshot,
        "events_appended": events_appended,
        "status": status,
    })))
}

pub async fn get_runtime_events(
    State(state): State<Arc<AppState>>,
    Query(query): Query<EventsQuery>,
) -> Result<Json<Value>, ApiError> {
    if let Some(source) = query.source.as_deref() {
        validate_len("source", source, MAX_RUNTIME_EVENT_SOURCE_LEN)?;
    }
    let store =
        RuntimeStore::open(&state.paths).map_err(|error| ApiError::internal(error.to_string()))?;
    let events = store
        .load_events(
            query.after_seq,
            query.limit.unwrap_or(100),
            query.source.as_deref(),
        )
        .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(Json(json!({ "events": events })))
}

pub async fn post_runtime_event(
    State(state): State<Arc<AppState>>,
    Json(request): Json<RuntimeEventAppendRequest>,
) -> Result<Json<Value>, ApiError> {
    let draft = runtime_event_draft(request)?;
    let _write_guard = state.runtime_write_lock.lock().await;
    let store =
        RuntimeStore::open(&state.paths).map_err(|error| ApiError::internal(error.to_string()))?;
    let events = store
        .append_events(&[draft])
        .map_err(|error| ApiError::internal(error.to_string()))?;
    let all_events = store
        .load_events_for_reduction()
        .map_err(|error| ApiError::internal(error.to_string()))?;
    let snapshot = runtime::reducer::reduce(&all_events);
    store
        .save_snapshot(&snapshot, events.len())
        .map_err(|error| ApiError::internal(error.to_string()))?;
    store
        .write_status_projection(&snapshot, events.len())
        .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(Json(json!({
        "status": "ready",
        "events_appended": events.len(),
        "events": events,
        "snapshot": snapshot
    })))
}

pub async fn post_runtime_tick(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Value>, ApiError> {
    let result = runtime::tick_runtime(state)
        .await
        .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(Json(json!({
        "status": "ready",
        "events_appended": result.events_appended,
        "snapshot": result.snapshot
    })))
}

fn runtime_event_draft(request: RuntimeEventAppendRequest) -> Result<RuntimeEventDraft, ApiError> {
    let event_type = request.event_type.trim().to_string();
    let source = request.source.trim().to_string();
    let subject_kind = request.subject.kind.trim().to_string();
    let subject_id = request.subject.id.trim().to_string();
    if event_type.is_empty() {
        return Err(ApiError::bad_request("event_type is required"));
    }
    validate_len("event_type", &event_type, MAX_RUNTIME_EVENT_TYPE_LEN)?;
    if source.is_empty() {
        return Err(ApiError::bad_request("source is required"));
    }
    validate_len("source", &source, MAX_RUNTIME_EVENT_SOURCE_LEN)?;
    if !event_type.starts_with("lever.") || !source.starts_with("lever.") {
        return Err(ApiError::bad_request(
            "POST /runtime/events accepts only lever.* events; sensors append through stackd",
        ));
    }
    if subject_kind.is_empty() || subject_id.is_empty() {
        return Err(ApiError::bad_request(
            "subject.kind and subject.id are required",
        ));
    }
    validate_len(
        "subject.kind",
        &subject_kind,
        MAX_RUNTIME_EVENT_SUBJECT_KIND_LEN,
    )?;
    validate_len("subject.id", &subject_id, MAX_RUNTIME_EVENT_SUBJECT_ID_LEN)?;
    let observed_at = request
        .observed_at
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    validate_len(
        "observed_at",
        &observed_at,
        MAX_RUNTIME_EVENT_OBSERVED_AT_LEN,
    )?;
    let payload_bytes = serde_json::to_vec(&request.payload)
        .map_err(|error| ApiError::bad_request(format!("payload is invalid JSON: {error}")))?;
    if payload_bytes.len() > MAX_RUNTIME_EVENT_PAYLOAD_BYTES {
        return Err(ApiError::bad_request(format!(
            "payload is too large: {} bytes > {} bytes",
            payload_bytes.len(),
            MAX_RUNTIME_EVENT_PAYLOAD_BYTES
        )));
    }
    Ok(RuntimeEventDraft {
        event_type,
        source,
        observed_at,
        subject: RuntimeSubject {
            kind: subject_kind,
            id: subject_id,
        },
        correlation: request.correlation,
        payload: request.payload,
    })
}

fn validate_len(field: &str, value: &str, max_len: usize) -> Result<(), ApiError> {
    if value.len() > max_len {
        return Err(ApiError::bad_request(format!(
            "{field} is too long: {} bytes > {max_len} bytes",
            value.len()
        )));
    }
    Ok(())
}
