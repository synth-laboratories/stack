use crate::server::AppState;
use crate::victorialogs::append_thread_event_projected;
use chrono::Utc;
use serde_json::{json, Value};
use stack_core::events::{read_thread_events, thread_monitor_actor_dir_path};
use stack_core::session::list_summaries;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::fs;
use topologies_core::{BudgetEnvelope, WorkflowScript};
use topologies_monty::{MontyHostContract, MontyPythonRunner};

#[derive(Debug, Clone)]
struct MonitorRuntimeConfig {
    actor_id: String,
    enabled: bool,
    strictness: String,
    focus_selection: String,
    model: String,
    reasoning_effort: String,
    max_wakes_per_primary_turn: u64,
    on_turn_completed: bool,
    on_tool_completed: bool,
    on_tool_failed: bool,
    delta_events: u64,
    cooldown_ms: u64,
    weight_threshold: f64,
    max_delay_ms: u64,
    turn_cooldown_ms: u64,
    batch_cooldown_ms: u64,
    wake_policy_script: Option<PathBuf>,
    monty_python_bin: String,
}

pub fn spawn_monitor_scheduler(state: Arc<AppState>) {
    if !scheduler_enabled() {
        tracing::info!("stackd monitor scheduler disabled");
        return;
    }
    tokio::spawn(async move {
        tracing::info!("stackd monitor scheduler started");
        let scheduler_started_at = now();
        loop {
            if let Err(error) = scheduler_tick(&state, &scheduler_started_at).await {
                tracing::warn!("stackd monitor scheduler tick failed: {error}");
            }
            tokio::time::sleep(Duration::from_millis(scheduler_poll_ms())).await;
        }
    });
}

async fn scheduler_tick(state: &AppState, scheduler_started_at: &str) -> anyhow::Result<()> {
    let config = read_monitor_config(state).await;
    if !config.enabled || config.strictness == "off" {
        return Ok(());
    }
    let summaries = list_summaries(&state.paths.session_log_dir).await?;
    for summary in summaries.into_iter().take(64) {
        process_thread(state, &config, &summary.id, scheduler_started_at).await?;
    }
    Ok(())
}

async fn process_thread(
    state: &AppState,
    config: &MonitorRuntimeConfig,
    thread_id: &str,
    scheduler_started_at: &str,
) -> anyhow::Result<()> {
    let events = read_thread_events(&state.paths.stack_dir, thread_id).await?;
    if events.is_empty() {
        return Ok(());
    }
    let actor_path = thread_monitor_actor_dir_path(&state.paths.stack_dir, thread_id)?
        .join(format!("{}.json", safe_segment(&config.actor_id)));
    let actor = read_actor_state(&actor_path).await;
    let effective_strictness = effective_strictness(config, &events, actor.as_ref());
    if effective_strictness == "off" {
        write_actor_state(
            &actor_path,
            config,
            thread_id,
            actor.as_ref(),
            ActorUpdate {
                state: Some("paused"),
                strictness: Some("off"),
                ..ActorUpdate::default()
            },
        )
        .await?;
        return Ok(());
    }

    let bootstrap_cursor = if actor.is_none() && !has_monitor_events(&events) {
        events
            .iter()
            .rposition(|event| {
                event
                    .get("observed_at")
                    .and_then(Value::as_str)
                    .is_some_and(|observed_at| observed_at < scheduler_started_at)
            })
            .and_then(|index| event_id(&events[index]).map(str::to_string))
    } else {
        None
    };
    let last_event_id = actor
        .as_ref()
        .and_then(|value| {
            value
                .get("last_event_id")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .or(bootstrap_cursor);
    let pending = events_after_cursor(&events, last_event_id.as_deref());
    if pending.is_empty() {
        if actor.is_none() && !has_monitor_events(&events) {
            let last_event = events.last();
            write_actor_state(
                &actor_path,
                config,
                thread_id,
                None,
                ActorUpdate {
                    state: Some("idle"),
                    strictness: Some(&effective_strictness),
                    last_event_id: last_event.and_then(event_id),
                    last_event_type: last_event.and_then(event_type),
                    ..ActorUpdate::default()
                },
            )
            .await?;
        }
        return Ok(());
    }
    let triggered = triggered_event_ids(&events, &config.actor_id);
    let Some(wake) =
        select_wake_candidate(state, config, actor.as_ref(), &pending, &triggered).await
    else {
        return Ok(());
    };

    queue_monitor_trigger(
        state,
        config,
        thread_id,
        actor_path,
        actor.as_ref(),
        pending,
        wake.triggers,
        wake.reason,
        effective_strictness,
    )
    .await
}

struct WakeSelection<'a> {
    reason: String,
    triggers: Vec<&'a Value>,
}

async fn select_wake_candidate<'a>(
    state: &AppState,
    config: &MonitorRuntimeConfig,
    actor: Option<&Value>,
    pending: &[&'a Value],
    triggered: &HashSet<String>,
) -> Option<WakeSelection<'a>> {
    if let Some(script_path) = &config.wake_policy_script {
        match select_monty_wake_candidate(state, config, actor, pending, triggered, script_path)
            .await
        {
            Ok(Some(selection)) => return Some(selection),
            Ok(None) => return None,
            Err(error) => {
                tracing::warn!(
                    "stackd monitor wake policy failed; using legacy trigger policy: {error}"
                );
            }
        }
    }

    let triggers: Vec<&Value> = pending
        .iter()
        .copied()
        .filter(|event| is_trigger_event(config, event))
        .filter(|event| event_id(event).is_some_and(|id| !triggered.contains(id)))
        .collect();
    if triggers.is_empty() {
        return None;
    }
    Some(WakeSelection {
        reason: wake_reason(triggers.first().copied()).to_string(),
        triggers,
    })
}

