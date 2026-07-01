#!/usr/bin/env bun
//
// Lane-parameterized end-to-end gamebench goal eval. Runs a REAL worker on a lane's objective in the
// GitHub workspace, streams its events into the log, wakes the monitor mid-flight, and grades the
// monitor's behavior into a scorecard row. Generalizes accept_craftax_midflight over lanes.
//
// Usage:
//   bun run scripts/eval_gamebench_lane.ts --preset smoke
//   bun run scripts/eval_gamebench_lane.ts --preset core-5x3
//   bun run scripts/eval_gamebench_lane.ts <lane_name> [<lane_name> ...]
//
// A scored evidence packet is printed and written to .stack/evidence/gamebench-goal-evals/.

import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { loadConfig } from "../src/config.js"
import { runCodexTurn } from "../src/codex/app-server-session.js"
import { runMonitorForNewEvents } from "../src/monitor.js"
import { enrichGameBenchGoalContext } from "../src/gamebench-goal.js"
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
const workerTimeoutMs = readPositiveInt(process.env.STACK_GAMEBENCH_LANE_TIMEOUT_MS) ?? 120_000
process.env.STACK_MONITOR_CODEX_TIMEOUT_MS ??= String(workerTimeoutMs)

const POLICY_OPT_LANES = [
  "craftax_gamebench_code_policy_deo_hillclimb_1cand",
  "crafter_gamebench_code_policy_deo_hillclimb_1cand",
  "minihack_gamebench_code_policy_deo_hillclimb_1cand",
  "sokoban_gamebench_code_policy_deo_hillclimb_1cand",
  "tictactoe_gamebench_code_policy_deo_hillclimb_1cand",
]

const ENGINE_REBUILD_LANES = [
  "craftax_gamebench_engine_rebuild_1cand",
  "crafter_gamebench_engine_rebuild_1cand",
  "minihack_gamebench_engine_rebuild_1cand",
  "sokoban_gamebench_engine_rebuild_1cand",
  "tictactoe_gamebench_engine_rebuild_1cand",
]

const PUZZLE_DIAGNOSIS_LANES = [
  "crafter_gamebench_policy_puzzle_front_only_1cand",
  "crafter_gamebench_policy_puzzle_premature_pickaxe_1cand",
  "crafter_gamebench_policy_puzzle_explore_never_1cand",
  "crafter_gamebench_policy_puzzle_stone_blind_1cand",
  "crafter_gamebench_policy_puzzle_mob_suicide_1cand",
]

const args = process.argv.slice(2)
const presetIndex = args.indexOf("--preset")
const preset = presetIndex >= 0 ? args[presetIndex + 1] : undefined
const laneArgs = args.filter((arg, index) => arg !== "--preset" && (presetIndex < 0 || index !== presetIndex + 1))
const lanes = lanesFor(preset, laneArgs)
if (lanes.length === 0) {
  console.error("usage: bun run scripts/eval_gamebench_lane.ts --preset smoke|core-5x3 OR <lane_name> [<lane_name> ...]")
  process.exit(2)
}

function lanesFor(presetName: string | undefined, explicit: string[]): string[] {
  if (explicit.length > 0) return explicit
  if (!presetName) return []
  if (presetName === "smoke") {
    return [POLICY_OPT_LANES[0]!, ENGINE_REBUILD_LANES[0]!, PUZZLE_DIAGNOSIS_LANES[0]!]
  }
  if (presetName === "core-5x3") {
    return [...POLICY_OPT_LANES, ...ENGINE_REBUILD_LANES, ...PUZZLE_DIAGNOSIS_LANES]
  }
  throw new Error(`unknown preset ${presetName}; expected smoke or core-5x3`)
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
  task_type: string | undefined
  criteria_count: number
  gate_count: number
  worker_exit: number
  wall_s: number
  wakes: number
  progress_updates: number
  steer_updates: number
  goal_status: string[]
  final_status: string | undefined
  feed_nonempty: boolean
  narrates: boolean
  mechanics_hidden: boolean
  monitor_pass: boolean
  failures: string[]
  thread_id: string
}

const rows: Row[] = []

