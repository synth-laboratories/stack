use crate::handlers::ApiError;
use crate::runtime::{runtime_status_projection, store::RuntimeStore};
use crate::server::AppState;
use crate::victorialogs::append_thread_event_projected;
use axum::extract::{Path, Query, State};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use chrono::Utc;
use futures_util::stream::{self, Stream};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use stack_core::codex_path::resolve_for_session;
use stack_core::events::{
    read_thread_events, read_thread_monitor_actor_states, thread_monitor_actor_dir_path,
};
use stack_core::session::{
    build_usage_summary, list_summaries, read_session_by_id, read_session_value_by_id,
    session_path, thread_id_from_session, trace_turns, StackSessionSummary,
    StackSessionUsageSummary, StackTraceTurn,
};
use std::sync::Arc;
use std::time::Duration;
use tokio::fs;

#[derive(Debug, Serialize)]
pub struct TraceResponse {
    pub stack_session_id: String,
    pub stack_session_path: String,
    pub codex_thread_id: Option<String>,
    pub codex_session_path: Option<String>,
    pub turn_count: usize,
    pub usage_summary: Option<StackSessionUsageSummary>,
    pub turns: Vec<StackTraceTurn>,
    pub meta_events: Vec<Value>,
    pub actors: Vec<Value>,
}

#[derive(Debug, Serialize)]
pub struct StackStatusResponse {
    pub ok: bool,
    pub stackd_version: &'static str,
    pub stack_version: Option<String>,
    pub channel: Option<String>,
    pub session_log_dir: String,
    pub runtime_status_path: String,
    pub session_count: usize,
    pub latest_session: Option<StackSessionSummary>,
    pub runtime: Option<Value>,
}

#[derive(Debug, Deserialize)]
pub struct MonitorModeRequest {
    pub strictness: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct EventStreamQuery {
    pub thread_id: String,
    pub after_event_id: Option<String>,
    pub poll_ms: Option<u64>,
}

pub async fn list_threads(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<StackSessionSummary>>, ApiError> {
    Ok(Json(list_summaries(&state.paths.session_log_dir).await?))
}

pub async fn get_stack_status(
    State(state): State<Arc<AppState>>,
) -> Result<Json<StackStatusResponse>, ApiError> {
    let summaries = list_summaries(&state.paths.session_log_dir).await?;
    Ok(Json(StackStatusResponse {
        ok: true,
        stackd_version: env!("CARGO_PKG_VERSION"),
        stack_version: state.stack_version.clone(),
        channel: state.stack_channel.clone(),
        session_log_dir: state.paths.session_log_dir.to_string_lossy().to_string(),
        runtime_status_path: state
            .paths
            .runtime_status_path
            .to_string_lossy()
            .to_string(),
        session_count: summaries.len(),
        latest_session: summaries.first().cloned(),
        runtime: read_factory_runtime_status(&state).await,
    }))
}

pub async fn get_thread(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        read_session_value_by_id(&state.paths.session_log_dir, &id).await?,
    ))
}

