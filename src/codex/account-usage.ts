import { CodexAppServerClient, codexAppServerArgs } from "./app-server-client.js"
import { formatTokenTotal } from "./usage-cost.js"

export type CodexDailyUsageBucket = {
  startDate: string
  tokens: number
}

export type CodexAccountUsageSummary = {
  lifetimeTokens: number
  peakDailyTokens: number
  longestRunningTurnSec: number
  currentStreakDays: number
  longestStreakDays: number
}

export type CodexAccountUsageSnapshot = {
  summary: CodexAccountUsageSummary
  dailyUsageBuckets: CodexDailyUsageBucket[]
  observedAt: string
}

export type CodexUsageActivityView = "daily" | "weekly" | "cumulative"

export async function readCodexAccountUsage(options: {
  codexCommand: string
  codexArgs?: readonly string[]
  env?: Record<string, string | undefined>
}): Promise<CodexAccountUsageSnapshot | undefined> {
  try {
    return await readCodexAccountUsageFromAppServer(options.codexCommand, options.codexArgs ?? [], options.env)
  } catch {
    return undefined
  }
}

export async function readCodexAccountUsageFromAppServer(
  codexCommand: string,
  codexArgs: readonly string[] = [],
  env?: Record<string, string | undefined>,
): Promise<CodexAccountUsageSnapshot | undefined> {
  const client = await CodexAppServerClient.start({
    launch: {
      command: codexCommand,
      args: codexAppServerArgs(codexArgs),
      cwd: process.cwd(),
      env,
    },
    clientName: "stack",
    clientTitle: "Stack",
  })
  try {
    const result = await client.request("account/usage/read", {}, 15_000)
    return parseCodexAccountUsageResult(result)
  } finally {
    await client.close()
  }
}

export function parseCodexAccountUsageResult(result: unknown): CodexAccountUsageSnapshot | undefined {
  if (!result || typeof result !== "object") return undefined
  const record = result as Record<string, unknown>
  const summaryRaw = record.summary
  if (!summaryRaw || typeof summaryRaw !== "object") return undefined
  const summaryRecord = summaryRaw as Record<string, unknown>
  const lifetimeTokens = readNumber(summaryRecord.lifetimeTokens)
  if (lifetimeTokens === undefined) return undefined
  const dailyUsageBuckets = parseDailyUsageBuckets(record.dailyUsageBuckets)
  return {
    summary: {
      lifetimeTokens,
      peakDailyTokens: readNumber(summaryRecord.peakDailyTokens) ?? 0,
      longestRunningTurnSec: readNumber(summaryRecord.longestRunningTurnSec) ?? 0,
      currentStreakDays: readNumber(summaryRecord.currentStreakDays) ?? 0,
      longestStreakDays: readNumber(summaryRecord.longestStreakDays) ?? 0,
    },
    dailyUsageBuckets,
    observedAt: new Date().toISOString(),
  }
}

export function formatCodexUsageActivityLines(
  view: CodexUsageActivityView,
  usage: CodexAccountUsageSnapshot,
): string[] {
  if (view === "cumulative") return formatCodexCumulativeUsageLines(usage)
  if (view === "weekly") return formatCodexWeeklyUsageLines(usage)
  return formatCodexDailyUsageLines(usage)
}

function formatCodexDailyUsageLines(usage: CodexAccountUsageSnapshot): string[] {
  const buckets = usage.dailyUsageBuckets.slice(-14)
  if (buckets.length === 0) return ["  (no daily token activity)"]
  const peak = Math.max(...buckets.map((bucket) => bucket.tokens), 1)
  const lines = buckets.map((bucket) => {
    const bar = usageActivityBar(bucket.tokens, peak)
    return `  ${bucket.startDate}  ${bar}  ${formatAccountTokenTotal(bucket.tokens)} tok`
  })
  return lines
}

function formatCodexWeeklyUsageLines(usage: CodexAccountUsageSnapshot): string[] {
  const weeks = aggregateWeeklyUsage(usage.dailyUsageBuckets).slice(-8)
  if (weeks.length === 0) return ["  (no weekly token activity)"]
  const peak = Math.max(...weeks.map((week) => week.tokens), 1)
  return weeks.map((week) => {
    const bar = usageActivityBar(week.tokens, peak)
    return `  ${week.label}  ${bar}  ${formatAccountTokenTotal(week.tokens)} tok`
  })
}

function formatCodexCumulativeUsageLines(usage: CodexAccountUsageSnapshot): string[] {
  const summary = usage.summary
  const lines = [
    `  lifetime ${formatAccountTokenTotal(summary.lifetimeTokens)} tok`,
    `  peak day ${formatAccountTokenTotal(summary.peakDailyTokens)} tok`,
    `  streak ${summary.currentStreakDays}d (best ${summary.longestStreakDays}d)`,
  ]
  if (summary.longestRunningTurnSec > 0) {
    lines.push(`  longest turn ${formatDuration(summary.longestRunningTurnSec)}`)
  }
  const today = usage.dailyUsageBuckets.at(-1)
  if (today) lines.push(`  today ${formatAccountTokenTotal(today.tokens)} tok (${today.startDate})`)
  return lines
}

function aggregateWeeklyUsage(buckets: readonly CodexDailyUsageBucket[]): Array<{ label: string; tokens: number }> {
  const byWeek = new Map<string, number>()
  for (const bucket of buckets) {
    const weekStart = weekStartDate(bucket.startDate)
    if (!weekStart) continue
    byWeek.set(weekStart, (byWeek.get(weekStart) ?? 0) + bucket.tokens)
  }
  return [...byWeek.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, tokens]) => ({ label, tokens }))
}

function weekStartDate(isoDate: string): string | undefined {
  const parsed = Date.parse(`${isoDate}T00:00:00Z`)
  if (!Number.isFinite(parsed)) return undefined
  const date = new Date(parsed)
  const day = date.getUTCDay()
  const diff = day === 0 ? 6 : day - 1
  date.setUTCDate(date.getUTCDate() - diff)
  return date.toISOString().slice(0, 10)
}

function usageActivityBar(value: number, peak: number, width = 10): string {
  const ratio = peak > 0 ? Math.max(0, Math.min(1, value / peak)) : 0
  const filled = Math.round(ratio * width)
  return `${"█".repeat(filled)}${"░".repeat(Math.max(0, width - filled))}`
}

export function formatAccountTokenTotal(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`
  return formatTokenTotal(value)
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remMinutes = minutes % 60
  return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`
}

function parseDailyUsageBuckets(value: unknown): CodexDailyUsageBucket[] {
  if (!Array.isArray(value)) return []
  const buckets: CodexDailyUsageBucket[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue
    const record = entry as Record<string, unknown>
    const startDate = readString(record.startDate)
    const tokens = readNumber(record.tokens)
    if (!startDate || tokens === undefined) continue
    buckets.push({ startDate, tokens })
  }
  return buckets
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}
