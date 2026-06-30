import type { CodexAppServerClient } from "./app-server-client.js"
import type { CodexGoalSnapshot } from "./goal-context.js"

export type CodexThreadGoal = {
  id?: string
  threadId?: string
  objective: string
  status?: string
  tokensUsed?: number
  tokenBudget?: number | string | null
  timeUsedSeconds?: number
}

export type GoalSlashAction =
  | { action: "show" }
  | { action: "panel" }
  | { action: "pause" }
  | { action: "resume" }
  | { action: "clear" }
  | { action: "set"; objective: string }
  | { action: "criteria_show" }
  | { action: "criteria_add"; text: string }
  | { action: "criteria_toggle"; index: number }
  | { action: "criteria_remove"; index: number }
  | { action: "criteria_clear" }

const GOAL_SLASH_VERBS = new Set(["pause", "resume", "clear"])

export function parseGoalSlashArgs(args: string): GoalSlashAction {
  const trimmed = args.trim()
  if (!trimmed) return { action: "panel" }
  if (trimmed.toLowerCase().startsWith("criteria")) {
    return parseGoalCriteriaSlashArgs(trimmed.slice("criteria".length).trim())
  }
  const verb = trimmed.toLowerCase()
  if (GOAL_SLASH_VERBS.has(verb)) return { action: verb as "pause" | "resume" | "clear" }
  return { action: "set", objective: trimmed }
}

function parseGoalCriteriaSlashArgs(args: string): GoalSlashAction {
  if (!args) return { action: "criteria_show" }
  const [verb, ...rest] = args.split(/\s+/)
  const tail = rest.join(" ").trim()
  switch (verb.toLowerCase()) {
    case "add":
      if (!tail) return { action: "criteria_show" }
      return { action: "criteria_add", text: tail }
    case "toggle": {
      const index = parseCriteriaSlashIndex(rest[0])
      if (index === undefined) return { action: "criteria_show" }
      return { action: "criteria_toggle", index }
    }
    case "remove": {
      const index = parseCriteriaSlashIndex(rest[0])
      if (index === undefined) return { action: "criteria_show" }
      return { action: "criteria_remove", index }
    }
    case "clear":
      return { action: "criteria_clear" }
    default:
      if (verb.toLowerCase() === "criteria") return { action: "criteria_show" }
      return { action: "criteria_add", text: args }
  }
}

function parseCriteriaSlashIndex(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined
  const index = Number.parseInt(value.trim(), 10)
  if (!Number.isFinite(index) || index < 1) return undefined
  return index - 1
}

export function readCodexThreadGoal(result: unknown): CodexThreadGoal | null {
  if (!result || typeof result !== "object") return null
  const record = result as Record<string, unknown>
  const goalValue = record.goal ?? record
  if (!goalValue || typeof goalValue !== "object") return null
  const goal = goalValue as Record<string, unknown>
  const objective = readString(goal.objective)
  if (!objective) return null
  return {
    id: readString(goal.id),
    threadId: readString(goal.threadId),
    objective,
    status: readString(goal.status),
    tokensUsed: readNumber(goal.tokensUsed),
    tokenBudget: goal.tokenBudget as number | string | null | undefined,
    timeUsedSeconds: readNumber(goal.timeUsedSeconds),
  }
}

export function goalSnapshotFromCodexThreadGoal(goal: CodexThreadGoal): CodexGoalSnapshot {
  return {
    threadId: goal.threadId,
    objective: goal.objective,
    status: goal.status ?? "active",
    tokensUsed: goal.tokensUsed,
    tokenBudget: formatTokenBudget(goal.tokenBudget),
    source: "tool",
  }
}

export function formatCodexGoalStatusFeedback(goal: CodexThreadGoal | null): string {
  if (!goal) {
    return [
      "no active goal",
      "next: /goal <objective>",
    ].join("\n")
  }

  const status = goal.status ?? "active"
  const lines = [
    `goal ${status}`,
    goal.objective,
  ]
  const compute = formatGoalCompute(goal)
  if (compute) lines.push(compute)
  if (goal.tokenBudget !== undefined && goal.tokenBudget !== null && goal.tokenBudget !== "") {
    lines.push(`budget ${formatTokenBudget(goal.tokenBudget)}`)
  }

  if (status === "active") {
    lines.push("next: /goal pause · /goal clear")
  } else if (status === "paused") {
    lines.push("next: /goal resume · /goal clear")
  } else {
    lines.push("next: /goal clear")
  }
  return lines.join("\n")
}

function formatGoalCompute(goal: CodexThreadGoal): string | undefined {
  const parts: string[] = []
  if (goal.tokensUsed !== undefined) {
    parts.push(`${goal.tokensUsed.toLocaleString("en-US")} tok`)
  }
  if (goal.timeUsedSeconds !== undefined && goal.timeUsedSeconds > 0) {
    parts.push(formatDuration(goal.timeUsedSeconds))
  }
  return parts.length > 0 ? parts.join(" · ") : undefined
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remMinutes = minutes % 60
  return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`
}

function formatTokenBudget(value: number | string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === "number") return value.toLocaleString("en-US")
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export async function codexThreadGoalGet(
  client: CodexAppServerClient,
  threadId: string,
): Promise<CodexThreadGoal | null> {
  const result = await client.request("thread/goal/get", { threadId })
  return readCodexThreadGoal(result)
}

export async function codexThreadGoalSet(
  client: CodexAppServerClient,
  threadId: string,
  objective: string,
  tokenBudget?: number,
): Promise<CodexThreadGoal | null> {
  const params: Record<string, unknown> = { threadId, objective }
  if (tokenBudget !== undefined) params.tokenBudget = tokenBudget
  const result = await client.request("thread/goal/set", params)
  return readCodexThreadGoal(result)
}

export async function codexThreadGoalClear(
  client: CodexAppServerClient,
  threadId: string,
): Promise<boolean> {
  const result = await client.request("thread/goal/clear", { threadId })
  if (!result || typeof result !== "object") return true
  const cleared = (result as Record<string, unknown>).cleared
  return cleared === undefined ? true : Boolean(cleared)
}

async function codexThreadGoalStatusRpc(
  client: CodexAppServerClient,
  threadId: string,
  method: "thread/goal/pause" | "thread/goal/resume",
): Promise<CodexThreadGoal | null> {
  const result = await client.request(method, { threadId })
  return readCodexThreadGoal(result)
}

export async function codexThreadGoalPause(
  client: CodexAppServerClient,
  threadId: string,
): Promise<CodexThreadGoal | null> {
  return codexThreadGoalStatusRpc(client, threadId, "thread/goal/pause")
}

export async function codexThreadGoalResume(
  client: CodexAppServerClient,
  threadId: string,
): Promise<CodexThreadGoal | null> {
  return codexThreadGoalStatusRpc(client, threadId, "thread/goal/resume")
}
