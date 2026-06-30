#!/usr/bin/env bun

import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { loadConfig } from "../src/config.js"
import { runMonitorAfterTurn, runMonitorForNewEvents } from "../src/monitor.js"
import { appendThreadMetaEvent, readThreadMetaEvents, stackEventId } from "../src/thread-events.js"
import type { StackCodexTurn, StackLocalSession } from "../src/session.js"

process.env.STACK_MONITOR_PROFILE = "progress-narrator"
process.env.STACK_MONITOR_MODEL_WORKER = "deterministic"

const appRoot = resolve(import.meta.dir, "..")
const config = await loadConfig(appRoot)
const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z"
const threadId = process.env.STACK_MONITOR_NARRATOR_SMOKE_THREAD_ID ?? `monitor-narrator-${randomUUID()}`
const proofDir = join(appRoot, ".stack", "evidence", "monitor-narrator", stamp)
const failures: string[] = []

mkdirSync(proofDir, { recursive: true })

const goalObjective = "Rebuild TicTacToe Harbor env; pass 20-scenario spectrum (harbor_reward=1.0)"

const session: StackLocalSession = {
  id: threadId,
  workspaceRoot: config.workspaceRoot,
  startedAt: new Date().toISOString(),
  codexCommand: "codex",
  turns: [],
}

const turn: StackCodexTurn = {
  id: `turn-${randomUUID()}`,
  prompt: "Implement candidate/scripts/run_service.py for Harbor tictactoe gold env",
  selectedPaths: [],
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  exitCode: 0,
  stdout: "Created run_service.py scaffold and started wiring gold/engine module.",
  stderr: "",
}

await runMonitorAfterTurn({
  config,
  session: { ...session, turns: [turn] },
  turn,
  agentContext: { usedSkills: [], loadedSkills: [], cwd: config.workspaceRoot },
  goalContext: {
    objective: goalObjective,
    status: "active",
    source: "context",
  },
})

appendThreadMetaEvent(config.appRoot, {
  event_id: stackEventId("agent_tool_failed"),
  type: "agent.tool.failed",
  thread_id: threadId,
  observed_at: new Date().toISOString(),
  actor_id: "primary_codex",
  actor_role: "primary",
  payload: {
    tool_name: "bash",
    command: "python3 -m pytest workspace/candidate/tests",
    message: "ImportError: missing gold.board module",
  },
})

await runMonitorForNewEvents({
  config,
  session,
  turn,
  agentContext: { usedSkills: [], loadedSkills: [], cwd: config.workspaceRoot },
  goalContext: {
    objective: goalObjective,
    status: "active",
    source: "context",
  },
  wakeReason: "tool_failed",
  triggerEventIds: [readThreadMetaEvents(config.appRoot, threadId).at(-1)!.event_id],
})

const events = readThreadMetaEvents(config.appRoot, threadId)
const summaries = events.filter((event) => event.type === "monitor.summary")
const steers = events.filter((event) => event.type === "monitor.steer")
const queued = events.filter((event) => event.type === "monitor.queued")
const latest = summaries.at(-1)

if (summaries.length < 2) failures.push(`expected >=2 monitor.summary events, got ${summaries.length}`)
if (steers.length > 0) failures.push("passive narrator must not emit monitor.steer")
if (queued.length > 0) failures.push("passive narrator must not emit monitor.queued")
if (!latest) failures.push("missing latest monitor.summary")

const payload = latest?.payload ?? {}
const focus = payload.focus_results as Record<string, unknown> | undefined
if (focus?.goal_progress !== "pass") failures.push(`expected focus_results.goal_progress=pass, got ${String(focus?.goal_progress)}`)

const goalSnapshot = payload.goal_snapshot as Record<string, unknown> | undefined
if (readString(goalSnapshot?.objective) !== goalObjective) {
  failures.push("goal_snapshot.objective missing or wrong")
}

const operatorUpdate = payload.operator_update as Record<string, unknown> | undefined
if (!readString(operatorUpdate?.working_on)) failures.push("operator_update.working_on missing")
if (!readString(operatorUpdate?.progress_note)) failures.push("operator_update.progress_note missing")
if (!readString(operatorUpdate?.struggling_with)) failures.push("operator_update.struggling_with missing on tool_failed wake")

const summaryText = readString(payload.summary) ?? ""
if (!summaryText.includes("Working on:") && !summaryText.includes(goalObjective.slice(0, 20))) {
  failures.push("summary must cite goal/working_on")
}

const summary = {
  stamp,
  thread_id: threadId,
  profile: "progress-narrator",
  summary_count: summaries.length,
  latest_summary: summaryText,
  operator_update: operatorUpdate,
  goal_snapshot: goalSnapshot,
  focus_results: focus,
  failures,
  ok: failures.length === 0,
}

writeFileSync(join(proofDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n")

if (failures.length > 0) {
  console.error(failures.join("\n"))
  process.exit(1)
}

console.log("stack_monitor_narrator_ok")
console.log(JSON.stringify(summary, null, 2))

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}
