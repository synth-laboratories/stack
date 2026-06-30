import { readFile } from "node:fs/promises"
import { resolveCodexSessionPath } from "./agent-context.js"

export type CodexGoalSnapshot = {
  threadId?: string
  objective?: string
  status?: string
  acceptanceCriteria?: string[]
  blockers?: string[]
  tokensUsed?: number
  tokenBudget?: string
  tokensRemaining?: string
  timeUsedSeconds?: number
  source: "none" | "tool" | "context" | "meta_thread"
}

const GOAL_CONTEXT_MARKER = '<codex_internal_context source="goal">'
const OBJECTIVE_RE = /<objective>\s*([\s\S]*?)\s*<\/objective>/i
const TOKENS_USED_RE = /^-\s*Tokens used:\s*(.+)$/im
const TOKEN_BUDGET_RE = /^-\s*Token budget:\s*(.+)$/im
const TOKENS_REMAINING_RE = /^-\s*Tokens remaining:\s*(.+)$/im

type GoalToolPayload = {
  goal?: {
    threadId?: string
    objective?: string
    status?: string
    tokensUsed?: number
    tokenBudget?: number | string | null
    timeUsedSeconds?: number
  }
}

export function emptyGoalContext(): CodexGoalSnapshot {
  return { source: "none" }
}

export function mergeGoalContext(current: CodexGoalSnapshot, incoming: CodexGoalSnapshot): CodexGoalSnapshot {
  if (incoming.source === "none") return current
  return {
    threadId: incoming.threadId ?? current.threadId,
    objective: incoming.objective ?? current.objective,
    status: incoming.status ?? current.status,
    acceptanceCriteria: incoming.acceptanceCriteria ?? current.acceptanceCriteria,
    blockers: incoming.blockers ?? current.blockers,
    tokensUsed: incoming.tokensUsed ?? current.tokensUsed,
    tokenBudget: incoming.tokenBudget ?? current.tokenBudget,
    tokensRemaining: incoming.tokensRemaining ?? current.tokensRemaining,
    timeUsedSeconds: incoming.timeUsedSeconds ?? current.timeUsedSeconds,
    source: incoming.source === "meta_thread" ? "meta_thread" : incoming.source === "tool" ? "tool" : current.source === "tool" ? "tool" : incoming.source,
  }
}

export function parseGoalFromSessionJsonl(text: string): CodexGoalSnapshot {
  let snapshot = emptyGoalContext()
  const goalCallIds = new Set<string>()

  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    const parsed = parseGoalFromCodexJsonLine(line, goalCallIds)
    if (parsed) snapshot = mergeGoalContext(snapshot, parsed)
  }

  return snapshot
}

export function parseGoalFromCodexJsonLine(
  line: string,
  goalCallIds: Set<string> = new Set(),
): CodexGoalSnapshot | undefined {
  let event: unknown
  try {
    event = JSON.parse(line)
  } catch {
    return undefined
  }
  if (!event || typeof event !== "object") return undefined
  const record = event as Record<string, unknown>
  const payload = asRecord(record.payload)
  const item = payload ?? record
  const type = readString(item.type) ?? readString(record.type) ?? ""

  if (type === "function_call") {
    const name = readString(item.name) ?? ""
    const callId = readString(item.call_id)
    if ((name === "get_goal" || name === "update_goal") && callId) {
      goalCallIds.add(callId)
    }
    if (name === "update_goal") {
      const args = readString(item.arguments)
      if (args) {
        try {
          const parsed = JSON.parse(args) as { status?: string }
          if (parsed.status) return { status: parsed.status, source: "tool" }
        } catch {
          // ignore malformed tool args
        }
      }
    }
    return undefined
  }

  if (type === "function_call_output") {
    const callId = readString(item.call_id)
    if (!callId || !goalCallIds.has(callId)) return undefined
    const output = readString(item.output)
    if (!output) return undefined
    return goalSnapshotFromToolOutput(output)
  }

  if (type === "message" && readString(item.role) === "user") {
    const content = item.content
    if (!Array.isArray(content)) return undefined
    for (const part of content) {
      const text = asRecord(part)?.text
      if (typeof text !== "string" || !text.includes(GOAL_CONTEXT_MARKER)) continue
      return goalSnapshotFromInternalContext(text)
    }
  }

  return undefined
}

function goalSnapshotFromToolOutput(output: string): CodexGoalSnapshot | undefined {
  try {
    const parsed = JSON.parse(output) as GoalToolPayload
    const goal = parsed.goal
    if (!goal) return undefined
    return {
      threadId: goal.threadId,
      objective: goal.objective,
      status: goal.status,
      tokensUsed: goal.tokensUsed,
      tokenBudget: formatTokenBudget(goal.tokenBudget),
      timeUsedSeconds: goal.timeUsedSeconds,
      source: "tool",
    }
  } catch {
    return undefined
  }
}

