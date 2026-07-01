use crate::handlers::ApiError;
use crate::server::AppState;
use axum::{extract::{Query, State}, Json};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::env;
use std::path::{Path, PathBuf};
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
    crash_reporting: CrashReportingStatus,
    event_count: usize,
    events: Vec<TelemetryEventStatus>,
    forbidden_fields: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct CrashReportingStatus {
    enabled: bool,
    default: String,
    reason: String,
    outbox_path: String,
    endpoint_configured: bool,
    local_record_count: usize,
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
    let contract = read_contract(&state).await.ok();
    let local_enabled = local_telemetry_enabled();
    let endpoint_configured = std::env::var("STACK_TELEMETRY_ENDPOINT")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .is_some();
    let crash_outbox = crash_outbox_path(&state);
    let crash_enabled = !crash_reporting_disabled();
    let crash_endpoint_configured = crash_report_url(&state.paths.app_root).is_some();
    let contract_reason = if contract.is_some() {
        if local_enabled {
            "enabled by STACK_TELEMETRY=1".to_string()
        } else {
            "local product telemetry is off by default".to_string()
        }
    } else {
        "telemetry contract unavailable at docs/TELEMETRY_EVENTS.json".to_string()
    };

    Ok(Json(TelemetryStatusResponse {
        ok: true,
        schema_version: contract.as_ref().map(|entry| entry.schema_version).unwrap_or(1),
        local_product_telemetry: TelemetryLocalStatus {
            enabled: local_enabled,
            default: contract
                .as_ref()
                .map(|entry| entry.default_local_product_telemetry.clone())
                .unwrap_or_else(|| "unknown".to_string()),
            reason: contract_reason,
            endpoint_configured,
        },
        crash_reporting: CrashReportingStatus {
            enabled: crash_enabled,
            default: "on".to_string(),
            reason: if crash_enabled {
                "enabled by default; disable with STACK_CRASH_REPORT=0".to_string()
            } else {
                "crash reporting disabled by STACK_CRASH_REPORT=0".to_string()
            },
            outbox_path: crash_outbox.to_string_lossy().to_string(),
            endpoint_configured: crash_endpoint_configured,
            local_record_count: count_crash_outbox_records(&crash_outbox).await,
        },
        event_count: contract.as_ref().map(|entry| entry.events.len()).unwrap_or(0),
        events: contract
            .as_ref()
            .map(|entry| {
                entry
                    .events
                    .iter()
                    .map(|event| TelemetryEventStatus {
                        name: event.name.clone(),
                        class: event.class.clone(),
                        owner: event.owner.clone(),
                        payload: event.payload.clone(),
                    })
                    .collect()
            })
            .unwrap_or_default(),
        forbidden_fields: contract
            .as_ref()
            .map(|entry| entry.forbidden_fields.clone())
            .unwrap_or_default(),
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

#[derive(Debug, Deserialize)]
pub struct CrashReportRequest {
    client_event_id: String,
    observed_at: Option<String>,
    crash_class: String,
    surface: String,
    message: String,
    version: Option<String>,
    channel: Option<String>,
    target: Option<String>,
    metadata: Option<Map<String, Value>>,
}

#[derive(Debug, Serialize)]
pub struct CrashReportResponse {
    ok: bool,
    recorded: bool,
    forwarded: bool,
    reason: String,
    local_path: Option<String>,
    cloud_event_id: Option<String>,
}

const CRASH_ALLOWED_METADATA: &[&str] = &[
    "goal_mode",
    "monitor_enabled",
    "sidecar_view",
    "focus_mode",
    "environment",
    "terminal_rows",
    "terminal_cols",
    "platform",
    "arch",
];

const CRASH_FORBIDDEN_FIELDS: &[&str] = &[
    "prompt",
    "transcript",
    "source_code",
    "artifact_body",
    "raw_path",
    "path",
    "secret",
    "env",
    "command",
    "terminal",
    "raw_ip",
    "ip_hash_unsalted",
];

#[derive(Debug, Deserialize)]
pub struct CrashReportListQuery {
    limit: Option<usize>,
}

#[derive(Debug, Serialize)]
pub struct CrashReportListResponse {
    ok: bool,
    outbox_path: String,
    total: usize,
    returned: usize,
    items: Vec<Value>,
}

pub async fn list_crash_reports(
    State(state): State<Arc<AppState>>,
    Query(query): Query<CrashReportListQuery>,
) -> Result<Json<CrashReportListResponse>, ApiError> {
    let outbox_path = crash_outbox_path(&state);
    let limit = query.limit.unwrap_or(20).clamp(1, 200);
    let (total, items) = read_crash_outbox_tail(&outbox_path, limit).await?;
    Ok(Json(CrashReportListResponse {
        ok: true,
        outbox_path: outbox_path.to_string_lossy().to_string(),
        total,
        returned: items.len(),
        items,
    }))
}

pub async fn record_crash_report(
    State(state): State<Arc<AppState>>,
    Json(request): Json<CrashReportRequest>,
) -> Result<Json<CrashReportResponse>, ApiError> {
    if crash_reporting_disabled() {
        return Ok(Json(CrashReportResponse {
            ok: true,
            recorded: false,
            forwarded: false,
            reason: "crash reporting disabled by STACK_CRASH_REPORT=0".to_string(),
            local_path: None,
            cloud_event_id: None,
        }));
    }

    let client_event_id = bounded_string(&request.client_event_id, 160)
        .ok_or_else(|| ApiError::bad_request("client_event_id is required"))?;
    let crash_class = bounded_string(&request.crash_class, 80)
        .ok_or_else(|| ApiError::bad_request("crash_class is required"))?;
    let surface = bounded_string(&request.surface, 80)
        .ok_or_else(|| ApiError::bad_request("surface is required"))?;
    let message = bounded_string(&request.message, 512)
        .ok_or_else(|| ApiError::bad_request("message is required"))?;
    let metadata = sanitize_crash_metadata(request.metadata.unwrap_or_default())?;
    let observed_at = request
        .observed_at
        .as_deref()
        .and_then(|value| bounded_string(value, 64))
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());

    let record = json!({
        "schema_version": 1,
        "client_event_id": client_event_id,
        "observed_at": observed_at,
        "recorded_at": chrono::Utc::now().to_rfc3339(),
        "crash_class": crash_class,
        "surface": surface,
        "message": message,
        "version": request.version.as_deref().unwrap_or(
            state.stack_version.as_deref().unwrap_or(env!("CARGO_PKG_VERSION"))
        ),
        "channel": request.channel.as_deref().unwrap_or(
            state.stack_channel.as_deref().unwrap_or("dev")
        ),
        "target": request.target.as_deref().unwrap_or(&target_triple()),
        "metadata": metadata,
    });

    let local_path = crash_outbox_path(&state);
    if let Some(parent) = local_path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|error| {
            ApiError::internal(format!("failed to create crash outbox dir: {error}"))
        })?;
    }
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&local_path)
        .await
        .map_err(|error| ApiError::internal(format!("failed to open crash outbox: {error}")))?;
    file.write_all(format!("{record}\n").as_bytes())
        .await
        .map_err(|error| ApiError::internal(format!("failed to write crash outbox: {error}")))?;

    let forward = forward_crash_report(&state, &record).await;
    Ok(Json(CrashReportResponse {
        ok: true,
        recorded: true,
        forwarded: forward.forwarded,
        reason: forward.reason,
        local_path: Some(local_path.to_string_lossy().to_string()),
        cloud_event_id: forward.cloud_event_id,
    }))
}

