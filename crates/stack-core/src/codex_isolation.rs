//! Stack-owned Codex namespace guardrails.
//!
//! Stack background automation (workers, monitors, gardeners, wakeups, eval
//! players) must never create, resume, or mutate threads in the user's
//! personal Codex home (`~/.codex`): those threads surface in the Codex
//! desktop sidebar. The privacy boundary is `CODEX_HOME`, not thread
//! metadata. This module is the Rust authority for resolving the Stack codex
//! home, preparing it (auth material only), and refusing launches that would
//! touch the personal namespace.

use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// The user's real Codex home. Single resolution rule (matches the TS
/// implementation): `$CODEX_HOME` when the user relocated their Codex home,
/// else `~/.codex`. Stack only READS auth material from this home; it never
/// writes to it.
pub fn personal_codex_home() -> PathBuf {
    if let Ok(relocated) = env::var("CODEX_HOME") {
        let trimmed = relocated.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".codex")
}

/// The Stack-owned codex home for a workspace: `<app_root>/.stack/codex-home`.
pub fn stack_codex_home(app_root: &Path) -> PathBuf {
    app_root.join(".stack").join("codex-home")
}

/// Create the Stack codex home and seed ONLY `auth.json` from the personal
/// home. Sessions, archived_sessions, history.jsonl, session_index.jsonl,
/// and plugin caches are never copied.
pub fn prepare_stack_codex_home(codex_home: &Path, personal_home: &Path) -> io::Result<PathBuf> {
    if same_path(codex_home, personal_home) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "stack codex home must not be the personal Codex home ({})",
                personal_home.display()
            ),
        ));
    }
    fs::create_dir_all(codex_home)?;
    let auth_target = codex_home.join("auth.json");
    let auth_source = personal_home.join("auth.json");
    if !auth_target.exists() && auth_source.exists() {
        fs::copy(&auth_source, &auth_target)?;
    }
    let config_target = codex_home.join("config.toml");
    if !config_target.exists() {
        fs::write(
            &config_target,
            "# Stack-owned Codex home (background automation namespace).\n\
             # Created by Stack; personal ~/.codex is never used for Stack actors.\n",
        )?;
    }
    Ok(codex_home.to_path_buf())
}

/// Hard preflight guard: rejects a codex home that IS the personal home or
/// that symlinks its session/history state back into it.
pub fn assert_stack_codex_isolation(codex_home: &Path, personal_home: &Path) -> Result<(), String> {
    if codex_home.as_os_str().is_empty() {
        return Err("stack codex isolation: codex home is empty".to_string());
    }
    if same_path(codex_home, personal_home) {
        return Err(format!(
            "stack codex isolation: codex home resolves to the personal Codex home ({})",
            personal_home.display()
        ));
    }
    for entry in [
        "sessions",
        "archived_sessions",
        "history.jsonl",
        "session_index.jsonl",
    ] {
        let candidate = codex_home.join(entry);
        if is_symlink_into(&candidate, personal_home) {
            return Err(format!(
                "stack codex isolation: {} is a symlink into {}",
                candidate.display(),
                personal_home.display()
            ));
        }
    }
    Ok(())
}

fn same_path(left: &Path, right: &Path) -> bool {
    resolved(left) == resolved(right)
}

fn resolved(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

fn is_symlink_into(candidate: &Path, personal_home: &Path) -> bool {
    let Ok(metadata) = fs::symlink_metadata(candidate) else {
        return false;
    };
    if !metadata.file_type().is_symlink() {
        return false;
    }
    let target = resolved(candidate);
    let personal = resolved(personal_home);
    target == personal || target.starts_with(&personal)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = env::temp_dir()
            .join("stack-codex-isolation-tests")
            .join(format!("{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn personal_codex_home_honors_relocated_codex_home_env() {
        let root = temp_dir("env-relocated");
        let relocated = root.join("my-codex");
        fs::create_dir_all(&relocated).unwrap();

        env::set_var("CODEX_HOME", &relocated);
        assert_eq!(personal_codex_home(), relocated);

        // Blank/whitespace CODEX_HOME is treated as unset.
        env::set_var("CODEX_HOME", "   ");
        assert!(personal_codex_home().ends_with(".codex"));

        env::remove_var("CODEX_HOME");
        assert!(personal_codex_home().ends_with(".codex"));
    }

    #[test]
    fn prepare_seeds_auth_from_relocated_personal_home() {
        // Users who relocate their Codex home ($CODEX_HOME) keep auth there,
        // not in ~/.codex. Seeding must read from wherever the real home is.
        let root = temp_dir("relocated");
        let relocated = root.join("relocated-codex");
        fs::create_dir_all(&relocated).unwrap();
        fs::write(relocated.join("auth.json"), "{\"tokens\":{\"relocated\":true}}").unwrap();

        let stack_home = root.join("workspace/.stack/codex-home");
        prepare_stack_codex_home(&stack_home, &relocated).unwrap();

        let seeded = fs::read_to_string(stack_home.join("auth.json")).unwrap();
        assert!(seeded.contains("relocated"));
    }

    #[test]
    fn prepare_seeds_auth_only_and_never_touches_personal_home() {
        let root = temp_dir("prepare");
        let personal = root.join("personal-codex");
        fs::create_dir_all(personal.join("sessions")).unwrap();
        fs::write(personal.join("auth.json"), "{\"tokens\":{}}").unwrap();
        fs::write(personal.join("history.jsonl"), "{}\n").unwrap();
        let before: Vec<_> = fs::read_dir(&personal)
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();

        let stack_home = root.join("workspace/.stack/codex-home");
        prepare_stack_codex_home(&stack_home, &personal).unwrap();

        assert!(stack_home.join("auth.json").exists());
        assert!(stack_home.join("config.toml").exists());
        assert!(!stack_home.join("sessions").exists());
        assert!(!stack_home.join("history.jsonl").exists());

        let after: Vec<_> = fs::read_dir(&personal)
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(before.len(), after.len(), "personal codex home was mutated");
    }

    #[test]
    fn prepare_refuses_personal_home() {
        let root = temp_dir("refuse");
        let personal = root.join("personal-codex");
        fs::create_dir_all(&personal).unwrap();
        assert!(prepare_stack_codex_home(&personal, &personal).is_err());
    }

    #[test]
    fn guard_rejects_personal_home_and_symlinked_state() {
        let root = temp_dir("guard");
        let personal = root.join("personal-codex");
        fs::create_dir_all(personal.join("sessions")).unwrap();

        assert!(assert_stack_codex_isolation(&personal, &personal).is_err());

        let stack_home = root.join("stack-home");
        fs::create_dir_all(&stack_home).unwrap();
        assert!(assert_stack_codex_isolation(&stack_home, &personal).is_ok());

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(personal.join("sessions"), stack_home.join("sessions"))
                .unwrap();
            assert!(assert_stack_codex_isolation(&stack_home, &personal).is_err());
        }
    }
}
