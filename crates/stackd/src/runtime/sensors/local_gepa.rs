use crate::runtime::sensors::SensorPoll;
use chrono::Utc;
use reqwest::Client;
use serde_json::{json, Value};
use stack_core::runtime_event::{RuntimeCorrelation, RuntimeEventDraft, RuntimeSubject};
use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

const DEFAULT_OPTIMIZER_SERVICE_URL: &str = "http://127.0.0.1:8879";
const LOCAL_GEPA_TIMEOUT: Duration = Duration::from_secs(2);

pub async fn poll(client: &Client, prior_cursor: Value) -> SensorPoll {
    let base_url = std::env::var("STACK_OPTIMIZER_SERVICE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_OPTIMIZER_SERVICE_URL.to_string());
    let mut cursor = LocalGepaCursor::from_value(prior_cursor);
    let observed_at = Utc::now().to_rfc3339();
    let mut events = Vec::new();

    match client
        .get(format!("{}/health", base_url.trim_end_matches('/')))
        .timeout(LOCAL_GEPA_TIMEOUT)
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => {
            if cursor.service_status.as_deref() != Some("reachable")
                || cursor.service_url.as_deref() != Some(base_url.as_str())
            {
                events.push(service_event(
                    "sensor.local_gepa.service.reachable",
                    "local_gepa_service",
                    &observed_at,
                    json!({ "service_url": base_url }),
                ));
            }
            cursor.service_status = Some("reachable".to_string());
            cursor.service_url = Some(base_url.clone());
        }
        Ok(response) => {
            let status = response.status().as_u16();
            if cursor.service_status.as_deref() != Some("unreachable")
                || cursor.service_url.as_deref() != Some(base_url.as_str())
            {
                events.push(service_event(
                    "sensor.local_gepa.service.unreachable",
                    "local_gepa_service",
                    &observed_at,
                    json!({ "service_url": base_url, "status": status }),
                ));
            }
            cursor.service_status = Some("unreachable".to_string());
            cursor.service_url = Some(base_url);
            cursor.runs.clear();
            return SensorPoll {
                events,
                cursor: cursor.into_value(),
            };
        }
        Err(error) => {
            if cursor.service_status.as_deref() != Some("unreachable")
                || cursor.service_url.as_deref() != Some(base_url.as_str())
            {
                events.push(service_event(
                    "sensor.local_gepa.service.unreachable",
                    "local_gepa_service",
                    &observed_at,
                    json!({ "service_url": base_url, "error": error.to_string() }),
                ));
            }
            cursor.service_status = Some("unreachable".to_string());
            cursor.service_url = Some(base_url);
            cursor.runs.clear();
            return SensorPoll {
                events,
                cursor: cursor.into_value(),
            };
        }
    }

    if let Ok(runs) = fetch_runs(client, &base_url).await {
        let mut observed_run_ids = BTreeSet::new();
        for run in runs {
            observed_run_ids.insert(run.run_id.clone());
            let previous = cursor.runs.get(&run.run_id);
            if run.is_terminal() && previous.is_none_or(|prior| !prior.is_terminal()) {
                events.push(run_event(
                    if run.is_failed() {
                        "sensor.local_gepa.run.failed"
                    } else {
                        "sensor.local_gepa.run.completed"
                    },
                    &run,
                    &observed_at,
                    previous.cloned(),
                ));
            } else if previous.is_none() {
                events.push(run_event(
                    "sensor.local_gepa.run.discovered",
                    &run,
                    &observed_at,
                    None,
                ));
            } else if previous.is_some_and(|prior| run.phase_tuple_changed(prior)) {
                events.push(run_event(
                    "sensor.local_gepa.run.phase_changed",
                    &run,
                    &observed_at,
                    previous.cloned(),
                ));
            }
            if previous.is_some_and(|prior| run.progress_changed(prior)) {
                events.push(run_event(
                    "sensor.local_gepa.run.progress",
                    &run,
                    &observed_at,
                    previous.cloned(),
                ));
            }
            cursor.runs.insert(run.run_id.clone(), run);
        }
        let unobserved = cursor
            .runs
            .values()
            .filter(|run| !observed_run_ids.contains(&run.run_id) && !run.is_terminal())
            .cloned()
            .collect::<Vec<_>>();
        for run in unobserved {
            events.push(run_event(
                "sensor.local_gepa.run.unobserved",
                &run,
                &observed_at,
                Some(run.clone()),
            ));
            cursor.runs.remove(&run.run_id);
        }
    }

    SensorPoll {
        events,
        cursor: cursor.into_value(),
    }
}

