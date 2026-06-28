use crate::session::{thread_id_from_session, StackLocalSession};
use chrono::{Datelike, Duration, Utc};
use std::path::{Path, PathBuf};
use tokio::fs;

pub async fn resolve_codex_session_path(thread_id: &str, sessions_root: &Path) -> Option<PathBuf> {
    let suffix = format!("{thread_id}.jsonl");
    for dir in recent_session_dirs(sessions_root) {
        let mut entries = match fs::read_dir(&dir).await {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.ends_with(&suffix) {
                return Some(entry.path());
            }
        }
    }
    None
}

pub async fn resolve_for_session(
    session: &StackLocalSession,
    sessions_root: &Path,
) -> (Option<String>, Option<PathBuf>) {
    let thread_id = thread_id_from_session(session);
    let path = match &thread_id {
        Some(thread_id) => resolve_codex_session_path(thread_id, sessions_root).await,
        None => None,
    };
    (thread_id, path)
}

fn recent_session_dirs(sessions_root: &Path) -> Vec<PathBuf> {
    let today = Utc::now().date_naive();
    (0..3)
        .map(|offset| {
            let date = today - Duration::days(offset);
            sessions_root
                .join(format!("{:04}", date.year()))
                .join(format!("{:02}", date.month()))
                .join(format!("{:02}", date.day()))
        })
        .collect()
}
