use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeEvent {
    pub event_id: String,
    pub seq: i64,
    pub event_type: String,
    pub source: String,
    pub observed_at: String,
    pub subject: RuntimeSubject,
    #[serde(default)]
    pub correlation: RuntimeCorrelation,
    #[serde(default)]
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeEventDraft {
    pub event_type: String,
    pub source: String,
    pub observed_at: String,
    pub subject: RuntimeSubject,
    #[serde(default)]
    pub correlation: RuntimeCorrelation,
    #[serde(default)]
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeSubject {
    pub kind: String,
    pub id: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RuntimeCorrelation {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stack_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stackeval_packet_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub factory_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub optimizer_run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_sha: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub feature_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flag_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variant: Option<String>,
}