fn sanitize_crash_metadata(payload: Map<String, Value>) -> Result<Map<String, Value>, ApiError> {
    let allowed: HashSet<&str> = CRASH_ALLOWED_METADATA.iter().copied().collect();
    let forbidden: HashSet<&str> = CRASH_FORBIDDEN_FIELDS.iter().copied().collect();
    let mut sanitized = Map::new();
    for (key, value) in payload {
        if forbidden.contains(key.as_str()) {
            return Err(ApiError::bad_request(format!(
                "crash metadata field {key} is forbidden"
            )));
        }
        if !allowed.contains(key.as_str()) {
            return Err(ApiError::bad_request(format!(
                "crash metadata field {key} is not allowlisted"
            )));
        }
        if !is_safe_scalar(&value) {
            return Err(ApiError::bad_request(format!(
                "crash metadata field {key} must be a scalar value"
            )));
        }
        sanitized.insert(key, value);
    }
    Ok(sanitized)
}

struct CrashForwardResult {
    forwarded: bool,
    reason: String,
    cloud_event_id: Option<String>,
}

async fn forward_crash_report(state: &AppState, record: &Value) -> CrashForwardResult {
    let Some(url) = crash_report_url(&state.paths.app_root) else {
        return CrashForwardResult {
            forwarded: false,
            reason: "no crash report endpoint configured".to_string(),
            cloud_event_id: None,
        };
    };

    let mut request = state.http_client.post(url.clone()).json(record);
    if let Some(token) = synth_auth_token(&state.paths.app_root) {
        request = request.bearer_auth(token);
    }

    match request.send().await {
        Ok(response) => {
            if !response.status().is_success() {
                return CrashForwardResult {
                    forwarded: false,
                    reason: format!("cloud ingest returned {}", response.status()),
                    cloud_event_id: None,
                };
            }
            let body = response.json::<Value>().await.unwrap_or_else(|_| json!({}));
            CrashForwardResult {
                forwarded: true,
                reason: "forwarded to synth cloud".to_string(),
                cloud_event_id: body
                    .get("event_id")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            }
        }
        Err(error) => CrashForwardResult {
            forwarded: false,
            reason: format!("cloud ingest failed: {error}"),
            cloud_event_id: None,
        },
    }
}

