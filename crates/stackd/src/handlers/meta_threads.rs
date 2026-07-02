use crate::handlers::ApiError;
use crate::server::AppState;
use crate::victorialogs::append_thread_event_projected;
use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use stack_core::codex_path::resolve_for_session;
use stack_core::events::read_thread_events;
use stack_core::meta_thread::{
    build_meta_thread_usage_summary, handoff_ref, meta_events_path, normalize_lifecycle_status,
    read_handoff, read_manifest, safe_segment, write_handoff, write_manifest, AgentConfig, Handoff,
    MetaThreadActiveGoal, MetaThreadArtifactRef, MetaThreadManifest, MetaThreadRemoteBinding,
    MetaThreadSegment, MonitorHeadline, META_THREAD_SCHEMA,
};
use stack_core::session::{
    build_usage_summary, read_session_by_id, read_usage_from_stdout, session_path,
    StackLocalSession, StackSessionUsageSummary, StackSessionUsageTotals,
};
use std::path::{Path as FsPath, PathBuf};
use std::sync::Arc;
use tokio::fs;
use tokio::io::AsyncWriteExt;

#[derive(Debug, Deserialize)]
pub struct CreateMetaThreadRequest {
    pub title: String,
    pub thread_id: String,
    pub role: Option<String>,
    pub model: String,
    pub reasoning_effort: String,
    pub harness: String,
    pub source: Option<String>,
    pub source_ref: Option<String>,
    #[serde(default)]
    pub repo_refs: Vec<String>,
    #[serde(default)]
    pub worktree_refs: Vec<String>,
    pub gardener_thread_id: Option<String>,
    pub monitor_profile: Option<String>,
    pub active_goal: Option<MetaThreadActiveGoal>,
}

