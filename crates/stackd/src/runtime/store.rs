use crate::runtime::runtime_status_projection;
use anyhow::Context;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use stack_core::config::StackPaths;
use stack_core::runtime_event::{RuntimeEvent, RuntimeEventDraft, RuntimeSubject};
use stack_core::runtime_state::FactorySnapshot;
use std::path::PathBuf;

pub struct RuntimeStore {
    db_path: PathBuf,
    status_path: PathBuf,
}

impl RuntimeStore {
    pub fn open(paths: &StackPaths) -> anyhow::Result<Self> {
        let runtime_dir = paths.stack_dir.join("runtime");
        std::fs::create_dir_all(&runtime_dir).context("create runtime dir")?;
        let store = Self {
            db_path: runtime_dir.join("factory.sqlite"),
            status_path: paths.runtime_status_path.clone(),
        };
        store.init()?;
        Ok(store)
    }

    pub fn append_events(&self, drafts: &[RuntimeEventDraft]) -> anyhow::Result<Vec<RuntimeEvent>> {
        if drafts.is_empty() {
            return Ok(Vec::new());
        }
        let mut conn = self.connect()?;
        let tx = conn.transaction()?;
        let mut events = Vec::with_capacity(drafts.len());
        for draft in drafts {
            let subject_json = serde_json::to_string(&draft.subject)?;
            let correlation_json = serde_json::to_string(&draft.correlation)?;
            let payload_json = serde_json::to_string(&draft.payload)?;
            tx.execute(
                "INSERT INTO runtime_events (event_id, event_type, source, observed_at, subject_kind, subject_id, subject_json, correlation_json, payload_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    "",
                    draft.event_type,
                    draft.source,
                    draft.observed_at,
                    draft.subject.kind,
                    draft.subject.id,
                    subject_json,
                    correlation_json,
                    payload_json
                ],
            )?;
            let seq = tx.last_insert_rowid();
            let event_id = format!("rt_{}_{}", Utc::now().timestamp_micros(), seq);
            tx.execute(
                "UPDATE runtime_events SET event_id = ?1 WHERE seq = ?2",
                params![event_id, seq],
            )?;
            events.push(RuntimeEvent {
                event_id,
                seq,
                event_type: draft.event_type.clone(),
                source: draft.source.clone(),
                observed_at: draft.observed_at.clone(),
                subject: draft.subject.clone(),
                correlation: draft.correlation.clone(),
                payload: draft.payload.clone(),
            });
        }
        tx.commit()?;
        Ok(events)
    }

    pub fn load_events(
        &self,
        after_seq: Option<i64>,
        limit: usize,
        source: Option<&str>,
    ) -> anyhow::Result<Vec<RuntimeEvent>> {
        let conn = self.connect()?;
        let limit = limit.clamp(1, 10_000) as i64;
        let after_seq = after_seq.unwrap_or(0);
        let mut events = Vec::new();
        if let Some(source) = source {
            let mut stmt = conn.prepare(
                "SELECT event_id, seq, event_type, source, observed_at, subject_json, correlation_json, payload_json FROM runtime_events WHERE seq > ?1 AND source = ?2 ORDER BY seq ASC LIMIT ?3",
            )?;
            let rows = stmt.query_map(params![after_seq, source, limit], row_to_event)?;
            for row in rows {
                events.push(row?);
            }
        } else {
            let mut stmt = conn.prepare(
                "SELECT event_id, seq, event_type, source, observed_at, subject_json, correlation_json, payload_json FROM runtime_events WHERE seq > ?1 ORDER BY seq ASC LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![after_seq, limit], row_to_event)?;
            for row in rows {
                events.push(row?);
            }
        }
        Ok(events)
    }

    pub fn load_events_for_reduction(&self) -> anyhow::Result<Vec<RuntimeEvent>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            "SELECT event_id, seq, event_type, source, observed_at, subject_json, correlation_json, payload_json FROM runtime_events ORDER BY seq ASC",
        )?;
        let rows = stmt.query_map([], row_to_event)?;
        let mut events = Vec::new();
        for row in rows {
            events.push(row?);
        }
        Ok(events)
    }

    pub fn load_cursor(&self, sensor_id: &str) -> anyhow::Result<Value> {
        let conn = self.connect()?;
        let text: Option<String> = conn
            .query_row(
                "SELECT cursor_json FROM runtime_cursors WHERE sensor_id = ?1",
                params![sensor_id],
                |row| row.get(0),
            )
            .optional()?;
        Ok(text
            .and_then(|value| serde_json::from_str(&value).ok())
            .unwrap_or_else(|| Value::Object(Default::default())))
    }

    pub fn save_cursor(&self, sensor_id: &str, cursor: &Value) -> anyhow::Result<()> {
        let conn = self.connect()?;
        conn.execute(
            "INSERT INTO runtime_cursors (sensor_id, cursor_json, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(sensor_id) DO UPDATE SET cursor_json = excluded.cursor_json, updated_at = excluded.updated_at",
            params![sensor_id, serde_json::to_string(cursor)?, Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn load_snapshot_record(&self) -> anyhow::Result<Option<FactorySnapshotRecord>> {
        let conn = self.connect()?;
        let row: Option<(String, usize)> = conn
            .query_row(
                "SELECT snapshot_json, events_appended FROM factory_snapshot WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get::<_, i64>(1)?.max(0) as usize)),
            )
            .optional()?;
        Ok(row.and_then(|(value, events_appended)| {
            serde_json::from_str(&value)
                .ok()
                .map(|snapshot| FactorySnapshotRecord {
                    snapshot,
                    events_appended,
                })
        }))
    }

    pub fn save_snapshot(
        &self,
        snapshot: &FactorySnapshot,
        events_appended: usize,
    ) -> anyhow::Result<()> {
        let conn = self.connect()?;
        conn.execute(
            "INSERT INTO factory_snapshot (id, snapshot_json, updated_at, events_appended) VALUES (1, ?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at, events_appended = excluded.events_appended",
            params![serde_json::to_string(snapshot)?, snapshot.updated_at, events_appended as i64],
        )?;
        Ok(())
    }

    pub fn write_status_projection(
        &self,
        snapshot: &FactorySnapshot,
        events_appended: usize,
    ) -> anyhow::Result<()> {
        if let Some(parent) = self.status_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let projection = runtime_status_projection(snapshot, events_appended);
        std::fs::write(&self.status_path, serde_json::to_vec_pretty(&projection)?)?;
        Ok(())
    }

    fn init(&self) -> anyhow::Result<()> {
        let conn = self.connect()?;
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS runtime_events (
              seq INTEGER PRIMARY KEY AUTOINCREMENT,
              event_id TEXT NOT NULL UNIQUE,
              event_type TEXT NOT NULL,
              source TEXT NOT NULL,
              observed_at TEXT NOT NULL,
              subject_kind TEXT NOT NULL,
              subject_id TEXT NOT NULL,
              subject_json TEXT NOT NULL,
              correlation_json TEXT NOT NULL,
              payload_json TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_runtime_events_type_seq ON runtime_events(event_type, seq);
            CREATE INDEX IF NOT EXISTS idx_runtime_events_source_seq ON runtime_events(source, seq);
            CREATE TABLE IF NOT EXISTS runtime_cursors (
              sensor_id TEXT PRIMARY KEY,
              cursor_json TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS factory_snapshot (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              snapshot_json TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              events_appended INTEGER NOT NULL DEFAULT 0
            );
            ",
        )?;
        ensure_column(
            &conn,
            "factory_snapshot",
            "events_appended",
            "ALTER TABLE factory_snapshot ADD COLUMN events_appended INTEGER NOT NULL DEFAULT 0",
        )?;
        ensure_column(
            &conn,
            "runtime_events",
            "subject_json",
            "ALTER TABLE runtime_events ADD COLUMN subject_json TEXT NOT NULL DEFAULT '{\"kind\":\"unknown\",\"id\":\"unknown\"}'",
        )?;
        conn.execute(
            "UPDATE runtime_events SET subject_json = json_object('kind', subject_kind, 'id', COALESCE(subject_id, '')) WHERE subject_json = '{\"kind\":\"unknown\",\"id\":\"unknown\"}'",
            [],
        )?;
        Ok(())
    }

    fn connect(&self) -> anyhow::Result<Connection> {
        Connection::open(&self.db_path).with_context(|| format!("open {}", self.db_path.display()))
    }
}

pub struct FactorySnapshotRecord {
    pub snapshot: FactorySnapshot,
    pub events_appended: usize,
}

fn ensure_column(
    conn: &Connection,
    table: &str,
    column: &str,
    alter_sql: &str,
) -> anyhow::Result<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for row in rows {
        if row? == column {
            return Ok(());
        }
    }
    conn.execute(alter_sql, [])?;
    Ok(())
}

fn row_to_event(row: &rusqlite::Row<'_>) -> rusqlite::Result<RuntimeEvent> {
    let subject_json: String = row.get(5)?;
    let correlation_json: String = row.get(6)?;
    let payload_json: String = row.get(7)?;
    Ok(RuntimeEvent {
        event_id: row.get(0)?,
        seq: row.get(1)?,
        event_type: row.get(2)?,
        source: row.get(3)?,
        observed_at: row.get(4)?,
        subject: serde_json::from_str(&subject_json).unwrap_or(RuntimeSubject {
            kind: "unknown".to_string(),
            id: "unknown".to_string(),
        }),
        correlation: serde_json::from_str(&correlation_json).unwrap_or_default(),
        payload: serde_json::from_str(&payload_json).unwrap_or(Value::Null),
    })
}
