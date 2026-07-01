import { parseCriterionEntry } from "./meta-thread-goal-criteria.js"
import { deriveCriteriaStates, type CriterionStatus } from "./goal-criteria-state.js"
import type { CriteriaProgress, EtaBand, MonitorOperatorUpdate, SpendSnapshot } from "./monitor.js"
import {
  appendThreadMetaEvent,
  readThreadMetaEvents,
  stackEventId,
  type StackThreadMetaEvent,
} from "./thread-events.js"

export type GoalModeInput = {
  objective?: string
  status?: string
  acceptanceCriteria: readonly string[]
}

export type GoalSessionStatus = "active" | "paused" | "blocked" | "done" | "cleared" | "unknown"

export type GoalSessionSnapshot = {
  goal_id: string
  meta_thread_id?: string
  objective: string
  started_at?: string
  paused_at?: string
  status: GoalSessionStatus
  criteria_progress: CriteriaProgress
  criteria_states: CriterionStatus[]
  spend: SpendSnapshot
  last_operator_update?: MonitorOperatorUpdate
  last_eta?: EtaBand
}

export type GoalLifecycleSource = "codex" | "manifest" | "operator"

const GOAL_LIFECYCLE_TYPES = new Set([
  "goal.started",
  "goal.paused",
  "goal.resumed",
  "goal.cleared",
])

export function appendGoalLifecycleEvent(input: {
  stackRoot: string
  threadId: string
  metaThreadId?: string
  segmentId?: string
  type: "goal.started" | "goal.paused" | "goal.resumed" | "goal.cleared"
  objective: string
  source: GoalLifecycleSource
  status?: string
}): StackThreadMetaEvent {
  const event: StackThreadMetaEvent = {
    event_id: stackEventId(input.type.replace(".", "_")),
    type: input.type,
    thread_id: input.threadId,
    observed_at: new Date().toISOString(),
    actor_id: "operator",
    actor_role: "primary",
    meta_thread_id: input.metaThreadId,
    segment_id: input.segmentId,
    payload: {
      objective: input.objective,
      source: input.source,
      status: input.status ?? lifecycleStatus(input.type),
    },
  }
  appendThreadMetaEvent(input.stackRoot, event)
  return event
}

export function shouldAppendGoalStarted(events: StackThreadMetaEvent[], objective: string): boolean {
  const normalized = objective.trim()
  if (!normalized) return false
  const lastStarted = [...events].reverse().find((event) => event.type === "goal.started")
  if (!lastStarted) return true
  const lastCleared = [...events].reverse().find((event) => event.type === "goal.cleared")
  if (lastCleared && (!lastStarted || Date.parse(lastCleared.observed_at) > Date.parse(lastStarted.observed_at))) {
    return true
  }
  return readString(lastStarted.payload.objective) !== normalized
}

export function reduceGoalSessionSnapshot(input: {
  events: StackThreadMetaEvent[]
  goal: GoalModeInput
  metaThreadId?: string
  monitorThreadSpendUsd?: number
}): GoalSessionSnapshot | undefined {
  const objective = input.goal.objective?.trim()
  if (!objective) return undefined

  const lifecycle = goalLifecycleState(input.events, objective)
  const criteria = criteriaProgressFromList(input.goal.acceptanceCriteria)
  const lastSummary = [...input.events].reverse().find((event) => event.type === "monitor.summary")
  const operatorUpdate = readOperatorUpdate(lastSummary)
  const spend =
    operatorUpdate?.spend_snapshot ??
    rollupSpendFromEvents(input.events, lifecycle.started_at, input.monitorThreadSpendUsd ?? 0)
  const elapsed_s = lifecycle.started_at ? elapsedSeconds(lifecycle.started_at, lifecycle.paused_at) : spend.elapsed_s

  return {
    goal_id: goalIdForObjective(objective, input.metaThreadId),
    meta_thread_id: input.metaThreadId,
    objective,
    started_at: lifecycle.started_at,
    paused_at: lifecycle.paused_at,
    status: normalizeGoalSessionStatus(input.goal.status, lifecycle.status),
    criteria_progress: operatorUpdate?.criteria_progress ?? criteria,
    criteria_states: deriveCriteriaStates(input.goal.acceptanceCriteria, input.events),
    spend: { ...spend, elapsed_s },
    last_operator_update: operatorUpdate,
    last_eta: operatorUpdate?.eta,
  }
}