for (const lane of lanes) {
  const objective = objectiveForLane(lane)
  const goalContext = enrichGameBenchGoalContext(
    { objective, status: "active" as const, source: "context" as const },
    workspaceRoot,
  )
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
  console.log(`worker_timeout_ms=${workerTimeoutMs}`)

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
    timeoutMs: workerTimeoutMs,
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
  const finalStatus = reduceGoalSessionSnapshot({
    events,
    goal: { objective, status: "active", acceptanceCriteria: goalContext.acceptanceCriteria ?? [] },
    metaThreadId: undefined,
    monitorThreadSpendUsd: 0,
  })?.status
  const feedText = feed.map(feedEventText).join("\n")
  const narrates = /\b(baseline|candidate|scenario|diagnos|trace|score|reward|leaderboard|resolved|found|located|read|stalled|blocked|verifier|harbor|engine|policy)\b/i.test(feedText)
  const mechanicsHidden = !/\bNO_USER_UPDATE\b|checkpoint advanced|pause_for_restart/i.test(feedText)
  const failures = rowFailures({
    taskType: goalContext.gamebenchTask?.taskType,
    feed,
    milestones,
    finalStatus,
    narrates,
    mechanicsHidden,
  })

  const row: Row = {
    lane,
    task_type: goalContext.gamebenchTask?.taskType,
    criteria_count: goalContext.acceptanceCriteria?.length ?? 0,
    gate_count: goalContext.gamebenchTask?.gates?.length ?? 0,
    worker_exit: turn.exitCode ?? -1,
    wall_s: Math.round((Date.now() - t0) / 1000),
    wakes,
    progress_updates: feed.filter((e) => e.type === "monitor.progress").length,
    steer_updates: feed.filter((e) => e.type === "monitor.steer").length,
    goal_status: milestones.map((m) => m.status),
    final_status: finalStatus,
    feed_nonempty: feed.length > 0,
    narrates,
    mechanics_hidden: mechanicsHidden,
    monitor_pass: failures.length === 0,
    failures,
    thread_id: threadId,
  }
  rows.push(row)
  console.log("feed:")
  for (const e of feed) console.log(`  · ${e.type === "monitor.steer" ? "steer" : "progress"} — ${feedEventText(e).slice(0, 160)}`)
  console.log(`row: ${JSON.stringify(row)}`)
}

const byType = summarizeByType(rows)
const failures = rows.filter((row) => !row.monitor_pass)
const packet = {
  ok: failures.length === 0,
  preset: preset ?? "explicit",
  lane_count: rows.length,
  by_type: byType,
  failures: failures.map((row) => ({ lane: row.lane, failures: row.failures, thread_id: row.thread_id })),
  rows,
}

console.log("\n=== SCOREBOARD ===")
console.log(JSON.stringify(packet, null, 2))
const proofDir = join(config.stackDataRoot, ".stack/evidence/gamebench-goal-evals")
try {
  mkdirSync(proofDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z"
  writeFileSync(join(proofDir, `scoreboard-${stamp}-${lanes.length}lanes.json`), `${JSON.stringify(packet, null, 2)}\n`)
} catch { /* best effort */ }
if (failures.length > 0 && process.env.STACK_GAMEBENCH_LANE_EVAL_ALLOW_FAILURES !== "1") {
  console.error(`\nGAMEBENCH LANE EVAL FAILED (${failures.length}/${rows.length})`)
  process.exit(1)
}

function rowFailures(input: {
  taskType: string | undefined
  feed: StackThreadMetaEvent[]
  milestones: ReturnType<typeof goalMilestonesFromEvents>
  finalStatus: string | undefined
  narrates: boolean
  mechanicsHidden: boolean
}): string[] {
  const out: string[] = []
  if (!input.taskType || input.taskType === "unknown") out.push("task type was not classified")
  if (input.feed.length === 0) out.push("monitor produced no human-facing feed")
  if (!input.narrates) out.push("feed did not narrate lane-relevant work/progress")
  if (input.milestones.length === 0) out.push("monitor produced no structured goal_status milestone")
  if (input.finalStatus === "blocked") out.push("nonterminal monitor status reduced the goal session to blocked")
  if (!input.mechanicsHidden) out.push("feed leaked runtime mechanics")
  return out
}

function summarizeByType(rowsToSummarize: Row[]): Record<string, { total: number; passed: number }> {
  const summary: Record<string, { total: number; passed: number }> = {}
  for (const row of rowsToSummarize) {
    const key = row.task_type ?? "unknown"
    summary[key] ??= { total: 0, passed: 0 }
    summary[key].total += 1
    if (row.monitor_pass) summary[key].passed += 1
  }
  return summary
}

function feedEventText(event: StackThreadMetaEvent): string {
  const payload = event.payload as Record<string, unknown>
  return String(payload.summary ?? payload.message ?? payload.note ?? "")
}

function readPositiveInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}
