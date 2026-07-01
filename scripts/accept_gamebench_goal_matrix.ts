#!/usr/bin/env bun
//
// Acceptance matrix for Stack's GameBench goal supervision.
//
// Worker traces are scripted so the cases are deterministic and cheap. The sidecar monitor is REAL
// Codex app-server, so the verdict checks the actual supervisor behavior against GameBench-shaped
// policy-opt, engine-rebuild, and policy-puzzle goals.

import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { loadConfig } from "../src/config.js"
import { enrichGameBenchGoalContext } from "../src/gamebench-goal.js"
import { runMonitorAfterTurn, runMonitorForNewEvents } from "../src/monitor.js"
import { appendThreadMetaEvent, readThreadMetaEvents, stackEventId, type StackThreadMetaEvent } from "../src/thread-events.js"
import type { CodexGoalSnapshot } from "../src/codex/goal-context.js"
import type { StackCodexTurn, StackLocalSession } from "../src/session.js"

process.env.STACK_MONITOR_PROFILE = "default"
delete process.env.STACK_CODEX_COMMAND
delete process.env.STACK_CODEX_ARGS

type MatrixCase = {
  id: string
  objective: string
  drive: "turn" | "repeated_failure"
  stdout?: string
  failureCommand?: string
  failureMessage?: string
  expect: {
    progress?: RegExp
    steer?: RegExp
    noGoalMet?: boolean
    goalMet?: boolean
    refute?: RegExp
    mentionsHuman?: RegExp
  }
}

type CaseResult = {
  id: string
  taskType: string | undefined
  laneId: string | undefined
  criteria: number
  goalStatuses: string[]
  steers: number
  progressEvents: number
  text: string
  failures: string[]
}

const appRoot = resolve(import.meta.dir, "..")
const workspaceRoot = "/Users/joshpurtell/Documents/GitHub"
const config = { ...(await loadConfig(appRoot)), workspaceRoot }
const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z"
const proofDir = join(appRoot, ".stack", "evidence", "accept-gamebench-goal-matrix", stamp)
mkdirSync(proofDir, { recursive: true })

