use crate::meta_thread::MetaThreadManifest;
use crate::session::StackLocalSession;
use serde::{Deserialize, Serialize};

/// Downstream Codex/Cursor resume contract captured at checkpoint time.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HarnessResumeState {
    pub provider: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backend_session_id: Option<String>,
    pub transport: String,
    pub resume_method: String,
    pub resume_phase: String,
}

/// Meta-thread lifecycle phase for Stack resume (distinct from monitor actor checkpoints).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MetaThreadCheckpointPhase {
    Unbound,
    Bound,
    GoalActive,
    GoalPaused,
    GoalBlocked,
    GoalDone,
    SegmentSealed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MetaThreadCheckpointState {
    pub phase: MetaThreadCheckpointPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta_thread_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub segment_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head_thread_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub goal_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub goal_objective: Option<String>,
}

pub fn harness_resume_from_session(
    session: &StackLocalSession,
    transport: Option<&str>,
    backend_session_id: Option<&str>,
) -> HarnessResumeState {
    let provider = session
        .harness
        .clone()
        .unwrap_or_else(|| "codex".to_string());
    let transport = transport.unwrap_or("exec").to_string();
    let backend_session_id = backend_session_id
        .map(str::to_string)
        .or_else(|| crate::session::thread_id_from_session(session));
    let resume_method = harness_resume_method(&provider, &transport, backend_session_id.as_deref());
    HarnessResumeState {
        provider,
        backend_session_id,
        transport,
        resume_method,
        resume_phase: "saved".to_string(),
    }
}

pub fn harness_resume_method(
    provider: &str,
    transport: &str,
    backend_session_id: Option<&str>,
) -> String {
    if backend_session_id.is_none() {
        return "fresh".to_string();
    }
    if provider == "cursor" {
        return "session/load".to_string();
    }
    if transport == "app-server" {
        return "thread/resume".to_string();
    }
    "exec-transcript".to_string()
}

pub fn meta_thread_checkpoint_state(
    session: &StackLocalSession,
    manifest: Option<&MetaThreadManifest>,
) -> MetaThreadCheckpointState {
    let meta_thread_id = session
        .meta_thread_id
        .clone()
        .or_else(|| manifest.map(|value| value.id.clone()));
    let segment_id = session
        .segment_id
        .clone()
        .or_else(|| manifest.map(|value| value.head_segment_id.clone()));
    let head_thread_id = manifest
        .map(|value| value.head_thread_id.clone())
        .or_else(|| Some(session.id.clone()));

    if meta_thread_id.is_none() {
        return MetaThreadCheckpointState {
            phase: MetaThreadCheckpointPhase::Unbound,
            meta_thread_id: None,
            segment_id: None,
            head_thread_id: None,
            goal_status: None,
            goal_objective: None,
        };
    }

    if let Some(manifest) = manifest {
        if manifest
            .segments
            .iter()
            .find(|segment| segment.segment_id == manifest.head_segment_id)
            .is_some_and(|segment| segment.status == "sealed")
        {
            return MetaThreadCheckpointState {
                phase: MetaThreadCheckpointPhase::SegmentSealed,
                meta_thread_id,
                segment_id,
                head_thread_id: Some(manifest.head_thread_id.clone()),
                goal_status: manifest.active_goal.as_ref().map(|goal| goal.status.clone()),
                goal_objective: manifest
                    .active_goal
                    .as_ref()
                    .map(|goal| goal.objective.clone()),
            };
        }
    }

    let goal = manifest.and_then(|value| value.active_goal.as_ref());
    if goal.is_none() {
        return MetaThreadCheckpointState {
            phase: MetaThreadCheckpointPhase::Bound,
            meta_thread_id,
            segment_id,
            head_thread_id,
            goal_status: None,
            goal_objective: None,
        };
    }

    let goal = goal.unwrap();
    let phase = match goal.status.trim().to_lowercase().as_str() {
        "paused" => MetaThreadCheckpointPhase::GoalPaused,
        "blocked" => MetaThreadCheckpointPhase::GoalBlocked,
        "done" | "cleared" | "completed" => MetaThreadCheckpointPhase::GoalDone,
        _ => MetaThreadCheckpointPhase::GoalActive,
    };

    MetaThreadCheckpointState {
        phase,
        meta_thread_id,
        segment_id,
        head_thread_id,
        goal_status: Some(goal.status.clone()),
        goal_objective: Some(goal.objective.clone()),
    }
}

