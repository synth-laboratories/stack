import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { CodexGoalSnapshot } from "./codex/goal-context.js"
import { codexAuthLedgerSummaryLines } from "./codex/auth-ledger.js"
import type { StackConfig } from "./config.js"
import type { StackCodexTurn, StackLocalSession } from "./session.js"
import {
  appendThreadMetaEvent,
  readThreadMetaEvents,
  stackEventId,
  type StackThreadMetaEvent,
} from "./thread-events.js"

export type GardenerInboxItem = {
  id: string
  message: string
  queuedAt: string
  status: "pending" | "routed" | "dismissed"
}

export type GardenerAfterTurnResult = {
  gardenPath?: string
  frictions: string[]
}

export function gardenerThreadDocPath(stackRoot: string, threadId: string): string {
  return join(stackRoot, ".stack", "garden", "threads", `${safeThreadId(threadId)}.md`)
}

export function readGardenerInbox(stackRoot: string, threadId: string): GardenerInboxItem[] {
  const events = readThreadMetaEvents(stackRoot, threadId).filter((event) => event.type.startsWith("gardener."))
  const items = new Map<string, GardenerInboxItem>()
  for (const event of events) {
    if (event.type === "gardener.queued") {
      const id = readPayloadString(event.payload, "inbox_id")
      const message = readPayloadString(event.payload, "message")
      if (!id || !message) continue
      items.set(id, {
        id,
        message,
        queuedAt: event.observed_at,
        status: "pending",
      })
    }
    if (event.type === "gardener.routed") {
      const id = readPayloadString(event.payload, "inbox_id")
      const existing = id ? items.get(id) : undefined
      if (existing) existing.status = "routed"
    }
    if (event.type === "gardener.dismissed") {
      const id = readPayloadString(event.payload, "inbox_id")
      const existing = id ? items.get(id) : undefined
      if (existing) existing.status = "dismissed"
    }
  }
  return [...items.values()]
    .filter((item) => item.status === "pending")
    .sort((left, right) => left.queuedAt.localeCompare(right.queuedAt))
}

export function enqueueGardenerInbox(
  stackRoot: string,
  threadId: string,
  message: string,
  options?: { source?: string },
): GardenerInboxItem {
  const trimmed = message.trim()
  if (!trimmed) throw new Error("gardener inbox message must not be empty")
  const item: GardenerInboxItem = {
    id: stackEventId("gardener_inbox"),
    message: trimmed,
    queuedAt: new Date().toISOString(),
    status: "pending",
  }
  appendThreadMetaEvent(stackRoot, {
    event_id: stackEventId("gardener_queued"),
    type: "gardener.queued",
    thread_id: threadId,
    observed_at: item.queuedAt,
    actor_id: "gardener",
    actor_role: "system",
    payload: {
      inbox_id: item.id,
      message: item.message,
      ...(options?.source ? { source: options.source } : {}),
    },
  })
  return item
}

export function markGardenerInboxRouted(stackRoot: string, threadId: string, item: GardenerInboxItem): void {
  appendThreadMetaEvent(stackRoot, {
    event_id: stackEventId("gardener_routed"),
    type: "gardener.routed",
    thread_id: threadId,
    observed_at: new Date().toISOString(),
    actor_id: "gardener",
    actor_role: "system",
    payload: {
      inbox_id: item.id,
      message: item.message,
    },
  })
}

export function stripGardenerMessagePrefix(prompt: string): string {
  const trimmed = prompt.trim()
  if (trimmed.startsWith("/gardener ")) return trimmed.slice("/gardener ".length).trim()
  if (trimmed.startsWith("/g ")) return trimmed.slice("/g ".length).trim()
  return trimmed
}

export function isExplicitGardenerPrefix(prompt: string): boolean {
  const trimmed = prompt.trim()
  return trimmed.startsWith("/g ") || trimmed.startsWith("/gardener ")
}

