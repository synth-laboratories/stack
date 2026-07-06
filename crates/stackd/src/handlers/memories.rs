use crate::handlers::ApiError;
use crate::server::AppState;
use axum::extract::{Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use stack_core::memories::{
    list_memories, record_memory, MemoryError, MemoryReceipt, RecordMemoryRequest, MEMORY_KINDS,
};
use std::sync::Arc;

impl From<MemoryError> for ApiError {
    fn from(error: MemoryError) -> Self {
        match error {
            MemoryError::UnknownKind(_) | MemoryError::EmptySummary => {
                ApiError::bad_request(error.to_string())
            }
            MemoryError::Io(_) => ApiError::internal(error.to_string()),
        }
    }
}

pub async fn list_memory_kinds_handler(
    State(_state): State<Arc<AppState>>,
) -> Json<serde_json::Value> {
    Json(json!({
        "count": MEMORY_KINDS.len(),
        "kinds": MEMORY_KINDS,
    }))
}

pub async fn record_memory_handler(
    State(state): State<Arc<AppState>>,
    Json(request): Json<RecordMemoryRequest>,
) -> Result<Json<MemoryReceipt>, ApiError> {
    Ok(Json(record_memory(&state.paths, request)?))
}

#[derive(Debug, Deserialize)]
pub struct MemoryListQuery {
    pub kind: String,
    #[serde(default = "default_recent")]
    pub recent: usize,
}

fn default_recent() -> usize {
    20
}

pub async fn list_memories_handler(
    State(state): State<Arc<AppState>>,
    Query(query): Query<MemoryListQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let entries = list_memories(&state.paths, &query.kind, query.recent)?;
    Ok(Json(json!({
        "kind": query.kind,
        "count": entries.len(),
        "entries": entries,
    })))
}