function goalLifecycleState(
  events: StackThreadMetaEvent[],
  objective: string,
): { started_at?: string; paused_at?: string; status: GoalSessionStatus } {
  let started_at: string | undefined
  let paused_at: string | undefined
  let status: GoalSessionStatus = "active"

  for (const event of events) {
    // Monitor-audited goal status (thread-scoped, one active goal). goal_met is the monitor
    // confirming the worker's completion claim → the goal is done. This is the second flip path
    // alongside the worker's own update_goal{complete}.
    if (event.type === "monitor.goal_status") {
      const monitorStatus = readString(event.payload.status)
      if (monitorStatus === "goal_met") status = "done"
      else if (monitorStatus === "goal_failed" || monitorStatus === "blocked" || monitorStatus === "stalled") {
        // These are monitor milestones for the strip/timeline, not lifecycle ownership.
        // Only the human/operator lifecycle can pause/stop a goal; the monitor keeps the run active
        // while surfacing the concern for steering.
        if (status !== "done") status = "active"
      } else if (monitorStatus === "advancing" || monitorStatus === "working") {
        if (status !== "done") status = "active"
      }
      continue
    }
    if (!GOAL_LIFECYCLE_TYPES.has(event.type)) continue
    if (readString(event.payload.objective) !== objective) continue
    switch (event.type) {
      case "goal.started":
        started_at = event.observed_at
        paused_at = undefined
        status = "active"
        break
      case "goal.paused":
        paused_at = event.observed_at
        status = "paused"
        break
      case "goal.resumed":
        paused_at = undefined
        status = "active"
        break
      case "goal.cleared":
        status = "cleared"
        break
    }
  }

  if (!started_at) {
    const fallback = events.find(
      (event) =>
        event.type === "meta_thread.goal_updated" &&
        readString(event.payload.objective) === objective,
    )
    started_at = fallback?.observed_at
  }

  return { started_at, paused_at, status }
}

function rollupSpendFromEvents(
  events: StackThreadMetaEvent[],
  startedAt: string | undefined,
  monitorThreadSpendUsd: number,
): SpendSnapshot {
  const since = startedAt ? Date.parse(startedAt) : Number.NaN
  let worker_tokens = 0
  let monitor_tokens = 0
  let worker_usd = 0
  let monitor_usd = monitorThreadSpendUsd

  for (const event of events) {
    if (Number.isFinite(since) && Date.parse(event.observed_at) < since) continue
    if (event.type === "agent.usage") {
      worker_tokens += readNumber(event.payload.input_tokens) ?? 0
      worker_tokens += readNumber(event.payload.output_tokens) ?? 0
      worker_usd += readNumber(event.payload.estimated_spend_usd) ?? 0
    }
    if (event.type === "monitor.usage") {
      monitor_tokens += readNumber(event.payload.input_tokens) ?? 0
      monitor_tokens += readNumber(event.payload.output_tokens) ?? 0
      monitor_usd += readNumber(event.payload.estimated_spend_usd) ?? 0
    }
  }

  return {
    elapsed_s: 0,
    worker_usd,
    monitor_usd,
    worker_tokens,
    monitor_tokens,
  }
}

function criteriaProgressFromList(criteria: readonly string[]): CriteriaProgress {
  let done = 0
  let lastCriterion: string | undefined
  for (const criterion of criteria) {
    const parsed = parseCriterionEntry(criterion)
    if (parsed.done) {
      done += 1
      lastCriterion = parsed.label
    }
  }
  const total = criteria.length
  return {
    done,
    total,
    pct: total > 0 ? Math.round((done / total) * 100) : 0,
    last_criterion: lastCriterion,
  }
}

function readOperatorUpdate(event: StackThreadMetaEvent | undefined): MonitorOperatorUpdate | undefined {
  if (!event || event.type !== "monitor.summary") return undefined
  const record = asRecord(event.payload.operator_update)
  if (!record) return undefined
  return record as MonitorOperatorUpdate
}

function goalIdForObjective(objective: string, metaThreadId?: string): string {
  const slug = objective.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48)
  return metaThreadId ? `${metaThreadId}:${slug}` : slug
}

function normalizeGoalSessionStatus(
  goalStatus: string | undefined,
  lifecycleStatus: GoalSessionStatus,
): GoalSessionStatus {
  if (lifecycleStatus === "cleared") return "cleared"
  if (lifecycleStatus === "paused") return "paused"
  const normalized = goalStatus?.trim().toLowerCase()
  if (normalized === "blocked") return "active"
  if (normalized === "done") return "done"
  if (normalized === "paused") return "paused"
  if (normalized === "cleared") return "cleared"
  return lifecycleStatus === "unknown" ? "active" : lifecycleStatus
}

function elapsedSeconds(startedAt: string, pausedAt?: string): number {
  const start = Date.parse(startedAt)
  const end = pausedAt ? Date.parse(pausedAt) : Date.now()
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  return Math.max(0, Math.round((end - start) / 1000))
}

function lifecycleStatus(type: string): string {
  switch (type) {
    case "goal.started":
      return "active"
    case "goal.paused":
      return "paused"
    case "goal.resumed":
      return "active"
    case "goal.cleared":
      return "cleared"
    default:
      return "unknown"
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined
}

export function readGoalSessionEvents(stackRoot: string, threadId: string): StackThreadMetaEvent[] {
  return readThreadMetaEvents(stackRoot, threadId).filter((event) => GOAL_LIFECYCLE_TYPES.has(event.type))
}
