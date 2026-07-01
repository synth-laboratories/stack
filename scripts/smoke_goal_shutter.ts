#!/usr/bin/env bun
// AT-STACK-GOAL-SHUTTER-001..003, AT-STACK-GOAL-MON-003 — pure goal shutter fixtures.

import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import type { StackdMetaThreadManifest } from "../src/client/stackd.ts"
import { emptyGoalContext, mergeGoalContext } from "../src/codex/goal-context.ts"
import { mergeMetaThreadGoalContext } from "../src/meta-thread-goal.ts"
import { appendGoalLifecycleEvent, reduceGoalSessionSnapshot } from "../src/goal-session.ts"
import { emptyMonitorSnapshot } from "../src/monitor.ts"
import { stackEventId } from "../src/thread-events.ts"
import type { StackThreadMetaEvent } from "../src/thread-events.ts"
import { activeGoalModeSnapshot, isGoalMode } from "../src/tui/goal-mode.ts"
import { goalShutterStreamEvents, goalShutterStreamRows } from "../src/tui/monitor-thread.ts"

const appRoot = resolve(import.meta.dir, "..")
const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z"
const proofDir = join(appRoot, ".stack", "evidence", "goal-shutter", stamp)
const failures: string[] = []

mkdirSync(proofDir, { recursive: true })

const objective = "Rebuild TicTacToe Harbor env; pass 20-scenario spectrum (harbor_reward=1.0)"
const manifest = {
  active_goal: {
    objective,
    status: "active",
    acceptance_criteria: [
      "[x] SE-TTT-HARBOR-1-WORKSPACE green",
      "[ ] SE-TTT-HARBOR-2-SERVICE green",
      "[ ] SE-TTT-HARBOR-3-SPECTRUM harbor_reward=1.0",
    ],
    blockers: [],
  },
} as unknown as StackdMetaThreadManifest

const goalContext = mergeMetaThreadGoalContext(emptyGoalContext(), manifest)
const activeState = {
  goalContext,
  metaThreadManifest: manifest,
}

if (!isGoalMode(activeState)) failures.push("expected isGoalMode=true for active manifest goal")
const snapshot = activeGoalModeSnapshot(activeState)
if (snapshot.objective !== objective) failures.push("activeGoalModeSnapshot objective mismatch")
if (snapshot.acceptanceCriteria.length !== 3) failures.push("expected 3 acceptance criteria")

const pausedState = {
  goalContext: mergeGoalContext(goalContext, { status: "paused", source: "meta_thread" }),
  metaThreadManifest: {
    active_goal: { ...manifest.active_goal, status: "paused" },
  } as unknown as StackdMetaThreadManifest,
}
if (!isGoalMode(pausedState)) failures.push("paused goal should stay in goal mode shutter")

const clearedState = {
  goalContext: emptyGoalContext(),
  metaThreadManifest: undefined,
}
if (isGoalMode(clearedState)) failures.push("cleared goal should exit goal mode shutter")

const events: StackThreadMetaEvent[] = [
  {
    event_id: stackEventId("agent_tool_completed_noise"),
    type: "agent.tool.completed",
    thread_id: "thread-smoke",
    observed_at: new Date().toISOString(),
    actor_id: "primary_codex",
    actor_role: "primary",
    payload: { tool_name: "read", command: "read README.md" },
  },
  {
    event_id: stackEventId("agent_tool_completed_test"),
    type: "agent.tool.completed",
    thread_id: "thread-smoke",
    observed_at: new Date().toISOString(),
    actor_id: "primary_codex",
    actor_role: "primary",
    payload: { tool_name: "bash", command: "bun run smoke:goal-shutter" },
  },
  {
    event_id: stackEventId("monitor_summary"),
    type: "monitor.summary",
    thread_id: "thread-smoke",
    observed_at: new Date().toISOString(),
    actor_id: "monitor",
    actor_role: "monitor",
    payload: {
      summary: "Working on Harbor service boot",
      severity: "low",
      operator_update: {
        working_on: objective,
        progress_note: "1/3 criteria complete",
        criteria_progress: { done: 1, total: 3, pct: 33 },
      },
    },
  },
]

const curated = goalShutterStreamEvents(events, false)
if (curated.some((event) => event.event_id.includes("noise"))) {
  failures.push("curated stream should hide non-goal agent.tool.completed noise")
}
if (!curated.some((event) => event.type === "monitor.summary")) {
  failures.push("curated stream should include monitor.summary")
}
if (curated.some((event) => event.type === "agent.tool.completed")) {
  failures.push("curated stream should hide worker tool completions; agent tape owns raw worker activity")
}

const agentTape = goalShutterStreamEvents(events, true)
if (agentTape.length < events.length) failures.push("agent tape should include full monitor thread events")

const rows = goalShutterStreamRows(events, emptyMonitorSnapshot(appRoot), 96, false)
const prefillRow = rows.find((row) => row.prefill?.includes("How is progress"))
if (!prefillRow) failures.push("expected click-prefill prompt on monitor.summary row")

const lifecycleEvents = [
  appendGoalLifecycleEvent({
    stackRoot: appRoot,
    threadId: "thread-smoke",
    metaThreadId: "mt-smoke",
    type: "goal.started",
    objective,
    source: "manifest",
    status: "active",
  }),
  ...events,
]
const session = reduceGoalSessionSnapshot({
  events: lifecycleEvents,
  goal: snapshot,
  metaThreadId: "mt-smoke",
  monitorThreadSpendUsd: 0.12,
})
if (!session?.started_at) failures.push("GoalSessionSnapshot missing started_at after goal.started")
if (session?.objective !== objective) failures.push("GoalSessionSnapshot objective mismatch")
if (!session?.criteria_progress || session.criteria_progress.total !== 3) {
  failures.push("GoalSessionSnapshot criteria_progress mismatch")
}

const summary = {
  stamp,
  failures,
  ok: failures.length === 0,
  is_goal_mode: isGoalMode(activeState),
  criteria_count: snapshot.acceptanceCriteria.length,
  curated_event_count: curated.length,
  agent_tape_event_count: agentTape.length,
  prefill_sample: prefillRow?.prefill,
  goal_session_started_at: session?.started_at,
}

writeFileSync(join(proofDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n")

if (failures.length > 0) {
  console.error(failures.join("\n"))
  process.exit(1)
}

console.log("stack_goal_shutter_ok")
console.log(JSON.stringify(summary, null, 2))
