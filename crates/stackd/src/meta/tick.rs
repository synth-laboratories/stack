//! One MetaHarness tick: load cursors → run actor schedulers (trigger producers
//! only — pass consumers stay TS) → reduce every live thread → write the
//! `.stack/meta/status.json` projection. Ticks are serialized by a write lock so
//! overlapping requests and the background scheduler cannot interleave appends.

use crate::meta::reducer::{reduce_thread, MetaThreadSnapshot};
use crate::server::AppState;
use crate::victorialogs::append_thread_event_projected;
use chrono::Utc;
use serde::Serialize;
use serde_json::{json, Value};
use stack_core::actor_runtime::{event_id, event_type, thread_actor_dir_path, ActorRole};
use stack_core::events::read_thread_events;
use stack_core::meta_thread::{manifest_is_archived, read_manifest};
use stack_core::session::list_summaries;
use std::collections::HashSet;
use tokio::fs;

#[derive(Debug, Serialize)]
pub struct MetaStatus {
    pub schema: &'static str,
    pub generated_at: String,
    pub threads: Vec<MetaThreadSnapshot>,
}

/// Reduce all live threads without producing triggers (GET /meta/status).
pub async fn read_meta_status(state: &AppState) -> anyhow::Result<MetaStatus> {
    build_status(state).await
}

/// One full tick (POST /meta/tick): produce triggers, then reduce and persist.
pub async fn run_meta_tick(state: &AppState) -> anyhow::Result<MetaStatus> {
    let _guard = state.meta_tick_lock.lock().await;
    let candidates = status_thread_candidates(state).await?;
    for candidate in candidates.iter().take(64) {
        if is_archived(state, candidate.meta_thread_id.as_deref()).await {
            continue;
        }
        if let Err(error) = queue_gardener_triggers(state, &candidate.thread_id).await {
            tracing::warn!(
                "meta tick gardener queue failed for {}: {error}",
                candidate.thread_id
            );
        }
    }
    let status = build_status(state).await?;
    write_status_projection(state, &status).await?;
    Ok(status)
}

async fn build_status(state: &AppState) -> anyhow::Result<MetaStatus> {
    let candidates = status_thread_candidates(state).await?;
    let mut threads = Vec::new();
    for candidate in candidates.into_iter().take(64) {
        if is_archived(state, candidate.meta_thread_id.as_deref()).await {
            continue;
        }
        let events = match read_thread_events(&state.paths.stack_dir, &candidate.thread_id).await {
            Ok(events) => events,
            Err(error) => {
                tracing::warn!(
                    "meta status skipping unreadable thread {}: {error}",
                    candidate.thread_id
                );
                continue;
            }
        };
        if events.is_empty() {
            continue;
        }
        let actor_states = read_actor_states(state, &candidate.thread_id).await;
        threads.push(reduce_thread(
            &candidate.thread_id,
            candidate.meta_thread_id.as_deref(),
            &events,
            &actor_states,
        ));
    }
    Ok(MetaStatus {
        schema: "stack/meta-status/v1",
        generated_at: now(),
        threads,
    })
}

struct StatusThreadCandidate {
    thread_id: String,
    meta_thread_id: Option<String>,
}

async fn status_thread_candidates(state: &AppState) -> anyhow::Result<Vec<StatusThreadCandidate>> {
    let summaries = list_summaries(&state.paths.session_log_dir).await?;
    let mut seen = HashSet::new();
    let mut candidates = Vec::new();
    for summary in summaries {
        seen.insert(summary.id.clone());
        candidates.push(StatusThreadCandidate {
            thread_id: summary.id,
            meta_thread_id: summary.meta_thread_id,
        });
    }

    let event_dir = state.paths.stack_dir.join("events").join("threads");
    let mut entries = match fs::read_dir(&event_dir).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(candidates),
        Err(error) => return Err(error.into()),
    };
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|value| value.to_str()) else {
            continue;
        };
        if seen.insert(stem.to_string()) {
            candidates.push(StatusThreadCandidate {
                thread_id: stem.to_string(),
                meta_thread_id: None,
            });
        }
    }
    Ok(candidates)
}

