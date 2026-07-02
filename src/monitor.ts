import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { StackConfig } from "./config.js"
import type { AgentContextSnapshot } from "./codex/agent-context.js"
import type { CodexGoalSnapshot } from "./codex/goal-context.js"
import { parseCriterionEntry } from "./meta-thread-goal-criteria.js"
import {
  buildStyleSteerFromGuidance,
  detectSynthStyleViolations,
  hasSteeredViolationRule,
  severityForStyleViolation,
  steerAllowedForStrictness,
} from "./monitor/style-steer.js"
import { suggestSkillToThread } from "./skill-suggest.js"
import { ensureStackDefaults } from "./seed/defaults.js"
import { stackAppRoot } from "./version.js"
import { estimateUsageSpendUsd, formatEstimatedSpend } from "./codex/usage-cost.js"
import { recordCoreAgentTurnCompleted } from "./core-agent-events.js"
import { detectRiskyPending, riskyPendingSummary } from "./risky-action.js"
import { enrichGoalTaskContext } from "./codex/goal-task-contract.js"
import { runMonitorCodexSidecarChatTurn, runMonitorCodexSidecarTurn } from "./monitor-sidecar-codex.js"
import type { StackCodexTurn, StackLocalSession } from "./session.js"
import { readMetaThreadManifest } from "./meta-thread-goal.js"
import {
  parseThreadNameFromAgentResponse,
  setThreadDisplayName,
} from "./thread-display-name.js"
import {
  actorToolAllowed,
  mergeActorPrompt,
  mergeActorTools,
  parseTomlLike,
  readBoolean,
  readNumber,
  readString,
  readStringArray,
} from "./actor-config.js"
import {
  appendThreadMetaEvent,
  readThreadMetaEvents,
  stackEventId,
  type StackThreadMetaEvent,
} from "./thread-events.js"

export type MonitorStrictness = "off" | "passive" | "conservative" | "aggressive"
export type MonitorFocusName = "style" | "goal_progress" | "skills" | "tool_use" | "scope_control" | "acceptance"
export type MonitorFocusStatus = "pass" | "warn" | "fail" | "disabled"
export type MonitorSeverity = "none" | "low" | "medium" | "high"

export type StackMonitorHandoffPreemptConfig = {
  enabled: boolean
  wakeOnContextPressure: boolean
  contextTokenThreshold: number
  contextFractionThreshold: number
  turnThreshold: number
  idleBeforePreemptMs: number
  minTurnsBeforePreempt: number
  maxPreemptsPerSegment: number
  cooldownMs: number
  requireMetaThread: boolean
  successorRole: string
  successorRoleName: string
  successorModel: string
  successorReasoningEffort: string
  autoSeal: boolean
  autoApprove: boolean
  autoContinue: boolean
  pauseWorkerBeforeSeal: boolean
  segmentPolicyFile: string
}

export type StackMonitorConfig = {
  id: string
  label: string
  enabled: boolean
  mode: string
  policy: string
  strictness: MonitorStrictness
  focusSelection: "any" | "all"
  focus: Record<MonitorFocusName, boolean>
  model: {
    provider: string
    model: string
    reasoningEffort: string
  }
  prompt: {
    system?: string
    systemFile?: string
  }
  wake: {
    maxWakesPerPrimaryTurn: number
    onTurnCompleted: boolean
    onToolCompleted: boolean
    onToolFailed: boolean
    eventBatchSize: number
    eventBatchMinIntervalMs: number
    defaultIntervalMs: number
    staleWorkerIntervalMs: number
    deltaEvents: number
    cooldownMs: number
    weightThreshold: number
    turnCooldownMs: number
    batchCooldownMs: number
    maxDelayMs: number
    policyScript: string
    montyPythonBin: string
  }
  intervention: {
    maxQueuedItemsPerThread: number
    skillContextPush: string
  }
  skills: {
    enabled: boolean
    allowedSkillIds: string[]
    pushWhenConfident: boolean
  }
  tools: {
    allow: string[]
    deny: string[]
  }
  permissions: {
    queue: boolean
    steer: boolean
    skillPush: boolean
    pauseWorker: boolean
    blockBeforeAction: boolean
  }
  handoffPreempt: StackMonitorHandoffPreemptConfig
}

export type StackMonitorSnapshot = {
  enabled: boolean
  actorId: string
  label: string
  runtime: string
  model: string
  reasoningEffort: string
  strictness: MonitorStrictness
  status: "off" | "watching" | "idle" | "running" | "paused" | "summarized" | "queued" | "error"
  lastSummary?: string
  lastSeverity: MonitorSeverity
  lastWakeReason?: string
  lastEventAt?: string
  lastEventId?: string
  lastWakeId?: string
  wakeCount: number
  queuedCount: number
  skillReadCount: number
  contextPushCount: number
  threadSpendUsd?: number
  focusResults: Partial<Record<MonitorFocusName, MonitorFocusStatus>>
  modeSource: "config" | "thread"
}

type FocusCheck = {
  focus: MonitorFocusName
  status: MonitorFocusStatus
  severity: MonitorSeverity
  summary: string
  evidence?: string
}

type SkillContextPushDecision = {
  skillId: string
  reason: string
  evidenceEventIds: string[]
  message: string
}

export type StackMonitorActorRuntimeState = {
  schema: "stack/monitor-actor-state/v1"
  thread_id: string
  monitor_actor_id: string
  monitor_thread_id?: string
  monitor_codex_thread_id?: string
  monitor_codex_waiting_for_restart?: boolean
  monitor_codex_last_pause_reason?: string
  next_wake_on?: string[]
  state: "idle" | "running" | "paused" | "error"
  mode: MonitorStrictness
  strictness: MonitorStrictness
  focus_selection: "any" | "all"
  focus: Record<MonitorFocusName, boolean>
  last_event_id?: string
  last_event_type?: string
  last_wake_id?: string
  rolling_summary?: string
  last_severity?: MonitorSeverity
  wake_counts: number
  queue_counts: number
  steer_counts: number
  skill_read_counts: number
  context_push_counts: number
  last_started_at?: string
  last_completed_at?: string
  last_error_at?: string
  budgets: {
    max_wakes_per_primary_turn: number
  }
  model: {
    provider: string
    model: string
    reasoning_effort: string
  }
}

const DEFAULT_MONITOR_CONFIG: StackMonitorConfig = {
  id: "default",
  label: "Monitor",
  enabled: true,
  mode: "observe_summarize_queue_steer",
  policy: "conservative",
  strictness: "conservative",
  focusSelection: "any",
  focus: {
    style: true,
    goal_progress: true,
    skills: true,
    tool_use: true,
    scope_control: true,
    acceptance: true,
  },
  model: {
    provider: "openai",
    model: "gpt-5.4-mini",
    reasoningEffort: "medium",
  },
  prompt: {
    systemFile: ".stack/monitors/default.system.md",
  },
  wake: {
    maxWakesPerPrimaryTurn: 6,
    onTurnCompleted: true,
    onToolCompleted: true,
    onToolFailed: true,
    eventBatchSize: 4,
    eventBatchMinIntervalMs: 12_000,
    defaultIntervalMs: 90_000,
    staleWorkerIntervalMs: 300_000,
    deltaEvents: 8,
    cooldownMs: 15_000,
    weightThreshold: 6,
    turnCooldownMs: 15_000,
    batchCooldownMs: 60_000,
    maxDelayMs: 120_000,
    policyScript: "scripts/monitor_wake_policy.py",
    montyPythonBin: "python3",
  },
  intervention: {
    maxQueuedItemsPerThread: 8,
    skillContextPush: "queue_or_steer",
  },
  skills: {
    enabled: true,
    allowedSkillIds: ["synth-stack-productivity", "oss-gepa", "hosted-gepa", "synth-ai", "gepa", "stack-agent-bridge", "synth-via-stack"],
    pushWhenConfident: false,
  },
  tools: {
    allow: ["guidance.search", "skills.push_context", "skills.suggest", "monitor.queue", "monitor.steer"],
    deny: ["codex.interrupt"],
  },
  permissions: {
    queue: true,
    steer: true,
    skillPush: true,
    pauseWorker: false,
    blockBeforeAction: false,
  },
  handoffPreempt: {
    enabled: false,
    wakeOnContextPressure: true,
    contextTokenThreshold: 100_000,
    contextFractionThreshold: 0.75,
    turnThreshold: 0,
    idleBeforePreemptMs: 0,
    minTurnsBeforePreempt: 6,
    maxPreemptsPerSegment: 1,
    cooldownMs: 300_000,
    requireMetaThread: true,
    successorRole: "same",
    successorRoleName: "",
    successorModel: "",
    successorReasoningEffort: "",
    autoSeal: true,
    autoApprove: false,
    autoContinue: false,
    pauseWorkerBeforeSeal: true,
    segmentPolicyFile: ".stack/meta-threads/segment-policy.toml",
  },
}

export function ensureDefaultMonitorConfig(stackRoot: string): string {
  ensureStackDefaults(stackRoot, stackAppRoot())
  const dir = join(stackRoot, ".stack", "monitors")
  mkdirSync(dir, { recursive: true })
  const path = join(dir, "default.toml")
  if (!existsSync(path)) {
    writeFileSync(path, `${defaultMonitorToml()}\n`, "utf8")
  }
  const promptPath = join(dir, "default.system.md")
  if (!existsSync(promptPath)) {
    writeFileSync(promptPath, `${defaultMonitorBuiltinPrompt()}\n`, "utf8")
  }
  return path
}

export function loadMonitorConfig(stackRoot: string): StackMonitorConfig {
  const profile = process.env.STACK_MONITOR_PROFILE?.trim() || "default"
  const path = join(stackRoot, ".stack", "monitors", `${profile}.toml`)
  const defaultPath = ensureDefaultMonitorConfig(stackRoot)
  const configPath = profile === "default" ? defaultPath : path
  if (!existsSync(configPath)) {
    throw new Error(`monitor profile not found: ${profile} (${configPath})`)
  }
  const parsed = parseTomlLike(readFileSync(configPath, "utf8"))
  const config = mergeMonitorConfig(DEFAULT_MONITOR_CONFIG, parsed)
  const enabledOverride = process.env.STACK_MONITOR_ENABLED?.trim()
  if (enabledOverride === "0" || enabledOverride === "false") config.enabled = false
  if (enabledOverride === "1" || enabledOverride === "true") config.enabled = true
  const strictnessOverride = process.env.STACK_MONITOR_STRICTNESS?.trim()
  if (strictnessOverride) config.strictness = normalizeStrictness(strictnessOverride, config.strictness)
  assertMonitorProviderSupported(config)
  return config
}

export function emptyMonitorSnapshot(stackRoot: string): StackMonitorSnapshot {
  const config = loadMonitorConfig(stackRoot)
  const effective = effectiveMonitorState(config, [])
  return {
    enabled: effective.enabled,
    actorId: monitorActorId(config),
    label: config.label,
    runtime: "codex-app-server",
    model: config.model.model,
    reasoningEffort: config.model.reasoningEffort,
    strictness: effective.strictness,
    status: effective.enabled ? "watching" : "off",
    lastSeverity: "none",
    wakeCount: 0,
    queuedCount: 0,
    skillReadCount: 0,
    contextPushCount: 0,
    threadSpendUsd: 0,
    focusResults: {},
    modeSource: effective.source,
  }
}

export function refreshMonitorSnapshot(stackRoot: string, threadId: string): StackMonitorSnapshot {
  const config = loadMonitorConfig(stackRoot)
  const events = readThreadMetaEvents(stackRoot, threadId)
  const actorId = monitorActorId(config)
  return snapshotFromEvents(config, events, readMonitorActorState(stackRoot, threadId, actorId))
}

export function isExplicitMonitorPrefix(prompt: string): boolean {
  const trimmed = prompt.trim()
  return /^\/m(?:\s|$)/.test(trimmed) || /^\/monitor(?:\s|$)/.test(trimmed)
}

export function stripMonitorMessagePrefix(prompt: string): string {
  const trimmed = prompt.trim()
  if (trimmed.startsWith("/monitor ")) return trimmed.slice("/monitor ".length).trim()
  if (trimmed.startsWith("/monitor")) return trimmed.slice("/monitor".length).trim()
  return trimmed.replace(/^\/m\s*/, "").trim()
}

export function appendMonitorOperatorMessage(
  stackRoot: string,
  threadId: string,
  message: string,
): StackThreadMetaEvent {
  const config = loadMonitorConfig(stackRoot)
  const event: StackThreadMetaEvent = {
    event_id: stackEventId("monitor_operator"),
    type: "monitor.operator_message",
    thread_id: threadId,
    observed_at: new Date().toISOString(),
    actor_id: "operator",
    actor_role: "primary",
    payload: {
      message,
      source: "operator",
      monitor_actor_id: monitorActorId(config),
    },
  }
  appendThreadMetaEvent(stackRoot, event)
  return event
}

export type SidecarChatContext = {
  current_goal: CodexGoalSnapshot & {
    acceptance_criteria?: string[]
    blockers?: string[]
  }
  criteria_progress: CriteriaProgress
  last_operator_updates: MonitorOperatorUpdate[]
  delta_events: StackThreadMetaEvent[]
  worker_status: "idle" | "running" | "error"
  last_tool_summary?: string
}

export async function runMonitorAfterOperatorMessage(input: {
  config: StackConfig
  session: StackLocalSession
  message: string
  agentContext: AgentContextSnapshot
  goalContext: CodexGoalSnapshot
}): Promise<{ event: StackThreadMetaEvent; snapshot: StackMonitorSnapshot }> {
  const runtimeRoot = monitorRuntimeRoot(input.config)
  const goalContext = enrichGoalTaskContext(input.goalContext, input.config.workspaceRoot)
  const operatorEvent = appendMonitorOperatorMessage(runtimeRoot, input.session.id, input.message)
  if (shouldUseSidecarGoalChat(goalContext)) {
    const requestEvent = appendMonitorChatRequest({
      stackRoot: runtimeRoot,
      session: input.session,
      message: input.message,
      goalContext,
      operatorEventId: operatorEvent.event_id,
    })
    await appendMonitorChatReply({
      stackConfig: input.config,
      stackRoot: runtimeRoot,
      session: input.session,
      message: input.message,
      goalContext,
      requestEvent,
    })
    return {
      event: requestEvent,
      snapshot: refreshMonitorSnapshot(runtimeRoot, input.session.id),
    }
  }
  const snapshot = await runMonitorForNewEvents({
    config: input.config,
    session: input.session,
    agentContext: input.agentContext,
    goalContext,
    wakeReason: "operator_message",
    triggerEventIds: [operatorEvent.event_id],
  })
  return { event: operatorEvent, snapshot }
}

function shouldUseSidecarGoalChat(goalContext: CodexGoalSnapshot): boolean {
  if (!goalContext.objective?.trim()) return false
  const status = goalContext.status?.trim().toLowerCase()
  return !status || status === "active" || status === "blocked"
}

function appendMonitorChatRequest(input: {
  stackRoot: string
  session: StackLocalSession
  message: string
  goalContext: CodexGoalSnapshot
  operatorEventId: string
}): StackThreadMetaEvent {
  const events = readThreadMetaEvents(input.stackRoot, input.session.id)
  const context = buildSidecarChatContext(input.goalContext, events)
  const event: StackThreadMetaEvent = {
    event_id: stackEventId("monitor_chat_request"),
    type: "monitor.chat.request",
    thread_id: input.session.id,
    observed_at: new Date().toISOString(),
    actor_id: "operator",
    actor_role: "primary",
    meta_thread_id: input.session.metaThreadId,
    segment_id: input.session.segmentId,
    payload: {
      message: input.message,
      goal_mode: true,
      operator_event_id: input.operatorEventId,
      sidecar_context: serializableSidecarChatContext(context),
    },
  }
  appendThreadMetaEvent(input.stackRoot, event)
  return event
}

async function appendMonitorChatReply(input: {
  stackConfig: StackConfig
  stackRoot: string
  session: StackLocalSession
  message: string
  goalContext: CodexGoalSnapshot
  requestEvent: StackThreadMetaEvent
}): Promise<StackThreadMetaEvent> {
  const events = readThreadMetaEvents(input.stackRoot, input.session.id)
  const context = buildSidecarChatContext(input.goalContext, events)
  const monitorConfig = loadMonitorConfig(input.stackConfig.appRoot)
  const actorId = monitorActorId(monitorConfig)
  const actorState = readMonitorActorState(input.stackRoot, input.session.id, actorId)
  const reply = await runMonitorSidecarChatReply({
    stackConfig: input.stackConfig,
    stackRoot: input.stackRoot,
    config: monitorConfig,
    actorState,
    question: input.message,
    requestEvent: input.requestEvent,
    goalContext: input.goalContext,
    context,
  })
  const event: StackThreadMetaEvent = {
    event_id: stackEventId("monitor_chat_reply"),
    type: "monitor.chat.reply",
    thread_id: input.session.id,
    observed_at: new Date().toISOString(),
    actor_id: actorId,
    actor_role: "monitor",
    meta_thread_id: input.session.metaThreadId,
    segment_id: input.session.segmentId,
    payload: {
      request_event_id: input.requestEvent.event_id,
      question: input.message,
      answer: reply.answer,
      cited_event_ids: reply.citedEventIds,
      criteria_refs: reply.criteriaRefs,
      operator_update: reply.operatorUpdate ?? context.last_operator_updates.at(-1) ?? null,
      source: reply.source,
      sidecar_context: {
        criteria_progress: context.criteria_progress,
        worker_status: context.worker_status,
        last_tool_summary: context.last_tool_summary ?? null,
      },
    },
  }
  appendThreadMetaEvent(input.stackRoot, event)
  if (reply.monitorCodexThreadId) {
    writeMonitorActorState(input.stackRoot, actorStateFromConfig(monitorConfig, input.session.id, {
      previous: actorState,
      state: "idle",
      monitorCodexThreadId: reply.monitorCodexThreadId,
      monitorCodexWaitingForRestart: true,
      monitorCodexLastPauseReason: reply.answer,
      rollingSummary: reply.operatorUpdate?.progress_note ?? reply.answer,
      lastCompletedAt: event.observed_at,
    }))
  }
  return event
}

