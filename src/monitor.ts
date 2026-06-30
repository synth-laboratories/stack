import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { StackConfig } from "./config.js"
import { loadEnvironmentAuth } from "./config.js"
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
import { runMonitorCodexSidecarChatTurn, runMonitorCodexSidecarTurn } from "./monitor-sidecar-codex.js"
import type { StackCodexTurn, StackLocalSession } from "./session.js"
import {
  parseThreadNameFromAgentResponse,
  sanitizeThreadDisplayName,
  setThreadDisplayName,
} from "./thread-display-name.js"
import {
  actorToolAllowed,
  mergeActorModel,
  mergeActorPrompt,
  mergeActorTools,
  parseTomlLike,
  readBoolean,
  readNumber,
  readString,
  readStringArray,
  resolveActorPrompt,
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
    worker: "auto" | "deterministic" | "openai_responses" | "codex_app_server"
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
    worker: string
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
    worker: "auto",
  },
  prompt: {
    systemFile: ".stack/monitors/default.system.md",
  },
  wake: {
    maxWakesPerPrimaryTurn: 6,
    onTurnCompleted: true,
    onToolCompleted: true,
    onToolFailed: true,
    deltaEvents: 12,
    cooldownMs: 15_000,
    weightThreshold: 8,
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
    allowedSkillIds: ["synth-stack-productivity", "oss-gepa", "hosted-gepa", "synth-ai", "gepa", "stack-agent-bridge", "synth-via-stack", "stackeval"],
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
  const fallbackPath = ensureDefaultMonitorConfig(stackRoot)
  const parsed = parseTomlLike(readFileSync(existsSync(path) ? path : fallbackPath, "utf8"))
  const config = mergeMonitorConfig(DEFAULT_MONITOR_CONFIG, parsed)
  const enabledOverride = process.env.STACK_MONITOR_ENABLED?.trim()
  if (enabledOverride === "0" || enabledOverride === "false") config.enabled = false
  if (enabledOverride === "1" || enabledOverride === "true") config.enabled = true
  const strictnessOverride = process.env.STACK_MONITOR_STRICTNESS?.trim()
  if (strictnessOverride) config.strictness = normalizeStrictness(strictnessOverride, config.strictness)
  return config
}

