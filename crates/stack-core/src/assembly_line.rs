use serde::{Deserialize, Serialize};
use thiserror::Error;

// Assembly Lines: the process layer above Efforts. An AssemblyLine tracks the
// process position of one initiative — current station, open standards gate,
// owner, and next safe action — and binds to the records that carry the
// substance (Efforts, meta-threads, actors, evidence artifacts, the external
// Jstack ship bundle). One station schema, two presets (`ship`, `effort`),
// typed transition events, snapshot derived from the event log.
// See docs/ASSEMBLY_LINES.md.

/// One station in a preset. There is exactly one station schema; presets
/// differ only in which stations they order.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct AssemblyStationSpec {
    pub id: &'static str,
    pub title: &'static str,
    pub requires_evidence: bool,
}

const SHIP_STATIONS: &[AssemblyStationSpec] = &[
    station("intake", "Intake", false),
    station("problem_selection", "Problem selection", true),
    station("scope_lock", "Scope lock", true),
    station("build", "Build", true),
    station("internal_proof", "Internal proof", true),
    station("quality_review", "Quality review", true),
    station("staging", "Staging", true),
    station("prod", "Prod", true),
    station("readout", "Readout", true),
];

const EFFORT_STATIONS: &[AssemblyStationSpec] = &[
    station("intake", "Intake", false),
    station("plan", "Plan", true),
    station("execute", "Execute", true),
    station("validate", "Validate", true),
    station("review", "Review", true),
    station("ship", "Ship", true),
    station("monitor", "Monitor", true),
    station("follow_up", "Follow-up", true),
];

const fn station(id: &'static str, title: &'static str, requires_evidence: bool) -> AssemblyStationSpec {
    AssemblyStationSpec {
        id,
        title,
        requires_evidence,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssemblyPreset {
    Ship,
    Effort,
}

impl AssemblyPreset {
    pub fn as_str(&self) -> &'static str {
        match self {
            AssemblyPreset::Ship => "ship",
            AssemblyPreset::Effort => "effort",
        }
    }

    pub fn stations(&self) -> &'static [AssemblyStationSpec] {
        match self {
            AssemblyPreset::Ship => SHIP_STATIONS,
            AssemblyPreset::Effort => EFFORT_STATIONS,
        }
    }

    /// The station whose completion unlocks `assembly.shipped`.
    pub fn ship_station(&self) -> &'static str {
        match self {
            AssemblyPreset::Ship => "prod",
            AssemblyPreset::Effort => "ship",
        }
    }

    pub fn station_index(&self, station_id: &str) -> Option<usize> {
        self.stations().iter().position(|spec| spec.id == station_id)
    }
}

/// Standards gate verdicts. The set is closed and never contains "blocked":
/// a failed gate carries its own routing (next_owner + next_safe_action)
/// instead of an untyped limbo state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssemblyGateVerdict {
    Pass,
    Concern,
    Fail,
    NA,
}

impl AssemblyGateVerdict {
    pub fn as_str(&self) -> &'static str {
        match self {
            AssemblyGateVerdict::Pass => "pass",
            AssemblyGateVerdict::Concern => "concern",
            AssemblyGateVerdict::Fail => "fail",
            AssemblyGateVerdict::NA => "n_a",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AssemblyEventKind {
    #[serde(rename = "assembly.created")]
    Created,
    #[serde(rename = "assembly.station_started")]
    StationStarted,
    #[serde(rename = "assembly.station_completed")]
    StationCompleted,
    #[serde(rename = "assembly.gate_failed")]
    GateFailed,
    #[serde(rename = "assembly.gate_passed")]
    GatePassed,
    #[serde(rename = "assembly.shipped")]
    Shipped,
    #[serde(rename = "assembly.follow_up_due")]
    FollowUpDue,
}

impl AssemblyEventKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            AssemblyEventKind::Created => "assembly.created",
            AssemblyEventKind::StationStarted => "assembly.station_started",
            AssemblyEventKind::StationCompleted => "assembly.station_completed",
            AssemblyEventKind::GateFailed => "assembly.gate_failed",
            AssemblyEventKind::GatePassed => "assembly.gate_passed",
            AssemblyEventKind::Shipped => "assembly.shipped",
            AssemblyEventKind::FollowUpDue => "assembly.follow_up_due",
        }
    }
}

