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
    worker: String,
    max_wakes_per_primary_turn: u64,
    max_queued_items_per_thread: usize,
    skill_context_push: String,
    skills_enabled: bool,
    allowed_skill_ids: Vec<String>,
    push_when_confident: bool,
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

    run_monitor_pass(
        state,
        config,
        thread_id,
        actor_path,
        actor.as_ref(),
        &events,
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

async fn run_monitor_pass(
    state: &AppState,
    config: &MonitorRuntimeConfig,
    thread_id: &str,
    actor_path: std::path::PathBuf,
    actor: Option<&Value>,
    all_events: &[Value],
    pending: Vec<&Value>,
    triggers: Vec<&Value>,
    reason: String,
    strictness: String,
) -> anyhow::Result<()> {
    let started_at = now();
    write_actor_state(
        &actor_path,
        config,
        thread_id,
        actor,
        ActorUpdate {
            state: Some("running"),
            strictness: Some(&strictness),
            last_started_at: Some(&started_at),
            ..ActorUpdate::default()
        },
    )
    .await?;

    let wake_id = format!(
        "monitor_wake_{}",
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
            "event_id": wake_id,
            "type": "monitor.wake",
            "thread_id": thread_id,
            "observed_at": started_at,
            "actor_id": config.actor_id,
            "actor_role": "monitor",
            "payload": {
                "wake_reason": &reason,
                "trigger_event_ids": trigger_ids,
                "pending_event_count": pending.len(),
                "strictness": strictness,
                "focus_selection": config.focus_selection,
                "source": "stackd-scheduler"
            }
        }),
    )
    .await?;

    let pass = run_scheduler_pass(config, actor, &pending, &wake_id, &reason, &strictness).await;
    append_thread_event_projected(
        &state.paths.stack_dir,
        thread_id,
        &json!({
            "event_id": format!("monitor_summary_{}", Utc::now().timestamp_nanos_opt().unwrap_or_default()),
            "type": "monitor.summary",
            "thread_id": thread_id,
            "observed_at": now(),
            "actor_id": config.actor_id,
            "actor_role": "monitor",
            "payload": {
                "wake_id": wake_id,
                "model": config.model,
                "reasoning_effort": config.reasoning_effort,
                "strictness": strictness,
                "severity": &pass.severity,
                "summary": &pass.summary,
                "focus_results": &pass.focus_results,
                "source": &pass.source,
                "model_thread_id": &pass.monitor_thread_id
            }
        }),
    )
    .await?;

    if let Some(reason) = &pass.fallback_reason {
        append_thread_event_projected(
            &state.paths.stack_dir,
            thread_id,
            &json!({
                "event_id": format!("monitor_model_fallback_{}", Utc::now().timestamp_nanos_opt().unwrap_or_default()),
                "type": "monitor.model_fallback",
                "thread_id": thread_id,
                "observed_at": now(),
                "actor_id": config.actor_id,
                "actor_role": "monitor",
                "payload": {
                    "wake_id": wake_id,
                    "reason": reason,
                    "worker": config.worker,
                    "model": config.model,
                    "source": &pass.source
                }
            }),
        )
        .await?;
    }

    for item in &pass.queue_items {
        append_thread_event_projected(
            &state.paths.stack_dir,
            thread_id,
            &json!({
                "event_id": format!("monitor_queued_{}", Utc::now().timestamp_nanos_opt().unwrap_or_default()),
                "type": "monitor.queued",
                "thread_id": thread_id,
                "observed_at": now(),
                "actor_id": config.actor_id,
                "actor_role": "monitor",
                "payload": item
            }),
        )
        .await?;
    }

    let context_pushes = skill_context_pushes_for_pending(
        state,
        config,
        all_events,
        &pending,
        &trigger_ids,
        &wake_id,
        &strictness,
    );
    for push in &context_pushes {
        append_thread_event_projected(
            &state.paths.stack_dir,
            thread_id,
            &json!({
                "event_id": format!("monitor_skill_context_push_{}", Utc::now().timestamp_nanos_opt().unwrap_or_default()),
                "type": "monitor.skill_context_push",
                "thread_id": thread_id,
                "observed_at": now(),
                "actor_id": config.actor_id,
                "actor_role": "monitor",
                "payload": push
            }),
        )
        .await?;
    }

    append_thread_event_projected(
        &state.paths.stack_dir,
        thread_id,
        &json!({
            "event_id": format!("monitor_usage_{}", Utc::now().timestamp_nanos_opt().unwrap_or_default()),
            "type": "monitor.usage",
            "thread_id": thread_id,
            "observed_at": now(),
            "actor_id": config.actor_id,
            "actor_role": "monitor",
            "payload": {
                "wake_id": wake_id,
                "model": config.model,
                "reasoning_effort": config.reasoning_effort,
                "input_tokens": pass.usage.input_tokens,
                "cached_input_tokens": pass.usage.cached_input_tokens,
                "output_tokens": pass.usage.output_tokens,
                "reasoning_output_tokens": pass.usage.reasoning_output_tokens,
                "estimated_spend_usd": 0,
                "source": &pass.source
            }
        }),
    )
    .await?;

    let last_event = pending.last().copied();
    let completed_at = now();
    write_actor_state(
        &actor_path,
        config,
        thread_id,
        actor,
        ActorUpdate {
            state: Some("idle"),
            strictness: Some(&strictness),
            last_event_id: last_event.and_then(event_id),
            last_event_type: last_event.and_then(event_type),
            last_wake_id: Some(&wake_id),
            monitor_thread_id: pass.monitor_thread_id.as_deref(),
            rolling_summary: Some(&pass.checkpoint_summary),
            last_severity: Some(&pass.severity),
            wake_delta: 1,
            queue_delta: pass.queue_items.len() as u64,
            context_push_delta: context_pushes.len() as u64,
            last_completed_at: Some(&completed_at),
            ..ActorUpdate::default()
        },
    )
    .await?;

    append_thread_event_projected(
        &state.paths.stack_dir,
        thread_id,
        &json!({
            "event_id": format!("monitor_checkpoint_{}", Utc::now().timestamp_nanos_opt().unwrap_or_default()),
            "type": "monitor.checkpoint",
            "thread_id": thread_id,
            "observed_at": completed_at,
            "actor_id": config.actor_id,
            "actor_role": "monitor",
            "payload": {
                "last_wake_id": wake_id,
                "last_event_id": last_event.and_then(event_id),
                "last_event_type": last_event.and_then(event_type),
                "summary": &pass.summary,
                "severity": &pass.severity,
                "state": "idle",
                "actor_state_path": actor_path.to_string_lossy(),
                "source": &pass.source,
                "model_thread_id": &pass.monitor_thread_id
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

#[derive(Debug, Clone)]
struct SchedulerPass {
    summary: String,
    checkpoint_summary: String,
    severity: String,
    focus_results: Value,
    queue_items: Vec<Value>,
    source: String,
    monitor_thread_id: Option<String>,
    fallback_reason: Option<String>,
    usage: SchedulerUsage,
}

#[derive(Debug, Clone)]
struct SchedulerUsage {
    input_tokens: u64,
    cached_input_tokens: u64,
    output_tokens: u64,
    reasoning_output_tokens: u64,
}

async fn run_scheduler_pass(
    config: &MonitorRuntimeConfig,
    actor: Option<&Value>,
    pending: &[&Value],
    wake_id: &str,
    wake_reason: &str,
    strictness: &str,
) -> SchedulerPass {
    let deterministic = deterministic_pass(config, pending);
    if !should_use_openai(config) {
        return deterministic;
    }
    let Some(api_key) = std::env::var("OPENAI_API_KEY")
        .ok()
        .filter(|value| !value.trim().is_empty())
    else {
        return if config.worker == "openai_responses" {
            SchedulerPass {
                fallback_reason: Some("OPENAI_API_KEY missing".to_string()),
                ..deterministic
            }
        } else {
            deterministic
        };
    };
    match openai_scheduler_pass(
        config,
        actor,
        pending,
        wake_id,
        wake_reason,
        strictness,
        &api_key,
    )
    .await
    {
        Ok(pass) => pass,
        Err(error) => {
            tracing::warn!(
                "stackd OpenAI monitor pass failed; using deterministic fallback: {error}"
            );
            SchedulerPass {
                fallback_reason: Some(error.to_string()),
                ..deterministic
            }
        }
    }
}

fn deterministic_pass(config: &MonitorRuntimeConfig, pending: &[&Value]) -> SchedulerPass {
    let summary = summarize_pending(pending);
    let severity = severity_for_pending(pending);
    let queue_items =
        queue_items_for_pending(pending, &severity, config.max_queued_items_per_thread);
    let usage = estimate_usage(pending, &summary);
    SchedulerPass {
        checkpoint_summary: summary.clone(),
        summary,
        severity,
        focus_results: focus_results_for_pending(pending),
        queue_items,
        source: "stackd-scheduler".to_string(),
        monitor_thread_id: None,
        fallback_reason: None,
        usage: SchedulerUsage {
            input_tokens: usage.0,
            cached_input_tokens: 0,
            output_tokens: usage.1,
            reasoning_output_tokens: 0,
        },
    }
}

async fn openai_scheduler_pass(
    config: &MonitorRuntimeConfig,
    actor: Option<&Value>,
    pending: &[&Value],
    wake_id: &str,
    wake_reason: &str,
    strictness: &str,
    api_key: &str,
) -> anyhow::Result<SchedulerPass> {
    let previous_response_id = actor
        .and_then(|value| value.get("monitor_thread_id"))
        .and_then(Value::as_str);
    let baseline = deterministic_pass(config, pending);
    let client = reqwest::Client::new();
    let mut body = json!({
        "model": config.model,
        "reasoning": { "effort": config.reasoning_effort },
        "input": [
            {
                "role": "developer",
                "content": [{
                    "type": "input_text",
                    "text": monitor_developer_prompt()
                }]
            },
            {
                "role": "user",
                "content": [{
                    "type": "input_text",
                    "text": serde_json::to_string_pretty(&json!({
                        "wake_id": wake_id,
                        "wake_reason": wake_reason,
                        "strictness": strictness,
                        "previous_checkpoint": actor.and_then(|value| value.get("rolling_summary")).and_then(Value::as_str),
                        "baseline": {
                            "summary": baseline.summary,
                            "severity": baseline.severity,
                            "focus_results": baseline.focus_results,
                            "queue_items": baseline.queue_items,
                        },
                        "delta_events": pending,
                    }))?
                }]
            }
        ]
    });
    if let Some(previous_response_id) = previous_response_id {
        body["previous_response_id"] = json!(previous_response_id);
    }
    let response = client
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await?;
    let status = response.status();
    let payload: Value = response.json().await?;
    if !status.is_success() {
        anyhow::bail!("OpenAI Responses returned {status}: {}", payload);
    }
    let text = extract_openai_output_text(&payload);
    let parsed = parse_json_object_from_text(&text)
        .ok_or_else(|| anyhow::anyhow!("OpenAI monitor response did not contain JSON"))?;
    let fallback = deterministic_pass(config, pending);
    let summary = parsed
        .get("summary")
        .and_then(Value::as_str)
        .unwrap_or(&fallback.summary)
        .to_string();
    let severity = parsed
        .get("severity")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "none" | "low" | "medium" | "high"))
        .unwrap_or(&fallback.severity)
        .to_string();
    let focus_results = parsed
        .get("focus_results")
        .cloned()
        .unwrap_or(fallback.focus_results);
    let queue_items = parsed
        .get("queue_items")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .take(config.max_queued_items_per_thread)
                .cloned()
                .collect()
        })
        .unwrap_or(fallback.queue_items);
    let checkpoint_summary = parsed
        .get("checkpoint_summary")
        .and_then(Value::as_str)
        .unwrap_or(&summary)
        .to_string();
    let usage = openai_usage(&payload).unwrap_or(fallback.usage);
    Ok(SchedulerPass {
        summary,
        checkpoint_summary,
        severity,
        focus_results,
        queue_items,
        source: "openai-responses".to_string(),
        monitor_thread_id: payload
            .get("id")
            .and_then(Value::as_str)
            .map(str::to_string),
        fallback_reason: None,
        usage,
    })
}

