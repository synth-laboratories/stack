use chrono::{Duration as ChronoDuration, Utc};
use serde_json::{json, Map, Value};
use stack_core::events::EventLogError;
use std::env;
use std::path::{Path, PathBuf};
use std::time::Duration;

const DEFAULT_SLOT: &str = "slot1";
const DEFAULT_WRITE_TIMEOUT_MS: u64 = 750;
const VICTORIA_LOGS_STATE_HEALTHY: &str = "healthy";
const VICTORIA_LOGS_STATE_DOWN: &str = "down";

#[derive(Debug, Clone)]
pub struct VictoriaLogsQueryRequest {
    pub slot: String,
    pub query: String,
    pub limit: u64,
    pub minutes: u64,
    pub timeout_seconds: u64,
    pub max_limit: u64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct VictoriaLogsQueryResponse {
    pub slot_id: String,
    pub victorialogs_url: String,
    pub query: String,
    pub records: Vec<Map<String, Value>>,
}

pub async fn query_logs(
    stack_dir: &Path,
    request: VictoriaLogsQueryRequest,
) -> Result<VictoriaLogsQueryResponse, String> {
    let base_url = victorialogs_read_url(stack_dir, &request.slot)
        .ok_or_else(|| format!("{} VictoriaLogs URL not configured", request.slot))?;
    let status =
        victorialogs_status(stack_dir, &request.slot, &base_url, request.timeout_seconds).await?;
    if status.state == VICTORIA_LOGS_STATE_DOWN {
        return Err(format!(
            "{} VictoriaLogs is unhealthy: {}",
            request.slot,
            status
                .error
                .unwrap_or_else(|| "VictoriaLogs unavailable".to_string())
        ));
    }
    let limit = request.limit.clamp(1, request.max_limit.max(1));
    let minutes = request.minutes.max(1);
    let end_at = Utc::now();
    let start_at = end_at - ChronoDuration::minutes(minutes as i64);
    let query_url = normalize_victorialogs_query_url(&base_url);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(request.timeout_seconds.max(1)))
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(&query_url)
        .query(&[
            ("query", request.query.as_str()),
            ("limit", &limit.to_string()),
            ("start", &start_at.to_rfc3339()),
            ("end", &end_at.to_rfc3339()),
        ])
        .send()
        .await
        .map_err(|error| format!("VictoriaLogs query failed: {error}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().await.unwrap_or_default();
        return Err(format!(
            "VictoriaLogs query failed: HTTP {status}: {detail}"
        ));
    }
    let raw = response.text().await.map_err(|error| error.to_string())?;
    Ok(VictoriaLogsQueryResponse {
        slot_id: request.slot.clone(),
        victorialogs_url: base_url,
        query: request.query,
        records: parse_records(&raw),
    })
}

#[derive(Debug, Clone)]
struct VictoriaLogsStatus {
    state: String,
    error: Option<String>,
}

async fn victorialogs_status(
    stack_dir: &Path,
    slot: &str,
    base_url: &str,
    timeout_seconds: u64,
) -> Result<VictoriaLogsStatus, String> {
    let probe = victorialogs_probe(base_url, timeout_seconds).await;
    let state = probe.state;
    let error = if state == VICTORIA_LOGS_STATE_HEALTHY {
        None
    } else {
        Some(probe.detail)
    };
    let _ = stack_dir;
    let _ = slot;
    Ok(VictoriaLogsStatus { state, error })
}

#[derive(Debug, Clone)]
struct VictoriaLogsProbe {
    state: String,
    detail: String,
}

async fn victorialogs_probe(base_url: &str, timeout_seconds: u64) -> VictoriaLogsProbe {
    let query_url = normalize_victorialogs_query_url(base_url);
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_seconds.max(1)))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            return VictoriaLogsProbe {
                state: VICTORIA_LOGS_STATE_DOWN.to_string(),
                detail: error.to_string(),
            };
        }
    };
    let response = client
        .get(&query_url)
        .query(&[("query", "*"), ("limit", "1")])
        .send()
        .await;
    match response {
        Ok(response) if response.status().is_success() => VictoriaLogsProbe {
            state: VICTORIA_LOGS_STATE_HEALTHY.to_string(),
            detail: "ok".to_string(),
        },
        Ok(response) => VictoriaLogsProbe {
            state: VICTORIA_LOGS_STATE_DOWN.to_string(),
            detail: format!("http_{}: {}", response.status(), response.status()),
        },
        Err(error) => VictoriaLogsProbe {
            state: VICTORIA_LOGS_STATE_DOWN.to_string(),
            detail: error.to_string(),
        },
    }
}

