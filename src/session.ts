import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { buildSessionUsageSummary, type CodexModelPricing } from "./codex/usage-cost.js"

export type StackSessionUsageTotals = {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  turnCountWithUsage: number
}

export type StackSessionUsageSummary = {
  model: string
  totals: StackSessionUsageTotals
  estimatedSpendUsd?: number
}

export type StackCodexTurn = {
  id: string
  prompt: string
  selectedPaths: string[]
  startedAt: string
  finishedAt?: string
  exitCode?: number
  usage?: StackCodexUsage
  stdout: string
  stderr: string
}

export type StackCodexUsage = {
  inputTokens?: number
  cachedInputTokens?: number
  outputTokens?: number
  reasoningOutputTokens?: number
}

import type { StackSessionAgentRole } from "./agent-roles.js"

/** @deprecated Prefer `StackSessionAgentRole` from `agent-roles.js`. */
export type StackSessionRole = StackSessionAgentRole
export type StackSessionHarness = "codex" | "cursor"
export type StackSessionSegmentRole = "research" | "plan" | "design" | "implement" | "verify" | "custom"

export type StackLocalSession = {
  id: string
  workspaceRoot: string
  startedAt: string
  codexCommand: string
  codexModel?: string
  codexThreadId?: string
  harness?: StackSessionHarness
  harnessModel?: string
  role?: StackSessionRole
  displayName?: string
  metaThreadId?: string
  segmentId?: string
  segmentRole?: StackSessionSegmentRole
  predecessorThreadId?: string
  usageSummary?: StackSessionUsageSummary
  turns: StackCodexTurn[]
}

export type StackSessionSummary = {
  id: string
  path: string
  startedAt: string
  updatedAt: string
  turnCount: number
  lastPrompt?: string
  displayName?: string
  usageSummary?: StackSessionUsageSummary
  metaThreadId?: string
}

export function createSession(workspaceRoot: string, codexCommand: string): StackLocalSession {
  return {
    id: randomUUID(),
    workspaceRoot,
    startedAt: new Date().toISOString(),
    codexCommand,
    harness: inferSessionHarness(codexCommand),
    turns: [],
  }
}

export async function readSessionLog(path: string): Promise<StackLocalSession> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as StackLocalSession
  for (const turn of parsed.turns ?? []) {
    turn.usage ??= readUsageFromStdout(turn.stdout)
  }
  return parsed
}

export async function listSessionHistory(
  sessionLogDir: string,
  pricingRows?: readonly CodexModelPricing[],
): Promise<StackSessionSummary[]> {
  let entries: string[]
  try {
    entries = await readdir(sessionLogDir)
  } catch {
    return []
  }

  const summaries = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map(async (entry): Promise<StackSessionSummary | undefined> => {
        const path = join(sessionLogDir, entry)
        try {
          const [session, info] = await Promise.all([readSessionLog(path), stat(path)])
          const lastTurn = session.turns.at(-1)
          const model = session.codexModel ?? inferCodexModel(session.codexCommand)
          const usageSummary =
            session.usageSummary ??
            (model ? buildSessionUsageSummary(session.turns, model, pricingRows) : undefined)
          return {
            id: session.id,
            path,
            startedAt: session.startedAt,
            updatedAt: info.mtime.toISOString(),
            turnCount: session.turns.length,
            lastPrompt: lastTurn?.prompt,
            displayName: session.displayName,
            usageSummary,
            metaThreadId: session.metaThreadId,
          }
        } catch {
          return undefined
        }
      }),
  )

  return summaries
    .filter((summary): summary is StackSessionSummary => Boolean(summary))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export async function listSessionHistoryFromDirs(
  sessionLogDirs: readonly string[],
  pricingRows?: readonly CodexModelPricing[],
): Promise<StackSessionSummary[]> {
  const merged: StackSessionSummary[] = []
  for (const sessionLogDir of sessionLogDirs) {
    merged.push(...(await listSessionHistory(sessionLogDir, pricingRows)))
  }
  return mergeSessionSummaries(merged)
}

