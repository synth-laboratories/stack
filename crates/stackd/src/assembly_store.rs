use anyhow::Context;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use stack_core::assembly_line::{
    validate_transition, AssemblyBindings, AssemblyEvent, AssemblyEventDraft, AssemblyLineError,
    AssemblyLineRecord, AssemblyPreset, AssemblyTransition,
};
use stack_core::config::StackPaths;
use std::path::PathBuf;

// SQLite persistence for Assembly Lines, following the RuntimeStore pattern:
// stackd owns `.stack/runtime/assembly.sqlite` with a record table plus an
// append-only per-line event log. Every transition is validated against the
// projected state (stack_core::assembly_line) inside one write transaction.

pub struct AssemblyStore {
    db_path: PathBuf,
}

#[derive(Debug)]
pub enum AssemblyStoreError {
    Line(AssemblyLineError),
    Storage(anyhow::Error),
}

impl From<AssemblyLineError> for AssemblyStoreError {
    fn from(error: AssemblyLineError) -> Self {
        Self::Line(error)
    }
}

impl From<anyhow::Error> for AssemblyStoreError {
    fn from(error: anyhow::Error) -> Self {
        Self::Storage(error)
    }
}

impl From<rusqlite::Error> for AssemblyStoreError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Storage(error.into())
    }
}

impl From<serde_json::Error> for AssemblyStoreError {
    fn from(error: serde_json::Error) -> Self {
        Self::Storage(error.into())
    }
}

pub struct CreateAssemblyLine {
    pub title: String,
    pub preset: AssemblyPreset,
    pub owner: String,
    pub bindings: AssemblyBindings,
    pub actor_id: String,
}

impl AssemblyStore {
    pub fn open(paths: &StackPaths) -> anyhow::Result<Self> {
        let runtime_dir = paths.stack_dir.join("runtime");
        std::fs::create_dir_all(&runtime_dir).context("create runtime dir")?;
        let store = Self {
            db_path: runtime_dir.join("assembly.sqlite"),
        };
        store.init()?;
        Ok(store)
    }

    pub fn create_line(
        &self,
        request: CreateAssemblyLine,
    ) -> Result<(AssemblyLineRecord, AssemblyEvent), AssemblyStoreError> {
        let title = request.title.trim();
        if title.is_empty() {
            return Err(
                AssemblyLineError::InvalidField("title must be non-empty".to_string()).into(),
            );
        }
        let owner = request.owner.trim();
        if owner.is_empty() {
            return Err(
                AssemblyLineError::InvalidField("owner must be non-empty".to_string()).into(),
            );
        }
        let actor_id = request.actor_id.trim();
        if actor_id.is_empty() {
            return Err(
                AssemblyLineError::InvalidField("actor_id must be non-empty".to_string()).into(),
            );
        }
        let now = Utc::now();
        let created_at = now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let record = AssemblyLineRecord {
            id: format!("asl_{}", now.timestamp_micros()),
            title: title.to_string(),
            preset: request.preset,
            owner: owner.to_string(),
            created_at: created_at.clone(),
            bindings: request.bindings,
        };
        let mut conn = self.connect()?;
        let tx = conn.transaction().map_err(anyhow::Error::from)?;
        tx.execute(
            "INSERT INTO assembly_lines (id, preset, owner, created_at, record_json) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                record.id,
                record.preset.as_str(),
                record.owner,
                record.created_at,
                serde_json::to_string(&record)?
            ],
        )?;
        let event = insert_event(
            &tx,
            &record.id,
            AssemblyEventDraft {
                kind: stack_core::assembly_line::AssemblyEventKind::Created,
                actor_id: actor_id.to_string(),
                station: Some(record.preset.stations()[0].id.to_string()),
                evidence_paths: Vec::new(),
                gate: None,
                due_at: None,
                note: None,
            },
            &created_at,
        )?;
        tx.commit().map_err(anyhow::Error::from)?;
        Ok((record, event))
    }

    pub fn list_lines(
        &self,
    ) -> Result<Vec<(AssemblyLineRecord, Vec<AssemblyEvent>)>, AssemblyStoreError> {
        let conn = self.connect()?;
        let mut stmt = conn
            .prepare("SELECT record_json FROM assembly_lines ORDER BY created_at DESC, id DESC")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut lines = Vec::new();
        for row in rows {
            let record: AssemblyLineRecord = serde_json::from_str(&row?)?;
            let events = load_events(&conn, &record.id)?;
            lines.push((record, events));
        }
        Ok(lines)
    }

    pub fn get_line(
        &self,
        line_id: &str,
    ) -> Result<(AssemblyLineRecord, Vec<AssemblyEvent>), AssemblyStoreError> {
        let conn = self.connect()?;
        let record = load_record(&conn, line_id)?;
        let events = load_events(&conn, line_id)?;
        Ok((record, events))
    }

    pub fn apply_transition(
        &self,
        line_id: &str,
        transition: &AssemblyTransition,
    ) -> Result<(AssemblyLineRecord, Vec<AssemblyEvent>, AssemblyEvent), AssemblyStoreError> {
        let mut conn = self.connect()?;
        let tx = conn.transaction().map_err(anyhow::Error::from)?;
        let record = load_record(&tx, line_id)?;
        let mut events = load_events(&tx, line_id)?;
        let draft = validate_transition(&record, &events, transition)?;
        let occurred_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let event = insert_event(&tx, line_id, draft, &occurred_at)?;
        tx.commit().map_err(anyhow::Error::from)?;
        events.push(event.clone());
        Ok((record, events, event))
    }

    fn init(&self) -> anyhow::Result<()> {
        let conn = self.connect()?;
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS assembly_lines (
              id TEXT PRIMARY KEY,
              preset TEXT NOT NULL,
              owner TEXT NOT NULL,
              created_at TEXT NOT NULL,
              record_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS assembly_events (
              seq INTEGER PRIMARY KEY AUTOINCREMENT,
              event_id TEXT NOT NULL UNIQUE,
              line_id TEXT NOT NULL,
              kind TEXT NOT NULL,
              occurred_at TEXT NOT NULL,
              actor_id TEXT NOT NULL,
              station TEXT,
              event_json TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_assembly_events_line_seq ON assembly_events(line_id, seq);
            ",
        )?;
        Ok(())
    }

    fn connect(&self) -> anyhow::Result<Connection> {
        Connection::open(&self.db_path).with_context(|| format!("open {}", self.db_path.display()))
    }
}

