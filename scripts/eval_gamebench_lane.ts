#!/usr/bin/env bun
//
// Lane-parameterized end-to-end gamebench goal eval. Runs a REAL worker on a lane's objective in the
// GitHub workspace, streams its events into the log, wakes the monitor mid-flight, and grades the
// monitor's behavior into a scorecard row. Generalizes accept_craftax_midflight over lanes.
//
// Usage:  bun run scripts/eval_gamebench_lane.ts <lane_name> [<lane_name> ...]
//   env:  GAMEBENCH_ROOT (defaults to ~/Documents/GitHub/gamebench)
// A scoreboard (one row per lane) is printed + written to .stack/evidence/gamebench-goal-evals/.

import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { loadConfig } from "../src/config.js"
import { runCodexTurn } from "../src/codex/app-server-session.js"
import { runMonitorForNewEvents } from "../src/monitor.js"
import { recordCoreAgentEventsFromCodexLine } from "../src/core-agent-events.js"
import { readThreadMetaEvents } from "../src/thread-events.js"
import { reduceGoalSessionSnapshot } from "../src/goal-session.js"
import { goalMilestonesFromEvents } from "../src/tui/monitor-thread.js"
import type { StackLocalSession } from "../src/session.js"
import type { StackThreadMetaEvent } from "../src/thread-events.js"

process.env.STACK_MONITOR_PROFILE = "default"
delete process.env.STACK_CODEX_COMMAND
delete process.env.STACK_CODEX_ARGS

const appRoot = resolve(import.meta.dir, "..")
const workspaceRoot = "/Users/joshpurtell/Documents/GitHub"
const lanesRoot = join(workspaceRoot, "evals/reportbench/lanes")
const config = { ...(await loadConfig(appRoot)), workspaceRoot }

const lanes = process.argv.slice(2)
if (lanes.length === 0) {
  console.error("usage: bun run scripts/eval_gamebench_lane.ts <lane_name> [<lane_name> ...]")
  process.exit(2)
}

function objectiveForLane(lane: string): string {
  const instr = join(lanesRoot, lane, "TASK_INSTRUCTIONS.md")
  const title = existsSync(join(lanesRoot, lane, "task.toml"))
    ? readFileSync(join(lanesRoot, lane, "task.toml"), "utf8").match(/description\s*=\s*"([^"]+)"/)?.[1]
    : undefined
  const hint = existsSync(instr) ? readFileSync(instr, "utf8").split("\n").find((l) => l.trim().length > 40)?.trim() : undefined
  return `Work the ReportBench lane "${lane}" from ${join(lanesRoot, lane)} (read TASK_INSTRUCTIONS.md). ${title ?? hint ?? ""} Read existing artifacts; do not run heavy evals. Report file paths + concrete scores, and state clearly whether the goal is met.`
}

type Row = {
  lane: string
  worker_exit: number
  wall_s: number
  wakes: number
  progress_updates: number
  goal_status: string[]
  final_status: string | undefined
  feed_nonempty: boolean
  narrates: boolean
}

const rows: Row[] = []

for (const lane of lanes) {
  const objective = objectiveForLane(lane)
  const goalContext = { objective, status: "active" as const, source: "context" as const }
  const threadId = `gb-lane-${lane.slice(0, 20)}-${randomUUID().slice(0, 8)}`
  const session: StackLocalSession = { id: threadId, workspaceRoot, startedAt: new Date().toISOString(), codexCommand: "codex", turns: [] }
  const agentContext = { usedSkills: [], loadedSkills: [], cwd: workspaceRoot }

  const t0 = Date.now()
  let monitorChain: Promise<void> = Promise.resolve()
  let buffer = ""
  let sinceWake = 0
  let lastWakeMs = 0
  let wakes = 0

  console.log(`\n=== ${lane} ===\nobjective: ${objective.slice(0, 140)}…`)

  const wakeMonitor = () => {
    const last = readThreadMetaEvents(config.stackDataRoot, threadId).at(-1)
    wakes += 1
    monitorChain = monitorChain
      .then(() => runMonitorForNewEvents({ config, session, agentContext, goalContext, wakeReason: "event_batch", triggerEventIds: last ? [last.event_id] : [] }))
      .then(() => {}, () => {})
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
        sinceWake += recordCoreAgentEventsFromCodexLine({ stackRoot: config.stackDataRoot, threadId, actorId: "primary_codex" }, line).length
      }
      const now = Date.now()
      if (sinceWake >= 4 && now - lastWakeMs >= 12_000) {
        lastWakeMs = now
        sinceWake = 0
        wakeMonitor()
      }
    },
  }).catch((e) => {
    console.error(`worker error: ${e instanceof Error ? e.message : String(e)}`)
    return { id: "err", prompt: objective, selectedPaths: [], startedAt: "", finishedAt: "", exitCode: 1, stdout: "", stderr: String(e) } as Awaited<ReturnType<typeof runCodexTurn>>
  })

  await monitorChain
  await runMonitorForNewEvents({ config, session: { ...session, turns: [turn] }, turn, agentContext, goalContext, wakeReason: "turn_completed", triggerEventIds: [] }).catch(() => {})

  const events = readThreadMetaEvents(config.stackDataRoot, threadId)
  const feed = events.filter((e: StackThreadMetaEvent) => e.type === "monitor.progress" || e.type === "monitor.steer")
  const milestones = goalMilestonesFromEvents(events)
  const finalStatus = reduceGoalSessionSnapshot({ events, goal: { objective, status: "active", acceptanceCriteria: [] }, metaThreadId: undefined, monitorThreadSpendUsd: 0 })?.status
  const narrates = feed.some((e) => /\b(baseline|candidate|scenario|diagnos|trace|score|reward|leaderboard|resolved|found|located|read)\b/i.test(String((e.payload as Record<string, unknown>).summary ?? (e.payload as Record<string, unknown>).message ?? "")))

  const row: Row = {
    lane,
    worker_exit: turn.exitCode ?? -1,
    wall_s: Math.round((Date.now() - t0) / 1000),
    wakes,
    progress_updates: feed.filter((e) => e.type === "monitor.progress").length,
    goal_status: milestones.map((m) => m.status),
    final_status: finalStatus,
    feed_nonempty: feed.length > 0,
    narrates,
  }
  rows.push(row)
  console.log("feed:")
  for (const e of feed) console.log(`  · ${e.type === "monitor.steer" ? "steer" : "progress"} — ${String((e.payload as Record<string, unknown>).summary ?? (e.payload as Record<string, unknown>).message ?? "").slice(0, 160)}`)
  console.log(`row: ${JSON.stringify(row)}`)
}

console.log("\n=== SCOREBOARD ===")
console.log(JSON.stringify(rows, null, 2))
const proofDir = join(config.stackDataRoot, ".stack/evidence/gamebench-goal-evals")
try {
  mkdirSync(proofDir, { recursive: true })
  writeFileSync(join(proofDir, `scoreboard-${lanes.length}lanes.json`), JSON.stringify(rows, null, 2) + "\n")
} catch { /* best effort */ }