export function emptyMonitorSnapshot(stackRoot: string): StackMonitorSnapshot {
  const config = loadMonitorConfig(stackRoot)
  const effective = effectiveMonitorState(config, [])
  return {
    enabled: effective.enabled,
    actorId: monitorActorId(config),
    label: config.label,
    runtime: config.model.worker,
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
  const operatorEvent = appendMonitorOperatorMessage(input.config.appRoot, input.session.id, input.message)
  if (shouldUseSidecarGoalChat(input.goalContext)) {
    const requestEvent = appendMonitorChatRequest({
      stackRoot: input.config.appRoot,
      session: input.session,
      message: input.message,
      goalContext: input.goalContext,
      operatorEventId: operatorEvent.event_id,
    })
    await appendMonitorChatReply({
      stackConfig: input.config,
      stackRoot: input.config.appRoot,
      session: input.session,
      message: input.message,
      goalContext: input.goalContext,
      requestEvent,
    })
    return {
      event: requestEvent,
      snapshot: refreshMonitorSnapshot(input.config.appRoot, input.session.id),
    }
  }
  const snapshot = await runMonitorForNewEvents({
    config: input.config,
    session: input.session,
    agentContext: input.agentContext,
    goalContext: input.goalContext,
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
  const criteriaRefs = criteriaRefsForQuestion(input.message, input.goalContext.acceptanceCriteria ?? [])
  const citedEvents = sidecarCitedEvents(context.delta_events)
  const deterministic = buildDeterministicSidecarChatReply({
    question: input.message,
    goalContext: input.goalContext,
    context,
    criteriaRefs,
    citedEvents,
  })
  const monitorConfig = loadMonitorConfig(input.stackRoot)
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
    deterministic,
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
      fallback_reason: reply.fallbackReason ?? null,
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
  source: "deterministic-runtime" | "openai-responses" | "synth-aux" | "codex-app-server"
  fallbackReason?: string
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
  deterministic: SidecarChatReplyResult
}): Promise<SidecarChatReplyResult> {
  let codexSidecarFallbackReason: string | undefined
  if (shouldUseCodexSidecar(input.config)) {
    try {
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
        deterministicAnswer: input.deterministic.answer,
      })
      const answer = codex.assistantText?.trim() || input.deterministic.answer
      return {
        ...input.deterministic,
        answer,
        source: "codex-app-server",
        monitorCodexThreadId: codex.codexThreadId,
      }
    } catch (error) {
      codexSidecarFallbackReason = error instanceof Error ? error.message : String(error)
      if (resolvedMonitorWorker(input.config) === "codex_app_server") {
        return {
          ...input.deterministic,
          fallbackReason: codexSidecarFallbackReason,
        }
      }
    }
  }
  if (!shouldUseModelWorker(input.config)) {
    return {
      ...input.deterministic,
      fallbackReason: codexSidecarFallbackReason,
    }
  }
  const inference = resolveMonitorInferenceEndpoint(input.config, input.stackConfig)
  if (!inference) {
    return {
      ...input.deterministic,
      fallbackReason: codexSidecarFallbackReason ?? monitorInferenceFallbackReason(input.config, input.stackConfig),
    }
  }
  try {
    const response = await fetch(inference.url, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${inference.apiKey}`,
        "content-type": "application/json",
        ...inference.headers,
      },
      body: JSON.stringify({
        model: input.config.model.model,
        reasoning: { effort: input.config.model.reasoningEffort },
        input: [
          {
            role: "developer",
            content: [{
              type: "input_text",
              text: resolveSidecarChatDeveloperPrompt(input.stackRoot, input.config),
            }],
          },
          {
            role: "user",
            content: [{
              type: "input_text",
              text: JSON.stringify(sidecarChatUserPayload(input), null, 2),
            }],
          },
        ],
      }),
    })
    const payload = await response.json().catch(() => undefined) as unknown
    if (!response.ok) {
      const label = inference.source === "synth-aux" ? "stack-aux" : "OpenAI"
      throw new Error(`${label} sidecar chat failed ${response.status}: ${truncate(JSON.stringify(payload ?? {}), 300)}`)
    }
    const parsed = parseFirstJsonObject(extractOpenAiOutputText(payload))
    const answer = readString(parsed?.answer)
    if (!answer) throw new Error("Sidecar chat response did not contain answer")
    const citedEventIds = readStringArray(parsed?.cited_event_ids) ?? []
    const criteriaRefs = readNumberArray(parsed?.criteria_refs)
    return {
      answer,
      citedEventIds: citedEventIds.length > 0 ? citedEventIds : input.deterministic.citedEventIds,
      criteriaRefs: criteriaRefs.length > 0 ? criteriaRefs : input.deterministic.criteriaRefs,
      operatorUpdate: readOperatorUpdateFromRecord(asRecord(parsed?.operator_update)) ?? input.deterministic.operatorUpdate,
      source: inference.source,
    }
  } catch (error) {
    return {
      ...input.deterministic,
      fallbackReason: error instanceof Error ? error.message : String(error),
    }
  }
}

function sidecarChatUserPayload(input: {
  question: string
  requestEvent: StackThreadMetaEvent
  goalContext: CodexGoalSnapshot
  context: SidecarChatContext
  config: StackMonitorConfig
}): Record<string, unknown> {
  return {
    question: input.question,
    request_event_id: input.requestEvent.event_id,
    mode: input.config.strictness,
    current_goal: input.goalContext,
    sidecar_context: serializableSidecarChatContext(input.context),
  }
}

function resolveSidecarChatDeveloperPrompt(stackRoot: string, config: StackMonitorConfig): string {
  return resolveActorPrompt(
    stackRoot,
    { ...config.prompt, systemFile: ".stack/monitors/progress-narrator-chat.system.md" },
    defaultSidecarChatBuiltinPrompt(),
  )
}

function defaultSidecarChatBuiltinPrompt(): string {
  return [
    "You are the Stack sidecar monitor answering the operator about a goal-pursuing coding agent.",
    "Answer from the provided current_goal and sidecar_context only; do not invent events.",
    "Reference the objective and at least one criterion or event id when available.",
    "Return only JSON: {\"answer\":\"...\",\"cited_event_ids\":[\"...\"],\"criteria_refs\":[1],\"operator_update\":{}}.",
  ].join("\n")
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

function sidecarCitedEvents(events: readonly StackThreadMetaEvent[]): StackThreadMetaEvent[] {
  return [...events]
    .reverse()
    .filter((event) =>
      event.type === "agent.tool.failed" ||
      event.type === "agent.error" ||
      event.type === "agent.tool.completed" ||
      event.type === "monitor.summary" ||
      event.type === "monitor.progress"
    )
    .slice(0, 3)
    .reverse()
}

function criteriaRefsForQuestion(question: string, criteria: readonly string[]): number[] {
  if (criteria.length === 0) return []
  const explicit = [...question.matchAll(/\bcriterion\s+(\d+)\b/gi)]
    .map((match) => Number.parseInt(match[1] ?? "", 10))
    .filter((index) => Number.isFinite(index) && index >= 1 && index <= criteria.length)
  if (explicit.length > 0) return [...new Set(explicit)]
  const firstOpen = criteria.findIndex((criterion) => !parseCriterionEntry(criterion).done)
  return [firstOpen >= 0 ? firstOpen + 1 : 1]
}

function buildDeterministicSidecarChatReply(input: {
  question: string
  goalContext: CodexGoalSnapshot
  context: SidecarChatContext
  criteriaRefs: number[]
  citedEvents: StackThreadMetaEvent[]
}): SidecarChatReplyResult {
  const objective = input.goalContext.objective?.trim() ?? "the active goal"
  const progress = input.context.criteria_progress
  const criterion = input.criteriaRefs[0]
    ? criterionText(input.goalContext.acceptanceCriteria ?? [], input.criteriaRefs[0])
    : undefined
  const latestUpdate = input.context.last_operator_updates.at(-1)
  const trajectory = latestUpdate?.trajectory ? latestUpdate.trajectory.replace(/_/g, " ") : "on track"
  const evidence = input.citedEvents[0]
    ? `${input.citedEvents[0].event_id} (${input.citedEvents[0].type})`
    : "no recent event id"
  const parts = [
    `For "${truncate(objective, 120)}", the sidecar sees ${progress.done}/${progress.total} criteria complete.`,
    criterion ? `Closest criterion: ${criterion}.` : undefined,
    latestUpdate?.progress_note ? `Latest progress: ${latestUpdate.progress_note}.` : input.context.last_tool_summary ? `Latest evidence: ${input.context.last_tool_summary}.` : undefined,
    input.context.worker_status === "error" || latestUpdate?.struggling_with
      ? `Concern: ${latestUpdate?.struggling_with ?? "latest worker event is an error"}.`
      : `Trajectory: ${trajectory}.`,
    `Evidence: ${evidence}.`,
  ]
  return {
    answer: parts.filter(Boolean).join(" "),
    citedEventIds: input.citedEvents.map((event) => event.event_id),
    criteriaRefs: input.criteriaRefs,
    operatorUpdate: input.context.last_operator_updates.at(-1),
    source: "deterministic-runtime",
  }
}

function criterionText(criteria: readonly string[], oneBasedIndex: number): string | undefined {
  const raw = criteria[oneBasedIndex - 1]
  if (!raw) return undefined
  const parsed = parseCriterionEntry(raw)
  return `${oneBasedIndex}. ${parsed.done ? "[x]" : "[ ]"} ${parsed.label}`
}

export async function runMonitorAfterTurn(input: {
  config: StackConfig
  session: StackLocalSession
  turn: StackCodexTurn
  agentContext: AgentContextSnapshot
  goalContext: CodexGoalSnapshot
}): Promise<StackMonitorSnapshot> {
  recordCoreAgentTurnCompleted({
    stackRoot: input.config.appRoot,
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

export async function runMonitorForNewEvents(input: {
  config: StackConfig
  session: StackLocalSession
  turn?: StackCodexTurn
  agentContext: AgentContextSnapshot
  goalContext: CodexGoalSnapshot
  wakeReason?: string
  triggerEventIds?: string[]
}): Promise<StackMonitorSnapshot> {
  const monitorConfig = loadMonitorConfig(input.config.appRoot)
  const threadId = input.session.id
  const priorEvents = readThreadMetaEvents(input.config.appRoot, threadId)
  const effective = effectiveMonitorState(monitorConfig, priorEvents)
  const actorId = monitorActorId(monitorConfig)
  const actorState = readMonitorActorState(input.config.appRoot, threadId, actorId)
  if (!effective.enabled) {
    writeMonitorActorState(input.config.appRoot, actorStateFromConfig(monitorConfig, threadId, {
      previous: actorState,
      state: "paused",
      strictness: effective.strictness,
    }))
    return snapshotFromEvents(monitorConfig, priorEvents, readMonitorActorState(input.config.appRoot, threadId, actorId))
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
    writeMonitorActorState(input.config.appRoot, refreshed)
    return snapshotFromEvents(
      monitorConfig,
      readThreadMetaEvents(input.config.appRoot, threadId),
      readMonitorActorState(input.config.appRoot, threadId, actorId),
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
  writeMonitorActorState(input.config.appRoot, runningState)
  appendThreadMetaEvent(input.config.appRoot, {
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
    appendThreadMetaEvent(input.config.appRoot, {
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
      goalContext: input.goalContext,
    })
    pass = await runMonitorPass({
      stackConfig: input.config,
      stackRoot: input.config.stackDataRoot,
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
      goalContext: input.goalContext,
      checks,
    })
  } catch (error) {
    const failedState = actorStateFromConfig(monitorConfig, threadId, {
      previous: runningState,
      state: "error",
      strictness: effective.strictness,
      lastErrorAt: new Date().toISOString(),
    })
    writeMonitorActorState(input.config.appRoot, failedState)
    appendThreadMetaEvent(input.config.appRoot, {
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
      readThreadMetaEvents(input.config.appRoot, threadId),
      readMonitorActorState(input.config.appRoot, threadId, actorId),
    )
  }

  appendThreadMetaEvent(input.config.appRoot, {
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
      summary: pass.summary,
      operator_update: pass.operatorUpdate ?? null,
      goal_snapshot: goalSnapshotFromContext(input.goalContext),
      focus_results: focusResults(pass.checks),
      source: pass.source,
      model_thread_id: pass.monitorThreadId ?? null,
      monitor_codex_thread_id: pass.monitorCodexThreadId ?? null,
      sidecar_transcript: pass.monitorCodexThreadId ? "codex-app-server" : null,
      fallback_reason: pass.fallbackReason ?? null,
      evidence: pass.checks.filter((check) => check.evidence).map((check) => ({
        focus: check.focus,
        evidence: check.evidence,
      })),
    },
  })

  const suggestedThreadName =
    pass.threadName ??
    parseThreadNameFromAgentResponse(pass.summary)
  if (suggestedThreadName) {
    await setThreadDisplayName({
      stackRoot: input.config.appRoot,
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

  if (pass.fallbackReason) {
    appendThreadMetaEvent(input.config.appRoot, {
      event_id: stackEventId("monitor_model_fallback"),
      type: "monitor.model_fallback",
      thread_id: threadId,
      observed_at: new Date().toISOString(),
      actor_id: actorId,
      actor_role: "monitor",
      payload: {
        wake_id: wakeId,
        reason: pass.fallbackReason,
        worker: monitorConfig.model.worker,
        model: monitorConfig.model.model,
      },
    })
  }

  const queueItems = monitorConfig.permissions.queue && actorToolAllowed(monitorConfig.tools, "monitor.queue")
    ? pass.queueItems
    : []
  for (const item of queueItems.slice(0, monitorConfig.intervention.maxQueuedItemsPerThread)) {
    appendThreadMetaEvent(input.config.appRoot, {
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
      stackRoot: input.config.appRoot,
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
  const turnForSteer = input.turn ?? syntheticTurnFromEvents(input.session, candidate.pendingEvents)
  const violations = detectSynthStyleViolations(turnForSteer)
  const violation = violations.find((entry) => !hasSteeredViolationRule(priorEvents, entry.id))
  if (violation && monitorConfig.permissions.steer && actorToolAllowed(monitorConfig.tools, "monitor.steer")) {
    const severity = severityForStyleViolation(violation.id)
    if (steerAllowedForStrictness(monitorConfig.strictness, severity)) {
      const steer = buildStyleSteerFromGuidance({
        stackRoot: input.config.appRoot,
        workspaceRoot: input.config.workspaceRoot,
        violation,
      })
      if (steer) {
        appendThreadMetaEvent(input.config.appRoot, {
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
        appendThreadMetaEvent(input.config.appRoot, {
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
        appendThreadMetaEvent(input.config.appRoot, {
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
        steerDelta = 1
      }
    }
  }

  const usage = pass.usage ?? estimateMonitorUsage(candidate.pendingEvents, pass.summary)
  appendThreadMetaEvent(input.config.appRoot, {
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
    monitorCodexLastPauseReason: pass.source === "codex-app-server" ? pass.checkpointSummary ?? pass.summary : undefined,
    rollingSummary: pass.checkpointSummary ?? pass.summary,
    severity: pass.severity,
    wakeDelta: 1,
    queueDelta: queueItems.length,
    contextPushDelta: contextPushes.length,
    steerDelta,
  })
  writeMonitorActorState(input.config.appRoot, completedState)
  appendThreadMetaEvent(input.config.appRoot, {
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
      summary: pass.summary,
      severity: pass.severity,
      state: completedState.state,
      actor_state_path: relativeActorStatePath(threadId, actorId),
      model_thread_id: pass.monitorThreadId ?? null,
      monitor_codex_thread_id: pass.monitorCodexThreadId ?? null,
    },
  })

  return snapshotFromEvents(
    monitorConfig,
    readThreadMetaEvents(input.config.appRoot, threadId),
    readMonitorActorState(input.config.appRoot, threadId, actorId),
  )
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
  if (value === "openai-responses" || value === "openai_responses") return "openai"
  if (value === "deterministic-runtime" || value === "deterministic") return "det"
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
  if (input.wakeReason === "operator_message" && input.triggerEventIds?.length) {
    const operatorEvents = input.events.filter((event) => input.triggerEventIds?.includes(event.event_id))
    if (operatorEvents.length > 0) {
      return {
        reason: "operator_message",
        triggerEventIds: input.triggerEventIds,
        pendingEvents: operatorEvents,
      }
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
    return {
      reason: input.wakeReason ?? wakeReasonFromEvent(triggers[0]),
      triggerEventIds: triggers.map((event) => event.event_id),
      pendingEvents,
    }
  }

  if (input.config.wake.deltaEvents > 0 && pendingEvents.length >= input.config.wake.deltaEvents) {
    triggers = [pendingEvents.at(-1)].filter((event): event is StackThreadMetaEvent => Boolean(event))
    if (triggers.some((event) => alreadyTriggered.has(event.event_id))) return undefined
    return {
      reason: "delta_events",
      triggerEventIds: triggers.map((event) => event.event_id),
      pendingEvents,
    }
  }

  return undefined
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

function isWakeTrigger(config: StackMonitorConfig, event: StackThreadMetaEvent): boolean {
  if (event.type === "agent.tool.failed") return config.wake.onToolFailed
  if (event.type === "agent.tool.completed") return config.wake.onToolCompleted
  if (event.type === "agent.turn.completed") return config.wake.onTurnCompleted
  if (event.type === "agent.error") return true
  return false
}

function wakeReasonFromEvent(event: StackThreadMetaEvent | undefined): string {
  if (!event) return "delta_events"
  if (event.type === "agent.tool.failed") return "tool_failed"
  if (event.type === "agent.tool.completed") return "tool_completed"
  if (event.type === "agent.turn.completed") return "turn_completed"
  if (event.type === "agent.error") return "error"
  return event.type.replace(/^agent\./, "")
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
  source: "deterministic-runtime" | "openai-responses" | "synth-aux" | "codex-app-server"
  monitorThreadId?: string
  monitorCodexThreadId?: string
  usage?: MonitorUsageEstimate
  fallbackReason?: string
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
  const deterministic = deterministicMonitorPass(input.config, input.checks, {
    goalContext: input.goalContext,
    priorEvents: input.priorEvents,
    pendingEvents: input.pendingEvents,
    turn: input.turn,
    wakeReason: input.wakeReason,
    priorWakeCount: input.actorState.wake_counts,
  })
  let codexSidecarFallbackReason: string | undefined
  if (shouldUseCodexSidecar(input.config)) {
    try {
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
        deterministicSummary: deterministic.summary,
      })
      const summary = codex.assistantText?.trim() || deterministic.summary
      return {
        ...deterministic,
        summary,
        checkpointSummary: summary,
        source: "codex-app-server",
        monitorCodexThreadId: codex.codexThreadId,
        usage: codexUsageEstimate(codex.usage, summary),
      }
    } catch (error) {
      codexSidecarFallbackReason = error instanceof Error ? error.message : String(error)
      if (resolvedMonitorWorker(input.config) === "codex_app_server") {
        return {
          ...deterministic,
          fallbackReason: codexSidecarFallbackReason,
        }
      }
    }
  }
  if (!shouldUseModelWorker(input.config)) {
    return {
      ...deterministic,
      fallbackReason: codexSidecarFallbackReason,
    }
  }
  const inference = resolveMonitorInferenceEndpoint(input.config, input.stackConfig)
  if (!inference) {
    return {
      ...deterministic,
      fallbackReason: codexSidecarFallbackReason ?? monitorInferenceFallbackReason(input.config, input.stackConfig),
    }
  }
  try {
    return await runResponsesMonitorPass(input, deterministic, inference)
  } catch (error) {
    return {
      ...deterministic,
      fallbackReason: error instanceof Error ? error.message : String(error),
    }
  }
}

function normalizeMonitorProvider(provider: string | undefined): "openai" | "synth_aux" {
  const normalized = (provider ?? "openai").trim().toLowerCase().replace(/-/g, "_")
  return normalized === "synth_aux" ? "synth_aux" : "openai"
}

type MonitorInferenceEndpoint = {
  url: string
  apiKey: string
  headers: Record<string, string>
  source: "openai-responses" | "synth-aux"
}

function resolveMonitorInferenceEndpoint(
  config: StackMonitorConfig,
  stackConfig: StackConfig,
): MonitorInferenceEndpoint | null {
  const provider = normalizeMonitorProvider(config.model.provider)
  if (provider === "synth_aux") {
    if (process.env.STACK_AUX_INFERENCE !== "1") return null
    loadEnvironmentAuth(stackConfig.environment)
    const apiKey = process.env[stackConfig.environment.authEnv]?.trim()
    if (!apiKey) return null
    const base = stackConfig.environment.apiBaseUrl.replace(/\/+$/, "")
    return {
      url: `${base}/api/v1/stack-aux/openai/v1/responses`,
      apiKey,
      headers: { "X-Stack-Actor-Role": "monitor" },
      source: "synth-aux",
    }
  }
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) return null
  return {
    url: "https://api.openai.com/v1/responses",
    apiKey,
    headers: {},
    source: "openai-responses",
  }
}

function monitorInferenceFallbackReason(
  config: StackMonitorConfig,
  stackConfig: StackConfig,
): string | undefined {
  const worker = process.env.STACK_MONITOR_MODEL_WORKER?.trim() || config.model.worker
  if (worker !== "openai_responses") return undefined
  if (normalizeMonitorProvider(config.model.provider) === "synth_aux") {
    if (process.env.STACK_AUX_INFERENCE !== "1") return "STACK_AUX_INFERENCE not enabled"
    loadEnvironmentAuth(stackConfig.environment)
    if (!process.env[stackConfig.environment.authEnv]?.trim()) {
      return `${stackConfig.environment.authEnv} missing`
    }
    return "stack-aux inference unavailable"
  }
  return "OPENAI_API_KEY missing"
}

function deterministicMonitorPass(
  config: StackMonitorConfig,
  checks: FocusCheck[],
  context?: {
    goalContext: CodexGoalSnapshot
    priorEvents: StackThreadMetaEvent[]
    pendingEvents: StackThreadMetaEvent[]
    turn: StackCodexTurn
    wakeReason: string
    priorWakeCount?: number
  },
): MonitorPassResult {
  const severity = combineSeverity(config, checks)
  const operatorUpdate = context ? buildDeterministicOperatorUpdate(config, checks, context) : undefined
  const summary = operatorUpdate
    ? formatOperatorSummary(operatorUpdate, severity)
    : summarizeChecks(checks, severity)
  return {
    checks,
    severity,
    summary,
    operatorUpdate,
    queueItems: queueItemsFor(config, checks),
    checkpointSummary: operatorUpdate?.progress_note ?? summary,
    source: "deterministic-runtime",
  }
}

function resolvedMonitorWorker(config: StackMonitorConfig): "auto" | "deterministic" | "openai_responses" | "codex_app_server" {
  const override = process.env.STACK_MONITOR_MODEL_WORKER?.trim()
  return override === "deterministic" ||
    override === "openai_responses" ||
    override === "auto" ||
    override === "codex_app_server"
    ? override
    : config.model.worker
}

function shouldUseCodexSidecar(config: StackMonitorConfig): boolean {
  const worker = resolvedMonitorWorker(config)
  if (worker === "codex_app_server") return true
  if (worker !== "auto") return false
  return process.env.STACK_MONITOR_CODEX_SIDECAR !== "0"
}

function shouldUseModelWorker(config: StackMonitorConfig): boolean {
  const worker = resolvedMonitorWorker(config)
  if (worker === "deterministic") return false
  if (worker === "codex_app_server") return false
  if (worker === "openai_responses") return true
  if (normalizeMonitorProvider(config.model.provider) === "synth_aux") {
    return process.env.STACK_AUX_INFERENCE === "1"
  }
  return Boolean(process.env.OPENAI_API_KEY?.trim())
}

async function runResponsesMonitorPass(
  input: {
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
  },
  deterministic: MonitorPassResult,
  inference: MonitorInferenceEndpoint,
): Promise<MonitorPassResult> {
  const response = await fetch(inference.url, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${inference.apiKey}`,
      "content-type": "application/json",
      ...inference.headers,
    },
    body: JSON.stringify({
      model: input.config.model.model,
      previous_response_id: input.actorState.monitor_thread_id,
      reasoning: { effort: input.config.model.reasoningEffort },
      input: [
        {
          role: "developer",
          content: [{
            type: "input_text",
            text: resolveMonitorDeveloperPrompt(input.stackRoot, input.config),
          }],
        },
        {
          role: "user",
          content: [{
            type: "input_text",
            text: JSON.stringify(monitorUserPayload(input, deterministic), null, 2),
          }],
        },
      ],
    }),
  })
  const payload = await response.json().catch(() => undefined) as unknown
  if (!response.ok) {
    const label = inference.source === "synth-aux" ? "stack-aux" : "OpenAI"
    throw new Error(`${label} monitor pass failed ${response.status}: ${truncate(JSON.stringify(payload ?? {}), 300)}`)
  }
  const parsed = parseResponsesMonitorResult(payload, deterministic, inference.source)
  return {
    ...parsed,
    monitorThreadId: readString(asRecord(payload)?.id) ?? input.actorState.monitor_thread_id,
    usage: readOpenAiUsage(payload) ?? deterministic.usage,
  }
}

