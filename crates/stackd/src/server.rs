use crate::handlers::{
    checkpoints, export, health, logs, mcp, meta_threads, runtime, skills, telemetry, threads,
};
use crate::mcp_sidecar::McpSidecar;
use crate::monitor_scheduler;
use crate::openapi;
use crate::runtime::scheduler;
use axum::{
    routing::{any, get, patch, post},
    Router,
};
use stack_core::config::StackPaths;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::Mutex;

#[derive(Debug)]
pub struct AppState {
    pub paths: StackPaths,
    pub stack_version: Option<String>,
    pub stack_channel: Option<String>,
    pub public_base_url: String,
    pub mcp_url: Option<String>,
    pub mcp_sidecar: Option<McpSidecar>,
    pub http_client: reqwest::Client,
    pub runtime_write_lock: Mutex<()>,
}

pub async fn serve(addr: SocketAddr) -> anyhow::Result<()> {
    let paths = StackPaths::from_env()?;
    let public_base_url = format!("http://{}:{}", addr.ip(), addr.port());
    let mcp_sidecar = spawn_mcp_sidecar(&paths.app_root, addr.ip(), addr.port()).await;
    let mcp_url = mcp_sidecar
        .as_ref()
        .map(|_| format!("{public_base_url}/mcp"));
    if mcp_url.is_some() {
        tracing::info!(
            "stackd MCP available at {}",
            mcp_url.as_deref().unwrap_or("/mcp")
        );
    } else {
        tracing::warn!("stackd started without live MCP HTTP sidecar");
    }

    let state = Arc::new(AppState {
        stack_version: read_version_field(&paths.app_root, "version").await,
        stack_channel: read_version_field(&paths.app_root, "channel").await,
        paths,
        public_base_url,
        mcp_url,
        mcp_sidecar,
        http_client: reqwest::Client::new(),
        runtime_write_lock: Mutex::new(()),
    });

    if let Err(error) = stack_core::seed::ensure_stack_defaults(&state.paths) {
        tracing::warn!("stack defaults seed failed: {error:#}");
    }

    if let Err(error) = stack_core::skills::ensure_skills_runtime(&state.paths) {
        tracing::warn!("skills bootstrap failed: {error:#}");
    } else {
        tracing::info!("stackd skills registry ready");
    }

    monitor_scheduler::spawn_monitor_scheduler(state.clone());
    scheduler::spawn_runtime_scheduler(state.clone());

    let app = router(state);
    let listener = TcpListener::bind(addr).await?;
    tracing::info!("stackd listening on http://{}", listener.local_addr()?);
    axum::serve(listener, app).await?;
    Ok(())
}

async fn spawn_mcp_sidecar(
    app_root: &std::path::Path,
    bind: std::net::IpAddr,
    api_port: u16,
) -> Option<McpSidecar> {
    if std::env::var("STACKD_MCP").ok().as_deref() == Some("0") {
        tracing::info!("stackd MCP sidecar disabled via STACKD_MCP=0");
        return None;
    }

    let sidecar_port = std::env::var("STACK_MCP_HTTP_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(api_port.saturating_add(1));

    match McpSidecar::spawn(app_root, bind, sidecar_port).await {
        Ok(sidecar) => Some(sidecar),
        Err(error) => {
            tracing::warn!("failed to start Stack MCP HTTP sidecar: {error:#}");
            None
        }
    }
}

fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(health::health))
        .route("/status", get(threads::get_stack_status))
        .route("/runtime/factory", get(runtime::get_runtime_factory))
        .route(
            "/runtime/events",
            get(runtime::get_runtime_events).post(runtime::post_runtime_event),
        )
        .route("/runtime/tick", post(runtime::post_runtime_tick))
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
        .route("/telemetry/status", get(telemetry::telemetry_status))
        .route("/telemetry/events", post(telemetry::record_telemetry_event))
        .route(
            "/telemetry/crashes",
            get(telemetry::list_crash_reports).post(telemetry::record_crash_report),
        )
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
        .route("/threads/:id/resume", get(checkpoints::get_thread_resume))
        .route(
            "/threads/:id/checkpoint",
            axum::routing::put(checkpoints::save_thread_checkpoint),
        )
        .route("/threads/:id/export", get(export::export_thread))
        .route("/checkpoints/latest", get(checkpoints::get_latest_checkpoint))
        .route("/checkpoints/resolve", get(checkpoints::resolve_checkpoint_handler))
        .route("/checkpoints", axum::routing::post(checkpoints::save_checkpoint))
        .route(
            "/meta-threads",
            get(meta_threads::list_meta_threads).post(meta_threads::create_meta_thread),
        )
        .route("/meta-threads/:id", get(meta_threads::get_meta_thread))
        .route("/meta-threads/:id/title", patch(meta_threads::update_title))
        .route(
            "/meta-threads/:id/lifecycle",
            patch(meta_threads::update_lifecycle),
        )
        .route("/meta-threads/:id/resume", get(checkpoints::get_meta_thread_resume))
        .route(
            "/meta-threads/:id/checkpoint",
            axum::routing::put(checkpoints::save_meta_thread_checkpoint),
        )
        .route("/meta-threads/:id/goal", patch(meta_threads::update_goal))
        .route(
            "/meta-threads/:id/handoffs/:handoff_id",
            get(meta_threads::get_handoff),
        )
        .route(
            "/meta-threads/:id/segments/:segment_id/seal",
            post(meta_threads::seal_segment),
        )
        .route(
            "/meta-threads/:id/artifacts/:artifact_id/approve",
            post(meta_threads::approve_artifact),
        )
        .route(
            "/meta-threads/:id/handoff/continue",
            post(meta_threads::continue_handoff),
        )
        .route(
            "/skills",
            get(skills::list_skills_handler).post(skills::register_skill_handler),
        )
        .route("/skills/search", get(skills::search_skills_handler))
        .route("/skills/bootstrap", post(skills::bootstrap_skills_handler))
        .route("/skills/:id", get(skills::get_skill_handler))
        .route("/mcp", any(mcp::proxy_mcp))
        .route("/mcp/*path", any(mcp::proxy_mcp))
        .route("/.well-known/mcp.json", get(mcp::well_known_mcp))
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
