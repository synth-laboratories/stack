use std::env;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct StackPaths {
    pub app_root: PathBuf,
    /// Directory the Stack code is installed in (holds `bundled/`, `bin/`,
    /// `.codex/skills`). Distinct from `app_root` (the workspace, where `.stack`
    /// state lives): an installed user runs `stack` from their own project, so
    /// `app_root` is their cwd while bundled assets live with the binary.
    pub install_root: PathBuf,
    pub stack_global_dir: PathBuf,
    pub stack_dir: PathBuf,
    pub session_log_dir: PathBuf,
    pub export_dir: PathBuf,
    pub runtime_status_path: PathBuf,
    pub codex_home: PathBuf,
}

impl StackPaths {
    pub fn from_env() -> Result<Self, std::io::Error> {
        let app_root = match env::var("STACK_ROOT")
            .ok()
            .filter(|value| !value.trim().is_empty())
        {
            Some(path) => PathBuf::from(path),
            None => env::current_dir()?,
        };
        let app_root = app_root.canonicalize().unwrap_or(app_root);
        let install_root = default_install_root(&app_root);
        let stack_global_dir = default_stack_global_dir();
        let stack_dir = app_root.join(".stack");
        let session_log_dir = env::var("STACK_SESSION_DIR")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| stack_dir.join("sessions"));
        let export_dir = stack_dir.join("exports");
        let runtime_status_path = stack_dir.join("runtime").join("status.json");
        let codex_home = default_codex_home();

        Ok(Self {
            app_root,
            install_root,
            stack_global_dir,
            stack_dir,
            session_log_dir,
            export_dir,
            runtime_status_path,
            codex_home,
        })
    }

    pub fn codex_sessions_root(&self) -> PathBuf {
        self.codex_home.join("sessions")
    }
}

/// Resolve the install root (where bundled assets ship). Prefers the explicit
/// `STACK_INSTALL_ROOT` (set by `bin/stack`), then the running executable's
/// layout (`<root>/bin/stackd`), and finally `app_root` for dev-from-checkout
/// where the workspace and install coincide.
pub fn default_install_root(app_root: &Path) -> PathBuf {
    if let Some(path) = env::var("STACK_INSTALL_ROOT")
        .ok()
        .filter(|value| !value.trim().is_empty())
    {
        return PathBuf::from(path);
    }
    if let Ok(exe) = env::current_exe() {
        if let Some(root) = exe.parent().and_then(|bin| bin.parent()) {
            if root.join("bundled").is_dir() {
                return root.to_path_buf();
            }
        }
    }
    app_root.to_path_buf()
}

pub fn default_stack_global_dir() -> PathBuf {
    if let Some(path) = env::var("STACK_GLOBAL_DIR")
        .ok()
        .filter(|value| !value.trim().is_empty())
    {
        return PathBuf::from(path);
    }
    let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".stack")
}

pub fn default_codex_home() -> PathBuf {
    if let Some(path) = env::var("CODEX_HOME")
        .ok()
        .filter(|value| !value.trim().is_empty())
    {
        return PathBuf::from(path);
    }
    let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".codex")
}