function resolveMonitorDeveloperPrompt(stackRoot: string, config: StackMonitorConfig): string {
  return resolveActorPrompt(stackRoot, config.prompt, defaultMonitorBuiltinPrompt())
}

function defaultMonitorBuiltinPrompt(): string {
  return [
    "You are the Stack monitor actor watching a primary coding agent.",
    "Behave like calibrated human oversight: sparse, concrete, and non-spammy.",
    "Review only the delta events and rolling summary provided.",
    "Never claim direct tool access. Do not invent events.",
    "Return only a JSON object with this shape:",
    "{",
    '  "summary": "short operator-facing summary",',
    '  "thread_name": "optional short thread title when operator asks to name the thread (max 48 chars)",',
    '  "severity": "none|low|medium|high",',
    '  "focus_results": {"style":"pass|warn|fail|disabled","goal_progress":"pass|warn|fail|disabled","skills":"pass|warn|fail|disabled","tool_use":"pass|warn|fail|disabled","scope_control":"pass|warn|fail|disabled","acceptance":"pass|warn|fail|disabled"},',
    '  "operator_update": {"working_on":"...","struggling_with":"...","progress_note":"...","goal_status":"active|blocked|done|unknown","trajectory":"on_track|stalled|regressed","criteria_progress":{"done":0,"total":0,"pct":0},"spend_snapshot":{"elapsed_s":0,"worker_usd":0,"monitor_usd":0,"worker_tokens":0,"monitor_tokens":0},"eta":{"confidence":"low|med|high","remaining_minutes_low":0,"remaining_minutes_high":0,"rationale":"..."}}',
    '  "queue_items": [{"severity":"low|medium|high","focus":"style|goal_progress|skills|tool_use|scope_control|acceptance","summary":"...","evidence":"..."}],',
    '  "checkpoint_summary": "rolling state for your next wake"',
    "}",
  ].join("\n")
}

