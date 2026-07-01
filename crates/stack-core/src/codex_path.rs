use crate::session::{thread_id_from_session, StackLocalSession};
use std::path::{Path, PathBuf};
use tokio::fs;

/// Codex persists each session as `<sessions_root>/YYYY/MM/DD/rollout-<ISO>-<thread_id>.jsonl`.
/// We resolve by walking the date-partitioned tree newest-first and matching the rollout file
/// whose name ends in `-<thread_id>.jsonl`. Newest-first means a freshly-resumed thread matches
/// on the first day directory; a genuinely-absent rollout only returns `None` after the whole
/// tree has been searched — no silent recent-days cliff that drops older sessions.
pub async fn resolve_codex_session_path(thread_id: &str, sessions_root: &Path) -> Option<PathBuf> {
    let suffix = format!("-{thread_id}.jsonl");
    for dir in session_date_dirs(sessions_root).await {
        let mut entries = match fs::read_dir(&dir).await {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with("rollout-") && name.ends_with(&suffix) {
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

/// Every `YYYY/MM/DD` session directory under the codex sessions root, newest date first.
/// Numeric (not lexical) sort on year/month/day keeps ordering correct across zero-padding.
async fn session_date_dirs(sessions_root: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    for year in numeric_child_dirs(sessions_root).await {
        let year_dir = sessions_root.join(&year);
        for month in numeric_child_dirs(&year_dir).await {
            let month_dir = year_dir.join(&month);
            for day in numeric_child_dirs(&month_dir).await {
                dirs.push(month_dir.join(&day));
            }
        }
    }
    dirs
}

/// Immediate child directories whose names are all digits (year/month/day), sorted descending.
async fn numeric_child_dirs(dir: &Path) -> Vec<String> {
    let mut entries = match fs::read_dir(dir).await {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };
    let mut names = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        if !matches!(entry.file_type().await, Ok(file_type) if file_type.is_dir()) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.is_empty() && name.chars().all(|character| character.is_ascii_digit()) {
            names.push(name);
        }
    }
    names.sort_by(|left, right| {
        right
            .parse::<u64>()
            .unwrap_or(0)
            .cmp(&left.parse::<u64>().unwrap_or(0))
    });
    names
}
