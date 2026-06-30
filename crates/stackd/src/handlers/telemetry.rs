use crate::handlers::ApiError;
use crate::server::AppState;
use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::env;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::AsyncWriteExt;

#[derive(Debug, Deserialize)]
struct TelemetryContract {
    schema_version: u32,
    default_local_product_telemetry: String,
    forbidden_fields: Vec<String>,
    events: Vec<TelemetryEventContract>,
}

#[derive(Debug, Deserialize)]
struct TelemetryEventContract {
    name: String,
    class: String,
    owner: String,
    payload: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct TelemetryEventRequest {
    name: String,
    payload: Option<Map<String, Value>>,
}

#[derive(Debug, Serialize)]
pub struct TelemetryStatusResponse {
    ok: bool,
    schema_version: u32,
    local_product_telemetry: TelemetryLocalStatus,
    event_count: usize,
    events: Vec<TelemetryEventStatus>,
    forbidden_fields: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct TelemetryLocalStatus {
    enabled: bool,
    default: String,
    reason: String,
    endpoint_configured: bool,
}

#[derive(Debug, Serialize)]
pub struct TelemetryEventStatus {
    name: String,
    class: String,
    owner: String,
    payload: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct TelemetryEventRecordResponse {
    ok: bool,
    accepted: bool,
    emitted: bool,
    reason: String,
    outbox_path: Option<String>,
    event: Option<Value>,
}

pub async fn telemetry_status(
    State(state): State<Arc<AppState>>,
) -> Result<Json<TelemetryStatusResponse>, ApiError> {
    let contract = read_contract(&state).await?;
    let local_enabled = local_telemetry_enabled();
    let endpoint_configured = std::env::var("STACK_TELEMETRY_ENDPOINT")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .is_some();

    Ok(Json(TelemetryStatusResponse {
        ok: true,
        schema_version: contract.schema_version,
        local_product_telemetry: TelemetryLocalStatus {
            enabled: local_enabled,
            default: contract.default_local_product_telemetry,
            reason: if local_enabled {
                "enabled by STACK_TELEMETRY=1".to_string()
            } else {
                "local product telemetry is off by default".to_string()
            },
            endpoint_configured,
        },
        event_count: contract.events.len(),
        events: contract
            .events
            .into_iter()
            .map(|event| TelemetryEventStatus {
                name: event.name,
                class: event.class,
                owner: event.owner,
                payload: event.payload,
            })
            .collect(),
        forbidden_fields: contract.forbidden_fields,
    }))
}

pub async fn record_telemetry_event(
    State(state): State<Arc<AppState>>,
    Json(request): Json<TelemetryEventRequest>,
) -> Result<Json<TelemetryEventRecordResponse>, ApiError> {
    let contract = read_contract(&state).await?;
    let event = contract
        .events
        .iter()
        .find(|entry| entry.name == request.name)
        .ok_or_else(|| {
            ApiError::bad_request(format!(
                "telemetry event {} is not allowlisted",
                request.name
            ))
        })?;

    if event.owner != "stackd" || event.class != "local_product_opt_in" {
        return Err(ApiError::bad_request(format!(
            "telemetry event {} is not a stackd local product event",
            event.name
        )));
    }

    let payload = sanitize_payload(
        &state,
        event,
        request.payload.unwrap_or_default(),
        &contract.forbidden_fields,
    )?;

    if !local_telemetry_enabled() {
        return Ok(Json(TelemetryEventRecordResponse {
            ok: true,
            accepted: true,
            emitted: false,
            reason: "local product telemetry is off by default".to_string(),
            outbox_path: None,
            event: None,
        }));
    }

    let observed_at = chrono::Utc::now().to_rfc3339();
    let record = json!({
        "schema_version": contract.schema_version,
        "event_id": format!("te_{}", chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)),
        "name": event.name,
        "class": event.class,
        "owner": event.owner,
        "observed_at": observed_at,
        "payload": payload,
    });
    let outbox_path = telemetry_outbox_path(&state);
    if let Some(parent) = outbox_path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|error| {
            ApiError::internal(format!("failed to create telemetry outbox dir: {error}"))
        })?;
    }
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&outbox_path)
        .await
        .map_err(|error| ApiError::internal(format!("failed to open telemetry outbox: {error}")))?;
    file.write_all(format!("{record}\n").as_bytes())
        .await
        .map_err(|error| {
            ApiError::internal(format!("failed to write telemetry outbox: {error}"))
        })?;

    Ok(Json(TelemetryEventRecordResponse {
        ok: true,
        accepted: true,
        emitted: true,
        reason: "local product telemetry emitted to stackd outbox".to_string(),
        outbox_path: Some(outbox_path.to_string_lossy().to_string()),
        event: Some(record),
    }))
}