async fn select_monty_wake_candidate<'a>(
    state: &AppState,
    config: &MonitorRuntimeConfig,
    actor: Option<&Value>,
    pending: &[&'a Value],
    triggered: &HashSet<String>,
    script_path: &PathBuf,
) -> anyhow::Result<Option<WakeSelection<'a>>> {
    let source = fs::read_to_string(script_path).await?;
    let script = WorkflowScript::monty(source)?;
    let contract = MontyHostContract::default_for_script(script, BudgetEnvelope::default());
    let args = json!({
        "thread_stack_root": state.paths.stack_dir.to_string_lossy(),
        "monitor_actor_id": config.actor_id,
        "actor_state": actor,
        "pending_events": pending,
        "triggered_event_ids": triggered.iter().collect::<Vec<_>>(),
        "now_ms": Utc::now().timestamp_millis(),
        "wake": {
            "on_turn_completed": config.on_turn_completed,
            "on_tool_completed": config.on_tool_completed,
            "on_tool_failed": config.on_tool_failed,
            "delta_events": config.delta_events,
            "cooldown_ms": config.cooldown_ms,
            "weight_threshold": config.weight_threshold,
            "max_delay_ms": config.max_delay_ms,
            "turn_cooldown_ms": config.turn_cooldown_ms,
            "batch_cooldown_ms": config.batch_cooldown_ms,
        },
    });
    let runner = MontyPythonRunner::new(&config.monty_python_bin);
    let execution = tokio::task::spawn_blocking(move || runner.execute(&contract, args)).await??;
    let result = execution.result;
    if result.get("wake").and_then(Value::as_bool) != Some(true) {
        return Ok(None);
    }
    let trigger_ids: HashSet<&str> = result
        .get("trigger_event_ids")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    if trigger_ids.is_empty() {
        return Ok(None);
    }
    let triggers: Vec<&Value> = pending
        .iter()
        .copied()
        .filter(|event| event_id(event).is_some_and(|id| trigger_ids.contains(id)))
        .collect();
    if triggers.is_empty() {
        return Ok(None);
    }
    let reason = result
        .get("reason")
        .and_then(Value::as_str)
        .unwrap_or_else(|| wake_reason(triggers.first().copied()))
        .to_string();
    Ok(Some(WakeSelection { reason, triggers }))
}

