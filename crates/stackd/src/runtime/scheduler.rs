use crate::runtime;
use crate::server::AppState;
use std::sync::Arc;
use tokio::time::{Duration, MissedTickBehavior};

pub fn spawn_runtime_scheduler(state: Arc<AppState>) {
    if std::env::var("STACKD_RUNTIME_SCHEDULER").ok().as_deref() == Some("0") {
        tracing::info!("stackd runtime scheduler disabled via STACKD_RUNTIME_SCHEDULER=0");
        return;
    }
    tokio::spawn(async move {
        let interval_ms = runtime_poll_ms();
        let mut interval = tokio::time::interval(Duration::from_millis(interval_ms));
        interval.set_missed_tick_behavior(MissedTickBehavior::Delay);
        loop {
            interval.tick().await;
            if let Err(error) = runtime::tick_runtime(state.clone()).await {
                tracing::warn!("runtime tick failed: {error:#}");
            }
        }
    });
}

fn runtime_poll_ms() -> u64 {
    std::env::var("STACKD_RUNTIME_POLL_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(2_000)
        .clamp(500, 30_000)
}
