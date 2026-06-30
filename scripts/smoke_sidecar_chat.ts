#!/usr/bin/env bun
// AT-STACK-GOAL-SHUTTER-005, AT-STACK-GOAL-MON-001..004 — sidecar chat + narrator fields.

import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { loadConfig } from "../src/config.js"
import { runMonitorAfterOperatorMessage, runMonitorAfterTurn, runMonitorForNewEvents } from "../src/monitor.js"
import { appendThreadMetaEvent, readThreadMetaEvents, stackEventId } from "../src/thread-events.js"
import type { StackCodexTurn, StackLocalSession } from "../src/session.js"

process.env.STACK_MONITOR_PROFILE = "progress-narrator"
process.env.STACK_MONITOR_MODEL_WORKER = "deterministic"

const appRoot = resolve(import.meta.dir, "..")
const config = await loadConfig(appRoot)
const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z"
const threadId = process.env.STACK_SIDECAR_CHAT_SMOKE_THREAD_ID ?? `sidecar-chat-${randomUUID()}`
const proofDir = join(appRoot, ".stack", "evidence", "sidecar-chat", stamp)
const failures: string[] = []

mkdirSync(proofDir, { recursive: true })

const goalObjective = "Rebuild TicTacToe Harbor env; pass 20-scenario spectrum (harbor_reward=1.0)"
const goalContext = {
  objective: goalObjective,
  status: "active" as const,
  source: "context" as const,
  acceptanceCriteria: [
    "[x] SE-TTT-HARBOR-1-WORKSPACE green",
    "[ ] SE-TTT-HARBOR-2-SERVICE green",
    "[ ] SE-TTT-HARBOR-3-SPECTRUM harbor_reward=1.0",
  ],
}

const session: StackLocalSession = {
  id: threadId,
  workspaceRoot: config.workspaceRoot,
  startedAt: new Date().toISOString(),
  codexCommand: "codex",
  turns: [],
}

const turn: StackCodexTurn = {
  id: `turn-${randomUUID()}`,
  prompt: "Wire Harbor service boot on :19081",
  selectedPaths: [],
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  exitCode: 0,
  stdout: "Started Harbor service scaffold.",
  stderr: "",
}

await runMonitorAfterTurn({
  config,
  session: { ...session, turns: [turn] },
  turn,
  agentContext: { usedSkills: [], loadedSkills: [], cwd: config.workspaceRoot },
  goalContext,
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
  agentContext: { usedSkills: [], loadedSkills: [], cwd: config.workspaceRoot },
  goalContext,
  wakeReason: "tool_failed",
  triggerEventIds: [readThreadMetaEvents(config.appRoot, threadId).at(-1)!.event_id],
})

await runMonitorAfterOperatorMessage({
  config,
  session,
  message: "Are we on track for criterion 2?",
  agentContext: { usedSkills: [], loadedSkills: [], cwd: config.workspaceRoot },
  goalContext,
})

const events = readThreadMetaEvents(config.appRoot, threadId)
const summaries = events.filter((event) => event.type === "monitor.summary")
const chatRequests = events.filter((event) => event.type === "monitor.chat.request")
const chatReplies = events.filter((event) => event.type === "monitor.chat.reply")
const operatorWakes = events.filter(
  (event) =>
    event.type === "monitor.wake" && readString(event.payload.wake_reason) === "operator_message",
)

if (chatRequests.length !== 1) failures.push(`expected 1 monitor.chat.request, got ${chatRequests.length}`)
if (chatReplies.length !== 1) failures.push(`expected 1 monitor.chat.reply, got ${chatReplies.length}`)
if (operatorWakes.length > 0) {
  failures.push("goal-mode sidecar chat should not emit operator_message monitor.summary wake")
}

const latestSummary = summaries.at(-1)
const operatorUpdate = asRecord(latestSummary?.payload.operator_update)
const criteriaProgress = asRecord(operatorUpdate?.criteria_progress)
if (!criteriaProgress || readNumber(criteriaProgress.total) !== 3) {
  failures.push("expected criteria_progress.total=3 in monitor.summary")
}
if (readNumber(criteriaProgress?.done) !== 1) {
  failures.push(`expected criteria_progress.done=1, got ${String(criteriaProgress?.done)}`)
}

const eta = asRecord(operatorUpdate?.eta)
if (!eta || !readString(eta.confidence)) failures.push("expected ETA band on repeated wakes")

const reply = chatReplies[0]
const replyPayload = reply?.payload ?? {}
const answer = readString(replyPayload.answer)
if (!answer) failures.push("monitor.chat.reply answer missing")
const criteriaRefs = Array.isArray(replyPayload.criteria_refs) ? replyPayload.criteria_refs : []
const cited = Array.isArray(replyPayload.cited_event_ids) ? replyPayload.cited_event_ids : []
if (criteriaRefs.length === 0 && cited.length === 0) {
  failures.push("sidecar chat reply must cite criterion or event id")
}
if (!answer?.includes("Harbor") && !answer?.includes("criterion")) {
  failures.push("sidecar chat answer should reference goal or criterion")
}

const summary = {
  stamp,
  thread_id: threadId,
  summary_count: summaries.length,
  chat_request_count: chatRequests.length,
  chat_reply_count: chatReplies.length,
  operator_wake_count: operatorWakes.length,
  criteria_progress: criteriaProgress,
  eta,
  reply: {
    answer,
    criteria_refs: criteriaRefs,
    cited_event_ids: cited,
    source: readString(replyPayload.source),
  },
  failures,
  ok: failures.length === 0,
}

writeFileSync(join(proofDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n")

if (failures.length > 0) {
  console.error(failures.join("\n"))
  process.exit(1)
}

console.log("stack_sidecar_chat_ok")
console.log(JSON.stringify(summary, null, 2))

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined
}