async fn queue_monitor_trigger(
    state: &AppState,
    config: &MonitorRuntimeConfig,
    thread_id: &str,
    actor_path: std::path::PathBuf,
    actor: Option<&Value>,
    pending: Vec<&Value>,
    triggers: Vec<&Value>,
    reason: String,
    strictness: String,
) -> anyhow::Result<()> {
    let queued_at = now();
    write_actor_state(
        &actor_path,
        config,
        thread_id,
        actor,
        ActorUpdate {
            state: Some(
                actor
                    .and_then(|value| value.get("state"))
                    .and_then(Value::as_str)
                    .unwrap_or("idle"),
            ),
            strictness: Some(&strictness),
            ..ActorUpdate::default()
        },
    )
    .await?;

    let queue_id = format!(
        "monitor_trigger_queued_{}",
        Utc::now().timestamp_nanos_opt().unwrap_or_default()
    );
    let trigger_ids: Vec<String> = triggers
        .iter()
        .filter_map(|event| event_id(event).map(str::to_string))
        .collect();
    append_thread_event_projected(
        &state.paths.stack_dir,
        thread_id,
        &json!({
            "event_id": queue_id,
            "type": "monitor.trigger_queued",
            "thread_id": thread_id,
            "observed_at": queued_at,
            "actor_id": config.actor_id,
            "actor_role": "monitor",
            "payload": {
                "wake_reason": &reason,
                "trigger_event_ids": trigger_ids,
                "pending_event_count": pending.len(),
                "strictness": strictness,
                "focus_selection": config.focus_selection,
                "queued_for": "codex-app-server",
                "source": "stackd-runtime"
            }
        }),
    )
    .await?;
    Ok(())
}

#[derive(Default)]
struct ActorUpdate<'a> {
    state: Option<&'a str>,
    strictness: Option<&'a str>,
    last_event_id: Option<&'a str>,
    last_event_type: Option<&'a str>,
    last_wake_id: Option<&'a str>,
    monitor_thread_id: Option<&'a str>,
    rolling_summary: Option<&'a str>,
    last_severity: Option<&'a str>,
    wake_delta: u64,
    queue_delta: u64,
    context_push_delta: u64,
    last_started_at: Option<&'a str>,
    last_completed_at: Option<&'a str>,
}

async fn write_actor_state(
    path: &std::path::Path,
    config: &MonitorRuntimeConfig,
    thread_id: &str,
    previous: Option<&Value>,
    update: ActorUpdate<'_>,
) -> anyhow::Result<()> {
    let mut actor = previous.cloned().unwrap_or_else(|| {
        json!({
            "schema": "stack/monitor-actor-state/v1",
            "thread_id": thread_id,
            "monitor_actor_id": config.actor_id,
            "wake_counts": 0,
            "queue_counts": 0,
            "steer_counts": 0,
            "skill_read_counts": 0,
            "context_push_counts": 0
        })
    });
    actor["thread_id"] = json!(thread_id);
    actor["monitor_actor_id"] = json!(config.actor_id);
    actor["state"] = json!(update
        .state
        .unwrap_or_else(|| actor.get("state").and_then(Value::as_str).unwrap_or("idle")));
    let strictness = update.strictness.unwrap_or(&config.strictness);
    actor["mode"] = json!(strictness);
    actor["strictness"] = json!(strictness);
    actor["focus_selection"] = json!(config.focus_selection);
    actor["focus"] = json!({
        "style": true,
        "goal_progress": true,
        "skills": true,
        "tool_use": true,
        "scope_control": true,
        "acceptance": true
    });
    actor["budgets"] = json!({ "max_wakes_per_primary_turn": config.max_wakes_per_primary_turn });
    actor["model"] = json!({
        "provider": "openai",
        "model": config.model,
        "reasoning_effort": config.reasoning_effort
    });
    if let Some(value) = update.last_event_id {
        actor["last_event_id"] = json!(value);
    }
    if let Some(value) = update.last_event_type {
        actor["last_event_type"] = json!(value);
    }
    if let Some(value) = update.last_wake_id {
        actor["last_wake_id"] = json!(value);
    }
    if let Some(value) = update.monitor_thread_id {
        actor["monitor_thread_id"] = json!(value);
    }
    if let Some(value) = update.rolling_summary {
        actor["rolling_summary"] = json!(value);
    }
    if let Some(value) = update.last_severity {
        actor["last_severity"] = json!(value);
    }
    if let Some(value) = update.last_started_at {
        actor["last_started_at"] = json!(value);
    }
    if let Some(value) = update.last_completed_at {
        actor["last_completed_at"] = json!(value);
    }
    actor["wake_counts"] = json!(
        actor
            .get("wake_counts")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            + update.wake_delta
    );
    actor["queue_counts"] = json!(
        actor
            .get("queue_counts")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            + update.queue_delta
    );
    actor["steer_counts"] = json!(actor
        .get("steer_counts")
        .and_then(Value::as_u64)
        .unwrap_or(0));
    actor["skill_read_counts"] = json!(actor
        .get("skill_read_counts")
        .and_then(Value::as_u64)
        .unwrap_or(0));
    actor["context_push_counts"] = json!(
        actor
            .get("context_push_counts")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            + update.context_push_delta
    );

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    fs::write(path, format!("{}\n", serde_json::to_string_pretty(&actor)?)).await?;
    Ok(())
}