fn should_use_openai(config: &MonitorRuntimeConfig) -> bool {
    let worker = std::env::var("STACK_MONITOR_MODEL_WORKER")
        .ok()
        .unwrap_or_else(|| config.worker.clone());
    match worker.as_str() {
        "deterministic" | "stackd_scheduler" => false,
        "openai_responses" => true,
        _ => std::env::var("OPENAI_API_KEY").is_ok(),
    }
}

fn monitor_developer_prompt() -> &'static str {
    r#"You are the Stack monitor actor watching a primary coding agent.
Behave like calibrated human oversight: sparse, concrete, and non-spammy.
Review only the event delta and previous checkpoint. Do not invent events.
Return only JSON:
{
  "summary": "short operator-facing summary",
  "severity": "none|low|medium|high",
  "focus_results": {"style":"pass|warn|fail|disabled","goal_progress":"pass|warn|fail|disabled","skills":"pass|warn|fail|disabled","tool_use":"pass|warn|fail|disabled","scope_control":"pass|warn|fail|disabled","acceptance":"pass|warn|fail|disabled"},
  "queue_items": [{"severity":"low|medium|high","focus":"style|goal_progress|skills|tool_use|scope_control|acceptance","summary":"...","evidence":"..."}],
  "checkpoint_summary": "rolling state for your next wake"
}"#
}

