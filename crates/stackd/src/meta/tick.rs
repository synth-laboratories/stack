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
    let summaries = list_summaries(&state.paths.session_log_dir).await?;
    for summary in summaries.iter().take(64) {
        if is_archived(state, summary.meta_thread_id.as_deref()).await {
            continue;
        }
        if let Err(error) = queue_gardener_triggers(state, &summary.id).await {
            tracing::warn!("meta tick gardener queue failed for {}: {error}", summary.id);
        }
    }
    let status = build_status(state).await?;
    write_status_projection(state, &status).await?;
    Ok(status)
}

async fn build_status(state: &AppState) -> anyhow::Result<MetaStatus> {
    let summaries = list_summaries(&state.paths.session_log_dir).await?;
    let mut threads = Vec::new();
    for summary in summaries.into_iter().take(64) {
        if is_archived(state, summary.meta_thread_id.as_deref()).await {
            continue;
        }
        let events = match read_thread_events(&state.paths.stack_dir, &summary.id).await {
            Ok(events) => events,
            Err(error) => {
                tracing::warn!("meta status skipping unreadable thread {}: {error}", summary.id);
                continue;
            }
        };
        if events.is_empty() {
            continue;
        }
        let actor_states = read_actor_states(state, &summary.id).await;
        threads.push(reduce_thread(
            &summary.id,
            summary.meta_thread_id.as_deref(),
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
/// gardener owns — a monitor handoff request or an operator gardener-chat message —
/// that no prior gardener queue/wake has consumed. The gardener pass itself runs TS-side.
async fn queue_gardener_triggers(state: &AppState, thread_id: &str) -> anyhow::Result<()> {
    let Ok(events) = read_thread_events(&state.paths.stack_dir, thread_id).await else {
        return Ok(());
    };
    if events.is_empty() {
        return Ok(());
    }
    let actor_id = "gardener_default";
    let queued: std::collections::HashSet<String> =
        stack_core::actor_runtime::triggered_event_ids(&events, ActorRole::Gardener, actor_id)
            .into_iter()
            .collect();
    let pending: Vec<&Value> = events
        .iter()
        .filter(|event| {
            matches!(
                event_type(event),
                Some("monitor.handoff_requested" | "gardener.chat_message")
            )
        })
        .filter(|event| {
            // chat messages authored by the gardener itself are replies, not wake sources
            event_type(event) != Some("gardener.chat_message")
                || event.get("actor_role").and_then(Value::as_str) != Some("gardener")
        })
        .filter(|event| event_id(event).is_some_and(|id| !queued.contains(id)))
        .collect();
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
    ensure_gardener_actor_state(state, thread_id, actor_id).await?;
    Ok(())
}

/// Seed the durable gardener actor state on first queue so the reducer lists the
/// actor; the cursor stays unset until a gardener pass records completion.
async fn ensure_gardener_actor_state(
    state: &AppState,
    thread_id: &str,
    actor_id: &str,
) -> anyhow::Result<()> {
    let dir = thread_actor_dir_path(&state.paths.stack_dir, thread_id, ActorRole::Gardener)?;
    let path = dir.join(format!("{actor_id}.json"));
    if fs::try_exists(&path).await.unwrap_or(false) {
        return Ok(());
    }
    fs::create_dir_all(&dir).await?;
    let actor = json!({
        "schema": ActorRole::Gardener.state_schema(),
        "thread_id": thread_id,
        "actor_id": actor_id,
        "state": "idle",
        "wake_counts": 0,
        "queue_counts": 0,
    });
    fs::write(&path, format!("{}\n", serde_json::to_string_pretty(&actor)?)).await?;
    Ok(())
}

async fn write_status_projection(state: &AppState, status: &MetaStatus) -> anyhow::Result<()> {
    let dir = state.paths.stack_dir.join("meta");
    fs::create_dir_all(&dir).await?;
    let path = dir.join("status.json");
    fs::write(&path, format!("{}\n", serde_json::to_string_pretty(status)?)).await?;
    Ok(())
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