async fn read_actor_state(path: &std::path::Path) -> Option<Value> {
    let text = fs::read_to_string(path).await.ok()?;
    serde_json::from_str::<Value>(&text).ok()
}

async fn read_monitor_config(state: &AppState) -> MonitorRuntimeConfig {
    let profile = std::env::var("STACK_MONITOR_PROFILE").unwrap_or_else(|_| "default".to_string());
    let path = state
        .paths
        .app_root
        .join(".stack")
        .join("monitors")
        .join(format!("{profile}.toml"));
    let text = fs::read_to_string(path).await.unwrap_or_default();
    let id = toml_string(&text, "monitor", "id").unwrap_or(profile);
    MonitorRuntimeConfig {
        actor_id: format!("monitor_{id}"),
        enabled: toml_bool(&text, "monitor", "enabled").unwrap_or(true),
        strictness: std::env::var("STACK_MONITOR_STRICTNESS")
            .ok()
            .or_else(|| toml_string(&text, "monitor", "strictness"))
            .unwrap_or_else(|| "conservative".to_string()),
        focus_selection: toml_string(&text, "focus", "selection")
            .unwrap_or_else(|| "any".to_string()),
        model: toml_string(&text, "model", "model").unwrap_or_else(|| "gpt-5.4-mini".to_string()),
        reasoning_effort: toml_string(&text, "model", "reasoning_effort")
            .unwrap_or_else(|| "medium".to_string()),
        max_wakes_per_primary_turn: toml_u64(&text, "wake", "max_wakes_per_primary_turn")
            .unwrap_or(6),
        on_turn_completed: toml_bool(&text, "wake", "on_turn_completed").unwrap_or(true),
        on_tool_completed: toml_bool(&text, "wake", "on_tool_completed").unwrap_or(true),
        on_tool_failed: toml_bool(&text, "wake", "on_tool_failed").unwrap_or(true),
        delta_events: toml_u64(&text, "wake", "delta_events").unwrap_or(12),
        cooldown_ms: toml_u64(&text, "wake", "cooldown_ms").unwrap_or(250),
        weight_threshold: toml_f64(&text, "wake", "weight_threshold")
            .unwrap_or_else(|| toml_u64(&text, "wake", "delta_events").unwrap_or(12) as f64),
        max_delay_ms: toml_u64(&text, "wake", "max_delay_ms").unwrap_or(0),
        turn_cooldown_ms: toml_u64(&text, "wake", "turn_cooldown_ms")
            .unwrap_or_else(|| toml_u64(&text, "wake", "cooldown_ms").unwrap_or(250)),
        batch_cooldown_ms: toml_u64(&text, "wake", "batch_cooldown_ms")
            .unwrap_or_else(|| toml_u64(&text, "wake", "cooldown_ms").unwrap_or(250)),
        wake_policy_script: toml_string(&text, "wake", "policy_script")
            .map(|path| resolve_config_path(&state.paths.app_root, &path))
            .or_else(|| {
                Some(
                    state
                        .paths
                        .app_root
                        .join("scripts")
                        .join("monitor_wake_policy.py"),
                )
            }),
        monty_python_bin: toml_string(&text, "wake", "monty_python_bin")
            .or_else(|| std::env::var("STACK_MONITOR_MONTY_PYTHON").ok())
            .unwrap_or_else(|| "python3".to_string()),
    }
}

fn events_after_cursor<'a>(events: &'a [Value], last_event_id: Option<&str>) -> Vec<&'a Value> {
    let index = last_event_id
        .and_then(|id| events.iter().position(|event| event_id(event) == Some(id)))
        .map(|index| index + 1)
        .unwrap_or(0);
    events
        .iter()
        .skip(index)
        .filter(|event| {
            !event_type(event)
                .unwrap_or_default()
                .starts_with("monitor.")
        })
        .filter(|event| event.get("actor_role").and_then(Value::as_str) != Some("monitor"))
        .collect()
}