#[derive(Debug, Deserialize)]
pub struct SealSegmentRequest {
    pub summary: Option<String>,
    pub artifact_type: Option<String>,
    pub title: Option<String>,
    pub body: Option<String>,
    pub status: Option<String>,
    pub recommended_next_action: Option<String>,
    pub successor_role: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ApproveArtifactRequest {
    pub approved_by: Option<String>,
    pub thread_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ContinueHandoffRequest {
    pub role: String,
    pub model: String,
    pub reasoning_effort: String,
    pub harness: String,
    pub harness_command: String,
    pub workspace_root: String,
    #[serde(default)]
    pub artifact_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateGoalRequest {
    pub objective: Option<String>,
    pub status: Option<String>,
    pub acceptance_criteria: Option<Vec<String>>,
    pub blockers: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct MetaThreadListQuery {
    pub lifecycle: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateLifecycleRequest {
    pub status: String,
    pub reason: Option<String>,
    pub actor_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTitleRequest {
    pub title: String,
    pub reason: Option<String>,
    pub actor_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct BindRemoteSmrRunRequest {
    pub smr_run_id: String,
    pub environment: String,
    pub api_base_url: String,
    pub project_id: Option<String>,
    pub factory_id: Option<String>,
    pub deployment_id: Option<String>,
    pub objective: Option<String>,
    pub remote_status: Option<String>,
    pub actor_id: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UpdateTitleResponse {
    pub manifest: MetaThreadManifest,
    pub event_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct BindRemoteSmrRunResponse {
    pub manifest: MetaThreadManifest,
    pub binding: MetaThreadRemoteBinding,
    pub event_id: String,
}

#[derive(Debug, Serialize)]
pub struct ContinueHandoffResponse {
    pub manifest: MetaThreadManifest,
    pub handoff: Handoff,
    pub session: StackLocalSession,
    pub prompt: String,
    pub session_path: String,
}

pub async fn list_meta_threads(
    State(state): State<Arc<AppState>>,
    Query(query): Query<MetaThreadListQuery>,
) -> Result<Json<Vec<MetaThreadManifest>>, ApiError> {
    let lifecycle = parse_lifecycle_filter(query.lifecycle.as_deref())?;
    let dir = state.paths.stack_dir.join("meta-threads");
    let mut entries = match fs::read_dir(&dir).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Json(Vec::new())),
        Err(error) => return Err(ApiError::internal(error.to_string())),
    };
    let mut manifests = Vec::new();
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|error| ApiError::internal(error.to_string()))?
    {
        let path = entry.path().join("manifest.json");
        if let Ok(text) = fs::read_to_string(&path).await {
            if let Ok(mut manifest) = serde_json::from_str::<MetaThreadManifest>(&text) {
                if lifecycle_matches(&manifest, lifecycle) {
                    enrich_monitor_headline(&state, &mut manifest).await;
                    manifests.push(manifest);
                }
            }
        }
    }
    manifests.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(Json(manifests))
}

pub async fn update_lifecycle(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(request): Json<UpdateLifecycleRequest>,
) -> Result<Json<MetaThreadManifest>, ApiError> {
    let status = normalize_lifecycle_status(&request.status)
        .ok_or_else(|| ApiError::bad_request("status must be live or archived"))?;
    let mut manifest = read_manifest(&state.paths.stack_dir, &id)
        .await
        .map_err(ApiError::from)?;
    let previous = normalize_lifecycle_status(&manifest.lifecycle_status)
        .unwrap_or("live")
        .to_string();
    if previous == status {
        return Ok(Json(manifest));
    }

    let actor_id = request
        .actor_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("gardener")
        .to_string();
    let reason = request
        .reason
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let updated_at = now();
    manifest.lifecycle_status = status.to_string();
    manifest.updated_at = updated_at.clone();
    if status == "archived" {
        manifest.archived_at = Some(updated_at);
        manifest.archived_by = Some(actor_id.clone());
        manifest.archive_reason = reason.clone();
    } else {
        manifest.archived_at = None;
        manifest.archived_by = None;
        manifest.archive_reason = None;
    }
    write_manifest(&state.paths.stack_dir, &manifest)
        .await
        .map_err(ApiError::from)?;
    append_meta_event(
        &state,
        &manifest.id,
        "meta_thread.lifecycle_updated",
        &manifest.head_thread_id,
        Some(&manifest.head_segment_id),
        None,
        json!({
            "from": previous,
            "to": status,
            "reason": reason,
            "actor_id": actor_id,
            "actor_role": "gardener",
        }),
    )
    .await?;
    Ok(Json(manifest))
}

pub async fn update_title(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(request): Json<UpdateTitleRequest>,
) -> Result<Json<UpdateTitleResponse>, ApiError> {
    let title = normalized_title(&request.title)?;
    let mut manifest = read_manifest(&state.paths.stack_dir, &id)
        .await
        .map_err(ApiError::from)?;
    let previous = manifest.title.clone();
    if previous == title {
        return Ok(Json(UpdateTitleResponse {
            manifest,
            event_id: None,
        }));
    }

    let actor_id = request
        .actor_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("operator")
        .to_string();
    let reason = request
        .reason
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    manifest.title = title.clone();
    manifest.updated_at = now();
    write_manifest(&state.paths.stack_dir, &manifest)
        .await
        .map_err(ApiError::from)?;

    if let Ok(mut session) =
        read_session_by_id(&state.paths.session_log_dir, &manifest.head_thread_id).await
    {
        session.display_name = Some(title.clone());
        if let Err(error) = write_session(&state.paths.session_log_dir, &session).await {
            tracing::warn!(
                status = %error.status,
                message = %error.message,
                "meta-thread title updated but head session displayName sync failed"
            );
        }
    }

    let event_id = append_meta_event(
        &state,
        &manifest.id,
        "meta_thread.title_updated",
        &manifest.head_thread_id,
        Some(&manifest.head_segment_id),
        None,
        json!({
            "previous_title": previous,
            "title": title,
            "reason": reason,
            "actor_id": actor_id,
        }),
    )
    .await?;
    Ok(Json(UpdateTitleResponse {
        manifest,
        event_id: Some(event_id),
    }))
}

pub async fn bind_remote_smr_run(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(request): Json<BindRemoteSmrRunRequest>,
) -> Result<Json<BindRemoteSmrRunResponse>, ApiError> {
    let smr_run_id = normalized_non_empty(&request.smr_run_id, "smr_run_id")?;
    let environment = normalized_non_empty(&request.environment, "environment")?;
    let api_base_url = normalized_non_empty(&request.api_base_url, "api_base_url")?;
    let actor_id = request
        .actor_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("remote_gardener")
        .to_string();
    let reason = normalize_optional_string(request.reason.as_deref());
    let mut manifest = read_manifest(&state.paths.stack_dir, &id)
        .await
        .map_err(ApiError::from)?;
    let binding = MetaThreadRemoteBinding {
        binding_id: format!("bind_remote_smr_{}", unique_suffix()),
        kind: "smr_run".to_string(),
        environment,
        api_base_url,
        project_id: normalize_optional_string(request.project_id.as_deref()),
        smr_run_id: smr_run_id.clone(),
        factory_id: normalize_optional_string(request.factory_id.as_deref()),
        deployment_id: normalize_optional_string(request.deployment_id.as_deref()),
        objective: normalize_optional_string(request.objective.as_deref()),
        remote_status: normalize_optional_string(request.remote_status.as_deref()),
        bound_at: now(),
        bound_by: actor_id.clone(),
        reason: reason.clone(),
    };
    manifest.smr_run_id = Some(smr_run_id.clone());
    manifest
        .remote_bindings
        .retain(|existing| !(existing.kind == "smr_run" && existing.smr_run_id == smr_run_id));
    manifest.remote_bindings.push(binding.clone());
    manifest.updated_at = binding.bound_at.clone();
    write_manifest(&state.paths.stack_dir, &manifest)
        .await
        .map_err(ApiError::from)?;
    let event_id = append_meta_event(
        &state,
        &manifest.id,
        "meta_thread.remote_smr_run_bound",
        &manifest.head_thread_id,
        Some(&manifest.head_segment_id),
        None,
        json!({
            "binding": binding,
            "smr_run_id": smr_run_id,
            "actor_id": actor_id,
            "actor_role": "remote_gardener",
            "reason": reason,
        }),
    )
    .await?;
    Ok(Json(BindRemoteSmrRunResponse {
        manifest,
        binding,
        event_id,
    }))
}

pub async fn get_meta_thread(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<MetaThreadManifest>, ApiError> {
    let mut manifest = read_manifest(&state.paths.stack_dir, &id)
        .await
        .map_err(ApiError::from)?;
    enrich_monitor_headline(&state, &mut manifest).await;
    Ok(Json(manifest))
}

fn normalized_title(raw: &str) -> Result<String, ApiError> {
    let title = raw.trim();
    if title.is_empty() {
        return Err(ApiError::bad_request("title is required"));
    }
    if title.chars().count() > 48 {
        return Err(ApiError::bad_request("title must be 48 characters or fewer"));
    }
    Ok(title.to_string())
}

fn normalized_non_empty(raw: &str, field: &str) -> Result<String, ApiError> {
    let value = raw.trim();
    if value.is_empty() {
        return Err(ApiError::bad_request(format!("{field} is required")));
    }
    Ok(value.to_string())
}

fn normalize_optional_string(raw: Option<&str>) -> Option<String> {
    raw.map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// Clamps an auto-derived title (from a goal objective) to the 48-char max instead of rejecting
/// it. `create_meta_thread` receives the objective as its title, so it must never fail just
/// because the objective is longer than a display title — that would silently break `/goal`.
/// Adds an ellipsis when truncated; falls back to a placeholder for an empty objective. Explicit
/// renames still go through `normalized_title`, which errors past the limit.
fn clamped_title(raw: &str) -> String {
    let title = raw.trim();
    if title.is_empty() {
        return "untitled goal".to_string();
    }
    if title.chars().count() <= 48 {
        return title.to_string();
    }
    let truncated: String = title.chars().take(47).collect();
    format!("{}…", truncated.trim_end())
}

pub async fn get_handoff(
    State(state): State<Arc<AppState>>,
    Path((id, handoff_id)): Path<(String, String)>,
) -> Result<Json<Handoff>, ApiError> {
    Ok(Json(
        read_handoff(&state.paths.stack_dir, &id, &handoff_id)
            .await
            .map_err(ApiError::from)?,
    ))
}

pub async fn create_meta_thread(
    State(state): State<Arc<AppState>>,
    Json(request): Json<CreateMetaThreadRequest>,
) -> Result<Json<MetaThreadManifest>, ApiError> {
    // Clamp (never reject) the auto-derived title: create receives the goal objective as its
    // title, which is routinely longer than the 48-char display cap. Rejecting it here silently
    // broke `/goal` (meta-thread never created, worker never started).
    let title = clamped_title(&request.title);
    let mut session = read_session_by_id(&state.paths.session_log_dir, &request.thread_id).await?;
    let now = now();
    let meta_thread_id = format!("mt_{}", unique_suffix());
    let segment_id = format!("seg_{}", unique_suffix());
    let role = request.role.unwrap_or_else(|| "research".to_string());
    bind_session(
        &mut session,
        &meta_thread_id,
        &segment_id,
        &role,
        &request.harness,
        &request.model,
        None,
    );
    let usage_summary = usage_summary_for_session(&state, &session).await;
    session.usage_summary = usage_summary.clone();
    write_session(&state.paths.session_log_dir, &session).await?;

    let segment = MetaThreadSegment {
        segment_id: segment_id.clone(),
        thread_id: session.id.clone(),
        role: role.clone(),
        agent_role: "worker".to_string(),
        model: request.model.clone(),
        reasoning_effort: request.reasoning_effort.clone(),
        harness: request.harness.clone(),
        status: "active".to_string(),
        handoff_out: None,
        handoff_in: Vec::new(),
        predecessor_segment_id: None,
        started_at: now.clone(),
        sealed_at: None,
        usage_summary,
    };
    let mut manifest = MetaThreadManifest {
        schema: META_THREAD_SCHEMA.to_string(),
        id: meta_thread_id.clone(),
        title,
        lifecycle_status: "live".to_string(),
        archived_at: None,
        archived_by: None,
        archive_reason: None,
        source: request.source,
        source_ref: request.source_ref,
        repo_refs: request.repo_refs,
        worktree_refs: if request.worktree_refs.is_empty() {
            vec![session.workspace_root.clone()]
        } else {
            request.worktree_refs
        },
        created_at: now.clone(),
        updated_at: now,
        segments: vec![segment],
        head_segment_id: segment_id.clone(),
        head_thread_id: session.id.clone(),
        artifacts: Vec::new(),
        handoffs: Vec::new(),
        decisions: Vec::new(),
        gardener_thread_id: request.gardener_thread_id,
        monitor_profile: request.monitor_profile,
        monitor_headline: None,
        active_goal: request.active_goal,
        smr_run_id: None,
        remote_bindings: Vec::new(),
        usage_summary: None,
    };
    manifest.usage_summary = build_meta_thread_usage_summary(&manifest);
    write_manifest(&state.paths.stack_dir, &manifest)
        .await
        .map_err(ApiError::from)?;
    append_meta_event(
        &state,
        &manifest.id,
        "meta_thread.created",
        &session.id,
        Some(&segment_id),
        None,
        json!({"title": manifest.title}),
    )
    .await?;
    append_meta_event(
        &state,
        &manifest.id,
        "meta_thread.segment_started",
        &session.id,
        Some(&segment_id),
        None,
        json!({"role": role, "model": request.model, "harness": request.harness}),
    )
    .await?;
    if manifest.active_goal.is_some() {
        append_meta_event(
            &state,
            &manifest.id,
            "meta_thread.goal_updated",
            &session.id,
            Some(&segment_id),
            None,
            json!({"active_goal": &manifest.active_goal}),
        )
        .await?;
    }
    Ok(Json(manifest))
}

pub async fn update_goal(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(request): Json<UpdateGoalRequest>,
) -> Result<Json<MetaThreadManifest>, ApiError> {
    let mut manifest = read_manifest(&state.paths.stack_dir, &id)
        .await
        .map_err(ApiError::from)?;
    let current = manifest.active_goal.clone();
    let objective = request
        .objective
        .or_else(|| current.as_ref().map(|goal| goal.objective.clone()))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request("objective is required when creating active_goal"))?;
    let status = request
        .status
        .or_else(|| current.as_ref().map(|goal| goal.status.clone()))
        .unwrap_or_else(|| "active".to_string());
    let acceptance_criteria = request
        .acceptance_criteria
        .or_else(|| {
            current
                .as_ref()
                .map(|goal| goal.acceptance_criteria.clone())
        })
        .unwrap_or_default();
    let blockers = request
        .blockers
        .or_else(|| current.as_ref().map(|goal| goal.blockers.clone()))
        .unwrap_or_default();
    manifest.active_goal = Some(MetaThreadActiveGoal {
        objective,
        status,
        acceptance_criteria,
        blockers,
    });
    manifest.updated_at = now();
    write_manifest(&state.paths.stack_dir, &manifest)
        .await
        .map_err(ApiError::from)?;
    append_meta_event(
        &state,
        &manifest.id,
        "meta_thread.goal_updated",
        &manifest.head_thread_id,
        Some(&manifest.head_segment_id),
        None,
        json!({"active_goal": &manifest.active_goal}),
    )
    .await?;
    Ok(Json(manifest))
}

pub async fn seal_segment(
    State(state): State<Arc<AppState>>,
    Path((id, segment_id)): Path<(String, String)>,
    Json(request): Json<SealSegmentRequest>,
) -> Result<Json<MetaThreadArtifactRef>, ApiError> {
    let mut manifest = read_manifest(&state.paths.stack_dir, &id)
        .await
        .map_err(ApiError::from)?;
    let segment_index = segment_index(&manifest, &segment_id)?;
    if manifest.segments[segment_index].status != "active" {
        return Err(ApiError::bad_request("segment is not active"));
    }
    let artifact_type = request
        .artifact_type
        .clone()
        .unwrap_or_else(|| "handoff".to_string());
    let handoff_id = format!("ho_{}", unique_suffix());
    let artifact = write_artifact(
        &state.paths.stack_dir,
        &manifest,
        segment_index,
        &artifact_type,
        &handoff_id,
        &request,
    )
    .await?;
    let sealed_at = now();
    let parent_config = AgentConfig::from_segment(&manifest.segments[segment_index]);
    let summary = request
        .summary
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            summarize_handoff(&manifest, &manifest.segments[segment_index], &request)
        });
    let handoff = Handoff::new(
        handoff_id.clone(),
        manifest.id.clone(),
        summary,
        parent_config,
        sealed_at.clone(),
    )
    .seal(sealed_at.clone(), vec![artifact.id.clone()]);
    write_handoff(&state.paths.stack_dir, &handoff)
        .await
        .map_err(ApiError::from)?;
    manifest.segments[segment_index].status = "sealed".to_string();
    manifest.segments[segment_index].sealed_at = Some(sealed_at.clone());
    manifest.segments[segment_index].handoff_out = Some(handoff_id.clone());
    refresh_segment_usage(&state, &mut manifest, segment_index).await?;
    manifest.artifacts.push(artifact.clone());
    manifest.handoffs.push(handoff_ref(&handoff));
    manifest.updated_at = sealed_at.clone();
    write_manifest(&state.paths.stack_dir, &manifest)
        .await
        .map_err(ApiError::from)?;
    let thread_id = manifest.segments[segment_index].thread_id.clone();
    append_meta_event(
        &state,
        &manifest.id,
        "handoff.created",
        &thread_id,
        Some(&segment_id),
        Some(&artifact.id),
        json!({"artifact_type": artifact.artifact_type, "path": artifact.path, "status": artifact.status, "handoff_id": handoff_id}),
    )
    .await?;
    append_meta_event(
        &state,
        &manifest.id,
        "handoff.review",
        &thread_id,
        Some(&segment_id),
        Some(&artifact.id),
        json!({"status": artifact.status, "recommended_next_action": request.recommended_next_action.unwrap_or_else(|| "approve_phase".to_string())}),
    )
    .await?;
    append_meta_event(
        &state,
        &manifest.id,
        "meta_thread.segment_sealed",
        &thread_id,
        Some(&segment_id),
        Some(&artifact.id),
        json!({"handoff_out": handoff_id, "sealed_at": sealed_at}),
    )
    .await?;
    Ok(Json(artifact))
}

pub async fn approve_artifact(
    State(state): State<Arc<AppState>>,
    Path((id, artifact_id)): Path<(String, String)>,
    request: Option<Json<ApproveArtifactRequest>>,
) -> Result<Json<MetaThreadArtifactRef>, ApiError> {
    let request = request
        .map(|Json(value)| value)
        .unwrap_or(ApproveArtifactRequest {
            approved_by: None,
            thread_id: None,
        });
    let mut manifest = read_manifest(&state.paths.stack_dir, &id)
        .await
        .map_err(ApiError::from)?;
    let index = artifact_index(&manifest, &artifact_id)?;
    manifest.artifacts[index].status = "approved".to_string();
    let artifact = manifest.artifacts[index].clone();
    let approved_at = now();
    let approved_by = request
        .approved_by
        .clone()
        .unwrap_or_else(|| "human".to_string());
    let _handoff = if let Some(handoff_id) = artifact.handoff_id.as_deref() {
        let updated = read_handoff(&state.paths.stack_dir, &manifest.id, handoff_id)
            .await
            .map_err(ApiError::from)?
            .approve(approved_at.clone(), approved_by.clone());
        write_handoff(&state.paths.stack_dir, &updated)
            .await
            .map_err(ApiError::from)?;
        upsert_handoff_ref(&mut manifest, &updated);
        Some(updated)
    } else {
        None
    };
    manifest.updated_at = approved_at.clone();
    write_manifest(&state.paths.stack_dir, &manifest)
        .await
        .map_err(ApiError::from)?;
    append_meta_event(
        &state,
        &manifest.id,
        "handoff.approved",
        request.thread_id.as_deref().unwrap_or(&artifact.created_by_thread_id),
        Some(&artifact.created_by_segment_id),
        Some(&artifact.id),
        json!({"approved_by": approved_by, "status": artifact.status, "handoff_id": artifact.handoff_id}),
    )
    .await?;
    Ok(Json(artifact))
}

pub async fn continue_handoff(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(request): Json<ContinueHandoffRequest>,
) -> Result<Json<ContinueHandoffResponse>, ApiError> {
    let mut manifest = read_manifest(&state.paths.stack_dir, &id)
        .await
        .map_err(ApiError::from)?;
    let predecessor_index = segment_index(&manifest, &manifest.head_segment_id)?;
    let predecessor = manifest.segments[predecessor_index].clone();
    let handoff_id = predecessor
        .handoff_out
        .clone()
        .ok_or_else(|| ApiError::bad_request("predecessor segment has no sealed handoff"))?;
    let artifacts = selected_artifacts(&manifest, &request.artifact_ids)?;
    let continued_at = now();
    let mut session = StackLocalSession {
        id: format!("thread_{}", unique_suffix()),
        workspace_root: request.workspace_root,
        started_at: continued_at.clone(),
        codex_command: request.harness_command,
        codex_model: Some(request.model.clone()),
        codex_thread_id: None,
        harness: Some(request.harness.clone()),
        harness_model: Some(request.model.clone()),
        role: Some("worker".to_string()),
        display_name: Some(format!("{} {}", request.role, manifest.title)),
        meta_thread_id: Some(manifest.id.clone()),
        segment_id: None,
        segment_role: Some(request.role.clone()),
        predecessor_thread_id: Some(predecessor.thread_id.clone()),
        usage_summary: None,
        turns: Vec::new(),
    };
    let segment_id = format!("seg_{}", unique_suffix());
    session.segment_id = Some(segment_id.clone());
    let segment = MetaThreadSegment {
        segment_id: segment_id.clone(),
        thread_id: session.id.clone(),
        role: request.role.clone(),
        agent_role: "worker".to_string(),
        model: request.model.clone(),
        reasoning_effort: request.reasoning_effort.clone(),
        harness: request.harness.clone(),
        status: "active".to_string(),
        handoff_out: None,
        handoff_in: artifacts
            .iter()
            .map(|artifact| artifact.id.clone())
            .collect(),
        predecessor_segment_id: Some(predecessor.segment_id.clone()),
        started_at: session.started_at.clone(),
        sealed_at: None,
        usage_summary: None,
    };
    manifest.segments.push(segment.clone());
    manifest.head_segment_id = segment.segment_id.clone();
    manifest.head_thread_id = session.id.clone();
    manifest.usage_summary = build_meta_thread_usage_summary(&manifest);
    let child_config = AgentConfig::worker(
        request.role.clone(),
        request.harness.clone(),
        request.model.clone(),
        request.reasoning_effort.clone(),
    )
    .with_thread(session.id.clone(), segment.segment_id.clone());
    let handoff = read_handoff(&state.paths.stack_dir, &manifest.id, &handoff_id)
        .await
        .map_err(ApiError::from)?
        .continue_with(child_config, continued_at.clone());
    write_handoff(&state.paths.stack_dir, &handoff)
        .await
        .map_err(ApiError::from)?;
    upsert_handoff_ref(&mut manifest, &handoff);
    manifest.updated_at = continued_at.clone();
    write_manifest(&state.paths.stack_dir, &manifest)
        .await
        .map_err(ApiError::from)?;
    let session_path = write_session(&state.paths.session_log_dir, &session).await?;
    let prompt = successor_prompt(
        &state.paths.stack_dir,
        &manifest,
        &segment,
        &predecessor,
        &artifacts,
    )
    .await?;
    append_meta_event(
        &state,
        &manifest.id,
        "handoff.continue",
        &session.id,
        Some(&segment.segment_id),
        None,
        json!({
            "handoff_id": handoff_id,
            "from_segment": predecessor.segment_id,
            "from_thread": predecessor.thread_id,
            "to_segment": segment.segment_id,
            "to_thread": session.id,
            "artifact_ids": artifacts.iter().map(|artifact| artifact.id.clone()).collect::<Vec<_>>(),
            "role": request.role,
            "model": request.model,
            "harness": request.harness,
        }),
    )
    .await?;
    append_meta_event(
        &state,
        &manifest.id,
        "meta_thread.segment_started",
        &session.id,
        Some(&segment.segment_id),
        None,
        json!({"role": segment.role, "model": segment.model, "harness": segment.harness}),
    )
    .await?;
    Ok(Json(ContinueHandoffResponse {
        manifest,
        handoff,
        session,
        prompt,
        session_path: session_path.to_string_lossy().to_string(),
    }))
}

async fn refresh_segment_usage(
    state: &AppState,
    manifest: &mut MetaThreadManifest,
    segment_index: usize,
) -> Result<(), ApiError> {
    let thread_id = manifest.segments[segment_index].thread_id.clone();
    let mut session = read_session_by_id(&state.paths.session_log_dir, &thread_id).await?;
    let usage_summary = usage_summary_for_session(state, &session).await;
    session.usage_summary = usage_summary.clone();
    if usage_summary.is_some() {
        write_session(&state.paths.session_log_dir, &session).await?;
    }
    manifest.segments[segment_index].usage_summary = usage_summary;
    manifest.usage_summary = build_meta_thread_usage_summary(manifest);
    Ok(())
}

async fn usage_summary_for_session(
    state: &AppState,
    session: &StackLocalSession,
) -> Option<StackSessionUsageSummary> {
    let model = session
        .codex_model
        .clone()
        .or_else(|| session.harness_model.clone())?;

    if let Some(mut summary) = session
        .usage_summary
        .clone()
        .or_else(|| build_usage_summary(session))
    {
        summary.model = model;
        return Some(summary);
    }
    let (_, codex_session_path) =
        resolve_for_session(session, &state.paths.codex_sessions_root()).await;
    let path = codex_session_path?;
    let text = fs::read_to_string(path).await.ok()?;
    let usage = read_usage_from_stdout(&text)?;
    Some(StackSessionUsageSummary {
        model,
        totals: StackSessionUsageTotals {
            input_tokens: usage.input_tokens.unwrap_or(0),
            cached_input_tokens: usage.cached_input_tokens.unwrap_or(0),
            output_tokens: usage.output_tokens.unwrap_or(0),
            reasoning_output_tokens: usage.reasoning_output_tokens.unwrap_or(0),
            turn_count_with_usage: std::cmp::max(1, session.turns.len() as u64),
        },
        estimated_spend_usd: None,
    })
}

async fn write_session(
    session_log_dir: &FsPath,
    session: &StackLocalSession,
) -> Result<PathBuf, ApiError> {
    fs::create_dir_all(session_log_dir)
        .await
        .map_err(|error| ApiError::internal(error.to_string()))?;
    let path = session_path(session_log_dir, &session.id)?;
    let text = serde_json::to_string_pretty(session)
        .map_err(|error| ApiError::internal(error.to_string()))?;
    fs::write(&path, format!("{text}\n"))
        .await
        .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(path)
}

async fn write_artifact(
    stack_dir: &FsPath,
    manifest: &MetaThreadManifest,
    segment_index: usize,
    artifact_type: &str,
    handoff_id: &str,
    request: &SealSegmentRequest,
) -> Result<MetaThreadArtifactRef, ApiError> {
    let segment = &manifest.segments[segment_index];
    let version = manifest
        .artifacts
        .iter()
        .filter(|artifact| artifact.artifact_type == artifact_type)
        .count() as u64
        + 1;
    let artifact_id = format!("art_{}", unique_suffix());
    let filename = if artifact_type == "handoff" {
        format!("handoff-{}.md", segment.segment_id)
    } else {
        format!("{artifact_type}-v{version}.md")
    };
    let relative_path = format!(
        ".stack/meta-threads/{}/artifacts/{filename}",
        safe_segment(&manifest.id).map_err(ApiError::from)?
    );
    let absolute_path = stack_dir.parent().unwrap_or(stack_dir).join(&relative_path);
    if let Some(parent) = absolute_path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|error| ApiError::internal(error.to_string()))?;
    }
    let title = request
        .title
        .clone()
        .unwrap_or_else(|| format!("Handoff: {} - segment {}", manifest.title, segment.role));
    let body = request
        .body
        .clone()
        .unwrap_or_else(|| default_handoff_body(manifest, segment, request));
    fs::write(&absolute_path, format!("# {title}\n\n{}\n", body.trim()))
        .await
        .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(MetaThreadArtifactRef {
        id: artifact_id,
        meta_thread_id: manifest.id.clone(),
        artifact_type: artifact_type.to_string(),
        path: relative_path,
        version,
        created_by_segment_id: segment.segment_id.clone(),
        created_by_thread_id: segment.thread_id.clone(),
        status: request
            .status
            .clone()
            .unwrap_or_else(|| "needs_review".to_string()),
        handoff_id: Some(handoff_id.to_string()),
    })
}

async fn successor_prompt(
    stack_dir: &FsPath,
    manifest: &MetaThreadManifest,
    segment: &MetaThreadSegment,
    predecessor: &MetaThreadSegment,
    artifacts: &[MetaThreadArtifactRef],
) -> Result<String, ApiError> {
    let stack_root = stack_dir.parent().unwrap_or(stack_dir);
    let mut payloads = Vec::new();
    for artifact in artifacts {
        let content = fs::read_to_string(stack_root.join(&artifact.path))
            .await
            .map_err(|error| ApiError::internal(error.to_string()))?;
        payloads.push(json!({
            "id": artifact.id,
            "type": artifact.artifact_type,
            "path": artifact.path,
            "version": artifact.version,
            "status": artifact.status,
            "content": content,
        }));
    }
    Ok(format!(
        "Continue this Stack meta-thread from artifact payloads only.\n\n{}",
        serde_json::to_string_pretty(&json!({
            "meta_thread_id": manifest.id,
            "active_goal": manifest.active_goal,
            "predecessor_segment_id": predecessor.segment_id,
            "predecessor_thread_id": predecessor.thread_id,
            "segment_id": segment.segment_id,
            "segment_role": segment.role,
            "model": segment.model,
            "harness": segment.harness,
            "artifacts": payloads,
            "recommended_next_action": format!("continue_to_{}", segment.role),
        }))
        .map_err(|error| ApiError::internal(error.to_string()))?
    ))
}

async fn append_meta_event(
    state: &AppState,
    meta_thread_id: &str,
    event_type: &str,
    thread_id: &str,
    segment_id: Option<&str>,
    artifact_id: Option<&str>,
    payload: Value,
) -> Result<String, ApiError> {
    let event_id = format!("{}_{}", event_type.replace('.', "_"), unique_suffix());
    let event = json!({
        "event_id": event_id.clone(),
        "type": event_type,
        "thread_id": thread_id,
        "observed_at": now(),
        "actor_id": "meta_thread",
        "actor_role": "system",
        "meta_thread_id": meta_thread_id,
        "segment_id": segment_id,
        "artifact_id": artifact_id,
        "payload": merge_payload(payload, meta_thread_id, segment_id, artifact_id),
    });
    let events_path =
        meta_events_path(&state.paths.stack_dir, meta_thread_id).map_err(ApiError::from)?;
    if let Some(parent) = events_path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|error| ApiError::internal(error.to_string()))?;
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&events_path)
        .await
        .map_err(|error| ApiError::internal(error.to_string()))?;
    file.write_all(
        serde_json::to_string(&event)
            .map_err(|error| ApiError::internal(error.to_string()))?
            .as_bytes(),
    )
    .await
    .map_err(|error| ApiError::internal(error.to_string()))?;
    file.write_all(b"\n")
        .await
        .map_err(|error| ApiError::internal(error.to_string()))?;
    append_thread_event_projected(&state.paths.stack_dir, thread_id, &event).await?;
    Ok(event_id)
}

fn parse_lifecycle_filter(value: Option<&str>) -> Result<Option<&'static str>, ApiError> {
    let Some(value) = value else {
        return Ok(Some("live"));
    };
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.is_empty() || normalized == "live" {
        return Ok(Some("live"));
    }
    if normalized == "archived" {
        return Ok(Some("archived"));
    }
    if normalized == "all" {
        return Ok(None);
    }
    Err(ApiError::bad_request(
        "lifecycle must be live, archived, or all",
    ))
}