/// Bindings from a line to the records that carry the substance. The external
/// ship bundle path is a linked record (a Jstack markdown path), never a
/// second source of truth. Worker/effort association authority stays with the
/// worker meta-thread manifest (`gardener_thread_id`, `effort_ref`); reverse
/// indexes are consistency checks only.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AssemblyBindings {
    #[serde(default)]
    pub effort_ids: Vec<String>,
    #[serde(default)]
    pub meta_thread_ids: Vec<String>,
    #[serde(default)]
    pub worker_ids: Vec<String>,
    #[serde(default)]
    pub gardener_ids: Vec<String>,
    #[serde(default)]
    pub monitor_ids: Vec<String>,
    #[serde(default)]
    pub evidence_paths: Vec<String>,
    #[serde(default)]
    pub ship_bundle_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssemblyLineRecord {
    pub id: String,
    pub title: String,
    pub preset: AssemblyPreset,
    pub owner: String,
    pub created_at: String,
    #[serde(default)]
    pub bindings: AssemblyBindings,
}

/// A typed transition request against one line. Exactly one correct
/// transition exists per state; everything else is a typed error.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind")]
pub enum AssemblyTransition {
    #[serde(rename = "assembly.station_started")]
    StationStarted { station: String, actor_id: String },
    #[serde(rename = "assembly.station_completed")]
    StationCompleted {
        station: String,
        actor_id: String,
        #[serde(default)]
        evidence_paths: Vec<String>,
        #[serde(default)]
        note: Option<String>,
    },
    #[serde(rename = "assembly.gate_failed")]
    GateFailed {
        station: String,
        actor_id: String,
        verdict: AssemblyGateVerdict,
        next_owner: String,
        next_safe_action: String,
        #[serde(default)]
        evidence_paths: Vec<String>,
        #[serde(default)]
        note: Option<String>,
    },
    #[serde(rename = "assembly.gate_passed")]
    GatePassed {
        station: String,
        actor_id: String,
        verdict: AssemblyGateVerdict,
        #[serde(default)]
        evidence_paths: Vec<String>,
        #[serde(default)]
        note: Option<String>,
    },
    #[serde(rename = "assembly.shipped")]
    Shipped {
        actor_id: String,
        #[serde(default)]
        evidence_paths: Vec<String>,
        #[serde(default)]
        note: Option<String>,
    },
    #[serde(rename = "assembly.follow_up_due")]
    FollowUpDue {
        actor_id: String,
        due_at: String,
        #[serde(default)]
        note: Option<String>,
    },
}

/// Gate payload carried by gate_failed / gate_passed events. `next_owner` and
/// `next_safe_action` are required on failures.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AssemblyGatePayload {
    pub verdict: AssemblyGateVerdict,
    #[serde(default)]
    pub next_owner: Option<String>,
    #[serde(default)]
    pub next_safe_action: Option<String>,
}

/// One persisted event on a line's log.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssemblyEvent {
    pub event_id: String,
    pub seq: i64,
    pub line_id: String,
    pub kind: AssemblyEventKind,
    pub occurred_at: String,
    pub actor_id: String,
    #[serde(default)]
    pub station: Option<String>,
    #[serde(default)]
    pub evidence_paths: Vec<String>,
    #[serde(default)]
    pub gate: Option<AssemblyGatePayload>,
    #[serde(default)]
    pub due_at: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