pub async fn get_trace(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<TraceResponse>, ApiError> {
    let session = read_session_by_id(&state.paths.session_log_dir, &id).await?;
    let stack_session_path = session_path(&state.paths.session_log_dir, &id)?;
    let (codex_thread_id, codex_session_path) =
        resolve_for_session(&session, &state.paths.codex_sessions_root()).await;
    let meta_events = read_thread_events(&state.paths.stack_dir, &id).await?;
    let actors = read_thread_monitor_actor_states(&state.paths.stack_dir, &id).await?;
    Ok(Json(TraceResponse {
        stack_session_id: session.id.clone(),
        stack_session_path: stack_session_path.to_string_lossy().to_string(),
        codex_thread_id,
        codex_session_path: codex_session_path.map(|path| path.to_string_lossy().to_string()),
        turn_count: session.turns.len(),
        usage_summary: session
            .usage_summary
            .clone()
            .or_else(|| build_usage_summary(&session)),
        turns: trace_turns(&session),
        meta_events,
        actors,
    }))
}

pub async fn get_events(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Vec<Value>>, ApiError> {
    let _session = read_session_by_id(&state.paths.session_log_dir, &id).await?;
    Ok(Json(read_thread_events(&state.paths.stack_dir, &id).await?))
}

pub async fn append_event(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(event): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let event = normalize_ingested_event(&id, event)?;
    let path = append_thread_event_projected(&state.paths.stack_dir, &id, &event).await?;
    Ok(Json(json!({
        "ok": true,
        "event": event,
        "thread_event_log_path": path,
    })))
}

pub async fn stream_events(
    State(state): State<Arc<AppState>>,
    Query(query): Query<EventStreamQuery>,
) -> Result<Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>>, ApiError> {
    let thread_id = safe_segment(&query.thread_id)?;
    let poll_ms = query.poll_ms.unwrap_or(500).clamp(100, 5_000);
    let stack_dir = state.paths.stack_dir.clone();
    let mut next_index = 0usize;

    if let Some(after) = &query.after_event_id {
        let events = read_thread_events(&stack_dir, &thread_id).await?;
        if let Some(index) = events
            .iter()
            .position(|event| event.get("event_id").and_then(Value::as_str) == Some(after))
        {
            next_index = index + 1;
        }
    }

    let stream = stream::unfold((next_index, query.after_event_id), move |cursor| {
        let stack_dir = stack_dir.clone();
        let thread_id = thread_id.clone();
        let delay = Duration::from_millis(poll_ms);
        async move {
            let (mut next_index, mut last_event_id) = cursor;
            loop {
                let events = read_thread_events(&stack_dir, &thread_id)
                    .await
                    .unwrap_or_default();
                if next_index > events.len() {
                    next_index = events.len();
                }
                if let Some(event) = events.get(next_index).cloned() {
                    next_index += 1;
                    last_event_id = event
                        .get("event_id")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .or(last_event_id);
                    let sse = Event::default()
                        .event(
                            event
                                .get("type")
                                .and_then(Value::as_str)
                                .unwrap_or("stack.event"),
                        )
                        .id(last_event_id
                            .clone()
                            .unwrap_or_else(|| next_index.to_string()))
                        .json_data(event)
                        .unwrap_or_else(|_| {
                            Event::default().event("stack.error").data("encode error")
                        });
                    return Some((Ok(sse), (next_index, last_event_id)));
                }
                tokio::time::sleep(delay).await;
            }
        }
    });

    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

pub async fn get_actors(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Vec<Value>>, ApiError> {
    let _session = read_session_by_id(&state.paths.session_log_dir, &id).await?;
    Ok(Json(
        read_thread_monitor_actor_states(&state.paths.stack_dir, &id).await?,
    ))
}

pub async fn pause_monitor(
    State(state): State<Arc<AppState>>,
    Path((id, monitor_id)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    update_monitor_mode(&state, &id, &monitor_id, "off", "monitor.paused").await
}

pub async fn resume_monitor(
    State(state): State<Arc<AppState>>,
    Path((id, monitor_id)): Path<(String, String)>,
    request: Option<Json<MonitorModeRequest>>,
) -> Result<Json<Value>, ApiError> {
    let request = request.map(|Json(value)| value);
    let strictness = normalize_strictness(
        request
            .as_ref()
            .and_then(|value| value.strictness.as_deref()),
    )
    .unwrap_or("conservative");
    if strictness == "off" {
        return update_monitor_mode(&state, &id, &monitor_id, "conservative", "monitor.resumed")
            .await;
    }
    update_monitor_mode(&state, &id, &monitor_id, strictness, "monitor.resumed").await
}

pub async fn set_monitor_mode(
    State(state): State<Arc<AppState>>,
    Path((id, monitor_id)): Path<(String, String)>,
    Json(request): Json<MonitorModeRequest>,
) -> Result<Json<Value>, ApiError> {
    let Some(strictness) = normalize_strictness(request.strictness.as_deref()) else {
        return Err(ApiError::bad_request(
            "strictness must be off, passive, conservative, or aggressive",
        ));
    };
    let event_type = if strictness == "off" {
        "monitor.paused"
    } else {
        "monitor.mode_changed"
    };
    update_monitor_mode(&state, &id, &monitor_id, strictness, event_type).await
}

pub async fn get_status(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let session = read_session_by_id(&state.paths.session_log_dir, &id).await?;
    let path = session_path(&state.paths.session_log_dir, &id)?;
    let metadata = fs::metadata(&path)
        .await
        .map_err(|error| ApiError::internal(error.to_string()))?;
    let updated_at = metadata
        .modified()
        .ok()
        .map(system_time_to_iso8601)
        .unwrap_or_else(|| session.started_at.clone());

    let runtime = read_matching_runtime_status(&state, &id).await;
    Ok(Json(json!({
        "stack_session_id": id,
        "stack_session_path": path.to_string_lossy(),
        "updated_at": updated_at,
        "turn_count": session.turns.len(),
        "codex_thread_id": thread_id_from_session(&session),
        "runtime": runtime,
    })))
}

async fn update_monitor_mode(
    state: &AppState,
    id: &str,
    monitor_id: &str,
    strictness: &str,
    event_type: &str,
) -> Result<Json<Value>, ApiError> {
    let _session = read_session_by_id(&state.paths.session_log_dir, id).await?;
    let monitor_id = safe_segment(monitor_id)?;
    let actor_path = thread_monitor_actor_dir_path(&state.paths.stack_dir, id)?
        .join(format!("{monitor_id}.json"));
    let mut actor = match fs::read_to_string(&actor_path).await {
        Ok(text) => serde_json::from_str::<Value>(&text)
            .map_err(|error| ApiError::internal(error.to_string()))?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => json!({
            "schema": "stack/monitor-actor-state/v1",
            "thread_id": id,
            "monitor_actor_id": monitor_id,
            "wake_counts": 0,
            "queue_counts": 0,
            "steer_counts": 0,
            "skill_read_counts": 0,
            "context_push_counts": 0,
        }),
        Err(error) => return Err(ApiError::internal(error.to_string())),
    };
    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let previous = actor
        .get("strictness")
        .and_then(Value::as_str)
        .unwrap_or("conservative")
        .to_string();
    actor["thread_id"] = json!(id);
    actor["monitor_actor_id"] = json!(monitor_id);
    actor["state"] = json!(if strictness == "off" {
        "paused"
    } else {
        "idle"
    });
    actor["mode"] = json!(strictness);
    actor["strictness"] = json!(strictness);
    actor["last_completed_at"] = json!(now);
    if actor.get("schema").is_none() {
        actor["schema"] = json!("stack/monitor-actor-state/v1");
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
        "event_id": format!("{}_{}", event_type.replace('.', "_"), Utc::now().timestamp_nanos_opt().unwrap_or_default()),
        "type": event_type,
        "thread_id": id,
        "observed_at": now,
        "actor_id": monitor_id,
        "actor_role": "monitor",
        "payload": {
            "previous_strictness": previous,
            "strictness": strictness,
            "enabled": strictness != "off",
            "source": "stackd",
            "actor_state_path": actor_path.to_string_lossy(),
        }
    });
    append_thread_event_projected(&state.paths.stack_dir, id, &event).await?;
    Ok(Json(json!({
        "ok": true,
        "event": event,
        "actor": actor,
    })))
}

fn normalize_strictness(value: Option<&str>) -> Option<&'static str> {
    match value {
        Some("off") => Some("off"),
        Some("passive") => Some("passive"),
        Some("conservative") => Some("conservative"),
        Some("aggressive") => Some("aggressive"),
        _ => None,
    }
}

fn normalize_ingested_event(thread_id: &str, event: Value) -> Result<Value, ApiError> {
    let mut event = match event {
        Value::Object(map) => Value::Object(map),
        _ => return Err(ApiError::bad_request("event body must be a JSON object")),
    };
    let Some(event_type) = event
        .get("type")
        .and_then(Value::as_str)
        .map(str::to_string)
    else {
        return Err(ApiError::bad_request("event.type is required"));
    };
    if event_type.trim().is_empty() {
        return Err(ApiError::bad_request("event.type must be non-empty"));
    }
    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    event["thread_id"] = json!(thread_id);
    if event.get("event_id").and_then(Value::as_str).is_none() {
        event["event_id"] = json!(format!(
            "{}_{}",
            event_type.replace('.', "_"),
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
    }
    if event.get("observed_at").and_then(Value::as_str).is_none() {
        event["observed_at"] = json!(now);
    }
    if event.get("payload").is_none() {
        event["payload"] = json!({});
    }
    Ok(event)
}

fn safe_segment(value: &str) -> Result<String, ApiError> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err(ApiError::bad_request(format!(
            "invalid path segment: {value}"
        )));
    }
    Ok(trimmed
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' || ch == '.' {
                ch
            } else {
                '_'
            }
        })
        .collect())
}

async fn read_matching_runtime_status(state: &AppState, id: &str) -> Option<Value> {
    let value = read_runtime_status_file(state).await?;
    if value.get("stack_session_id").and_then(Value::as_str) == Some(id) {
        return Some(value);
    }
    None
}

async fn read_factory_runtime_status(state: &AppState) -> Option<Value> {
    if let Ok(store) = RuntimeStore::open(&state.paths) {
        if let Ok(Some(snapshot)) = store.load_snapshot() {
            return Some(runtime_status_projection(&snapshot, 0));
        }
    }
    read_runtime_status_file(state).await
}

async fn read_runtime_status_file(state: &AppState) -> Option<Value> {
    let text = fs::read_to_string(&state.paths.runtime_status_path)
        .await
        .ok()?;
    serde_json::from_str::<Value>(&text).ok()
}

fn system_time_to_iso8601(time: std::time::SystemTime) -> String {
    let datetime: chrono::DateTime<chrono::Utc> = time.into();
    datetime.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
