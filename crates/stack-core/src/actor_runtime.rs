//! Generic actor runtime primitives shared by every aux-agent sub-runtime.
//!
//! A Stack thread is supervised by aux actors (monitor, gardener) that all follow the
//! same machinery: a durable actor-state file with a cursor over the thread event log,
//! a wake policy that turns pending events into queued triggers, and a pass consumer
//! (TS/LLM side) that records completion back through stackd. Role differences are
//! DATA on this module's `ActorRole` — new roles must not fork the lifecycle.

use serde_json::Value;
use std::path::{Path, PathBuf};

use crate::events::EventLogError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActorRole {
    Monitor,
    Gardener,
}

impl ActorRole {
    pub fn role_name(self) -> &'static str {
        match self {
            ActorRole::Monitor => "monitor",
            ActorRole::Gardener => "gardener",
        }
    }

    /// Directory under `.stack/actors/<thread>/` holding this role's actor-state files.
    pub fn actor_dir(self) -> &'static str {
        match self {
            ActorRole::Monitor => "monitors",
            ActorRole::Gardener => "gardeners",
        }
    }

    /// Event-type prefix this role emits (`monitor.` / `gardener.`).
    pub fn event_prefix(self) -> &'static str {
        match self {
            ActorRole::Monitor => "monitor.",
            ActorRole::Gardener => "gardener.",
        }
    }

    /// `actor_role` field value on events this role appends.
    pub fn event_actor_role(self) -> &'static str {
        self.role_name()
    }

    pub fn state_schema(self) -> &'static str {
        match self {
            ActorRole::Monitor => "stack/monitor-actor-state/v1",
            ActorRole::Gardener => "stack/gardener-actor-state/v1",
        }
    }

    pub fn trigger_queued_type(self) -> &'static str {
        match self {
            ActorRole::Monitor => "monitor.trigger_queued",
            ActorRole::Gardener => "gardener.trigger_queued",
        }
    }

    pub fn wake_type(self) -> &'static str {
        match self {
            ActorRole::Monitor => "monitor.wake",
            ActorRole::Gardener => "gardener.wake",
        }
    }

    pub fn pause_type(self) -> &'static str {
        match self {
            ActorRole::Monitor => "monitor.pause_for_restart",
            ActorRole::Gardener => "gardener.pause_for_restart",
        }
    }

    pub fn all() -> [ActorRole; 2] {
        [ActorRole::Monitor, ActorRole::Gardener]
    }
}

pub fn thread_actor_dir_path(
    stack_dir: &Path,
    thread_id: &str,
    role: ActorRole,
) -> Result<PathBuf, EventLogError> {
    let safe = crate::events::safe_thread_id(thread_id)?;
    Ok(stack_dir.join("actors").join(safe).join(role.actor_dir()))
}

pub fn event_id(event: &Value) -> Option<&str> {
    event.get("event_id").and_then(Value::as_str)
}

pub fn event_type(event: &Value) -> Option<&str> {
    event.get("type").and_then(Value::as_str)
}

/// True when an event was produced by the given role (by prefix or actor_role field).
pub fn is_role_event(event: &Value, role: ActorRole) -> bool {
    if event_type(event).is_some_and(|kind| kind.starts_with(role.event_prefix())) {
        return true;
    }
    event.get("actor_role").and_then(Value::as_str) == Some(role.event_actor_role())
}

/// Pending events for a role: everything after the cursor that the role itself did
/// not produce. The cursor advances only when a pass completes (single cursor owner).
pub fn events_after_cursor<'a>(
    events: &'a [Value],
    cursor: Option<&str>,
    role: ActorRole,
) -> Vec<&'a Value> {
    let index = cursor
        .and_then(|id| events.iter().position(|event| event_id(event) == Some(id)))
        .map(|index| index + 1)
        .unwrap_or(0);
    events
        .iter()
        .skip(index)
        .filter(|event| !is_role_event(event, role))
        .collect()
}

/// Event ids this role has already queued or consumed as triggers.
pub fn triggered_event_ids(events: &[Value], role: ActorRole, actor_id: &str) -> Vec<String> {
    let mut ids = Vec::new();
    for event in events {
        let kind = event_type(event);
        if kind != Some(role.trigger_queued_type()) && kind != Some(role.wake_type()) {
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
                ids.push(id.to_string());
            }
        }
    }
    ids
}

/// The role's latest sleep verbs: `next_wake_on` classes and optional `next_wake_at`
/// timestamp from the newest pause event. Schedulers must honor these hints.
pub struct NextWakeHints {
    pub next_wake_on: Option<Vec<String>>,
    pub next_wake_at: Option<String>,
}

pub fn latest_next_wake_hints(events: &[Value], role: ActorRole, actor_id: &str) -> NextWakeHints {
    for event in events.iter().rev() {
        if event_type(event) != Some(role.pause_type()) {
            continue;
        }
        if event.get("actor_id").and_then(Value::as_str) != Some(actor_id) {
            continue;
        }
        let payload = event.get("payload");
        let next_wake_on = payload
            .and_then(|payload| payload.get("next_wake_on"))
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(Value::as_str)
                    .map(|value| value.trim().to_ascii_lowercase())
                    .filter(|value| !value.is_empty())
                    .collect::<Vec<_>>()
            })
            .filter(|values| !values.is_empty());
        let next_wake_at = payload
            .and_then(|payload| payload.get("next_wake_at"))
            .and_then(Value::as_str)
            .map(str::to_string);
        return NextWakeHints {
            next_wake_on,
            next_wake_at,
        };
    }
    NextWakeHints {
        next_wake_on: None,
        next_wake_at: None,
    }
}