function monitorUserPayload(
  input: {
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
  },
  deterministic: MonitorPassResult,
): Record<string, unknown> {
  return {
    thread_id: input.threadId,
    wake_id: input.wakeId,
    wake_reason: input.wakeReason,
    trigger_event_ids: input.triggerEventIds,
    mode: input.config.strictness,
    focus_selection: input.config.focusSelection,
    focus_enabled: input.config.focus,
    previous_checkpoint: {
      last_event_id: input.actorState.last_event_id,
      rolling_summary: input.actorState.rolling_summary,
      last_severity: input.actorState.last_severity,
    },
    deterministic_baseline: {
      summary: deterministic.summary,
      severity: deterministic.severity,
      focus_results: focusResults(deterministic.checks),
      queue_items: deterministic.queueItems,
    },
    current_goal: input.goalContext,
    goal_mode: {
      criteria_progress: criteriaProgressFromGoal(input.goalContext),
      last_operator_updates: lastOperatorUpdates(input.priorEvents, 3),
    },
    used_skills: input.agentContext.usedSkills,
    turn_context: {
      prompt: truncate(input.turn.prompt, 1200),
      exit_code: input.turn.exitCode ?? null,
      stdout_tail: truncate(input.turn.stdout.slice(-4000), 4000),
      stderr_tail: truncate(input.turn.stderr.slice(-2000), 2000),
    },
    delta_events: input.pendingEvents.map((event) => ({
      event_id: event.event_id,
      type: event.type,
      observed_at: event.observed_at,
      actor_role: event.actor_role,
      payload: boundedPayload(event.payload),
    })),
  }
}

