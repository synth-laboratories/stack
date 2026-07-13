use crate::handlers::ApiError;
use crate::runtime::{runtime_status_projection, store::RuntimeStore};
use crate::server::AppState;
use crate::victorialogs::append_thread_event_projected;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use chrono::Utc;
use futures_util::stream::{self, Stream};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use stack_core::actor_runtime::event_type;
use stack_core::codex_isolation::{
    assert_stack_codex_isolation, personal_codex_home, prepare_stack_codex_home,
};
use stack_core::codex_path::resolve_for_session;
use stack_core::events::{
    read_thread_events, read_thread_monitor_actor_states, thread_monitor_actor_dir_path,
};
use stack_core::meta_thread::{read_manifest, MetaThreadActiveGoal, MetaThreadManifest};
use stack_core::session::{
    build_usage_summary, count_sessions, list_recent_summaries, read_session_by_id,
    read_session_value_by_id, read_usage_from_stdout, session_path, thread_id_from_session,
    trace_turns, write_session, StackCodexTurn, StackLocalSession, StackSessionSummary,
    StackSessionUsageSummary, StackTraceTurn,
};
use stack_core::worker_run::{
    derive_worker_run_status, derive_worker_run_status_from_snapshot, read_worker_run_record,
    worker_run_session_snapshot, write_worker_run_record, WorkerRunRecord,
    WorkerRunSessionSnapshot, WorkerRunState, WorkerRunStatus,
};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};
use tokio::fs;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::sync::Mutex as AsyncMutex;

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

#[derive(Clone)]
struct CachedWorkerRunSession {
    modified_at: Option<SystemTime>,
    len: u64,
    snapshot: WorkerRunSessionSnapshot,
}

static WORKER_RUN_SESSION_CACHE: OnceLock<StdMutex<HashMap<PathBuf, CachedWorkerRunSession>>> =
    OnceLock::new();

#[derive(Clone)]
struct CachedWorkerRunStatus {
    cached_at: Instant,
    status: WorkerRunStatus,
}

static WORKER_RUN_STATUS_CACHE: OnceLock<AsyncMutex<HashMap<String, CachedWorkerRunStatus>>> =
    OnceLock::new();