function goalSnapshotFromInternalContext(text: string): CodexGoalSnapshot {
  const objective = text.match(OBJECTIVE_RE)?.[1]?.trim()
  const tokensUsedRaw = text.match(TOKENS_USED_RE)?.[1]?.trim()
  const tokenBudget = text.match(TOKEN_BUDGET_RE)?.[1]?.trim()
  const tokensRemaining = text.match(TOKENS_REMAINING_RE)?.[1]?.trim()
  const tokensUsed = tokensUsedRaw ? parseGoalInteger(tokensUsedRaw) : undefined

  return {
    objective,
    tokensUsed,
    tokenBudget,
    tokensRemaining,
    status: "active",
    source: "context",
  }
}

function formatTokenBudget(value: number | string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === "number") return value.toLocaleString("en-US")
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function parseGoalInteger(raw: string): number | undefined {
  const normalized = raw.replace(/,/g, "")
  const parsed = Number.parseInt(normalized, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function goalContextVisible(snapshot: CodexGoalSnapshot): boolean {
  return Boolean(
    snapshot.objective ||
    snapshot.status ||
    snapshot.tokensUsed !== undefined ||
    snapshot.threadId ||
    snapshot.acceptanceCriteria?.length ||
    snapshot.blockers?.length,
  )
}

export function goalContextStripLines(snapshot: CodexGoalSnapshot, columns: number): string[] {
  if (!goalContextVisible(snapshot)) return []

  const width = Math.max(24, columns - 2)
  const lines: string[] = []

  const status = snapshot.status ?? "active"
  const compute = formatGoalCompute(snapshot)
  const metaParts = [`goal ${status}`]
  if (compute) metaParts.push(compute)
  if (snapshot.tokenBudget && snapshot.tokenBudget !== "none") {
    metaParts.push(`budget ${snapshot.tokenBudget}`)
  } else if (snapshot.tokensRemaining && snapshot.tokensRemaining !== "unbounded") {
    metaParts.push(`left ${snapshot.tokensRemaining}`)
  }
  lines.push(truncateGoalLine(metaParts.join(" · "), width))

  if (snapshot.objective) {
    lines.push(truncateGoalLine(snapshot.objective.replace(/\s+/g, " ").trim(), width))
  }
  if (snapshot.acceptanceCriteria?.length) {
    lines.push(truncateGoalLine(`criteria ${snapshot.acceptanceCriteria.length}`, width))
  }
  if (snapshot.blockers?.length) {
    lines.push(truncateGoalLine(`blockers ${snapshot.blockers.length}`, width))
  }

  return lines
}

export function formatGoalCompute(snapshot: CodexGoalSnapshot): string | undefined {
  const parts: string[] = []
  if (snapshot.tokensUsed !== undefined) {
    parts.push(`${formatGoalInteger(snapshot.tokensUsed)} tok`)
  }
  if (snapshot.timeUsedSeconds !== undefined && snapshot.timeUsedSeconds > 0) {
    parts.push(formatGoalDuration(snapshot.timeUsedSeconds))
  }
  return parts.length > 0 ? parts.join(" · ") : undefined
}

function formatGoalInteger(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 10_000) return `${Math.round(value / 1000)}k`
  return value.toLocaleString("en-US")
}

function formatGoalDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remMinutes = minutes % 60
  return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`
}

function truncateGoalLine(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text
  return `${text.slice(0, Math.max(0, maxWidth - 1))}…`
}

/**
 * Single, non-retrying read of a thread's Codex goal from its rollout — the authoritative,
 * agent-owned goal state (it captures the latest `update_goal` status). Used by the meta-goal sync
 * layer, which runs on hot paths (post-turn / resume) and must not block on the retry loop.
 */
export async function readCodexGoalSnapshotOnce(threadId: string): Promise<CodexGoalSnapshot | undefined> {
  const sessionPath = await resolveCodexSessionPath(threadId)
  if (!sessionPath) return undefined
  try {
    return parseGoalFromSessionJsonl(await readFile(sessionPath, "utf8"))
  } catch {
    return undefined
  }
}

export async function readGoalFromSession(threadId: string): Promise<CodexGoalSnapshot | undefined> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const sessionPath = await resolveCodexSessionPath(threadId)
    if (!sessionPath) {
      await sleep(attempt === 0 ? 80 : 160)
      continue
    }
    const snapshot = parseGoalFromSessionJsonl(await readFile(sessionPath, "utf8"))
    if (goalContextVisible(snapshot)) return snapshot
    await sleep(160)
  }

  const sessionPath = await resolveCodexSessionPath(threadId)
  if (!sessionPath) return undefined
  const snapshot = parseGoalFromSessionJsonl(await readFile(sessionPath, "utf8"))
  return goalContextVisible(snapshot) ? snapshot : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms)
  })
}