fn normalize_victorialogs_query_url(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.contains("/select/") {
        return trimmed.to_string();
    }
    format!("{trimmed}/select/logsql/query")
}

fn parse_records(raw: &str) -> Vec<Map<String, Value>> {
    let body = raw.trim();
    if body.is_empty() {
        return Vec::new();
    }
    if let Ok(parsed) = serde_json::from_str::<Value>(body) {
        return records_from_value(parsed);
    }
    body.lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }
            serde_json::from_str::<Value>(line)
                .ok()
                .and_then(|value| value.as_object().cloned())
        })
        .collect()
}

fn records_from_value(parsed: Value) -> Vec<Map<String, Value>> {
    match parsed {
        Value::Array(items) => items
            .into_iter()
            .filter_map(|item| item.as_object().cloned())
            .collect(),
        Value::Object(map) => vec![map],
        _ => Vec::new(),
    }
}

fn victorialogs_read_url(stack_dir: &Path, slot: &str) -> Option<String> {
    env::var("VICTORIA_LOGS_READ_URL")
        .or_else(|_| env::var("STACK_VICTORIA_LOGS_READ_URL"))
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            read_slot_vl_port_for(stack_dir, slot).map(|port| format!("http://127.0.0.1:{port}"))
        })
}

pub async fn append_thread_event_projected(
    stack_dir: &Path,
    thread_id: &str,
    event: &Value,
) -> Result<PathBuf, EventLogError> {
    let path = stack_core::events::append_thread_event(stack_dir, thread_id, event).await?;
    project_thread_event(stack_dir, thread_id, event);
    Ok(path)
}

fn project_thread_event(stack_dir: &Path, thread_id: &str, event: &Value) {
    if env::var("STACK_VL_META_PROJECT").ok().as_deref() == Some("0") {
        return;
    }
    let Some(insert_url) = vl_insert_url(stack_dir) else {
        return;
    };
    let document = meta_event_document(stack_dir, thread_id, event);
    tokio::spawn(async move {
        let client = match reqwest::Client::builder()
            .timeout(Duration::from_millis(DEFAULT_WRITE_TIMEOUT_MS))
            .build()
        {
            Ok(client) => client,
            Err(error) => {
                tracing::debug!("VictoriaLogs client build failed: {error}");
                return;
            }
        };
        let mut request = client
            .post(insert_url)
            .header("content-type", "application/stream+json")
            .body(format!("{document}\n"));
        if let Ok(token) = env::var("VICTORIA_LOGS_WRITE_BEARER_TOKEN")
            .or_else(|_| env::var("STACK_VICTORIA_LOGS_WRITE_BEARER_TOKEN"))
        {
            if !token.trim().is_empty() {
                request = request.bearer_auth(token);
            }
        }
        if let Err(error) = request.send().await {
            tracing::debug!("VictoriaLogs meta_harness projection failed: {error}");
        }
    });
}

fn meta_event_document(stack_dir: &Path, thread_id: &str, event: &Value) -> String {
    let event_type = event
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("stack.event");
    let payload = event.get("payload").and_then(Value::as_object);
    let mut document = Map::new();
    document.insert("_time".to_string(), json!(observed_at(event)));
    document.insert(
        "_msg".to_string(),
        json!(meta_event_message(event_type, payload)),
    );
    document.insert("level".to_string(), json!(event_level(event_type)));
    document.insert("logger".to_string(), json!("stackd.meta"));
    document.insert("slot".to_string(), json!(vl_slot()));
    document.insert("service".to_string(), json!("stackd"));
    document.insert("event_domain".to_string(), json!("meta_harness"));
    document.insert("event_type".to_string(), json!(event_type));
    document.insert(
        "event_id".to_string(),
        event.get("event_id").cloned().unwrap_or(Value::Null),
    );
    document.insert("thread_id".to_string(), json!(thread_id));
    document.insert("stack_session_id".to_string(), json!(thread_id));
    document.insert(
        "actor_id".to_string(),
        event.get("actor_id").cloned().unwrap_or(Value::Null),
    );
    document.insert(
        "actor_role".to_string(),
        event
            .get("actor_role")
            .cloned()
            .unwrap_or_else(|| json!("unknown")),
    );
    document.insert(
        "stack_root".to_string(),
        json!(stack_root(stack_dir).to_string_lossy()),
    );
    flatten_selected_payload(payload, &mut document);
    Value::Object(document).to_string()
}

