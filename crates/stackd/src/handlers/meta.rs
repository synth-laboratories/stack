use crate::handlers::ApiError;
use crate::meta::tick::{read_meta_status, run_meta_tick, MetaStatus};
use crate::server::AppState;
use axum::extract::State;
use axum::Json;
use std::sync::Arc;

pub async fn post_meta_tick(
    State(state): State<Arc<AppState>>,
) -> Result<Json<MetaStatus>, ApiError> {
    let status = run_meta_tick(&state)
        .await
        .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(Json(status))
}

pub async fn get_meta_status(
    State(state): State<Arc<AppState>>,
) -> Result<Json<MetaStatus>, ApiError> {
    let status = read_meta_status(&state)
        .await
        .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(Json(status))
}
