#!/usr/bin/env bun
//
// Deterministic guardrail for task-milestone awareness (no codex): detectGameBenchTask +
// acceptanceCriteriaFromGameBenchTask must give the monitor the right task type, done-bar, milestone
// chain, honesty pitfalls, and (when a real lane resolves) parsed verdict gates. The matrix harness
// proves the audit behavior with a real monitor; this catches regressions in the context builder fast.

import { detectGameBenchTask, acceptanceCriteriaFromGameBenchTask } from "../src/gamebench-goal.js"

const ROOT = "/Users/joshpurtell/Documents/GitHub"
const failures: string[] = []
let checks = 0
const check = (cond: boolean, msg: string) => {
  checks += 1
  if (!cond) failures.push(msg)
}

// --- objective-inference (always available, no lane needed) ---
const policy = detectGameBenchTask("grind a candidate craftax code policy past the baseline and publish a leaderboard", ROOT)
check(policy?.taskType === "policy_opt", `policy objective → policy_opt, got ${policy?.taskType}`)
check(/2 candidates|do NOT require 2x|positive/i.test(policy?.doneBar ?? ""), "policy done-bar = low bar (no forced 2x)")

const engine = detectGameBenchTask("rebuild the tictactoe gold engine as a FastAPI service and pass the 20-scenario spectrum at 1.0", ROOT)
check(engine?.taskType === "engine_rebuild", `engine objective → engine_rebuild, got ${engine?.taskType}`)
check(/1\.0|all scenarios|canonical|exactly/i.test(engine?.doneBar ?? ""), "engine done-bar = canonical all-scenarios 1.0")
check((engine?.honestyPitfalls ?? []).some((p) => /fabricat|mock|noncanonical|single-scenario/i.test(p)), "engine honesty pitfall = fabrication")

const puzzle = detectGameBenchTask("diagnose the hidden craftax policy flaw from the black-box traces and write diagnosis.json", ROOT)
check(puzzle?.taskType === "puzzle_diagnosis", `puzzle objective → puzzle_diagnosis, got ${puzzle?.taskType}`)
check(/verifier|verdict|not done|awaiting/i.test(puzzle?.doneBar ?? ""), "puzzle done-bar = verifier verdict, not artifact")

// --- acceptance criteria are derived from the task context ---
for (const [name, t] of [["policy", policy], ["engine", engine], ["puzzle", puzzle]] as const) {
  if (!t) continue
  const criteria = acceptanceCriteriaFromGameBenchTask(t)
  check(criteria.length > 0, `${name}: acceptance criteria derived from task context`)
}

// --- when a real lane resolves from task.toml, its verdict gates are parsed ---
const fromLane = detectGameBenchTask(
  "work the reportbench lane craftax_gamebench_code_policy_deo_hillclimb_1cand and beat the baseline",
  ROOT,
)
if (fromLane?.source === "task_toml") {
  check((fromLane.gates ?? []).length > 0, "resolved lane parses verdict gates from task.toml")
} else {
  console.log(`(note: lane did not resolve from objective — source=${fromLane?.source}; objective-inference path still covered)`)
}

if (failures.length > 0) {
  console.error(`GAMEBENCH TASK-CONTEXT FAILURES (${failures.length}/${checks}):\n` + failures.map((f) => `  - ${f}`).join("\n"))
  process.exit(1)
}
console.log(`stack_gamebench_task_ok (${checks} checks)`)
