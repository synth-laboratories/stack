import { readdir, readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { resolveCodexSessionPath } from "./agent-context.js"

export type CodexRateLimitWindow = {
  usedPercent: number
  windowMinutes: number
  resetsAt?: number
}

export type CodexRateLimitsSnapshot = {
  planType?: string
  primary?: CodexRateLimitWindow
  secondary?: CodexRateLimitWindow
  rateLimitReached?: string
  observedAt: string
}

export function parseRateLimitsFromSessionJsonl(text: string): CodexRateLimitsSnapshot | undefined {
  let latest: CodexRateLimitsSnapshot | undefined

  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (!record || typeof record !== "object") continue
    const event = record as Record<string, unknown>
    if (event.type !== "event_msg") continue
    const payload = event.payload
    if (!payload || typeof payload !== "object") continue
    const message = payload as Record<string, unknown>
    if (message.type !== "token_count") continue
    const rateLimits = message.rate_limits
    if (!rateLimits || typeof rateLimits !== "object") continue
    const parsed = parseRateLimitsPayload(rateLimits as Record<string, unknown>)
    if (!parsed) continue
    latest = {
      ...parsed,
      observedAt: readString(event.timestamp) ?? new Date().toISOString(),
    }
  }

  return latest
}

export function parseRateLimitsFromCodexStdoutLine(line: string): CodexRateLimitsSnapshot | undefined {
  let record: unknown
  try {
    record = JSON.parse(line)
  } catch {
    return undefined
  }
  return parseRateLimitsFromEvent(record)
}

export function parseRateLimitsFromEvent(event: unknown): CodexRateLimitsSnapshot | undefined {
  if (!event || typeof event !== "object") return undefined
  const record = event as Record<string, unknown>
  const payload = record.payload
  if (!payload || typeof payload !== "object") return undefined
  const message = payload as Record<string, unknown>
  if (message.type !== "token_count") return undefined
  const rateLimits = message.rate_limits
  if (!rateLimits || typeof rateLimits !== "object") return undefined
  const parsed = parseRateLimitsPayload(rateLimits as Record<string, unknown>)
  if (!parsed) return undefined
  return { ...parsed, observedAt: readString(record.timestamp) ?? new Date().toISOString() }
}

export async function readCodexRateLimitsFromSession(
  threadId: string,
  sessionsRoot = defaultCodexSessionsRoot(),
): Promise<CodexRateLimitsSnapshot | undefined> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const sessionPath = await resolveCodexSessionPath(threadId, sessionsRoot)
    if (!sessionPath) {
      await sleep(attempt === 0 ? 80 : 160)
      continue
    }
    const text = await readFile(sessionPath, "utf8")
    const parsed = parseRateLimitsFromSessionJsonl(text)
    if (parsed) return parsed
    await sleep(160)
  }
  const sessionPath = await resolveCodexSessionPath(threadId, sessionsRoot)
  if (!sessionPath) return undefined
  return parseRateLimitsFromSessionJsonl(await readFile(sessionPath, "utf8"))
}

export async function readLatestCodexRateLimits(
  sessionsRoot = defaultCodexSessionsRoot(),
  maxFiles = 12,
): Promise<CodexRateLimitsSnapshot | undefined> {
  const candidates = await recentSessionPaths(sessionsRoot, maxFiles)
  let latest: CodexRateLimitsSnapshot | undefined

  for (const sessionPath of candidates) {
    let text: string
    try {
      text = await readFile(sessionPath, "utf8")
    } catch {
      continue
    }
    const parsed = parseRateLimitsFromSessionJsonl(text)
    if (!parsed) continue
    if (!latest || parsed.observedAt > latest.observedAt) latest = parsed
  }

  return latest
}

export function formatAuthChipLabel(authPlan: string, limits?: CodexRateLimitsSnapshot): string {
  const budget = formatCodexBudgetSuffix(authPlan, limits)
  return budget ? `auth ${authPlan} · ${budget}` : `auth ${authPlan}`
}

export function formatCodexBudgetSuffix(authPlan: string, limits?: CodexRateLimitsSnapshot): string | undefined {
  if (!limits || !isChatGptAuthPlan(authPlan)) return undefined
  if (limits.rateLimitReached) return "limit reached"

  const parts: string[] = []
  if (limits.primary) parts.push(formatWindowBudget(limits.primary))
  if (limits.secondary) parts.push(formatWindowBudget(limits.secondary))
  return parts.length > 0 ? parts.join(" · ") : undefined
}

function parseRateLimitsPayload(payload: Record<string, unknown>): Omit<CodexRateLimitsSnapshot, "observedAt"> | undefined {
  const primary = readWindow(payload.primary)
  const secondary = readWindow(payload.secondary)
  if (!primary && !secondary) return undefined
  return {
    planType: readString(payload.plan_type) ?? undefined,
    primary,
    secondary,
    rateLimitReached: readString(payload.rate_limit_reached_type) ?? undefined,
  }
}

function readWindow(value: unknown): CodexRateLimitWindow | undefined {
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  const usedPercent = readNumber(record.used_percent)
  const windowMinutes = readNumber(record.window_minutes)
  if (usedPercent === undefined || windowMinutes === undefined) return undefined
  return {
    usedPercent,
    windowMinutes,
    resetsAt: readNumber(record.resets_at),
  }
}

function formatWindowBudget(window: CodexRateLimitWindow): string {
  const label = windowLabel(window.windowMinutes)
  const remainingPercent = Math.max(0, Math.round(100 - window.usedPercent))
  if (remainingPercent <= 0) return `${label} depleted`
  return `${label} ${remainingPercent}% left`
}

function windowLabel(windowMinutes: number): string {
  if (windowMinutes >= 10_000) return "weekly"
  if (windowMinutes % 60 === 0 && windowMinutes >= 60) {
    const hours = windowMinutes / 60
    return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`
  }
  return `${windowMinutes}m`
}

function isChatGptAuthPlan(authPlan: string): boolean {
  return authPlan.toLowerCase().includes("chatgpt")
}

async function recentSessionPaths(sessionsRoot: string, maxFiles: number): Promise<string[]> {
  const paths: Array<{ path: string; mtimeMs: number }> = []
  const now = new Date()

  for (let dayOffset = 0; dayOffset < 3; dayOffset += 1) {
    const date = new Date(now)
    date.setDate(now.getDate() - dayOffset)
    const dir = join(
      sessionsRoot,
      String(date.getFullYear()),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    )
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue
      const path = join(dir, entry)
      try {
        const fileStat = await stat(path)
        paths.push({ path, mtimeMs: fileStat.mtimeMs })
      } catch {
        continue
      }
    }
  }

  return paths
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, maxFiles)
    .map((entry) => entry.path)
}

function defaultCodexSessionsRoot(): string {
  return join(homedir(), ".codex", "sessions")
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}