export function rewriteThreadGardenDoc(input: {
  stackRoot: string
  session: StackLocalSession
  workerStatus: string
  goalContext: CodexGoalSnapshot
  inboxPending: number
  workerQueueCount: number
  codexAccountEmail?: string
}): string {
  const path = gardenerThreadDocPath(input.stackRoot, input.session.id)
  const lastTurn = input.session.turns.at(-1)
  const lines = [
    "# Thread garden",
    "",
    `updated: ${new Date().toISOString()}`,
    `session: ${input.session.id}`,
    `workspace: ${input.session.workspaceRoot}`,
    `turns: ${input.session.turns.length}`,
    `status: ${input.workerStatus}`,
    `inbox_pending: ${input.inboxPending}`,
    `worker_queue: ${input.workerQueueCount}`,
  ]
  if (input.session.codexThreadId) lines.push(`codex_thread: ${input.session.codexThreadId}`)
  if (input.codexAccountEmail) lines.push(`codex_email: ${input.codexAccountEmail}`)
  if (input.goalContext.objective) {
    lines.push("", "## Goal", truncateOneLine(input.goalContext.objective, 400))
  }
  if (lastTurn?.prompt) {
    lines.push("", "## Last prompt", truncateOneLine(lastTurn.prompt, 400))
  }
  if (lastTurn?.exitCode !== undefined && lastTurn.exitCode !== 0) {
    lines.push("", "## Last turn", `exit_code: ${lastTurn.exitCode}`)
  }
  const authLines = codexAuthLedgerSummaryLines(input.stackRoot, 2)
  if (authLines.length > 0) {
    lines.push("", "## Codex auth")
    for (const line of authLines.slice(1)) lines.push(line.trim())
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${lines.join("\n")}\n`)
  return path
}

export function runGardenerAfterTurn(input: {
  config: StackConfig
  session: StackLocalSession
  turn: StackCodexTurn
  workerStatus: string
  goalContext: CodexGoalSnapshot
  workerQueueCount: number
  codexAccountEmail?: string
}): GardenerAfterTurnResult {
  const inbox = readGardenerInbox(input.config.appRoot, input.session.id)
  const gardenPath = rewriteThreadGardenDoc({
    stackRoot: input.config.appRoot,
    session: input.session,
    workerStatus: input.workerStatus,
    goalContext: input.goalContext,
    inboxPending: inbox.length,
    workerQueueCount: input.workerQueueCount,
    codexAccountEmail: input.codexAccountEmail,
  })
  appendThreadMetaEvent(input.config.appRoot, {
    event_id: stackEventId("gardener_garden"),
    type: "gardener.garden_updated",
    thread_id: input.session.id,
    observed_at: new Date().toISOString(),
    actor_id: "gardener",
    actor_role: "system",
    payload: {
      path: gardenPath,
      turn_count: input.session.turns.length,
    },
  })

  const frictions = detectTurnFrictions(input.turn, input.session)
  for (const friction of frictions) {
    appendThreadMetaEvent(input.config.appRoot, {
      event_id: stackEventId("gardener_friction"),
      type: "gardener.friction",
      thread_id: input.session.id,
      observed_at: new Date().toISOString(),
      actor_id: "gardener",
      actor_role: "system",
      payload: {
        pattern: friction.pattern,
        summary: friction.summary,
      },
    })
    recordGardenerFriction(input.config, friction.summary, friction.file)
  }

  return { gardenPath, frictions: frictions.map((entry) => entry.summary) }
}

export function gardenerPanelLines(input: {
  stackRoot: string
  threadId: string
  workerStatus: string
  talkToGardener: boolean
  inbox: GardenerInboxItem[]
  selectedIndex: number
  workerQueueCount: number
  gardenPath?: string
  voiceStatusLine?: string
  voiceRecording?: boolean
  voiceTranscribing?: boolean
}): string[] {
  const lines = [
    "Gardener",
    input.talkToGardener ? "  talk mode ON · enter sends to inbox" : "  talk mode off · G toggles · /g msg",
    `  worker ${input.workerStatus}${input.workerQueueCount > 0 ? ` · queue ${input.workerQueueCount}` : ""}`,
  ]
  if (input.voiceStatusLine) {
    const suffix = input.voiceRecording ? " · recording" : input.voiceTranscribing ? " · transcribing" : ""
    lines.push(`  ${input.voiceStatusLine}${suffix}`)
  }
  if (input.gardenPath) {
    lines.push(`  garden ${truncateOneLine(input.gardenPath.replace(input.stackRoot, "."), 52)}`)
  }
  lines.push("", "Inbox")
  if (input.inbox.length === 0) {
    lines.push("  (empty)")
  } else {
    for (const [index, item] of input.inbox.entries()) {
      const marker = index === clampIndex(input.selectedIndex, input.inbox.length) ? "▸" : " "
      lines.push(` ${marker} ${truncateOneLine(item.message, 46)}`)
    }
  }
  lines.push("", "enter route · a route all · j/k select")
  return lines
}

function detectTurnFrictions(
  turn: StackCodexTurn,
  session: StackLocalSession,
): Array<{ pattern: string; summary: string; file: string }> {
  const frictions: Array<{ pattern: string; summary: string; file: string }> = []
  if (turn.exitCode !== undefined && turn.exitCode !== 0) {
    frictions.push({
      pattern: "turn_exit_nonzero",
      summary: `Codex turn failed with exit ${turn.exitCode}`,
      file: "stack/src/tui/app.ts",
    })
  }
  const combined = `${turn.stdout}\n${turn.stderr}`.toLowerCase()
  if (combined.includes("rate limit") || combined.includes("rate_limit")) {
    frictions.push({
      pattern: "rate_limit",
      summary: "Codex turn hit rate-limit wording in output",
      file: "stack/src/codex/rate-limits.ts",
    })
  }
  const toolFailCount = (turn.stdout.match(/"type":"tool_error"/g) ?? []).length
  if (toolFailCount >= 2) {
    frictions.push({
      pattern: "repeated_tool_error",
      summary: `Codex turn logged ${toolFailCount} tool_error events`,
      file: "stack/src/gardener.ts",
    })
  }
  const recentFailures = session.turns.slice(-3).filter((entry) => entry.exitCode !== undefined && entry.exitCode !== 0)
  if (recentFailures.length >= 2) {
    frictions.push({
      pattern: "consecutive_turn_failures",
      summary: `${recentFailures.length} of last 3 turns failed`,
      file: "stack/src/tui/app.ts",
    })
  }
  return frictions
}

function recordGardenerFriction(config: StackConfig, summary: string, file: string): void {
  if (process.env.STACK_GARDENER_PAPERCUT_MIRROR === "0") return
  const ts = new Date().toISOString()
  const record = `STACK_MEMORY|ts=${ts}|kind=papercut|file=${file}|severity=LOW|source=gardener\n${summary}\n`
  appendGuidancePapercutMirror(config.appRoot, record, { file, summary })
}

function appendGuidancePapercutMirror(
  stackRoot: string,
  block: string,
  dedupe: { file: string; summary: string },
): void {
  const now = new Date()
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`
  const path = join(stackRoot, ".stack", "guidance", "records", "papercuts", `${month}.md`)
  mkdirSync(dirname(path), { recursive: true })
  if (existsSync(path)) {
    const existing = readFileSync(path, "utf8")
    if (existing.includes(`file=${dedupe.file}|`) && existing.includes(`\n${dedupe.summary}\n`)) return
    appendFileSync(path, `\n\n${block.trim()}\n`)
  } else {
    writeFileSync(path, `${block.trim()}\n`)
  }
}

function readPayloadString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function safeThreadId(threadId: string): string {
  const safe = threadId.trim().replace(/[^A-Za-z0-9_.-]/g, "_")
  if (!safe || safe === "." || safe === "..") throw new Error(`invalid thread id: ${threadId}`)
  return safe
}

function truncateOneLine(value: string, max: number): string {
  const oneLine = value.replace(/\s+/g, " ").trim()
  if (oneLine.length <= max) return oneLine
  return `${oneLine.slice(0, Math.max(0, max - 1))}…`
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0
  return Math.max(0, Math.min(index, length - 1))
}

export function gardenerMetaEventTypes(): string[] {
  return ["gardener.queued", "gardener.routed", "gardener.garden_updated", "gardener.friction"]
}

export function isGardenerVisualMetaEvent(event: StackThreadMetaEvent): boolean {
  return gardenerMetaEventTypes().includes(event.type)
}
