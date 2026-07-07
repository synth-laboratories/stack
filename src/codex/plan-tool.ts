import { stat } from "node:fs/promises"
import { readFile } from "node:fs/promises"
import { defaultCodexSessionsRoot, resolveCodexSessionPath } from "./agent-context.js"

/**
 * Codex's `update_plan` tool (aka "TODOs") emits a checklist the agent maintains as it works.
 * Contract (Rust `UpdatePlanArgs` / `PlanItemArg` / `StepStatus` in the codex CLI):
 *   { plan: [{ step: string, status: "pending" | "in_progress" | "completed" }], explanation?: string }
 * Codex maintains exactly one `in_progress` step at a time. We surface the latest plan per thread
 * for the gardener pane and the Lights worker rows.
 */
export type PlanStepStatus = "pending" | "in_progress" | "completed"

export type PlanStep = {
  step: string
  status: PlanStepStatus
}

export type AgentPlan = {
  steps: PlanStep[]
  explanation?: string
}

function isPlanStepStatus(value: unknown): value is PlanStepStatus {
  return value === "pending" || value === "in_progress" || value === "completed"
}

/**
 * Parse the raw `update_plan` tool arguments (a JSON string on the wire, or an already-parsed
 * object). Malformed steps are dropped; returns undefined when nothing usable remains so callers
 * can treat "no plan" and "unparseable plan" identically.
 */
export function parseUpdatePlanArgs(args: unknown): AgentPlan | undefined {
  let obj: unknown = args
  if (typeof args === "string") {
    try {
      obj = JSON.parse(args)
    } catch {
      return undefined
    }
  }
  if (!obj || typeof obj !== "object") return undefined
  const record = obj as Record<string, unknown>
  const rawSteps = Array.isArray(record.plan)
    ? record.plan
    : Array.isArray(record.steps)
      ? record.steps
      : undefined
  if (!rawSteps) return undefined
  const steps: PlanStep[] = []
  for (const item of rawSteps) {
    if (!item || typeof item !== "object") continue
    const entry = item as Record<string, unknown>
    const step =
      typeof entry.step === "string" ? entry.step : typeof entry.title === "string" ? entry.title : undefined
    if (!step || !step.trim()) continue
    if (!isPlanStepStatus(entry.status)) continue
    steps.push({ step: step.trim(), status: entry.status })
  }
  if (steps.length === 0) return undefined
  const explanation =
    typeof record.explanation === "string" && record.explanation.trim() ? record.explanation.trim() : undefined
  return explanation ? { steps, explanation } : { steps }
}

export type PlanProgress = {
  done: number
  total: number
  /** Index of the step to highlight as live: first in_progress, else first pending, else -1. */
  currentIndex: number
}

export function planProgress(plan: AgentPlan): PlanProgress {
  const total = plan.steps.length
  const done = plan.steps.filter((step) => step.status === "completed").length
  let currentIndex = plan.steps.findIndex((step) => step.status === "in_progress")
  if (currentIndex < 0) currentIndex = plan.steps.findIndex((step) => step.status === "pending")
  return { done, total, currentIndex }
}

const DOT_BY_STATUS: Record<PlanStepStatus, string> = {
  completed: "●",
  in_progress: "◐",
  pending: "○",
}

const CHECK_BY_STATUS: Record<PlanStepStatus, string> = {
  completed: "✓",
  in_progress: "◐",
  pending: "○",
}

export function planStepGlyph(status: PlanStepStatus, style: "dot" | "check"): string {
  return style === "dot" ? DOT_BY_STATUS[status] : CHECK_BY_STATUS[status]
}

/**
 * Compact single-line glyph for the narrow Lights column: one dot per step (●/◐/○), capped at
 * `max` with a trailing `+N` overflow. Shape encodes status so the row stays a single color.
 */
export function formatPlanDots(plan: AgentPlan, max = 6): string {
  const shown = plan.steps
    .slice(0, max)
    .map((step) => DOT_BY_STATUS[step.status])
    .join("")
  const overflow = plan.steps.length > max ? ` +${plan.steps.length - max}` : ""
  return `${shown}${overflow}`
}

/** `Plan · Step n/m` header for the gardener pane widget. Uses done-count, matching Codex. */
export function formatPlanHeader(plan: AgentPlan): string {
  const { done, total } = planProgress(plan)
  return `Plan · Step ${done}/${total}`
}

/**
 * Reverse-scan a Codex rollout JSONL body for the newest `update_plan`. Rollout lines wrap items
 * as `{ type: "response_item", payload: <item> }`; the plan surfaces either as a `function_call`
 * named `update_plan` or as an item of `type: "plan"`. Pure so it is unit-testable without fs.
 */
export function extractLatestPlanFromRollout(text: string): AgentPlan | undefined {
  const lines = text.split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]
    if (!line || !line.trim()) continue
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (!event || typeof event !== "object") continue
    const envelope = event as Record<string, unknown>
    const payload =
      envelope.type === "response_item" && envelope.payload && typeof envelope.payload === "object"
        ? (envelope.payload as Record<string, unknown>)
        : envelope
    const payloadType = payload.type
    if (payloadType === "function_call" && payload.name === "update_plan") {
      const plan = parseUpdatePlanArgs(payload.arguments)
      if (plan) return plan
    }
    if (payloadType === "plan") {
      const plan = parseUpdatePlanArgs(payload)
      if (plan) return plan
    }
  }
  return undefined
}

type PlanCacheEntry = {
  mtimeMs: number
  size: number
  plan: AgentPlan | undefined
}

const planCache = new Map<string, PlanCacheEntry>()

/**
 * Latest plan for a thread, read from its own Codex rollout. mtime+size cached (mirroring
 * `readThreadMetaEvents`) so the per-thread reconcile can call this every refresh cheaply — a
 * cache hit costs one `stat`, a miss re-reads only when the rollout has grown. Returns undefined
 * when the thread has no rollout or no plan yet.
 */
export async function readLatestAgentPlan(
  threadId: string,
  sessionsRoot: string = defaultCodexSessionsRoot(),
): Promise<AgentPlan | undefined> {
  const path = await resolveCodexSessionPath(threadId, sessionsRoot)
  if (!path) return undefined
  let stats: { mtimeMs: number; size: number }
  try {
    stats = await stat(path)
  } catch {
    return undefined
  }
  const cached = planCache.get(path)
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    return cached.plan
  }
  let text: string
  try {
    text = await readFile(path, "utf8")
  } catch {
    return undefined
  }
  const plan = extractLatestPlanFromRollout(text)
  planCache.set(path, { mtimeMs: stats.mtimeMs, size: stats.size, plan })
  return plan
}