async fn is_archived(state: &AppState, meta_thread_id: Option<&str>) -> bool {
    let Some(meta_thread_id) = meta_thread_id else {
        return false;
    };
    match read_manifest(&state.paths.stack_dir, meta_thread_id).await {
        Ok(manifest) => manifest_is_archived(&manifest),
        Err(_) => false,
    }
}

async fn read_actor_states(state: &AppState, thread_id: &str) -> Vec<(ActorRole, Value)> {
    let mut states = Vec::new();
    for role in ActorRole::all() {
        let Ok(dir) = thread_actor_dir_path(&state.paths.stack_dir, thread_id, role) else {
            continue;
        };
        let Ok(mut entries) = fs::read_dir(&dir).await else {
            continue;
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            if entry.path().extension().and_then(|ext| ext.to_str()) != Some("json") {
                continue;
            }
            if let Ok(text) = fs::read_to_string(entry.path()).await {
                if let Ok(value) = serde_json::from_str::<Value>(&text) {
                    states.push((role, value));
                }
            }
        }
    }
    states
}

/// Gardener trigger producer: queue a `gardener.trigger_queued` for wake sources the
/// gardener owns — a monitor handoff request, an operator gardener-chat message,
/// or a terminal worker-run receipt —
/// that no prior gardener queue/wake has consumed. The gardener pass itself runs TS-side.
async fn queue_gardener_triggers(state: &AppState, thread_id: &str) -> anyhow::Result<()> {
    let Ok(events) = read_thread_events(&state.paths.stack_dir, thread_id).await else {
        return Ok(());
    };
    if events.is_empty() {
        return Ok(());
    }
    let actor_id = "gardener_default";
    let actor_path = thread_actor_dir_path(&state.paths.stack_dir, thread_id, ActorRole::Gardener)?
        .join(format!("{actor_id}.json"));
    let actor = read_actor_state(&actor_path).await;
    let cursor = actor
        .as_ref()
        .and_then(|value| value.get("last_event_id"))
        .and_then(Value::as_str);
    let queued: std::collections::HashSet<String> =
        stack_core::actor_runtime::triggered_event_ids(&events, ActorRole::Gardener, actor_id)
            .into_iter()
            .collect();
    let prior_trigger_index = cursor
        .is_none()
        .then(|| {
            events
                .iter()
                .rposition(|event| event_id(event).is_some_and(|id| queued.contains(id)))
        })
        .flatten();
    let cursor_index = cursor
        .and_then(|id| events.iter().position(|event| event_id(event) == Some(id)))
        .or(prior_trigger_index)
        .map(|index| index + 1)
        .unwrap_or(0);
    let mut pending: Vec<&Value> = events
        .iter()
        .skip(cursor_index)
        .filter(|event| {
            matches!(
                event_type(event),
                Some(
                    "monitor.handoff_requested"
                        | "gardener.chat_message"
                        | "gardener.message"
                        | "gardener.worker_run_status"
                )
            )
        })
        .filter(|event| {
            // chat messages authored by the gardener itself are replies, not wake sources
            event_type(event) != Some("gardener.chat_message")
                || event.get("actor_role").and_then(Value::as_str) != Some("gardener")
        })
        .filter(|event| {
            event_type(event) != Some("gardener.message")
                || event
                    .get("payload")
                    .and_then(|payload| payload.get("role"))
                    .and_then(Value::as_str)
                    == Some("user")
        })
        .filter(|event| {
            event_type(event) != Some("gardener.worker_run_status")
                || matches!(
                    event
                        .get("payload")
                        .and_then(|payload| payload.get("status"))
                        .and_then(Value::as_str),
                    Some("idle" | "paused" | "done" | "error")
                )
        })
        .filter(|event| event_id(event).is_some_and(|id| !queued.contains(id)))
        .collect();
    let bootstrap_cursor = if cursor.is_none() && prior_trigger_index.is_none() {
        let Some(latest) = pending.pop() else {
            return Ok(());
        };
        let latest_index = events
            .iter()
            .position(|event| std::ptr::eq(event, latest))
            .unwrap_or(0);
        pending.clear();
        pending.push(latest);
        events[..latest_index].iter().rev().find_map(event_id)
    } else if cursor.is_none() {
        prior_trigger_index.and_then(|index| event_id(&events[index]))
    } else {
        None
    };
    if pending.is_empty() {
        return Ok(());
    }
    let trigger_ids: Vec<String> = pending
        .iter()
        .filter_map(|event| event_id(event).map(str::to_string))
        .collect();
    let reason = if pending
        .iter()
        .any(|event| event_type(event) == Some("monitor.handoff_requested"))
    {
        "handoff_requested"
    } else if pending
        .iter()
        .any(|event| event_type(event) == Some("gardener.worker_run_status"))
    {
        "worker_run_terminal"
    } else {
        "operator_chat"
    };
    append_thread_event_projected(
        &state.paths.stack_dir,
        thread_id,
        &json!({
            "event_id": format!("gardener_trigger_queued_{}", Utc::now().timestamp_nanos_opt().unwrap_or_default()),
            "type": "gardener.trigger_queued",
            "thread_id": thread_id,
            "observed_at": now(),
            "actor_id": actor_id,
            "actor_role": "gardener",
            "payload": {
                "wake_reason": reason,
                "trigger_event_ids": trigger_ids,
                "queued_for": "gardener-pass",
                "source": "stackd-runtime"
            }
        }),
    )
    .await?;
    ensure_gardener_actor_state(state, thread_id, actor_id, bootstrap_cursor).await?;
    Ok(())
}

