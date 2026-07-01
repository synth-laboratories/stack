import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { CodexGoalSnapshot } from "./codex/goal-context.js"
import { codexAuthLedgerSummaryLines } from "./codex/auth-ledger.js"
import {
  refreshCodexArgs,
  setCodexModel,
  setCodexReasoningEffort,
  type StackConfig,
} from "./config.js"
import type { CodexModelPricing } from "./codex/usage-cost.js"
import { createSession, listSessionHistory, writeSessionLog, type StackCodexTurn, type StackLocalSession, type StackSessionSummary } from "./session.js"
import { resolveThreadDisplayLabel } from "./thread-display-name.js"
import {
  gardenerHarnessLabel as gardenerHarnessLabelFromConfig,
  loadGardenerConfig,
  type StackGardenerConfig,
} from "./gardener-config.js"
import {
  appendThreadMetaEvent,
  readThreadMetaEvents,
  stackEventId,
  threadEventLogPath,
  type StackThreadMetaEvent,
} from "./thread-events.js"

export type { StackGardenerConfig } from "./gardener-config.js"
export { DEFAULT_GARDENER_CONFIG, loadGardenerConfig } from "./gardener-config.js"

/** @deprecated Use loadGardenerConfig(stackRoot).model.model */
export function gardenerCodexModel(stackRoot: string): string {
  return loadGardenerConfig(stackRoot).model.model
}

/** @deprecated Use loadGardenerConfig(stackRoot).model.reasoningEffort */
export function gardenerCodexEffort(stackRoot: string): string {
  return loadGardenerConfig(stackRoot).model.reasoningEffort
}

export function gardenerHarnessLabel(stackRootOrConfig: string | StackGardenerConfig): string {
  const config = typeof stackRootOrConfig === "string"
    ? loadGardenerConfig(stackRootOrConfig)
    : stackRootOrConfig
  return gardenerHarnessLabelFromConfig(config)
}

export type WorkerHarnessSnapshot = {
  codexModel: string
  codexReasoningEffort: string
}

export function snapshotWorkerHarness(config: StackConfig): WorkerHarnessSnapshot {
  return {
    codexModel: config.codexModel,
    codexReasoningEffort: config.codexReasoningEffort,
  }
}

export function restoreWorkerHarness(config: StackConfig, snapshot: WorkerHarnessSnapshot): void {
  setCodexModel(config, snapshot.codexModel)
  setCodexReasoningEffort(config, snapshot.codexReasoningEffort)
  refreshCodexArgs(config)
}

export function applyGardenerHarnessToConfig(config: StackConfig, gardenerConfig?: StackGardenerConfig): void {
  const resolved = gardenerConfig ?? loadGardenerConfig(config.stackDataRoot)
  setCodexModel(config, resolved.model.model)
  setCodexReasoningEffort(config, resolved.model.reasoningEffort)
  refreshCodexArgs(config)
}

export function restoreSessionHarnessToConfig(config: StackConfig, session: StackLocalSession): void {
  if (session.codexModel) setCodexModel(config, session.codexModel)
  refreshCodexArgs(config)
}

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

export type GardenerThreadRegistry = {
  schema: "stack/gardener-thread/v1"
  thread_id: string
  created_at: string
}

export type EnsureGardenerThreadInput = {
  stackRoot: string
  sessionLogDir: string
  workspaceRoot: string
  codexCommand: string
  codexModel?: string
  pricingRows?: readonly CodexModelPricing[]
}

export type EnsureGardenerThreadResult = {
  threadId: string
  created: boolean
  sessionPath: string
}

export function gardenerThreadRegistryPath(stackRoot: string): string {
  return join(stackRoot, ".stack", "garden", "gardener-thread.json")
}

export function gardenerThreadDocPath(stackRoot: string, threadId: string): string {
  return join(stackRoot, ".stack", "garden", "threads", `${safeThreadId(threadId)}.md`)
}

export function readGardenerThreadRegistry(stackRoot: string): GardenerThreadRegistry | undefined {
  const path = gardenerThreadRegistryPath(stackRoot)
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as GardenerThreadRegistry
    if (parsed.schema !== "stack/gardener-thread/v1") return undefined
    if (!parsed.thread_id?.trim()) return undefined
    return parsed
  } catch {
    return undefined
  }
}