fn triggered_event_ids(events: &[Value], actor_id: &str) -> HashSet<String> {
    let mut ids = HashSet::new();
    for event in events {
        if !matches!(
            event_type(event),
            Some("monitor.wake" | "monitor.trigger_queued")
        ) {
            continue;
        }
        if event.get("actor_id").and_then(Value::as_str) != Some(actor_id) {
            continue;
        }
        let Some(trigger_ids) = event
            .get("payload")
            .and_then(|payload| payload.get("trigger_event_ids"))
            .and_then(Value::as_array)
        else {
            continue;
        };
        for id in trigger_ids {
            if let Some(id) = id.as_str() {
                ids.insert(id.to_string());
            }
        }
    }
    ids
}

fn is_trigger_event(config: &MonitorRuntimeConfig, event: &Value) -> bool {
    match event_type(event) {
        Some("agent.tool.failed") => config.on_tool_failed,
        Some("agent.tool.completed") => config.on_tool_completed,
        Some("agent.turn.completed") => config.on_turn_completed,
        Some("agent.error") => true,
        _ => false,
    }
}

fn effective_strictness(
    config: &MonitorRuntimeConfig,
    events: &[Value],
    actor: Option<&Value>,
) -> String {
    let mode_event = events.iter().rev().find(|event| {
        matches!(
            event_type(event),
            Some("monitor.paused" | "monitor.resumed" | "monitor.mode_changed")
        )
    });
    mode_event
        .and_then(|event| event.get("payload"))
        .and_then(|payload| payload.get("strictness"))
        .and_then(Value::as_str)
        .or_else(|| {
            actor
                .and_then(|value| value.get("strictness"))
                .and_then(Value::as_str)
        })
        .unwrap_or(&config.strictness)
        .to_string()
}

fn has_monitor_events(events: &[Value]) -> bool {
    events
        .iter()
        .any(|event| event_type(event).is_some_and(|kind| kind.starts_with("monitor.")))
}

fn wake_reason(event: Option<&Value>) -> &'static str {
    match event.and_then(event_type) {
        Some("agent.tool.failed") => "tool_failed",
        Some("agent.tool.completed") => "tool_completed",
        Some("agent.turn.completed") => "turn_completed",
        Some("agent.error") => "error",
        _ => "delta_events",
    }
}

fn event_id(event: &Value) -> Option<&str> {
    event.get("event_id").and_then(Value::as_str)
}

fn event_type(event: &Value) -> Option<&str> {
    event.get("type").and_then(Value::as_str)
}

fn scheduler_enabled() -> bool {
    !matches!(
        std::env::var("STACKD_MONITOR_SCHEDULER").ok().as_deref(),
        Some("0" | "false" | "off" | "disabled")
    )
}

fn scheduler_poll_ms() -> u64 {
    std::env::var("STACKD_MONITOR_POLL_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(500)
        .clamp(100, 10_000)
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn safe_segment(value: &str) -> String {
    value
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' || ch == '.' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn toml_string(text: &str, section: &str, key: &str) -> Option<String> {
    toml_value(text, section, key).map(|value| value.trim_matches('"').to_string())
}

fn toml_bool(text: &str, section: &str, key: &str) -> Option<bool> {
    match toml_value(text, section, key)?.as_str() {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    }
}

fn toml_u64(text: &str, section: &str, key: &str) -> Option<u64> {
    toml_value(text, section, key)?.parse::<u64>().ok()
}

fn toml_f64(text: &str, section: &str, key: &str) -> Option<f64> {
    toml_value(text, section, key)?.parse::<f64>().ok()
}

fn resolve_config_path(app_root: &std::path::Path, path: &str) -> PathBuf {
    let path = PathBuf::from(path);
    if path.is_absolute() {
        path
    } else {
        app_root.join(path)
    }
}

fn toml_value(text: &str, section: &str, key: &str) -> Option<String> {
    let mut current = "monitor";
    for raw in text.lines() {
        let line = raw.split('#').next()?.trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            current = line.trim_start_matches('[').trim_end_matches(']');
            continue;
        }
        if current != section {
            continue;
        }
        let (left, right) = line.split_once('=')?;
        if left.trim() == key {
            return Some(right.trim().to_string());
        }
    }
    None
}
