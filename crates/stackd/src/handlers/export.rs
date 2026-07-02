use crate::handlers::ApiError;
use crate::server::AppState;
use axum::extract::{Path, State};
use axum::Json;
use chrono::Utc;
use serde::Serialize;
use serde_json::json;
use stack_core::codex_path::resolve_for_session;
use stack_core::events::{
    read_thread_events, read_thread_monitor_actor_states, thread_event_log_path,
};
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
    if let Ok(events_path) = thread_event_log_path(&state.paths.stack_dir, &id) {
        let dest = export_dir.join("meta-events.jsonl");
        if fs::copy(events_path, &dest).await.is_ok() {
            files.push("meta-events.jsonl");
        }
    }
    let events = read_thread_events(&state.paths.stack_dir, &id).await?;
    let monitor_usage: Vec<_> = events
        .iter()
        .filter(|event| {
            event.get("type").and_then(serde_json::Value::as_str) == Some("monitor.usage")
        })
        .cloned()
        .collect();
    if !monitor_usage.is_empty() {
        write_json(export_dir.join("monitor_usage.json"), &json!(monitor_usage)).await?;
        files.push("monitor_usage.json");
    }
    let monitor_events: Vec<_> = events
        .iter()
        .filter(|event| {
            event
                .get("type")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|event_type| event_type.starts_with("monitor."))
        })
        .cloned()
        .collect();
    if !monitor_events.is_empty() {
        write_json(
            export_dir.join("monitor_events.json"),
            &json!(monitor_events),
        )
        .await?;
        files.push("monitor_events.json");
    }
    let guidance_events: Vec<_> = events
        .iter()
        .filter(|event| {
            event
                .get("type")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|event_type| event_type.starts_with("guidance."))
        })
        .cloned()
        .collect();
    if !guidance_events.is_empty() {
        write_json(
            export_dir.join("guidance_events.json"),
            &json!(guidance_events),
        )
        .await?;
        files.push("guidance_events.json");
    }
    let voice_events: Vec<_> = events
        .iter()
        .filter(|event| {
            event
                .get("type")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|event_type| event_type.starts_with("voice."))
        })
        .cloned()
        .collect();
    if !voice_events.is_empty() {
        write_json(export_dir.join("voice_events.json"), &json!(voice_events)).await?;
        files.push("voice_events.json");
    }
    let voice_status_path = state.paths.stack_dir.join("voice").join("status.json");
    if fs::copy(&voice_status_path, export_dir.join("voice_status.json"))
        .await
        .is_ok()
    {
        files.push("voice_status.json");
    }
    let garden_path = state
        .paths
        .stack_dir
        .join("garden")
        .join("threads")
        .join(format!("{id}.md"));
    if fs::copy(&garden_path, export_dir.join("garden.md"))
        .await
        .is_ok()
    {
        files.push("garden.md");
    }
    let actors = read_thread_monitor_actor_states(&state.paths.stack_dir, &id).await?;
    if !actors.is_empty() {
        write_json(export_dir.join("actors.json"), &json!(actors)).await?;
        files.push("actors.json");
    }

    let metadata = json!({
        "stack_session_id": session.id,
        "stack_session_path": stack_session_path,
        "codex_thread_id": codex_thread_id,
        "codex_session_path": codex_session_path,
        "meta_events_path": ".stack/events/threads/<stack_session_id>.jsonl",
        "actors_path": ".stack/actors/<stack_session_id>/monitors/*.json",
        "turn_count": session.turns.len(),
        "workspace_root": session.workspace_root,
        "started_at": session.started_at,
    });
    write_json(export_dir.join("metadata.json"), &metadata).await?;

    let manifest = json!({
        "schema": "stack/export/v1",
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
