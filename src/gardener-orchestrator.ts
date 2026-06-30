import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { codexAuthLedgerSummaryLines } from "./codex/auth-ledger.js"
import type { CodexGoalSnapshot } from "./codex/goal-context.js"
import { searchStackGuidance } from "./codex/guidance.js"
import type { StackConfig } from "./config.js"
import { sessionHistoryScanDirs } from "./config.js"
import {
  gardenerWorkspaceDocPath,
  readGardenerInbox,
  readGardenerThreadRegistry,
  rewriteThreadGardenDoc,
  rewriteWorkspaceGardenDoc,
  type GardenerInboxItem,
} from "./gardener.js"
import {
  listSessionHistoryFromDirs,
  readSessionLog,
  type StackCodexTurn,
  type StackLocalSession,
  type StackSessionSummary,
} from "./session.js"
import { readThreadMetaEvents } from "./thread-events.js"

export type GardenerDispatchKind = "route" | "steer" | "queue"

export type GardenerWorkerTraceDelta = {
  threadId: string
  turnCount: number
  lastPrompt?: string
  lastExitCode?: number
  recentPrompts: string[]
}

export type GardenerMaintenanceInput = {
  config: StackConfig
  gardenerThreadId: string
  workerTargetId?: string
  workerSummaries: readonly StackSessionSummary[]
  workerStatus?: string
  workerQueueCount?: number
  goalContext?: CodexGoalSnapshot
  codexAccountEmail?: string
  wakeReason: "inbox" | "turn_completed" | "idle" | "manual"
}

export type GardenerMaintenanceResult = {
  workspaceGardenPath?: string
  gardenerGardenPath?: string
  inboxPending: number
}

export { gardenerWorkspaceDocPath } from "./gardener.js"

export function parseGardenerDispatchKind(message: string): { kind: GardenerDispatchKind; body: string } {
  const trimmed = message.trim()
  if (trimmed.startsWith("steer ")) return { kind: "steer", body: trimmed.slice("steer ".length).trim() }
  if (trimmed.startsWith("queue ")) return { kind: "queue", body: trimmed.slice("queue ".length).trim() }
  return { kind: "route", body: trimmed }
}

export function composeRoutedWorkerMessage(message: string, guidanceSnippet?: string): string {
  const body = message.trim()
  if (!guidanceSnippet?.trim()) return body
  return [`[gardener context]`, guidanceSnippet.trim(), ``, body].join("\n")
}

export async function listWorkerThreadSummaries(
  config: StackConfig,
  gardenerThreadId: string,
): Promise<StackSessionSummary[]> {
  const summaries = await listSessionHistoryFromDirs(sessionHistoryScanDirs(config), config.codexPricing)
  return summaries.filter((summary) => summary.id !== gardenerThreadId)
}

export async function readWorkerTraceDelta(
  config: StackConfig,
  threadId: string,
  summaries: readonly StackSessionSummary[],
  maxTurns = 3,
): Promise<GardenerWorkerTraceDelta | undefined> {
  const summary = summaries.find((entry) => entry.id === threadId)
  if (!summary) return undefined
  try {
    const session = await readSessionLog(summary.path)
    const recent = session.turns.slice(-maxTurns)
    const last = session.turns.at(-1)
    return {
      threadId,
      turnCount: session.turns.length,
      lastPrompt: last?.prompt,
      lastExitCode: last?.exitCode,
      recentPrompts: recent.map((turn) => turn.prompt).filter(Boolean),
    }
  } catch {
    return undefined
  }
}

export function buildGuidanceSnippetForRoute(
  config: StackConfig,
  message: string,
  options?: { limit?: number },
): string | undefined {
  const terms = message.trim().slice(0, 120)
  if (!terms) return undefined
  const hits = searchStackGuidance(config.stackDataRoot, terms, {
    workspaceRoot: config.workspaceRoot,
    scope: "all",
    limit: options?.limit ?? 2,
    maxExcerptBytes: 280,
  })
  if (hits.length === 0) return undefined
  return hits
    .map((hit) => `- ${hit.title}: ${hit.excerpt.replace(/\s+/g, " ").trim()}`)
    .join("\n")
    .slice(0, 1200)
}

