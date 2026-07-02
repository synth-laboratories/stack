use crate::handlers::ApiError;
use crate::meta::tick::{read_meta_status, run_meta_tick, MetaStatus};
use crate::server::AppState;
use crate::victorialogs::append_thread_event_projected;
use axum::extract::{Path, State};
use axum::Json;
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Value};
use stack_core::actor_runtime::{event_id, event_type, thread_actor_dir_path, ActorRole};
use stack_core::events::read_thread_events;
use std::sync::Arc;
use tokio::fs;

#[derive(Debug, Deserialize)]
pub struct GardenerPassCompleteRequest {
    pub cursor_event_id: Option<String>,
    pub wake_reason: Option<String>,
    pub workspace_garden_path: Option<String>,
    pub gardener_garden_path: Option<String>,
    pub inbox_pending: Option<u64>,
}

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

pub async fn post_gardener_pass_complete(
    State(state): State<Arc<AppState>>,
    Path((thread_id, gardener_id)): Path<(String, String)>,
    Json(request): Json<GardenerPassCompleteRequest>,
) -> Result<Json<Value>, ApiError> {
    let actor_id = safe_segment(&gardener_id)?;
    let events = read_thread_events(&state.paths.stack_dir, &thread_id).await?;
    let cursor_event_id = request
        .cursor_event_id
        .as_deref()
        .and_then(non_empty_string)
        .map(str::to_string)
        .or_else(|| latest_non_gardener_event_id(&events));
    let cursor_event_type = cursor_event_id
        .as_deref()
        .and_then(|id| events.iter().find(|event| event_id(event) == Some(id)))
        .and_then(event_type)
        .map(str::to_string);
    let trigger_event_ids = unconsumed_trigger_event_ids(&events, &actor_id);
    let completed_at = now();
    let wake_id = if trigger_event_ids.is_empty() {
        None
    } else {
        let wake_id = format!(
            "gardener_wake_{}",
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        );
        append_thread_event_projected(
            &state.paths.stack_dir,
            &thread_id,
            &json!({
                "event_id": wake_id,
                "type": "gardener.wake",
                "thread_id": thread_id,
                "observed_at": completed_at,
                "actor_id": actor_id,
                "actor_role": "gardener",
                "payload": {
                    "wake_reason": request.wake_reason.as_deref().and_then(non_empty_string).unwrap_or("maintenance_pass"),
                    "trigger_event_ids": trigger_event_ids,
                    "source": "stackd-pass-complete"
                }
            }),
        )
        .await?;
        Some(wake_id)
    };

    let actor_path =
        thread_actor_dir_path(&state.paths.stack_dir, &thread_id, ActorRole::Gardener)?
            .join(format!("{actor_id}.json"));
    let mut actor = match fs::read_to_string(&actor_path).await {
        Ok(text) => serde_json::from_str::<Value>(&text)
            .map_err(|error| ApiError::internal(error.to_string()))?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => json!({
            "schema": ActorRole::Gardener.state_schema(),
            "thread_id": thread_id,
            "actor_id": actor_id,
            "wake_counts": 0,
            "queue_counts": 0,
        }),
        Err(error) => return Err(ApiError::internal(error.to_string())),
    };
    actor["schema"] = json!(ActorRole::Gardener.state_schema());
    actor["thread_id"] = json!(thread_id);
    actor["actor_id"] = json!(actor_id);
    actor["state"] = json!("idle");
    actor["last_completed_at"] = json!(completed_at);
    if let Some(cursor_event_id) = &cursor_event_id {
        actor["last_event_id"] = json!(cursor_event_id);
    }
    if let Some(cursor_event_type) = &cursor_event_type {
        actor["last_event_type"] = json!(cursor_event_type);
    }
    if let Some(wake_id) = &wake_id {
        actor["last_wake_id"] = json!(wake_id);
    }
    actor["wake_counts"] = json!(
        actor
            .get("wake_counts")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            + u64::from(wake_id.is_some())
    );
    if let Some(value) = request.inbox_pending {
        actor["inbox_pending"] = json!(value);
    }
    if let Some(path) = request.workspace_garden_path.as_deref().and_then(non_empty_string) {
        actor["workspace_garden_path"] = json!(path);
    }
    if let Some(path) = request.gardener_garden_path.as_deref().and_then(non_empty_string) {
        actor["gardener_garden_path"] = json!(path);
    }
    if let Some(parent) = actor_path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|error| ApiError::internal(error.to_string()))?;
    }
    let text = serde_json::to_string_pretty(&actor)
        .map_err(|error| ApiError::internal(error.to_string()))?;
    fs::write(&actor_path, format!("{text}\n"))
        .await
        .map_err(|error| ApiError::internal(error.to_string()))?;

    let event = json!({
        "event_id": format!("gardener_maintenance_pass_{}", Utc::now().timestamp_nanos_opt().unwrap_or_default()),
        "type": "gardener.maintenance_pass",
        "thread_id": thread_id,
        "observed_at": now(),
        "actor_id": actor_id,
        "actor_role": "gardener",
        "payload": {
            "cursor_event_id": cursor_event_id,
            "cursor_event_type": cursor_event_type,
            "wake_id": wake_id,
            "trigger_event_ids": trigger_event_ids,
            "wake_reason": request.wake_reason.as_deref().and_then(non_empty_string).unwrap_or("maintenance_pass"),
            "workspace_garden_path": request.workspace_garden_path,
            "gardener_garden_path": request.gardener_garden_path,
            "inbox_pending": request.inbox_pending,
            "actor_state_path": actor_path.to_string_lossy(),
            "source": "stackd-pass-complete"
        }
    });
    append_thread_event_projected(&state.paths.stack_dir, &thread_id, &event).await?;

    Ok(Json(json!({
        "ok": true,
        "event": event,
        "actor": actor,
    })))
}

fn unconsumed_trigger_event_ids(events: &[Value], actor_id: &str) -> Vec<String> {
    let mut queued: Vec<String> = Vec::new();
    for event in events {
        let kind = event_type(event);
        let is_queue = kind == Some(ActorRole::Gardener.trigger_queued_type());
        let is_wake = kind == Some(ActorRole::Gardener.wake_type());
        if !is_queue && !is_wake {
            continue;
        }
        if event.get("actor_id").and_then(Value::as_str) != Some(actor_id) {
            continue;
        }
        let ids: Vec<String> = event
            .get("payload")
            .and_then(|payload| payload.get("trigger_event_ids"))
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect();
        if is_queue {
            for id in ids {
                if !queued.contains(&id) {
                    queued.push(id);
                }
            }
        } else {
            queued.retain(|id| !ids.contains(id));
        }
    }
    queued
}

fn latest_non_gardener_event_id(events: &[Value]) -> Option<String> {
    events
        .iter()
        .rev()
        .find(|event| event.get("actor_role").and_then(Value::as_str) != Some("gardener"))
        .and_then(event_id)
        .map(str::to_string)
}

fn non_empty_string(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn safe_segment(value: &str) -> Result<String, ApiError> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err(ApiError::bad_request("invalid path segment"));
    }
    if !trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' || ch == '.')
    {
        return Err(ApiError::bad_request("invalid path segment"));
    }
    Ok(trimmed.to_string())
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