function parseResponsesMonitorResult(
  payload: unknown,
  deterministic: MonitorPassResult,
  source: "openai-responses" | "synth-aux",
): MonitorPassResult {
  const text = extractOpenAiOutputText(payload)
  const parsed = parseFirstJsonObject(text)
  if (!parsed) {
    throw new Error("Monitor Responses payload did not contain JSON")
  }
  const focusRecord = asRecord(parsed.focus_results)
  const checks = deterministic.checks.map((check) => {
    const status = normalizeFocusStatus(readString(focusRecord?.[check.focus]), check.status)
    return {
      ...check,
      status,
      severity: status === "fail" ? maxSeverity(check.severity, "high") : status === "warn" ? maxSeverity(check.severity, "low") : check.severity,
    }
  })
  const severity = normalizeSeverity(readString(parsed.severity), deterministic.severity)
  const operatorUpdate = readOperatorUpdateFromRecord(asRecord(parsed.operator_update)) ?? deterministic.operatorUpdate
  const summary = readString(parsed.summary) ?? (operatorUpdate ? formatOperatorSummary(operatorUpdate, severity) : deterministic.summary)
  const threadName = sanitizeThreadDisplayName(readString(parsed.thread_name) ?? "")
  return {
    checks,
    severity,
    summary,
    threadName: threadName ?? undefined,
    operatorUpdate,
    queueItems: readQueueItems(parsed.queue_items) ?? deterministic.queueItems,
    checkpointSummary: readString(parsed.checkpoint_summary) ?? operatorUpdate?.progress_note ?? summary,
    source,
  }
}

