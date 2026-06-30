use std::env;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct StackPaths {
    pub app_root: PathBuf,
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
