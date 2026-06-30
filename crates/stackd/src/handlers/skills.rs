use crate::handlers::ApiError;
use crate::server::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use stack_core::skills::{
    ensure_skills_runtime, list_skills, read_skill, register_skill, search_skills,
    RegisterSkillRequest, SkillListResponse, SkillReadResponse,
};
use std::sync::Arc;

#[derive(Debug, Deserialize)]
pub struct SkillSearchQuery {
    pub q: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: usize,
}

fn default_limit() -> usize {
    20
}

#[derive(Debug, Deserialize)]
pub struct SkillReadQuery {
    #[serde(default = "default_max_bytes")]
    pub max_bytes: usize,
}

fn default_max_bytes() -> usize {
    50_000
}

pub async fn list_skills_handler(
    State(state): State<Arc<AppState>>,
) -> Result<Json<SkillListResponse>, ApiError> {
    let skills = list_skills(&state.paths).map_err(ApiError::from)?;
    Ok(Json(SkillListResponse {
        count: skills.len(),
        skills,
    }))
}

pub async fn get_skill_handler(
    State(state): State<Arc<AppState>>,
    Path(skill_id): Path<String>,
    Query(query): Query<SkillReadQuery>,
) -> Result<Json<SkillReadResponse>, ApiError> {
    Ok(Json(
        read_skill(&state.paths, &skill_id, query.max_bytes).map_err(ApiError::from)?,
    ))
}

pub async fn search_skills_handler(
    State(state): State<Arc<AppState>>,
    Query(query): Query<SkillSearchQuery>,
) -> Result<Json<SkillListResponse>, ApiError> {
    let skills = search_skills(&state.paths, query.q.as_deref().unwrap_or(""), query.limit)
        .map_err(ApiError::from)?;
    Ok(Json(SkillListResponse {
        count: skills.len(),
        skills,
    }))
}

pub async fn register_skill_handler(
    State(state): State<Arc<AppState>>,
    Json(request): Json<RegisterSkillRequest>,
) -> Result<Json<stack_core::skills::SkillRecord>, ApiError> {
    Ok(Json(
        register_skill(&state.paths, request).map_err(ApiError::from)?,
    ))
}

pub async fn bootstrap_skills_handler(
    State(state): State<Arc<AppState>>,
) -> Result<Json<SkillListResponse>, ApiError> {
    let skills = ensure_skills_runtime(&state.paths).map_err(ApiError::from)?;
    Ok(Json(SkillListResponse {
        count: skills.len(),
        skills,
    }))
}