type SidecarChatReplyResult = {
  answer: string
  citedEventIds: string[]
  criteriaRefs: number[]
  operatorUpdate?: MonitorOperatorUpdate
  source: "codex-app-server"
  monitorCodexThreadId?: string
}

async function runMonitorSidecarChatReply(input: {
  stackConfig: StackConfig
  stackRoot: string
  config: StackMonitorConfig
  actorState?: StackMonitorActorRuntimeState
  question: string
  requestEvent: StackThreadMetaEvent
  goalContext: CodexGoalSnapshot
  context: SidecarChatContext
}): Promise<SidecarChatReplyResult> {
  const codex = await runMonitorCodexSidecarChatTurn({
    stackConfig: input.stackConfig,
    monitorConfig: input.config,
    threadId: input.requestEvent.thread_id,
    actorId: monitorActorId(input.config),
    codexThreadId: input.actorState?.monitor_codex_thread_id,
    question: input.question,
    requestEventId: input.requestEvent.event_id,
    goalContext: input.goalContext,
    sidecarContext: serializableSidecarChatContext(input.context),
  })
  const answer = codex.assistantText?.trim()
  if (!answer) {
    throw new Error("Codex sidecar chat completed without an assistant message")
  }
  return {
    answer,
    citedEventIds: [input.requestEvent.event_id],
    criteriaRefs: [],
    source: "codex-app-server",
    monitorCodexThreadId: codex.codexThreadId,
  }
}

function buildSidecarChatContext(
  goalContext: CodexGoalSnapshot,
  events: StackThreadMetaEvent[],
): SidecarChatContext {
  const deltaEvents = recentSidecarDeltaEvents(events)
  return {
    current_goal: {
      ...goalContext,
      acceptance_criteria: goalContext.acceptanceCriteria,
      blockers: goalContext.blockers,
    },
    criteria_progress: criteriaProgressFromGoal(goalContext),
    last_operator_updates: lastOperatorUpdates(events, 5),
    delta_events: deltaEvents,
    worker_status: workerStatusFromEvents(events),
    last_tool_summary: lastToolSummary(deltaEvents),
  }
}

function serializableSidecarChatContext(context: SidecarChatContext): Record<string, unknown> {
  return {
    current_goal: context.current_goal,
    criteria_progress: context.criteria_progress,
    last_operator_updates: context.last_operator_updates,
    delta_events: context.delta_events.map((event) => ({
      event_id: event.event_id,
      type: event.type,
      observed_at: event.observed_at,
      actor_role: event.actor_role,
      payload: boundedPayload(event.payload),
    })),
    worker_status: context.worker_status,
    last_tool_summary: context.last_tool_summary ?? null,
  }
}

function recentSidecarDeltaEvents(events: StackThreadMetaEvent[]): StackThreadMetaEvent[] {
  return events
    .filter((event) => !event.type.startsWith("monitor.checkpoint"))
    .filter((event) => event.type.startsWith("agent.") || event.type === "monitor.summary" || event.type === "monitor.progress")
    .slice(-12)
}

function lastOperatorUpdates(events: StackThreadMetaEvent[], limit: number): MonitorOperatorUpdate[] {
  const updates: MonitorOperatorUpdate[] = []
  for (const event of [...events].reverse()) {
    if (event.type !== "monitor.summary" && event.type !== "monitor.chat.reply") continue
    const update = readOperatorUpdateFromRecord(asRecord(event.payload.operator_update))
    if (update) updates.push(update)
    if (updates.length >= limit) break
  }
  return updates.reverse()
}

function workerStatusFromEvents(events: StackThreadMetaEvent[]): "idle" | "running" | "error" {
  const latest = [...events].reverse().find((event) =>
    event.type === "agent.error" ||
    event.type === "agent.tool.failed" ||
    event.type === "agent.turn.started" ||
    event.type === "agent.turn.completed"
  )
  if (!latest) return "idle"
  if (latest.type === "agent.error" || latest.type === "agent.tool.failed") return "error"
  if (latest.type === "agent.turn.started") return "running"
  return "idle"
}

function lastToolSummary(events: readonly StackThreadMetaEvent[]): string | undefined {
  const event = [...events].reverse().find((entry) =>
    entry.type === "agent.tool.completed" || entry.type === "agent.tool.failed" || entry.type === "agent.error"
  )
  if (!event) return undefined
  const toolName = readString(event.payload.tool_name) ?? event.type.replace(/^agent\./, "")
  const command = readString(event.payload.command)
  const output = readString(event.payload.message) ?? readString(event.payload.stderr) ?? readString(event.payload.output)
  return truncate([toolName, command, output].filter(Boolean).join(" · "), 180)
}

export async function runMonitorAfterTurn(input: {
  config: StackConfig
  session: StackLocalSession
  turn: StackCodexTurn
  agentContext: AgentContextSnapshot
  goalContext: CodexGoalSnapshot
}): Promise<StackMonitorSnapshot> {
  const runtimeRoot = monitorRuntimeRoot(input.config)
  recordCoreAgentTurnCompleted({
    stackRoot: runtimeRoot,
    threadId: input.session.id,
    actorId: "primary_codex",
    metaThreadId: input.session.metaThreadId,
    segmentId: input.session.segmentId,
    turn: input.turn,
  })
  return await runMonitorForNewEvents({
    ...input,
    wakeReason: "turn_completed",
  })
}

export async function runGoalMonitorCadenceTick(input: {
  config: StackConfig
  session: StackLocalSession
  agentContext: AgentContextSnapshot
  goalContext: CodexGoalSnapshot
}): Promise<StackMonitorSnapshot | undefined> {
  if (!goalContextActive(input.goalContext)) return undefined
  if (input.session.metaThreadId) {
    const manifest = await readMetaThreadManifest(input.config.stackDataRoot, input.session.metaThreadId)
    if ((manifest?.lifecycle_status ?? "live") === "archived") return undefined
  }
  const runtimeRoot = monitorRuntimeRoot(input.config)
  const monitorConfig = loadMonitorConfig(input.config.appRoot)
  const threadId = input.session.id
  const events = readThreadMetaEvents(runtimeRoot, threadId)
  const actorId = monitorActorId(monitorConfig)
  const actorState = readMonitorActorState(runtimeRoot, threadId, actorId)
  if (actorState?.state === "running" && hasQueuedTriggerAfterLatestWake(events)) return undefined
  if (!nextWakeAllows(events, actorId, "worker_event")) return undefined
  if (monitorWakeBudgetExhausted(monitorConfig, events, "cadence_tick")) return undefined
  const cadence = cadenceWakeReason(monitorConfig, events, actorState)
  if (!cadence) return undefined
  const now = new Date().toISOString()
  const event: StackThreadMetaEvent = {
    event_id: stackEventId("agent_worker_heartbeat"),
    type: "agent.worker_heartbeat",
    thread_id: threadId,
    observed_at: now,
    actor_id: "primary_codex",
    actor_role: "primary",
    meta_thread_id: input.session.metaThreadId,
    segment_id: input.session.segmentId,
    payload: {
      reason: cadence.reason,
      worker_status: "running",
      pending_worker_event_count: cadence.pendingWorkerEventCount,
      elapsed_since_last_worker_event_ms: cadence.elapsedSinceLastWorkerEventMs,
      elapsed_since_last_monitor_wake_ms: cadence.elapsedSinceLastMonitorWakeMs,
      source: "tui-cadence",
    },
  }
  appendThreadMetaEvent(runtimeRoot, event)
  return await runMonitorForNewEvents({
    config: input.config,
    session: input.session,
    agentContext: input.agentContext,
    goalContext: input.goalContext,
    wakeReason: cadence.reason,
    triggerEventIds: [event.event_id],
  })
}

