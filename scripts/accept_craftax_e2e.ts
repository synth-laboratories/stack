#!/usr/bin/env bun
//
// End-to-end craftax confirmation: the real monitor brain over the real craftax objective's
// trajectory. Worker events are SCRIPTED through the actual phases (locate -> baseline -> candidate
// -> goal complete); the MONITOR runs for real at each phase. Confirms the full loop:
//   structured monitor.goal_status progression -> goal_met -> goal flips to done -> renders.

import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { loadConfig } from "../src/config.js"
import { runMonitorAfterTurn } from "../src/monitor.js"
import { readThreadMetaEvents } from "../src/thread-events.js"
import { reduceGoalSessionSnapshot } from "../src/goal-session.js"
import { goalMilestonesFromEvents, goalProgressStripLine } from "../src/tui/monitor-thread.js"
import type { StackCodexTurn, StackLocalSession } from "../src/session.js"

process.env.STACK_MONITOR_PROFILE = "default"
const appRoot = resolve(import.meta.dir, "..")
delete process.env.STACK_CODEX_COMMAND
delete process.env.STACK_CODEX_ARGS

const config = await loadConfig(appRoot)
const threadId = `accept-craftax-e2e-${randomUUID()}`
const objective =
  "find the gamebench craftax code policy setting, get the baseline code policy score on 100 seeds, then grind another candidate until we get one that is 2x better"
const goalContext = { objective, status: "active" as const, source: "context" as const }
const session: StackLocalSession = {
  id: threadId,
  workspaceRoot: config.workspaceRoot,
  startedAt: new Date().toISOString(),
  codexCommand: "codex",
  turns: [],
}

async function phase(label: string, prompt: string, stdout: string): Promise<void> {
  const turn: StackCodexTurn = {
    id: `turn-${randomUUID()}`,
    prompt,
    selectedPaths: [],
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    exitCode: 0,
    stdout,
    stderr: "",
  }
  await runMonitorAfterTurn({
    config,
    session: { ...session, turns: [turn] },
    turn,
    agentContext: { usedSkills: [], loadedSkills: [], cwd: config.workspaceRoot },
    goalContext,
  })
  console.log(`  · ran monitor after phase: ${label}`)
}

console.log(`craftax e2e — objective: ${objective}\n`)

await phase(
  "locate",
  "Find the GameBench Craftax code-policy setting.",
  "Located the Craftax code-policy lane in gamebench/NOTES.md; the tasks live in gamebench/tasks/craftax-singleplayer. The heuristic_max_achievements policy summary shows 0.1355 / 14 achievements. No blocker.",
)
await phase(
  "baseline",
  "Run the baseline on 100 seeds.",
  "Baseline pinned: heuristic_baseline.py scores mean reward 0.0871 on the stored 100-seed sweep (reports/policy_sweep/baseline_v100.json). Target for a 2x candidate is >= 0.1742. Moving to candidate selection.",
)
await phase(
  "candidate",
  "Grind a candidate that beats the baseline by 2x.",
  "Candidate heuristic_max_achievements.py scored mean reward 0.22 over 100 seeds (reports/policy_sweep/candidate_v100.json). Baseline 0.0871, so 0.22/0.0871 = 2.53x, which clears the 2x target. Goal complete.",
)

// --- confirm the structured signal + flip + render ---
const events = readThreadMetaEvents(config.stackDataRoot, threadId)
const milestones = goalMilestonesFromEvents(events)
const met = milestones.find((m) => m.status === "goal_met")
const session2 = reduceGoalSessionSnapshot({ events, goal: { objective, status: "active", acceptanceCriteria: [] }, metaThreadId: undefined, monitorThreadSpendUsd: 0 })

const failures: string[] = []
if (milestones.length === 0) failures.push("no monitor.goal_status events written across the run")
if (!met) failures.push("monitor never emitted goal_met on the clearing candidate")
if (session2?.status !== "done") failures.push(`goal did not flip to done, got ${session2?.status}`)

console.log("\n=== Goal progress (rendered as the UI would show) ===")
console.log("strip:", goalProgressStripLine(events, 120) ?? "(none)")
console.log("timeline:")
for (const m of milestones) {
  const icon = m.status === "goal_met" ? "✓" : m.status === "advancing" ? "◆" : m.status === "blocked" || m.status === "stalled" ? "▲" : "·"
  const metric = m.metric ? ` [${JSON.stringify(m.metric)}]` : ""
  console.log(`  ${icon} ${m.status} · ${m.note}${metric}`)
}
console.log(`\ngoal session status: ${session2?.status}`)
console.log(JSON.stringify({ milestones: milestones.length, goal_met: Boolean(met), status: session2?.status, failures, ok: failures.length === 0 }, null, 2))

if (failures.length > 0) {
  console.error("\nCRAFTAX E2E FAILED:\n" + failures.join("\n"))
  process.exit(1)
}
console.log("\naccept_craftax_e2e_ok")
