use crate::server::AppState;
use std::process::Stdio;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

pub async fn run_gardener_message(
    state: &AppState,
    gardener_thread_id: &str,
    worker_thread_id: &str,
    message: &str,
    wake_reason: &str,
) -> Result<(), String> {
    crate::meta::tick::run_meta_tick(state)
        .await
        .map_err(|error| format!("queueing gardener trigger: {error}"))?;
    let mut child = Command::new("bun")
        .arg("run")
        .arg("src/main.ts")
        .arg("gardener")
        .arg("message")
        .arg("--gardener-thread-id")
        .arg(gardener_thread_id)
        .arg("--worker-thread-id")
        .arg(worker_thread_id)
        .arg("--wake-reason")
        .arg(wake_reason)
        .arg("--message-stdin")
        .arg("--message-recorded")
        .current_dir(&state.paths.install_root)
        .env("STACK_ROOT", &state.paths.app_root)
        .env("STACK_SESSION_DIR", &state.paths.session_log_dir)
        .env("CODEX_HOME", &state.paths.codex_home)
        .env("STACK_CODEX_ISOLATED", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("spawning gardener consumer: {error}"))?;
    let Some(mut stdin) = child.stdin.take() else {
        return Err("gardener consumer stdin unavailable".to_string());
    };
    stdin
        .write_all(message.as_bytes())
        .await
        .map_err(|error| format!("writing gardener message: {error}"))?;
    drop(stdin);
    let output = child
        .wait_with_output()
        .await
        .map_err(|error| format!("waiting for gardener consumer: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Err(format!(
        "gardener consumer exited {}: {}",
        output.status.code().unwrap_or(1),
        if stderr.is_empty() { stdout } else { stderr },
    ))
}