export async function runMonitorForNewEvents(input: {
  config: StackConfig
  session: StackLocalSession
  turn?: StackCodexTurn
  agentContext: AgentContextSnapshot
  goalContext: CodexGoalSnapshot
  wakeReason?: string
  triggerEventIds?: string[]
  drainQueued?: boolean
}): Promise<StackMonitorSnapshot> {
  const runtimeRoot = monitorRuntimeRoot(input.config)
  const monitorConfig = loadMonitorConfig(input.config.appRoot)
  const threadId = input.session.id
  const goalContext = enrichGoalTaskContext(input.goalContext, input.config.workspaceRoot)
  const priorEvents = readThreadMetaEvents(runtimeRoot, threadId)
  const effective = effectiveMonitorState(monitorConfig, priorEvents)
  const actorId = monitorActorId(monitorConfig)
  const actorState = readMonitorActorState(runtimeRoot, threadId, actorId)
  if (!effective.enabled) {
    writeMonitorActorState(runtimeRoot, actorStateFromConfig(monitorConfig, threadId, {
      previous: actorState,
      state: "paused",
      strictness: effective.strictness,
    }))
    return snapshotFromEvents(monitorConfig, priorEvents, readMonitorActorState(runtimeRoot, threadId, actorId))
  }
  monitorConfig.enabled = effective.enabled
  monitorConfig.strictness = effective.strictness

  const candidate = nextWakeCandidate({
    config: monitorConfig,
    actorState,
    events: priorEvents,
    wakeReason: input.wakeReason,
    triggerEventIds: input.triggerEventIds,
  })
  if (!candidate) {
    const refreshed = actorStateFromConfig(monitorConfig, threadId, {
      previous: actorState,
      state: actorState?.state === "running" ? "idle" : actorState?.state,
      strictness: effective.strictness,
    })
    writeMonitorActorState(runtimeRoot, refreshed)
    return snapshotFromEvents(
      monitorConfig,
      readThreadMetaEvents(runtimeRoot, threadId),
      readMonitorActorState(runtimeRoot, threadId, actorId),
    )
  }

  const repeatedSteer = repeatedFailureSteerMessage(candidate.pendingEvents)
  const repeatedSteerSignature = triggerSignature(candidate.pendingEvents)
  if (
    repeatedSteer &&
    candidate.pendingEvents.every((event) => event.type === "agent.tool.failed") &&
    recentSidecarSteerIsSimilar(priorEvents, repeatedSteer, repeatedSteerSignature)
  ) {
    const lastProcessedEvent = candidate.pendingEvents.at(-1)
    writeMonitorActorState(runtimeRoot, actorStateFromConfig(monitorConfig, threadId, {
      previous: actorState,
      state: "idle",
      strictness: effective.strictness,
      lastEventId: lastProcessedEvent?.event_id ?? actorState?.last_event_id,
      lastEventType: lastProcessedEvent?.type ?? actorState?.last_event_type,
      lastCompletedAt: new Date().toISOString(),
      rollingSummary: "NO_USER_UPDATE",
    }))
    return snapshotFromEvents(
      monitorConfig,
      readThreadMetaEvents(runtimeRoot, threadId),
      readMonitorActorState(runtimeRoot, threadId, actorId),
    )
  }

  if (actorState?.state === "running") {
    const alreadyQueued = queuedTriggerEventIds(priorEvents)
    const triggerEventIds = candidate.triggerEventIds.filter((id) => !alreadyQueued.has(id))
    if (triggerEventIds.length > 0) {
      appendThreadMetaEvent(runtimeRoot, {
        event_id: stackEventId("monitor_trigger_queued"),
        type: "monitor.trigger_queued",
        thread_id: threadId,
        observed_at: new Date().toISOString(),
        actor_id: actorId,
        actor_role: "monitor",
        payload: {
          wake_reason: candidate.reason,
          trigger_event_ids: triggerEventIds,
          pending_event_count: candidate.pendingEvents.length,
          running_wake_id: actorState.last_wake_id ?? null,
          last_event_id_before: actorState.last_event_id ?? null,
        },
      })
    }
    return snapshotFromEvents(
      monitorConfig,
      readThreadMetaEvents(runtimeRoot, threadId),
      readMonitorActorState(runtimeRoot, threadId, actorId),
    )
  }

  const observedAt = new Date().toISOString()
  const wakeId = stackEventId("monitor_wake")
  const handoffPreempt = evaluateHandoffPreempt({
    config: monitorConfig,
    session: input.session,
    events: priorEvents,
    pendingEvents: candidate.pendingEvents,
    triggerEventIds: candidate.triggerEventIds,
    wakeReason: candidate.reason,
    observedAt,
  })
  const runningState = actorStateFromConfig(monitorConfig, threadId, {
    previous: actorState,
    state: "running",
    strictness: effective.strictness,
    lastStartedAt: observedAt,
  })
  writeMonitorActorState(runtimeRoot, runningState)

  appendThreadMetaEvent(runtimeRoot, {
    event_id: wakeId,
    type: "monitor.wake",
    thread_id: threadId,
    observed_at: observedAt,
    actor_id: actorId,
    actor_role: "monitor",
    payload: {
      wake_reason: candidate.reason,
      turn_id: input.turn?.id ?? null,
      trigger_event_ids: candidate.triggerEventIds,
      pending_event_count: candidate.pendingEvents.length,
      strictness: monitorConfig.strictness,
      focus_selection: monitorConfig.focusSelection,
      last_event_id_before: actorState?.last_event_id ?? null,
      handoff_preempt: handoffPreempt?.wakePayload ?? null,
    },
  })
  if (handoffPreempt) {
    appendThreadMetaEvent(runtimeRoot, {
      event_id: stackEventId(`monitor_handoff_preempt_${handoffPreempt.status}`),
      type: `monitor.handoff_preempt.${handoffPreempt.status}`,
      thread_id: threadId,
      observed_at: observedAt,
      actor_id: actorId,
      actor_role: "monitor",
      meta_thread_id: input.session.metaThreadId,
      segment_id: input.session.segmentId,
      payload: {
        ...handoffPreempt.eventPayload,
        wake_id: wakeId,
      },
    })
  }

  let pass: MonitorPassResult
  try {
    const turn = input.turn ?? syntheticTurnFromEvents(input.session, candidate.pendingEvents)
    const checks = runFocusChecks(monitorConfig, {
      turn: input.turn ?? syntheticTurnFromEvents(input.session, candidate.pendingEvents),
      agentContext: input.agentContext,
      goalContext,
    })
    pass = await runMonitorPass({
      stackConfig: input.config,
      stackRoot: runtimeRoot,
      config: monitorConfig,
      actorState: runningState,
      threadId,
      wakeId,
      wakeReason: candidate.reason,
      triggerEventIds: candidate.triggerEventIds,
      priorEvents,
      pendingEvents: candidate.pendingEvents,
      turn,
      agentContext: input.agentContext,
      goalContext,
      checks,
    })
  } catch (error) {
    const failedState = actorStateFromConfig(monitorConfig, threadId, {
      previous: runningState,
      state: "error",
      strictness: effective.strictness,
      lastErrorAt: new Date().toISOString(),
    })
    writeMonitorActorState(runtimeRoot, failedState)
    appendThreadMetaEvent(runtimeRoot, {
      event_id: stackEventId("monitor_error"),
      type: "monitor.error",
      thread_id: threadId,
      observed_at: new Date().toISOString(),
      actor_id: actorId,
      actor_role: "monitor",
      payload: {
        wake_id: wakeId,
        message: error instanceof Error ? error.message : String(error),
      },
    })
    return snapshotFromEvents(
      monitorConfig,
      readThreadMetaEvents(runtimeRoot, threadId),
      readMonitorActorState(runtimeRoot, threadId, actorId),
    )
  }

  const monitorSummary = normalizedMonitorSummary(pass.summary)

  appendThreadMetaEvent(runtimeRoot, {
    event_id: stackEventId("monitor_summary"),
    type: "monitor.summary",
    thread_id: threadId,
    observed_at: new Date().toISOString(),
    actor_id: actorId,
    actor_role: "monitor",
    payload: {
      wake_id: wakeId,
      model: monitorConfig.model.model,
      reasoning_effort: monitorConfig.model.reasoningEffort,
      strictness: monitorConfig.strictness,
      severity: pass.severity,
      summary: monitorSummary,
      operator_update: pass.operatorUpdate ?? null,
      goal_snapshot: goalSnapshotFromContext(goalContext),
      focus_results: focusResults(pass.checks),
      source: pass.source,
      model_thread_id: pass.monitorThreadId ?? null,
      monitor_codex_thread_id: pass.monitorCodexThreadId ?? null,
      sidecar_transcript: pass.monitorCodexThreadId ? "codex-app-server" : null,
      evidence: pass.checks.filter((check) => check.evidence).map((check) => ({
        focus: check.focus,
        evidence: check.evidence,
      })),
    },
  })
  // monitor.progress is the HUMAN-facing narration event. It carries ONLY a real update the
  // operator should read — never the generic per-pass checkpoint text and never NO_USER_UPDATE.
  // (monitor.summary above is the internal per-pass checkpoint record; steers ride monitor.steer.)
  const eventsAfterPass = readThreadMetaEvents(runtimeRoot, threadId)
  const directiveProgress = pass.userProgressUpdate ?? pass.operatorUpdate?.progress_note
  ensureAuditedGoalStatusFromWorkerEvents({
    runtimeRoot,
    threadId,
    actorId,
    wakeId,
    observedAt,
    triggerEventIds: candidate.triggerEventIds,
    goalContext,
    allEvents: eventsAfterPass,
    pendingEvents: candidate.pendingEvents,
  })
  ensureAuditedGoalStatusFromSummary({
    runtimeRoot,
    threadId,
    actorId,
    wakeId,
    observedAt,
    triggerEventIds: candidate.triggerEventIds,
    goalContext,
    summary: monitorSummary,
    events: readThreadMetaEvents(runtimeRoot, threadId),
  })
  const eventsAfterGoalStatus = readThreadMetaEvents(runtimeRoot, threadId)
  const humanProgress =
    directiveProgress ??
    goalStatusProgressUpdate(eventsAfterGoalStatus, observedAt)
  if (humanProgress && !isNoUserUpdateText(humanProgress) && !isNoProgressAnnouncement(humanProgress)) {
    const progressSummary = taskAwareProgressSummary(humanProgress, goalContext)
    if (directiveProgress && goalContext.objective && !hasGoalStatusSince(eventsAfterGoalStatus, observedAt)) {
      appendThreadMetaEvent(runtimeRoot, {
        event_id: stackEventId("monitor_goal_status"),
        type: "monitor.goal_status",
        thread_id: threadId,
        observed_at: new Date().toISOString(),
        actor_id: actorId,
        actor_role: "monitor",
        payload: {
          status: goalStatusForProgressText(progressSummary),
          headline: headlineForProgress(progressSummary),
          note: progressSummary,
          for_human: true,
          metric: null,
          evidence_event_ids: candidate.triggerEventIds,
          wake_id: wakeId,
          source: "sidecar_codex_directive_guard",
        },
      })
    }
    appendThreadMetaEvent(runtimeRoot, {
      event_id: stackEventId("monitor_progress"),
      type: "monitor.progress",
      thread_id: threadId,
      observed_at: new Date().toISOString(),
      actor_id: actorId,
      actor_role: "monitor",
      payload: {
        wake_id: wakeId,
        wake_reason: candidate.reason,
        summary: progressSummary,
        severity: pass.severity,
        operator_update: pass.operatorUpdate ?? null,
        trigger_event_ids: candidate.triggerEventIds,
        pending_event_count: candidate.pendingEvents.length,
        source: pass.source,
      },
    })
  }

  const suggestedThreadName =
    pass.threadName ??
    parseThreadNameFromAgentResponse(monitorSummary)
  if (suggestedThreadName) {
    await setThreadDisplayName({
      stackRoot: runtimeRoot,
      sessionLogDir: input.config.sessionLogDir,
      threadId,
      displayName: suggestedThreadName,
      namedBy: "monitor",
      codexModel: input.config.codexModel,
      pricingRows: input.config.codexPricing,
    })
    if (input.session.id === threadId) {
      input.session.displayName = suggestedThreadName
    }
  }

  const queueItems = monitorConfig.permissions.queue && actorToolAllowed(monitorConfig.tools, "monitor.queue")
    ? pass.queueItems
    : []
  for (const item of queueItems.slice(0, monitorConfig.intervention.maxQueuedItemsPerThread)) {
    appendThreadMetaEvent(runtimeRoot, {
      event_id: stackEventId("monitor_queued"),
      type: "monitor.queued",
      thread_id: threadId,
      observed_at: new Date().toISOString(),
      actor_id: actorId,
      actor_role: "monitor",
      payload: item,
    })
  }
  const contextPushes = monitorConfig.permissions.skillPush
    && (actorToolAllowed(monitorConfig.tools, "skills.push_context") || actorToolAllowed(monitorConfig.tools, "skills.suggest"))
    ? skillContextPushDecisions({
      config: monitorConfig,
      pass,
      priorEvents,
      pendingEvents: candidate.pendingEvents,
      triggerEventIds: candidate.triggerEventIds,
      turn: input.turn ?? syntheticTurnFromEvents(input.session, candidate.pendingEvents),
    })
    : []
  for (const decision of contextPushes) {
    suggestSkillToThread({
      stackRoot: runtimeRoot,
      threadId,
      actorId,
      actorRole: "monitor",
      eventType: "monitor.skill_context_push",
      skillId: decision.skillId,
      reason: decision.reason,
      evidenceEventIds: decision.evidenceEventIds,
      message: decision.message,
      workspaceRoot: input.config.workspaceRoot,
    })
  }

  let steerDelta = 0
  const steerSignature = triggerSignature(candidate.pendingEvents)
  const sidecarSteerMessage =
    pass.workerSteerMessage ??
    inferredSidecarSteerFromSummary(monitorSummary, candidate.pendingEvents)
  if (
    sidecarSteerMessage &&
    monitorConfig.permissions.steer &&
    actorToolAllowed(monitorConfig.tools, "monitor.steer") &&
    // Steer once per issue: suppress a repeat of a recent sidecar steer. The LLM re-surfaces
    // unresolved problems every wake; code enforces the "don't repeat" invariant.
    !recentSidecarSteerIsSimilar(priorEvents, sidecarSteerMessage, steerSignature)
  ) {
    appendThreadMetaEvent(runtimeRoot, {
      event_id: stackEventId("monitor_steer"),
      type: "monitor.steer",
      thread_id: threadId,
      observed_at: new Date().toISOString(),
      actor_id: actorId,
      actor_role: "monitor",
      payload: {
        wake_id: wakeId,
        message: sidecarSteerMessage,
        severity: pass.severity === "none" ? "low" : pass.severity,
        focus: "goal_progress",
        source: "sidecar_codex",
        trigger_signature: steerSignature,
      },
    })
    steerDelta += 1
  }
  // Risky-pending → pause + escalate (locked decision #1). Deterministic: if the worker's recent
  // tool stream shows an imminent irreversible/destructive action, surface it ONCE as a high-severity
  // steer for human confirmation — code owns this hard-safety signal, not the LLM.
  const riskyPending = detectRiskyPending(candidate.pendingEvents)
  const riskySummary = riskyPendingSummary(riskyPending)
  const riskySignature = `risky:${riskyPending[0]?.category ?? ""}`
  const alreadyEscalated = priorEvents
    .slice(-30)
    .some((e) => e.type === "monitor.steer" && (e.payload as Record<string, unknown>).trigger_signature === riskySignature)
  if (
    riskySummary &&
    monitorConfig.permissions.steer &&
    actorToolAllowed(monitorConfig.tools, "monitor.steer") &&
    !alreadyEscalated
  ) {
    appendThreadMetaEvent(runtimeRoot, {
      event_id: stackEventId("monitor_steer"),
      type: "monitor.steer",
      thread_id: threadId,
      observed_at: new Date().toISOString(),
      actor_id: actorId,
      actor_role: "monitor",
      payload: {
        wake_id: wakeId,
        message: riskySummary,
        severity: "high",
        focus: "risky_pending",
        source: "monitor_runtime",
        trigger_signature: riskySignature,
      },
    })
    steerDelta += 1
  }
  const turnForSteer = input.turn ?? syntheticTurnFromEvents(input.session, candidate.pendingEvents)
  const violations = detectSynthStyleViolations(turnForSteer)
  const violation = violations.find((entry) => !hasSteeredViolationRule(priorEvents, entry.id))
  if (violation && monitorConfig.permissions.steer && actorToolAllowed(monitorConfig.tools, "monitor.steer")) {
    const severity = severityForStyleViolation(violation.id)
    if (steerAllowedForStrictness(monitorConfig.strictness, severity)) {
      const steer = buildStyleSteerFromGuidance({
        stackRoot: runtimeRoot,
        workspaceRoot: input.config.workspaceRoot,
        violation,
      })
      if (steer) {
        appendThreadMetaEvent(runtimeRoot, {
          event_id: stackEventId("guidance_query"),
          type: "guidance.query",
          thread_id: threadId,
          observed_at: new Date().toISOString(),
          actor_id: actorId,
          actor_role: "monitor",
          payload: {
            query: steer.query,
            scope: "style",
            hit_ids: [steer.guidanceId],
            reason: "monitor_style_steer",
            rule_id: violation.id,
          },
        })
        appendThreadMetaEvent(runtimeRoot, {
          event_id: stackEventId("guidance_used"),
          type: "guidance.used",
          thread_id: threadId,
          observed_at: new Date().toISOString(),
          actor_id: actorId,
          actor_role: "monitor",
          payload: {
            guidance_id: steer.guidanceId,
            reason: "monitor_style_steer",
            rule_id: violation.id,
            excerpt: steer.excerpt,
          },
        })
        appendThreadMetaEvent(runtimeRoot, {
          event_id: stackEventId("monitor_steer"),
          type: "monitor.steer",
          thread_id: threadId,
          observed_at: new Date().toISOString(),
          actor_id: actorId,
          actor_role: "monitor",
          payload: {
            wake_id: wakeId,
            rule_id: violation.id,
            guidance_id: steer.guidanceId,
            guidance_excerpt: steer.excerpt,
            message: steer.message,
            severity,
            focus: "style",
          },
        })
        steerDelta += 1
      }
    }
  }

  const eventsBeforeCheckin = readThreadMetaEvents(runtimeRoot, threadId)
  if (!wakeEmittedHumanFeedEvent(eventsBeforeCheckin, wakeId, observedAt)) {
    appendThreadMetaEvent(runtimeRoot, {
      event_id: stackEventId("monitor_checkin"),
      type: "monitor.checkin",
      thread_id: threadId,
      observed_at: new Date().toISOString(),
      actor_id: actorId,
      actor_role: "monitor",
      payload: {
        wake_id: wakeId,
        wake_reason: candidate.reason,
        pending_event_count: candidate.pendingEvents.length,
        note: monitorCheckinNote({
          wakeReason: candidate.reason,
          pendingEventCount: candidate.pendingEvents.length,
        }),
        status: "watching",
      },
    })
  }

  const usage = pass.usage ?? estimateMonitorUsage(candidate.pendingEvents, monitorSummary)
  appendThreadMetaEvent(runtimeRoot, {
    event_id: stackEventId("monitor_usage"),
    type: "monitor.usage",
    thread_id: threadId,
    observed_at: new Date().toISOString(),
    actor_id: actorId,
    actor_role: "monitor",
    payload: {
      wake_id: wakeId,
      model: monitorConfig.model.model,
      reasoning_effort: monitorConfig.model.reasoningEffort,
      input_tokens: usage.inputTokens,
      cached_input_tokens: usage.cachedInputTokens ?? 0,
      output_tokens: usage.outputTokens,
      reasoning_output_tokens: usage.reasoningOutputTokens ?? 0,
      estimated_spend_usd: usage.estimatedSpendUsd ?? 0,
      source: pass.source,
    },
  })

  const lastProcessedEvent = candidate.pendingEvents.at(-1)
  const completedAt = new Date().toISOString()
  const completedState = actorStateFromConfig(monitorConfig, threadId, {
    previous: runningState,
    state: "idle",
    strictness: effective.strictness,
    lastCompletedAt: completedAt,
    lastEventId: lastProcessedEvent?.event_id ?? actorState?.last_event_id,
    lastEventType: lastProcessedEvent?.type ?? actorState?.last_event_type,
    lastWakeId: wakeId,
    monitorThreadId: pass.monitorThreadId,
    monitorCodexThreadId: pass.monitorCodexThreadId,
    monitorCodexWaitingForRestart: pass.source === "codex-app-server",
    monitorCodexLastPauseReason: pass.source === "codex-app-server" ? pass.checkpointSummary ?? monitorSummary : undefined,
    rollingSummary: pass.checkpointSummary ?? monitorSummary,
    severity: pass.severity,
    wakeDelta: 1,
    queueDelta: queueItems.length,
    contextPushDelta: contextPushes.length,
    steerDelta,
  })
  writeMonitorActorState(runtimeRoot, completedState)
  appendThreadMetaEvent(runtimeRoot, {
    event_id: stackEventId("monitor_checkpoint"),
    type: "monitor.checkpoint",
    thread_id: threadId,
    observed_at: new Date().toISOString(),
    actor_id: actorId,
    actor_role: "monitor",
    payload: {
      last_wake_id: wakeId,
      last_turn_id: input.turn?.id ?? null,
      last_event_id: completedState.last_event_id ?? null,
      last_event_type: completedState.last_event_type ?? null,
      summary: monitorSummary,
      severity: pass.severity,
      state: completedState.state,
      actor_state_path: relativeActorStatePath(threadId, actorId),
      model_thread_id: pass.monitorThreadId ?? null,
      monitor_codex_thread_id: pass.monitorCodexThreadId ?? null,
    },
  })

  if (input.drainQueued !== false) {
    const eventsAfterCheckpoint = readThreadMetaEvents(runtimeRoot, threadId)
    const queuedTriggerIds = queuedTriggerEventIdsAfterWake(eventsAfterCheckpoint, wakeId)
      .filter((id) => id !== completedState.last_event_id)
    if (queuedTriggerIds.length > 0) {
      return await runMonitorForNewEvents({
        config: input.config,
        session: input.session,
        agentContext: input.agentContext,
        goalContext,
        wakeReason: "queued_trigger",
        triggerEventIds: queuedTriggerIds,
        drainQueued: false,
      })
    }
  }

  return snapshotFromEvents(
    monitorConfig,
    readThreadMetaEvents(runtimeRoot, threadId),
    readMonitorActorState(runtimeRoot, threadId, actorId),
  )
}

function monitorRuntimeRoot(config: StackConfig): string {
  if (!config.stackDataRoot) {
    throw new Error(
      "monitorRuntimeRoot: config.stackDataRoot is empty — monitor event/actor-state root is unresolved and would silently split from worker events",
    )
  }
  return config.stackDataRoot
}

function steerTokens(message: string): Set<string> {
  return new Set(
    message
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 3),
  )
}

// The stable identity of the issue a steer is about: the set of failing worker actions in the
// batch (tool + command), one entry per distinct failing command. Two wakes over the SAME
// unresolved failure share an entry even when the monitor rewords its steer or the failing SET
// changes — so this, not fragile prose matching, is the primary dedup key.
export function triggerSignature(events: StackThreadMetaEvent[]): string {
  const commands = events
    .filter((event) => event.type === "agent.tool.failed")
    .map((event) => {
      const payload = (event.payload ?? {}) as Record<string, unknown>
      const command = String(payload.command ?? "").trim().toLowerCase()
      if (!command) return "" // an empty command is not an identity — never collapse distinct issues onto it
      return `${String(payload.tool_name ?? "").trim().toLowerCase()}:${command}`
    })
    .filter((entry) => entry.length > 0)
  return [...new Set(commands)].sort().join("|")
}

function inferredSidecarSteerFromSummary(
  summary: string,
  pendingEvents: StackThreadMetaEvent[],
): string | undefined {
  const normalized = summary.toLowerCase()
  const saysSteered = /\bsteer(?:ed|ing)?\b/.test(normalized)
  const saysStuck = /\b(stuck|stalled|retri(?:ed|es|ying)|same failure|nonexistent|missing module|modulenotfounderror)\b/.test(normalized)
  if (!saysSteered && !saysStuck) return undefined
  const commandCounts = new Map<string, number>()
  for (const event of pendingEvents) {
    if (event.type !== "agent.tool.failed") continue
    const command = readString(event.payload.command)?.trim()
    if (!command) continue
    commandCounts.set(command, (commandCounts.get(command) ?? 0) + 1)
  }
  const repeated = [...commandCounts.entries()].find(([, count]) => count >= 2)
  if (!repeated) return undefined
  return repeatedFailureSteerForCommand(repeated[0])
}

function repeatedFailureSteerMessage(pendingEvents: StackThreadMetaEvent[]): string | undefined {
  const commandCounts = new Map<string, number>()
  for (const event of pendingEvents) {
    if (event.type !== "agent.tool.failed") continue
    const command = readString(event.payload.command)?.trim()
    if (!command) continue
    commandCounts.set(command, (commandCounts.get(command) ?? 0) + 1)
  }
  const repeated = [...commandCounts.entries()].find(([, count]) => count >= 2)
  return repeated ? repeatedFailureSteerForCommand(repeated[0]) : undefined
}

