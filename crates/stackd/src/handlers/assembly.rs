use crate::assembly_store::{
    AssemblyBindingsUpdate, AssemblyStore, AssemblyStoreError, CreateAssemblyLine,
};
use crate::handlers::ApiError;
use crate::server::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use stack_core::assembly_line::{
    project_snapshot, AssemblyBindings, AssemblyLineError, AssemblyPreset, AssemblyTransition,
};
use std::sync::Arc;

// HTTP surface for Assembly Lines. Routes mirror the other stackd resources:
// list/create on the collection, get + snapshot on one line, and a typed
// transition-event append. See docs/ASSEMBLY_LINES.md.

impl From<AssemblyStoreError> for ApiError {
    fn from(error: AssemblyStoreError) -> Self {
        match error {
            AssemblyStoreError::Line(line_error) => line_error.into(),
            AssemblyStoreError::Storage(storage) => ApiError::internal(storage.to_string()),
        }
    }
}

impl From<AssemblyLineError> for ApiError {
    fn from(error: AssemblyLineError) -> Self {
        let status = match &error {
            AssemblyLineError::NotFound(_) => StatusCode::NOT_FOUND,
            AssemblyLineError::InvalidTransition(_) | AssemblyLineError::MissingEvidence { .. } => {
                StatusCode::CONFLICT
            }
            AssemblyLineError::UnknownPreset(_)
            | AssemblyLineError::UnknownStation { .. }
            | AssemblyLineError::InvalidGateEvent(_)
            | AssemblyLineError::InvalidField(_) => StatusCode::BAD_REQUEST,
        };
        ApiError::with_status(status, error.to_string())
    }
}

fn open_store(state: &AppState) -> Result<AssemblyStore, ApiError> {
    AssemblyStore::open(&state.paths).map_err(|error| ApiError::internal(error.to_string()))
}

fn parse_preset(preset: &str) -> Result<AssemblyPreset, ApiError> {
    match preset {
        "ship" => Ok(AssemblyPreset::Ship),
        "effort" => Ok(AssemblyPreset::Effort),
        other => Err(AssemblyLineError::UnknownPreset(other.to_string()).into()),
    }
}

#[derive(Debug, Deserialize)]
pub struct CreateAssemblyLineRequest {
    pub title: String,
    pub preset: String,
    pub owner: String,
    #[serde(default)]
    pub bindings: AssemblyBindings,
    #[serde(default)]
    pub actor_id: Option<String>,
}

pub async fn list_assembly_lines(
    State(state): State<Arc<AppState>>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let store = open_store(&state)?;
    let now = chrono::Utc::now();
    let lines: Vec<_> = store
        .list_lines()?
        .iter()
        .map(|(record, events)| project_snapshot(record, events, now))
        .collect();
    Ok(Json(json!({ "count": lines.len(), "lines": lines })))
}

pub async fn create_assembly_line(
    State(state): State<Arc<AppState>>,
    Json(request): Json<CreateAssemblyLineRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let store = open_store(&state)?;
    let preset = parse_preset(&request.preset)?;
    let actor_id = request
        .actor_id
        .unwrap_or_else(|| "operator".to_string());
    let (record, event) = store.create_line(CreateAssemblyLine {
        title: request.title,
        preset,
        owner: request.owner,
        bindings: request.bindings,
        actor_id,
    })?;
    let snapshot = project_snapshot(&record, std::slice::from_ref(&event), chrono::Utc::now());
    Ok(Json(json!({
        "record": record,
        "event": event,
        "snapshot": snapshot,
    })))
}

pub async fn get_assembly_line(
    State(state): State<Arc<AppState>>,
    Path(line_id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let store = open_store(&state)?;
    let (record, events) = store.get_line(&line_id)?;
    let snapshot = project_snapshot(&record, &events, chrono::Utc::now());
    Ok(Json(json!({
        "record": record,
        "events": events,
        "snapshot": snapshot,
    })))
}

pub async fn get_assembly_line_snapshot(
    State(state): State<Arc<AppState>>,
    Path(line_id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let store = open_store(&state)?;
    let (record, events) = store.get_line(&line_id)?;
    let snapshot = project_snapshot(&record, &events, chrono::Utc::now());
    Ok(Json(serde_json::to_value(snapshot).map_err(|error| {
        ApiError::internal(error.to_string())
    })?))
}

pub async fn patch_assembly_bindings(
    State(state): State<Arc<AppState>>,
    Path(line_id): Path<String>,
    Json(update): Json<AssemblyBindingsUpdate>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let store = open_store(&state)?;
    let record = store.update_bindings(&line_id, &update)?;
    let (record, events) = store.get_line(&record.id)?;
    let snapshot = project_snapshot(&record, &events, chrono::Utc::now());
    Ok(Json(json!({
        "record": record,
        "snapshot": snapshot,
    })))
}

pub async fn post_assembly_transition(
    State(state): State<Arc<AppState>>,
    Path(line_id): Path<String>,
    Json(transition): Json<AssemblyTransition>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let store = open_store(&state)?;
    let (record, events, event) = store.apply_transition(&line_id, &transition)?;
    let snapshot = project_snapshot(&record, &events, chrono::Utc::now());
    Ok(Json(json!({
        "event": event,
        "snapshot": snapshot,
    })))
}