fn lifecycle_matches(manifest: &MetaThreadManifest, filter: Option<&str>) -> bool {
    let Some(filter) = filter else {
        return true;
    };
    normalize_lifecycle_status(&manifest.lifecycle_status).unwrap_or("live") == filter
}

async fn enrich_monitor_headline(state: &AppState, manifest: &mut MetaThreadManifest) {
    let Ok(events) = read_thread_events(&state.paths.stack_dir, &manifest.head_thread_id).await else {
        return;
    };
    for event in events.iter().rev() {
        if event.get("type").and_then(Value::as_str) != Some("monitor.goal_status") {
            continue;
        }
        let Some(payload) = event.get("payload").and_then(Value::as_object) else {
            continue;
        };
        if payload.get("for_human").and_then(Value::as_bool) != Some(true) {
            continue;
        }
        manifest.monitor_headline = Some(MonitorHeadline {
            status: payload
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("working")
                .to_string(),
            headline: payload
                .get("headline")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            note: payload
                .get("note")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            observed_at: event
                .get("observed_at")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            event_id: event
                .get("event_id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
        });
        return;
    }
}

fn bind_session(
    session: &mut StackLocalSession,
    meta_thread_id: &str,
    segment_id: &str,
    segment_role: &str,
    harness: &str,
    model: &str,
    predecessor_thread_id: Option<&str>,
) {
    session.meta_thread_id = Some(meta_thread_id.to_string());
    session.segment_id = Some(segment_id.to_string());
    session.segment_role = Some(segment_role.to_string());
    session.harness = Some(harness.to_string());
    session.harness_model = Some(model.to_string());
    session.codex_model = Some(model.to_string());
    session.role = Some("worker".to_string());
    session.predecessor_thread_id = predecessor_thread_id.map(str::to_string);
}

fn upsert_handoff_ref(manifest: &mut MetaThreadManifest, handoff: &Handoff) {
    let reference = handoff_ref(handoff);
    if let Some(index) = manifest
        .handoffs
        .iter()
        .position(|entry| entry.id == reference.id)
    {
        manifest.handoffs[index] = reference;
    } else {
        manifest.handoffs.push(reference);
    }
}

fn summarize_handoff(
    manifest: &MetaThreadManifest,
    segment: &MetaThreadSegment,
    request: &SealSegmentRequest,
) -> String {
    let successor = request
        .successor_role
        .as_deref()
        .unwrap_or("(successor role TBD)");
    format!(
        "Sealed segment {} ({}) on meta-thread \"{}\". Goal: {}. Successor: {}. Next: {}.",
        segment.segment_id,
        segment.role,
        manifest.title,
        manifest
            .active_goal
            .as_ref()
            .map(|goal| goal.objective.as_str())
            .unwrap_or("none"),
        successor,
        request
            .recommended_next_action
            .as_deref()
            .unwrap_or("approve_phase")
    )
}

fn selected_artifacts(
    manifest: &MetaThreadManifest,
    ids: &[String],
) -> Result<Vec<MetaThreadArtifactRef>, ApiError> {
    if !ids.is_empty() {
        return ids
            .iter()
            .map(|id| {
                manifest
                    .artifacts
                    .iter()
                    .find(|artifact| artifact.id == *id)
                    .cloned()
                    .ok_or_else(|| ApiError::bad_request(format!("unknown artifact: {id}")))
            })
            .collect();
    }
    let approved: Vec<_> = manifest
        .artifacts
        .iter()
        .filter(|artifact| artifact.status == "approved")
        .cloned()
        .collect();
    if !approved.is_empty() {
        return Ok(approved);
    }
    Ok(manifest.artifacts.last().cloned().into_iter().collect())
}

fn segment_index(manifest: &MetaThreadManifest, segment_id: &str) -> Result<usize, ApiError> {
    manifest
        .segments
        .iter()
        .position(|segment| segment.segment_id == segment_id)
        .ok_or_else(|| ApiError::bad_request(format!("unknown segment: {segment_id}")))
}

fn artifact_index(manifest: &MetaThreadManifest, artifact_id: &str) -> Result<usize, ApiError> {
    manifest
        .artifacts
        .iter()
        .position(|artifact| artifact.id == artifact_id)
        .ok_or_else(|| ApiError::bad_request(format!("unknown artifact: {artifact_id}")))
}

fn default_handoff_body(
    manifest: &MetaThreadManifest,
    segment: &MetaThreadSegment,
    request: &SealSegmentRequest,
) -> String {
    [
        "## Meta-thread".to_string(),
        format!("- id: {}", manifest.id),
        format!(
            "- segment: {} -> {}",
            segment.segment_id,
            request
                .successor_role
                .as_deref()
                .unwrap_or("(successor role TBD)")
        ),
        format!("- thread: {} (sealed)", segment.thread_id),
        "".to_string(),
        "## Current state".to_string(),
        "- Completed / partial / uncertain".to_string(),
        "".to_string(),
        "## Relevant artifacts".to_string(),
        "- Research: -".to_string(),
        "- Plan: -".to_string(),
        "- Design: -".to_string(),
        "- Diff / worktree: -".to_string(),
        "- Checks / logs: -".to_string(),
        "".to_string(),
        "## Goal progress".to_string(),
        format!(
            "- Meta-thread objective: {}",
            manifest
                .active_goal
                .as_ref()
                .map(|goal| goal.objective.as_str())
                .unwrap_or("(no active goal set)")
        ),
        format!(
            "- Goal status: {}",
            manifest
                .active_goal
                .as_ref()
                .map(|goal| goal.status.as_str())
                .unwrap_or("unknown")
        ),
        "- Segment outcome: completed / partial / needs follow-up".to_string(),
        "### Checklist".to_string(),
        goal_checklist_lines(manifest),
        "### Blockers".to_string(),
        goal_blocker_lines(manifest),
        format!(
            "- Successor should: {}",
            request
                .recommended_next_action
                .as_deref()
                .unwrap_or("approve_phase")
        ),
        "".to_string(),
        "## Key decisions".to_string(),
        "- -".to_string(),
        "".to_string(),
        "## Files changed".to_string(),
        "- -".to_string(),
        "".to_string(),
        "## Verification".to_string(),
        "### Automated".to_string(),
        "- [ ] -".to_string(),
        "### Manual".to_string(),
        "- [ ] -".to_string(),
        "".to_string(),
        "## Open questions".to_string(),
        "- -".to_string(),
        "".to_string(),
        "## Recommended next action".to_string(),
        format!(
            "`{}`",
            request
                .recommended_next_action
                .as_deref()
                .unwrap_or("approve_phase")
        ),
    ]
    .join("\n")
}

fn goal_checklist_lines(manifest: &MetaThreadManifest) -> String {
    let Some(goal) = manifest.active_goal.as_ref() else {
        return "- [ ] Set manifest.active_goal acceptance criteria".to_string();
    };
    if goal.acceptance_criteria.is_empty() {
        return "- [ ] No acceptance criteria recorded".to_string();
    }
    goal.acceptance_criteria
        .iter()
        .map(|criterion| format!("- [ ] {criterion}"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn goal_blocker_lines(manifest: &MetaThreadManifest) -> String {
    let Some(goal) = manifest.active_goal.as_ref() else {
        return "- none recorded".to_string();
    };
    if goal.blockers.is_empty() {
        return "- none recorded".to_string();
    }
    goal.blockers
        .iter()
        .map(|blocker| format!("- {blocker}"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn merge_payload(
    payload: Value,
    meta_thread_id: &str,
    segment_id: Option<&str>,
    artifact_id: Option<&str>,
) -> Value {
    let mut object = payload.as_object().cloned().unwrap_or_default();
    object.insert("meta_thread_id".to_string(), json!(meta_thread_id));
    object.insert("segment_id".to_string(), json!(segment_id));
    object.insert("artifact_id".to_string(), json!(artifact_id));
    Value::Object(object)
}

fn unique_suffix() -> String {
    format!(
        "{}_{}",
        Utc::now().timestamp_nanos_opt().unwrap_or_default(),
        std::process::id()
    )
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