export function writeGardenerThreadRegistry(stackRoot: string, registry: GardenerThreadRegistry): void {
  const path = gardenerThreadRegistryPath(stackRoot)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(registry, null, 2)}\n`, "utf8")
}

export function isGardenerThread(stackRoot: string, threadId: string): boolean {
  const registry = readGardenerThreadRegistry(stackRoot)
  return registry?.thread_id === threadId
}

export async function ensureGardenerThread(input: EnsureGardenerThreadInput): Promise<EnsureGardenerThreadResult> {
  const registry = readGardenerThreadRegistry(input.stackRoot)
  if (registry?.thread_id) {
    const sessionPath = join(input.sessionLogDir, `${registry.thread_id}.json`)
    if (existsSync(sessionPath)) {
      return { threadId: registry.thread_id, created: false, sessionPath }
    }
  }

  const adopted = await adoptRegisteredGardenerSession(input)
  if (adopted) return adopted

  const gardenerConfig = loadGardenerConfig(input.stackRoot)
  const session = createSession(input.workspaceRoot, input.codexCommand)
  session.role = "gardener"
  session.codexModel = gardenerConfig.model.model
  const sessionPath = await writeSessionLog(session, input.sessionLogDir, {
    codexModel: gardenerConfig.model.model,
    pricingRows: input.pricingRows,
  })

  writeGardenerThreadRegistry(input.stackRoot, {
    schema: "stack/gardener-thread/v1",
    thread_id: session.id,
    created_at: session.startedAt,
  })

  const gardenPath = rewriteThreadGardenDoc({
    stackRoot: input.stackRoot,
    session,
    workerStatus: "idle",
    goalContext: { objective: undefined, source: "none" },
    inboxPending: 0,
    workerQueueCount: 0,
  })

  appendThreadMetaEvent(input.stackRoot, {
    event_id: stackEventId("gardener_thread"),
    type: "gardener.thread_registered",
    thread_id: session.id,
    observed_at: session.startedAt,
    actor_id: "gardener",
    actor_role: "system",
    payload: {
      session_path: sessionPath,
      garden_path: gardenPath,
    },
  })

  return { threadId: session.id, created: true, sessionPath }
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
  options?: { source?: string; dispatchKind?: "route" | "steer" | "queue" },
): GardenerInboxItem {
  const trimmed = message.trim()
  if (!trimmed) throw new Error("gardener inbox message must not be empty")
  const parsed = parseGardenerDispatchKind(trimmed)
  const item: GardenerInboxItem = {
    id: stackEventId("gardener_inbox"),
    message: parsed.body || trimmed,
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
      dispatch_kind: options?.dispatchKind ?? parsed.kind,
      ...(options?.source ? { source: options.source } : {}),
    },
  })
  return item
}

export function dismissGardenerInboxItem(stackRoot: string, threadId: string, item: GardenerInboxItem): void {
  appendThreadMetaEvent(stackRoot, {
    event_id: stackEventId("gardener_dismissed"),
    type: "gardener.dismissed",
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

function parseGardenerDispatchKind(message: string): { kind: "route" | "steer" | "queue"; body: string } {
  const trimmed = message.trim()
  if (trimmed.startsWith("steer ")) return { kind: "steer", body: trimmed.slice("steer ".length).trim() }
  if (trimmed.startsWith("queue ")) return { kind: "queue", body: trimmed.slice("queue ".length).trim() }
  if (trimmed.startsWith("route ")) return { kind: "route", body: trimmed.slice("route ".length).trim() }
  if (trimmed.startsWith("worker ")) return { kind: "route", body: trimmed.slice("worker ".length).trim() }
  return { kind: "route", body: trimmed }
}

export type GardenerSubmitIntent =
  | { mode: "chat"; body: string }
  | { mode: "route" | "steer" | "queue"; body: string }
  | { mode: "skill_register"; body: string }
  | { mode: "skill_suggest"; body: string }

/** Normal messages chat with the gardener agent; route/steer/queue/worker dispatch workers; skill register/suggest always allowed via stackd. */
export function gardenerSubmitIntent(message: string): GardenerSubmitIntent {
  const trimmed = message.trim()
  if (trimmed.toLowerCase().startsWith("skill register ")) {
    return { mode: "skill_register", body: trimmed }
  }
  if (trimmed.toLowerCase().startsWith("skill suggest ")) {
    return { mode: "skill_suggest", body: trimmed }
  }
  if (trimmed.startsWith("steer ")) return { mode: "steer", body: trimmed.slice("steer ".length).trim() }
  if (trimmed.startsWith("queue ")) return { mode: "queue", body: trimmed.slice("queue ".length).trim() }
  if (trimmed.startsWith("route ")) return { mode: "route", body: trimmed.slice("route ".length).trim() }
  if (trimmed.startsWith("worker ")) return { mode: "route", body: trimmed.slice("worker ".length).trim() }
  return { mode: "chat", body: trimmed }
}

export function appendGardenerChatMessage(
  stackRoot: string,
  threadId: string,
  role: "user" | "gardener",
  message: string,
  options?: { source?: string },
): void {
  appendThreadMetaEvent(stackRoot, {
    event_id: stackEventId("gardener_message"),
    type: "gardener.message",
    thread_id: threadId,
    observed_at: new Date().toISOString(),
    actor_id: role === "user" ? "operator" : "gardener",
    actor_role: role === "user" ? "primary" : "system",
    payload: {
      role,
      message,
      ...(options?.source ? { source: options.source } : {}),
    },
  })
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

export function gardenerWorkspaceDocPath(stackRoot: string): string {
  return join(stackRoot, ".stack", "garden", "workspace.md")
}

export function rewriteWorkspaceGardenDoc(input: {
  stackRoot: string
  gardenerThreadId: string
  workerTargetId?: string
  workerSummaries: readonly StackSessionSummary[]
  liveMetaThreadCount?: number
  inboxPending: number
  workerStatus?: string
  workerQueueCount?: number
  codexAccountEmail?: string
}): string {
  const path = gardenerWorkspaceDocPath(input.stackRoot)
  const workers = input.workerSummaries.filter((summary) => summary.id !== input.gardenerThreadId).slice(0, 12)
  const lines = [
    "# Workspace garden",
    "",
    `updated: ${new Date().toISOString()}`,
    `gardener_thread: ${input.gardenerThreadId}`,
    ...(input.workerTargetId ? [`worker_target: ${input.workerTargetId}`] : []),
    `threads_live: ${workers.length}`,
    ...(input.liveMetaThreadCount !== undefined ? [`meta_threads_live: ${input.liveMetaThreadCount}`] : []),
    `inbox_pending: ${input.inboxPending}`,
    ...(input.workerStatus ? [`worker_status: ${input.workerStatus}`] : []),
    ...(input.workerQueueCount !== undefined ? [`worker_queue: ${input.workerQueueCount}`] : []),
  ]
  if (input.codexAccountEmail) lines.push(`codex_email: ${input.codexAccountEmail}`)
  if (workers.length > 0) {
    lines.push("", "## Live threads")
    for (const summary of workers) {
      const prompt = resolveThreadDisplayLabel(summary, { maxLength: 48 })
      lines.push(`- ${summary.id.slice(0, 8)} · ${summary.turnCount} turns · ${prompt}`)
    }
  }
  const authLines = codexAuthLedgerSummaryLines(input.stackRoot, 3)
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
  gardenerThreadId?: string
  workerSummaries?: readonly StackSessionSummary[]
  workerTargetId?: string
}): GardenerAfterTurnResult {
  const gardenerId =
    input.gardenerThreadId ?? readGardenerThreadRegistry(input.config.stackDataRoot)?.thread_id ?? input.session.id
  const inbox = readGardenerInbox(input.config.stackDataRoot, gardenerId)
  const gardenPath = rewriteThreadGardenDoc({
    stackRoot: input.config.stackDataRoot,
    session: input.session,
    workerStatus: input.workerStatus,
    goalContext: input.goalContext,
    inboxPending: inbox.length,
    workerQueueCount: input.workerQueueCount,
    codexAccountEmail: input.codexAccountEmail,
  })
  appendThreadMetaEvent(input.config.stackDataRoot, {
    event_id: stackEventId("gardener_garden"),
    type: "gardener.garden_updated",
    thread_id: input.session.id,
    observed_at: new Date().toISOString(),
    actor_id: "gardener",
    actor_role: "system",
    payload: {
      path: gardenPath,
      turn_count: input.session.turns.length,
      gardener_thread_id: gardenerId,
    },
  })

  const gardenerConfig = loadGardenerConfig(input.config.stackDataRoot)
  const frictions = detectTurnFrictions(input.turn, input.session, gardenerConfig)
  for (const friction of frictions) {
    appendThreadMetaEvent(input.config.stackDataRoot, {
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

  if (input.workerSummaries) {
    rewriteWorkspaceGardenDoc({
      stackRoot: input.config.stackDataRoot,
      gardenerThreadId: gardenerId,
      workerTargetId: input.workerTargetId ?? input.session.id,
      workerSummaries: input.workerSummaries,
      inboxPending: inbox.length,
      workerStatus: input.workerStatus,
      workerQueueCount: input.workerQueueCount,
      codexAccountEmail: input.codexAccountEmail,
    })
  }

  return { gardenPath, frictions: frictions.map((entry) => entry.summary) }
}

export function recordGardenerWorkerDispatch(
  stackRoot: string,
  gardenerThreadId: string,
  workerThreadId: string,
  message: string,
  options?: { inboxId?: string; kind?: "route" | "steer" | "queue" },
): void {
  appendThreadMetaEvent(stackRoot, {
    event_id: stackEventId("gardener_dispatch"),
    type: "gardener.dispatched",
    thread_id: gardenerThreadId,
    observed_at: new Date().toISOString(),
    actor_id: "gardener",
    actor_role: "system",
    payload: {
      worker_thread_id: workerThreadId,
      message,
      kind: options?.kind ?? "route",
      ...(options?.inboxId ? { inbox_id: options.inboxId } : {}),
    },
  })
}

export function gardenerPanelLines(input: {
  stackRoot: string
  threadId: string
  workerStatus: string
  talkToGardener: boolean
  inbox: GardenerInboxItem[]
  selectedIndex: number
  workerQueueCount: number
  workerTargetLabel?: string
  workerTargetStatus?: string
  lastGardenRewrite?: string
  authSwapHint?: string
  workspaceGardenPath?: string
  gardenPath?: string
}): string[] {
  const lines = [
    "Gardener",
    input.talkToGardener ? "  talk mode ON · enter sends to inbox" : "  talk mode off · G toggles · /g msg",
    input.workerTargetLabel
      ? `  target ${input.workerTargetLabel}${input.workerTargetStatus ? ` · ${input.workerTargetStatus}` : ""}`
      : `  worker ${input.workerStatus}${input.workerQueueCount > 0 ? ` · queue ${input.workerQueueCount}` : ""}`,
  ]
  if (input.lastGardenRewrite) {
    lines.push(`  garden updated ${formatGardenAge(input.lastGardenRewrite)}`)
  }
  if (input.authSwapHint) {
    lines.push(`  auth ${truncateOneLine(input.authSwapHint, 58)}`)
  }
  if (input.workspaceGardenPath) {
    lines.push(`  workspace ${truncateOneLine(input.workspaceGardenPath.replace(input.stackRoot, "."), 52)}`)
  }
  if (input.gardenPath) {
    lines.push(`  thread ${truncateOneLine(input.gardenPath.replace(input.stackRoot, "."), 52)}`)
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
  lines.push("", "enter route · a route all · w target · d dismiss · j/k select")
  return lines
}

function formatGardenAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return iso.slice(11, 16)
  if (ms < 60_000) return "just now"
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}

function detectTurnFrictions(
  turn: StackCodexTurn,
  session: StackLocalSession,
  gardenerConfig: StackGardenerConfig,
): Array<{ pattern: string; summary: string; file: string }> {
  const frictions: Array<{ pattern: string; summary: string; file: string }> = []
  if (gardenerConfig.friction.turnExitNonzero && turn.exitCode !== undefined && turn.exitCode !== 0) {
    frictions.push({
      pattern: "turn_exit_nonzero",
      summary: `Codex turn failed with exit ${turn.exitCode}`,
      file: "stack/src/tui/app.ts",
    })
  }
  const combined = `${turn.stdout}\n${turn.stderr}`.toLowerCase()
  if (gardenerConfig.friction.rateLimit && (combined.includes("rate limit") || combined.includes("rate_limit"))) {
    frictions.push({
      pattern: "rate_limit",
      summary: "Codex turn hit rate-limit wording in output",
      file: "stack/src/codex/rate-limits.ts",
    })
  }
  const toolFailCount = (turn.stdout.match(/"type":"tool_error"/g) ?? []).length
  if (gardenerConfig.friction.repeatedToolError && toolFailCount >= 2) {
    frictions.push({
      pattern: "repeated_tool_error",
      summary: `Codex turn logged ${toolFailCount} tool_error events`,
      file: "stack/src/gardener.ts",
    })
  }
  const recentFailures = session.turns.slice(-3).filter((entry) => entry.exitCode !== undefined && entry.exitCode !== 0)
  if (gardenerConfig.friction.consecutiveTurnFailures && recentFailures.length >= 2) {
    frictions.push({
      pattern: "consecutive_turn_failures",
      summary: `${recentFailures.length} of last 3 turns failed`,
      file: "stack/src/tui/app.ts",
    })
  }
  return frictions
}

function recordGardenerFriction(config: StackConfig, summary: string, file: string): void {
  const gardenerConfig = loadGardenerConfig(config.stackDataRoot)
  if (!gardenerConfig.permissions.papercutMirror) return
  const ts = new Date().toISOString()
  const record = `STACK_MEMORY|ts=${ts}|kind=papercut|file=${file}|severity=LOW|source=gardener\n${summary}\n`
  appendGuidancePapercutMirror(config.stackDataRoot, record, { file, summary })
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

async function adoptRegisteredGardenerSession(
  input: EnsureGardenerThreadInput,
): Promise<EnsureGardenerThreadResult | undefined> {
  const summaries = await listSessionHistory(input.sessionLogDir, input.pricingRows)
  const gardenerSessions: Array<{ id: string; path: string; startedAt: string }> = []
  for (const summary of summaries) {
    try {
      const session = JSON.parse(readFileSync(summary.path, "utf8")) as StackLocalSession
      if (session.role !== "gardener") continue
      gardenerSessions.push({ id: session.id, path: summary.path, startedAt: session.startedAt })
    } catch {
      continue
    }
  }
  if (gardenerSessions.length === 0) return undefined
  gardenerSessions.sort((left, right) => left.startedAt.localeCompare(right.startedAt))
  const chosen = gardenerSessions[0]
  writeGardenerThreadRegistry(input.stackRoot, {
    schema: "stack/gardener-thread/v1",
    thread_id: chosen.id,
    created_at: chosen.startedAt,
  })
  return { threadId: chosen.id, created: false, sessionPath: chosen.path }
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

export function threadHasGardenerMarks(
  stackRoot: string,
  threadId: string,
  sessionPath?: string,
): boolean {
  if (existsSync(gardenerThreadDocPath(stackRoot, threadId))) return true
  const eventsPath = threadEventLogPath(stackRoot, threadId)
  if (existsSync(eventsPath)) {
    try {
      if (readFileSync(eventsPath, "utf8").includes('"gardener.')) return true
    } catch {
      // ignore unreadable event logs
    }
  }
  if (sessionPath && existsSync(sessionPath)) {
    try {
      const raw = readFileSync(sessionPath, "utf8")
      if (raw.includes("[gardener]") || raw.includes('"gardener.')) return true
    } catch {
      // ignore unreadable session logs
    }
  }
  return false
}

export function gardenerMetaEventTypes(): string[] {
  return [
    "gardener.queued",
    "gardener.routed",
    "gardener.dismissed",
    "gardener.dispatched",
    "gardener.thread_registered",
    "gardener.garden_updated",
    "gardener.workspace_updated",
    "gardener.maintenance_pass",
    "gardener.friction",
  ]
}

export function isGardenerVisualMetaEvent(event: StackThreadMetaEvent): boolean {
  return gardenerMetaEventTypes().includes(event.type)
}