/// Seed the durable gardener actor state on first queue so the reducer lists the
/// actor. The bootstrap cursor excludes historical wake sources while leaving the
/// newest source pending for the first pass.
async fn ensure_gardener_actor_state(
    state: &AppState,
    thread_id: &str,
    actor_id: &str,
    bootstrap_cursor: Option<&str>,
) -> anyhow::Result<()> {
    let dir = thread_actor_dir_path(&state.paths.stack_dir, thread_id, ActorRole::Gardener)?;
    let path = dir.join(format!("{actor_id}.json"));
    fs::create_dir_all(&dir).await?;
    let mut actor = match fs::read_to_string(&path).await {
        Ok(text) => serde_json::from_str::<Value>(&text)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => json!({
            "schema": ActorRole::Gardener.state_schema(),
            "thread_id": thread_id,
            "actor_id": actor_id,
            "state": "idle",
            "wake_counts": 0,
            "queue_counts": 0,
        }),
        Err(error) => return Err(error.into()),
    };
    if actor.get("last_event_id").and_then(Value::as_str).is_none() {
        if let Some(cursor) = bootstrap_cursor {
            actor["last_event_id"] = json!(cursor);
        }
    }
    fs::write(
        &path,
        format!("{}\n", serde_json::to_string_pretty(&actor)?),
    )
    .await?;
    Ok(())
}

async fn read_actor_state(path: &std::path::Path) -> Option<Value> {
    let text = fs::read_to_string(path).await.ok()?;
    serde_json::from_str(&text).ok()
}

async fn write_status_projection(state: &AppState, status: &MetaStatus) -> anyhow::Result<()> {
    let dir = state.paths.stack_dir.join("meta");
    fs::create_dir_all(&dir).await?;
    let path = dir.join("status.json");
    fs::write(
        &path,
        format!("{}\n", serde_json::to_string_pretty(status)?),
    )
    .await?;
    Ok(())
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
