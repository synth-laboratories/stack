#!/usr/bin/env bun

import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { stackdBaseUrl, stackdHealth, stackdLogsQuery } from "../src/client/stackd.js"
import { appendThreadMetaEvent, stackEventId } from "../src/thread-events.js"
import { StackMcpServer } from "../src/mcp/server.js"

type QueryResult = {
  count?: number
  hits?: Array<{ fields?: Record<string, unknown>; msg?: string }>
}

const appRoot = process.cwd()
const synthDevRoot = process.env.STACK_SYNTH_DEV_ROOT ?? join(appRoot, "..", "synth-dev")
const slot = process.env.STACK_VL_SLOT ?? "slot1"
const stamp = new Date().toISOString().replace(/[-:.]/g, "").replace("T", "T").slice(0, 15) + "Z"
const smokeId = `obs-smoke-${randomUUID()}`

await assertStackdLogsHealthy()
await assertMetaHarnessProjection()
await assertStackEvalProjection()
await assertHarnessCommandProjection()

console.log(`observability_smoke_ok slot=${slot} id=${smokeId}`)

async function assertStackdLogsHealthy(): Promise<void> {
  const baseUrl = stackdBaseUrl()
  const health = await stackdHealth(baseUrl)
  if (!health.ok) throw new Error(`stackd health failed: ${JSON.stringify(health)}`)
  const logs = await stackdLogsQuery({ slot, query: "*", limit: 1, minutes: 60 }, baseUrl)
  if (!logs.ok || !Array.isArray(logs.result.records)) {
    throw new Error(`stackd /logs/query failed: ${JSON.stringify(logs)}`)
  }
}

async function assertMetaHarnessProjection(): Promise<void> {
  const threadId = `${smokeId}-meta`
  const eventId = stackEventId("skill_read")
  appendThreadMetaEvent(appRoot, {
    event_id: eventId,
    type: "skill.read",
    thread_id: threadId,
    observed_at: new Date().toISOString(),
    actor_id: "observability_smoke",
    actor_role: "system",
    payload: {
      skill_id: "stack-agent-bridge",
      origin: "smoke",
      reason: "observability_smoke",
    },
  })

  const result = await pollLogs({
    event_domain: "meta_harness",
    service: "stackd",
    thread_id: threadId,
    limit: 10,
    minutes: 10,
  })
  const hit = result.hits?.find((hit) => hit.fields?.event_id === eventId)
  if (!hit) throw new Error(`meta_harness event not found for event_id=${eventId}`)
}

async function assertStackEvalProjection(): Promise<void> {
  const stackRoot = join("/tmp", "stack-observability-smoke", smokeId)
  const packetDir = join(stackRoot, "packet", stamp)
  mkdirSync(packetDir, { recursive: true })
  const configPath = join(stackRoot, "stackeval-config.json")
  const gepaConfig = join(stackRoot, "gepa.toml")
  const runId = `stackeval_observability-smoke_${stamp}`
  writeFileSync(gepaConfig, "task = \"observability-smoke\"\n")
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        paths: {
          stack_root: stackRoot,
          synth_dev_root: synthDevRoot,
        },
        stack: {
          stack_api_url: "http://127.0.0.1:1",
        },
        task: {
          id: "observability-smoke",
          default_model: "gpt-5.5-low",
        },
        preset: {
          name: "smoke",
        },
      },
      null,
      2,
    ) + "\n",
  )

  const traceStackd = join(appRoot, "scripts", "stackeval", "lib", "trace_stackd.py")
  const result = await run(
    [
      "python3",
      traceStackd,
      "harness-event",
      "--config-json",
      configPath,
      "--packet-dir",
      packetDir,
      "--phase",
      "started",
      "--gepa-config",
      gepaConfig,
    ],
    appRoot,
  )
  if (result.exitCode !== 0) {
    throw new Error(`trace_stackd.py harness-event failed: ${result.stderr || result.stdout}`)
  }

  const query = await pollLogs({
    event_domain: "local_optimizer",
    service: "stackeval",
    run_id: runId,
    limit: 10,
    minutes: 10,
  })
  const hit = query.hits?.find((hit) => hit.fields?.run_id === runId)
  if (!hit) throw new Error(`local_optimizer stackeval event not found for run_id=${runId}`)
}

async function assertHarnessCommandProjection(): Promise<void> {
  const runId = `harnesscmd_${smokeId.replace(/[^A-Za-z0-9_.-]/g, "_")}`
  const server = new StackMcpServer(appRoot)
  const result = await server.callTool("stack_run_with_logs", {
    command: "python3",
    args: ["-c", "print('stack harness command smoke')"],
    run_id: runId,
    timeout_seconds: 30,
    tail_bytes: 1000,
  }) as { ok?: boolean; stdout_tail?: string }
  if (!result.ok || !result.stdout_tail?.includes("stack harness command smoke")) {
    throw new Error(`stack_run_with_logs failed: ${JSON.stringify(result)}`)
  }

  const query = await pollLogs({
    event_domain: "local_optimizer",
    service: "harness-cmd",
    run_id: runId,
    limit: 10,
    minutes: 10,
  })
  const hit = query.hits?.find((hit) => hit.fields?.run_id === runId && hit.fields?.event_type === "command.exit")
  if (!hit) throw new Error(`harness-cmd command.exit event not found for run_id=${runId}`)
}

async function pollLogs(args: Record<string, string | number>): Promise<QueryResult> {
  const server = new StackMcpServer(appRoot)
  let last: QueryResult | undefined
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    last = (await server.callTool("stack_query_logs", { slot, ...args })) as QueryResult
    if ((last.count ?? last.hits?.length ?? 0) > 0) return last
    await sleep(500)
  }
  throw new Error(`stack_query_logs returned no hits: ${JSON.stringify(last)}`)
}

async function run(command: string[], cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