pub fn enrich_checkpoint(
    mut checkpoint: crate::checkpoint::StackResumeCheckpoint,
    session: &StackLocalSession,
    manifest: Option<&MetaThreadManifest>,
    transport: Option<&str>,
    backend_session_id: Option<&str>,
) -> crate::checkpoint::StackResumeCheckpoint {
    if checkpoint.harness_resume.is_none() {
        checkpoint.harness_resume = Some(harness_resume_from_session(
            session,
            transport.or(checkpoint.codex_transport.as_deref()),
            backend_session_id.or(checkpoint.codex_thread_id.as_deref()),
        ));
    }
    if checkpoint.meta_thread_state.is_none() {
        checkpoint.meta_thread_state = Some(meta_thread_checkpoint_state(session, manifest));
    }
    if checkpoint.meta_thread_id.is_none() {
        checkpoint.meta_thread_id = session.meta_thread_id.clone();
    }
    if checkpoint.segment_id.is_none() {
        checkpoint.segment_id = session.segment_id.clone();
    }
    if checkpoint.codex_thread_id.is_none() {
        checkpoint.codex_thread_id = backend_session_id
            .map(str::to_string)
            .or_else(|| crate::session::thread_id_from_session(session));
    }
    checkpoint
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meta_thread::{MetaThreadActiveGoal, MetaThreadManifest, MetaThreadSegment, META_THREAD_SCHEMA};

    #[test]
    fn codex_app_server_uses_thread_resume() {
        assert_eq!(
            harness_resume_method("codex", "app-server", Some("thread-abc")),
            "thread/resume"
        );
    }

    #[test]
    fn cursor_uses_session_load() {
        assert_eq!(
            harness_resume_method("cursor", "acp", Some("sess-abc")),
            "session/load"
        );
    }

    #[test]
    fn goal_active_phase_from_manifest() {
        let session = StackLocalSession {
            id: "thread_1".to_string(),
            workspace_root: "/tmp".to_string(),
            started_at: "now".to_string(),
            codex_command: "codex".to_string(),
            codex_model: None,
            codex_thread_id: Some("codex-thread-1".to_string()),
            harness: Some("codex".to_string()),
            harness_model: None,
            role: None,
            display_name: None,
            meta_thread_id: Some("mt_1".to_string()),
            segment_id: Some("seg_1".to_string()),
            segment_role: None,
            predecessor_thread_id: None,
            usage_summary: None,
            turns: Vec::new(),
        };
        let manifest = MetaThreadManifest {
            schema: META_THREAD_SCHEMA.to_string(),
            id: "mt_1".to_string(),
            title: "test".to_string(),
            source: None,
            source_ref: None,
            repo_refs: Vec::new(),
            worktree_refs: Vec::new(),
            created_at: "now".to_string(),
            updated_at: "now".to_string(),
            segments: vec![MetaThreadSegment {
                segment_id: "seg_1".to_string(),
                thread_id: "thread_1".to_string(),
                role: "research".to_string(),
                agent_role: "worker".to_string(),
                model: "gpt".to_string(),
                reasoning_effort: "medium".to_string(),
                harness: "codex".to_string(),
                status: "active".to_string(),
                handoff_out: None,
                handoff_in: Vec::new(),
                predecessor_segment_id: None,
                started_at: "now".to_string(),
                sealed_at: None,
                usage_summary: None,
            }],
            head_segment_id: "seg_1".to_string(),
            head_thread_id: "thread_1".to_string(),
            artifacts: Vec::new(),
            handoffs: Vec::new(),
            decisions: Vec::new(),
            gardener_thread_id: None,
            monitor_profile: None,
            active_goal: Some(MetaThreadActiveGoal {
                objective: "ship resume".to_string(),
                status: "active".to_string(),
                acceptance_criteria: Vec::new(),
                blockers: Vec::new(),
            }),
            usage_summary: None,
        };
        let state = meta_thread_checkpoint_state(&session, Some(&manifest));
        assert_eq!(state.phase, MetaThreadCheckpointPhase::GoalActive);
        assert_eq!(state.goal_objective.as_deref(), Some("ship resume"));
    }
}