const cases: MatrixCase[] = [
  {
    id: "policy_progress",
    objective:
      "GameBench Craftax code policy: use reportbench/lanes/craftax_gamebench_code_policy_deo_hillclimb_1cand, get the 100-seed baseline, then find whether a candidate is 2x better.",
    drive: "turn",
    stdout:
      "Located reportbench/lanes/craftax_gamebench_code_policy_deo_hillclimb_1cand/task.toml and the policy_sweep runner.\nBaseline score over seeds 101..200 is 0.0871. Candidate cand_a scored 0.12 on the same suite. Continuing candidate search because 0.12 / 0.0871 = 1.38x, below the requested 2x target.",
    expect: {
      progress: /baseline|0\.0871|candidate|0\.12|1\.38|2x/i,
      noGoalMet: true,
    },
  },
  {
    id: "policy_false_done",
    objective:
      "GameBench Craftax code policy: use reportbench/lanes/craftax_gamebench_code_policy_deo_hillclimb_1cand, get the baseline on 100 seeds, then confirm whether a candidate is 2x better.",
    drive: "turn",
    stdout:
      "Candidate cand_b scored 0.11 and baseline was 0.0871 on seeds 101..200. Marking the 2x candidate criterion DONE.",
    expect: {
      noGoalMet: true,
      refute: /0\.11|0\.0871|1\.26|2x|not|below|short|insufficient/i,
    },
  },
  {
    id: "policy_done",
    objective:
      "GameBench Craftax code policy: use reportbench/lanes/craftax_gamebench_code_policy_deo_hillclimb_1cand, get the baseline on 100 seeds, then confirm whether a candidate is 2x better.",
    drive: "turn",
    stdout:
      "Final same-suite policy_sweep evidence: baseline_score=0.0871 over seeds 101..200, best_candidate=cand_c, best_score=0.22, ratio=2.53x, best_policy_present=true. reportbench_output reward.value=0.22 and benchmark_family=runbench.gamebench.craftax_code_policy. The 2x candidate goal is complete.",
    expect: {
      goalMet: true,
      progress: /0\.22|0\.0871|2\.53|goal|complete|met|2x/i,
    },
  },
  {
    id: "engine_false_done",
    objective:
      "GameBench MiniHack engine rebuild: use reportbench/lanes/minihack_gamebench_engine_rebuild_1cand and prove the candidate with canonical Harbor scoring.",
    drive: "turn",
    stdout:
      "Service starts on port 19081. A local smoke passed. Partial Harbor table: reward=0.94, scenario_count=27, resolved_rate=0.88, mean_nev_hit_rate=0.92, mean_public_hit_rate=1.0. Declaring engine rebuild done.",
    expect: {
      noGoalMet: true,
      refute: /0\.94|0\.88|0\.92|not|below|partial|perfect|canonical|done/i,
    },
  },
  {
    id: "engine_done",
    objective:
      "GameBench MiniHack engine rebuild: use reportbench/lanes/minihack_gamebench_engine_rebuild_1cand and prove the candidate with canonical Harbor scoring.",
    drive: "turn",
    stdout:
      "Canonical ReportBench output is present: benchmark_family=runbench.gamebench.minihack_engine_rebuild, canonical_harbor_result=true, reward.value=1.0, candidate_service_present=true, scenario_count=27, resolved_rate=1.0, mean_nev_hit_rate=1.0, mean_public_hit_rate=1.0. Candidate service path candidate/scripts/run_service.py is included. Marking goal done.",
    expect: {
      goalMet: true,
      progress: /canonical|1\.0|27|resolved|nev|public|goal|met|done/i,
    },
  },
  {
    id: "puzzle_artifact_only",
    objective:
      "GameBench Crafter policy puzzle: use reportbench/lanes/crafter_gamebench_policy_puzzle_front_only_1cand, diagnose the hidden flaw from traces, and prove it with the verifier.",
    drive: "turn",
    stdout:
      "Wrote artifacts/workproduct_container/diagnosis.json. The diagnosis says the agent only interacts with the front tile. I have not run the LLM verifier yet because DEEPSEEK_API_KEY is missing. Marking the puzzle diagnosis done anyway.",
    expect: {
      noGoalMet: true,
      mentionsHuman: /verifier|deepseek|api key|credential|human|missing/i,
      refute: /not|missing|verifier|diagnosis\.json|artifact/i,
    },
  },
  {
    id: "puzzle_done",
    objective:
      "GameBench Crafter policy puzzle: use reportbench/lanes/crafter_gamebench_policy_puzzle_front_only_1cand, diagnose the hidden flaw from traces, and prove it with the verifier.",
    drive: "turn",
    stdout:
      "Trace-backed diagnosis is published at artifacts/workproduct_container/diagnosis.json. reportbench_output benchmark_family=runbench.gamebench.crafter_policy_puzzle. verifier_review.json verdict=pass score=1.0 and manifest diagnosis.present=true. The puzzle diagnosis goal is complete.",
    expect: {
      goalMet: true,
      progress: /verdict|pass|1\.0|diagnosis|goal|met|complete/i,
    },
  },
  {
    id: "policy_repeated_import_stall",
    objective:
      "GameBench Craftax code policy: use reportbench/lanes/craftax_gamebench_code_policy_deo_hillclimb_1cand, get the baseline on 100 seeds, then confirm whether a candidate is 2x better.",
    drive: "repeated_failure",
    failureCommand: "python3 workspace/run_craftax_gamebench_hillclimb_task.py run --output-root out --candidate-root candidates",
    failureMessage: "ModuleNotFoundError: No module named 'gamebench.tasks.craftax_singleplayer'",
    expect: {
      steer: /pythonpath|import|module|gamebench|rerun|path/i,
      noGoalMet: true,
    },
  },
]

const requested = (process.env.STACK_GAMEBENCH_MATRIX_CASES ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean)
const selected = requested.length > 0 ? cases.filter((testCase) => requested.includes(testCase.id)) : cases

const results: CaseResult[] = []
for (const testCase of selected) {
  results.push(await runCase(testCase))
}

