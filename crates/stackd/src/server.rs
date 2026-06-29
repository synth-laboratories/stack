use crate::handlers::{export, health, logs, threads};
use crate::monitor_scheduler;
use crate::openapi;
use axum::{
    routing::{get, post},
    Router,
};
use stack_core::config::StackPaths;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;

#[derive(Debug, Clone)]
pub struct AppState {
    pub paths: StackPaths,
    pub stack_version: Option<String>,
    pub stack_channel: Option<String>,
}

pub async fn serve(addr: SocketAddr) -> anyhow::Result<()> {
    let paths = StackPaths::from_env()?;
    let state = Arc::new(AppState {
        stack_version: read_version_field(&paths.app_root, "version").await,
        stack_channel: read_version_field(&paths.app_root, "channel").await,
        paths,
    });
    monitor_scheduler::spawn_monitor_scheduler(state.clone());

    let app = router(state);
    let listener = TcpListener::bind(addr).await?;
    tracing::info!("stackd listening on http://{}", listener.local_addr()?);
    axum::serve(listener, app).await?;
    Ok(())
}

fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(health::health))
        .route("/status", get(threads::get_stack_status))
        .route("/threads", get(threads::list_threads))
        .route("/threads/:id", get(threads::get_thread))
        .route("/threads/:id/status", get(threads::get_status))
        .route(
            "/threads/:id/events",
            get(threads::get_events).post(threads::append_event),
        )
        .route("/threads/:id/actors", get(threads::get_actors))
        .route("/events/stream", get(threads::stream_events))
        .route("/logs/query", get(logs::query_logs_handler))
        .route(
            "/threads/:id/monitors/:monitor_id/pause",
            post(threads::pause_monitor),
        )
        .route(
            "/threads/:id/monitors/:monitor_id/resume",
            post(threads::resume_monitor),
        )
        .route(
            "/threads/:id/monitors/:monitor_id/mode",
            post(threads::set_monitor_mode),
        )
        .route("/threads/:id/trace", get(threads::get_trace))
        .route("/threads/:id/export", get(export::export_thread))
        .route("/doc", get(openapi::doc))
        .route("/openapi.json", get(openapi::doc))
        .with_state(state)
}

async fn read_version_field(app_root: &std::path::Path, field: &str) -> Option<String> {
    let path = app_root.join("version.json");
    let text = tokio::fs::read_to_string(path).await.ok()?;
    let value = serde_json::from_str::<serde_json::Value>(&text).ok()?;
    value
        .get(field)
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}
