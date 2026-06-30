#!/usr/bin/env bun

import { resolve } from "node:path"
import { StackMcpServer } from "../src/mcp/server.js"

const appRoot = resolve(import.meta.dir, "..")
const port = Number.parseInt(process.env.STACK_API_PORT ?? "18792", 10)
const baseUrl = process.env.STACK_API_URL ?? `http://127.0.0.1:${port}`
const failures: string[] = []

const env = {
  ...process.env,
  STACK_API_PORT: String(port),
  STACK_API_URL: baseUrl,
  STACKD_MONITOR_SCHEDULER: "0",
}
const proc = Bun.spawn([resolve(appRoot, "target/debug/stackd"), "serve", "--port", String(port)], {
  cwd: appRoot,
  env,
  stdout: "pipe",
  stderr: "pipe",
})

try {
  process.env.STACK_API_URL = baseUrl
  await waitForHealth(`${baseUrl}/health`)

  const health = await fetch(`${baseUrl}/health`).then((response) => response.json()) as Record<string, unknown>
  if (typeof health.mcp_url !== "string" || !health.mcp_url.endsWith("/mcp")) {
    failures.push("health missing mcp_url")
  }

  const discovery = await fetch(`${baseUrl}/.well-known/mcp.json`).then((response) => response.json()) as Record<string, unknown>
  const servers = discovery.mcpServers as Record<string, { url?: string }> | undefined
  if (servers?.["stack-live-ops"]?.url !== `${baseUrl}/mcp`) {
    failures.push("well-known MCP discovery mismatch")
  }

  const init = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "smoke", version: "0" },
      },
    }),
  })
  if (!init.ok) failures.push(`initialize HTTP ${init.status}`)
  const initBody = await init.json() as Record<string, unknown>
  if (!initBody.result) failures.push("initialize missing result")

  const tools = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  }).then((response) => response.json()) as Record<string, Record<string, unknown>>
  const toolNames = ((tools.result as { tools?: Array<{ name?: string }> } | undefined)?.tools ?? [])
    .map((tool) => tool.name)
    .filter(Boolean)
  if (!toolNames.includes("stack_local_threads_list")) failures.push("tools/list missing stack_local_threads_list")

  if (failures.length > 0) {
    console.error(`stack_mcp_http_failed: ${failures.join("; ")}`)
    process.exit(1)
  }

  console.log("stack_mcp_http_ok")
  console.log(`mcp_url=${baseUrl}/mcp`)
} finally {
  proc.kill()
  await proc.exited.catch(() => undefined)
}

async function waitForHealth(url: string): Promise<void> {
  const deadline = Date.now() + 20_000
  let lastError = ""
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
      lastError = `${response.status} ${await response.text()}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await Bun.sleep(250)
  }
  throw new Error(`stackd health failed: ${lastError}`)
}
