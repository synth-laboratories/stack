#!/usr/bin/env bun

import { randomUUID } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { loadConfig } from "../src/config.js"
import { runMonitorAfterTurn, runMonitorForNewEvents } from "../src/monitor.js"
import { appendThreadMetaEvent, readThreadMetaEvents, stackEventId } from "../src/thread-events.js"
import { writeSessionLog, type StackCodexTurn, type StackLocalSession } from "../src/session.js"

process.env.STACK_MONITOR_PROFILE = "style-steer-smoke"

const appRoot = resolve(import.meta.dir, "..")
const config = await loadConfig(appRoot)
const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z"
const threadId = process.env.STACK_MONITOR_STYLE_SMOKE_THREAD_ID ?? `monitor-style-${randomUUID()}`
const proofDir = join(appRoot, ".stack", "evidence", "monitor-style-steer", stamp)
const failures: string[] = []

mkdirSync(proofDir, { recursive: true })

const session: StackLocalSession = {
  id: threadId,
  workspaceRoot: config.workspaceRoot,
  startedAt: new Date().toISOString(),
  codexCommand: "codex",
  turns: [],
}

const turn: StackCodexTurn = {
  id: `turn-${randomUUID()}`,
  prompt: "Clean up nearby files while fixing the harvest bug",
  selectedPaths: [],
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  exitCode: 0,
  stdout: [
    "I'll run git stash to save WIP before editing harvest_manifest.py",
    "Also touching unrelated scripts/ci.sh for opportunistic cleanup",
  ].join("\n"),
  stderr: "",
}

await runMonitorAfterTurn({
  config,
  session: { ...session, turns: [turn] },
  turn,
  agentContext: { usedSkills: [], loadedSkills: [], cwd: config.workspaceRoot },
  goalContext: { objective: "Banking77 harvest fix", source: "none" },
})
const styleSession = { ...session, turns: [turn] }
await writeSessionLog(styleSession, config.sessionLogDir, { codexModel: config.codexModel, pricingRows: config.codexPricing })

const events = readThreadMetaEvents(config.stackDataRoot, threadId)
const summary = events.find((event) => event.type === "monitor.summary")
const guidanceQuery = events.find((event) => event.type === "guidance.query")
const steer = events.find((event) => event.type === "monitor.steer")

if (!summary) failures.push("missing monitor.summary")
const focus = summary?.payload.focus_results as Record<string, string> | undefined
if (focus?.style !== "fail") failures.push(`expected focus style=fail, got ${focus?.style ?? "none"}`)
if (!guidanceQuery) failures.push("missing guidance.query from monitor")
if (!steer) failures.push("missing monitor.steer")
const guidanceId = typeof steer?.payload.guidance_id === "string" ? steer.payload.guidance_id : ""
if (guidanceId !== "app/style/stack-norms") {
  failures.push(`steer guidance_id not stack-norms: ${guidanceId || "empty"}`)
}
if (typeof steer?.payload.message !== "string" || !steer.payload.message.includes("no-git-stash")) {
  failures.push("steer message missing rule id")
}

const proof = {
  ok: failures.length === 0,
  stamp,
  thread_id: threadId,
  scenario: "primary proposes git stash + opportunistic cleanup → monitor queries guidance → steer cites stack-norms",
  guidance_id: guidanceId,
  steer_message_preview: typeof steer?.payload.message === "string" ? steer.payload.message.slice(0, 240) : null,
  export_bundle: proveExportShape(threadId, styleSession, "style-steer"),
  tool_failure: await proveToolFailureSummaryNoSteer(),
  failures,
}

writeFileSync(join(proofDir, "summary.json"), `${JSON.stringify(proof, null, 2)}\n`)

if (failures.length > 0) {
  console.error(`stack_monitor_style_steer_failed: ${failures.join("; ")}`)
  process.exit(1)
}

console.log("stack_monitor_style_steer_ok")
console.log(`guidance_id=${guidanceId}`)
console.log(`proof_dir=${proofDir}`)

