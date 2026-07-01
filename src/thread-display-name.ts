import { join } from "node:path"
import { readSessionLog, writeSessionLog, type StackSessionSummary } from "./session.js"
import { resumeTokenFromMetaThreadId } from "./resume-checkpoint.js"
import { appendThreadMetaEvent, stackEventId } from "./thread-events.js"

export const MAX_THREAD_DISPLAY_NAME = 48

export type ThreadNameActor = "gardener" | "monitor" | "operator"

export function sanitizeThreadDisplayName(value: string): string | undefined {
  let cleaned = value.trim().replace(/^\*\*(.+)\*\*$/, "$1").replace(/^["'](.+)["']$/, "$1").trim()
  if (!cleaned) return undefined
  if (cleaned.length > MAX_THREAD_DISPLAY_NAME) {
    cleaned = `${cleaned.slice(0, MAX_THREAD_DISPLAY_NAME - 1)}…`
  }
  return cleaned
}

export function parseThreadNameFromAgentResponse(text: string): string | undefined {
  const lines = text.split(/\r?\n/)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = lines[index]?.trim().match(/^thread\.name:\s*(.+)$/i)
    if (match?.[1]) return sanitizeThreadDisplayName(match[1])
  }

  const boldMatch = text.match(/Name assigned:\s*\*\*(.+?)\*\*/i)
  if (boldMatch?.[1]) return sanitizeThreadDisplayName(boldMatch[1])

  const plainMatch = text.match(/Name assigned:\s*(.+?)(?:[.!?\n]|$)/i)
  if (plainMatch?.[1]) return sanitizeThreadDisplayName(plainMatch[1])

  return undefined
}

export function parseThreadNameFromOperatorMessage(message: string): string | undefined {
  const trimmed = message.trim()
  const patterns = [
    /^thread\.name:\s*(.+)$/i,
    /^name(?:\s+this)?(?:\s+thread)?:\s*(.+)$/i,
    /^call(?:\s+this)?(?:\s+thread)?\s+["']?(.+?)["']?\s*$/i,
    /^assign(?:\s+a)?\s+name(?:\s+to(?:\s+the)?(?:\s+active)?\s+thread)?:\s*(.+)$/i,
  ]
  for (const pattern of patterns) {
    const match = trimmed.match(pattern)
    if (match?.[1]) return sanitizeThreadDisplayName(match[1])
  }
  return undefined
}

export function resolveThreadDisplayLabel(
  summary: StackSessionSummary | undefined,
  options?: { isGardener?: boolean; maxLength?: number; fallbackId?: string; metaThreadTitle?: string },
): string {
  if (options?.isGardener) return "gardener"
  const maxLength = options?.maxLength ?? 28
  // A meta-thread title labels the thread whenever the caller resolved one — callers
  // only look titles up for bound threads, and a bound goal must never show (empty).
  if (options?.metaThreadTitle?.trim()) {
    return oneLine(options.metaThreadTitle.trim(), maxLength)
  }
  if (summary?.displayName?.trim()) return oneLine(summary.displayName.trim(), maxLength)
  if (summary?.lastPrompt?.trim()) return oneLine(summary.lastPrompt.trim(), maxLength)
  if (options?.fallbackId) return options.fallbackId.slice(0, 8)
  return "(empty)"
}

export function threadResumeToken(summary: StackSessionSummary | undefined): string | undefined {
  if (!summary?.metaThreadId) return undefined
  return resumeTokenFromMetaThreadId(summary.metaThreadId)
}

export function threadResumeHint(summary: StackSessionSummary | undefined): string | undefined {
  const token = threadResumeToken(summary)
  if (!token) return undefined
  return `stack resume ${token}`
}

export async function setThreadDisplayName(input: {
  stackRoot: string
  sessionLogDir: string
  threadId: string
  displayName: string
  namedBy: ThreadNameActor
  codexModel?: string
  pricingRows?: readonly import("./codex/usage-cost.js").CodexModelPricing[]
}): Promise<boolean> {
  const displayName = sanitizeThreadDisplayName(input.displayName)
  if (!displayName) return false

  const path = join(input.sessionLogDir, `${input.threadId}.json`)
  let session
  try {
    session = await readSessionLog(path)
  } catch {
    return false
  }

  const previous = session.displayName
  if (previous === displayName) return false

  session.displayName = displayName
  await writeSessionLog(session, input.sessionLogDir, {
    codexModel: input.codexModel ?? session.codexModel,
    pricingRows: input.pricingRows,
  })

  appendThreadMetaEvent(input.stackRoot, {
    event_id: stackEventId("thread_named"),
    type: "thread.named",
    thread_id: input.threadId,
    observed_at: new Date().toISOString(),
    actor_id: input.namedBy,
    actor_role: input.namedBy === "monitor" ? "monitor" : input.namedBy === "operator" ? "primary" : "system",
    payload: {
      display_name: displayName,
      previous_name: previous ?? null,
      named_by: input.namedBy,
    },
  })
  return true
}

export async function tryApplyThreadNameFromAgentResponse(input: {
  stackRoot: string
  sessionLogDir: string
  threadId: string
  text: string
  namedBy: Exclude<ThreadNameActor, "operator">
  codexModel?: string
  pricingRows?: readonly import("./codex/usage-cost.js").CodexModelPricing[]
}): Promise<string | undefined> {
  const displayName = parseThreadNameFromAgentResponse(input.text)
  if (!displayName) return undefined
  const changed = await setThreadDisplayName({ ...input, displayName })
  return changed ? displayName : undefined
}

export async function tryApplyThreadNameFromOperatorMessage(input: {
  stackRoot: string
  sessionLogDir: string
  threadId: string
  message: string
  codexModel?: string
  pricingRows?: readonly import("./codex/usage-cost.js").CodexModelPricing[]
}): Promise<string | undefined> {
  const displayName = parseThreadNameFromOperatorMessage(input.message)
  if (!displayName) return undefined
  const changed = await setThreadDisplayName({ ...input, displayName, namedBy: "operator" })
  return changed ? displayName : undefined
}

function oneLine(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`
}
