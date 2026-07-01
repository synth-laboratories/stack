import { existsSync, readFileSync, readdirSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import type { CodexGoalSnapshot, CodexGoalTaskContext } from "./codex/goal-context.js"

type GameBenchTaskType = CodexGoalTaskContext["taskType"]

type ParsedGate = NonNullable<CodexGoalTaskContext["gates"]>[number]

type ParsedTaskToml = {
  laneId?: string
  lanePath?: string
  title?: string
  family?: string
  method?: string
  benchmarkFamily?: string
  objective?: string
  primaryScorePath?: string
  passThreshold?: number
  gates: ParsedGate[]
}

const GAMEBENCH_FAMILIES = [
  "craftax",
  "crafter",
  "minihack",
  "sokoban",
  "tictactoe",
  "frogs",
  "rogue",
  "dungeongrid",
  "overcooked_v2",
  "overcooked-v2",
]

export function enrichGameBenchGoalContext(goal: CodexGoalSnapshot, workspaceRoot: string): CodexGoalSnapshot {
  const objective = goal.objective?.trim()
  if (!objective) return goal
  const task = detectGameBenchTask(objective, workspaceRoot)
  if (!task) return goal
  const acceptanceCriteria = mergeAcceptanceCriteria(
    goal.acceptanceCriteria ?? [],
    acceptanceCriteriaFromGameBenchTask(task),
  )
  return {
    ...goal,
    acceptanceCriteria,
    gamebenchTask: task,
  }
}

export function detectGameBenchTask(objective: string, workspaceRoot: string): CodexGoalTaskContext | undefined {
  const lanePath = resolveLaneTaskToml(objective, workspaceRoot)
  if (lanePath) {
    const parsed = parseTaskToml(lanePath)
    const taskType = taskTypeFromMethod(parsed.method, parsed.laneId, objective)
    return {
      kind: "gamebench",
      taskType,
      source: "task_toml",
      laneId: parsed.laneId,
      lanePath: parsed.lanePath,
      title: parsed.title,
      family: parsed.family,
      method: parsed.method,
      benchmarkFamily: parsed.benchmarkFamily,
      primaryScorePath: parsed.primaryScorePath,
      passThreshold: parsed.passThreshold,
      doneBar: doneBarFor(taskType, parsed),
      milestoneChain: milestoneChainFor(taskType),
      honestyPitfalls: honestyPitfallsFor(taskType),
      gates: parsed.gates,
    }
  }

  const taskType = taskTypeFromObjective(objective)
  if (!taskType) return undefined
  return {
    kind: "gamebench",
    taskType,
    source: "objective",
    family: familyFromObjective(objective),
    method: methodForTaskType(taskType),
    doneBar: doneBarFor(taskType),
    milestoneChain: milestoneChainFor(taskType),
    honestyPitfalls: honestyPitfallsFor(taskType),
    gates: [],
  }
}

export function acceptanceCriteriaFromGameBenchTask(task: CodexGoalTaskContext): string[] {
  const criteria: string[] = []
  if (task.doneBar) criteria.push(`[ ] GameBench ${task.taskType} done bar: ${task.doneBar}`)
  for (const gate of task.gates ?? []) {
    criteria.push(`[ ] ReportBench gate ${gate.id}: ${formatGateCondition(gate)}`)
  }
  return criteria
}

function mergeAcceptanceCriteria(existing: string[], additions: string[]): string[] {
  if (additions.length === 0) return existing
  const seen = new Set(existing.map(normalizeCriterion))
  const out = [...existing]
  for (const criterion of additions) {
    const key = normalizeCriterion(criterion)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(criterion)
  }
  return out
}

function normalizeCriterion(value: string): string {
  return value.replace(/^\s*\[[ xX]\]\s*/, "").trim().toLowerCase()
}

function resolveLaneTaskToml(objective: string, workspaceRoot: string): string | undefined {
  const direct = directLaneTaskTomlFromObjective(objective, workspaceRoot)
  if (direct) return direct
  const lanesRoot = firstExistingLaneRoot(workspaceRoot)
  if (!lanesRoot) return undefined
  const laneNames = safeReadDir(lanesRoot).filter((name) => existsSync(join(lanesRoot, name, "task.toml")))
  const normalized = objective.toLowerCase()
  const explicit = laneNames.find((name) => normalized.includes(name.toLowerCase()))
  if (explicit) return join(lanesRoot, explicit, "task.toml")

  const inferredFamily = familyFromObjective(objective)
  const inferredType = taskTypeFromObjective(objective)
  if (!inferredFamily || !inferredType) return undefined
  const familyPrefix = inferredFamily.replace(/-/g, "_")
  const preferred = preferredLaneNames(familyPrefix, inferredType, objective)
  for (const name of preferred) {
    const candidate = join(lanesRoot, name, "task.toml")
    if (existsSync(candidate)) return candidate
  }
  const familyMatch = laneNames.find((name) => {
    const lower = name.toLowerCase()
    return lower.startsWith(`${familyPrefix}_`) && laneNameMatchesTaskType(lower, inferredType)
  })
  return familyMatch ? join(lanesRoot, familyMatch, "task.toml") : undefined
}

function directLaneTaskTomlFromObjective(objective: string, workspaceRoot: string): string | undefined {
  const match = objective.match(/(?:^|\s)(\/[^\s]*reportbench\/lanes\/[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]*reportbench\/lanes\/[A-Za-z0-9_.-]+)/)
  if (!match?.[1]) return undefined
  const raw = match[1]
  const base = raw.startsWith("/") ? raw : resolve(workspaceRoot, raw)
  const candidate = base.endsWith("task.toml") ? base : join(base, "task.toml")
  return existsSync(candidate) ? candidate : undefined
}

function firstExistingLaneRoot(workspaceRoot: string): string | undefined {
  const candidates = [
    join(workspaceRoot, "evals", "reportbench", "lanes"),
    join(dirname(workspaceRoot), "evals", "reportbench", "lanes"),
    resolve(workspaceRoot, "..", "evals", "reportbench", "lanes"),
  ]
  return candidates.find((path) => existsSync(path))
}

function safeReadDir(path: string): string[] {
  try {
    return readdirSync(path)
  } catch {
    return []
  }
}

function preferredLaneNames(familyPrefix: string, taskType: GameBenchTaskType, objective: string): string[] {
  if (taskType === "policy_opt") {
    return [
      `${familyPrefix}_gamebench_code_policy_deo_hillclimb_1cand`,
      `${familyPrefix}_code_policy_deo_hillclimb_1cand`,
      `${familyPrefix}_gamebench_code_policy_deo_hillclimb_3cand`,
      `${familyPrefix}_code_policy_deo_hillclimb_3cand`,
    ]
  }
  if (taskType === "engine_rebuild") return [`${familyPrefix}_gamebench_engine_rebuild_1cand`]
  if (taskType === "puzzle_diagnosis") {
    const puzzle = puzzleSlugFromObjective(objective)
    return puzzle
      ? [`${familyPrefix}_gamebench_policy_puzzle_${puzzle}_1cand`]
      : [`${familyPrefix}_gamebench_policy_puzzle_front_only_1cand`]
  }
  return []
}

function laneNameMatchesTaskType(laneName: string, taskType: GameBenchTaskType): boolean {
  if (taskType === "policy_opt") return laneName.includes("code_policy") && laneName.includes("hillclimb")
  if (taskType === "engine_rebuild") return laneName.includes("engine_rebuild")
  if (taskType === "puzzle_diagnosis") return laneName.includes("policy_puzzle")
  return false
}

function parseTaskToml(path: string): ParsedTaskToml {
  const text = readFileSync(path, "utf8")
  const parsed: ParsedTaskToml = {
    laneId: basename(dirname(path)),
    lanePath: dirname(path),
    gates: [],
  }
  let section = ""
  let currentGate: ParsedGate | undefined
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim()
    if (!line) continue
    const gateSection = /^\[\[verdict\.gates]]$/.exec(line)
    if (gateSection) {
      currentGate = { id: "" }
      parsed.gates.push(currentGate)
      section = "verdict.gates"
      continue
    }
    const sectionMatch = /^\[([A-Za-z0-9_.-]+)]$/.exec(line)
    if (sectionMatch?.[1]) {
      section = sectionMatch[1]
      currentGate = undefined
      continue
    }
    const match = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line)
    if (!match?.[1] || match[2] === undefined) continue
    const key = match[1]
    const value = parseTomlValue(match[2].trim())
    if (section === "task") {
      if (key === "title" && typeof value === "string") parsed.title = value
      if (key === "family" && typeof value === "string") parsed.family = value
      if (key === "method" && typeof value === "string") parsed.method = value
    } else if (section === "metadata") {
      if (key === "benchmark_family" && typeof value === "string") parsed.benchmarkFamily = value
      if (key === "objective" && typeof value === "string") parsed.objective = value
    } else if (section === "verdict") {
      if (key === "primary_score_path" && typeof value === "string") parsed.primaryScorePath = value
      if (key === "pass_threshold" && typeof value === "number") parsed.passThreshold = value
    } else if (section === "verdict.gates" && currentGate) {
      assignGateValue(currentGate, key, value)
    }
  }
  parsed.gates = parsed.gates.filter((gate) => gate.id.trim())
  return parsed
}

