pub mod reducer;
pub mod scheduler;
pub mod sensors;
pub mod store;

use crate::server::AppState;
use anyhow::Context;
use serde_json::json;
use stack_core::runtime_state::FactorySnapshot;
use std::sync::Arc;

pub async fn tick_runtime(state: Arc<AppState>) -> anyhow::Result<FactorySnapshot> {
    let store = store::RuntimeStore::open(&state.paths).context("open runtime store")?;
    let mut drafts = Vec::new();

    let local_cursor = store.load_cursor("sensor.local_gepa")?;
    let local = sensors::local_gepa::poll(&state.http_client, local_cursor).await;
    drafts.extend(local.events);
    store.save_cursor("sensor.local_gepa", &local.cursor)?;

    let remote_cursor = store.load_cursor("sensor.remote_synth")?;
    let remote = sensors::remote_synth::poll(&state.http_client, remote_cursor).await;
    drafts.extend(remote.events);
    store.save_cursor("sensor.remote_synth", &remote.cursor)?;

    let appended = store.append_events(&drafts)?;
    let events = store.load_events(None, 10_000, None)?;
    let snapshot = reducer::reduce(&events);
    store.save_snapshot(&snapshot)?;
    store.write_status_projection(&snapshot, appended.len())?;
    Ok(snapshot)
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
