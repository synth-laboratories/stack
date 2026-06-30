pub mod reducer;
pub mod scheduler;
pub mod sensors;
pub mod store;

use crate::server::AppState;
use anyhow::Context;
use serde_json::json;
use stack_core::runtime_state::FactorySnapshot;
use std::sync::Arc;

pub struct RuntimeTickResult {
    pub snapshot: FactorySnapshot,
    pub events_appended: usize,
}

pub async fn tick_runtime(state: Arc<AppState>) -> anyhow::Result<RuntimeTickResult> {
    let _write_guard = state.runtime_write_lock.lock().await;
    let store = store::RuntimeStore::open(&state.paths).context("open runtime store")?;
    let mut drafts = Vec::new();

    let local_cursor = store.load_cursor("sensor.local_gepa")?;
    let local = sensors::local_gepa::poll(&state.http_client, local_cursor).await;
    drafts.extend(local.events);

    let remote_cursor = store.load_cursor("sensor.remote_synth")?;
    let remote = sensors::remote_synth::poll(&state.http_client, remote_cursor, &state.paths).await;
    drafts.extend(remote.events);

    let appended = store.append_events(&drafts)?;
    let events = store.load_events_for_reduction()?;
    let snapshot = reducer::reduce(&events);
    store.save_snapshot(&snapshot, appended.len())?;
    store.write_status_projection(&snapshot, appended.len())?;
    store.save_cursor("sensor.local_gepa", &local.cursor)?;
    store.save_cursor("sensor.remote_synth", &remote.cursor)?;
    Ok(RuntimeTickResult {
        snapshot,
        events_appended: appended.len(),
    })
}

pub fn runtime_status_projection(
    snapshot: &FactorySnapshot,
    events_appended: usize,
) -> serde_json::Value {
    json!({
        "schema": "stack.runtime_status.v1",
        "updated_at": snapshot.updated_at,
        "events_appended": events_appended,
        "factory": snapshot,
    })
}
