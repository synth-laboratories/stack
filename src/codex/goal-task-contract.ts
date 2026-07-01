import { existsSync, readFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import type { CodexGoalSnapshot, CodexGoalTaskContext } from "./goal-context.js"

// Goal task contracts.
//
// A goal may reference a task contract — a `task.toml` the objective names by path. The
// contract declares, as data, everything task-specific the monitor needs: the done bar,
// milestone chain, honesty pitfalls, verdict gates, and phase hints for human updates.
// Stack only resolves the explicitly referenced file and renders what it declares; it
// never infers a task from objective keywords and carries no benchmark- or eval-specific
// vocabulary. Domain content belongs in the contract file, next to the task it describes.
//
// Recognized sections:
//   [task]            title, method, kind
//   [goal]            task_type, done_bar, milestone_chain, honesty_pitfalls, update_terms
//   [[goal.phases]]   id, detect_terms, update_terms, suggested_update
//   [verdict]         primary_score_path, pass_threshold
//   [[verdict.gates]] id, path, equals, min_value, max_value, required, reason

type ParsedGate = NonNullable<CodexGoalTaskContext["gates"]>[number]

type ParsedPhase = NonNullable<CodexGoalTaskContext["phases"]>[number]

export function enrichGoalTaskContext(goal: CodexGoalSnapshot, workspaceRoot: string): CodexGoalSnapshot {
  if (goal.taskContext) return goal
  const objective = goal.objective?.trim()
  if (!objective) return goal
  const contractPath = resolveTaskContractPath(objective, workspaceRoot)
  if (!contractPath) return goal
  const task = parseTaskContract(contractPath)
  if (!task) return goal
  const acceptanceCriteria = mergeAcceptanceCriteria(
    goal.acceptanceCriteria ?? [],
    acceptanceCriteriaFromTaskContext(task),
  )
  return {
    ...goal,
    acceptanceCriteria,
    taskContext: task,
  }
}

export function acceptanceCriteriaFromTaskContext(task: CodexGoalTaskContext): string[] {
  const criteria: string[] = []
  if (task.doneBar) {
    const label = task.taskType ? `${task.kind} ${task.taskType}` : task.kind
    criteria.push(`[ ] ${label} done bar: ${task.doneBar}`)
  }
  for (const gate of task.gates ?? []) {
    criteria.push(`[ ] Verdict gate ${gate.id}: ${formatGateCondition(gate)}`)
  }
  return criteria
}

// Only an EXPLICIT reference counts: a whitespace-delimited objective token that resolves
// (absolute, or relative to the workspace root) to a task.toml or a directory holding one.
export function resolveTaskContractPath(objective: string, workspaceRoot: string): string | undefined {
  for (const token of objective.split(/\s+/)) {
    const cleaned = token.replace(/^["'(\[{]+/, "").replace(/["'),\].:;!?}]+$/, "")
    if (!cleaned.includes("/")) continue
    const base = cleaned.startsWith("/") ? cleaned : resolve(workspaceRoot, cleaned)
    const candidate = base.endsWith("task.toml") ? base : join(base, "task.toml")
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

export function parseTaskContract(path: string): CodexGoalTaskContext | undefined {
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch {
    return undefined
  }
  const task: CodexGoalTaskContext = {
    kind: "task",
    source: "task_contract",
    taskId: basename(dirname(path)),
    contractPath: dirname(path),
    gates: [],
  }
  const phases: ParsedPhase[] = []
  let section = ""
  let currentGate: ParsedGate | undefined
  let currentPhase: ParsedPhase | undefined
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim()
    if (!line) continue
    if (/^\[\[verdict\.gates]]$/.test(line)) {
      currentGate = { id: "" }
      task.gates!.push(currentGate)
      section = "verdict.gates"
      continue
    }
    if (/^\[\[goal\.phases]]$/.test(line)) {
      currentPhase = { id: "", detectTerms: [], updateTerms: [] }
      phases.push(currentPhase)
      section = "goal.phases"
      continue
    }
    const sectionMatch = /^\[([A-Za-z0-9_.-]+)]$/.exec(line)
    if (sectionMatch?.[1]) {
      section = sectionMatch[1]
      currentGate = undefined
      currentPhase = undefined
      continue
    }
    const match = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line)
    if (!match?.[1] || match[2] === undefined) continue
    const key = match[1]
    const value = parseTomlValue(match[2].trim())
    if (section === "task") {
      if (key === "title" && typeof value === "string") task.title = value
      if (key === "method" && typeof value === "string") task.method = value
      if (key === "kind" && typeof value === "string") task.kind = value
    } else if (section === "goal") {
      if (key === "kind" && typeof value === "string") task.kind = value
      if (key === "task_type" && typeof value === "string") task.taskType = value
      if (key === "done_bar" && typeof value === "string") task.doneBar = value
      if (key === "milestone_chain") task.milestoneChain = stringArray(value)
      if (key === "honesty_pitfalls") task.honestyPitfalls = stringArray(value)
      if (key === "update_terms") task.updateTerms = stringArray(value)
    } else if (section === "verdict") {
      if (key === "primary_score_path" && typeof value === "string") task.primaryScorePath = value
      if (key === "pass_threshold" && typeof value === "number") task.passThreshold = value
    } else if (section === "verdict.gates" && currentGate) {
      assignGateValue(currentGate, key, value)
    } else if (section === "goal.phases" && currentPhase) {
      if (key === "id" && typeof value === "string") currentPhase.id = value
      if (key === "detect_terms") currentPhase.detectTerms = stringArray(value) ?? []
      if (key === "update_terms") currentPhase.updateTerms = stringArray(value) ?? []
      if (key === "suggested_update" && typeof value === "string") currentPhase.suggestedUpdate = value
    }
  }
  task.gates = task.gates!.filter((gate) => gate.id.trim())
  const validPhases = phases.filter((phase) => phase.id.trim() && phase.detectTerms.length > 0)
  if (validPhases.length > 0) task.phases = validPhases
  return task
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

function assignGateValue(gate: ParsedGate, key: string, value: unknown): void {
  if (key === "id" && typeof value === "string") gate.id = value
  if (key === "path" && typeof value === "string") gate.path = value
  if (key === "equals" && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")) gate.equals = value
  if (key === "min_value" && typeof value === "number") gate.minValue = value
  if (key === "max_value" && typeof value === "number") gate.maxValue = value
  if (key === "required" && typeof value === "boolean") gate.required = value
  if (key === "reason" && typeof value === "string") gate.reason = value
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

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
  return items.length > 0 ? items : undefined
}

function parseTomlValue(raw: string): unknown {
  const trimmed = raw.trim()
  if (trimmed === "true") return true
  if (trimmed === "false") return false
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim()
    if (!inner) return []
    return splitTomlArray(inner).map((part) => trimQuotes(part.trim()))
  }
  return trimQuotes(trimmed)
}

// Split a single-line TOML array on commas that are outside quotes.
function splitTomlArray(inner: string): string[] {
  const parts: string[] = []
  let current = ""
  let quote: '"' | "'" | undefined
  for (const char of inner) {
    if (quote) {
      if (char === quote) quote = undefined
      current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    if (char === ",") {
      parts.push(current)
      current = ""
      continue
    }
    current += char
  }
  if (current.trim()) parts.push(current)
  return parts
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
