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
    let snapshot = store
        .load_snapshot()
        .map_err(|error| ApiError::internal(error.to_string()))?;
    let status = if snapshot.is_some() { "ready" } else { "empty" };
    Ok(Json(json!({
        "snapshot": snapshot,
        "status": status,
    })))
}

pub async fn get_runtime_events(
    State(state): State<Arc<AppState>>,
    Query(query): Query<EventsQuery>,
) -> Result<Json<Value>, ApiError> {
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
    let store =
        RuntimeStore::open(&state.paths).map_err(|error| ApiError::internal(error.to_string()))?;
    let events = store
        .append_events(&[draft])
        .map_err(|error| ApiError::internal(error.to_string()))?;
    let all_events = store
        .load_events(None, 10_000, None)
        .map_err(|error| ApiError::internal(error.to_string()))?;
    let snapshot = runtime::reducer::reduce(&all_events);
    store
        .save_snapshot(&snapshot)
        .map_err(|error| ApiError::internal(error.to_string()))?;
    store
        .write_status_projection(&snapshot, events.len())
        .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(Json(
        json!({ "status": "ready", "events": events, "snapshot": snapshot }),
    ))
}

pub async fn post_runtime_tick(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Value>, ApiError> {
    let snapshot = runtime::tick_runtime(state)
        .await
        .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(Json(json!({ "status": "ready", "snapshot": snapshot })))
}

fn runtime_event_draft(request: RuntimeEventAppendRequest) -> Result<RuntimeEventDraft, ApiError> {
    let event_type = request.event_type.trim().to_string();
    let source = request.source.trim().to_string();
    let subject_kind = request.subject.kind.trim().to_string();
    let subject_id = request.subject.id.trim().to_string();
    if event_type.is_empty() {
        return Err(ApiError::bad_request("event_type is required"));
    }
    if source.is_empty() {
        return Err(ApiError::bad_request("source is required"));
    }
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
    Ok(RuntimeEventDraft {
        event_type,
        source,
        observed_at: request
            .observed_at
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| Utc::now().to_rfc3339()),
        subject: RuntimeSubject {
            kind: subject_kind,
            id: subject_id,
        },
        correlation: request.correlation,
        payload: request.payload,
    })
}