function repeatedFailureSteerForCommand(command: string): string {
  return `Stop retrying the failing command \`${truncate(command, 120)}\`; inspect the real entrypoint/path before rerunning.`
}

function signatureCommands(signature: string): Set<string> {
  return new Set(signature.split("|").filter((entry) => entry.length > 0))
}

// Steer once per issue. Suppress a new sidecar steer if a recent one addressed the same failing
// command (robust to rewording and to the failing set changing), or — as a fallback for steers
// with no failing command, e.g. off-goal — shares most of its meaningful tokens (Jaccard >= 0.5).
export function recentSidecarSteerIsSimilar(
  priorEvents: StackThreadMetaEvent[],
  message: string,
  signature: string,
): boolean {
  const target = steerTokens(message)
  const targetCommands = signatureCommands(signature)
  // Window over prior SIDECAR STEERS, not raw events: a chatty worker emits many events per turn,
  // so a raw slice would push the last steer out of view and silently break steer-once.
  const recentSteers = priorEvents
    .filter(
      (event) =>
        event.type === "monitor.steer" &&
        (event.payload as Record<string, unknown> | undefined)?.source === "sidecar_codex",
    )
    .slice(-12)
  for (const event of recentSteers) {
    const payload = event.payload as Record<string, unknown>
    const prevCommands = signatureCommands(String(payload.trigger_signature ?? ""))
    for (const command of targetCommands) if (prevCommands.has(command)) return true
    const prev = steerTokens(String(payload.message ?? ""))
    if (target.size === 0 || prev.size === 0) continue
    const overlap = [...target].filter((word) => prev.has(word)).length
    const union = new Set([...target, ...prev]).size
    if (union > 0 && overlap / union >= 0.5) return true
  }
  return false
}

export function monitorRailLines(snapshot: StackMonitorSnapshot, columns: number): string[] {
  const width = Math.max(24, columns - 2)
  const strictness =
    snapshot.strictness === "conservative"
      ? "cons"
      : snapshot.strictness === "aggressive"
        ? "aggr"
        : snapshot.strictness
  const status =
    snapshot.status === "watching"
      ? "watch"
      : snapshot.status === "summarized"
        ? "summ"
        : snapshot.status
  const enabledLabel = snapshot.enabled && snapshot.status !== "paused" && snapshot.status !== "off"
    ? "ON"
    : snapshot.status === "paused"
      ? "PAUSED"
      : "OFF"
  const lines = ["aux agents"]
  lines.push(
    truncate(
      `monitor ${enabledLabel} · ${status} · ${strictness} · w${snapshot.wakeCount} q${snapshot.queuedCount}`,
      width,
    ),
  )
  if (!snapshot.enabled || snapshot.status === "off") {
    lines.push(truncate(`runtime off · M cycles`, width))
    return lines
  }
  lines.push(truncate(`runtime ${formatRuntime(snapshot.runtime)}`, width))
  lines.push(truncate(`model ${snapshot.model} · effort ${formatEffort(snapshot.reasoningEffort)}`, width))
  lines.push(truncate(`thread spend ${formatEstimatedSpend(snapshot.threadSpendUsd) ?? "~$0"} · M cycles`, width))
  if (snapshot.lastWakeReason || snapshot.lastSeverity !== "none") {
    lines.push(truncate(`last ${snapshot.lastWakeReason ?? "summary"} · ${snapshot.lastSeverity}`, width))
  }
  if (snapshot.lastEventId || snapshot.lastWakeId) {
    lines.push(truncate(`cursor ${shortId(snapshot.lastEventId)} · wake ${shortId(snapshot.lastWakeId)}`, width))
  }
  if (snapshot.lastSummary) lines.push(truncate(snapshot.lastSummary, width))
  const focus = Object.entries(snapshot.focusResults)
    .filter(([, status]) => status && status !== "disabled")
    .map(([name, status]) => `${name}:${status}`)
  if (focus.length > 0) lines.push(truncate(`focus ${focus.join(" ")}`, width))
  if (snapshot.skillReadCount > 0 || snapshot.contextPushCount > 0) {
    lines.push(truncate(`skills read ${snapshot.skillReadCount} · pushed ${snapshot.contextPushCount}`, width))
  }
  return lines
}

function formatRuntime(value: string): string {
  if (value === "codex-app-server") return "codex"
  return value
}

function formatEffort(value: string): string {
  if (value === "medium") return "med"
  return value
}

export function cycleMonitorMode(stackRoot: string, threadId: string): StackMonitorSnapshot {
  const config = loadMonitorConfig(stackRoot)
  const events = readThreadMetaEvents(stackRoot, threadId)
  const current = effectiveMonitorState(config, events).strictness
  const next = nextStrictness(current)
  return writeMonitorModeChange(stackRoot, threadId, config, current, next)
}

export function setMonitorEnabled(stackRoot: string, threadId: string, enabled: boolean): StackMonitorSnapshot {
  const config = loadMonitorConfig(stackRoot)
  const events = readThreadMetaEvents(stackRoot, threadId)
  const current = effectiveMonitorState(config, events).strictness
  const next = enabled
    ? current === "off"
      ? config.strictness === "off"
        ? "conservative"
        : config.strictness
      : current
    : "off"
  return writeMonitorModeChange(stackRoot, threadId, config, current, next)
}

function writeMonitorModeChange(
  stackRoot: string,
  threadId: string,
  config: StackMonitorConfig,
  current: MonitorStrictness,
  next: MonitorStrictness,
): StackMonitorSnapshot {
  const actorId = monitorActorId(config)
  const type = current === "off" && next !== "off"
    ? "monitor.resumed"
    : next === "off"
      ? "monitor.paused"
      : "monitor.mode_changed"
  appendThreadMetaEvent(stackRoot, {
    event_id: stackEventId(type.replace(".", "_")),
    type,
    thread_id: threadId,
    observed_at: new Date().toISOString(),
    actor_id: actorId,
    actor_role: "monitor",
    payload: {
      previous_strictness: current,
      strictness: next,
      enabled: next !== "off",
      source: "tui",
    },
  })
  const prior = readMonitorActorState(stackRoot, threadId, actorId)
  writeMonitorActorState(stackRoot, actorStateFromConfig(config, threadId, {
    previous: prior,
    state: next === "off" ? "paused" : "idle",
    strictness: next,
  }))
  return refreshMonitorSnapshot(stackRoot, threadId)
}

type WakeCandidate = {
  reason: string
  triggerEventIds: string[]
  pendingEvents: StackThreadMetaEvent[]
}

export type StackMonitorWakeDecision = {
  reason: string
  triggerEventIds: string[]
  pendingEventIds: string[]
}

export function selectMonitorWakeDecision(input: {
  config: StackMonitorConfig
  actorState?: StackMonitorActorRuntimeState
  events: StackThreadMetaEvent[]
  wakeReason?: string
  triggerEventIds?: string[]
}): StackMonitorWakeDecision | undefined {
  const candidate = nextWakeCandidate(input)
  if (!candidate) return undefined
  return {
    reason: candidate.reason,
    triggerEventIds: candidate.triggerEventIds,
    pendingEventIds: candidate.pendingEvents.map((event) => event.event_id),
  }
}

type HandoffPreemptEvaluation = {
  status: "eligible" | "skipped"
  wakePayload: Record<string, unknown>
  eventPayload: Record<string, unknown>
}

function nextWakeCandidate(input: {
  config: StackMonitorConfig
  actorState?: StackMonitorActorRuntimeState
  events: StackThreadMetaEvent[]
  wakeReason?: string
  triggerEventIds?: string[]
}): WakeCandidate | undefined {
  const actorId = monitorActorId(input.config)
  const finish = (candidate: WakeCandidate | undefined): WakeCandidate | undefined => {
    if (!candidate) return undefined
    if (!nextWakeAllows(input.events, actorId, wakeClass(candidate.reason))) return undefined
    if (monitorWakeBudgetExhausted(input.config, input.events, candidate.reason)) return undefined
    return candidate
  }

  if (input.wakeReason === "operator_message" && input.triggerEventIds?.length) {
    const operatorEvents = input.events.filter((event) => input.triggerEventIds?.includes(event.event_id))
    if (operatorEvents.length > 0) {
      return finish({
        reason: "operator_message",
        triggerEventIds: input.triggerEventIds,
        pendingEvents: operatorEvents,
      })
    }
  }

  const pendingEvents = processableEventsAfterCursor(input.events, input.actorState?.last_event_id)
  if (pendingEvents.length === 0) return undefined

  const alreadyTriggered = triggeredEventIds(input.events)
  let triggers = input.triggerEventIds?.length
    ? pendingEvents.filter((event) => input.triggerEventIds?.includes(event.event_id))
    : pendingEvents.filter((event) => isWakeTrigger(input.config, event))

  if (triggers.some((event) => alreadyTriggered.has(event.event_id))) return undefined
  if (triggers.length > 0) {
    return finish({
      reason: input.wakeReason ?? wakeReasonFromEvent(triggers[0]),
      triggerEventIds: triggers.map((event) => event.event_id),
      pendingEvents,
    })
  }

  const workerEvents = pendingEvents.filter(isWorkerProgressEvent)
  if (
    input.config.wake.eventBatchSize > 0 &&
    workerEvents.length >= input.config.wake.eventBatchSize &&
    monitorIntervalElapsed(input.actorState?.last_completed_at ?? input.actorState?.last_started_at, input.config.wake.eventBatchMinIntervalMs)
  ) {
    triggers = [workerEvents.at(-1)].filter((event): event is StackThreadMetaEvent => Boolean(event))
    if (triggers.some((event) => alreadyTriggered.has(event.event_id))) return undefined
    return finish({
      reason: "event_batch",
      triggerEventIds: triggers.map((event) => event.event_id),
      pendingEvents,
    })
  }

  if (input.config.wake.deltaEvents > 0 && pendingEvents.length >= input.config.wake.deltaEvents) {
    triggers = [pendingEvents.at(-1)].filter((event): event is StackThreadMetaEvent => Boolean(event))
    if (triggers.some((event) => alreadyTriggered.has(event.event_id))) return undefined
    return finish({
      reason: "delta_events",
      triggerEventIds: triggers.map((event) => event.event_id),
      pendingEvents,
    })
  }

  return undefined
}

function monitorWakeBudgetExhausted(
  config: StackMonitorConfig,
  events: StackThreadMetaEvent[],
  reason: string,
): boolean {
  const max = config.wake.maxWakesPerPrimaryTurn
  if (max <= 0) return false
  if (reason === "operator_message" || reason === "goal_change") return false
  const turnStartIndex = latestPrimaryTurnStartIndex(events)
  if (turnStartIndex < 0) return false
  const wakeCount = events.slice(turnStartIndex + 1).filter((event) => event.type === "monitor.wake").length
  return wakeCount >= max
}

function latestPrimaryTurnStartIndex(events: StackThreadMetaEvent[]): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === "agent.turn.started") return index
  }
  return -1
}

function nextWakeAllows(events: StackThreadMetaEvent[], actorId: string, wake: "worker_event" | "operator_message" | "goal_change"): boolean {
  const allowed = latestNextWakeOn(events, actorId)
  if (!allowed) return true
  return allowed.has(wake)
}

function latestNextWakeOn(events: StackThreadMetaEvent[], actorId: string): Set<string> | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (!event || event.type !== "monitor.pause_for_restart") continue
    if (event.actor_id !== actorId) continue
    const values = event.payload.next_wake_on
    if (!Array.isArray(values)) return undefined
    const normalized = values
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
    return normalized.length > 0 ? new Set(normalized) : undefined
  }
  return undefined
}

function wakeClass(reason: string): "worker_event" | "operator_message" | "goal_change" {
  if (reason === "operator_message") return "operator_message"
  if (reason === "goal_change") return "goal_change"
  return "worker_event"
}

function evaluateHandoffPreempt(input: {
  config: StackMonitorConfig
  session: StackLocalSession
  events: StackThreadMetaEvent[]
  pendingEvents: StackThreadMetaEvent[]
  triggerEventIds: string[]
  wakeReason: string
  observedAt: string
}): HandoffPreemptEvaluation | undefined {
  const policy = input.config.handoffPreempt
  if (!policy.enabled) return undefined

  const turnCount = segmentTurnCount(input.session, input.events)
  const tokenEstimate = segmentInputTokenEstimate(input.session, input.events)
  const triggers = handoffPreemptTriggers(policy, turnCount, tokenEstimate)
  if (triggers.length === 0) return undefined

  const trigger = triggers[0]!
  const toolAllowed = actorToolAllowed(input.config.tools, "handoff.preempt")
  const preemptsThisSegment = handoffPreemptAttemptCount(input.events, input.session.segmentId)
  const latestAttempt = latestHandoffPreemptAttempt(input.events, input.session.segmentId)
  const cooldownRemainingMs = latestAttempt
    ? remainingCooldownMs(latestAttempt.observed_at, input.observedAt, policy.cooldownMs)
    : 0
  const missingMetaThread = policy.requireMetaThread && (!input.session.metaThreadId || !input.session.segmentId)

  let status: HandoffPreemptEvaluation["status"] = "eligible"
  let reason = trigger
  if (!toolAllowed) {
    status = "skipped"
    reason = "tool_denied"
  } else if (missingMetaThread) {
    status = "skipped"
    reason = "missing_meta_thread"
  } else if (turnCount < policy.minTurnsBeforePreempt) {
    status = "skipped"
    reason = "min_turns"
  } else if (preemptsThisSegment >= policy.maxPreemptsPerSegment) {
    status = "skipped"
    reason = "max_preempts_per_segment"
  } else if (cooldownRemainingMs > 0) {
    status = "skipped"
    reason = "cooldown"
  }

  const payload = {
    status,
    reason,
    trigger,
    triggers,
    thread_id: input.session.id,
    meta_thread_id: input.session.metaThreadId ?? null,
    segment_id: input.session.segmentId ?? null,
    segment_role: input.session.segmentRole ?? null,
    harness: input.session.harness ?? "codex",
    token_estimate: tokenEstimate,
    context_token_threshold: policy.contextTokenThreshold,
    context_fraction_threshold: policy.contextFractionThreshold,
    context_fraction: null,
    turn_count: turnCount,
    turn_threshold: policy.turnThreshold,
    min_turns_before_preempt: policy.minTurnsBeforePreempt,
    preempts_this_segment: preemptsThisSegment,
    max_preempts_per_segment: policy.maxPreemptsPerSegment,
    cooldown_ms: policy.cooldownMs,
    cooldown_remaining_ms: cooldownRemainingMs,
    tool_allowed: toolAllowed,
    require_meta_thread: policy.requireMetaThread,
    successor_role: policy.successorRole,
    successor_role_name: policy.successorRoleName || null,
    successor_model: policy.successorModel || null,
    successor_reasoning_effort: policy.successorReasoningEffort || null,
    auto_seal: policy.autoSeal,
    auto_approve: policy.autoApprove,
    auto_continue: policy.autoContinue,
    pause_worker_before_seal: policy.pauseWorkerBeforeSeal,
    segment_policy_file: policy.segmentPolicyFile,
    wake_reason: input.wakeReason,
    trigger_event_ids: input.triggerEventIds,
    pending_event_count: input.pendingEvents.length,
    observe_only: true,
  }

  return {
    status,
    wakePayload: payload,
    eventPayload: payload,
  }
}

function handoffPreemptTriggers(
  policy: StackMonitorHandoffPreemptConfig,
  turnCount: number,
  tokenEstimate: number,
): string[] {
  const triggers: string[] = []
  if (
    policy.wakeOnContextPressure &&
    policy.contextTokenThreshold > 0 &&
    tokenEstimate >= policy.contextTokenThreshold
  ) {
    triggers.push("context_pressure")
  }
  if (policy.turnThreshold > 0 && turnCount >= policy.turnThreshold) {
    triggers.push("turn_threshold")
  }
  return triggers
}

function segmentTurnCount(session: StackLocalSession, events: StackThreadMetaEvent[]): number {
  const completedTurnEvents = events.filter((event) =>
    event.type === "agent.turn.completed" &&
    (!session.segmentId || event.segment_id === session.segmentId || readString(event.payload.segment_id) === session.segmentId)
  ).length
  return Math.max(session.turns.length, completedTurnEvents)
}

function segmentInputTokenEstimate(session: StackLocalSession, events: StackThreadMetaEvent[]): number {
  const sessionTokens = session.usageSummary?.totals.inputTokens ?? 0
  let eventTokens = 0
  for (const event of events) {
    if (event.type !== "agent.usage") continue
    if (session.segmentId && event.segment_id && event.segment_id !== session.segmentId) continue
    eventTokens += readNumber(event.payload.input_tokens) ?? 0
  }
  return Math.max(sessionTokens, eventTokens)
}

function handoffPreemptAttemptCount(events: StackThreadMetaEvent[], segmentId: string | undefined): number {
  return events.filter((event) =>
    (event.type === "monitor.handoff_preempt.requested" || event.type === "monitor.handoff_preempt.completed") &&
    (!segmentId || event.segment_id === segmentId || readString(event.payload.segment_id) === segmentId)
  ).length
}