export function lastGardenRewriteAt(stackRoot: string, threadId: string): string | undefined {
  const events = readThreadMetaEvents(stackRoot, threadId)
    .filter((event) => event.type === "gardener.garden_updated" || event.type === "gardener.workspace_updated")
    .at(-1)
  return events?.observed_at
}

export function gardenerAuthSwapHint(stackRoot: string): string | undefined {
  const lines = codexAuthLedgerSummaryLines(stackRoot, 4)
  if (lines.length <= 1) return undefined
  return lines.slice(1).join(" · ")
}

export async function runGardenerMaintenancePass(input: GardenerMaintenanceInput): Promise<GardenerMaintenanceResult> {
  const inbox = readGardenerInbox(input.config.stackDataRoot, input.gardenerThreadId)
  const workerSummaries =
    input.workerSummaries.length > 0
      ? input.workerSummaries
      : await listWorkerThreadSummaries(input.config, input.gardenerThreadId)

  const workspaceGardenPath = rewriteWorkspaceGardenDoc({
    stackRoot: input.config.stackDataRoot,
    gardenerThreadId: input.gardenerThreadId,
    workerTargetId: input.workerTargetId,
    workerSummaries,
    inboxPending: inbox.length,
    workerStatus: input.workerStatus,
    workerQueueCount: input.workerQueueCount,
    codexAccountEmail: input.codexAccountEmail,
  })

  let gardenerGardenPath: string | undefined
  const gardenerSessionPath = join(input.config.sessionLogDir, `${input.gardenerThreadId}.json`)
  if (existsSync(gardenerSessionPath)) {
    try {
      const session = JSON.parse(readFileSync(gardenerSessionPath, "utf8")) as StackLocalSession
      gardenerGardenPath = rewriteThreadGardenDoc({
        stackRoot: input.config.stackDataRoot,
        session,
        workerStatus: input.workerStatus ?? "idle",
        goalContext: input.goalContext ?? { source: "none" },
        inboxPending: inbox.length,
        workerQueueCount: input.workerQueueCount ?? 0,
        codexAccountEmail: input.codexAccountEmail,
      })
    } catch {
      gardenerGardenPath = undefined
    }
  }

  return { workspaceGardenPath, gardenerGardenPath, inboxPending: inbox.length }
}

export function workerSessionStatusFromSummary(summary: StackSessionSummary | undefined): string {
  if (!summary) return "unknown"
  if (!summary.lastPrompt) return "idle"
  return `${summary.turnCount} turns`
}

export function readWorkerSessionStatus(
  summary: StackSessionSummary | undefined,
  activeSessionId: string,
  runtimeStatus: string,
): string {
  if (!summary) return "unknown"
  if (summary.id === activeSessionId) return runtimeStatus
  return workerSessionStatusFromSummary(summary)
}

export function gardenDocMtime(path: string | undefined): string | undefined {
  if (!path || !existsSync(path)) return undefined
  try {
    return statSync(path).mtime.toISOString()
  } catch {
    return undefined
  }
}

export function resolveGardenerThreadId(stackRoot: string, fallback?: string): string | undefined {
  return readGardenerThreadRegistry(stackRoot)?.thread_id ?? fallback
}

export function summarizeTurnForGarden(turn: StackCodexTurn): string {
  return truncateOneLine(turn.prompt, 120)
}

function truncateOneLine(value: string, max: number): string {
  const oneLine = value.replace(/\s+/g, " ").trim()
  if (oneLine.length <= max) return oneLine
  return `${oneLine.slice(0, Math.max(0, max - 1))}…`
}

export function inboxItemDispatchKind(item: GardenerInboxItem, stackRoot: string, gardenerThreadId: string): GardenerDispatchKind {
  const events = readThreadMetaEvents(stackRoot, gardenerThreadId).filter((event) => event.type === "gardener.queued")
  const match = events.find((event) => {
    const payload = event.payload
    return payload.inbox_id === item.id
  })
  const kind = match?.payload.dispatch_kind
  if (kind === "steer" || kind === "queue" || kind === "route") return kind
  return "route"
}