async fn fetch_runs(client: &Client, base_url: &str) -> Result<Vec<GepaRunCursor>, reqwest::Error> {
    let payload = client
        .get(format!("{}/runs?limit=12", base_url.trim_end_matches('/')))
        .timeout(LOCAL_GEPA_TIMEOUT)
        .send()
        .await?
        .error_for_status()?
        .json::<Value>()
        .await?;
    let values = payload
        .as_array()
        .cloned()
        .or_else(|| payload.get("runs").and_then(Value::as_array).cloned())
        .unwrap_or_default();
    Ok(values
        .into_iter()
        .filter_map(|value| GepaRunCursor::from_value(&value))
        .collect())
}

fn service_event(
    event_type: &str,
    subject_id: &str,
    observed_at: &str,
    payload: Value,
) -> RuntimeEventDraft {
    RuntimeEventDraft {
        event_type: event_type.to_string(),
        source: "sensor.local_gepa".to_string(),
        observed_at: observed_at.to_string(),
        subject: RuntimeSubject {
            kind: "local_gepa_service".to_string(),
            id: subject_id.to_string(),
        },
        correlation: RuntimeCorrelation::default(),
        payload,
    }
}

fn run_event(
    event_type: &str,
    run: &GepaRunCursor,
    observed_at: &str,
    previous: Option<GepaRunCursor>,
) -> RuntimeEventDraft {
    RuntimeEventDraft {
        event_type: event_type.to_string(),
        source: "sensor.local_gepa".to_string(),
        observed_at: observed_at.to_string(),
        subject: RuntimeSubject {
            kind: "local_gepa_run".to_string(),
            id: run.run_id.clone(),
        },
        correlation: RuntimeCorrelation {
            optimizer_run_id: Some(run.run_id.clone()),
            ..RuntimeCorrelation::default()
        },
        payload: json!({
            "run_id": run.run_id,
            "status": run.status,
            "phase": run.phase,
            "generation": run.generation,
            "candidate_count": run.candidate_count,
            "cost_usd": run.cost_usd,
            "best_candidate_id": run.best_candidate_id,
            "error": run.error,
            "previous": previous,
        }),
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct LocalGepaCursor {
    service_status: Option<String>,
    service_url: Option<String>,
    #[serde(default)]
    runs: BTreeMap<String, GepaRunCursor>,
}

impl LocalGepaCursor {
    fn from_value(value: Value) -> Self {
        serde_json::from_value(value).unwrap_or(Self {
            service_status: None,
            service_url: None,
            runs: BTreeMap::new(),
        })
    }

    fn into_value(self) -> Value {
        serde_json::to_value(self).unwrap_or_else(|_| json!({}))
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct GepaRunCursor {
    run_id: String,
    status: Option<String>,
    phase: Option<String>,
    generation: Option<i64>,
    candidate_count: Option<i64>,
    cost_usd: Option<f64>,
    best_candidate_id: Option<String>,
    error: Option<String>,
}

impl GepaRunCursor {
    fn from_value(value: &Value) -> Option<Self> {
        let run_id = read_string(value, "runId").or_else(|| read_string(value, "run_id"))?;
        Some(Self {
            run_id,
            status: read_string(value, "status"),
            phase: read_string(value, "phase"),
            generation: read_i64(value, "generation"),
            candidate_count: read_i64(value, "candidateCount")
                .or_else(|| read_i64(value, "candidate_count")),
            cost_usd: read_f64(value, "costUsd").or_else(|| read_f64(value, "cost_usd")),
            best_candidate_id: read_string(value, "bestCandidateId")
                .or_else(|| read_string(value, "best_candidate_id")),
            error: read_string(value, "error"),
        })
    }

    fn phase_tuple_changed(&self, prior: &Self) -> bool {
        self.status != prior.status
            || self.phase != prior.phase
            || self.generation != prior.generation
    }

    fn progress_changed(&self, prior: &Self) -> bool {
        self.candidate_count != prior.candidate_count || self.cost_usd != prior.cost_usd
    }

    fn is_terminal(&self) -> bool {
        let status = self
            .status
            .as_deref()
            .unwrap_or_default()
            .to_ascii_lowercase();
        matches!(
            status.as_str(),
            "completed"
                | "complete"
                | "done"
                | "failed"
                | "error"
                | "cancelled"
                | "canceled"
                | "stopped"
        )
    }

    fn is_failed(&self) -> bool {
        let status = self
            .status
            .as_deref()
            .unwrap_or_default()
            .to_ascii_lowercase();
        matches!(
            status.as_str(),
            "failed" | "error" | "cancelled" | "canceled" | "stopped"
        )
    }
}

fn read_string(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

fn read_i64(value: &Value, key: &str) -> Option<i64> {
    value.get(key).and_then(Value::as_i64)
}

fn read_f64(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(Value::as_f64)
}