function latestHandoffPreemptAttempt(
  events: StackThreadMetaEvent[],
  segmentId: string | undefined,
): StackThreadMetaEvent | undefined {
  return events
    .filter((event) =>
      event.type.startsWith("monitor.handoff_preempt.") &&
      (!segmentId || event.segment_id === segmentId || readString(event.payload.segment_id) === segmentId)
    )
    .at(-1)
}

function remainingCooldownMs(previousObservedAt: string, observedAt: string, cooldownMs: number): number {
  if (cooldownMs <= 0) return 0
  const previous = Date.parse(previousObservedAt)
  const current = Date.parse(observedAt)
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return 0
  return Math.max(0, cooldownMs - (current - previous))
}

function processableEventsAfterCursor(events: StackThreadMetaEvent[], lastEventId: string | undefined): StackThreadMetaEvent[] {
  const cursorIndex = lastEventId ? events.findIndex((event) => event.event_id === lastEventId) : -1
  return events
    .slice(cursorIndex + 1)
    .filter((event) => !event.type.startsWith("monitor."))
    .filter((event) => event.actor_role !== "monitor")
}

function triggeredEventIds(events: StackThreadMetaEvent[]): Set<string> {
  const ids = new Set<string>()
  for (const event of events) {
    if (event.type !== "monitor.wake") continue
    const triggerIds = event.payload.trigger_event_ids
    if (!Array.isArray(triggerIds)) continue
    for (const id of triggerIds) {
      if (typeof id === "string") ids.add(id)
    }
  }
  return ids
}

function queuedTriggerEventIds(events: StackThreadMetaEvent[]): Set<string> {
  const ids = new Set<string>()
  for (const event of events) {
    if (event.type !== "monitor.trigger_queued") continue
    const triggerIds = event.payload.trigger_event_ids
    if (!Array.isArray(triggerIds)) continue
    for (const id of triggerIds) {
      if (typeof id === "string") ids.add(id)
    }
  }
  return ids
}

function queuedTriggerEventIdsAfterWake(events: StackThreadMetaEvent[], wakeId: string): string[] {
  const wakeIndex = events.findIndex((event) => event.event_id === wakeId)
  if (wakeIndex < 0) return []
  const ids: string[] = []
  for (const event of events.slice(wakeIndex + 1)) {
    if (event.type !== "monitor.trigger_queued") continue
    const triggerIds = event.payload.trigger_event_ids
    if (!Array.isArray(triggerIds)) continue
    for (const id of triggerIds) {
      if (typeof id === "string" && !ids.includes(id)) ids.push(id)
    }
  }
  return ids
}

function isWakeTrigger(config: StackMonitorConfig, event: StackThreadMetaEvent): boolean {
  if (event.type === "agent.tool.failed") return config.wake.onToolFailed
  if (event.type === "agent.tool.completed") return config.wake.onToolCompleted
  if (event.type === "agent.turn.completed") return config.wake.onTurnCompleted
  if (event.type === "agent.worker_heartbeat") return true
  if (event.type === "agent.error") return true
  if (isGoalChangeEvent(event)) return true
  return false
}

function isWorkerProgressEvent(event: StackThreadMetaEvent): boolean {
  if (event.actor_role === "monitor") return false
  if (event.type.startsWith("monitor.")) return false
  return (
    event.type === "agent.turn.started" ||
    event.type === "agent.turn.completed" ||
    event.type === "agent.tool.started" ||
    event.type === "agent.tool.completed" ||
    event.type === "agent.tool.failed" ||
    event.type === "agent.error" ||
    event.type === "agent.usage" ||
    event.type === "agent.message" ||
    event.type === "agent.message.delta" ||
    event.type === "agent.message.completed" ||
    event.type === "agent.worker_heartbeat"
  )
}

function wakeReasonFromEvent(event: StackThreadMetaEvent | undefined): string {
  if (!event) return "delta_events"
  if (event.type === "agent.tool.failed") return "tool_failed"
  if (event.type === "agent.tool.completed") return "tool_completed"
  if (event.type === "agent.turn.completed") return "turn_completed"
  if (event.type === "agent.worker_heartbeat") return readString(event.payload.reason) ?? "cadence_tick"
  if (event.type === "agent.error") return "error"
  if (isGoalChangeEvent(event)) return "goal_change"
  return event.type.replace(/^agent\./, "")
}

function isGoalChangeEvent(event: StackThreadMetaEvent): boolean {
  return (
    event.type === "meta_thread.goal_updated" ||
    event.type === "goal.started" ||
    event.type === "goal.paused" ||
    event.type === "goal.resumed" ||
    event.type === "goal.cleared"
  )
}

function goalContextActive(goal: CodexGoalSnapshot): boolean {
  if (!goal.objective?.trim()) return false
  const status = goal.status?.trim().toLowerCase()
  return !status || status === "active" || status === "in_progress" || status === "running" || status === "blocked"
}

function cadenceWakeReason(
  config: StackMonitorConfig,
  events: StackThreadMetaEvent[],
  actorState: StackMonitorActorRuntimeState | undefined,
): {
  reason: "cadence_tick" | "stale_worker"
  pendingWorkerEventCount: number
  elapsedSinceLastWorkerEventMs: number | null
  elapsedSinceLastMonitorWakeMs: number | null
} | undefined {
  const now = Date.now()
  const pendingWorkerEventCount = processableEventsAfterCursor(events, actorState?.last_event_id)
    .filter(isWorkerProgressEvent)
    .length
  const lastWorkerAt = latestObservedAt(events, (event) => isWorkerProgressEvent(event))
  const lastMonitorWakeAt = latestObservedAt(events, (event) => event.type === "monitor.wake")
  const elapsedSinceLastWorkerEventMs = lastWorkerAt ? now - lastWorkerAt : null
  const elapsedSinceLastMonitorWakeMs = lastMonitorWakeAt ? now - lastMonitorWakeAt : null
  if (
    config.wake.staleWorkerIntervalMs > 0 &&
    elapsedSinceLastWorkerEventMs !== null &&
    elapsedSinceLastWorkerEventMs >= config.wake.staleWorkerIntervalMs &&
    monitorIntervalElapsed(actorState?.last_completed_at ?? actorState?.last_started_at, config.wake.staleWorkerIntervalMs)
  ) {
    return {
      reason: "stale_worker",
      pendingWorkerEventCount,
      elapsedSinceLastWorkerEventMs,
      elapsedSinceLastMonitorWakeMs,
    }
  }
  if (
    config.wake.defaultIntervalMs > 0 &&
    monitorIntervalElapsed(actorState?.last_completed_at ?? actorState?.last_started_at, config.wake.defaultIntervalMs)
  ) {
    return {
      reason: "cadence_tick",
      pendingWorkerEventCount,
      elapsedSinceLastWorkerEventMs,
      elapsedSinceLastMonitorWakeMs,
    }
  }
  return undefined
}

function latestObservedAt(
  events: StackThreadMetaEvent[],
  predicate: (event: StackThreadMetaEvent) => boolean,
): number | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (!event || !predicate(event)) continue
    const parsed = Date.parse(event.observed_at)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function monitorIntervalElapsed(previousIso: string | undefined, intervalMs: number): boolean {
  if (intervalMs <= 0) return true
  if (!previousIso) return true
  const previous = Date.parse(previousIso)
  if (!Number.isFinite(previous)) return true
  return Date.now() - previous >= intervalMs
}

function syntheticTurnFromEvents(session: StackLocalSession, events: StackThreadMetaEvent[]): StackCodexTurn {
  const failed = events.some((event) => event.type === "agent.tool.failed" || event.type === "agent.error")
  const stdout = events.map((event) => JSON.stringify({
    type: event.type,
    id: event.event_id,
    payload: event.payload,
  })).join("\n")
  const last = events.at(-1)
  return {
    id: `monitor-delta-${last?.event_id ?? stackEventId("delta")}`,
    prompt: session.turns.at(-1)?.prompt ?? "(live event delta)",
    selectedPaths: session.turns.at(-1)?.selectedPaths ?? [],
    startedAt: events[0]?.observed_at ?? new Date().toISOString(),
    finishedAt: last?.observed_at ?? new Date().toISOString(),
    exitCode: failed ? 1 : 0,
    stdout,
    stderr: failed ? eventFailureText(events) : "",
  }
}

function eventFailureText(events: StackThreadMetaEvent[]): string {
  return events
    .filter((event) => event.type === "agent.tool.failed" || event.type === "agent.error")
    .map((event) => readString(event.payload.stderr) ?? readString(event.payload.message) ?? readString(event.payload.output) ?? event.type)
    .join("\n")
}

type MonitorPassResult = {
  checks: FocusCheck[]
  severity: MonitorSeverity
  summary: string
  threadName?: string
  queueItems: Record<string, unknown>[]
  checkpointSummary?: string
  operatorUpdate?: MonitorOperatorUpdate
  workerSteerMessage?: string
  userProgressUpdate?: string
  source: "codex-app-server"
  monitorThreadId?: string
  monitorCodexThreadId?: string
  usage?: MonitorUsageEstimate
}

export type MonitorOperatorUpdate = {
  working_on?: string
  struggling_with?: string
  progress_note?: string
  goal_status?: string
  trajectory?: "on_track" | "stalled" | "regressed"
  criteria_progress?: CriteriaProgress
  spend_snapshot?: SpendSnapshot
  eta?: EtaBand
}

export type CriteriaProgress = {
  done: number
  total: number
  pct: number
  last_criterion?: string
}

export type SpendSnapshot = {
  elapsed_s: number
  worker_usd: number
  monitor_usd: number
  worker_tokens: number
  monitor_tokens: number
}

export type EtaBand = {
  confidence: "low" | "med" | "high"
  remaining_minutes_low: number
  remaining_minutes_high: number
  rationale: string
}

type MonitorUsageEstimate = {
  inputTokens: number
  cachedInputTokens?: number
  outputTokens: number
  reasoningOutputTokens?: number
  estimatedSpendUsd?: number
}

async function runMonitorPass(input: {
  stackConfig: StackConfig
  stackRoot: string
  config: StackMonitorConfig
  actorState: StackMonitorActorRuntimeState
  threadId: string
  wakeId: string
  wakeReason: string
  triggerEventIds: string[]
  priorEvents: StackThreadMetaEvent[]
  pendingEvents: StackThreadMetaEvent[]
  turn: StackCodexTurn
  agentContext: AgentContextSnapshot
  goalContext: CodexGoalSnapshot
  checks: FocusCheck[]
}): Promise<MonitorPassResult> {
  const codex = await runMonitorCodexSidecarTurn({
    stackConfig: input.stackConfig,
    monitorConfig: input.config,
    threadId: input.threadId,
    actorId: input.actorState.monitor_actor_id,
    codexThreadId: input.actorState.monitor_codex_thread_id,
    wakeId: input.wakeId,
    wakeReason: input.wakeReason,
    triggerEventIds: input.triggerEventIds,
    priorEvents: input.priorEvents,
    pendingEvents: input.pendingEvents,
    goalContext: input.goalContext,
  })
  const summary = codex.assistantText?.trim()
  if (!summary) {
    throw new Error("Codex sidecar monitor completed without an assistant message")
  }
  const directives = parseSidecarDirectives(summary)
  return {
    checks: input.checks,
    severity: combineSeverity(input.config, input.checks),
    summary,
    queueItems: queueItemsFor(input.config, input.checks),
    checkpointSummary: summary,
    operatorUpdate: directives.progressUpdate
      ? {
          working_on: input.goalContext.objective,
          progress_note: directives.progressUpdate,
          goal_status: input.goalContext.status ?? "active",
          criteria_progress: criteriaProgressFromGoal(input.goalContext),
        }
      : undefined,
    workerSteerMessage: directives.steerMessage,
    userProgressUpdate: directives.progressUpdate,
    source: "codex-app-server",
    monitorCodexThreadId: codex.codexThreadId,
    usage: codexUsageEstimate(codex.usage, summary),
  }
}

function defaultMonitorBuiltinPrompt(): string {
  return [
    "The Stack monitor is a persistent Codex sidecar agent.",
    "It watches the primary worker event stream, answers operator sidecar chat, and pauses with stack_sidecar_pause_for_restart after each monitoring round.",
    "There are no alternate monitor workers.",
  ].join("\n")
}

function codexUsageEstimate(usage: StackCodexTurn["usage"], summary: string): MonitorUsageEstimate {
  return {
    inputTokens: usage?.inputTokens ?? 0,
    cachedInputTokens: usage?.cachedInputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? Math.max(1, Math.ceil(summary.length / 4)),
    reasoningOutputTokens: usage?.reasoningOutputTokens ?? 0,
  }
}

function boundedPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === "string") {
      result[key] = truncate(value, 1800)
    } else {
      result[key] = value
    }
  }
  return result
}

function estimateMonitorUsage(events: StackThreadMetaEvent[], summary: string): MonitorUsageEstimate {
  const inputChars = events.reduce((total, event) => total + JSON.stringify(event).length, 0)
  return {
    inputTokens: Math.max(1, Math.ceil(inputChars / 4)),
    outputTokens: Math.max(1, Math.ceil(summary.length / 4)),
  }
}

function parseSidecarDirectives(text: string): { progressUpdate?: string; steerMessage?: string } {
  const rawProgress = directiveLine(text, "PROGRESS_UPDATE")
  const steerMessage = directiveLine(text, "STEER_WORKER")
  // A "progress update" that only announces the ABSENCE of progress is noise, not signal — treat
  // it as NO_USER_UPDATE. Keep any update that also carries a concrete transition/refutation/number.
  const auditedUpdate = auditedGoalStatusUpdateFromSummary(text)
  const progressUpdate = rawProgress && isNoProgressAnnouncement(rawProgress) ? undefined : rawProgress ?? auditedUpdate
  return { progressUpdate, steerMessage }
}

function auditedGoalStatusUpdateFromSummary(text: string): string | undefined {
  const normalized = text.toLowerCase()
  const auditLanguage = /\b(audit(?:ed)?|refut(?:e|ed|es|ing)|false claim|completion claim|done[- ]claim)\b/.test(normalized)
  const completionClear =
    /\bclears? (?:the )?(?:2x )?target\b/.test(normalized) ||
    /\bclears? (?:the )?(?:requested )?(?:2x )?(?:bar|target)\b/.test(normalized) ||
    /\bgoal[_ ](?:is[_ ]?)?(?:complete|met)\b/.test(normalized)
  const completionRejected =
    /\bdoes not clear\b/.test(normalized) ||
    /\bnot (?:done|complete|enough)\b/.test(normalized) ||
    /\bshort of (?:the )?target\b/.test(normalized) ||
    /\bbelow (?:the )?target\b/.test(normalized)
  if (!auditLanguage && !completionClear && !completionRejected) return undefined
  if (!/\d/.test(text)) return undefined
  return text
}

export function isNoUserUpdateText(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.length === 0 || /^NO_USER_UPDATE\b/i.test(trimmed)
}

/** True when this wake already produced a human-facing Sidecar events row (not a check-in). */
export function wakeEmittedHumanFeedEvent(
  events: StackThreadMetaEvent[],
  wakeId: string,
  wakeObservedAt: string,
): boolean {
  const wakeMs = Date.parse(wakeObservedAt)
  for (const event of events) {
    const payload = (event.payload ?? {}) as Record<string, unknown>
    const eventWakeId = readString(payload.wake_id)
    if (eventWakeId && eventWakeId !== wakeId) continue
    const eventMs = Date.parse(event.observed_at)
    if (!eventWakeId && Number.isFinite(wakeMs) && Number.isFinite(eventMs) && eventMs < wakeMs) continue
    switch (event.type) {
      case "monitor.goal_status":
        if (payload.for_human === true) return true
        break
      case "monitor.progress":
      case "monitor.steer":
        return true
      case "monitor.skill_context_push":
        if (!eventWakeId || eventWakeId === wakeId) return true
        break
      default:
        break
    }
  }
  return false
}

export function monitorCheckinNote(input: { wakeReason: string; pendingEventCount: number }): string {
  const reviewed =
    input.pendingEventCount > 0
      ? `reviewed ${input.pendingEventCount} event${input.pendingEventCount === 1 ? "" : "s"}`
      : "no new worker events"
  return `no change · ${reviewed}`
}

function goalStatusProgressUpdate(events: StackThreadMetaEvent[], wakeObservedAt: string): string | undefined {
  const wakeMs = Date.parse(wakeObservedAt)
  const recent = [...events].reverse().find((event) => {
    if (event.type !== "monitor.goal_status") return false
    const eventMs = Date.parse(event.observed_at)
    return !Number.isFinite(wakeMs) || !Number.isFinite(eventMs) || eventMs >= wakeMs
  })
  if (!recent) return undefined
  const payload = recent.payload as Record<string, unknown>
  const status = readString(payload.status) ?? "working"
  const note = readString(payload.note)
  const metric = payload.metric && typeof payload.metric === "object" && !Array.isArray(payload.metric)
    ? (payload.metric as Record<string, unknown>)
    : undefined
  if (!note && !metric) return undefined
  const label = status.replace(/_/g, " ")
  const metricText = metric ? compactGoalMetric(metric) : undefined
  return [label, note, metricText].filter(Boolean).join(" · ")
}