fn extract_openai_output_text(payload: &Value) -> String {
    if let Some(text) = payload.get("output_text").and_then(Value::as_str) {
        return text.to_string();
    }
    let mut parts = Vec::new();
    if let Some(output) = payload.get("output").and_then(Value::as_array) {
        for item in output {
            let Some(content) = item.get("content").and_then(Value::as_array) else {
                continue;
            };
            for part in content {
                if let Some(text) = part
                    .get("text")
                    .or_else(|| part.get("output_text"))
                    .and_then(Value::as_str)
                {
                    parts.push(text.to_string());
                }
            }
        }
    }
    parts.join("\n")
}

fn parse_json_object_from_text(text: &str) -> Option<Value> {
    serde_json::from_str::<Value>(text.trim()).ok().or_else(|| {
        let start = text.find('{')?;
        let end = text.rfind('}')?;
        serde_json::from_str::<Value>(&text[start..=end]).ok()
    })
}

fn openai_usage(payload: &Value) -> Option<SchedulerUsage> {
    let usage = payload.get("usage")?;
    let output_details = usage.get("output_tokens_details");
    Some(SchedulerUsage {
        input_tokens: usage
            .get("input_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        cached_input_tokens: usage
            .get("input_tokens_details")
            .and_then(|value| value.get("cached_tokens"))
            .and_then(Value::as_u64)
            .unwrap_or(0),
        output_tokens: usage
            .get("output_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        reasoning_output_tokens: output_details
            .and_then(|value| value.get("reasoning_tokens"))
            .and_then(Value::as_u64)
            .unwrap_or(0),
    })
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
        "reasoning_effort": config.reasoning_effort,
        "worker": config.worker
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
        worker: toml_string(&text, "model", "worker")
            .unwrap_or_else(|| "stackd_scheduler".to_string()),
        max_wakes_per_primary_turn: toml_u64(&text, "wake", "max_wakes_per_primary_turn")
            .unwrap_or(6),
        max_queued_items_per_thread: toml_u64(&text, "intervention", "max_queued_items_per_thread")
            .unwrap_or(8) as usize,
        skill_context_push: toml_string(&text, "intervention", "skill_context_push")
            .unwrap_or_else(|| "queue_or_steer".to_string()),
        skills_enabled: toml_bool(&text, "skills", "enabled").unwrap_or(true),
        allowed_skill_ids: toml_string_array(&text, "skills", "allowed_skill_ids").unwrap_or_else(
            || {
                vec![
                    "stack-agent-bridge".to_string(),
                    "synth-via-stack".to_string(),
                    "stackeval".to_string(),
                ]
            },
        ),
        push_when_confident: toml_bool(&text, "skills", "push_when_confident").unwrap_or(false),
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
        if event_type(event) != Some("monitor.wake") {
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

fn summarize_pending(events: &[&Value]) -> String {
    if events
        .iter()
        .any(|event| event_type(event) == Some("agent.tool.failed"))
    {
        return "A tool failed; inspect stderr/output before continuing.".to_string();
    }
    if events
        .iter()
        .any(|event| event_type(event) == Some("agent.error"))
    {
        return "The primary actor emitted an error event.".to_string();
    }
    if events
        .iter()
        .any(|event| event_type(event) == Some("agent.tool.completed"))
    {
        return "A tool completed; monitor checkpoint advanced after reviewing the event delta."
            .to_string();
    }
    "Monitor checkpoint advanced after a completed turn.".to_string()
}

fn severity_for_pending(events: &[&Value]) -> String {
    if events
        .iter()
        .any(|event| matches!(event_type(event), Some("agent.tool.failed" | "agent.error")))
    {
        "high".to_string()
    } else {
        "low".to_string()
    }
}

fn focus_results_for_pending(events: &[&Value]) -> Value {
    let failed = events
        .iter()
        .any(|event| matches!(event_type(event), Some("agent.tool.failed" | "agent.error")));
    json!({
        "style": "pass",
        "goal_progress": "pass",
        "skills": "pass",
        "tool_use": if failed { "fail" } else { "pass" },
        "scope_control": "pass",
        "acceptance": "pass"
    })
}

fn queue_items_for_pending(events: &[&Value], severity: &str, limit: usize) -> Vec<Value> {
    if severity == "low" {
        return Vec::new();
    }
    events
        .iter()
        .filter(|event| matches!(event_type(event), Some("agent.tool.failed" | "agent.error")))
        .take(limit)
        .map(|event| {
            json!({
                "severity": severity,
                "focus": "tool_use",
                "summary": summarize_pending(&[*event]),
                "evidence": event.get("payload").and_then(|payload| payload.get("stderr").or_else(|| payload.get("message"))).and_then(Value::as_str)
            })
        })
        .collect()
}

fn skill_context_pushes_for_pending(
    state: &AppState,
    config: &MonitorRuntimeConfig,
    all_events: &[Value],
    pending: &[&Value],
    trigger_ids: &[String],
    wake_id: &str,
    strictness: &str,
) -> Vec<Value> {
    if !can_push_skill_context(config, strictness) || !likely_needs_stack_skill(pending) {
        return Vec::new();
    }
    let Some(skill_id) = recommended_skill_for_pending(config, pending) else {
        return Vec::new();
    };
    if has_used_skill(all_events, &skill_id) || has_pushed_skill(all_events, &skill_id) {
        return Vec::new();
    }
    let source_path = skill_source_path(state, &skill_id);
    let mut evidence_event_ids = trigger_ids.to_vec();
    for event in pending {
        if let Some(id) = event_id(event) {
            evidence_event_ids.push(id.to_string());
        }
    }
    evidence_event_ids.sort();
    evidence_event_ids.dedup();
    let reason = format!(
        "Local StackEval/GEPA work is active and skill context for {skill_id} has not been loaded."
    );
    let message = format!(
        "Monitor suggests reading skill {skill_id}.\nReason: {reason}\nEvidence events: {}.\nApply only the relevant runbook guidance before the next action.",
        evidence_event_ids
            .iter()
            .take(5)
            .cloned()
            .collect::<Vec<String>>()
            .join(", ")
    );
    vec![json!({
        "wake_id": wake_id,
        "target_actor_id": "primary_stackeval",
        "skill_id": skill_id,
        "source_path": source_path,
        "reason": reason,
        "evidence_event_ids": evidence_event_ids,
        "message_id": format!("skillmsg_{}", Utc::now().timestamp_nanos_opt().unwrap_or_default()),
        "message": message,
        "source": "stackd-scheduler"
    })]
}

fn can_push_skill_context(config: &MonitorRuntimeConfig, strictness: &str) -> bool {
    if !config.skills_enabled || matches!(strictness, "off" | "passive") {
        return false;
    }
    let policy = config.skill_context_push.trim().to_ascii_lowercase();
    if matches!(policy.as_str(), "" | "off" | "never" | "false" | "disabled") {
        return false;
    }
    policy == "queue_or_steer"
        || policy == "always"
        || config.push_when_confident
        || strictness == "aggressive"
}

fn likely_needs_stack_skill(events: &[&Value]) -> bool {
    let text = events
        .iter()
        .map(|event| event.to_string().to_ascii_lowercase())
        .collect::<Vec<String>>()
        .join("\n");
    text.contains("stackeval") || text.contains("gepa") || text.contains("synth-optimizers")
}

fn recommended_skill_for_pending(
    config: &MonitorRuntimeConfig,
    pending: &[&Value],
) -> Option<String> {
    let text = pending
        .iter()
        .map(|event| event.to_string().to_ascii_lowercase())
        .collect::<Vec<String>>()
        .join("\n");
    if (text.contains("stackeval") || text.contains("gepa") || text.contains("synth"))
        && config
            .allowed_skill_ids
            .iter()
            .any(|skill_id| skill_id == "synth-via-stack")
    {
        return Some("synth-via-stack".to_string());
    }
    config.allowed_skill_ids.first().cloned()
}

fn has_used_skill(events: &[Value], skill_id: &str) -> bool {
    events.iter().any(|event| {
        matches!(event_type(event), Some("skill.read" | "skill.used"))
            && event
                .get("payload")
                .and_then(|payload| payload.get("skill_id"))
                .and_then(Value::as_str)
                == Some(skill_id)
    })
}

fn has_pushed_skill(events: &[Value], skill_id: &str) -> bool {
    events.iter().any(|event| {
        event_type(event) == Some("monitor.skill_context_push")
            && event
                .get("payload")
                .and_then(|payload| payload.get("skill_id"))
                .and_then(Value::as_str)
                == Some(skill_id)
    })
}

fn skill_source_path(state: &AppState, skill_id: &str) -> String {
    let candidates = [
        state
            .paths
            .app_root
            .join(".stack")
            .join("skills")
            .join(skill_id)
            .join("SKILL.md"),
        state
            .paths
            .app_root
            .join(".codex")
            .join("skills")
            .join(skill_id)
            .join("SKILL.md"),
        state
            .paths
            .codex_home
            .join("skills")
            .join(skill_id)
            .join("SKILL.md"),
    ];
    candidates
        .iter()
        .find(|path| path.is_file())
        .unwrap_or(&candidates[0])
        .to_string_lossy()
        .to_string()
}

fn estimate_usage(events: &[&Value], summary: &str) -> (u64, u64) {
    let input_chars: usize = events.iter().map(|event| event.to_string().len()).sum();
    (
        ((input_chars as u64) / 4).max(1),
        ((summary.len() as u64) / 4).max(1),
    )
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

fn toml_string_array(text: &str, section: &str, key: &str) -> Option<Vec<String>> {
    let value = toml_value(text, section, key)?;
    let trimmed = value.trim();
    if !trimmed.starts_with('[') || !trimmed.ends_with(']') {
        return None;
    }
    let items = trimmed
        .trim_start_matches('[')
        .trim_end_matches(']')
        .split(',')
        .map(|item| item.trim().trim_matches('"').to_string())
        .filter(|item| !item.is_empty())
        .collect::<Vec<String>>();
    Some(items)
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