function codexUsageEstimate(usage: StackCodexTurn["usage"], summary: string): MonitorUsageEstimate {
  return {
    inputTokens: usage?.inputTokens ?? 0,
    cachedInputTokens: usage?.cachedInputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? Math.max(1, Math.ceil(summary.length / 4)),
    reasoningOutputTokens: usage?.reasoningOutputTokens ?? 0,
  }
}

function extractOpenAiOutputText(payload: unknown): string {
  const record = asRecord(payload)
  const direct = readString(record?.output_text)
  if (direct) return direct
  const parts: string[] = []
  const output = record?.output
  if (Array.isArray(output)) {
    for (const item of output) {
      const itemRecord = asRecord(item)
      const content = itemRecord?.content
      if (!Array.isArray(content)) continue
      for (const part of content) {
        const partRecord = asRecord(part)
        const text = readString(partRecord?.text) ?? readString(partRecord?.output_text)
        if (text) parts.push(text)
      }
    }
  }
  return parts.join("\n")
}

function parseFirstJsonObject(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  try {
    return asRecord(JSON.parse(trimmed))
  } catch {
    const start = trimmed.indexOf("{")
    const end = trimmed.lastIndexOf("}")
    if (start < 0 || end <= start) return undefined
    try {
      return asRecord(JSON.parse(trimmed.slice(start, end + 1)))
    } catch {
      return undefined
    }
  }
}

function readOpenAiUsage(payload: unknown): MonitorUsageEstimate | undefined {
  const usage = asRecord(asRecord(payload)?.usage)
  if (!usage) return undefined
  const inputTokens = readNumber(usage.input_tokens) ?? readNumber(usage.inputTokens)
  const outputTokens = readNumber(usage.output_tokens) ?? readNumber(usage.outputTokens)
  if (inputTokens === undefined && outputTokens === undefined) return undefined
  const outputDetails = asRecord(usage.output_tokens_details)
  return {
    inputTokens: inputTokens ?? 0,
    cachedInputTokens: readNumber(asRecord(usage.input_tokens_details)?.cached_tokens),
    outputTokens: outputTokens ?? 0,
    reasoningOutputTokens: readNumber(outputDetails?.reasoning_tokens),
    estimatedSpendUsd: 0,
  }
}

