use crate::handlers::ApiError;
use crate::server::AppState;
use axum::extract::{Path, State};
use axum::Json;
use chrono::Utc;
use serde::Serialize;
use serde_json::json;
use stack_core::codex_path::resolve_for_session;
use stack_core::redact::redact_for_export;
use stack_core::session::{read_session_by_id, read_session_value_by_id, session_path};
use std::sync::Arc;
use tokio::fs;

#[derive(Debug, Serialize)]
pub struct ExportResponse {
    pub export_dir: String,
}

pub async fn export_thread(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ExportResponse>, ApiError> {
    let session = read_session_by_id(&state.paths.session_log_dir, &id).await?;
    let mut session_json = read_session_value_by_id(&state.paths.session_log_dir, &id).await?;
    let stack_session_path = session_path(&state.paths.session_log_dir, &id)?;
    let (codex_thread_id, codex_session_path) =
        resolve_for_session(&session, &state.paths.codex_sessions_root()).await;
    let stamp = Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
    let export_dir = state.paths.export_dir.join(&id).join(stamp);
    fs::create_dir_all(&export_dir)
        .await
        .map_err(|error| ApiError::internal(error.to_string()))?;

    let redaction = redact_for_export(&mut session_json);
    write_json(export_dir.join("session.json"), &session_json).await?;

    let mut files = vec!["manifest.json", "metadata.json", "session.json"];
    if let Some(codex_path) = &codex_session_path {
        let dest = export_dir.join("codex.jsonl");
        if fs::copy(codex_path, &dest).await.is_ok() {
            files.push("codex.jsonl");
        }
    }

    let metadata = json!({
        "stack_session_id": session.id,
        "stack_session_path": stack_session_path,
        "codex_thread_id": codex_thread_id,
        "codex_session_path": codex_session_path,
        "turn_count": session.turns.len(),
        "workspace_root": session.workspace_root,
        "started_at": session.started_at,
    });
    write_json(export_dir.join("metadata.json"), &metadata).await?;

    let manifest = json!({
        "schema": "stackeval/export/v1",
        "generated_at": Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        "stackd_version": env!("CARGO_PKG_VERSION"),
        "stack_version": state.stack_version,
        "stack_session_id": id,
        "files": files,
        "redaction": redaction,
    });
    write_json(export_dir.join("manifest.json"), &manifest).await?;

    Ok(Json(ExportResponse {
        export_dir: export_dir.to_string_lossy().to_string(),
    }))
}

async fn write_json(path: std::path::PathBuf, value: &serde_json::Value) -> Result<(), ApiError> {
    let text = serde_json::to_string_pretty(value)
        .map_err(|error| ApiError::internal(error.to_string()))?;
    fs::write(path, format!("{text}\n"))
        .await
        .map_err(|error| ApiError::internal(error.to_string()))
}
