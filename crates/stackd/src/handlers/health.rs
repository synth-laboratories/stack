use crate::server::AppState;
use axum::{extract::State, Json};
use serde::Serialize;
use std::sync::Arc;

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub ok: bool,
    pub stackd_version: &'static str,
    pub stack_version: Option<String>,
    pub channel: Option<String>,
    pub session_log_dir: String,
}

pub async fn health(State(state): State<Arc<AppState>>) -> Json<HealthResponse> {
    Json(HealthResponse {
        ok: true,
        stackd_version: env!("CARGO_PKG_VERSION"),
        stack_version: state.stack_version.clone(),
        channel: state.stack_channel.clone(),
        session_log_dir: state.paths.session_log_dir.to_string_lossy().to_string(),
    })
}
