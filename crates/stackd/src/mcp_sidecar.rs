use std::net::IpAddr;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use anyhow::Context;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::time::sleep;

#[derive(Debug)]
pub struct McpSidecar {
    child: Child,
    pub base_url: String,
}

impl McpSidecar {
    pub async fn spawn(app_root: &Path, bind: IpAddr, port: u16) -> anyhow::Result<Self> {
        let mut child = Command::new("bun")
            .arg("run")
            .arg("src/mcp/server.ts")
            .arg("--http")
            .arg("--bind")
            .arg(bind.to_string())
            .arg("--port")
            .arg(port.to_string())
            .current_dir(app_root)
            .env("STACK_APP_ROOT", app_root)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .with_context(|| {
                format!("spawning Stack MCP HTTP sidecar in {}", app_root.display())
            })?;

        let base_url = format!("http://{bind}:{port}");
        wait_for_sidecar(&mut child, &base_url).await?;
        Ok(Self { child, base_url })
    }
}

impl Drop for McpSidecar {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
    }
}

async fn wait_for_sidecar(child: &mut Child, base_url: &str) -> anyhow::Result<()> {
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow::anyhow!("MCP sidecar stdout unavailable"))?;
    let mut lines = BufReader::new(stdout).lines();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(15);

    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            anyhow::bail!("timed out waiting for Stack MCP HTTP sidecar at {base_url}");
        }

        let read: Result<Result<Option<String>, std::io::Error>, tokio::time::error::Elapsed> =
            tokio::time::timeout(remaining, lines.next_line()).await;
        match read {
            Ok(Ok(Some(line))) => {
                if line.contains("stack_mcp_http_ready") {
                    wait_for_health(base_url).await?;
                    return Ok(());
                }
                tracing::debug!("stack-mcp sidecar: {line}");
            }
            Ok(Ok(None)) => break,
            Ok(Err(error)) => return Err(error.into()),
            Err(_) => anyhow::bail!("timed out waiting for Stack MCP HTTP sidecar at {base_url}"),
        }
    }

    wait_for_health(base_url).await
}

async fn wait_for_health(base_url: &str) -> anyhow::Result<()> {
    let client = reqwest::Client::new();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    let mut last_error = String::new();
    while tokio::time::Instant::now() < deadline {
        match client.get(format!("{base_url}/mcp")).send().await {
            Ok(response) if response.status().is_success() => return Ok(()),
            Ok(response) => last_error = format!("HTTP {}", response.status()),
            Err(error) => last_error = error.to_string(),
        }
        sleep(Duration::from_millis(200)).await;
    }
    anyhow::bail!("MCP sidecar health check failed for {base_url}: {last_error}")
}
