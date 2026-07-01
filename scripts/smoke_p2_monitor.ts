#!/usr/bin/env bun
//
// Deterministic (no codex) tests for the P2 deeper items:
//   - per-criterion state machine (goal-criteria-state)
//   - risky-pending detector (risky-action)
//   - headless monitor pass loop (monitor-daemon)

import { deriveCriteriaStates, summarizeCriteriaStates } from "../src/goal-criteria-state.js"
import { detectRiskyPending, riskyPendingSummary } from "../src/risky-action.js"
import { runHeadlessMonitorLoop } from "../src/monitor-daemon.js"
import type { StackThreadMetaEvent } from "../src/thread-events.js"

const failures: string[] = []
let checks = 0
const check = (cond: boolean, msg: string) => {
  checks += 1
  if (!cond) failures.push(msg)
}

const ev = (type: string, payload: Record<string, unknown>, id = type): StackThreadMetaEvent =>
  ({ event_id: id, type, thread_id: "t", observed_at: "2026-07-01", actor_id: "a", actor_role: "primary", payload } as StackThreadMetaEvent)

// ---------- per-criterion state machine ----------
const criteria = ["[ ] score_positive: reward.value >= 0.01", "[ ] best_policy_present", "[ ] benchmark_family matches"]

// no activity → all open
let states = deriveCriteriaStates(criteria, [])
check(states.every((s) => s.state === "open"), "no events → all criteria open")

// worker claims completion → worker_marked (a claim, not proof)
const claim = ev("agent.turn.completed", { stdout_excerpt: "Leaderboard done; the goal is complete." }, "claim1")
states = deriveCriteriaStates(criteria, [claim])
check(states.every((s) => s.state === "worker_marked"), "worker completion claim → worker_marked")

// monitor audits clean → audit_clean
states = deriveCriteriaStates(criteria, [claim, ev("monitor.goal_status", { status: "goal_met", note: "all gates satisfied" }, "gm")])
check(states.every((s) => s.state === "audit_clean"), "goal_met → audit_clean")

// monitor refutes a claim → audit_failed
states = deriveCriteriaStates(criteria, [claim, ev("monitor.goal_status", { status: "goal_failed", note: "benchmark_family not cited" }, "gf")])
check(states.every((s) => s.state === "audit_failed"), "goal_failed after claim → audit_failed")
const summ = summarizeCriteriaStates(states)
check(summ.audit_failed === 3 && summ.total === 3, "summary counts audit_failed")

// ---------- risky-pending detector ----------
const risky = (cmd: string) => detectRiskyPending([ev("agent.tool.started", { command: cmd }, cmd)])
check(risky("rm -rf /Users/josh/Documents/GitHub/evals/reportbench").length === 1, "detects rm -rf")
check(risky("git reset --hard origin/main").length === 1, "detects git reset --hard")
check(risky("git push --force origin dev").length === 1, "detects force push")
check(risky("git push --force-with-lease origin dev").length === 0, "allows --force-with-lease")
check(risky("DROP TABLE users;").length === 1, "detects DROP TABLE")
check(risky("rg --files -g '*.py'").length === 0, "safe read command → not risky")
check(risky("ls -lt reports/").length === 0, "safe ls → not risky")
check((riskyPendingSummary(risky("rm -rf build")) ?? "").includes("pause"), "risky summary tells the monitor to pause")

// ---------- headless monitor pass loop ----------
// simulate: worker emits events, each pass appends a goal_status; terminal when goal_met appears.
{
  const log: StackThreadMetaEvent[] = [ev("agent.turn.completed", { stdout_excerpt: "did a thing" }, "w1")]
  let passCount = 0
  const res = await runHeadlessMonitorLoop({
    readEvents: () => [...log],
    runPass: async () => {
      passCount += 1
      // after 3 passes, the monitor marks the goal met
      log.push(ev("monitor.goal_status", { status: passCount >= 3 ? "goal_met" : "advancing" }, `gs${passCount}`))
      if (passCount < 3) log.push(ev("agent.turn.completed", { stdout_excerpt: "more work" }, `w${passCount + 1}`))
    },
    isTerminal: (events) => events.some((e) => e.type === "monitor.goal_status" && (e.payload as Record<string, unknown>).status === "goal_met"),
    pollMs: 0,
    now: () => 0,
    sleep: async () => {},
  })
  check(res.terminal && res.reason === "terminal", `loop terminates on goal_met, got ${res.reason}`)
  check(res.passes === 3, `loop ran 3 passes, got ${res.passes}`)
}

// loop respects maxPasses when never terminal
{
  const log: StackThreadMetaEvent[] = [ev("agent.turn.completed", {}, "w1")]
  const res = await runHeadlessMonitorLoop({
    readEvents: () => [...log],
    runPass: async () => { log.push(ev("agent.turn.completed", {}, `w${log.length}`)) },
    isTerminal: () => false,
    pollMs: 0,
    maxPasses: 5,
    now: () => 0,
    sleep: async () => {},
  })
  check(!res.terminal && res.reason === "max_passes" && res.passes === 5, `caps at maxPasses, got ${res.reason}/${res.passes}`)
}

if (failures.length > 0) {
  console.error(`P2 MONITOR FAILURES (${failures.length}/${checks}):\n` + failures.map((f) => `  - ${f}`).join("\n"))
  process.exit(1)
}
console.log(`stack_p2_monitor_ok (${checks} checks)`)