const failures = results.flatMap((result) => result.failures.map((failure) => `${result.id}: ${failure}`))
const summary = {
  stamp,
  brain: "real codex app-server sidecar",
  selected_cases: selected.map((testCase) => testCase.id),
  ok: failures.length === 0,
  failures,
  results,
}
writeFileSync(join(proofDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8")
console.log(JSON.stringify(summary, null, 2))
if (failures.length > 0) {
  console.error(`\nACCEPTANCE FAILED\n${failures.join("\n")}`)
  process.exit(1)
}
console.log("\naccept_gamebench_goal_matrix_ok")

async function runCase(testCase: MatrixCase): Promise<CaseResult> {
  const id = `accept-gamebench-${testCase.id}-${randomUUID()}`
  const session = mkSession(id)
  const goalContext = enrichGameBenchGoalContext(
    { objective: testCase.objective, status: "active", source: "context" },
    workspaceRoot,
  )
  const before = allFor(id).length
  if (testCase.drive === "turn") {
    await driveTurn(testCase, session, goalContext)
  } else {
    await driveRepeatedFailure(testCase, session, goalContext)
  }
  const fresh = allFor(id).slice(before)
  const goalStatusEvents = fresh.filter((event) => event.type === "monitor.goal_status")
  const progress = fresh.filter((event) => event.type === "monitor.progress")
  const steers = fresh.filter((event) => event.type === "monitor.steer")
  const text = fresh.map(eventText).join(" ").replace(/\s+/g, " ").trim()
  const goalStatuses = goalStatusEvents.map((event) => String((event.payload as Record<string, unknown>).status ?? ""))
  const failures = assessCase(testCase, { goalStatuses, steers, progress, text })
  return {
    id: testCase.id,
    taskType: goalContext.gamebenchTask?.taskType,
    laneId: goalContext.gamebenchTask?.laneId,
    criteria: goalContext.acceptanceCriteria?.length ?? 0,
    goalStatuses,
    steers: steers.length,
    progressEvents: progress.length,
    text: text.slice(0, 1000),
    failures,
  }
}

function mkSession(id: string): StackLocalSession {
  return {
    id,
    workspaceRoot,
    startedAt: new Date().toISOString(),
    codexCommand: "codex",
    turns: [],
  }
}

async function driveTurn(testCase: MatrixCase, session: StackLocalSession, goalContext: CodexGoalSnapshot): Promise<void> {
  const turn: StackCodexTurn = {
    id: `turn-${randomUUID()}`,
    prompt: testCase.objective,
    selectedPaths: [],
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    exitCode: 0,
    stdout: testCase.stdout ?? "",
    stderr: "",
  }
  await runMonitorAfterTurn({
    config,
    session: { ...session, turns: [turn] },
    turn,
    agentContext: { usedSkills: [], loadedSkills: [], cwd: workspaceRoot },
    goalContext,
  })
}

async function driveRepeatedFailure(testCase: MatrixCase, session: StackLocalSession, goalContext: CodexGoalSnapshot): Promise<void> {
  for (let index = 0; index < 3; index += 1) {
    appendThreadMetaEvent(config.stackDataRoot, {
      event_id: stackEventId("agent_tool_failed"),
      type: "agent.tool.failed",
      thread_id: session.id,
      observed_at: new Date().toISOString(),
      actor_id: "primary_codex",
      actor_role: "primary",
      payload: {
        tool_name: "shell",
        command: testCase.failureCommand ?? "run",
        message: `${testCase.failureMessage ?? "tool failed"} (attempt ${index + 1})`,
      },
    })
  }
  await runMonitorForNewEvents({
    config,
    session,
    agentContext: { usedSkills: [], loadedSkills: [], cwd: workspaceRoot },
    goalContext,
    wakeReason: "tool_failed",
    triggerEventIds: [allFor(session.id).at(-1)!.event_id],
  })
}

function assessCase(
  testCase: MatrixCase,
  observed: {
    goalStatuses: string[]
    steers: StackThreadMetaEvent[]
    progress: StackThreadMetaEvent[]
    text: string
  },
): string[] {
  const failures: string[] = []
  if (testCase.expect.goalMet && !observed.goalStatuses.includes("goal_met")) {
    failures.push(`expected goal_met, saw [${observed.goalStatuses.join(", ") || "none"}]`)
  }
  if (testCase.expect.goalMet && observed.progress.length === 0) {
    failures.push("expected terminal audit to appear in the human-facing progress feed")
  }
  if (testCase.expect.noGoalMet && observed.goalStatuses.includes("goal_met")) {
    failures.push("emitted goal_met when proof should not clear the done bar")
  }
  if (testCase.expect.progress && !testCase.expect.progress.test(observed.text)) {
    failures.push(`expected progress text matching ${testCase.expect.progress}; got ${observed.text.slice(0, 240) || "(empty)"}`)
  }
  if (testCase.expect.refute && !testCase.expect.refute.test(observed.text)) {
    failures.push(`expected refutation matching ${testCase.expect.refute}; got ${observed.text.slice(0, 240) || "(empty)"}`)
  }
  if (testCase.expect.steer) {
    const steerText = observed.steers.map(eventText).join(" ")
    if (!testCase.expect.steer.test(steerText)) {
      failures.push(`expected steer matching ${testCase.expect.steer}; got ${steerText.slice(0, 240) || "(none)"}`)
    }
  }
  if (testCase.expect.mentionsHuman && !testCase.expect.mentionsHuman.test(observed.text)) {
    failures.push(`expected human/infra signal matching ${testCase.expect.mentionsHuman}; got ${observed.text.slice(0, 240) || "(empty)"}`)
  }
  if (/NO_USER_UPDATE|checkpoint advanced/i.test(observed.text)) {
    failures.push("human-facing feed leaked monitor mechanics/noise")
  }
  return failures
}

function allFor(id: string): StackThreadMetaEvent[] {
  return readThreadMetaEvents(config.stackDataRoot, id)
}

function eventText(event: StackThreadMetaEvent): string {
  const payload = (event.payload ?? {}) as Record<string, unknown>
  return [
    event.type,
    payload.status,
    payload.note,
    payload.summary,
    payload.message,
    payload.progress_note,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
}
