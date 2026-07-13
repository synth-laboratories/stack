use crate::gardener_runtime::run_gardener_message;
use crate::handlers::ApiError;
use crate::server::AppState;
use crate::victorialogs::append_thread_event_projected;
use axum::extract::State;
use axum::Json;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::json;
use stack_core::events::read_thread_events;
use stack_core::meta_thread::read_manifest;
use stack_core::session::read_session_by_id;
use std::sync::Arc;

const MAX_GARDENER_MESSAGE_BYTES: usize = 12_000;

#[derive(Debug, Deserialize)]
pub struct GardenerMessageRequest {
    pub gardener_thread_id: Option<String>,
    pub worker_thread_id: String,
    pub body: String,
    pub idempotency_key: String,
}

#[derive(Debug, Serialize)]
pub struct GardenerMessageResponse {
    pub accepted: bool,
    pub gardener_thread_id: String,
    pub worker_thread_id: String,
    pub message_event_id: String,
    pub duplicate: bool,
    pub receipt: &'static str,
}

pub async fn post_gardener_message(
    State(state): State<Arc<AppState>>,
    Json(request): Json<GardenerMessageRequest>,
) -> Result<Json<GardenerMessageResponse>, ApiError> {
    let body = request.body.trim();
    if body.is_empty() {
        return Err(ApiError::bad_request("body is required"));
    }
    if body.len() > MAX_GARDENER_MESSAGE_BYTES {
        return Err(ApiError::bad_request("body exceeds 12000 bytes"));
    }
    let idempotency_key = request.idempotency_key.trim();
    if idempotency_key.is_empty() {
        return Err(ApiError::bad_request("idempotency_key is required"));
    }
    if idempotency_key.len() > 200 {
        return Err(ApiError::bad_request("idempotency_key exceeds 200 bytes"));
    }
    let worker =
        read_session_by_id(&state.paths.session_log_dir, &request.worker_thread_id).await?;
    let meta_thread_id = worker
        .meta_thread_id
        .as_deref()
        .ok_or_else(|| ApiError::bad_request("worker thread has no meta-thread binding"))?;
    let manifest = read_manifest(&state.paths.stack_dir, meta_thread_id).await?;
    let gardener_thread_id = manifest
        .gardener_thread_id
        .as_deref()
        .filter(|id| !id.trim().is_empty())
        .ok_or_else(|| ApiError::bad_request("worker meta-thread has no gardener binding"))?;
    if request
        .gardener_thread_id
        .as_deref()
        .is_some_and(|requested| requested != gardener_thread_id)
    {
        return Err(ApiError::bad_request(
            "worker thread is not owned by the requested gardener",
        ));
    }
    let gardener = read_session_by_id(&state.paths.session_log_dir, gardener_thread_id).await?;
    let _message_guard = state.gardener_message_lock.lock().await;
    let prior_events = read_thread_events(&state.paths.stack_dir, &gardener.id).await?;
    if let Some(existing) = prior_events.iter().find(|event| {
        event.get("type").and_then(serde_json::Value::as_str) == Some("gardener.message")
            && event
                .get("payload")
                .and_then(|payload| payload.get("idempotency_key"))
                .and_then(serde_json::Value::as_str)
                == Some(idempotency_key)
    }) {
        let existing_payload = existing
            .get("payload")
            .and_then(serde_json::Value::as_object);
        let existing_worker = existing_payload
            .and_then(|payload| payload.get("worker_thread_id"))
            .and_then(serde_json::Value::as_str);
        let existing_body = existing_payload
            .and_then(|payload| payload.get("message"))
            .and_then(serde_json::Value::as_str);
        if existing_worker != Some(worker.id.as_str()) || existing_body != Some(body) {
            return Err(ApiError::bad_request(
                "idempotency_key was already used for a different gardener message",
            ));
        }
        let existing_event_id = existing
            .get("event_id")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| ApiError::internal("existing gardener message has no event_id"))?
            .to_string();
        return Ok(Json(GardenerMessageResponse {
            accepted: true,
            gardener_thread_id: gardener.id,
            worker_thread_id: worker.id,
            message_event_id: existing_event_id,
            duplicate: true,
            receipt: "lever.stackd.gardener_message.accepted",
        }));
    }

    let message_event_id = format!(
        "gardener_message_{}",
        Utc::now().timestamp_nanos_opt().unwrap_or_default()
    );
    append_thread_event_projected(
        &state.paths.stack_dir,
        &gardener.id,
        &json!({
            "event_id": message_event_id,
            "type": "gardener.message",
            "thread_id": gardener.id,
            "observed_at": Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            "actor_id": "stack_mcp",
            "actor_role": "primary",
            "meta_thread_id": worker.meta_thread_id,
            "segment_id": worker.segment_id,
            "payload": {
                "role": "user",
                "message": body,
                "source": "stack_mcp",
                "worker_thread_id": worker.id,
                "idempotency_key": idempotency_key,
            },
        }),
    )
    .await?;

    let task_state = state.clone();
    let task_gardener_thread_id = gardener.id.clone();
    let task_worker_thread_id = worker.id.clone();
    let task_message = body.to_string();
    let task_message_event_id = message_event_id.clone();
    tokio::spawn(async move {
        if let Err(error) = run_gardener_message(
            &task_state,
            &task_gardener_thread_id,
            &task_worker_thread_id,
            &task_message,
            "operator_chat",
        )
        .await
        {
            tracing::warn!(
                "gardener message consumer failed for {}: {error}",
                task_gardener_thread_id,
            );
            if let Err(record_error) = append_thread_event_projected(
                &task_state.paths.stack_dir,
                &task_gardener_thread_id,
                &json!({
                    "event_id": format!(
                        "gardener_message_failed_{}",
                        Utc::now().timestamp_nanos_opt().unwrap_or_default()
                    ),
                    "type": "gardener.message_failed",
                    "thread_id": task_gardener_thread_id,
                    "observed_at": Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                    "actor_id": "stackd",
                    "actor_role": "system",
                    "payload": {
                        "message_event_id": task_message_event_id,
                        "worker_thread_id": task_worker_thread_id,
                        "error": error,
                    },
                }),
            )
            .await
            {
                tracing::error!(
                    "recording gardener message failure failed for {} after consumer error {error}: {record_error}",
                    task_gardener_thread_id,
                );
            }
        }
    });

    Ok(Json(GardenerMessageResponse {
        accepted: true,
        gardener_thread_id: gardener.id,
        worker_thread_id: worker.id,
        message_event_id,
        duplicate: false,
        receipt: "lever.stackd.gardener_message.accepted",
    }))
}