function hasGoalStatusSince(events: StackThreadMetaEvent[], wakeObservedAt: string): boolean {
  const wakeMs = Date.parse(wakeObservedAt)
  return events.some((event) => {
    if (event.type !== "monitor.goal_status") return false
    const eventMs = Date.parse(event.observed_at)
    return !Number.isFinite(wakeMs) || !Number.isFinite(eventMs) || eventMs >= wakeMs
  })
}

function ensureAuditedGoalStatusFromSummary(input: {
  runtimeRoot: string
  threadId: string
  actorId: string
  wakeId: string
  observedAt: string
  triggerEventIds: string[]
  goalContext: CodexGoalSnapshot
  summary: string
  events: StackThreadMetaEvent[]
}): void {
  if (!input.goalContext.objective) return
  const wakeMs = Date.parse(input.observedAt)
  const recentGoalStatus = [...input.events].reverse().find((event) => {
    if (event.type !== "monitor.goal_status") return false
    const eventMs = Date.parse(event.observed_at)
    return !Number.isFinite(wakeMs) || !Number.isFinite(eventMs) || eventMs >= wakeMs
  })
  const recentStatus = recentGoalStatus
    ? readString((recentGoalStatus.payload as Record<string, unknown>).status)
    : undefined
  if (recentStatus === "goal_met" || recentStatus === "goal_failed") return
  const auditedSummary = auditedGoalStatusUpdateFromSummary(input.summary)
  if (!auditedSummary) return
  const status = goalStatusForProgressText(auditedSummary)
  if (status !== "goal_met" && status !== "goal_failed") return
  if (recentStatus === status) return
  const note = taskAwareProgressSummary(auditedSummary, input.goalContext)
  appendThreadMetaEvent(input.runtimeRoot, {
    event_id: stackEventId("monitor_goal_status"),
    type: "monitor.goal_status",
    thread_id: input.threadId,
    observed_at: new Date().toISOString(),
    actor_id: input.actorId,
    actor_role: "monitor",
    payload: {
      status,
      headline: headlineForProgress(note),
      note,
      for_human: true,
      metric: null,
      evidence_event_ids: input.triggerEventIds,
      wake_id: input.wakeId,
      source: "sidecar_codex_summary_audit",
    },
  })
}

function ensureAuditedGoalStatusFromWorkerEvents(input: {
  runtimeRoot: string
  threadId: string
  actorId: string
  wakeId: string
  observedAt: string
  triggerEventIds: string[]
  goalContext: CodexGoalSnapshot
  allEvents: StackThreadMetaEvent[]
  pendingEvents: StackThreadMetaEvent[]
}): void {
  if (!input.goalContext.objective) return
  if (hasGoalStatusSince(input.allEvents, input.observedAt)) return
  const audit = auditedGoalStatusUpdateFromWorkerEvents(input.allEvents, input.pendingEvents)
  if (!audit) return
  appendThreadMetaEvent(input.runtimeRoot, {
    event_id: stackEventId("monitor_goal_status"),
    type: "monitor.goal_status",
    thread_id: input.threadId,
    observed_at: new Date().toISOString(),
    actor_id: input.actorId,
    actor_role: "monitor",
    payload: {
      status: audit.status,
      headline: audit.status === "goal_met" ? "candidate clears target" : "done claim refuted",
      note: audit.note,
      for_human: true,
      metric: audit.metric,
      evidence_event_ids: input.triggerEventIds,
      wake_id: input.wakeId,
      source: "monitor_runtime_worker_audit",
    },
  })
}

function auditedGoalStatusUpdateFromWorkerEvents(
  allEvents: StackThreadMetaEvent[],
  pendingEvents: StackThreadMetaEvent[],
): { status: "goal_met" | "goal_failed"; note: string; metric: Record<string, number | string> } | undefined {
  const pendingText = pendingEvents.map(eventEvidenceText).join("\n")
  if (!/\b(done|complete|completion|marking\b[\s\S]{0,80}\bdone)\b/i.test(pendingText)) return undefined
  const candidate = latestNumberMatch(pendingText, /\b(?:candidate|cand[_-]?\w*)\b[\s\S]{0,120}?\b(?:scored|score|mean reward)\b[^\d]{0,40}(\d+(?:\.\d+)?)/i)
  if (candidate === undefined) return undefined
  const allText = allEvents.map(eventEvidenceText).join("\n")
  const baseline =
    latestNumberMatch(pendingText, /\bbaseline\b[\s\S]{0,80}?(?:=|:|at|score|reward)?\s*(\d+(?:\.\d+)?)/i) ??
    latestNumberMatch(allText, /\bbaseline\b[\s\S]{0,80}?(?:=|:|at|score|reward)?\s*(\d+(?:\.\d+)?)/i)
  if (!baseline || baseline <= 0) return undefined
  const requested2x = /\b2x\b/i.test(`${allText}\n${pendingText}`)
  if (!requested2x) return undefined
  const ratio = candidate / baseline
  const targetValue = baseline * 2
  const status = ratio >= 2 ? "goal_met" : "goal_failed"
  const note = status === "goal_met"
    ? `Worker completion claim audited: candidate scored ${candidate} vs baseline ${baseline}, which is ${ratio.toFixed(2)}x and clears the 2x target.`
    : `Worker completion claim refuted: candidate scored ${candidate} vs baseline ${baseline}, which is ${ratio.toFixed(2)}x; target is 2x (>=${targetValue.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}).`
  return {
    status,
    note,
    metric: {
      value: candidate,
      baseline,
      ratio: Number(ratio.toFixed(4)),
      target_ratio: 2,
      target_value: Number(targetValue.toFixed(4)),
      unit: "mean_reward",
    },
  }
}

function eventEvidenceText(event: StackThreadMetaEvent): string {
  const payload = event.payload as Record<string, unknown>
  return [
    event.type,
    payload.summary,
    payload.message,
    payload.stdout,
    payload.stderr,
    payload.command,
    payload.progress_note,
  ].filter((value): value is string => typeof value === "string").join("\n")
}

function latestNumberMatch(text: string, pattern: RegExp): number | undefined {
  const matches = [...text.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))]
  const value = matches.at(-1)?.[1]
  if (!value) return undefined
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function inferAuditedTerminalGoalStatus(text: string): "goal_met" | "goal_failed" | undefined {
  const normalized = text.toLowerCase()
  const auditLanguage = /\b(audit(?:ed)?|confirm(?:ed|s)?|supported by)\b/.test(normalized)
  if (!auditLanguage) return undefined
  if (
    /\b(refut(?:e|ed|es|ing)|false claim|does not clear|not (?:done|complete|enough)|short of (?:the )?target|below (?:the )?target)\b/.test(
      normalized,
    )
  ) {
    return "goal_failed"
  }
  const ratioMatch = normalized.match(/\b(\d+(?:\.\d+)?)\s*x\b/)
  const ratio = ratioMatch ? Number.parseFloat(ratioMatch[1] ?? "") : undefined
  const target2x = /\b2x\b/.test(normalized)
  if (ratio !== undefined && Number.isFinite(ratio) && ratio >= 2) return "goal_met"
  if (
    target2x &&
    /\b(clear(?:s|ed)?|support(?:s|ed)?|meet(?:s|ing)?)\b/.test(normalized) &&
    !/\bnot\b[\s\S]{0,24}\b(clear|support|meet)\b/.test(normalized)
  ) {
    return "goal_met"
  }
  return undefined
}

function taskAwareProgressSummary(text: string, goalContext: CodexGoalSnapshot): string {
  const clean = stripDirectivePrefix(text)
  const task = goalContext.taskContext
  const terms = task?.updateTerms ?? []
  if (terms.length === 0) return clean
  const mentionsTask = terms.some((term) => new RegExp(`\\b${escapeRegExpTerm(term)}\\b`, "i").test(clean))
  if (mentionsTask) return clean
  const label = task?.title ?? task?.taskType ?? task?.kind ?? "task"
  return `Worker is mid-task (${label}): ${lowercaseFirst(clean)}`
}

