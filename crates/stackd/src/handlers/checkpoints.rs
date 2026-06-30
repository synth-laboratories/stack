use crate::handlers::ApiError;
use crate::server::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use stack_core::checkpoint::{
    build_meta_thread_resume_bundle, build_resume_bundle, build_thread_resume_bundle,
    persist_checkpoint_with_session, read_latest_checkpoint, resolve_checkpoint,
    SaveCheckpointResponse, StackResumeCheckpoint,
};
use stack_core::meta_thread::read_manifest;
use stack_core::meta_thread_state::enrich_checkpoint;
use stack_core::session::read_session_by_id;
use std::sync::Arc;

#[derive(Debug, Deserialize)]
pub struct ResolveCheckpointQuery {
    pub q: Option<String>,
}

pub async fn get_latest_checkpoint(
    State(state): State<Arc<AppState>>,
) -> Result<Json<StackResumeCheckpoint>, ApiError> {
    Ok(Json(
        read_latest_checkpoint(&state.paths.stack_dir)
            .await
            .map_err(checkpoint_api_error)?,
    ))
}

pub async fn resolve_checkpoint_handler(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ResolveCheckpointQuery>,
) -> Result<Json<stack_core::checkpoint::ResumeBundle>, ApiError> {
    let checkpoint = resolve_checkpoint(
        &state.paths.stack_dir,
        &state.paths.session_log_dir,
        query.q.as_deref(),
    )
    .await
    .map_err(checkpoint_api_error)?;
    Ok(Json(
        build_resume_bundle(
            &state.paths.stack_dir,
            &state.paths.session_log_dir,
            checkpoint,
        )
        .await
        .map_err(checkpoint_api_error)?,
    ))
}

pub async fn save_checkpoint(
    State(state): State<Arc<AppState>>,
    Json(mut checkpoint): Json<StackResumeCheckpoint>,
) -> Result<Json<SaveCheckpointResponse>, ApiError> {
    let session = read_session_by_id(&state.paths.session_log_dir, &checkpoint.session_id).await?;
    if checkpoint.display_name.is_none() {
        checkpoint.display_name = session.display_name.clone();
    }
    if checkpoint.meta_thread_id.is_none() {
        checkpoint.meta_thread_id = session.meta_thread_id.clone();
    }
    if checkpoint.segment_id.is_none() {
        checkpoint.segment_id = session.segment_id.clone();
    }
    if checkpoint.codex_thread_id.is_none() {
        checkpoint.codex_thread_id = stack_core::session::thread_id_from_session(&session);
    }
    if checkpoint.harness.is_none() {
        checkpoint.harness = session.harness.clone();
    }
    let manifest = match checkpoint.meta_thread_id.as_deref() {
        Some(meta_thread_id) => read_manifest(&state.paths.stack_dir, meta_thread_id)
            .await
            .ok(),
        None => None,
    };
    let transport = checkpoint.codex_transport.clone();
    let backend = checkpoint
        .codex_thread_id
        .clone()
        .or_else(|| stack_core::session::thread_id_from_session(&session));
    checkpoint = enrich_checkpoint(
        checkpoint,
        &session,
        manifest.as_ref(),
        transport.as_deref(),
        backend.as_deref(),
    );
    Ok(Json(
        persist_checkpoint_with_session(
            &state.paths.stack_dir,
            &state.paths.session_log_dir,
            checkpoint,
            &session,
        )
        .await
        .map_err(checkpoint_api_error)?,
    ))
}

pub async fn get_thread_resume(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<stack_core::checkpoint::ResumeBundle>, ApiError> {
    Ok(Json(
        build_thread_resume_bundle(&state.paths.stack_dir, &state.paths.session_log_dir, &id)
            .await
            .map_err(checkpoint_api_error)?,
    ))
}

pub async fn get_meta_thread_resume(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<stack_core::checkpoint::ResumeBundle>, ApiError> {
    Ok(Json(
        build_meta_thread_resume_bundle(&state.paths.stack_dir, &state.paths.session_log_dir, &id)
            .await
            .map_err(checkpoint_api_error)?,
    ))
}

pub async fn save_thread_checkpoint(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(checkpoint): Json<StackResumeCheckpoint>,
) -> Result<Json<SaveCheckpointResponse>, ApiError> {
    if checkpoint.session_id != id {
        return Err(ApiError::bad_request("checkpoint.session_id must match thread id"));
    }
    save_checkpoint(State(state), Json(checkpoint)).await
}

pub async fn save_meta_thread_checkpoint(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(mut checkpoint): Json<StackResumeCheckpoint>,
) -> Result<Json<SaveCheckpointResponse>, ApiError> {
    if checkpoint
        .meta_thread_id
        .as_deref()
        .is_some_and(|meta_thread_id| meta_thread_id != id)
    {
        return Err(ApiError::bad_request(
            "checkpoint.meta_thread_id must match meta-thread id",
        ));
    }
    checkpoint.meta_thread_id = Some(id);
    save_checkpoint(State(state), Json(checkpoint)).await
}

fn checkpoint_api_error(error: stack_core::checkpoint::CheckpointError) -> ApiError {
    match error {
        stack_core::checkpoint::CheckpointError::NotFound => ApiError {
            status: axum::http::StatusCode::NOT_FOUND,
            message: "checkpoint not found".to_string(),
        },
        stack_core::checkpoint::CheckpointError::Invalid(message) => ApiError::bad_request(message),
        stack_core::checkpoint::CheckpointError::Session(session_error) => session_error.into(),
        stack_core::checkpoint::CheckpointError::MetaThread(meta_error) => meta_error.into(),
        _ => ApiError::internal(error.to_string()),
    }
}