#[derive(Debug, Deserialize)]
pub struct MonitorModeRequest {
    pub strictness: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct WorkerRunRequest {
    pub objective: Option<String>,
    pub max_turns: Option<u32>,
    pub monitor_profile: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct WorkerContinueRequest {
    pub note: Option<String>,
    pub max_turns: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct WorkerPauseRequest {
    pub reason: String,
}

#[derive(Debug, Serialize)]
pub struct WorkerRunResponse {
    pub thread_id: String,
    pub meta_thread_id: Option<String>,
    pub run_id: String,
    pub turn_id: String,
    pub turns: usize,
    pub state: WorkerRunState,
    pub status: WorkerRunStatus,
    pub receipt: &'static str,
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
    Ok(Json(
        list_recent_summaries(&state.paths.session_log_dir, 100).await?,
    ))
}

pub async fn get_stack_status(
    State(state): State<Arc<AppState>>,
) -> Result<Json<StackStatusResponse>, ApiError> {
    let summaries = list_recent_summaries(&state.paths.session_log_dir, 1).await?;
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
        session_count: count_sessions(&state.paths.session_log_dir).await?,
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

pub async fn get_worker_run_status(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<WorkerRunStatus>, ApiError> {
    let mut status_cache = WORKER_RUN_STATUS_CACHE
        .get_or_init(|| AsyncMutex::new(HashMap::new()))
        .lock()
        .await;
    if let Some(cached) = status_cache
        .get(&id)
        .filter(|entry| entry.cached_at.elapsed() < Duration::from_secs(2))
    {
        return Ok(Json(cached.status.clone()));
    }
    let session = read_worker_run_session_snapshot(&state, &id).await?;
    let events = read_thread_events(&state.paths.stack_dir, &id).await?;
    let manifest = match session.meta_thread_id.as_deref() {
        Some(meta_thread_id) => Some(
            read_manifest(&state.paths.stack_dir, meta_thread_id)
                .await
                .map_err(ApiError::from)?,
        ),
        None => None,
    };
    let record = read_worker_run_record(&state.paths.stack_dir, &id).await?;
    let status = derive_worker_run_status_from_snapshot(
        &session,
        &events,
        manifest
            .as_ref()
            .and_then(|manifest| manifest.active_goal.as_ref()),
        record.as_ref(),
    );
    status_cache.insert(
        id,
        CachedWorkerRunStatus {
            cached_at: Instant::now(),
            status: status.clone(),
        },
    );
    Ok(Json(status))
}

async fn read_worker_run_session_snapshot(
    state: &AppState,
    id: &str,
) -> Result<WorkerRunSessionSnapshot, ApiError> {
    let path = session_path(&state.paths.session_log_dir, id)?;
    let metadata = fs::metadata(&path)
        .await
        .map_err(|error| ApiError::internal(error.to_string()))?;
    let modified_at = metadata.modified().ok();
    let len = metadata.len();
    let cached = WORKER_RUN_SESSION_CACHE
        .get_or_init(|| StdMutex::new(HashMap::new()))
        .lock()
        .ok()
        .and_then(|cache| cache.get(&path).cloned())
        .filter(|entry| entry.modified_at == modified_at && entry.len == len);
    if let Some(cached) = cached {
        return Ok(cached.snapshot);
    }

    let session = read_session_by_id(&state.paths.session_log_dir, id).await?;
    let snapshot = worker_run_session_snapshot(&session);
    if let Ok(mut cache) = WORKER_RUN_SESSION_CACHE
        .get_or_init(|| StdMutex::new(HashMap::new()))
        .lock()
    {
        cache.insert(
            path,
            CachedWorkerRunSession {
                modified_at,
                len,
                snapshot: snapshot.clone(),
            },
        );
    }
    Ok(snapshot)
}

pub async fn run_worker_turn(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(request): Json<WorkerRunRequest>,
) -> Result<Json<WorkerRunResponse>, ApiError> {
    Ok(Json(
        start_worker_run(
            state,
            &id,
            request.objective,
            request.max_turns,
            request.monitor_profile,
            None,
        )
        .await?,
    ))
}

pub async fn continue_worker_run(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(request): Json<WorkerContinueRequest>,
) -> Result<Json<WorkerRunResponse>, ApiError> {
    Ok(Json(
        start_worker_run(state, &id, None, request.max_turns, None, request.note).await?,
    ))
}

pub async fn pause_worker_run(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(request): Json<WorkerPauseRequest>,
) -> Result<Json<WorkerRunStatus>, ApiError> {
    let reason = request.reason.trim();
    if reason.is_empty() {
        return Err(ApiError::bad_request("reason is required"));
    }
    let session = read_session_by_id(&state.paths.session_log_dir, &id).await?;
    let mut record = read_worker_run_record(&state.paths.stack_dir, &id)
        .await?
        .unwrap_or_else(|| WorkerRunRecord {
            schema: "stack/worker-run/v1".to_string(),
            thread_id: session.id.clone(),
            meta_thread_id: session.meta_thread_id.clone(),
            run_id: format!("worker_run_{}", unique_worker_suffix()),
            state: WorkerRunState::Paused,
            started_at: now(),
            updated_at: now(),
            max_turns: 0,
            completed_turns: 0,
            pause_reason: Some(reason.to_string()),
            stop_reason: Some("pause_requested".to_string()),
            last_turn_id: None,
            last_error: None,
        });
    let events = read_thread_events(&state.paths.stack_dir, &id).await?;
    let manifest = read_worker_manifest(&state, &session).await?;
    let current_status = derive_worker_run_status(
        &session,
        &events,
        manifest
            .as_ref()
            .and_then(|manifest| manifest.active_goal.as_ref()),
        Some(&record),
    );
    if current_status.state == WorkerRunState::Done {
        return Ok(Json(current_status));
    }
    if record.state != WorkerRunState::Running {
        record.state = WorkerRunState::Paused;
    }
    record.pause_reason = Some(reason.to_string());
    record.stop_reason = Some("pause_requested".to_string());
    record.updated_at = now();
    write_worker_run_record(&state.paths.stack_dir, &record).await?;
    append_worker_event(
        &state,
        &session,
        "worker_run.pause_requested",
        json!({"run_id": record.run_id, "reason": reason}),
    )
    .await?;
    let events = read_thread_events(&state.paths.stack_dir, &id).await?;
    Ok(Json(derive_worker_run_status(
        &session,
        &events,
        manifest
            .as_ref()
            .and_then(|manifest| manifest.active_goal.as_ref()),
        Some(&record),
    )))
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

async fn start_worker_run(
    state: Arc<AppState>,
    thread_id: &str,
    objective: Option<String>,
    max_turns: Option<u32>,
    monitor_profile: Option<String>,
    continue_note: Option<String>,
) -> Result<WorkerRunResponse, ApiError> {
    let max_turns = normalize_worker_max_turns(max_turns)?;
    let permit = state
        .worker_run_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| {
            ApiError::with_status(
                StatusCode::TOO_MANY_REQUESTS,
                "worker run global concurrency cap is exhausted",
            )
        })?;

    prepare_stack_codex_home(&state.paths.codex_home, &personal_codex_home())
        .map_err(|error| ApiError::internal(error.to_string()))?;
    assert_stack_codex_isolation(&state.paths.codex_home, &personal_codex_home())
        .map_err(ApiError::internal)?;

    let session = read_session_by_id(&state.paths.session_log_dir, thread_id).await?;
    let manifest = read_worker_manifest(&state, &session).await?;
    if manifest
        .as_ref()
        .and_then(|manifest| manifest.active_goal.as_ref())
        .is_some_and(|goal| {
            matches!(
                goal.status.trim().to_ascii_lowercase().as_str(),
                "done" | "complete" | "completed"
            )
        })
    {
        return Err(ApiError::with_status(
            StatusCode::CONFLICT,
            "worker goal is complete; update the goal before starting another run",
        ));
    }
    let objective = objective
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            manifest
                .as_ref()
                .and_then(|manifest| manifest.active_goal.as_ref())
                .map(|goal| goal.objective.trim())
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .ok_or_else(|| {
            ApiError::bad_request("objective is required when the worker has no active goal")
        })?;

    if let Some(existing) = read_worker_run_record(&state.paths.stack_dir, &session.id).await? {
        let events = read_thread_events(&state.paths.stack_dir, &session.id).await?;
        let existing_status = derive_worker_run_status(
            &session,
            &events,
            manifest
                .as_ref()
                .and_then(|manifest| manifest.active_goal.as_ref()),
            Some(&existing),
        );
        if existing_status.state == WorkerRunState::Running {
            return Err(ApiError::with_status(
                StatusCode::CONFLICT,
                "worker run is already running",
            ));
        }
    }

    let effective_monitor_profile = monitor_profile
        .as_deref()
        .or_else(|| {
            manifest
                .as_ref()
                .and_then(|manifest| manifest.monitor_profile.as_deref())
        })
        .map(str::to_string);
    if let Some(profile) = effective_monitor_profile.as_deref() {
        enable_monitor_for_worker(&state, &session, profile).await?;
    }

    let run_id = format!("worker_run_{}", unique_worker_suffix());
    let started_at = now();
    let record = WorkerRunRecord {
        schema: "stack/worker-run/v1".to_string(),
        thread_id: session.id.clone(),
        meta_thread_id: session.meta_thread_id.clone(),
        run_id: run_id.clone(),
        state: WorkerRunState::Running,
        started_at: started_at.clone(),
        updated_at: started_at,
        max_turns,
        completed_turns: 0,
        pause_reason: None,
        stop_reason: None,
        last_turn_id: None,
        last_error: None,
    };
    write_worker_run_record(&state.paths.stack_dir, &record).await?;
    append_worker_event(
        &state,
        &session,
        "worker_run.started",
        json!({
            "run_id": run_id,
            "phase": "loop",
            "objective": objective,
            "max_turns": max_turns,
            "monitor_profile": monitor_profile.as_deref().or_else(|| manifest.as_ref().and_then(|manifest| manifest.monitor_profile.as_deref())),
            "continue_note": continue_note,
            "prior_turns": session.turns.len(),
        }),
    )
    .await?;
    let _ = append_gardener_worker_run_status(
        &state, &session, "running", &run_id, None, 0, max_turns, None,
    )
    .await;

    let events = read_thread_events(&state.paths.stack_dir, &session.id).await?;
    let status = derive_worker_run_status(
        &session,
        &events,
        manifest
            .as_ref()
            .and_then(|manifest| manifest.active_goal.as_ref()),
        Some(&record),
    );

    let task_state = state.clone();
    let task_thread_id = session.id.clone();
    let task_run_id = run_id.clone();
    let task_session = session.clone();
    let task_objective = objective.clone();
    let task_continue_note = continue_note.clone();
    let task_record = record.clone();
    let task_monitor_profile = effective_monitor_profile.clone();
    tokio::spawn(async move {
        let _permit = permit;
        if let Err(error) = run_worker_loop_task(
            task_state.clone(),
            task_session,
            task_objective,
            max_turns,
            task_continue_note,
            task_record,
            task_monitor_profile,
        )
        .await
        {
            mark_worker_run_error(&task_state, &task_thread_id, &task_run_id, &error).await;
        }
    });

    Ok(WorkerRunResponse {
        thread_id: session.id.clone(),
        meta_thread_id: session.meta_thread_id.clone(),
        run_id,
        turn_id: String::new(),
        turns: session.turns.len(),
        state: status.state,
        status,
        receipt: "lever.stackd.worker_run.started",
    })
}

async fn run_worker_loop_task(
    state: Arc<AppState>,
    mut session: StackLocalSession,
    objective: String,
    max_turns: u32,
    continue_note: Option<String>,
    mut record: WorkerRunRecord,
    monitor_profile: Option<String>,
) -> Result<(), ApiError> {
    let run_id = record.run_id.clone();
    for index in 0..max_turns {
        if let Some(reason) = requested_pause_reason(&state, &session.id, &run_id).await? {
            record.state = WorkerRunState::Paused;
            record.stop_reason = Some("pause_requested".to_string());
            record.pause_reason = Some(reason);
            record.updated_at = now();
            write_worker_run_record(&state.paths.stack_dir, &record).await?;
            append_worker_event(
                &state,
                &session,
                "worker_run.paused",
                json!({"run_id": run_id, "reason": record.pause_reason}),
            )
            .await?;
            let _ = append_gardener_worker_run_status(
                &state,
                &session,
                "paused",
                &run_id,
                record.pause_reason.as_deref(),
                record.completed_turns,
                max_turns,
                None,
            )
            .await;
            break;
        }

        let active_manifest = read_worker_manifest(&state, &session).await?;
        let turn = run_worker_loop_turn(
            &state,
            &session,
            &objective,
            active_manifest
                .as_ref()
                .and_then(|manifest| manifest.active_goal.as_ref()),
            continue_note.as_deref(),
            index,
        )
        .await?;
        let exit_code = turn.exit_code.unwrap_or(1);
        session.turns.push(turn.clone());
        if session.codex_thread_id.is_none() {
            session.codex_thread_id = thread_id_from_session(&session);
        }
        session.usage_summary = build_usage_summary(&session);
        write_session(&state.paths.session_log_dir, &session).await?;
        record_worker_agent_events(&state, &session, &turn).await?;
        record.completed_turns += 1;
        record.last_turn_id = Some(turn.id.clone());
        record.updated_at = now();
        let pause_after_turn = requested_pause_reason(&state, &session.id, &run_id).await?;
        if let Some(reason) = pause_after_turn.clone() {
            record.state = WorkerRunState::Paused;
            record.stop_reason = Some("pause_requested".to_string());
            record.pause_reason = Some(reason);
        }
        write_worker_run_record(&state.paths.stack_dir, &record).await?;
        append_worker_event(
            &state,
            &session,
            "worker_run.turn_completed",
            json!({
                "run_id": run_id,
                "stack_turn_id": turn.id,
                "exit_code": exit_code,
                "turn_index": index + 1,
                "turns": session.turns.len(),
            }),
        )
        .await?;

        if let Some(profile) = monitor_profile.as_deref() {
            if let Err(error) = run_monitor_after_worker_turn(&state, &session, profile).await {
                tracing::warn!(
                    "monitor pass failed after worker turn {} for {}: {error}",
                    turn.id,
                    session.id,
                );
                append_worker_event(
                    &state,
                    &session,
                    "worker_run.monitor_failed",
                    json!({
                        "run_id": run_id,
                        "stack_turn_id": turn.id,
                        "monitor_profile": profile,
                        "error": truncate(&error, 1200),
                    }),
                )
                .await?;
            }
        }

        if pause_after_turn.is_some() {
            append_worker_event(
                &state,
                &session,
                "worker_run.paused",
                json!({"run_id": run_id, "reason": record.pause_reason, "turns": session.turns.len()}),
            )
            .await?;
            let _ = append_gardener_worker_run_status(
                &state,
                &session,
                "paused",
                &run_id,
                record.pause_reason.as_deref(),
                record.completed_turns,
                max_turns,
                None,
            )
            .await;
            break;
        }

        let refreshed_manifest = read_worker_manifest(&state, &session).await?;
        let manifest_decision = worker_loop_stop_decision(refreshed_manifest.as_ref(), exit_code);
        let monitor_decision = monitor_goal_stop_decision_after(
            &state,
            &session.id,
            turn.finished_at.as_deref().unwrap_or(&turn.started_at),
        )
        .await?;
        let decision = manifest_decision.or(monitor_decision);
        if let Some((state_value, event_type, reason)) = decision {
            record.state = state_value;
            record.stop_reason = Some(reason.to_string());
            record.updated_at = now();
            write_worker_run_record(&state.paths.stack_dir, &record).await?;
            append_worker_event(
                &state,
                &session,
                event_type,
                json!({"run_id": run_id, "reason": reason, "turns": session.turns.len()}),
            )
            .await?;
            let _ = append_gardener_worker_run_status(
                &state,
                &session,
                worker_run_state_label(&record.state),
                &run_id,
                Some(reason),
                record.completed_turns,
                max_turns,
                None,
            )
            .await;
            break;
        }
        if index + 1 == max_turns {
            record.state = WorkerRunState::Idle;
            record.stop_reason = Some("max_turns_reached".to_string());
            record.updated_at = now();
            write_worker_run_record(&state.paths.stack_dir, &record).await?;
            append_worker_event(
                &state,
                &session,
                "worker_run.completed",
                json!({"run_id": run_id, "reason": "max_turns_reached", "turns": session.turns.len()}),
            )
            .await?;
            let _ = append_gardener_worker_run_status(
                &state,
                &session,
                "idle",
                &run_id,
                Some("max_turns_reached"),
                record.completed_turns,
                max_turns,
                None,
            )
            .await;
        }
    }
    Ok(())
}

async fn run_monitor_after_worker_turn(
    state: &AppState,
    session: &StackLocalSession,
    monitor_profile: &str,
) -> Result<(), String> {
    let output = Command::new("bun")
        .arg("run")
        .arg("src/main.ts")
        .arg("monitor")
        .arg("run-once")
        .arg("--thread-id")
        .arg(&session.id)
        .arg("--profile")
        .arg(monitor_profile)
        .arg("--wake-reason")
        .arg("external_worker_turn")
        .current_dir(&state.paths.install_root)
        .env("STACK_ROOT", &state.paths.app_root)
        .env("STACK_WORKING_DIR", &session.workspace_root)
        .env("STACK_SESSION_DIR", &state.paths.session_log_dir)
        .env("CODEX_HOME", &state.paths.codex_home)
        .env("STACK_CODEX_ISOLATED", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|error| format!("spawning monitor consumer: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Err(format!(
        "monitor consumer exited {}: {}",
        output.status.code().unwrap_or(1),
        if stderr.is_empty() { stdout } else { stderr },
    ))
}

async fn mark_worker_run_error(state: &AppState, thread_id: &str, run_id: &str, error: &ApiError) {
    let message = error.message();
    let mut completed_turns = 0;
    let mut max_turns = 0;
    if let Ok(Some(mut record)) = read_worker_run_record(&state.paths.stack_dir, thread_id).await {
        if record.run_id == run_id {
            record.state = WorkerRunState::Error;
            record.stop_reason = Some("runner_error".to_string());
            record.last_error = Some(truncate(message, 1200));
            record.updated_at = now();
            completed_turns = record.completed_turns;
            max_turns = record.max_turns;
            let _ = write_worker_run_record(&state.paths.stack_dir, &record).await;
        }
    }
    if let Ok(session) = read_session_by_id(&state.paths.session_log_dir, thread_id).await {
        let _ = append_worker_event(
            state,
            &session,
            "worker_run.failed",
            json!({"run_id": run_id, "reason": "runner_error", "error": truncate(message, 1200)}),
        )
        .await;
        let _ = append_gardener_worker_run_status(
            state,
            &session,
            "error",
            run_id,
            Some("runner_error"),
            completed_turns,
            max_turns,
            Some(&truncate(message, 300)),
        )
        .await;
    }
}

async fn run_worker_loop_turn(
    state: &AppState,
    session: &StackLocalSession,
    objective: &str,
    active_goal: Option<&MetaThreadActiveGoal>,
    continue_note: Option<&str>,
    turn_index: u32,
) -> Result<StackCodexTurn, ApiError> {
    let started_at = now();
    let monitor_steer = pending_monitor_steer(state, session).await?;
    let user_prompt = worker_turn_prompt(
        objective,
        active_goal
            .map(|goal| goal.acceptance_criteria.as_slice())
            .unwrap_or(&[]),
        continue_note,
        monitor_steer.as_deref(),
        turn_index,
    );
    let prompt = stack_worker_harness_prompt(state, session, &user_prompt, active_goal);
    let output = run_codex_exec_for_worker(state, session, &prompt).await;
    let finished_at = now();
    let (stdout, stderr, exit_code) = output.map_err(ApiError::internal)?;
    Ok(StackCodexTurn {
        id: format!("turn_{}", unique_worker_suffix()),
        prompt: user_prompt,
        selected_paths: Vec::new(),
        started_at,
        finished_at: Some(finished_at),
        exit_code: Some(exit_code),
        usage: read_usage_from_stdout(&stdout),
        stdout,
        stderr,
    })
}

async fn pending_monitor_steer(
    state: &AppState,
    session: &StackLocalSession,
) -> Result<Option<String>, ApiError> {
    let events = read_thread_events(&state.paths.stack_dir, &session.id).await?;
    let after = events
        .iter()
        .rposition(|event| {
            matches!(
                event_type(event),
                Some("worker_run.started" | "worker_run.turn_completed")
            )
        })
        .map(|index| index + 1)
        .unwrap_or(0);
    let messages: Vec<&str> = events
        .iter()
        .skip(after)
        .filter(|event| event_type(event) == Some("monitor.steer"))
        .filter_map(|event| {
            event
                .get("payload")
                .and_then(|payload| payload.get("message"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|message| !message.is_empty())
        })
        .take(3)
        .collect();
    if messages.is_empty() {
        Ok(None)
    } else {
        Ok(Some(truncate(&messages.join("\n\n"), 3000)))
    }
}

async fn read_worker_manifest(
    state: &AppState,
    session: &StackLocalSession,
) -> Result<Option<MetaThreadManifest>, ApiError> {
    match session.meta_thread_id.as_deref() {
        Some(meta_thread_id) => Ok(Some(
            read_manifest(&state.paths.stack_dir, meta_thread_id).await?,
        )),
        None => Ok(None),
    }
}

fn worker_loop_stop_decision(
    manifest: Option<&MetaThreadManifest>,
    exit_code: i32,
) -> Option<(WorkerRunState, &'static str, &'static str)> {
    if exit_code != 0 {
        return Some((
            WorkerRunState::Error,
            "worker_run.failed",
            "turn_exit_nonzero",
        ));
    }
    let Some(goal) = manifest.and_then(|manifest| manifest.active_goal.as_ref()) else {
        return None;
    };
    let status = goal.status.trim().to_ascii_lowercase();
    if matches!(status.as_str(), "done" | "complete" | "completed") {
        return Some((WorkerRunState::Done, "worker_run.done", "goal_done"));
    }
    if status == "paused" {
        return Some((WorkerRunState::Paused, "worker_run.paused", "goal_paused"));
    }
    if status == "blocked" || !goal.blockers.is_empty() {
        return Some((
            WorkerRunState::Blocked,
            "worker_run.blocked",
            "blocker_recorded",
        ));
    }
    None
}

async fn monitor_goal_stop_decision_after(
    state: &AppState,
    thread_id: &str,
    after: &str,
) -> Result<Option<(WorkerRunState, &'static str, &'static str)>, ApiError> {
    let events = read_thread_events(&state.paths.stack_dir, thread_id).await?;
    for event in events.iter().rev() {
        let observed_at = event
            .get("observed_at")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if observed_at < after {
            break;
        }
        if event.get("type").and_then(Value::as_str) != Some("monitor.goal_status") {
            continue;
        }
        let status = event
            .get("payload")
            .and_then(|payload| payload.get("status"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        return Ok((status == "goal_met").then_some((
            WorkerRunState::Done,
            "worker_run.done",
            "monitor_goal_met",
        )));
    }
    Ok(None)
}

async fn requested_pause_reason(
    state: &AppState,
    thread_id: &str,
    run_id: &str,
) -> Result<Option<String>, ApiError> {
    let Some(record) = read_worker_run_record(&state.paths.stack_dir, thread_id).await? else {
        return Ok(None);
    };
    if record.run_id == run_id && record.stop_reason.as_deref() == Some("pause_requested") {
        return Ok(record.pause_reason);
    }
    Ok(None)
}

fn normalize_worker_max_turns(value: Option<u32>) -> Result<u32, ApiError> {
    let default = std::env::var("STACK_WORKER_RUN_DEFAULT_MAX_TURNS")
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(100);
    let hard_cap = std::env::var("STACK_WORKER_RUN_MAX_TURNS")
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(100);
    let turns = value.unwrap_or(default);
    if turns == 0 {
        return Err(ApiError::bad_request("max_turns must be at least 1"));
    }
    Ok(turns.min(hard_cap))
}

async fn run_codex_exec_for_worker(
    state: &AppState,
    session: &StackLocalSession,
    prompt: &str,
) -> Result<(String, String, i32), String> {
    let mut parts = split_command_line(&session.codex_command)?;
    parts = with_ephemeral_exec_args(parts)?;
    parts = with_exec_sandbox_mode(parts, "danger-full-access")?;
    parts.extend([
        "-C".to_string(),
        session.workspace_root.clone(),
        "-".to_string(),
    ]);
    let (program, args) = parts
        .split_first()
        .ok_or_else(|| "worker codex command is empty".to_string())?;
    let mut child = Command::new(program)
        .args(args)
        .current_dir(&session.workspace_root)
        .env("CODEX_HOME", &state.paths.codex_home)
        .env("STACK_CODEX_ISOLATED", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("spawning worker codex turn: {error}"))?;
    let Some(mut stdin) = child.stdin.take() else {
        return Err("worker codex stdin unavailable".to_string());
    };
    stdin
        .write_all(prompt.as_bytes())
        .await
        .map_err(|error| format!("writing worker prompt: {error}"))?;
    drop(stdin);
    let output = child
        .wait_with_output()
        .await
        .map_err(|error| format!("waiting for worker codex turn: {error}"))?;
    Ok((
        String::from_utf8_lossy(&output.stdout).to_string(),
        String::from_utf8_lossy(&output.stderr).to_string(),
        output.status.code().unwrap_or(1),
    ))
}

fn split_command_line(command: &str) -> Result<Vec<String>, String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for ch in command.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        if let Some(active_quote) = quote {
            if ch == active_quote {
                quote = None;
            } else {
                current.push(ch);
            }
            continue;
        }
        if ch == '"' || ch == '\'' {
            quote = Some(ch);
            continue;
        }
        if ch.is_whitespace() {
            if !current.is_empty() {
                parts.push(std::mem::take(&mut current));
            }
            continue;
        }
        current.push(ch);
    }
    if escaped {
        current.push('\\');
    }
    if quote.is_some() {
        return Err("worker codex command has an unterminated quote".to_string());
    }
    if !current.is_empty() {
        parts.push(current);
    }
    if parts.is_empty() {
        return Err("worker codex command is empty".to_string());
    }
    Ok(parts)
}

fn with_ephemeral_exec_args(mut parts: Vec<String>) -> Result<Vec<String>, String> {
    if parts.iter().any(|part| part == "--ephemeral") {
        return Ok(parts);
    }
    let Some(exec_index) = parts.iter().position(|part| part == "exec") else {
        return Err(format!(
            "cannot run background worker: codex command is not an exec invocation ({})",
            parts.join(" ")
        ));
    };
    parts.insert(exec_index + 1, "--ephemeral".to_string());
    Ok(parts)
}

fn with_exec_sandbox_mode(mut parts: Vec<String>, mode: &str) -> Result<Vec<String>, String> {
    if let Some(index) = parts
        .iter()
        .position(|part| part == "--sandbox" || part == "-s")
    {
        if index + 1 >= parts.len() {
            return Err("codex sandbox flag is missing its value".to_string());
        }
        parts[index] = "--sandbox".to_string();
        parts[index + 1] = mode.to_string();
        return Ok(parts);
    }
    let Some(exec_index) = parts.iter().position(|part| part == "exec") else {
        return Err("cannot set sandbox mode: codex command is not an exec invocation".to_string());
    };
    parts.insert(exec_index + 1, mode.to_string());
    parts.insert(exec_index + 1, "--sandbox".to_string());
    Ok(parts)
}

async fn enable_monitor_for_worker(
    state: &AppState,
    session: &StackLocalSession,
    monitor_profile: &str,
) -> Result<(), ApiError> {
    let monitor_actor_id = format!("monitor_{}", monitor_profile.trim());
    let strictness = if monitor_profile.trim().eq_ignore_ascii_case("passive") {
        "passive"
    } else {
        "conservative"
    };
    let _ = update_monitor_mode(
        state,
        &session.id,
        &monitor_actor_id,
        strictness,
        "monitor.resumed",
    )
    .await?;
    append_worker_event(
        state,
        session,
        "worker_run.monitor_enabled",
        json!({"monitor_profile": monitor_profile, "monitor_actor_id": monitor_actor_id, "strictness": strictness}),
    )
    .await?;
    Ok(())
}

fn worker_turn_prompt(
    objective: &str,
    acceptance_criteria: &[String],
    continue_note: Option<&str>,
    monitor_steer: Option<&str>,
    turn_index: u32,
) -> String {
    let mut lines = vec![
        "Continue this Stack worker lane in the background. Work only on the assigned objective."
            .to_string(),
        "Local Gemini policy rule: when the objective calls for Gemini 3.1 Flash Lite in a local GEPA/policy or React-policy harness, use policy.provider=google with GEMINI_API_KEY after Stack confirms local capability. An offline hosted stack_inference_catalog is not a blocker for that local policy route. Gemini is never a Codex worker model; do not pass it to codex exec.".to_string(),
        format!("Background run turn: {}", turn_index + 1),
        String::new(),
        "Objective:".to_string(),
        objective.to_string(),
        String::new(),
    ];
    if let Some(note) = continue_note.map(str::trim).filter(|note| !note.is_empty()) {
        lines.push("Continuation note:".to_string());
        lines.push(note.to_string());
        lines.push(String::new());
    }
    if let Some(steer) = monitor_steer
        .map(str::trim)
        .filter(|steer| !steer.is_empty())
    {
        lines.push("Monitor guidance from the previous turn:".to_string());
        lines.push(steer.to_string());
        lines.push(String::new());
    }
    if !acceptance_criteria.is_empty() {
        lines.push("Acceptance criteria:".to_string());
        lines.extend(
            acceptance_criteria
                .iter()
                .map(|criterion| format!("- {}", criterion)),
        );
        lines.push(String::new());
    }
    lines.push("Record durable evidence through the available Stack MCP effort tools when you make progress. If progress depends on external input, missing credentials, capacity, approval, or another team, record the blocker with stack_effort_record_blocker and state the next safe action; do not mark the goal blocked.".to_string());
    lines.join("\n")
}

fn stack_worker_harness_prompt(
    state: &AppState,
    session: &StackLocalSession,
    user_prompt: &str,
    active_goal: Option<&MetaThreadActiveGoal>,
) -> String {
    let recent_turns = session.turns.iter().rev().take(8).collect::<Vec<_>>();
    let mut transcript_parts = Vec::new();
    for (index, turn) in recent_turns.iter().rev().enumerate() {
        transcript_parts.push(format!(
            "Turn {}\nUser: {}\nCodex: {}",
            session.turns.len().saturating_sub(recent_turns.len()) + index + 1,
            turn.prompt,
            truncate(&first_non_empty(&turn.stdout, &turn.stderr), 3000)
        ));
    }
    [
        "You are running inside Stack, a local OpenTUI Codex cockpit.".to_string(),
        "When Stack MCP tools are available, use them for mediated live operations instead of bypassing owner routes.".to_string(),
        "If Stack MCP reports missing auth, offline routes, or no active target, say that directly and do not fall back to raw databases, Redis keys, or compatibility projections.".to_string(),
        format!("When calling stack_jesterky_launch, pass owner_actor_role=\"worker\" and owner_thread_id=\"{}\" so the workflow is nested under this worker lane.", session.id),
        format!("Workspace: {}", state.paths.app_root.display()),
        String::new(),
        "## Active Stack goal".to_string(),
        format_active_goal(active_goal),
        String::new(),
        "## User prompt".to_string(),
        user_prompt.to_string(),
        String::new(),
        format!(
            "## Restored Stack transcript ({} turns, showing latest {})",
            session.turns.len(),
            recent_turns.len()
        ),
        if transcript_parts.is_empty() {
            "(none)".to_string()
        } else {
            transcript_parts.join("\n\n")
        },
    ]
    .join("\n")
}

fn format_active_goal(active_goal: Option<&MetaThreadActiveGoal>) -> String {
    let Some(goal) = active_goal else {
        return "(none)".to_string();
    };
    let mut lines = vec![
        "Treat this section as authoritative Stack state.".to_string(),
        format!("Status: {}", goal.status),
        format!("Objective: {}", goal.objective),
    ];
    if !goal.acceptance_criteria.is_empty() {
        lines.push("Acceptance criteria:".to_string());
        lines.extend(
            goal.acceptance_criteria
                .iter()
                .filter(|criterion| !criterion.trim().is_empty())
                .map(|criterion| format!("- {}", criterion.trim())),
        );
    }
    if !goal.blockers.is_empty() {
        lines.push("Blockers:".to_string());
        lines.extend(
            goal.blockers
                .iter()
                .filter(|blocker| !blocker.trim().is_empty())
                .map(|blocker| format!("- {}", blocker.trim())),
        );
    }
    lines.join("\n")
}

async fn record_worker_agent_events(
    state: &AppState,
    session: &StackLocalSession,
    turn: &StackCodexTurn,
) -> Result<(), ApiError> {
    for line in turn.stdout.lines().filter(|line| !line.trim().is_empty()) {
        let Ok(record) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if let Some(text) = agent_message_text(&record) {
            append_worker_agent_event(
                state,
                session,
                "agent.message.completed",
                json!({"text": redact_text(&truncate(&text, 1800)), "char_count": text.chars().count()}),
            )
            .await?;
        }
    }
    append_worker_agent_event(
        state,
        session,
        "agent.turn.completed",
        json!({
            "stack_turn_id": turn.id,
            "started_at": turn.started_at,
            "finished_at": turn.finished_at,
            "exit_code": turn.exit_code,
            "usage": turn.usage,
            "prompt": redact_text(&bounded_tail(&turn.prompt, 600)),
            "stdout_excerpt": redact_text(&bounded_tail(&turn.stdout, 2000)),
        }),
    )
    .await?;
    Ok(())
}

fn agent_message_text(record: &Value) -> Option<String> {
    if matches!(
        record.get("type").and_then(Value::as_str),
        Some("event_msg" | "response_item")
    ) {
        return record.get("payload").and_then(agent_message_text);
    }
    if record.get("type").and_then(Value::as_str) != Some("agent_message") {
        return None;
    }
    record
        .get("text")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

async fn append_worker_agent_event(
    state: &AppState,
    session: &StackLocalSession,
    event_type: &str,
    payload: Value,
) -> Result<(), ApiError> {
    append_thread_event_projected(
        &state.paths.stack_dir,
        &session.id,
        &json!({
            "event_id": event_id(event_type),
            "type": event_type,
            "thread_id": session.id,
            "observed_at": now(),
            "actor_id": "worker_codex",
            "actor_role": "primary",
            "meta_thread_id": session.meta_thread_id,
            "segment_id": session.segment_id,
            "payload": with_segment_payload(payload, session),
        }),
    )
    .await?;
    Ok(())
}

async fn append_worker_event(
    state: &AppState,
    session: &StackLocalSession,
    event_type: &str,
    payload: Value,
) -> Result<(), ApiError> {
    append_thread_event_projected(
        &state.paths.stack_dir,
        &session.id,
        &json!({
            "event_id": event_id(event_type),
            "type": event_type,
            "thread_id": session.id,
            "observed_at": now(),
            "actor_id": "worker_runner",
            "actor_role": "system",
            "meta_thread_id": session.meta_thread_id,
            "segment_id": session.segment_id,
            "payload": with_segment_payload(payload, session),
        }),
    )
    .await?;
    Ok(())
}

/// A durable worker belongs to its registered gardener. Mirror only lifecycle
/// boundaries into that gardener's event log so both the visible conversation
/// and the gardener's next turn receive the same launch/terminal receipt.
/// This is deliberately best-effort at call sites: an absent gardener session
/// must never prevent a worker from starting or reaching its terminal state.
async fn append_gardener_worker_run_status(
    state: &AppState,
    worker_session: &StackLocalSession,
    status: &str,
    run_id: &str,
    reason: Option<&str>,
    completed_turns: u32,
    max_turns: u32,
    error: Option<&str>,
) -> Result<(), ApiError> {
    let Some(manifest) = read_worker_manifest(state, worker_session).await? else {
        return Ok(());
    };
    let Some(gardener_thread_id) = manifest
        .gardener_thread_id
        .filter(|id| !id.trim().is_empty())
    else {
        return Ok(());
    };
    if gardener_thread_id == worker_session.id {
        return Ok(());
    }
    if read_session_by_id(&state.paths.session_log_dir, &gardener_thread_id)
        .await
        .is_err()
    {
        return Ok(());
    }

    append_thread_event_projected(
        &state.paths.stack_dir,
        &gardener_thread_id,
        &json!({
            "event_id": event_id("gardener.worker_run_status"),
            "type": "gardener.worker_run_status",
            "thread_id": gardener_thread_id,
            "observed_at": now(),
            "actor_id": "worker_runner",
            "actor_role": "system",
            "meta_thread_id": worker_session.meta_thread_id,
            "segment_id": worker_session.segment_id,
            "payload": {
                "worker_thread_id": worker_session.id,
                "worker_meta_thread_id": worker_session.meta_thread_id,
                "worker_title": manifest.title,
                "run_id": run_id,
                "status": status,
                "reason": reason,
                "completed_turns": completed_turns,
                "max_turns": max_turns,
                "error": error,
            },
        }),
    )
    .await?;
    if matches!(status, "idle" | "paused" | "done" | "error") {
        let message = [
            "A worker run reached a terminal state and emitted a durable lifecycle handoff.",
            "Review the latest worker lifecycle handoff, then report the outcome, evidence readiness, and whether the operator needs to act.",
            "Do not start or continue another worker run unless the operator explicitly authorized it.",
        ]
        .join(" ");
        if let Err(error) = crate::gardener_runtime::run_gardener_message(
            state,
            &gardener_thread_id,
            &worker_session.id,
            &message,
            "worker_run_terminal",
        )
        .await
        {
            tracing::warn!(
                "gardener pass failed after terminal worker status for {}: {error}",
                worker_session.id,
            );
        }
    }
    Ok(())
}

fn worker_run_state_label(state: &WorkerRunState) -> &'static str {
    match state {
        WorkerRunState::Running => "running",
        WorkerRunState::Paused => "paused",
        WorkerRunState::Idle => "idle",
        WorkerRunState::Done => "done",
        WorkerRunState::Blocked => "blocked",
        WorkerRunState::Error => "error",
    }
}

fn with_segment_payload(payload: Value, session: &StackLocalSession) -> Value {
    let mut payload = payload;
    payload["meta_thread_id"] = json!(session.meta_thread_id);
    payload["segment_id"] = json!(session.segment_id);
    payload
}

fn event_id(event_type: &str) -> String {
    format!(
        "{}_{}",
        event_type.replace('.', "_"),
        Utc::now().timestamp_nanos_opt().unwrap_or_default()
    )
}

fn unique_worker_suffix() -> String {
    format!(
        "{}_{}",
        Utc::now().timestamp_nanos_opt().unwrap_or_default(),
        std::process::id()
    )
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn first_non_empty(left: &str, right: &str) -> String {
    if !left.trim().is_empty() {
        left.to_string()
    } else {
        right.to_string()
    }
}

fn bounded_tail(value: &str, max_chars: usize) -> String {
    let char_count = value.chars().count();
    if char_count <= max_chars {
        return value.trim().to_string();
    }
    let tail = value
        .chars()
        .skip(char_count.saturating_sub(max_chars))
        .collect::<String>();
    format!("…[truncated]\n{}", tail.trim())
}

fn truncate(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut truncated = value
        .chars()
        .take(max_chars.saturating_sub(15))
        .collect::<String>();
    truncated.push_str("...(truncated)");
    truncated
}

fn redact_text(value: &str) -> String {
    let mut redacted = value.to_string();
    for marker in [
        "api_key=",
        "apikey=",
        "secret=",
        "token=",
        "password=",
        "sk-",
        "synth_",
    ] {
        if redacted.to_ascii_lowercase().contains(marker) {
            redacted = "[REDACTED]".to_string();
            break;
        }
    }
    redacted
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
        if let Ok(Some(record)) = store.load_snapshot_record() {
            return Some(runtime_status_projection(
                &record.snapshot,
                record.events_appended,
            ));
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