function escapeRegExpTerm(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function headlineForProgress(text: string): string {
  const clean = stripDirectivePrefix(text)
    .replace(/\bworker is\b/gi, "")
    .replace(/\bworker\b/gi, "")
    .replace(/\bin the\b/gi, "")
    .replace(/[:.].*$/, "")
    .replace(/\s+/g, " ")
    .trim()
  const words = (clean || "goal progress").split(/\s+/).filter(Boolean).slice(0, 5)
  return words.join(" ") || "goal progress"
}

function conservativeGoalStatusForProgress(text: string): string {
  const normalized = text.toLowerCase()
  if (
    /\b(refut(?:e|ed|es|ing)|false claim|does not clear|not (?:done|complete|enough)|short of (?:the )?target|below (?:the )?target)\b/.test(normalized)
  ) {
    return "goal_failed"
  }
  if (
    /\bgoal[_ ]met\b/.test(normalized) ||
    /\b(audit(?:ed)?|confirm(?:ed|s)?)\b[\s\S]{0,160}\b(goal (?:is )?complete|completion|clears? (?:the )?(?:requested )?(?:2x )?(?:bar|target)|cleared (?:the )?target)\b/.test(normalized)
  ) {
    return "goal_met"
  }
  if (/\b(stall(?:ed|ing)?|stuck|loop(?:ing)?|no progress|same failure|repeat(?:ed|ing) failure)\b/.test(normalized)) {
    return "stalled"
  }
  if (/\b(advanced|advancing|found|located|confirmed|score|baseline|candidate|leaderboard|scenario|parity|trace evidence|verifier)\b/.test(normalized)) {
    return "advancing"
  }
  return "working"
}

function goalStatusForProgressText(text: string): string {
  return inferAuditedTerminalGoalStatus(text) ?? conservativeGoalStatusForProgress(text)
}

function stripDirectivePrefix(text: string): string {
  return text.replace(/^\s*PROGRESS_UPDATE\s*:\s*/i, "").trim()
}

function lowercaseFirst(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return trimmed
  return `${trimmed.slice(0, 1).toLowerCase()}${trimmed.slice(1)}`
}

function compactGoalMetric(metric: Record<string, unknown>): string | undefined {
  const value = readNumber(metric.value)
  const baseline = readNumber(metric.baseline)
  const ratio = readNumber(metric.ratio) ?? (value !== undefined && baseline ? value / baseline : undefined)
  const targetRatio = readNumber(metric.target_ratio)
  const targetValue = readNumber(metric.target_value)
  const parts: string[] = []
  if (ratio !== undefined) parts.push(`${ratio.toFixed(2)}x`)
  if (value !== undefined) parts.push(baseline !== undefined ? `${value} vs ${baseline}` : String(value))
  if (targetRatio !== undefined) parts.push(`target ${targetRatio}x`)
  if (targetValue !== undefined) parts.push(`target >= ${targetValue}`)
  return parts.length > 0 ? parts.join(" · ") : undefined
}

export function isNoProgressAnnouncement(text: string): boolean {
  const t = text.trim().toLowerCase()
  const announcesNoProgress =
    /\bno (new |goal[- ]?relevant |goal |real )?(progress|benchmark|candidate|score|result)/.test(t) ||
    /\bnothing (new|to report|changed|has changed)/.test(t) ||
    /\bno (new )?(change|update)\b/.test(t)
  if (!announcesNoProgress) return false
  // Preserve updates that also carry real signal: a refutation, a criterion transition, a concrete
  // number, or a CONCERN (blocked/stuck/stalled/off-goal/error) — concerns are exactly what the
  // operator needs, so a "no results yet, but blocked on X" line must NOT be swallowed as noise.
  const carriesSignal =
    /\brefut|done[- ]?claim|criterion|meets?\b|below|above|threshold|\d\.\d/.test(t) ||
    /\bblock|stuck|stall|off[- ]goal|error|fail|missing|unable|cannot|can.t|credential|permission|timeout|denied/.test(t)
  return !carriesSignal
}

function normalizedMonitorSummary(summary: string): string {
  return isNoProgressAnnouncement(summary) || isInternalNoHumanUpdateSummary(summary) ? "NO_USER_UPDATE" : summary
}

function isInternalNoHumanUpdateSummary(summary: string): boolean {
  const normalized = summary.trim().toLowerCase()
  if (!normalized) return true
  return (
    /\bdid not post (?:a )?(?:human-facing )?update\b/.test(normalized) ||
    /\bdid not call [`']?stack_monitor_goal_status/.test(normalized) ||
    /\breviewing the worker.?s last turn\b/.test(normalized) ||
    /\bcheckpoint (?:the )?sidecar state\b/.test(normalized) ||
    /\bpause this wake\b/.test(normalized) ||
    /\bno human-facing update\b/.test(normalized) ||
    /\bno human update was warranted\b/.test(normalized) ||
    /\bno operator update was needed\b/.test(normalized) ||
    /\bno operator update was posted\b/.test(normalized) ||
    /\bno update was needed\b/.test(normalized) ||
    /\broutine workspace listing\b/.test(normalized) ||
    /\broutine repo-root listing\b/.test(normalized) ||
    /\bworkspace directory listing\b/.test(normalized) ||
    /\bonly listed the workspace root\b/.test(normalized) ||
    /\broutine discovery rather than a goal milestone\b/.test(normalized) ||
    /\bno milestone or phase change to report\b/.test(normalized) ||
    /\bno (?:task-specific |meaningful )?(?:milestone|blocker|concern)(?: or (?:task-specific |meaningful )?(?:milestone|blocker|concern))* to report\b/.test(normalized) ||
    /\bstill in orientation mode\b/.test(normalized) ||
    /\bonly (?:listed|read|grepped|inspected) .*\bnot (?:yet )?(?:a )?(?:task-specific |meaningful )?(?:milestone|progress)\b/.test(normalized)
  )
}

function directiveLine(text: string, label: string): string | undefined {
  const pattern = new RegExp(`^\\s*${label}\\s*:\\s*(.+?)\\s*$`, "im")
  const match = text.match(pattern)
  const value = match?.[1]?.trim()
  return value || undefined
}

function actorStateFromConfig(
  config: StackMonitorConfig,
  threadId: string,
  options: {
    previous?: StackMonitorActorRuntimeState
    state?: StackMonitorActorRuntimeState["state"]
    strictness?: MonitorStrictness
    lastEventId?: string
    lastEventType?: string
    lastWakeId?: string
    monitorThreadId?: string
    monitorCodexThreadId?: string
    monitorCodexWaitingForRestart?: boolean
    monitorCodexLastPauseReason?: string
    rollingSummary?: string
    severity?: MonitorSeverity
    wakeDelta?: number
    queueDelta?: number
    contextPushDelta?: number
    steerDelta?: number
    lastStartedAt?: string
    lastCompletedAt?: string
    lastErrorAt?: string
  } = {},
): StackMonitorActorRuntimeState {
  const previous = options.previous
  const strictness = options.strictness ?? previous?.strictness ?? config.strictness
  return {
    schema: "stack/monitor-actor-state/v1",
    thread_id: threadId,
    monitor_actor_id: monitorActorId(config),
    monitor_thread_id: options.monitorThreadId ?? previous?.monitor_thread_id,
    monitor_codex_thread_id: options.monitorCodexThreadId ?? previous?.monitor_codex_thread_id,
    monitor_codex_waiting_for_restart:
      options.monitorCodexWaitingForRestart ?? previous?.monitor_codex_waiting_for_restart,
    monitor_codex_last_pause_reason:
      options.monitorCodexLastPauseReason ?? previous?.monitor_codex_last_pause_reason,
    next_wake_on: previous?.next_wake_on,
    state: options.state ?? previous?.state ?? (strictness === "off" ? "paused" : "idle"),
    mode: strictness,
    strictness,
    focus_selection: config.focusSelection,
    focus: config.focus,
    last_event_id: options.lastEventId ?? previous?.last_event_id,
    last_event_type: options.lastEventType ?? previous?.last_event_type,
    last_wake_id: options.lastWakeId ?? previous?.last_wake_id,
    rolling_summary: options.rollingSummary ?? previous?.rolling_summary,
    last_severity: options.severity ?? previous?.last_severity,
    wake_counts: (previous?.wake_counts ?? 0) + (options.wakeDelta ?? 0),
    queue_counts: (previous?.queue_counts ?? 0) + (options.queueDelta ?? 0),
    steer_counts: (previous?.steer_counts ?? 0) + (options.steerDelta ?? 0),
    skill_read_counts: previous?.skill_read_counts ?? 0,
    context_push_counts: (previous?.context_push_counts ?? 0) + (options.contextPushDelta ?? 0),
    last_started_at: options.lastStartedAt ?? previous?.last_started_at,
    last_completed_at: options.lastCompletedAt ?? previous?.last_completed_at,
    last_error_at: options.lastErrorAt ?? previous?.last_error_at,
    budgets: {
      max_wakes_per_primary_turn: config.wake.maxWakesPerPrimaryTurn,
    },
    model: {
      provider: config.model.provider,
      model: config.model.model,
      reasoning_effort: config.model.reasoningEffort,
    },
  }
}

function readMonitorActorState(
  stackRoot: string,
  threadId: string,
  actorId: string,
): StackMonitorActorRuntimeState | undefined {
  const path = monitorActorStatePath(stackRoot, threadId, actorId)
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as StackMonitorActorRuntimeState
    if (parsed?.schema === "stack/monitor-actor-state/v1") return parsed
  } catch {
    return undefined
  }
  return undefined
}

function writeMonitorActorState(stackRoot: string, state: StackMonitorActorRuntimeState): string {
  const path = monitorActorStatePath(stackRoot, state.thread_id, state.monitor_actor_id)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf8")
  return path
}

function monitorActorStatePath(stackRoot: string, threadId: string, actorId: string): string {
  return join(stackRoot, ".stack", "actors", safePathSegment(threadId), "monitors", `${safePathSegment(actorId)}.json`)
}

function relativeActorStatePath(threadId: string, actorId: string): string {
  return join(".stack", "actors", safePathSegment(threadId), "monitors", `${safePathSegment(actorId)}.json`)
}

function safePathSegment(value: string): string {
  const safe = value.trim().replace(/[^A-Za-z0-9_.-]/g, "_")
  if (!safe || safe === "." || safe === "..") throw new Error(`invalid path segment: ${value}`)
  return safe
}

function runFocusChecks(
  config: StackMonitorConfig,
  input: {
    turn: StackCodexTurn
    agentContext: AgentContextSnapshot
    goalContext: CodexGoalSnapshot
  },
): FocusCheck[] {
  return [
    checkStyle(config, input.turn),
    checkGoalProgress(config, input.goalContext),
    checkSkills(config, input.agentContext, input.turn),
    checkToolUse(config, input.turn),
    checkScopeControl(config, input.turn),
    checkAcceptance(config, input.turn, input.goalContext),
  ]
}

function checkStyle(config: StackMonitorConfig, turn: StackCodexTurn): FocusCheck {
  if (!config.focus.style) return disabled("style")
  const violations = detectSynthStyleViolations(turn)
  if (violations.length > 0) {
    const first = violations[0]!
    return {
      focus: "style",
      status: "fail",
      severity: severityForStyleViolation(first.id),
      summary: first.summary,
      evidence: `${first.id}: ${first.match}`,
    }
  }
  const text = `${turn.prompt}\n${turn.stdout}\n${turn.stderr}`.toLowerCase()
  if (text.includes("eslint") && (text.includes("error") || text.includes("failed"))) {
    return {
      focus: "style",
      status: "warn",
      severity: "medium",
      summary: "style/tooling issue mentioned in turn output",
      evidence: "eslint/style failure text observed",
    }
  }
  return pass("style", "no obvious style drift")
}

function checkGoalProgress(config: StackMonitorConfig, goal: CodexGoalSnapshot): FocusCheck {
  if (!config.focus.goal_progress) return disabled("goal_progress")
  if (!goal.objective) return {
    focus: "goal_progress",
    status: "warn",
    severity: config.strictness === "aggressive" ? "medium" : "low",
    summary: "no active goal context visible to monitor",
  }
  if (goal.status === "blocked") return {
    focus: "goal_progress",
    status: "fail",
    severity: "high",
    summary: "goal status is blocked",
    evidence: goal.blockers?.slice(0, 2).join(" · "),
  }
  if (goal.status && goal.status !== "active") return {
    focus: "goal_progress",
    status: "warn",
    severity: "medium",
    summary: `goal status is ${goal.status}`,
  }
  const criteria = criteriaProgressFromGoal(goal)
  return pass(
    "goal_progress",
    criteria.total > 0
      ? `active goal context visible · ${criteria.done}/${criteria.total} criteria`
      : "active goal context visible",
  )
}

function checkSkills(config: StackMonitorConfig, context: AgentContextSnapshot, turn: StackCodexTurn): FocusCheck {
  if (!config.focus.skills || !config.skills.enabled) return disabled("skills")
  const text = `${turn.prompt}\n${turn.stdout}`.toLowerCase()
  const likelyNeedsSkill = text.includes("gepa") || text.includes("synth")
  if (likelyNeedsSkill && context.usedSkills.length === 0) {
    return {
      focus: "skills",
      status: "warn",
      severity: config.strictness === "aggressive" ? "medium" : "low",
      summary: "turn appears to need Stack/Synth skills but no skill use was detected (load oss-gepa or gepa)",
      evidence: "GEPA/Synth keyword without used skill event",
    }
  }
  return pass("skills", context.usedSkills.length > 0 ? "skill use detected" : "no skill need detected")
}

function checkToolUse(config: StackMonitorConfig, turn: StackCodexTurn): FocusCheck {
  if (!config.focus.tool_use) return disabled("tool_use")
  if ((turn.exitCode ?? 0) !== 0) {
    return {
      focus: "tool_use",
      status: "fail",
      severity: "high",
      summary: `turn exited ${turn.exitCode}`,
      evidence: turn.stderr ? truncate(turn.stderr.replace(/\s+/g, " "), 160) : "non-zero exit code",
    }
  }
  return pass("tool_use", "turn completed")
}

function checkScopeControl(config: StackMonitorConfig, turn: StackCodexTurn): FocusCheck {
  if (!config.focus.scope_control) return disabled("scope_control")
  const text = `${turn.prompt}\n${turn.stdout}`.toLowerCase()
  if (text.includes("git reset --hard") || text.includes("git stash")) {
    return {
      focus: "scope_control",
      status: "fail",
      severity: "high",
      summary: "destructive or disallowed git workflow mentioned",
      evidence: "git reset/stash text observed",
    }
  }
  return pass("scope_control", "no obvious scope violation")
}

function checkAcceptance(config: StackMonitorConfig, turn: StackCodexTurn, goal: CodexGoalSnapshot): FocusCheck {
  if (!config.focus.acceptance) return disabled("acceptance")
  const criteria = criteriaProgressFromGoal(goal)
  if (criteria.total > 0) {
    return pass("acceptance", `manifest criteria ${criteria.done}/${criteria.total} complete`)
  }
  const text = `${turn.prompt}\n${turn.stdout}`.toLowerCase()
  if (text.includes("acceptance") && !text.includes("passed") && !text.includes("green")) {
    return {
      focus: "acceptance",
      status: "warn",
      severity: config.strictness === "aggressive" ? "medium" : "low",
      summary: "acceptance was mentioned without an obvious pass signal",
    }
  }
  return pass("acceptance", "no acceptance concern")
}

function combineSeverity(config: StackMonitorConfig, checks: FocusCheck[]): MonitorSeverity {
  const enabled = checks.filter((check) => check.status !== "disabled")
  if (enabled.length === 0) return "none"
  if (config.focusSelection === "all") {
    const active = enabled.filter((check) => check.status === "warn" || check.status === "fail")
    if (active.length !== enabled.length) return "none"
    return active.reduce<MonitorSeverity>((severity, check) => maxSeverity(severity, check.severity), "none")
  }
  return enabled.reduce<MonitorSeverity>((severity, check) => maxSeverity(severity, check.severity), "none")
}

function queueItemsFor(config: StackMonitorConfig, checks: FocusCheck[]): Record<string, unknown>[] {
  if (config.strictness === "passive") return []
  return checks
    .filter((check) => check.status === "warn" || check.status === "fail")
    .filter((check) => severityRank(check.severity) >= severityRank(queueThreshold(config)))
    .map((check) => ({
      severity: check.severity,
      focus: check.focus,
      summary: check.summary,
      evidence: check.evidence ?? null,
    }))
}

function queueThreshold(config: StackMonitorConfig): MonitorSeverity {
  if (config.strictness === "aggressive") return "low"
  return "medium"
}

function skillContextPushDecisions(input: {
  config: StackMonitorConfig
  pass: MonitorPassResult
  priorEvents: StackThreadMetaEvent[]
  pendingEvents: StackThreadMetaEvent[]
  triggerEventIds: string[]
  turn: StackCodexTurn
}): SkillContextPushDecision[] {
  if (!canPushSkillContext(input.config)) return []
  const skillCheck = input.pass.checks.find((check) => check.focus === "skills")
  if (!skillCheck || (skillCheck.status !== "warn" && skillCheck.status !== "fail")) return []
  const queuedSkill = input.pass.queueItems.some((item) => readString(item.focus) === "skills")
  if (!queuedSkill && !input.config.skills.pushWhenConfident && input.config.strictness !== "aggressive") return []
  const skillId = recommendedSkillForMonitorPush(input.config, input.pendingEvents, input.turn)
  if (!skillId || hasPushedSkill(input.priorEvents, skillId)) return []
  const evidenceEventIds = uniqueStrings([
    ...input.triggerEventIds,
    ...input.pendingEvents.map((event) => event.event_id),
  ])
  const reason = skillCheck.summary
  return [{
    skillId,
    reason,
    evidenceEventIds,
    message: [
      `Monitor suggests reading skill ${skillId}.`,
      `Reason: ${reason}.`,
      evidenceEventIds.length > 0 ? `Evidence events: ${evidenceEventIds.slice(0, 5).join(", ")}.` : "",
      "Apply only the relevant runbook guidance before the next action.",
    ].filter(Boolean).join("\n"),
  }]
}

function canPushSkillContext(config: StackMonitorConfig): boolean {
  if (!config.skills.enabled || !config.focus.skills) return false
  if (config.strictness === "off" || config.strictness === "passive") return false
  const policy = config.intervention.skillContextPush.trim().toLowerCase()
  return !["", "off", "never", "false", "disabled"].includes(policy)
}

function recommendedSkillForMonitorPush(
  config: StackMonitorConfig,
  events: StackThreadMetaEvent[],
  turn: StackCodexTurn,
): string | undefined {
  const text = [
    turn.prompt,
    turn.stdout,
    turn.stderr,
    ...events.map((event) => JSON.stringify(event.payload)),
  ].join("\n").toLowerCase()
  const allowed = config.skills.allowedSkillIds
  if (allowed.includes("synth-stack-productivity") && (text.includes("usesynth") || text.includes("hosted") || text.includes("smr") || text.includes("factory"))) {
    return "synth-stack-productivity"
  }
  if ((text.includes("hosted optimizer") || text.includes("hosted gepa") || text.includes("usesynth")) && allowed.includes("hosted-gepa")) {
    return "hosted-gepa"
  }
  if ((text.includes("synth-ai") || text.includes("container") || text.includes("rollout")) && allowed.includes("synth-ai")) {
    return "synth-ai"
  }
  if ((text.includes("gepa") || text.includes("synth-optimizers")) && allowed.includes("oss-gepa")) {
    return "oss-gepa"
  }
  if (text.includes("gepa") && allowed.includes("gepa")) {
    return "gepa"
  }
  if (text.includes("synth") && allowed.includes("synth-via-stack")) {
    return "synth-via-stack"
  }
  if (allowed.includes("stack-agent-bridge")) return "stack-agent-bridge"
  return allowed[0]
}

function hasPushedSkill(events: StackThreadMetaEvent[], skillId: string): boolean {
  return events.some((event) =>
    event.type === "monitor.skill_context_push" && readString(event.payload.skill_id) === skillId
  )
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function goalSnapshotFromContext(goal: CodexGoalSnapshot): Record<string, unknown> | null {
  if (!goal.objective && !goal.status && goal.tokensUsed === undefined && !goal.acceptanceCriteria?.length && !goal.blockers?.length) return null
  const criteria = criteriaProgressFromGoal(goal)
  return {
    objective: goal.objective ?? null,
    status: goal.status ?? "active",
    tokens_used: goal.tokensUsed ?? null,
    token_budget: goal.tokenBudget ?? null,
    acceptance_criteria: goal.acceptanceCriteria ?? [],
    blockers: goal.blockers ?? [],
    task_context: goal.taskContext ?? null,
    criteria_done: criteria.done,
    criteria_total: criteria.total,
    criteria_pct: criteria.pct,
    source: goal.source,
  }
}

function readOperatorUpdateFromRecord(record: Record<string, unknown> | undefined): MonitorOperatorUpdate | undefined {
  if (!record) return undefined
  const workingOn = readString(record.working_on)
  const strugglingWith = readString(record.struggling_with)
  const progressNote = readString(record.progress_note)
  const goalStatus = readString(record.goal_status)
  const trajectory = normalizeTrajectory(readString(record.trajectory))
  const criteriaProgress = readCriteriaProgress(asRecord(record.criteria_progress))
  const spendSnapshot = readSpendSnapshot(asRecord(record.spend_snapshot))
  const eta = readEtaBand(asRecord(record.eta))
  if (!workingOn && !strugglingWith && !progressNote && !goalStatus && !trajectory && !criteriaProgress && !spendSnapshot && !eta) return undefined
  return {
    working_on: workingOn,
    struggling_with: strugglingWith,
    progress_note: progressNote,
    goal_status: goalStatus,
    trajectory,
    criteria_progress: criteriaProgress,
    spend_snapshot: spendSnapshot,
    eta,
  }
}

function normalizeTrajectory(value: string | undefined): MonitorOperatorUpdate["trajectory"] | undefined {
  if (value === "on_track" || value === "stalled" || value === "regressed") return value
  return undefined
}

function readCriteriaProgress(record: Record<string, unknown> | undefined): CriteriaProgress | undefined {
  if (!record) return undefined
  const done = readNumber(record.done)
  const total = readNumber(record.total)
  const pct = readNumber(record.pct)
  if (done === undefined || total === undefined) return undefined
  return {
    done,
    total,
    pct: pct ?? (total > 0 ? Math.round((done / total) * 100) : 0),
    last_criterion: readString(record.last_criterion),
  }
}

function readSpendSnapshot(record: Record<string, unknown> | undefined): SpendSnapshot | undefined {
  if (!record) return undefined
  return {
    elapsed_s: readNumber(record.elapsed_s) ?? 0,
    worker_usd: readNumber(record.worker_usd) ?? 0,
    monitor_usd: readNumber(record.monitor_usd) ?? 0,
    worker_tokens: readNumber(record.worker_tokens) ?? 0,
    monitor_tokens: readNumber(record.monitor_tokens) ?? 0,
  }
}

function readEtaBand(record: Record<string, unknown> | undefined): EtaBand | undefined {
  if (!record) return undefined
  const confidence = readString(record.confidence)
  const low = readNumber(record.remaining_minutes_low)
  const high = readNumber(record.remaining_minutes_high)
  const rationale = readString(record.rationale)
  if ((confidence !== "low" && confidence !== "med" && confidence !== "high") || low === undefined || high === undefined || !rationale) {
    return undefined
  }
  return {
    confidence,
    remaining_minutes_low: low,
    remaining_minutes_high: high,
    rationale,
  }
}

function criteriaProgressFromGoal(goal: CodexGoalSnapshot): CriteriaProgress {
  const criteria = goal.acceptanceCriteria ?? []
  let done = 0
  let lastCriterion: string | undefined
  for (const criterion of criteria) {
    const parsed = parseCriterionEntry(criterion)
    if (parsed.done) {
      done += 1
      lastCriterion = parsed.label
    }
  }
  return {
    done,
    total: criteria.length,
    pct: criteria.length > 0 ? Math.round((done / criteria.length) * 100) : 0,
    last_criterion: lastCriterion,
  }
}

function snapshotFromEvents(
  config: StackMonitorConfig,
  events: StackThreadMetaEvent[],
  actorState?: StackMonitorActorRuntimeState,
): StackMonitorSnapshot {
  const effective = effectiveMonitorState(config, events)
  const monitorEvents = events.filter((event) => event.actor_role === "monitor" || event.type.startsWith("monitor."))
  const summaries = events.filter((event) => event.type === "monitor.summary")
  const latestSummary = summaries.at(-1)
  const usage = monitorUsageSummary(events, actorState?.model.model ?? config.model.model)
  const focus = asRecord(latestSummary?.payload.focus_results)
  return {
    enabled: effective.enabled,
    actorId: monitorActorId(config),
    label: config.label,
    runtime: usage.runtime ?? "codex-app-server",
    model: actorState?.model.model ?? config.model.model,
    reasoningEffort: actorState?.model.reasoning_effort ?? config.model.reasoningEffort,
    strictness: effective.strictness,
    status: monitorStatus(config, events, actorState),
    lastSummary: actorState?.rolling_summary ?? readString(latestSummary?.payload.summary),
    lastSeverity: actorState?.last_severity ?? normalizeSeverity(readString(latestSummary?.payload.severity), "none"),
    lastWakeReason: readString(events.filter((event) => event.type === "monitor.wake").at(-1)?.payload.wake_reason),
    lastEventAt: actorState?.last_completed_at ?? actorState?.last_started_at ?? monitorEvents.at(-1)?.observed_at,
    lastEventId: actorState?.last_event_id,
    lastWakeId: actorState?.last_wake_id,
    wakeCount: actorState?.wake_counts ?? events.filter((event) => event.type === "monitor.wake").length,
    queuedCount:
      (actorState?.queue_counts ?? events.filter((event) => event.type === "monitor.queued").length) +
      events.filter((event) => event.type === "monitor.trigger_queued").length,
    skillReadCount: events.filter((event) => event.type === "skill.read").length,
    contextPushCount: events.filter((event) => event.type === "monitor.skill_context_push").length,
    threadSpendUsd: usage.spendUsd,
    focusResults: focusResultsFromRecord(focus),
    modeSource: effective.source,
  }
}

function monitorUsageSummary(
  events: StackThreadMetaEvent[],
  model: string,
): { runtime?: string; spendUsd: number; inputTokens: number; outputTokens: number } {
  const usageEvents = events.filter((event) => event.type === "monitor.usage")
  const totals = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  }
  let recordedSpendUsd = 0
  let runtime: string | undefined
  for (const event of usageEvents) {
    runtime = readString(event.payload.source) ?? runtime
    totals.inputTokens += readNumber(event.payload.input_tokens) ?? 0
    totals.cachedInputTokens += readNumber(event.payload.cached_input_tokens) ?? 0
    totals.outputTokens += readNumber(event.payload.output_tokens) ?? 0
    totals.reasoningOutputTokens += readNumber(event.payload.reasoning_output_tokens) ?? 0
    recordedSpendUsd += readNumber(event.payload.estimated_spend_usd) ?? 0
  }
  const estimatedSpendUsd = estimateUsageSpendUsd(totals, model)
  const spendUsd = recordedSpendUsd > 0 ? recordedSpendUsd : estimatedSpendUsd ?? 0
  return { runtime, spendUsd, inputTokens: totals.inputTokens, outputTokens: totals.outputTokens }
}

function monitorStatus(
  config: StackMonitorConfig,
  events: StackThreadMetaEvent[],
  actorState?: StackMonitorActorRuntimeState,
): StackMonitorSnapshot["status"] {
  const effective = effectiveMonitorState(config, events)
  if (!effective.enabled) return "off"
  if (actorState?.state === "running") return "running"
  if (actorState?.state === "paused") return "paused"
  if (actorState?.state === "error") return "error"
  if (hasQueuedTriggerAfterLatestWake(events)) return "queued"
  if (events.some((event) => event.type === "monitor.queued")) return "queued"
  if (actorState?.state === "idle") return "idle"
  if (events.some((event) => event.type === "monitor.summary")) return "summarized"
  return "watching"
}

function hasQueuedTriggerAfterLatestWake(events: StackThreadMetaEvent[]): boolean {
  let latestWakeIndex = -1
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === "monitor.wake") {
      latestWakeIndex = index
      break
    }
  }
  return events.slice(latestWakeIndex + 1).some((event) => event.type === "monitor.trigger_queued")
}

function effectiveMonitorState(
  config: StackMonitorConfig,
  events: StackThreadMetaEvent[],
): { enabled: boolean; strictness: MonitorStrictness; source: "config" | "thread" } {
  const modeEvent = events
    .filter((event) => event.type === "monitor.paused" || event.type === "monitor.resumed" || event.type === "monitor.mode_changed")
    .at(-1)
  const strictness = normalizeStrictness(readString(modeEvent?.payload.strictness), config.strictness)
  if (modeEvent) return { enabled: strictness !== "off", strictness, source: "thread" }
  return { enabled: config.enabled && config.strictness !== "off", strictness: config.strictness, source: "config" }
}

function nextStrictness(current: MonitorStrictness): MonitorStrictness {
  switch (current) {
    case "off":
      return "passive"
    case "passive":
      return "conservative"
    case "conservative":
      return "aggressive"
    case "aggressive":
      return "off"
  }
}

function mergeMonitorConfig(base: StackMonitorConfig, parsed: Record<string, Record<string, unknown>>): StackMonitorConfig {
  return {
    ...base,
    id: readString(parsed.monitor?.id) ?? base.id,
    label: readString(parsed.monitor?.label) ?? base.label,
    enabled: readBoolean(parsed.monitor?.enabled) ?? base.enabled,
    mode: readString(parsed.monitor?.mode) ?? base.mode,
    policy: readString(parsed.monitor?.policy) ?? base.policy,
    strictness: normalizeStrictness(readString(parsed.monitor?.strictness), base.strictness),
    focusSelection: normalizeSelection(readString(parsed.focus?.selection), base.focusSelection),
    focus: {
      style: readBoolean(parsed.focus?.style) ?? base.focus.style,
      goal_progress: readBoolean(parsed.focus?.goal_progress) ?? base.focus.goal_progress,
      skills: readBoolean(parsed.focus?.skills) ?? base.focus.skills,
      tool_use: readBoolean(parsed.focus?.tool_use) ?? base.focus.tool_use,
      scope_control: readBoolean(parsed.focus?.scope_control) ?? base.focus.scope_control,
      acceptance: readBoolean(parsed.focus?.acceptance) ?? base.focus.acceptance,
    },
    model: {
      provider: readString(parsed.model?.provider) ?? base.model.provider,
      model: readString(parsed.model?.model) ?? base.model.model,
      reasoningEffort: readString(parsed.model?.reasoning_effort) ?? base.model.reasoningEffort,
    },
    prompt: mergeActorPrompt(base.prompt, parsed),
    wake: {
      maxWakesPerPrimaryTurn: readNumber(parsed.wake?.max_wakes_per_primary_turn) ?? base.wake.maxWakesPerPrimaryTurn,
      onTurnCompleted: readBoolean(parsed.wake?.on_turn_completed) ?? base.wake.onTurnCompleted,
      onToolCompleted: readBoolean(parsed.wake?.on_tool_completed) ?? base.wake.onToolCompleted,
      onToolFailed: readBoolean(parsed.wake?.on_tool_failed) ?? base.wake.onToolFailed,
      eventBatchSize: readNumber(parsed.wake?.event_batch_size) ?? base.wake.eventBatchSize,
      eventBatchMinIntervalMs:
        readNumber(parsed.wake?.event_batch_min_interval_ms) ?? base.wake.eventBatchMinIntervalMs,
      defaultIntervalMs: readNumber(parsed.wake?.default_interval_ms) ?? base.wake.defaultIntervalMs,
      staleWorkerIntervalMs: readNumber(parsed.wake?.stale_worker_interval_ms) ?? base.wake.staleWorkerIntervalMs,
      deltaEvents: readNumber(parsed.wake?.delta_events) ?? base.wake.deltaEvents,
      cooldownMs: readNumber(parsed.wake?.cooldown_ms) ?? base.wake.cooldownMs,
      weightThreshold: readNumber(parsed.wake?.weight_threshold) ?? base.wake.weightThreshold,
      turnCooldownMs: readNumber(parsed.wake?.turn_cooldown_ms) ?? base.wake.turnCooldownMs,
      batchCooldownMs: readNumber(parsed.wake?.batch_cooldown_ms) ?? base.wake.batchCooldownMs,
      maxDelayMs: readNumber(parsed.wake?.max_delay_ms) ?? base.wake.maxDelayMs,
      policyScript: readString(parsed.wake?.policy_script) ?? base.wake.policyScript,
      montyPythonBin: readString(parsed.wake?.monty_python_bin) ?? base.wake.montyPythonBin,
    },
    intervention: {
      maxQueuedItemsPerThread:
        readNumber(parsed.intervention?.max_queued_items_per_thread) ?? base.intervention.maxQueuedItemsPerThread,
      skillContextPush: readString(parsed.intervention?.skill_context_push) ?? base.intervention.skillContextPush,
    },
    skills: {
      enabled: readBoolean(parsed.skills?.enabled) ?? base.skills.enabled,
      allowedSkillIds: readStringArray(parsed.skills?.allowed_skill_ids) ?? base.skills.allowedSkillIds,
      pushWhenConfident: readBoolean(parsed.skills?.push_when_confident) ?? base.skills.pushWhenConfident,
    },
    tools: mergeActorTools(base.tools, parsed),
    permissions: {
      queue: readBoolean(parsed.permissions?.queue) ?? base.permissions.queue,
      steer: readBoolean(parsed.permissions?.steer) ?? base.permissions.steer,
      skillPush: readBoolean(parsed.permissions?.skill_push) ?? base.permissions.skillPush,
      pauseWorker: readBoolean(parsed.permissions?.pause_worker) ?? base.permissions.pauseWorker,
      blockBeforeAction: readBoolean(parsed.permissions?.block_before_action) ?? base.permissions.blockBeforeAction,
    },
    handoffPreempt: {
      enabled: readBoolean(parsed.handoff_preempt?.enabled) ?? base.handoffPreempt.enabled,
      wakeOnContextPressure:
        readBoolean(parsed.handoff_preempt?.wake_on_context_pressure) ?? base.handoffPreempt.wakeOnContextPressure,
      contextTokenThreshold:
        readNumber(parsed.handoff_preempt?.context_token_threshold) ?? base.handoffPreempt.contextTokenThreshold,
      contextFractionThreshold:
        readNumber(parsed.handoff_preempt?.context_fraction_threshold) ?? base.handoffPreempt.contextFractionThreshold,
      turnThreshold: readNumber(parsed.handoff_preempt?.turn_threshold) ?? base.handoffPreempt.turnThreshold,
      idleBeforePreemptMs:
        readNumber(parsed.handoff_preempt?.idle_before_preempt_ms) ?? base.handoffPreempt.idleBeforePreemptMs,
      minTurnsBeforePreempt:
        readNumber(parsed.handoff_preempt?.min_turns_before_preempt) ?? base.handoffPreempt.minTurnsBeforePreempt,
      maxPreemptsPerSegment:
        readNumber(parsed.handoff_preempt?.max_preempts_per_segment) ?? base.handoffPreempt.maxPreemptsPerSegment,
      cooldownMs: readNumber(parsed.handoff_preempt?.cooldown_ms) ?? base.handoffPreempt.cooldownMs,
      requireMetaThread:
        readBoolean(parsed.handoff_preempt?.require_meta_thread) ?? base.handoffPreempt.requireMetaThread,
      successorRole: readString(parsed.handoff_preempt?.successor_role) ?? base.handoffPreempt.successorRole,
      successorRoleName:
        readString(parsed.handoff_preempt?.successor_role_name) ?? base.handoffPreempt.successorRoleName,
      successorModel: readString(parsed.handoff_preempt?.successor_model) ?? base.handoffPreempt.successorModel,
      successorReasoningEffort:
        readString(parsed.handoff_preempt?.successor_reasoning_effort) ??
        base.handoffPreempt.successorReasoningEffort,
      autoSeal: readBoolean(parsed.handoff_preempt?.auto_seal) ?? base.handoffPreempt.autoSeal,
      autoApprove: readBoolean(parsed.handoff_preempt?.auto_approve) ?? base.handoffPreempt.autoApprove,
      autoContinue: readBoolean(parsed.handoff_preempt?.auto_continue) ?? base.handoffPreempt.autoContinue,
      pauseWorkerBeforeSeal:
        readBoolean(parsed.handoff_preempt?.pause_worker_before_seal) ?? base.handoffPreempt.pauseWorkerBeforeSeal,
      segmentPolicyFile:
        readString(parsed.handoff_preempt?.segment_policy_file) ?? base.handoffPreempt.segmentPolicyFile,
    },
  }
}

function assertMonitorProviderSupported(config: StackMonitorConfig): void {
  const provider = config.model.provider.trim().toLowerCase()
  if (provider === "openai" || provider === "codex") return
  throw new Error(
    `monitor model provider '${config.model.provider}' is not executable yet; Stack currently runs monitor through Codex app-server. Use stack_inference_catalog for catalog visibility, and do not configure Synth inference profiles until the direct execution path lands.`,
  )
}

function defaultMonitorToml(): string {
  return [
    "[monitor]",
    'id = "default"',
    'label = "Monitor"',
    "enabled = true",
    'mode = "observe_summarize_queue_steer"',
    'policy = "conservative"',
    'strictness = "conservative"',
    "",
    "[focus]",
    'selection = "any"',
    "style = true",
    "goal_progress = true",
    "skills = true",
    "tool_use = true",
    "scope_control = true",
    "acceptance = true",
    "",
    "[model]",
    'provider = "openai"',
    'model = "gpt-5.4-mini"',
    'reasoning_effort = "medium"',
    "",
    "[prompt]",
    'system_file = ".stack/monitors/default.system.md"',
    "",
    "[wake]",
    "max_wakes_per_primary_turn = 6",
    "on_turn_completed = true",
    "on_tool_completed = true",
    "on_tool_failed = true",
    "event_batch_size = 4",
    "event_batch_min_interval_ms = 12000",
    "default_interval_ms = 90000",
    "stale_worker_interval_ms = 300000",
    "delta_events = 8",
    "weight_threshold = 6",
    "cooldown_ms = 15000",
    "turn_cooldown_ms = 15000",
    "batch_cooldown_ms = 60000",
    "max_delay_ms = 120000",
    'policy_script = "scripts/monitor_wake_policy.py"',
    'monty_python_bin = "python3"',
    "",
    "[intervention]",
    "max_queued_items_per_thread = 8",
    'skill_context_push = "queue_or_steer"',
    "",
    "[skills]",
    "enabled = true",
    'allowed_skill_ids = ["synth-stack-productivity", "oss-gepa", "hosted-gepa", "synth-ai", "gepa", "stack-agent-bridge", "synth-via-stack"]',
    "push_when_confident = false",
    "",
    "[tools]",
    'allow = ["guidance.search", "skills.push_context", "skills.suggest", "monitor.queue", "monitor.steer"]',
    'deny = ["codex.interrupt"]',
    "",
    "[handoff_preempt]",
    "enabled = false",
    "wake_on_context_pressure = true",
    "context_token_threshold = 100000",
    "context_fraction_threshold = 0.75",
    "turn_threshold = 0",
    "idle_before_preempt_ms = 0",
    "min_turns_before_preempt = 6",
    "max_preempts_per_segment = 1",
    "cooldown_ms = 300000",
    "require_meta_thread = true",
    'successor_role = "same"',
    'successor_role_name = ""',
    'successor_model = ""',
    'successor_reasoning_effort = ""',
    "auto_seal = true",
    "auto_approve = false",
    "auto_continue = false",
    "pause_worker_before_seal = true",
    'segment_policy_file = ".stack/meta-threads/segment-policy.toml"',
    "",
    "[permissions]",
    "queue = true",
    "steer = true",
    "skill_push = true",
    "pause_worker = false",
    "block_before_action = false",
  ].join("\n")
}

function focusResults(checks: FocusCheck[]): Record<MonitorFocusName, MonitorFocusStatus> {
  return Object.fromEntries(checks.map((check) => [check.focus, check.status])) as Record<MonitorFocusName, MonitorFocusStatus>
}

function focusResultsFromRecord(record: Record<string, unknown> | undefined): Partial<Record<MonitorFocusName, MonitorFocusStatus>> {
  if (!record) return {}
  const result: Partial<Record<MonitorFocusName, MonitorFocusStatus>> = {}
  for (const key of ["style", "goal_progress", "skills", "tool_use", "scope_control", "acceptance"] as const) {
    const value = readString(record[key])
    if (value === "pass" || value === "warn" || value === "fail" || value === "disabled") result[key] = value
  }
  return result
}

function pass(focus: MonitorFocusName, summary: string): FocusCheck {
  return { focus, status: "pass", severity: "none", summary }
}

function disabled(focus: MonitorFocusName): FocusCheck {
  return { focus, status: "disabled", severity: "none", summary: "disabled" }
}

function monitorActorId(config: StackMonitorConfig): string {
  return `monitor_${config.id}`
}

function normalizeStrictness(value: string | undefined, defaultValue: MonitorStrictness): MonitorStrictness {
  if (value === "off" || value === "passive" || value === "conservative" || value === "aggressive") return value
  return defaultValue
}

function normalizeSelection(value: string | undefined, defaultValue: "any" | "all"): "any" | "all" {
  return value === "any" || value === "all" ? value : defaultValue
}

function normalizeSeverity(value: string | undefined, defaultValue: MonitorSeverity): MonitorSeverity {
  if (value === "none" || value === "low" || value === "medium" || value === "high") return value
  return defaultValue
}

function normalizeFocusStatus(value: string | undefined, defaultValue: MonitorFocusStatus): MonitorFocusStatus {
  if (value === "pass" || value === "warn" || value === "fail" || value === "disabled") return value
  return defaultValue
}

function normalizeFocusName(value: string | undefined): MonitorFocusName | undefined {
  if (
    value === "style" ||
    value === "goal_progress" ||
    value === "skills" ||
    value === "tool_use" ||
    value === "scope_control" ||
    value === "acceptance"
  ) {
    return value
  }
  return undefined
}

function maxSeverity(left: MonitorSeverity, right: MonitorSeverity): MonitorSeverity {
  return severityRank(right) > severityRank(left) ? right : left
}

function severityRank(severity: MonitorSeverity): number {
  switch (severity) {
    case "high":
      return 3
    case "medium":
      return 2
    case "low":
      return 1
    case "none":
      return 0
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function truncate(value: string, maxWidth: number): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxWidth) return normalized
  return `${normalized.slice(0, Math.max(0, maxWidth - 1))}…`
}

function shortId(value: string | undefined): string {
  if (!value) return "-"
  if (value.length <= 16) return value
  return value.slice(0, 16)
}