/// An event validated against the projected state but not yet persisted.
#[derive(Debug, Clone)]
pub struct AssemblyEventDraft {
    pub kind: AssemblyEventKind,
    pub actor_id: String,
    pub station: Option<String>,
    pub evidence_paths: Vec<String>,
    pub gate: Option<AssemblyGatePayload>,
    pub due_at: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AssemblyStationState {
    Pending,
    Started,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AssemblyOpenGate {
    pub station: String,
    pub verdict: AssemblyGateVerdict,
    pub next_owner: String,
    pub next_safe_action: String,
    pub failed_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AssemblyEventView {
    pub event_id: String,
    pub kind: AssemblyEventKind,
    pub occurred_at: String,
    pub actor_id: String,
    #[serde(default)]
    pub station: Option<String>,
}

/// Projection of one line: where it stands and what happens next.
#[derive(Debug, Clone, Serialize)]
pub struct AssemblyLineSnapshot {
    pub line_id: String,
    pub title: String,
    pub preset: AssemblyPreset,
    pub owner: String,
    pub created_at: String,
    pub age_seconds: i64,
    pub current_station: String,
    pub station_state: AssemblyStationState,
    pub completed_stations: Vec<String>,
    pub open_gate: Option<AssemblyOpenGate>,
    pub shipped: bool,
    pub complete: bool,
    pub follow_up_due_at: Option<String>,
    pub bindings: AssemblyBindings,
    pub last_event: Option<AssemblyEventView>,
    pub next_action: String,
}

#[derive(Debug, Error)]
pub enum AssemblyLineError {
    #[error("not_found: assembly line {0} does not exist")]
    NotFound(String),
    #[error("unknown_preset: {0} (known: ship, effort)")]
    UnknownPreset(String),
    #[error("unknown_station: {station} is not a station of preset {preset}")]
    UnknownStation { station: String, preset: String },
    #[error("invalid_transition: {0}")]
    InvalidTransition(String),
    #[error("missing_evidence: station {station} requires at least one evidence artifact path to complete")]
    MissingEvidence { station: String },
    #[error("invalid_gate_event: {0}")]
    InvalidGateEvent(String),
    #[error("invalid_field: {0}")]
    InvalidField(String),
}

/// Internal projected state used for validation and snapshotting.
#[derive(Debug, Clone)]
struct AssemblyLineState {
    station_index: usize,
    station_state: AssemblyStationState,
    completed: Vec<String>,
    open_gate: Option<AssemblyOpenGate>,
    shipped: bool,
    complete: bool,
    follow_up_due_at: Option<String>,
    event_evidence: Vec<String>,
}

fn project_state(record: &AssemblyLineRecord, events: &[AssemblyEvent]) -> AssemblyLineState {
    let stations = record.preset.stations();
    let mut state = AssemblyLineState {
        station_index: 0,
        station_state: AssemblyStationState::Pending,
        completed: Vec::new(),
        open_gate: None,
        shipped: false,
        complete: false,
        follow_up_due_at: None,
        event_evidence: Vec::new(),
    };
    for event in events {
        for path in &event.evidence_paths {
            if !state.event_evidence.contains(path) {
                state.event_evidence.push(path.clone());
            }
        }
        match event.kind {
            AssemblyEventKind::Created => {}
            AssemblyEventKind::StationStarted => {
                state.station_state = AssemblyStationState::Started;
            }
            AssemblyEventKind::StationCompleted => {
                if let Some(station) = &event.station {
                    state.completed.push(station.clone());
                }
                if state.station_index + 1 < stations.len() {
                    state.station_index += 1;
                    state.station_state = AssemblyStationState::Pending;
                } else {
                    state.complete = true;
                }
            }
            AssemblyEventKind::GateFailed => {
                state.open_gate = Some(AssemblyOpenGate {
                    station: event.station.clone().unwrap_or_default(),
                    verdict: event
                        .gate
                        .as_ref()
                        .map(|gate| gate.verdict)
                        .unwrap_or(AssemblyGateVerdict::Fail),
                    next_owner: event
                        .gate
                        .as_ref()
                        .and_then(|gate| gate.next_owner.clone())
                        .unwrap_or_default(),
                    next_safe_action: event
                        .gate
                        .as_ref()
                        .and_then(|gate| gate.next_safe_action.clone())
                        .unwrap_or_default(),
                    failed_at: event.occurred_at.clone(),
                });
            }
            AssemblyEventKind::GatePassed => {
                state.open_gate = None;
            }
            AssemblyEventKind::Shipped => {
                state.shipped = true;
            }
            AssemblyEventKind::FollowUpDue => {
                state.follow_up_due_at = event.due_at.clone();
            }
        }
    }
    state
}

/// Validate one typed transition against the line's projected state. Returns
/// the event draft to persist, or a typed error surfacing the failure class.
pub fn validate_transition(
    record: &AssemblyLineRecord,
    events: &[AssemblyEvent],
    transition: &AssemblyTransition,
) -> Result<AssemblyEventDraft, AssemblyLineError> {
    let state = project_state(record, events);
    let stations = record.preset.stations();
    let current = stations[state.station_index];

    match transition {
        AssemblyTransition::StationStarted { station, actor_id } => {
            let index = require_station(record, station)?;
            require_actor(actor_id)?;
            if state.complete {
                return Err(AssemblyLineError::InvalidTransition(format!(
                    "line {} already completed every station",
                    record.id
                )));
            }
            if index != state.station_index {
                return Err(AssemblyLineError::InvalidTransition(format!(
                    "cannot start station {station}: current station is {} (stations complete in preset order)",
                    current.id
                )));
            }
            if state.station_state == AssemblyStationState::Started {
                return Err(AssemblyLineError::InvalidTransition(format!(
                    "station {station} is already started"
                )));
            }
            Ok(AssemblyEventDraft {
                kind: AssemblyEventKind::StationStarted,
                actor_id: actor_id.clone(),
                station: Some(station.clone()),
                evidence_paths: Vec::new(),
                gate: None,
                due_at: None,
                note: None,
            })
        }
        AssemblyTransition::StationCompleted {
            station,
            actor_id,
            evidence_paths,
            note,
        } => {
            let index = require_station(record, station)?;
            require_actor(actor_id)?;
            if state.complete {
                return Err(AssemblyLineError::InvalidTransition(format!(
                    "line {} already completed every station",
                    record.id
                )));
            }
            if index != state.station_index {
                return Err(AssemblyLineError::InvalidTransition(format!(
                    "cannot complete station {station}: current station is {} (skipping stations is rejected)",
                    current.id
                )));
            }
            if state.station_state != AssemblyStationState::Started {
                return Err(AssemblyLineError::InvalidTransition(format!(
                    "cannot complete station {station}: it was never started (assembly.station_started is required first)"
                )));
            }
            if let Some(gate) = &state.open_gate {
                return Err(AssemblyLineError::InvalidTransition(format!(
                    "cannot complete station {station}: gate open ({}) — next owner {} must {}",
                    gate.verdict.as_str(),
                    gate.next_owner,
                    gate.next_safe_action
                )));
            }
            let evidence = trimmed_paths(evidence_paths);
            if current.requires_evidence && evidence.is_empty() {
                return Err(AssemblyLineError::MissingEvidence {
                    station: station.clone(),
                });
            }
            Ok(AssemblyEventDraft {
                kind: AssemblyEventKind::StationCompleted,
                actor_id: actor_id.clone(),
                station: Some(station.clone()),
                evidence_paths: evidence,
                gate: None,
                due_at: None,
                note: trimmed_note(note),
            })
        }
        AssemblyTransition::GateFailed {
            station,
            actor_id,
            verdict,
            next_owner,
            next_safe_action,
            evidence_paths,
            note,
        } => {
            let index = require_station(record, station)?;
            require_actor(actor_id)?;
            if index != state.station_index {
                return Err(AssemblyLineError::InvalidTransition(format!(
                    "cannot fail a gate on station {station}: current station is {}",
                    current.id
                )));
            }
            if state.station_state != AssemblyStationState::Started {
                return Err(AssemblyLineError::InvalidTransition(format!(
                    "cannot fail a gate on station {station}: it was never started"
                )));
            }
            if !matches!(verdict, AssemblyGateVerdict::Concern | AssemblyGateVerdict::Fail) {
                return Err(AssemblyLineError::InvalidGateEvent(format!(
                    "gate_failed verdict must be concern or fail, got {}",
                    verdict.as_str()
                )));
            }
            if next_owner.trim().is_empty() {
                return Err(AssemblyLineError::InvalidGateEvent(
                    "gate_failed requires a non-empty next_owner".to_string(),
                ));
            }
            if next_safe_action.trim().is_empty() {
                return Err(AssemblyLineError::InvalidGateEvent(
                    "gate_failed requires a non-empty next_safe_action".to_string(),
                ));
            }
            Ok(AssemblyEventDraft {
                kind: AssemblyEventKind::GateFailed,
                actor_id: actor_id.clone(),
                station: Some(station.clone()),
                evidence_paths: trimmed_paths(evidence_paths),
                gate: Some(AssemblyGatePayload {
                    verdict: *verdict,
                    next_owner: Some(next_owner.trim().to_string()),
                    next_safe_action: Some(next_safe_action.trim().to_string()),
                }),
                due_at: None,
                note: trimmed_note(note),
            })
        }
        AssemblyTransition::GatePassed {
            station,
            actor_id,
            verdict,
            evidence_paths,
            note,
        } => {
            require_station(record, station)?;
            require_actor(actor_id)?;
            let Some(gate) = &state.open_gate else {
                return Err(AssemblyLineError::InvalidTransition(format!(
                    "cannot pass a gate on station {station}: no gate is open"
                )));
            };
            if gate.station != *station {
                return Err(AssemblyLineError::InvalidTransition(format!(
                    "cannot pass a gate on station {station}: the open gate is on station {}",
                    gate.station
                )));
            }
            if !matches!(verdict, AssemblyGateVerdict::Pass | AssemblyGateVerdict::NA) {
                return Err(AssemblyLineError::InvalidGateEvent(format!(
                    "gate_passed verdict must be pass or n_a, got {}",
                    verdict.as_str()
                )));
            }
            Ok(AssemblyEventDraft {
                kind: AssemblyEventKind::GatePassed,
                actor_id: actor_id.clone(),
                station: Some(station.clone()),
                evidence_paths: trimmed_paths(evidence_paths),
                gate: Some(AssemblyGatePayload {
                    verdict: *verdict,
                    next_owner: None,
                    next_safe_action: None,
                }),
                due_at: None,
                note: trimmed_note(note),
            })
        }
        AssemblyTransition::Shipped {
            actor_id,
            evidence_paths,
            note,
        } => {
            require_actor(actor_id)?;
            if state.shipped {
                return Err(AssemblyLineError::InvalidTransition(format!(
                    "line {} already recorded assembly.shipped",
                    record.id
                )));
            }
            let ship_station = record.preset.ship_station();
            if !state.completed.iter().any(|done| done == ship_station) {
                return Err(AssemblyLineError::InvalidTransition(format!(
                    "cannot record assembly.shipped: station {ship_station} is not completed"
                )));
            }
            Ok(AssemblyEventDraft {
                kind: AssemblyEventKind::Shipped,
                actor_id: actor_id.clone(),
                station: Some(ship_station.to_string()),
                evidence_paths: trimmed_paths(evidence_paths),
                gate: None,
                due_at: None,
                note: trimmed_note(note),
            })
        }
        AssemblyTransition::FollowUpDue {
            actor_id,
            due_at,
            note,
        } => {
            require_actor(actor_id)?;
            if !state.shipped {
                return Err(AssemblyLineError::InvalidTransition(
                    "cannot record assembly.follow_up_due before assembly.shipped".to_string(),
                ));
            }
            if due_at.trim().is_empty() {
                return Err(AssemblyLineError::InvalidField(
                    "follow_up_due requires a non-empty due_at timestamp".to_string(),
                ));
            }
            Ok(AssemblyEventDraft {
                kind: AssemblyEventKind::FollowUpDue,
                actor_id: actor_id.clone(),
                station: None,
                evidence_paths: Vec::new(),
                gate: None,
                due_at: Some(due_at.trim().to_string()),
                note: trimmed_note(note),
            })
        }
    }
}

/// Project the operator-facing snapshot for one line.
pub fn project_snapshot(
    record: &AssemblyLineRecord,
    events: &[AssemblyEvent],
    now: chrono::DateTime<chrono::Utc>,
) -> AssemblyLineSnapshot {
    let state = project_state(record, events);
    let stations = record.preset.stations();
    let current = stations[state.station_index];
    let mut bindings = record.bindings.clone();
    for path in &state.event_evidence {
        if !bindings.evidence_paths.contains(path) {
            bindings.evidence_paths.push(path.clone());
        }
    }
    let age_seconds = chrono::DateTime::parse_from_rfc3339(&record.created_at)
        .map(|created| (now - created.with_timezone(&chrono::Utc)).num_seconds().max(0))
        .unwrap_or(0);
    let next_action = if let Some(gate) = &state.open_gate {
        format!(
            "resolve gate on {} — {} must {}",
            gate.station, gate.next_owner, gate.next_safe_action
        )
    } else if state.complete && state.shipped {
        match &state.follow_up_due_at {
            Some(due_at) => format!("follow-up due {due_at}"),
            None => "record assembly.follow_up_due".to_string(),
        }
    } else if state.complete {
        "record assembly.shipped".to_string()
    } else if state
        .completed
        .iter()
        .any(|done| done == record.preset.ship_station())
        && !state.shipped
    {
        "record assembly.shipped".to_string()
    } else {
        match state.station_state {
            AssemblyStationState::Pending => format!("start station {}", current.id),
            AssemblyStationState::Started => {
                format!("complete station {} with evidence", current.id)
            }
        }
    };
    AssemblyLineSnapshot {
        line_id: record.id.clone(),
        title: record.title.clone(),
        preset: record.preset,
        owner: record.owner.clone(),
        created_at: record.created_at.clone(),
        age_seconds,
        current_station: current.id.to_string(),
        station_state: state.station_state,
        completed_stations: state.completed,
        open_gate: state.open_gate,
        shipped: state.shipped,
        complete: state.complete,
        follow_up_due_at: state.follow_up_due_at,
        bindings,
        last_event: events.last().map(|event| AssemblyEventView {
            event_id: event.event_id.clone(),
            kind: event.kind,
            occurred_at: event.occurred_at.clone(),
            actor_id: event.actor_id.clone(),
            station: event.station.clone(),
        }),
        next_action,
    }
}

fn require_station(record: &AssemblyLineRecord, station: &str) -> Result<usize, AssemblyLineError> {
    record
        .preset
        .station_index(station)
        .ok_or_else(|| AssemblyLineError::UnknownStation {
            station: station.to_string(),
            preset: record.preset.as_str().to_string(),
        })
}

fn require_actor(actor_id: &str) -> Result<(), AssemblyLineError> {
    if actor_id.trim().is_empty() {
        return Err(AssemblyLineError::InvalidField(
            "actor_id must be non-empty".to_string(),
        ));
    }
    Ok(())
}

fn trimmed_paths(paths: &[String]) -> Vec<String> {
    paths
        .iter()
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
        .collect()
}

fn trimmed_note(note: &Option<String>) -> Option<String> {
    note.as_deref()
        .map(str::trim)
        .filter(|note| !note.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(preset: AssemblyPreset) -> AssemblyLineRecord {
        AssemblyLineRecord {
            id: "asl_test_1".to_string(),
            title: "Test line".to_string(),
            preset,
            owner: "operator".to_string(),
            created_at: chrono::Utc::now().to_rfc3339(),
            bindings: AssemblyBindings::default(),
        }
    }

    fn persist(events: &mut Vec<AssemblyEvent>, draft: AssemblyEventDraft) {
        let seq = events.len() as i64 + 1;
        events.push(AssemblyEvent {
            event_id: format!("ase_{seq}"),
            seq,
            line_id: "asl_test_1".to_string(),
            kind: draft.kind,
            occurred_at: chrono::Utc::now().to_rfc3339(),
            actor_id: draft.actor_id,
            station: draft.station,
            evidence_paths: draft.evidence_paths,
            gate: draft.gate,
            due_at: draft.due_at,
            note: draft.note,
        });
    }

    fn start_and_complete(
        record: &AssemblyLineRecord,
        events: &mut Vec<AssemblyEvent>,
        station: &str,
    ) {
        let started = validate_transition(
            record,
            events,
            &AssemblyTransition::StationStarted {
                station: station.to_string(),
                actor_id: "worker_1".to_string(),
            },
        )
        .expect("start station");
        persist(events, started);
        let spec = record
            .preset
            .stations()
            .iter()
            .find(|spec| spec.id == station)
            .expect("station spec");
        let evidence = if spec.requires_evidence {
            vec![format!("evidence/{station}.md")]
        } else {
            Vec::new()
        };
        let completed = validate_transition(
            record,
            events,
            &AssemblyTransition::StationCompleted {
                station: station.to_string(),
                actor_id: "worker_1".to_string(),
                evidence_paths: evidence,
                note: None,
            },
        )
        .expect("complete station");
        persist(events, completed);
    }

    #[test]
    fn happy_path_ship_preset_walk() {
        let record = record(AssemblyPreset::Ship);
        let mut events = Vec::new();
        for spec in AssemblyPreset::Ship.stations() {
            start_and_complete(&record, &mut events, spec.id);
            if spec.id == "prod" {
                let shipped = validate_transition(
                    &record,
                    &events,
                    &AssemblyTransition::Shipped {
                        actor_id: "operator".to_string(),
                        evidence_paths: vec!["evidence/ship-receipt.md".to_string()],
                        note: None,
                    },
                )
                .expect("shipped after prod");
                persist(&mut events, shipped);
            }
        }
        let follow_up = validate_transition(
            &record,
            &events,
            &AssemblyTransition::FollowUpDue {
                actor_id: "operator".to_string(),
                due_at: "2026-07-13T00:00:00Z".to_string(),
                note: None,
            },
        )
        .expect("follow-up after shipped");
        persist(&mut events, follow_up);
        let snapshot = project_snapshot(&record, &events, chrono::Utc::now());
        assert!(snapshot.complete);
        assert!(snapshot.shipped);
        assert_eq!(snapshot.completed_stations.len(), 9);
        assert_eq!(snapshot.follow_up_due_at.as_deref(), Some("2026-07-13T00:00:00Z"));
    }

    #[test]
    fn happy_path_effort_preset_walk() {
        let record = record(AssemblyPreset::Effort);
        let mut events = Vec::new();
        for spec in AssemblyPreset::Effort.stations() {
            start_and_complete(&record, &mut events, spec.id);
            if spec.id == "ship" {
                let shipped = validate_transition(
                    &record,
                    &events,
                    &AssemblyTransition::Shipped {
                        actor_id: "operator".to_string(),
                        evidence_paths: Vec::new(),
                        note: None,
                    },
                )
                .expect("shipped after ship station");
                persist(&mut events, shipped);
            }
        }
        let snapshot = project_snapshot(&record, &events, chrono::Utc::now());
        assert!(snapshot.complete);
        assert!(snapshot.shipped);
        assert_eq!(snapshot.completed_stations.len(), 8);
    }

    #[test]
    fn skipping_stations_is_rejected() {
        let record = record(AssemblyPreset::Ship);
        let events = Vec::new();
        let error = validate_transition(
            &record,
            &events,
            &AssemblyTransition::StationStarted {
                station: "build".to_string(),
                actor_id: "worker_1".to_string(),
            },
        )
        .expect_err("skip must fail");
        assert!(matches!(error, AssemblyLineError::InvalidTransition(_)));
        assert!(error.to_string().starts_with("invalid_transition:"));
    }

    #[test]
    fn unknown_station_is_rejected() {
        let record = record(AssemblyPreset::Effort);
        let events = Vec::new();
        let error = validate_transition(
            &record,
            &events,
            &AssemblyTransition::StationStarted {
                station: "prod".to_string(),
                actor_id: "worker_1".to_string(),
            },
        )
        .expect_err("unknown station must fail");
        assert!(matches!(error, AssemblyLineError::UnknownStation { .. }));
        assert!(error.to_string().starts_with("unknown_station:"));
    }

    #[test]
    fn completion_without_evidence_is_rejected() {
        let record = record(AssemblyPreset::Ship);
        let mut events = Vec::new();
        start_and_complete(&record, &mut events, "intake");
        let started = validate_transition(
            &record,
            &events,
            &AssemblyTransition::StationStarted {
                station: "problem_selection".to_string(),
                actor_id: "worker_1".to_string(),
            },
        )
        .expect("start");
        persist(&mut events, started);
        let error = validate_transition(
            &record,
            &events,
            &AssemblyTransition::StationCompleted {
                station: "problem_selection".to_string(),
                actor_id: "worker_1".to_string(),
                evidence_paths: vec!["   ".to_string()],
                note: None,
            },
        )
        .expect_err("completion without evidence must fail");
        assert!(matches!(error, AssemblyLineError::MissingEvidence { .. }));
        assert!(error.to_string().starts_with("missing_evidence:"));
    }

    #[test]
    fn completion_without_start_is_rejected() {
        let record = record(AssemblyPreset::Ship);
        let events = Vec::new();
        let error = validate_transition(
            &record,
            &events,
            &AssemblyTransition::StationCompleted {
                station: "intake".to_string(),
                actor_id: "worker_1".to_string(),
                evidence_paths: Vec::new(),
                note: None,
            },
        )
        .expect_err("complete before start must fail");
        assert!(matches!(error, AssemblyLineError::InvalidTransition(_)));
    }

    #[test]
    fn gate_failed_requires_next_owner_and_next_safe_action() {
        let record = record(AssemblyPreset::Ship);
        let mut events = Vec::new();
        start_and_complete(&record, &mut events, "intake");
        let started = validate_transition(
            &record,
            &events,
            &AssemblyTransition::StationStarted {
                station: "problem_selection".to_string(),
                actor_id: "worker_1".to_string(),
            },
        )
        .expect("start");
        persist(&mut events, started);
        let error = validate_transition(
            &record,
            &events,
            &AssemblyTransition::GateFailed {
                station: "problem_selection".to_string(),
                actor_id: "gardener_1".to_string(),
                verdict: AssemblyGateVerdict::Fail,
                next_owner: " ".to_string(),
                next_safe_action: "re-run the standards gate".to_string(),
                evidence_paths: Vec::new(),
                note: None,
            },
        )
        .expect_err("gate_failed without next_owner must fail");
        assert!(matches!(error, AssemblyLineError::InvalidGateEvent(_)));
        let error = validate_transition(
            &record,
            &events,
            &AssemblyTransition::GateFailed {
                station: "problem_selection".to_string(),
                actor_id: "gardener_1".to_string(),
                verdict: AssemblyGateVerdict::Fail,
                next_owner: "worker_1".to_string(),
                next_safe_action: "".to_string(),
                evidence_paths: Vec::new(),
                note: None,
            },
        )
        .expect_err("gate_failed without next_safe_action must fail");
        assert!(matches!(error, AssemblyLineError::InvalidGateEvent(_)));
        assert!(error.to_string().starts_with("invalid_gate_event:"));
    }

    #[test]
    fn gate_failed_pass_verdict_is_rejected() {
        let record = record(AssemblyPreset::Ship);
        let mut events = Vec::new();
        start_and_complete(&record, &mut events, "intake");
        let started = validate_transition(
            &record,
            &events,
            &AssemblyTransition::StationStarted {
                station: "problem_selection".to_string(),
                actor_id: "worker_1".to_string(),
            },
        )
        .expect("start");
        persist(&mut events, started);
        let error = validate_transition(
            &record,
            &events,
            &AssemblyTransition::GateFailed {
                station: "problem_selection".to_string(),
                actor_id: "gardener_1".to_string(),
                verdict: AssemblyGateVerdict::Pass,
                next_owner: "worker_1".to_string(),
                next_safe_action: "fix and retry".to_string(),
                evidence_paths: Vec::new(),
                note: None,
            },
        )
        .expect_err("gate_failed with pass verdict must fail");
        assert!(matches!(error, AssemblyLineError::InvalidGateEvent(_)));
    }

    #[test]
    fn open_gate_holds_completion_until_gate_passed() {
        let record = record(AssemblyPreset::Effort);
        let mut events = Vec::new();
        start_and_complete(&record, &mut events, "intake");
        let started = validate_transition(
            &record,
            &events,
            &AssemblyTransition::StationStarted {
                station: "plan".to_string(),
                actor_id: "worker_1".to_string(),
            },
        )
        .expect("start plan");
        persist(&mut events, started);
        let failed = validate_transition(
            &record,
            &events,
            &AssemblyTransition::GateFailed {
                station: "plan".to_string(),
                actor_id: "gardener_1".to_string(),
                verdict: AssemblyGateVerdict::Concern,
                next_owner: "worker_1".to_string(),
                next_safe_action: "revise the plan against the quality bar".to_string(),
                evidence_paths: vec!["evidence/gate-review.md".to_string()],
                note: None,
            },
        )
        .expect("gate_failed accepted");
        persist(&mut events, failed);
        let error = validate_transition(
            &record,
            &events,
            &AssemblyTransition::StationCompleted {
                station: "plan".to_string(),
                actor_id: "worker_1".to_string(),
                evidence_paths: vec!["evidence/plan.md".to_string()],
                note: None,
            },
        )
        .expect_err("completion under open gate must fail");
        assert!(matches!(error, AssemblyLineError::InvalidTransition(_)));

        let snapshot = project_snapshot(&record, &events, chrono::Utc::now());
        let gate = snapshot.open_gate.expect("gate open in snapshot");
        assert_eq!(gate.station, "plan");
        assert_eq!(gate.next_owner, "worker_1");
        assert_eq!(gate.next_safe_action, "revise the plan against the quality bar");
        assert!(snapshot.next_action.contains("resolve gate on plan"));

        let passed = validate_transition(
            &record,
            &events,
            &AssemblyTransition::GatePassed {
                station: "plan".to_string(),
                actor_id: "gardener_1".to_string(),
                verdict: AssemblyGateVerdict::Pass,
                evidence_paths: Vec::new(),
                note: None,
            },
        )
        .expect("gate_passed accepted");
        persist(&mut events, passed);
        let completed = validate_transition(
            &record,
            &events,
            &AssemblyTransition::StationCompleted {
                station: "plan".to_string(),
                actor_id: "worker_1".to_string(),
                evidence_paths: vec!["evidence/plan.md".to_string()],
                note: None,
            },
        )
        .expect("completion after gate cleared");
        persist(&mut events, completed);
        let snapshot = project_snapshot(&record, &events, chrono::Utc::now());
        assert_eq!(snapshot.current_station, "execute");
        assert!(snapshot.open_gate.is_none());
    }

    #[test]
    fn shipped_requires_ship_station_completion() {
        let record = record(AssemblyPreset::Ship);
        let mut events = Vec::new();
        start_and_complete(&record, &mut events, "intake");
        let error = validate_transition(
            &record,
            &events,
            &AssemblyTransition::Shipped {
                actor_id: "operator".to_string(),
                evidence_paths: Vec::new(),
                note: None,
            },
        )
        .expect_err("shipped before prod must fail");
        assert!(matches!(error, AssemblyLineError::InvalidTransition(_)));
    }

    #[test]
    fn snapshot_projection_tracks_station_gate_and_evidence() {
        let record = record(AssemblyPreset::Ship);
        let mut events = Vec::new();
        start_and_complete(&record, &mut events, "intake");
        start_and_complete(&record, &mut events, "problem_selection");
        let snapshot = project_snapshot(&record, &events, chrono::Utc::now());
        assert_eq!(snapshot.preset, AssemblyPreset::Ship);
        assert_eq!(snapshot.current_station, "scope_lock");
        assert_eq!(snapshot.station_state, AssemblyStationState::Pending);
        assert_eq!(
            snapshot.completed_stations,
            vec!["intake".to_string(), "problem_selection".to_string()]
        );
        assert!(snapshot
            .bindings
            .evidence_paths
            .contains(&"evidence/problem_selection.md".to_string()));
        assert_eq!(snapshot.next_action, "start station scope_lock");
        assert!(!snapshot.shipped);
        assert!(!snapshot.complete);
        let last = snapshot.last_event.expect("last event present");
        assert_eq!(last.kind, AssemblyEventKind::StationCompleted);
        assert_eq!(last.station.as_deref(), Some("problem_selection"));
    }
}
