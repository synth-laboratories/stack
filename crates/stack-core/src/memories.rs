use crate::config::StackPaths;
use chrono::{DateTime, Datelike, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::PathBuf;
use thiserror::Error;

// Runtime memories: typed, append-only STACK_MEMORY entries that agents
// (gardener, monitor, workers) and operators record while Stack runs. A memory
// kind is a registered noun with its own monthly guidance ledger; the MLDP set
// (mistake / learning / desire / papercut) ships as the built-in instances.
// Papercut keeps its pre-existing ledger dir so operator ctrl+f captures and
// the gardener friction mirror stay on the same files.
//
// Ledger format (one entry):
//   STACK_MEMORY|ts=<iso>|kind=<id>|severity=<LOW|MED|HIGH>|source=<src>|k=v...
//   <summary line>
//   [optional body lines]

pub const MEMORY_LEDGER_MARKER: &str = "STACK_MEMORY";

#[derive(Debug, Clone, Serialize)]
pub struct MemoryKindSpec {
    pub id: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    pub ledger_dir: &'static str,
    pub default_severity: MemorySeverity,
}

pub const MEMORY_KINDS: &[MemoryKindSpec] = &[
    MemoryKindSpec {
        id: "papercut",
        title: "Papercut",
        description:
            "Small repeated friction in a tool, surface, or workflow that costs time but has a workaround.",
        ledger_dir: "papercuts",
        default_severity: MemorySeverity::Low,
    },
    MemoryKindSpec {
        id: "mistake",
        title: "Mistake",
        description:
            "A known error that was made (wrong assumption, misused tool, broken invariant) worth not repeating.",
        ledger_dir: "mistakes",
        default_severity: MemorySeverity::Med,
    },
    MemoryKindSpec {
        id: "learning",
        title: "Learning",
        description: "A non-obvious pattern, tool behavior, or implementation insight that clicked.",
        ledger_dir: "learnings",
        default_severity: MemorySeverity::Low,
    },
    MemoryKindSpec {
        id: "desire",
        title: "Desire",
        description: "A standing wish: missing capability, product gap, or friction the user wants fixed.",
        ledger_dir: "desires",
        default_severity: MemorySeverity::Low,
    },
];

pub fn memory_kind(id: &str) -> Option<&'static MemoryKindSpec> {
    MEMORY_KINDS.iter().find(|kind| kind.id == id)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum MemorySeverity {
    Low,
    Med,
    High,
}

impl MemorySeverity {
    pub fn as_str(&self) -> &'static str {
        match self {
            MemorySeverity::Low => "LOW",
            MemorySeverity::Med => "MED",
            MemorySeverity::High => "HIGH",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemorySource {
    Gardener,
    Monitor,
    Worker,
    Operator,
    Tui,
    Mcp,
}

impl MemorySource {
    pub fn as_str(&self) -> &'static str {
        match self {
            MemorySource::Gardener => "gardener",
            MemorySource::Monitor => "monitor",
            MemorySource::Worker => "worker",
            MemorySource::Operator => "operator",
            MemorySource::Tui => "tui",
            MemorySource::Mcp => "mcp",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct RecordMemoryRequest {
    pub kind: String,
    pub summary: String,
    #[serde(default)]
    pub body: Option<String>,
    /// Relevant source or workflow file, optionally with :line.
    #[serde(default)]
    pub file: Option<String>,
    #[serde(default)]
    pub severity: Option<MemorySeverity>,
    pub source: MemorySource,
    /// Extra provenance stamped into the ledger line (thread_id, effort, run_id, ...).
    #[serde(default)]
    pub context: BTreeMap<String, String>,
    /// EffortBench run packet dir; when set, the entry is mirrored as JSONL
    /// into <packet>/memories.jsonl so eval scoring can attribute what a
    /// session registered. Callers in eval mode pass their STACKEVAL_PACKET.
    #[serde(default)]
    pub packet_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MemoryReceipt {
    pub kind: String,
    pub severity: MemorySeverity,
    pub path: String,
    pub line: String,
    pub ts: String,
    pub mirrored_to_packet: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct MemoryEntry {
    pub ts: String,
    pub kind: String,
    pub severity: String,
    pub source: String,
    pub fields: BTreeMap<String, String>,
    pub summary: String,
    pub body: Option<String>,
}

#[derive(Debug, Error)]
pub enum MemoryError {
    #[error("unknown memory kind: {0} (known: {})", known_kinds())]
    UnknownKind(String),
    #[error("memory summary must be non-empty")]
    EmptySummary,
    #[error("memory ledger io error: {0}")]
    Io(#[from] io::Error),
}

fn known_kinds() -> String {
    MEMORY_KINDS
        .iter()
        .map(|kind| kind.id)
        .collect::<Vec<_>>()
        .join(", ")
}

pub fn memory_ledger_path(
    paths: &StackPaths,
    kind: &MemoryKindSpec,
    now: DateTime<Utc>,
) -> PathBuf {
    let month = format!("{:04}-{:02}", now.year(), now.month());
    paths
        .stack_dir
        .join("guidance")
        .join("records")
        .join(kind.ledger_dir)
        .join(format!("{month}.md"))
}

pub fn record_memory(
    paths: &StackPaths,
    request: RecordMemoryRequest,
) -> Result<MemoryReceipt, MemoryError> {
    let kind =
        memory_kind(&request.kind).ok_or_else(|| MemoryError::UnknownKind(request.kind.clone()))?;
    let summary = request.summary.trim();
    if summary.is_empty() {
        return Err(MemoryError::EmptySummary);
    }
    let now = Utc::now();
    let ts = now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let severity = request.severity.unwrap_or(kind.default_severity);

    let mut fields: Vec<(String, String)> = vec![
        ("ts".into(), ts.clone()),
        ("kind".into(), kind.id.into()),
        ("severity".into(), severity.as_str().into()),
        ("source".into(), request.source.as_str().into()),
    ];
    if let Some(file) = request.file.as_deref().filter(|f| !f.trim().is_empty()) {
        fields.push(("file".into(), file.trim().into()));
    }
    for (key, value) in &request.context {
        if !key.trim().is_empty() && !value.trim().is_empty() {
            fields.push((key.trim().into(), value.trim().into()));
        }
    }
    let line = format!(
        "{MEMORY_LEDGER_MARKER}|{}",
        fields
            .iter()
            .map(|(key, value)| format!("{key}={}", sanitize_field(value)))
            .collect::<Vec<_>>()
            .join("|")
    );
    let body = request
        .body
        .as_deref()
        .map(str::trim)
        .filter(|body| !body.is_empty());
    let block = match body {
        Some(body) => format!("{line}\n{summary}\n{body}\n"),
        None => format!("{line}\n{summary}\n"),
    };

    let path = memory_ledger_path(paths, kind, now);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    if path.exists() {
        let mut existing = fs::read_to_string(&path)?;
        if !existing.ends_with('\n') {
            existing.push('\n');
        }
        fs::write(&path, format!("{existing}\n{block}"))?;
    } else {
        fs::write(&path, &block)?;
    }

    let mirrored_to_packet = mirror_to_packet(&request, kind, severity, summary, body, &ts, &path)?;

    Ok(MemoryReceipt {
        kind: kind.id.into(),
        severity,
        path: path.to_string_lossy().into_owned(),
        line,
        ts,
        mirrored_to_packet,
    })
}

fn mirror_to_packet(
    request: &RecordMemoryRequest,
    kind: &MemoryKindSpec,
    severity: MemorySeverity,
    summary: &str,
    body: Option<&str>,
    ts: &str,
    ledger_path: &std::path::Path,
) -> Result<bool, MemoryError> {
    let Some(packet_dir) = request
        .packet_dir
        .as_deref()
        .map(str::trim)
        .filter(|dir| !dir.is_empty())
    else {
        return Ok(false);
    };
    let packet = PathBuf::from(packet_dir);
    if !packet.is_dir() {
        return Ok(false);
    }
    let row = serde_json::json!({
        "ts": ts,
        "kind": kind.id,
        "severity": severity.as_str(),
        "source": request.source.as_str(),
        "summary": summary,
        "body": body,
        "file": request.file,
        "context": request.context,
        "ledger_path": ledger_path.to_string_lossy(),
    });
    let mirror_path = packet.join("memories.jsonl");
    let mut existing = if mirror_path.exists() {
        fs::read_to_string(&mirror_path)?
    } else {
        String::new()
    };
    if !existing.is_empty() && !existing.ends_with('\n') {
        existing.push('\n');
    }
    existing.push_str(&row.to_string());
    existing.push('\n');
    fs::write(&mirror_path, existing)?;
    Ok(true)
}

/// Read recent entries for one kind from its current + previous month ledgers.
pub fn list_memories(
    paths: &StackPaths,
    kind_id: &str,
    recent: usize,
) -> Result<Vec<MemoryEntry>, MemoryError> {
    let kind = memory_kind(kind_id).ok_or_else(|| MemoryError::UnknownKind(kind_id.into()))?;
    let now = Utc::now();
    let previous = previous_month(now);
    let mut entries: Vec<MemoryEntry> = Vec::new();
    for month in [previous, now] {
        let path = memory_ledger_path(paths, kind, month);
        if !path.exists() {
            continue;
        }
        entries.extend(parse_ledger(&fs::read_to_string(&path)?));
    }
    let start = entries.len().saturating_sub(recent);
    Ok(entries.split_off(start))
}

fn previous_month(now: DateTime<Utc>) -> DateTime<Utc> {
    now - chrono::Duration::days(i64::from(now.day()) + 1)
}

fn parse_ledger(content: &str) -> Vec<MemoryEntry> {
    let mut entries = Vec::new();
    let mut lines = content.lines().peekable();
    while let Some(line) = lines.next() {
        if !line.starts_with(MEMORY_LEDGER_MARKER) {
            continue;
        }
        let mut fields = BTreeMap::new();
        for pair in line.split('|').skip(1) {
            if let Some((key, value)) = pair.split_once('=') {
                fields.insert(key.to_string(), value.to_string());
            }
        }
        let summary = lines.next().unwrap_or_default().trim().to_string();
        let mut body_lines: Vec<&str> = Vec::new();
        while let Some(peeked) = lines.peek() {
            if peeked.starts_with(MEMORY_LEDGER_MARKER) {
                break;
            }
            body_lines.push(lines.next().unwrap_or_default());
        }
        let body = body_lines.join("\n").trim().to_string();
        entries.push(MemoryEntry {
            ts: fields.get("ts").cloned().unwrap_or_default(),
            kind: fields.get("kind").cloned().unwrap_or_default(),
            severity: fields.get("severity").cloned().unwrap_or_default(),
            source: fields.get("source").cloned().unwrap_or_default(),
            fields,
            summary,
            body: if body.is_empty() { None } else { Some(body) },
        });
    }
    entries
}

fn sanitize_field(value: &str) -> String {
    value
        .chars()
        .map(|c| if c == '|' || c == '\r' || c == '\n' { '_' } else { c })
        .collect()
}
