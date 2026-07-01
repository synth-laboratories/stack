#!/usr/bin/env bun
//
// Real-brain check: does the monitor actually CALL the new `stack_monitor_goal_status` tool and
// emit `goal_met` after auditing a worker completion claim that clears the target? Scripted worker
// event, real codex sidecar.

import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { loadConfig } from "../src/config.js"
import { runMonitorAfterTurn } from "../src/monitor.js"
import { readThreadMetaEvents } from "../src/thread-events.js"
import type { StackCodexTurn, StackLocalSession } from "../src/session.js"

process.env.STACK_MONITOR_PROFILE = "default"
const appRoot = resolve(import.meta.dir, "..")
delete process.env.STACK_CODEX_COMMAND
delete process.env.STACK_CODEX_ARGS

const config = await loadConfig(appRoot)
const threadId = `accept-goal-status-${randomUUID()}`
const session: StackLocalSession = {
  id: threadId,
  workspaceRoot: config.workspaceRoot,
  startedAt: new Date().toISOString(),
  codexCommand: "codex",
  turns: [],
}
const goalContext = {
  objective: "Grind a craftax candidate until it is 2x the 0.0871 baseline on 100 seeds.",
  status: "active" as const,
  source: "context" as const,
}

const turn: StackCodexTurn = {
  id: `turn-${randomUUID()}`,
  prompt: "Grind a candidate and report the result.",
  selectedPaths: [],
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  exitCode: 0,
  stdout:
    "Candidate cand_b scored mean reward 0.22 over 100 seeds (proof: reports/policy_sweep/candidate_v100.json). Baseline is 0.0871, so 0.22/0.0871 = 2.53x, which clears the 2x target. Goal complete.",
  stderr: "",
}

await runMonitorAfterTurn({
  config,
  session: { ...session, turns: [turn] },
  turn,
  agentContext: { usedSkills: [], loadedSkills: [], cwd: config.workspaceRoot },
  goalContext,
})

const events = readThreadMetaEvents(config.stackDataRoot, threadId)
const goalStatus = events.filter((e) => e.type === "monitor.goal_status")
const met = goalStatus.find((e) => (e.payload as Record<string, unknown>).status === "goal_met")

const failures: string[] = []
if (goalStatus.length === 0) failures.push("monitor did not call stack_monitor_goal_status at all")
if (!met) failures.push(`monitor did not emit goal_met on a clearing claim; statuses: ${goalStatus.map((e) => (e.payload as Record<string, unknown>).status).join(",") || "(none)"}`)

console.log(
  JSON.stringify(
    {
      goal_status_events: goalStatus.map((e) => ({
        status: (e.payload as Record<string, unknown>).status,
        note: (e.payload as Record<string, unknown>).note,
        metric: (e.payload as Record<string, unknown>).metric,
      })),
      failures,
      ok: failures.length === 0,
    },
    null,
    2,
  ),
)
if (failures.length > 0) process.exit(1)
console.log("accept_goal_status_tool_ok")
