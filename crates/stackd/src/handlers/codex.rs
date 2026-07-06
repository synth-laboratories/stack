use crate::server::AppState;
use axum::{extract::State, Json};
use serde::Serialize;
use stack_core::codex_isolation::{assert_stack_codex_isolation, personal_codex_home};
use std::sync::Arc;

/// Isolation health for the Stack-owned Codex namespace. The TUI and smoke
/// checks read this instead of re-deriving the boundary themselves: stackd is
/// the authority on where Stack Codex state lives and whether the personal
/// `~/.codex` is protected.
#[derive(Debug, Serialize)]
pub struct CodexIsolationResponse {
    pub codex_home: String,
    pub codex_sessions_root: String,
    pub personal_codex_home: String,
    pub isolated: bool,
    pub violation: Option<String>,
}

pub async fn get_codex_isolation(
    State(state): State<Arc<AppState>>,
) -> Json<CodexIsolationResponse> {
    let personal = personal_codex_home();
    let violation = assert_stack_codex_isolation(&state.paths.codex_home, &personal).err();
    Json(CodexIsolationResponse {
        codex_home: state.paths.codex_home.to_string_lossy().to_string(),
        codex_sessions_root: state
            .paths
            .codex_sessions_root()
            .to_string_lossy()
            .to_string(),
        personal_codex_home: personal.to_string_lossy().to_string(),
        isolated: violation.is_none(),
        violation,
    })
}