function assignGateValue(gate: ParsedGate, key: string, value: unknown): void {
  if (key === "id" && typeof value === "string") gate.id = value
  if (key === "path" && typeof value === "string") gate.path = value
  if (key === "equals" && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")) gate.equals = value
  if (key === "min_value" && typeof value === "number") gate.minValue = value
  if (key === "max_value" && typeof value === "number") gate.maxValue = value
  if (key === "required" && typeof value === "boolean") gate.required = value
  if (key === "reason" && typeof value === "string") gate.reason = value
}

function taskTypeFromMethod(method: string | undefined, laneId: string | undefined, objective: string): GameBenchTaskType {
  const text = `${method ?? ""} ${laneId ?? ""} ${objective}`.toLowerCase()
  if (text.includes("engine_rebuild")) return "engine_rebuild"
  if (text.includes("policy_puzzle") || text.includes("puzzle_diagnosis")) return "puzzle_diagnosis"
  if (text.includes("code_policy") || text.includes("hillclimb")) return "policy_opt"
  return taskTypeFromObjective(objective) ?? "unknown"
}

function taskTypeFromObjective(objective: string): GameBenchTaskType | undefined {
  const text = objective.toLowerCase()
  if (!text.includes("gamebench") && !GAMEBENCH_FAMILIES.some((family) => text.includes(family))) return undefined
  if (text.includes("engine") || text.includes("harbor") || text.includes("nev") || text.includes("rebuild")) return "engine_rebuild"
  if (text.includes("puzzle") || text.includes("diagnos") || text.includes("hidden policy flaw") || text.includes("verifier")) return "puzzle_diagnosis"
  if (text.includes("code policy") || text.includes("policy score") || text.includes("policy setting") || text.includes("hillclimb") || text.includes("candidate") || text.includes("baseline")) return "policy_opt"
  return undefined
}

function methodForTaskType(taskType: GameBenchTaskType): string | undefined {
  if (taskType === "policy_opt") return "code_policy_deo_hillclimb"
  if (taskType === "engine_rebuild") return "engine_rebuild"
  if (taskType === "puzzle_diagnosis") return "policy_puzzle_diagnosis"
  return undefined
}

function familyFromObjective(objective: string): string | undefined {
  const text = objective.toLowerCase()
  return GAMEBENCH_FAMILIES.find((family) => text.includes(family))?.replace(/-/g, "_")
}

function puzzleSlugFromObjective(objective: string): string | undefined {
  const text = objective.toLowerCase().replace(/-/g, "_")
  const match = text.match(/puzzle[_ ]([a-z0-9_]+)/)
  if (match?.[1]) return match[1].replace(/_1cand$/, "")
  if (text.includes("front only") || text.includes("front_only")) return "front_only"
  if (text.includes("premature pickaxe") || text.includes("premature_pickaxe")) return "premature_pickaxe"
  if (text.includes("stone blind") || text.includes("stone_blind")) return "stone_blind"
  if (text.includes("explore never") || text.includes("explore_never")) return "explore_never"
  if (text.includes("mob suicide") || text.includes("mob_suicide")) return "mob_suicide"
  return undefined
}

function doneBarFor(taskType: GameBenchTaskType, parsed?: ParsedTaskToml): string {
  const threshold = parsed?.passThreshold !== undefined ? `; primary threshold ${parsed.passThreshold}` : ""
  const gates = parsed?.gates.length ? `; required gates: ${parsed.gates.map((gate) => gate.id).join(", ")}` : ""
  if (taskType === "policy_opt") {
    return `accepted leaderboard/evidence with positive score, present best policy, and any requested baseline/candidate ratio audited from artifacts${threshold}${gates}`
  }
  if (taskType === "engine_rebuild") {
    return `canonical Harbor/ReportBench score clears the strict bar, with all required scenario, resolved-rate, NEV, and public-state gates passing${threshold}${gates}`
  }
  if (taskType === "puzzle_diagnosis") {
    return `diagnosis artifact exists and the judge/verifier verdict passes; artifact existence alone is not completion${threshold}${gates}`
  }
  return `ReportBench verdict gates pass${threshold}${gates}`
}

function milestoneChainFor(taskType: GameBenchTaskType): string[] {
  if (taskType === "policy_opt") {
    return [
      "Locate the GameBench lane, runner, policy files, and report paths",
      "Establish or read the baseline score on the requested seed suite",
      "Author or inspect candidate policies and evaluate them on the same suite",
      "Publish concrete leaderboard/evidence: baseline, best score, ratio, artifacts",
    ]
  }
  if (taskType === "engine_rebuild") {
    return [
      "Read the Harbor/GameBench specs and scenario contract",
      "Implement candidate engine/service and local smoke path",
      "Run canonical Harbor/ReportBench scoring across the full scenario set",
      "Audit perfect-score gates: canonical result, all scenarios, resolved rate, NEV, public state",
    ]
  }
  if (taskType === "puzzle_diagnosis") {
    return [
      "Read puzzle instructions and black-box traces only",
      "Build a trace-backed causal hypothesis for the hidden policy flaw",
      "Publish diagnosis.json and reproduction/evidence artifacts",
      "Audit the LLM/verifier verdict; diagnosis artifact alone is not enough",
    ]
  }
  return ["Identify task contract", "Collect evidence", "Audit ReportBench verdict gates"]
}

function honestyPitfallsFor(taskType: GameBenchTaskType): string[] {
  if (taskType === "policy_opt") {
    return [
      "Do not claim a 2x improvement unless best_score / baseline_score >= 2 on the same seed suite.",
      "Do not treat stale .stack/evidence or old reports as current-run proof unless the objective explicitly asks for existing artifacts.",
      "A positive score may satisfy a low ReportBench pass threshold, but a user-requested 2x candidate requires separate ratio proof.",
    ]
  }
  if (taskType === "engine_rebuild") {
    return [
      "Do not mark done from service startup, a local smoke, or a partial scenario table.",
      "Canonical Harbor/ReportBench output is required; fabricated or noncanonical scorer output must be refuted.",
      "Strict lanes usually require perfect reward/resolved/NEV/public-state gates, not just progress.",
    ]
  }
  if (taskType === "puzzle_diagnosis") {
    return [
      "Do not mark done from diagnosis.json alone; verifier pass is the done bar.",
      "The diagnosis must cite trace evidence, not hidden source or a guessed flaw.",
      "Missing verifier credentials or traces is a human/infra blocker to report, not a reason to invent a verdict.",
    ]
  }
  return ["Audit claims against the task verdict gates, not worker confidence."]
}

function formatGateCondition(gate: ParsedGate): string {
  const path = gate.path ?? "(path unspecified)"
  const parts: string[] = []
  if (gate.equals !== undefined) parts.push(`${path} == ${JSON.stringify(gate.equals)}`)
  if (gate.minValue !== undefined) parts.push(`${path} >= ${gate.minValue}`)
  if (gate.maxValue !== undefined) parts.push(`${path} <= ${gate.maxValue}`)
  if (parts.length === 0) parts.push(path)
  if (gate.reason) parts.push(`reason ${gate.reason}`)
  return parts.join(" · ")
}

function parseTomlValue(raw: string): unknown {
  const trimmed = raw.trim()
  if (trimmed === "true") return true
  if (trimmed === "false") return false
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(",").map((part) => trimQuotes(part.trim()))
  }
  return trimQuotes(trimmed)
}

function stripTomlComment(line: string): string {
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') quoted = !quoted
    if (char === "#" && !quoted) return line.slice(0, index)
  }
  return line
}

function trimQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}
