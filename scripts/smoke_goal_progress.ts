#!/usr/bin/env bun
//
// Deterministic test for the STRUCTURED goal-progress signal: the monitor's `monitor.goal_status`
// events → milestone extraction + headline strip, and the reducer flip (goal_met → goal done).
// This is the "simple beats text dump" path: typed events, visualized.

import { goalMilestonesFromEvents, goalProgressStripLine } from "../src/tui/monitor-thread.js"
import { reduceGoalSessionSnapshot } from "../src/goal-session.js"
import type { StackThreadMetaEvent } from "../src/thread-events.js"

const failures: string[] = []
let checks = 0
const check = (cond: boolean, msg: string) => {
  checks += 1
  if (!cond) failures.push(msg)
}

let n = 0
const status = (s: string, note: string, metric?: Record<string, unknown>): StackThreadMetaEvent =>
  ({
    event_id: `gs${n++}`,
    type: "monitor.goal_status",
    thread_id: "t",
    observed_at: `2026-07-01T00:00:0${n}Z`,
    actor_id: "monitor",
    actor_role: "monitor",
    payload: { status: s, note, metric: metric ?? null, source: "sidecar_codex_tool" },
  }) as StackThreadMetaEvent

const events: StackThreadMetaEvent[] = [
  status("advancing", "Baseline pinned", { value: 0.0871, baseline: 0.0871, target: 2 }),
  status("blocked", "candidate runner missing"),
  status("advancing", "candidate produced", { value: 0.22, baseline: 0.0871, ratio: 2.53, target: 2 }),
]

// --- milestone extraction ---
const milestones = goalMilestonesFromEvents([...events, { type: "agent.tool.completed", payload: {} } as StackThreadMetaEvent])
check(milestones.length === 3, `extracts only goal_status events, got ${milestones.length}`)
check(milestones[0].status === "advancing" && milestones[1].status === "blocked", "preserves order + status")

// --- headline strip (latest status + metric) ---
const strip = goalProgressStripLine(events, 120) ?? ""
check(strip.includes("advancing"), "strip shows the latest status")
check(strip.includes("2.53×"), `strip shows the ratio metric, got: ${strip}`)
check(strip.includes("0.22 vs 0.0871"), "strip shows value vs baseline")
check(strip.includes("target 2×"), `ratio target renders as N×, got: ${strip}`)
// an ABSOLUTE score target (< 1.5) must NOT be mislabelled as a ratio ("target 0.17×")
const absStrip = goalProgressStripLine([status("advancing", "below bar", { value: 0.11, baseline: 0.0871, target: 0.17 })], 120) ?? ""
check(absStrip.includes("target ≥ 0.17") && !absStrip.includes("0.17×"), `absolute target renders as ≥ value, got: ${absStrip}`)
check(goalProgressStripLine([], 120) === undefined, "no strip before any goal_status")

// --- reducer: goal_met flips the goal to done ---
const goal = { objective: "grind a 2x candidate", status: "active", acceptanceCriteria: [] as string[] }
const active = reduceGoalSessionSnapshot({ events, goal, metaThreadId: undefined, monitorThreadSpendUsd: 0 })
check(active?.status === "active", `still active before goal_met, got ${active?.status}`)

const withMet = reduceGoalSessionSnapshot({
  events: [...events, status("goal_met", "cand_b 0.22 = 2.53x, clears 2x target", { ratio: 2.53, target: 2 })],
  goal,
  metaThreadId: undefined,
  monitorThreadSpendUsd: 0,
})
check(withMet?.status === "done", `goal_met flips status to done, got ${withMet?.status}`)

if (failures.length > 0) {
  console.error(`GOAL PROGRESS FAILURES (${failures.length}/${checks}):\n` + failures.map((f) => `  - ${f}`).join("\n"))
  process.exit(1)
}
console.log(`stack_goal_progress_ok (${checks} checks)`)