fn flatten_selected_payload(
    payload: Option<&Map<String, Value>>,
    document: &mut Map<String, Value>,
) {
    let Some(payload) = payload else {
        return;
    };
    for key in [
        "skill_id",
        "skill_name",
        "guidance_id",
        "query",
        "origin",
        "reason",
        "wake_reason",
        "severity",
        "friction_id",
        "run_id",
        "job_id",
        "project_id",
        "phase",
    ] {
        if let Some(value) = payload.get(key) {
            if value.is_string() || value.is_number() || value.is_boolean() {
                document.insert(key.to_string(), value.clone());
            }
        }
    }
}

fn meta_event_message(event_type: &str, payload: Option<&Map<String, Value>>) -> String {
    let subject = payload.and_then(|payload| {
        ["skill_id", "guidance_id", "run_id", "wake_reason"]
            .into_iter()
            .find_map(|key| payload.get(key).and_then(Value::as_str))
    });
    subject.map_or_else(
        || event_type.to_string(),
        |subject| format!("{event_type} {subject}"),
    )
}

fn event_level(event_type: &str) -> &'static str {
    if event_type.contains("failed") || event_type.ends_with(".error") {
        "error"
    } else {
        "info"
    }
}

fn observed_at(event: &Value) -> String {
    event
        .get("observed_at")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
}

fn vl_insert_url(stack_dir: &Path) -> Option<String> {
    let write_url = env::var("VICTORIA_LOGS_WRITE_URL")
        .or_else(|_| env::var("STACK_VICTORIA_LOGS_WRITE_URL"))
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            read_slot_vl_port_for(stack_dir, &safe_slot(&vl_slot()))
                .map(|port| format!("http://127.0.0.1:{port}"))
        })?;
    let base = write_url.trim_end_matches('/');
    let separator = if base.contains('?') { "&" } else { "?" };
    if base.contains("/insert/") {
        if base.contains("?_stream_fields=") || base.contains("&_stream_fields=") {
            return Some(base.to_string());
        }
        Some(format!(
            "{base}{separator}_stream_fields=slot,service,event_domain"
        ))
    } else {
        Some(format!(
            "{base}/insert/jsonline?_stream_fields=slot,service,event_domain"
        ))
    }
}

fn read_slot_vl_port_for(stack_dir: &Path, slot: &str) -> Option<u16> {
    let slot_path = stack_root(stack_dir)
        .parent()?
        .join("synth-dev")
        .join("config")
        .join("slots")
        .join(format!("{}.toml", safe_slot(slot)));
    let text = std::fs::read_to_string(slot_path).ok()?;
    for line in text.lines() {
        let trimmed = line.trim();
        let Some(value) = trimmed.strip_prefix("victorialogs") else {
            continue;
        };
        let Some(value) = value.trim_start().strip_prefix('=') else {
            continue;
        };
        if let Ok(port) = value.trim().parse::<u16>() {
            return Some(port);
        }
    }
    None
}

fn stack_root(stack_dir: &Path) -> PathBuf {
    if stack_dir.file_name().and_then(|name| name.to_str()) == Some(".stack") {
        return stack_dir.parent().unwrap_or(stack_dir).to_path_buf();
    }
    stack_dir.to_path_buf()
}

fn vl_slot() -> String {
    let slot = env::var("STACK_VL_SLOT").unwrap_or_else(|_| DEFAULT_SLOT.to_string());
    safe_slot(&slot)
}

fn safe_slot(value: &str) -> String {
    let trimmed = value.trim();
    if !trimmed.is_empty()
        && trimmed.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.')
        })
    {
        trimmed.to_string()
    } else {
        DEFAULT_SLOT.to_string()
    }
}