fn load_record(conn: &Connection, line_id: &str) -> Result<AssemblyLineRecord, AssemblyStoreError> {
    let record_json: Option<String> = conn
        .query_row(
            "SELECT record_json FROM assembly_lines WHERE id = ?1",
            params![line_id],
            |row| row.get(0),
        )
        .optional()?;
    let record_json =
        record_json.ok_or_else(|| AssemblyLineError::NotFound(line_id.to_string()))?;
    Ok(serde_json::from_str(&record_json)?)
}

fn load_events(conn: &Connection, line_id: &str) -> Result<Vec<AssemblyEvent>, AssemblyStoreError> {
    let mut stmt = conn.prepare(
        "SELECT event_json, seq FROM assembly_events WHERE line_id = ?1 ORDER BY seq ASC",
    )?;
    let rows = stmt.query_map(params![line_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;
    let mut events = Vec::new();
    for row in rows {
        let (event_json, seq) = row?;
        let mut event: AssemblyEvent = serde_json::from_str(&event_json)?;
        event.seq = seq;
        events.push(event);
    }
    Ok(events)
}

fn insert_event(
    conn: &Connection,
    line_id: &str,
    draft: AssemblyEventDraft,
    occurred_at: &str,
) -> Result<AssemblyEvent, AssemblyStoreError> {
    let mut event = AssemblyEvent {
        event_id: String::new(),
        seq: 0,
        line_id: line_id.to_string(),
        kind: draft.kind,
        occurred_at: occurred_at.to_string(),
        actor_id: draft.actor_id,
        station: draft.station,
        evidence_paths: draft.evidence_paths,
        gate: draft.gate,
        due_at: draft.due_at,
        note: draft.note,
    };
    conn.execute(
        "INSERT INTO assembly_events (event_id, line_id, kind, occurred_at, actor_id, station, event_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            "",
            line_id,
            event.kind.as_str(),
            event.occurred_at,
            event.actor_id,
            event.station,
            serde_json::to_string(&event)?
        ],
    )?;
    let seq = conn.last_insert_rowid();
    let event_id = format!("ase_{}_{}", Utc::now().timestamp_micros(), seq);
    event.seq = seq;
    event.event_id = event_id.clone();
    conn.execute(
        "UPDATE assembly_events SET event_id = ?1, event_json = ?2 WHERE seq = ?3",
        params![event_id, serde_json::to_string(&event)?, seq],
    )?;
    Ok(event)
}

#[cfg(test)]
mod tests {
    use super::*;
    use stack_core::assembly_line::{project_snapshot, AssemblyGateVerdict};

    fn temp_paths() -> StackPaths {
        let root = std::env::temp_dir().join(format!(
            "stackd-assembly-test-{}-{}",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        StackPaths {
            app_root: root.clone(),
            install_root: root.clone(),
            stack_global_dir: root.join("global"),
            stack_dir: root.join(".stack"),
            session_log_dir: root.join(".stack/sessions"),
            export_dir: root.join(".stack/exports"),
            runtime_status_path: root.join(".stack/runtime/status.json"),
            codex_home: root.join(".stack/codex-home"),
        }
    }

    fn create(store: &AssemblyStore, preset: AssemblyPreset) -> AssemblyLineRecord {
        let (record, event) = store
            .create_line(CreateAssemblyLine {
                title: "Store test line".to_string(),
                preset,
                owner: "operator".to_string(),
                bindings: AssemblyBindings::default(),
                actor_id: "operator".to_string(),
            })
            .expect("create line");
        assert_eq!(
            event.kind,
            stack_core::assembly_line::AssemblyEventKind::Created
        );
        record
    }

    #[test]
    fn store_persists_lines_and_validated_events() {
        let store = AssemblyStore::open(&temp_paths()).expect("open store");
        let record = create(&store, AssemblyPreset::Effort);

        store
            .apply_transition(
                &record.id,
                &AssemblyTransition::StationStarted {
                    station: "intake".to_string(),
                    actor_id: "worker_1".to_string(),
                },
            )
            .expect("start intake");
        store
            .apply_transition(
                &record.id,
                &AssemblyTransition::StationCompleted {
                    station: "intake".to_string(),
                    actor_id: "worker_1".to_string(),
                    evidence_paths: Vec::new(),
                    note: None,
                },
            )
            .expect("complete intake");

        let error = store
            .apply_transition(
                &record.id,
                &AssemblyTransition::StationStarted {
                    station: "execute".to_string(),
                    actor_id: "worker_1".to_string(),
                },
            )
            .expect_err("skipping plan must fail");
        match error {
            AssemblyStoreError::Line(AssemblyLineError::InvalidTransition(_)) => {}
            other => panic!("expected invalid_transition, got {other:?}"),
        }

        let (loaded, events) = store.get_line(&record.id).expect("get line");
        assert_eq!(loaded.id, record.id);
        assert_eq!(events.len(), 3);
        let snapshot = project_snapshot(&loaded, &events, Utc::now());
        assert_eq!(snapshot.current_station, "plan");
        assert_eq!(snapshot.next_action, "start station plan");

        let lines = store.list_lines().expect("list lines");
        assert_eq!(lines.len(), 1);
    }

    #[test]
    fn store_rejects_unknown_line() {
        let store = AssemblyStore::open(&temp_paths()).expect("open store");
        let error = store
            .apply_transition(
                "asl_missing",
                &AssemblyTransition::StationStarted {
                    station: "intake".to_string(),
                    actor_id: "worker_1".to_string(),
                },
            )
            .expect_err("missing line must fail");
        match error {
            AssemblyStoreError::Line(AssemblyLineError::NotFound(_)) => {}
            other => panic!("expected not_found, got {other:?}"),
        }
    }

    #[test]
    fn store_enforces_gate_payload_and_evidence() {
        let store = AssemblyStore::open(&temp_paths()).expect("open store");
        let record = create(&store, AssemblyPreset::Ship);
        store
            .apply_transition(
                &record.id,
                &AssemblyTransition::StationStarted {
                    station: "intake".to_string(),
                    actor_id: "worker_1".to_string(),
                },
            )
            .expect("start intake");
        store
            .apply_transition(
                &record.id,
                &AssemblyTransition::StationCompleted {
                    station: "intake".to_string(),
                    actor_id: "worker_1".to_string(),
                    evidence_paths: Vec::new(),
                    note: None,
                },
            )
            .expect("complete intake");
        store
            .apply_transition(
                &record.id,
                &AssemblyTransition::StationStarted {
                    station: "problem_selection".to_string(),
                    actor_id: "worker_1".to_string(),
                },
            )
            .expect("start problem_selection");

        let error = store
            .apply_transition(
                &record.id,
                &AssemblyTransition::StationCompleted {
                    station: "problem_selection".to_string(),
                    actor_id: "worker_1".to_string(),
                    evidence_paths: Vec::new(),
                    note: None,
                },
            )
            .expect_err("completion without evidence must fail");
        match error {
            AssemblyStoreError::Line(AssemblyLineError::MissingEvidence { .. }) => {}
            other => panic!("expected missing_evidence, got {other:?}"),
        }

        let error = store
            .apply_transition(
                &record.id,
                &AssemblyTransition::GateFailed {
                    station: "problem_selection".to_string(),
                    actor_id: "gardener_1".to_string(),
                    verdict: AssemblyGateVerdict::Fail,
                    next_owner: String::new(),
                    next_safe_action: "re-check the standards bar".to_string(),
                    evidence_paths: Vec::new(),
                    note: None,
                },
            )
            .expect_err("gate_failed without next_owner must fail");
        match error {
            AssemblyStoreError::Line(AssemblyLineError::InvalidGateEvent(_)) => {}
            other => panic!("expected invalid_gate_event, got {other:?}"),
        }
    }
}
