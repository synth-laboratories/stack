#!/usr/bin/env bun
//
// GENUINE end-to-end: a REAL codex worker actually works the craftax objective in the real
// workspace (finds the setting, reads the baseline/candidate artifacts, reports real numbers),
// then the REAL monitor audits THE WORKER'S OWN output and (if it clears) emits goal_met → done.
// Nothing about the worker's result is scripted here.

import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { loadConfig } from "../src/config.js"
import { runCodexTurn } from "../src/codex/app-server-session.js"
import { runMonitorAfterTurn } from "../src/monitor.js"
import { readThreadMetaEvents } from "../src/thread-events.js"
import { reduceGoalSessionSnapshot } from "../src/goal-session.js"
import { goalMilestonesFromEvents, goalProgressStripLine } from "../src/tui/monitor-thread.js"
import type { StackLocalSession } from "../src/session.js"

process.env.STACK_MONITOR_PROFILE = "default"
delete process.env.STACK_CODEX_COMMAND
delete process.env.STACK_CODEX_ARGS

const appRoot = resolve(import.meta.dir, "..")
const workspaceRoot = "/Users/joshpurtell/Documents/GitHub"
const base = await loadConfig(appRoot)
const config = { ...base, workspaceRoot }

const threadId = `accept-craftax-real-${randomUUID()}`
const objective =
  "find the gamebench craftax code policy setting, get the baseline code policy score on 100 seeds, then confirm whether the repo already has a candidate that is 2x better. Report the exact file paths and the concrete scores. Do not run heavy evals — read existing artifacts. When done, state clearly whether the 2x goal is met."
const goalContext = { objective, status: "active" as const, source: "context" as const }

console.log(`REAL worker starting in ${workspaceRoot}\nobjective: ${objective}\n`)
const t0 = Date.now()

let outLen = 0
const turn = await runCodexTurn({
  config,
  userPrompt: objective,
  selectedFiles: [],
  priorTurns: [],
  goalContext,
  onOutput: (chunk) => {
    outLen += chunk.length
  },
})
console.log(`worker turn done in ${Math.round((Date.now() - t0) / 1000)}s · exit ${turn.exitCode} · ${outLen} chars streamed\n`)
console.log("=== worker report (tail) ===")
console.log((turn.stdout || "(no stdout)").slice(-1200))

const session: StackLocalSession = {
  id: threadId,
  workspaceRoot,
  startedAt: new Date().toISOString(),
  codexCommand: "codex",
  turns: [turn],
}
console.log("\n=== running the monitor to audit the worker's real output ===")
await runMonitorAfterTurn({
  config,
  session,
  turn,
  agentContext: { usedSkills: [], loadedSkills: [], cwd: workspaceRoot },
  goalContext,
})

const events = readThreadMetaEvents(config.stackDataRoot, threadId)
const milestones = goalMilestonesFromEvents(events)
const met = milestones.find((m) => m.status === "goal_met")
const status = reduceGoalSessionSnapshot({ events, goal: { objective, status: "active", acceptanceCriteria: [] }, metaThreadId: undefined, monitorThreadSpendUsd: 0 })?.status

console.log("\n=== monitor structured goal_status ===")
console.log("strip:", goalProgressStripLine(events, 120) ?? "(none emitted)")
for (const m of milestones) console.log(`  ${m.status} · ${m.note}${m.metric ? ` [${JSON.stringify(m.metric)}]` : ""}`)
console.log(`\ngoal session status: ${status}`)
console.log(JSON.stringify({ worker_exit: turn.exitCode, milestones: milestones.length, goal_met: Boolean(met), status }, null, 2))