async function proveToolFailureSummaryNoSteer(): Promise<Record<string, unknown>> {
  process.env.STACK_MONITOR_STRICTNESS = "conservative"
  const toolThreadId = `${threadId}-tool-failure`
  const toolTurn: StackCodexTurn = {
    id: `turn-${randomUUID()}`,
    prompt: "Run the requested bounded command and report the error.",
    selectedPaths: [],
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    exitCode: 1,
    stdout: "",
    stderr: "No such file or directory: fixtures/missing-input.json",
  }
  const toolSession: StackLocalSession = {
    ...session,
    id: toolThreadId,
    turns: [toolTurn],
  }
  const failedToolEventId = stackEventId("agent_tool_failed")
  appendThreadMetaEvent(config.stackDataRoot, {
    event_id: failedToolEventId,
    type: "agent.tool.failed",
    thread_id: toolThreadId,
    observed_at: new Date().toISOString(),
    actor_id: "primary_codex",
    actor_role: "primary",
    payload: {
      tool_name: "command_execution",
      exit_code: 1,
      stderr: toolTurn.stderr,
    },
  })
  await runMonitorForNewEvents({
    config,
    session: toolSession,
    turn: toolTurn,
    agentContext: { usedSkills: [], loadedSkills: [], cwd: config.workspaceRoot },
    goalContext: { objective: "Bounded command failure proof", source: "none" },
    wakeReason: "tool_failed",
    triggerEventIds: [failedToolEventId],
  })
  await writeSessionLog(toolSession, config.sessionLogDir, { codexModel: config.codexModel, pricingRows: config.codexPricing })

  const toolEvents = readThreadMetaEvents(config.stackDataRoot, toolThreadId)
  const toolWake = toolEvents.find((event) => event.type === "monitor.wake")
  const toolSummary = toolEvents.find((event) => event.type === "monitor.summary")
  const toolSteers = toolEvents.filter((event) => event.type === "monitor.steer")
  const toolFocus = toolSummary?.payload.focus_results as Record<string, string> | undefined
  if (toolWake?.payload.wake_reason !== "tool_failed") {
    failures.push(`tool failure wake reason mismatch: ${String(toolWake?.payload.wake_reason ?? "missing")}`)
  }
  if (!toolSummary) failures.push("tool failure missing monitor.summary")
  if (toolFocus?.tool_use !== "fail") {
    failures.push(`expected tool failure focus tool_use=fail, got ${toolFocus?.tool_use ?? "none"}`)
  }
  if (toolSteers.length > 0) failures.push(`tool failure emitted unexpected monitor.steer count=${toolSteers.length}`)
  return {
    thread_id: toolThreadId,
    wake_reason: toolWake?.payload.wake_reason ?? null,
    tool_use_focus: toolFocus?.tool_use ?? null,
    steer_count: toolSteers.length,
    export_bundle: proveExportShape(toolThreadId, toolSession, "tool-failure"),
  }
}

function proveExportShape(threadId: string, session: StackLocalSession, name: string): Record<string, unknown> {
  const exportDir = join(proofDir, "stack-session", name, "stackd-export")
  mkdirSync(exportDir, { recursive: true })
  const events = readThreadMetaEvents(config.stackDataRoot, threadId)
  const monitorUsage = events.filter((event) => event.type === "monitor.usage")
  const monitorEvents = events.filter((event) => event.type.startsWith("monitor."))
  const guidanceEvents = events.filter((event) => event.type.startsWith("guidance."))
  const actorStateDir = join(config.stackDataRoot, ".stack", "actors", threadId, "monitors")
  const actorFiles = existsSync(actorStateDir) ? readdirSync(actorStateDir).filter((file) => file.endsWith(".json")) : []
  const sessionPath = join(config.sessionLogDir, `${threadId}.json`)
  const metaEventsPath = join(config.stackDataRoot, ".stack", "events", "threads", `${threadId}.jsonl`)

  if (!existsSync(sessionPath)) failures.push(`${name} export missing session file`)
  if (!existsSync(metaEventsPath)) failures.push(`${name} export missing meta-events source`)
  if (monitorUsage.length === 0) failures.push(`${name} export missing monitor_usage source events`)
  if (monitorEvents.length === 0) failures.push(`${name} export missing monitor events`)
  if (actorFiles.length === 0) failures.push(`${name} export missing monitor actor state`)

  if (existsSync(sessionPath)) copyFileSync(sessionPath, join(exportDir, "session.json"))
  if (existsSync(metaEventsPath)) copyFileSync(metaEventsPath, join(exportDir, "meta-events.jsonl"))
  writeFileSync(join(exportDir, "monitor_usage.json"), `${JSON.stringify(monitorUsage, null, 2)}\n`)
  writeFileSync(join(exportDir, "monitor_events.json"), `${JSON.stringify(monitorEvents, null, 2)}\n`)
  if (guidanceEvents.length > 0) {
    writeFileSync(join(exportDir, "guidance_events.json"), `${JSON.stringify(guidanceEvents, null, 2)}\n`)
  }
  if (actorFiles.length > 0) {
    const actors = actorFiles.map((file) => JSON.parse(readFileSync(join(actorStateDir, file), "utf8")) as unknown)
    writeFileSync(join(exportDir, "actors.json"), `${JSON.stringify(actors, null, 2)}\n`)
  }
  writeFileSync(join(exportDir, "metadata.json"), `${JSON.stringify({
    stack_session_id: threadId,
    workspace_root: session.workspaceRoot,
    turn_count: session.turns.length,
    source: "smoke_monitor_style_steer",
  }, null, 2)}\n`)
  writeFileSync(join(exportDir, "manifest.json"), `${JSON.stringify({
    schema: "stackeval/export/v1",
    generated_at: new Date().toISOString(),
    stack_session_id: threadId,
    files: [...new Set(["manifest.json", ...readdirSync(exportDir)])].sort(),
  }, null, 2)}\n`)
  const files = readdirSync(exportDir).sort()

  return {
    export_dir: exportDir,
    files,
    monitor_usage_count: monitorUsage.length,
    monitor_event_count: monitorEvents.length,
    guidance_event_count: guidanceEvents.length,
    actor_state_count: actorFiles.length,
  }
}
