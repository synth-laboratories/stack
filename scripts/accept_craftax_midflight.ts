#!/usr/bin/env bun
//
// Answers: does the monitor provide a RUNNING feed that tells you if the worker is on track?
// A real codex worker works the craftax objective; its JSONL stream is fed into the event log
// line-by-line AS IT ARRIVES, and the monitor is woken on a throttled cadence DURING the run
// (exactly what the TUI does). We then print the feed the human would have seen live.

import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { loadConfig } from "../src/config.js"
import { runCodexTurn } from "../src/codex/app-server-session.js"
import { runMonitorForNewEvents } from "../src/monitor.js"
import { recordCoreAgentEventsFromCodexLine } from "../src/core-agent-events.js"
import { readThreadMetaEvents } from "../src/thread-events.js"
import type { StackLocalSession } from "../src/session.js"

process.env.STACK_MONITOR_PROFILE = "default"
delete process.env.STACK_CODEX_COMMAND
delete process.env.STACK_CODEX_ARGS

const appRoot = resolve(import.meta.dir, "..")
const workspaceRoot = "/Users/joshpurtell/Documents/GitHub"
const config = { ...(await loadConfig(appRoot)), workspaceRoot }
const threadId = `craftax-midflight-${randomUUID()}`
const objective =
  "Find the gamebench craftax code-policy setting under gamebench/tasks/craftax-singleplayer, read the 100-seed baseline and candidate score artifacts in its reports/policy_sweep folder, and determine whether a candidate is 2x the baseline. Report file paths + concrete scores. Read existing artifacts, do not run heavy evals."
const goalContext = { objective, status: "active" as const, source: "context" as const }
const session: StackLocalSession = { id: threadId, workspaceRoot, startedAt: new Date().toISOString(), codexCommand: "codex", turns: [] }
const agentContext = { usedSkills: [], loadedSkills: [], cwd: workspaceRoot }

const t0 = Date.now()
const el = () => `${String(Math.round((Date.now() - t0) / 1000)).padStart(3)}s`
let monitorChain: Promise<void> = Promise.resolve()
let buffer = ""
let sinceWake = 0
let lastWakeMs = 0
let wakes = 0

console.log(`REAL worker in ${workspaceRoot}; monitor woken on cadence DURING the run\n`)

const wakeMonitor = (reason: string) => {
  const last = readThreadMetaEvents(config.stackDataRoot, threadId).at(-1)
  wakes += 1
  const at = el()
  monitorChain = monitorChain
    .then(() => runMonitorForNewEvents({ config, session, agentContext, goalContext, wakeReason: reason, triggerEventIds: last ? [last.event_id] : [] }))
    .then(() => { console.log(`[${at}] monitor woke (${reason})`) }, () => {})
}

const turn = await runCodexTurn({
  config,
  userPrompt: objective,
  selectedFiles: [],
  priorTurns: [],
  goalContext,
  onOutput: (chunk) => {
    buffer += chunk
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      if (!line.trim()) continue
      const appended = recordCoreAgentEventsFromCodexLine({ stackRoot: config.stackDataRoot, threadId, actorId: "primary_codex" }, line)
      sinceWake += appended.length
    }
    const now = Date.now()
    if (sinceWake >= 4 && now - lastWakeMs >= 8_000) {
      lastWakeMs = now
      sinceWake = 0
      wakeMonitor("event_batch")
    }
  },
})

await monitorChain
// final end-of-run audit
await runMonitorForNewEvents({ config, session: { ...session, turns: [turn] }, turn, agentContext, goalContext, wakeReason: "turn_completed", triggerEventIds: [] }).catch(() => {})

const events = readThreadMetaEvents(config.stackDataRoot, threadId)
const feed = events.filter((e) => e.type === "monitor.progress" || e.type === "monitor.goal_status" || e.type === "monitor.steer")

console.log(`\nworker done in ${el()} · monitor woken ${wakes}x during the run + 1 final\n`)
console.log("=== THE FEED (what the human saw over the run) ===")
if (feed.length === 0) console.log("  (monitor emitted no human-facing updates)")
for (const e of feed) {
  const p = e.payload as Record<string, unknown>
  const label = e.type === "monitor.goal_status" ? `goal:${p.status}` : e.type === "monitor.steer" ? "steer" : "progress"
  const text = String(p.summary ?? p.note ?? p.message ?? "")
  console.log(`  · ${label} — ${text.slice(0, 200)}`)
}