async fn read_contract(state: &AppState) -> Result<TelemetryContract, ApiError> {
    let contract_path = state
        .paths
        .app_root
        .join("docs")
        .join("TELEMETRY_EVENTS.json");
    let text = tokio::fs::read_to_string(&contract_path)
        .await
        .map_err(|error| {
            ApiError::internal(format!("failed to read telemetry contract: {error}"))
        })?;
    serde_json::from_str::<TelemetryContract>(&text)
        .map_err(|error| ApiError::internal(format!("failed to parse telemetry contract: {error}")))
}

fn sanitize_payload(
    state: &AppState,
    event: &TelemetryEventContract,
    payload: Map<String, Value>,
    forbidden_fields: &[String],
) -> Result<Map<String, Value>, ApiError> {
    let allowed: HashSet<&str> = event.payload.iter().map(String::as_str).collect();
    let forbidden: HashSet<&str> = forbidden_fields.iter().map(String::as_str).collect();
    let mut sanitized = Map::new();

    for (key, value) in payload {
        if forbidden.contains(key.as_str()) {
            return Err(ApiError::bad_request(format!(
                "telemetry payload field {key} is forbidden"
            )));
        }
        if !allowed.contains(key.as_str()) {
            return Err(ApiError::bad_request(format!(
                "telemetry payload field {key} is not allowlisted for {}",
                event.name
            )));
        }
        if !is_safe_scalar(&value) {
            return Err(ApiError::bad_request(format!(
                "telemetry payload field {key} must be a scalar value"
            )));
        }
        sanitized.insert(key, value);
    }

    insert_default(
        &mut sanitized,
        &allowed,
        "channel",
        state.stack_channel.as_deref().unwrap_or("dev"),
    );
    insert_default(
        &mut sanitized,
        &allowed,
        "version",
        state
            .stack_version
            .as_deref()
            .unwrap_or(env!("CARGO_PKG_VERSION")),
    );
    insert_default(&mut sanitized, &allowed, "target", &target_triple());
    insert_default(&mut sanitized, &allowed, "telemetry_state", "enabled");
    Ok(sanitized)
}

fn insert_default(
    payload: &mut Map<String, Value>,
    allowed: &HashSet<&str>,
    key: &str,
    value: &str,
) {
    if allowed.contains(key) && !payload.contains_key(key) {
        payload.insert(key.to_string(), Value::String(value.to_string()));
    }
}

fn is_safe_scalar(value: &Value) -> bool {
    matches!(
        value,
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_)
    )
}

fn telemetry_outbox_path(state: &AppState) -> PathBuf {
    env::var("STACK_TELEMETRY_OUTBOX")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| state.paths.stack_dir.join("telemetry").join("events.jsonl"))
}

fn local_telemetry_enabled() -> bool {
    matches!(
        std::env::var("STACK_TELEMETRY")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "1" | "true" | "on" | "yes"
    )
}

fn target_triple() -> String {
    let arch = match env::consts::ARCH {
        "aarch64" => "aarch64",
        "x86_64" => "x86_64",
        other => other,
    };
    match env::consts::OS {
        "macos" => format!("{arch}-apple-darwin"),
        "linux" => format!("{arch}-unknown-linux-musl"),
        other => format!("{arch}-{other}"),
    }
}
