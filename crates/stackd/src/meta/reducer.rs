//! MetaHarnessSnapshot reducer: a pure fold over one thread's event log plus its
//! durable actor states. No I/O, no clock — everything the TUI/MCP needs to render a
//! thread (goal phase, per-actor cursors/queues/wake hints, UI side-panel slot,
//! human headline) derives from the same ordered event stream.

use serde::Serialize;
use serde_json::Value;
use stack_core::actor_runtime::{
    event_id, event_type, latest_next_wake_hints, ActorRole,
};

#[derive(Debug, Clone, Serialize)]
pub struct MetaThreadSnapshot {
    pub schema: &'static str,
    pub thread_id: String,
    pub meta_thread_id: Option<String>,
    pub goal: GoalSnapshot,
    pub actors: Vec<ActorSnapshot>,
    pub ui: UiSnapshot,
    pub headline: Option<HeadlineSnapshot>,
    pub event_count: usize,
    pub last_event_id: Option<String>,
    pub last_event_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GoalSnapshot {
    pub phase: String,
    pub objective: Option<String>,
    pub status: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ActorSnapshot {
    pub actor_id: String,
    pub role: String,
    pub state: String,
    /// Cursor over the thread event log; advanced only by pass completion.
    pub cursor: Option<String>,
    /// Triggers queued for the pass consumer and not yet consumed by a wake.
    pub queued_triggers: Vec<String>,
    pub last_wake_reason: Option<String>,
    pub last_wake_at: Option<String>,
    pub next_wake_on: Option<Vec<String>>,
    pub next_wake_at: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct UiSnapshot {
    pub side_panel: Option<SidePanelSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SidePanelSnapshot {
    pub panel: String,
    pub view: Option<String>,
    pub opened_by: String,
    pub reason: Option<String>,
    pub opened_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HeadlineSnapshot {
    pub headline: Option<String>,
    pub note: Option<String>,
    pub status: Option<String>,
    pub observed_at: Option<String>,
}

pub fn reduce_thread(
    thread_id: &str,
    meta_thread_id: Option<&str>,
    events: &[Value],
    actor_states: &[(ActorRole, Value)],
) -> MetaThreadSnapshot {
    MetaThreadSnapshot {
        schema: "stack/meta-thread-snapshot/v1",
        thread_id: thread_id.to_string(),
        meta_thread_id: meta_thread_id.map(str::to_string),
        goal: reduce_goal(events),
        actors: reduce_actors(events, actor_states),
        ui: reduce_ui(events),
        headline: reduce_headline(events),
        event_count: events.len(),
        last_event_id: events.last().and_then(event_id).map(str::to_string),
        last_event_at: events.last().and_then(observed_at).map(str::to_string),
    }
}

fn reduce_goal(events: &[Value]) -> GoalSnapshot {
    let mut phase = "idle".to_string();
    let mut objective: Option<String> = None;
    let mut status: Option<String> = None;
    let mut updated_at: Option<String> = None;
    for event in events {
        let kind = event_type(event).unwrap_or_default();
        let payload = event.get("payload");
        let next_phase = match kind {
            "goal.started" => Some("active"),
            "goal.paused" => Some("paused"),
            "goal.resumed" => Some("active"),
            "goal.cleared" => Some("cleared"),
            "meta_thread.goal_updated" => {
                let updated_status = payload
                    .and_then(|payload| payload.get("status"))
                    .and_then(Value::as_str)
                    .unwrap_or("active");
                Some(match updated_status {
                    "paused" => "paused",
                    "cleared" => "cleared",
                    _ => "active",
                })
            }
            "monitor.goal_status" => {
                match payload
                    .and_then(|payload| payload.get("status"))
                    .and_then(Value::as_str)
                {
                    Some("goal_met") => Some("met"),
                    Some("goal_failed") => Some("failed"),
                    _ => None,
                }
            }
            _ => None,
        };
        if let Some(next_phase) = next_phase {
            phase = next_phase.to_string();
            updated_at = observed_at(event).map(str::to_string);
        }
        if let Some(value) = payload
            .and_then(|payload| payload.get("objective"))
            .and_then(Value::as_str)
        {
            if !value.trim().is_empty() {
                objective = Some(value.trim().to_string());
            }
        }
        if let Some(value) = payload
            .and_then(|payload| payload.get("status"))
            .and_then(Value::as_str)
        {
            if kind.starts_with("goal.") || kind == "meta_thread.goal_updated" {
                status = Some(value.to_string());
            }
        }
    }
    GoalSnapshot {
        phase,
        objective,
        status,
        updated_at,
    }
}

fn reduce_actors(events: &[Value], actor_states: &[(ActorRole, Value)]) -> Vec<ActorSnapshot> {
    let mut actors: Vec<ActorSnapshot> = Vec::new();
    for (role, state) in actor_states {
        let actor_id = state
            .get("monitor_actor_id")
            .or_else(|| state.get("actor_id"))
            .and_then(Value::as_str)
            .unwrap_or(role.role_name())
            .to_string();
        let hints = latest_next_wake_hints(events, *role, &actor_id);
        actors.push(ActorSnapshot {
            role: role.role_name().to_string(),
            state: state
                .get("state")
                .and_then(Value::as_str)
                .unwrap_or("idle")
                .to_string(),
            cursor: state
                .get("last_event_id")
                .and_then(Value::as_str)
                .map(str::to_string),
            queued_triggers: unconsumed_triggers(events, *role, &actor_id),
            last_wake_reason: last_wake_field(events, *role, &actor_id, "wake_reason"),
            last_wake_at: last_wake_observed_at(events, *role, &actor_id),
            next_wake_on: hints.next_wake_on,
            next_wake_at: hints.next_wake_at,
            actor_id,
        });
    }
    actors
}

/// Trigger ids queued for the role that no subsequent wake has consumed.
fn unconsumed_triggers(events: &[Value], role: ActorRole, actor_id: &str) -> Vec<String> {
    let mut queued: Vec<String> = Vec::new();
    for event in events {
        let kind = event_type(event);
        let is_queue = kind == Some(role.trigger_queued_type());
        let is_wake = kind == Some(role.wake_type());
        if !is_queue && !is_wake {
            continue;
        }
        if event.get("actor_id").and_then(Value::as_str) != Some(actor_id) {
            continue;
        }
        let ids: Vec<String> = event
            .get("payload")
            .and_then(|payload| payload.get("trigger_event_ids"))
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect();
        if is_queue {
            for id in ids {
                if !queued.contains(&id) {
                    queued.push(id);
                }
            }
        } else {
            queued.retain(|id| !ids.contains(id));
        }
    }
    queued
}

fn last_wake_field(
    events: &[Value],
    role: ActorRole,
    actor_id: &str,
    field: &str,
) -> Option<String> {
    events
        .iter()
        .rev()
        .find(|event| {
            event_type(event) == Some(role.wake_type())
                && event.get("actor_id").and_then(Value::as_str) == Some(actor_id)
        })
        .and_then(|event| event.get("payload"))
        .and_then(|payload| payload.get(field))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn last_wake_observed_at(events: &[Value], role: ActorRole, actor_id: &str) -> Option<String> {
    events
        .iter()
        .rev()
        .find(|event| {
            event_type(event) == Some(role.wake_type())
                && event.get("actor_id").and_then(Value::as_str) == Some(actor_id)
        })
        .and_then(observed_at)
        .map(str::to_string)
}

/// Fold the ui.* event family into the current side-panel slot. Operator Esc
/// (ui.panel_closed) always wins until the next agent open.
fn reduce_ui(events: &[Value]) -> UiSnapshot {
    let mut side_panel: Option<SidePanelSnapshot> = None;
    for event in events {
        match event_type(event).unwrap_or_default() {
            "ui.panel_opened" => {
                let payload = event.get("payload");
                let Some(panel) = payload
                    .and_then(|payload| payload.get("panel"))
                    .and_then(Value::as_str)
                else {
                    continue;
                };
                side_panel = Some(SidePanelSnapshot {
                    panel: panel.to_string(),
                    view: payload
                        .and_then(|payload| payload.get("view"))
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    opened_by: payload
                        .and_then(|payload| payload.get("opened_by"))
                        .and_then(Value::as_str)
                        .unwrap_or("operator")
                        .to_string(),
                    reason: payload
                        .and_then(|payload| payload.get("reason"))
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    opened_at: observed_at(event).map(str::to_string),
                });
            }
            "ui.panel_closed" => {
                side_panel = None;
            }
            "ui.panel_focus" => {
                if let (Some(current), Some(view)) = (
                    side_panel.as_mut(),
                    event
                        .get("payload")
                        .and_then(|payload| payload.get("view"))
                        .and_then(Value::as_str),
                ) {
                    current.view = Some(view.to_string());
                }
            }
            _ => {}
        }
    }
    UiSnapshot { side_panel }
}

/// The most recent for_human monitor update — the rollup line the gardener and the
/// TUI header surface when the side panel is closed.
fn reduce_headline(events: &[Value]) -> Option<HeadlineSnapshot> {
    events
        .iter()
        .rev()
        .find(|event| {
            event_type(event)
                .is_some_and(|kind| kind == "monitor.goal_status" || kind == "monitor.progress")
                && event
                    .get("payload")
                    .and_then(|payload| payload.get("for_human"))
                    .and_then(Value::as_bool)
                    == Some(true)
        })
        .map(|event| {
            let payload = event.get("payload");
            HeadlineSnapshot {
                headline: payload
                    .and_then(|payload| payload.get("headline"))
                    .and_then(Value::as_str)
                    .map(str::to_string),
                note: payload
                    .and_then(|payload| {
                        payload.get("note").or_else(|| payload.get("progress_note"))
                    })
                    .and_then(Value::as_str)
                    .map(str::to_string),
                status: payload
                    .and_then(|payload| payload.get("status"))
                    .and_then(Value::as_str)
                    .map(str::to_string),
                observed_at: observed_at(event).map(str::to_string),
            }
        })
}

fn observed_at(event: &Value) -> Option<&str> {
    event.get("observed_at").and_then(Value::as_str)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn event(id: &str, kind: &str, actor_id: &str, payload: Value) -> Value {
        json!({
            "event_id": id,
            "type": kind,
            "thread_id": "t1",
            "observed_at": format!("2026-07-01T00:00:{:02}Z", id.len()),
            "actor_id": actor_id,
            "actor_role": if kind.starts_with("monitor.") { "monitor" } else if kind.starts_with("gardener.") { "gardener" } else { "primary" },
            "payload": payload,
        })
    }

    #[test]
    fn snapshot_golden() {
        let events = vec![
            event("e1", "goal.started", "operator", json!({"objective": "ship the .2 release", "status": "active"})),
            event("e2", "agent.turn.completed", "primary_codex", json!({})),
            event("e3", "monitor.trigger_queued", "monitor_default", json!({"wake_reason": "turn_completed", "trigger_event_ids": ["e2"]})),
            event("e4", "ui.panel_opened", "monitor_default", json!({"panel": "monitor", "view": "events", "opened_by": "monitor", "reason": "goal review"})),
            event("e5", "monitor.goal_status", "monitor_default", json!({"status": "advancing", "for_human": true, "headline": "Baseline landed", "note": "baseline 0.087 established"})),
        ];
        let actor_state = json!({
            "schema": "stack/monitor-actor-state/v1",
            "monitor_actor_id": "monitor_default",
            "state": "idle",
            "last_event_id": "e1",
        });
        let snapshot = reduce_thread("t1", Some("mt1"), &events, &[(ActorRole::Monitor, actor_state)]);

        assert_eq!(snapshot.goal.phase, "active");
        assert_eq!(snapshot.goal.objective.as_deref(), Some("ship the .2 release"));
        let monitor = &snapshot.actors[0];
        assert_eq!(monitor.actor_id, "monitor_default");
        assert_eq!(monitor.cursor.as_deref(), Some("e1"));
        assert_eq!(monitor.queued_triggers, vec!["e2".to_string()]);
        let panel = snapshot.ui.side_panel.as_ref().expect("side panel open");
        assert_eq!(panel.panel, "monitor");
        assert_eq!(panel.opened_by, "monitor");
        let headline = snapshot.headline.as_ref().expect("headline");
        assert_eq!(headline.headline.as_deref(), Some("Baseline landed"));
        assert_eq!(snapshot.last_event_id.as_deref(), Some("e5"));
    }

    #[test]
    fn wake_consumes_triggers_and_esc_closes_panel() {
        let events = vec![
            event("e1", "agent.turn.completed", "primary_codex", json!({})),
            event("e2", "monitor.trigger_queued", "monitor_default", json!({"trigger_event_ids": ["e1"]})),
            event("e3", "monitor.wake", "monitor_default", json!({"wake_reason": "turn_completed", "trigger_event_ids": ["e1"]})),
            event("e4", "ui.panel_opened", "operator", json!({"panel": "gardener", "opened_by": "operator"})),
            event("e5", "ui.panel_closed", "operator", json!({"panel": "gardener"})),
            event("e6", "monitor.pause_for_restart", "monitor_default", json!({"next_wake_on": ["worker_event"], "next_wake_at": "2026-07-01T01:00:00Z"})),
        ];
        let actor_state = json!({"monitor_actor_id": "monitor_default", "state": "paused"});
        let snapshot = reduce_thread("t1", None, &events, &[(ActorRole::Monitor, actor_state)]);
        let monitor = &snapshot.actors[0];
        assert!(monitor.queued_triggers.is_empty(), "wake consumed the trigger");
        assert_eq!(monitor.last_wake_reason.as_deref(), Some("turn_completed"));
        assert_eq!(monitor.next_wake_on.as_deref(), Some(&["worker_event".to_string()][..]));
        assert_eq!(monitor.next_wake_at.as_deref(), Some("2026-07-01T01:00:00Z"));
        assert!(snapshot.ui.side_panel.is_none(), "Esc closed the panel");
        assert_eq!(snapshot.goal.phase, "idle");
    }
}