export function mergeSessionSummaries(summaries: readonly StackSessionSummary[]): StackSessionSummary[] {
  const byId = new Map<string, StackSessionSummary>()
  for (const summary of summaries) {
    const existing = byId.get(summary.id)
    if (!existing || summary.updatedAt.localeCompare(existing.updatedAt) > 0) {
      byId.set(summary.id, {
        ...summary,
        displayName: summary.displayName ?? existing?.displayName,
      })
      continue
    }
    if (!existing.displayName && summary.displayName) {
      byId.set(summary.id, { ...existing, displayName: summary.displayName })
    }
  }
  return [...byId.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export function currentSessionSummary(
  session: StackLocalSession,
  sessionLogDir: string,
  codexModel: string,
  pricingRows?: readonly CodexModelPricing[],
): StackSessionSummary {
  const lastTurn = session.turns.at(-1)
  const model = session.codexModel ?? codexModel
  return {
    id: session.id,
    path: join(sessionLogDir, `${session.id}.json`),
    startedAt: session.startedAt,
    updatedAt: new Date().toISOString(),
    turnCount: session.turns.length,
    lastPrompt: lastTurn?.prompt,
    displayName: session.displayName,
    usageSummary:
      session.usageSummary ??
      (model ? buildSessionUsageSummary(session.turns, model, pricingRows) : undefined),
    metaThreadId: session.metaThreadId,
  }
}

export function ensureSessionInHistory(
  history: readonly StackSessionSummary[],
  session: StackLocalSession,
  sessionLogDir: string,
  codexModel: string,
  pricingRows?: readonly CodexModelPricing[],
): StackSessionSummary[] {
  if (history.some((summary) => summary.id === session.id)) {
    return mergeSessionSummaries([...history, currentSessionSummary(session, sessionLogDir, codexModel, pricingRows)])
  }
  return mergeSessionSummaries([
    currentSessionSummary(session, sessionLogDir, codexModel, pricingRows),
    ...history,
  ])
}

export function pinGardenerThreadToTop(
  history: readonly StackSessionSummary[],
  gardenerThreadId: string,
): StackSessionSummary[] {
  const gardenerIndex = history.findIndex((summary) => summary.id === gardenerThreadId)
  if (gardenerIndex <= 0) return [...history]
  const gardener = history[gardenerIndex]
  return [gardener, ...history.filter((summary) => summary.id !== gardenerThreadId)]
}

export async function writeSessionLog(
  session: StackLocalSession,
  sessionLogDir: string,
  options?: { codexModel?: string; pricingRows?: readonly CodexModelPricing[] },
): Promise<string> {
  await mkdir(sessionLogDir, { recursive: true })
  if (options?.codexModel) session.codexModel = options.codexModel
  const model = session.codexModel ?? inferCodexModel(session.codexCommand)
  session.usageSummary = model ? buildSessionUsageSummary(session.turns, model, options?.pricingRows) : undefined
  const path = join(sessionLogDir, `${session.id}.json`)
  await writeFile(path, `${JSON.stringify(session, null, 2)}\n`, "utf8")
  return path
}

export function readUsageFromStdout(stdout: string): StackCodexUsage | undefined {
  let usage: StackCodexUsage | undefined
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }

    usage = readUsageFromCodexEvent(record) ?? usage
  }
  return usage
}

export function readUsageFromCodexEvent(event: unknown): StackCodexUsage | undefined {
  const record = asRecord(event)
  if (!record) return undefined

  const payload = asRecord(record.payload)
  if ((record.type === "event_msg" || record.type === "response_item") && payload) {
    return readUsageFromCodexEvent(payload)
  }

  if (record.type === "turn.completed") return readUsageRecord(asRecord(record.usage))

  if (record.type === "token_count") {
    const info = asRecord(record.info)
    return (
      readUsageRecord(asRecord(info?.total_token_usage)) ??
      readUsageRecord(asRecord(info?.last_token_usage)) ??
      readUsageRecord(asRecord(record.usage))
    )
  }

  return undefined
}

function readUsageRecord(usage: Record<string, unknown> | undefined): StackCodexUsage | undefined {
  if (!usage) return undefined
  const parsed = {
    inputTokens: readNumber(usage.input_tokens ?? usage.inputTokens),
    cachedInputTokens: readNumber(usage.cached_input_tokens ?? usage.cachedInputTokens),
    outputTokens: readNumber(usage.output_tokens ?? usage.outputTokens),
    reasoningOutputTokens: readNumber(usage.reasoning_output_tokens ?? usage.reasoningOutputTokens),
  }
  return Object.values(parsed).some((value) => value !== undefined) ? parsed : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}

function inferCodexModel(codexCommand: string): string | undefined {
  const match = codexCommand.match(/(?:^|\s)-m\s+(\S+)/)
  return match?.[1]
}

function inferSessionHarness(command: string): StackSessionHarness {
  return /(?:^|\/|\s)cursor(?:\s|$)/.test(command) ? "cursor" : "codex"
}
