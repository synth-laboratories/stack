#!/usr/bin/env bun

import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { StackMcpServer } from "../src/mcp/server.js"

const appRoot = resolve(import.meta.dir, "..")
const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z"
const proofDir = join(appRoot, ".stack", "evidence", "mcp-local-threads", stamp)
const threadId = `mcp-local-${randomUUID()}`
const port = 18_792 + Math.floor(Math.random() * 1000)
const failures: string[] = []

mkdirSync(proofDir, { recursive: true })
mkdirSync(join(appRoot, ".stack", "sessions"), { recursive: true })

const sessionPath = join(appRoot, ".stack", "sessions", `${threadId}.json`)
writeFileSync(sessionPath, `${JSON.stringify({
  id: threadId,
  workspaceRoot: appRoot,
  startedAt: new Date().toISOString(),
  codexCommand: "codex",
  turns: [
    {
      id: "turn-1",
      prompt: "mcp local thread smoke",
      selectedPaths: [],
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      exitCode: 0,
      stdout: "ok",
      stderr: "",
    },
  ],
}, null, 2)}\n`)

const env = {
  ...process.env,
  STACK_API_PORT: String(port),
  STACK_API_URL: `http://127.0.0.1:${port}`,
  STACKD_MONITOR_SCHEDULER: "0",
}
const proc = Bun.spawn([join(appRoot, "target", "debug", "stackd"), "serve"], {
  cwd: appRoot,
  env,
  stdout: "pipe",
  stderr: "pipe",
})

try {
  await waitForHealth(env.STACK_API_URL)
  const server = new StackMcpServer(appRoot)
  const listed = await server.callTool("stack_local_threads_list", {})
  const threads = asArray(asRecord(listed)?.threads)
  if (!threads.some((thread) => asRecord(thread)?.id === threadId)) failures.push("MCP list missing smoke thread")

  const read = asRecord(await server.callTool("stack_local_thread_read", { thread_id: threadId }))
  if (!asRecord(read?.thread)) failures.push("MCP read returned no thread")

  const trace = asRecord(await server.callTool("stack_local_thread_trace", { thread_id: threadId }))
  if (asRecord(trace?.trace)?.stack_session_id !== threadId) failures.push("MCP trace session id mismatch")

  const exported = asRecord(await server.callTool("stack_local_thread_export", { thread_id: threadId }))
  const exportDir = typeof exported?.export_dir === "string" ? exported.export_dir : undefined
  if (!exportDir || !existsSync(join(exportDir, "manifest.json"))) failures.push("MCP export missing manifest")

  const summary = {
    ok: failures.length === 0,
    stamp,
    thread_id: threadId,
    stack_api_url: env.STACK_API_URL,
    export_dir: exportDir ?? null,
    failures,
  }
  writeFileSync(join(proofDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`)

  if (failures.length > 0) {
    console.error(`stack_mcp_local_threads_failed: ${failures.join("; ")}`)
    process.exit(1)
  }

  console.log("stack_mcp_local_threads_ok")
  console.log(`thread_id=${threadId}`)
  console.log(`proof_dir=${proofDir}`)
} finally {
  proc.kill()
  await proc.exited.catch(() => undefined)
}

async function waitForHealth(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 10_000
  let lastError = ""
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`)
      if (response.ok) return
      lastError = `${response.status} ${await response.text()}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await Bun.sleep(200)
  }
  const stderr = await new Response(proc.stderr).text().catch(() => "")
  throw new Error(`stackd health failed: ${lastError}; ${stderr.slice(0, 1000)}`)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