function readQueueItems(value: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items: Record<string, unknown>[] = []
  for (const item of value) {
    const record = asRecord(item)
    if (!record) continue
    const severity = normalizeSeverity(readString(record.severity), "low")
    const focus = normalizeFocusName(readString(record.focus))
    const summary = readString(record.summary)
    if (!focus || !summary) continue
    items.push({
      severity,
      focus,
      summary,
      evidence: readString(record.evidence) ?? null,
    })
  }
  return items
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
      worker: config.model.worker,
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
  const likelyNeedsSkill = text.includes("stackeval") || text.includes("gepa") || text.includes("synth")
  if (likelyNeedsSkill && context.usedSkills.length === 0) {
    return {
      focus: "skills",
      status: "warn",
      severity: config.strictness === "aggressive" ? "medium" : "low",
      summary: "turn appears to need Stack/Synth skills but no skill use was detected (load oss-gepa or gepa)",
      evidence: "StackEval/GEPA/Synth keyword without used skill event",
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
  if ((text.includes("stackeval") || text.includes("synth")) && allowed.includes("synth-via-stack")) {
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

function summarizeChecks(checks: FocusCheck[], severity: MonitorSeverity): string {
  const actionable = checks.filter((check) => check.status === "warn" || check.status === "fail")
  if (actionable.length === 0 || severity === "none") return "No monitor action needed."
  return actionable.map((check) => `${check.focus}: ${check.summary}`).join(" · ")
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

function readNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry))
}

function buildDeterministicOperatorUpdate(
  config: StackMonitorConfig,
  checks: FocusCheck[],
  context: {
    goalContext: CodexGoalSnapshot
    priorEvents: StackThreadMetaEvent[]
    pendingEvents: StackThreadMetaEvent[]
    turn: StackCodexTurn
    wakeReason: string
    priorWakeCount?: number
  },
): MonitorOperatorUpdate | undefined {
  if (!config.focus.goal_progress && !context.goalContext.objective) return undefined
  const goalObjective = context.goalContext.objective?.trim()
  const workingOn = goalObjective
    ?? truncate(context.turn.prompt.replace(/\s+/g, " ").trim(), 160)
    ?? "primary agent turn"
  const actionable = checks.filter((check) => check.status === "warn" || check.status === "fail")
  const toolFailure = context.pendingEvents.find((event) => event.type === "agent.tool.failed")
  const toolCompleted = [...context.pendingEvents].reverse().find((event) => event.type === "agent.tool.completed")
  const strugglingParts = actionable.map((check) => check.summary)
  if (toolFailure) {
    strugglingParts.push(readString(toolFailure.payload.message) ?? readString(toolFailure.payload.tool_name) ?? "tool failed")
  }
  const progressNote = describeMonitorProgress(context.wakeReason, toolCompleted, context.turn)
  const criteria = criteriaProgressFromGoal(context.goalContext)
  const spend = spendSnapshotFromEvents(context.goalContext, context.priorEvents)
  const eta = etaBandForGoal(context.goalContext, criteria, context.priorWakeCount ?? 0, Boolean(toolFailure))
  const trajectory = trajectoryForMonitorUpdate(actionable, toolFailure, criteria)
  return {
    working_on: workingOn,
    struggling_with: strugglingParts.join(" · ") || undefined,
    progress_note: progressNote,
    goal_status: context.goalContext.status ?? (goalObjective ? "active" : "unknown"),
    trajectory,
    criteria_progress: criteria,
    spend_snapshot: spend,
    eta,
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

function spendSnapshotFromEvents(goal: CodexGoalSnapshot, events: StackThreadMetaEvent[]): SpendSnapshot {
  const monitor = monitorUsageSummary(events, "monitor")
  const workerModel =
    process.env.STACK_CODEX_MODEL?.trim() ||
    process.env.CODEX_MODEL?.trim() ||
    "gpt-4o"
  const worker = workerUsageSummary(events, workerModel)
  return {
    elapsed_s: goal.timeUsedSeconds ?? 0,
    worker_usd: worker.spendUsd,
    monitor_usd: monitor.spendUsd,
    worker_tokens: goal.tokensUsed ?? worker.inputTokens + worker.outputTokens,
    monitor_tokens: monitor.inputTokens + monitor.outputTokens,
  }
}

function workerUsageSummary(
  events: StackThreadMetaEvent[],
  model: string,
): { spendUsd: number; inputTokens: number; outputTokens: number } {
  const usageEvents = events.filter((event) => event.type === "agent.usage")
  const totals = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  }
  let recordedSpendUsd = 0
  for (const event of usageEvents) {
    totals.inputTokens += readNumber(event.payload.input_tokens) ?? 0
    totals.cachedInputTokens += readNumber(event.payload.cached_input_tokens) ?? 0
    totals.outputTokens += readNumber(event.payload.output_tokens) ?? 0
    totals.reasoningOutputTokens += readNumber(event.payload.reasoning_output_tokens) ?? 0
    recordedSpendUsd += readNumber(event.payload.estimated_spend_usd) ?? 0
  }
  const estimatedSpendUsd = estimateUsageSpendUsd(totals, model)
  const spendUsd = recordedSpendUsd > 0 ? recordedSpendUsd : estimatedSpendUsd ?? 0
  return { spendUsd, inputTokens: totals.inputTokens, outputTokens: totals.outputTokens }
}

function etaBandForGoal(
  goal: CodexGoalSnapshot,
  criteria: CriteriaProgress,
  priorWakeCount: number,
  hasToolFailure: boolean,
): EtaBand | undefined {
  if (!goal.objective?.trim()) return undefined
  if (criteria.total > 0 && criteria.done >= criteria.total) {
    return {
      confidence: "high",
      remaining_minutes_low: 0,
      remaining_minutes_high: 0,
      rationale: "All tracked criteria are complete.",
    }
  }
  if (goal.blockers?.length) {
    return {
      confidence: "low",
      remaining_minutes_low: 0,
      remaining_minutes_high: 0,
      rationale: `Waiting on blocker: ${truncate(goal.blockers[0] ?? "listed blocker", 120)}.`,
    }
  }
  if (criteria.total === 0) {
    return priorWakeCount >= 2
      ? {
          confidence: "low",
          remaining_minutes_low: hasToolFailure ? 60 : 30,
          remaining_minutes_high: hasToolFailure ? 180 : 120,
          rationale: "No explicit criteria are bound, so ETA is based on wake history only.",
        }
      : undefined
  }
  const remaining = Math.max(1, criteria.total - criteria.done)
  const baseLow = Math.max(15, remaining * 20)
  const baseHigh = Math.max(baseLow + 30, remaining * (hasToolFailure ? 75 : 45))
  return {
    confidence: priorWakeCount >= 2 || criteria.done > 0 ? "med" : "low",
    remaining_minutes_low: baseLow,
    remaining_minutes_high: baseHigh,
    rationale: `${criteria.done}/${criteria.total} criteria complete${hasToolFailure ? "; latest wake saw a tool failure" : ""}.`,
  }
}

function trajectoryForMonitorUpdate(
  actionable: FocusCheck[],
  toolFailure: StackThreadMetaEvent | undefined,
  criteria: CriteriaProgress,
): MonitorOperatorUpdate["trajectory"] {
  if (toolFailure || actionable.some((check) => check.status === "fail")) return "regressed"
  if (actionable.some((check) => check.status === "warn")) return "stalled"
  if (criteria.total > 0 && criteria.done === 0) return "stalled"
  return "on_track"
}

function describeMonitorProgress(
  wakeReason: string,
  toolEvent: StackThreadMetaEvent | undefined,
  turn: StackCodexTurn,
): string {
  if (toolEvent) {
    const toolName = readString(toolEvent.payload.tool_name) ?? "tool"
    const command = readString(toolEvent.payload.command)
    return command ? `Completed ${toolName}: ${truncate(command, 80)}` : `Completed ${toolName}`
  }
  if (wakeReason === "turn_completed") {
    const tail = truncate(turn.stdout.replace(/\s+/g, " ").trim(), 100)
    return tail ? `Turn finished — ${tail}` : "Turn finished"
  }
  if (wakeReason === "tool_failed") return "Tool failure in latest delta"
  return wakeReason.replace(/_/g, " ")
}

function formatOperatorSummary(update: MonitorOperatorUpdate, severity: MonitorSeverity): string {
  const parts: string[] = []
  if (update.trajectory) parts.push(`Trajectory: ${update.trajectory.replace(/_/g, " ")}`)
  if (update.working_on) parts.push(`Working on: ${update.working_on}`)
  if (update.criteria_progress && update.criteria_progress.total > 0) {
    parts.push(`${update.criteria_progress.done}/${update.criteria_progress.total} criteria`)
  }
  if (update.eta) {
    parts.push(`ETA ${formatEtaBand(update.eta)}`)
  }
  if (update.progress_note) parts.push(update.progress_note)
  if (update.struggling_with) parts.push(`Struggling: ${update.struggling_with}`)
  if (parts.length === 0) return severity === "none" ? "Watching — no update yet." : "Monitor update"
  return parts.join(" · ")
}

function formatEtaBand(eta: EtaBand): string {
  if (eta.remaining_minutes_low === 0 && eta.remaining_minutes_high === 0) {
    return eta.rationale.toLowerCase().includes("blocker") ? "blocked" : "done"
  }
  if (eta.remaining_minutes_low === eta.remaining_minutes_high) return `${eta.remaining_minutes_low}m`
  return `${eta.remaining_minutes_low}-${eta.remaining_minutes_high}m`
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
    runtime: usage.runtime ?? actorState?.model.worker ?? config.model.worker,
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
    queuedCount: actorState?.queue_counts ?? events.filter((event) => event.type === "monitor.queued").length,
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
  if (events.some((event) => event.type === "monitor.queued")) return "queued"
  if (actorState?.state === "idle") return "idle"
  if (events.some((event) => event.type === "monitor.summary")) return "summarized"
  return "watching"
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
    model: mergeActorModel(base.model, parsed),
    prompt: mergeActorPrompt(base.prompt, parsed),
    wake: {
      maxWakesPerPrimaryTurn: readNumber(parsed.wake?.max_wakes_per_primary_turn) ?? base.wake.maxWakesPerPrimaryTurn,
      onTurnCompleted: readBoolean(parsed.wake?.on_turn_completed) ?? base.wake.onTurnCompleted,
      onToolCompleted: readBoolean(parsed.wake?.on_tool_completed) ?? base.wake.onToolCompleted,
      onToolFailed: readBoolean(parsed.wake?.on_tool_failed) ?? base.wake.onToolFailed,
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
    'worker = "auto"',
    "",
    "[prompt]",
    'system_file = ".stack/monitors/default.system.md"',
    "",
    "[wake]",
    "max_wakes_per_primary_turn = 6",
    "on_turn_completed = true",
    "on_tool_completed = true",
    "on_tool_failed = true",
    "delta_events = 12",
    "weight_threshold = 8",
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
    'allowed_skill_ids = ["synth-stack-productivity", "oss-gepa", "hosted-gepa", "synth-ai", "gepa", "stack-agent-bridge", "synth-via-stack", "stackeval"]',
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

function normalizeStrictness(value: string | undefined, fallback: MonitorStrictness): MonitorStrictness {
  if (value === "off" || value === "passive" || value === "conservative" || value === "aggressive") return value
  return fallback
}

function normalizeSelection(value: string | undefined, fallback: "any" | "all"): "any" | "all" {
  return value === "any" || value === "all" ? value : fallback
}

function normalizeSeverity(value: string | undefined, fallback: MonitorSeverity): MonitorSeverity {
  if (value === "none" || value === "low" || value === "medium" || value === "high") return value
  return fallback
}

function normalizeFocusStatus(value: string | undefined, fallback: MonitorFocusStatus): MonitorFocusStatus {
  if (value === "pass" || value === "warn" || value === "fail" || value === "disabled") return value
  return fallback
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