fn crash_report_url(app_root: &Path) -> Option<String> {
    if let Some(url) = env::var("STACK_CRASH_REPORT_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
    {
        return Some(url);
    }
    let config = std::fs::read_to_string(app_root.join("stack.config.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .unwrap_or_else(|| json!({}));
    let environment_name = env::var("STACK_ENVIRONMENT")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| read_string(&config, "defaultEnvironment"))
        .unwrap_or_else(|| "prod".to_string());
    let api_base = env::var("STACK_SYNTH_API_BASE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            config
                .get("environments")
                .and_then(|value| value.get(&environment_name))
                .and_then(|value| read_string(value, "apiBaseUrl"))
        })
        .unwrap_or_else(|| "https://api.usesynth.ai".to_string());
    Some(format!(
        "{}/api/v1/product/stack-crashes",
        api_base.trim_end_matches('/')
    ))
}

fn synth_auth_token(app_root: &Path) -> Option<String> {
    let config = std::fs::read_to_string(app_root.join("stack.config.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .unwrap_or_else(|| json!({}));
    let environment_name = env::var("STACK_ENVIRONMENT")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| read_string(&config, "defaultEnvironment"))
        .unwrap_or_else(|| "prod".to_string());
    let environment = config.get("environments").and_then(|value| value.get(&environment_name));
    let auth_env = environment
        .and_then(|value| read_string(value, "authEnv"))
        .unwrap_or_else(|| "SYNTH_API_KEY".to_string());
    env::var(&auth_env)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            environment
                .and_then(|value| read_string(value, "authEnvFile"))
                .map(|path| resolve_config_path(app_root, &path))
                .and_then(|path| read_env_file_value(&path, &auth_env))
        })
}

fn read_string(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

fn resolve_config_path(app_root: &Path, path: &str) -> PathBuf {
    let path = PathBuf::from(path);
    if path.is_absolute() {
        path
    } else {
        app_root.join(path)
    }
}

fn read_env_file_value(path: &Path, key: &str) -> Option<String> {
    for line in std::fs::read_to_string(path).ok()?.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line);
        let Some((name, value)) = line.split_once('=') else {
            continue;
        };
        if name.trim() != key {
            continue;
        }
        let value = unquote_env_value(value.trim());
        if !value.is_empty() {
            return Some(value);
        }
    }
    None
}

fn unquote_env_value(value: &str) -> String {
    let bytes = value.as_bytes();
    if bytes.len() >= 2
        && ((bytes[0] == b'"' && bytes[bytes.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[bytes.len() - 1] == b'\''))
    {
        value[1..value.len() - 1].to_string()
    } else {
        value.to_string()
    }
}

fn bounded_string(value: &str, limit: usize) -> Option<String> {
    let text = value.trim();
    if text.is_empty() {
        return None;
    }
    Some(text.chars().take(limit).collect())
}

fn crash_outbox_path(state: &AppState) -> PathBuf {
    env::var("STACK_CRASH_REPORT_OUTBOX")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| state.paths.stack_dir.join("telemetry").join("crashes.jsonl"))
}

fn crash_reporting_disabled() -> bool {
    matches!(
        env::var("STACK_CRASH_REPORT")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "0" | "false" | "off" | "no"
    )
}

async fn count_crash_outbox_records(path: &Path) -> usize {
    let Ok(text) = tokio::fs::read_to_string(path).await else {
        return 0;
    };
    text.lines().filter(|line| !line.trim().is_empty()).count()
}

async fn read_crash_outbox_tail(path: &Path, limit: usize) -> Result<(usize, Vec<Value>), ApiError> {
    let text = tokio::fs::read_to_string(path).await.unwrap_or_default();
    let lines: Vec<&str> = text.lines().filter(|line| !line.trim().is_empty()).collect();
    let total = lines.len();
    let start = total.saturating_sub(limit);
    let mut items = Vec::new();
    for line in lines.into_iter().skip(start) {
        match serde_json::from_str::<Value>(line) {
            Ok(value) => items.push(value),
            Err(_) => continue,
        }
    }
    Ok((total, items))
}
