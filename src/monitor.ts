import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { StackConfig } from "./config.js"
import type { AgentContextSnapshot } from "./codex/agent-context.js"
import type { CodexGoalSnapshot } from "./codex/goal-context.js"
import { recordCoreAgentTurnCompleted } from "./core-agent-events.js"
import type { StackCodexTurn, StackLocalSession } from "./session.js"
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
    worker: "auto" | "deterministic" | "openai_responses"
  }
  wake: {
    maxWakesPerPrimaryTurn: number
    onTurnCompleted: boolean
    onToolCompleted: boolean
    onToolFailed: boolean
    deltaEvents: number
    cooldownMs: number
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
}

export type StackMonitorSnapshot = {
  enabled: boolean
  actorId: string
  label: string
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

export type StackMonitorActorRuntimeState = {
  schema: "stack/monitor-actor-state/v1"
  thread_id: string
  monitor_actor_id: string
  monitor_thread_id?: string
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
  wake: {
    maxWakesPerPrimaryTurn: 6,
    onTurnCompleted: true,
    onToolCompleted: true,
    onToolFailed: true,
    deltaEvents: 12,
    cooldownMs: 250,
  },
  intervention: {
    maxQueuedItemsPerThread: 8,
    skillContextPush: "queue_or_steer",
  },
  skills: {
    enabled: true,
    allowedSkillIds: ["stack-agent-bridge", "synth-via-stack", "stackeval"],
    pushWhenConfident: false,
  },
}

export function ensureDefaultMonitorConfig(stackRoot: string): string {
  const path = join(stackRoot, ".stack", "monitors", "default.toml")
  if (existsSync(path)) return path
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${defaultMonitorToml()}\n`, "utf8")
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
    strictness: effective.strictness,
    status: effective.enabled ? "watching" : "off",
    lastSeverity: "none",
    wakeCount: 0,
    queuedCount: 0,
    skillReadCount: 0,
    contextPushCount: 0,
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
    },
  })

  let pass: MonitorPassResult
  try {
    const turn = input.turn ?? syntheticTurnFromEvents(input.session, candidate.pendingEvents)
    const checks = runFocusChecks(monitorConfig, {
      turn: input.turn ?? syntheticTurnFromEvents(input.session, candidate.pendingEvents),
      agentContext: input.agentContext,
      goalContext: input.goalContext,
    })
    pass = await runMonitorPass({
      config: monitorConfig,
      actorState: runningState,
      threadId,
      wakeId,
      wakeReason: candidate.reason,
      triggerEventIds: candidate.triggerEventIds,
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
      focus_results: focusResults(pass.checks),
      source: pass.source,
      model_thread_id: pass.monitorThreadId ?? null,
      evidence: pass.checks.filter((check) => check.evidence).map((check) => ({
        focus: check.focus,
        evidence: check.evidence,
      })),
    },
  })

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

  const queueItems = pass.queueItems
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
    rollingSummary: pass.checkpointSummary ?? pass.summary,
    severity: pass.severity,
    wakeDelta: 1,
    queueDelta: queueItems.length,
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
  const lines = ["Monitor"]
  lines.push(
    truncate(
      `${snapshot.status} · ${snapshot.strictness} · wakes ${snapshot.wakeCount} · queued ${snapshot.queuedCount}`,
      width,
    ),
  )
  lines.push(truncate(`mode ${snapshot.modeSource} · M cycles off/passive/cons/aggr`, width))
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

export function cycleMonitorMode(stackRoot: string, threadId: string): StackMonitorSnapshot {
  const config = loadMonitorConfig(stackRoot)
  const events = readThreadMetaEvents(stackRoot, threadId)
  const current = effectiveMonitorState(config, events).strictness
  const next = nextStrictness(current)
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

function nextWakeCandidate(input: {
  config: StackMonitorConfig
  actorState?: StackMonitorActorRuntimeState
  events: StackThreadMetaEvent[]
  wakeReason?: string
  triggerEventIds?: string[]
}): WakeCandidate | undefined {
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
  queueItems: Record<string, unknown>[]
  checkpointSummary?: string
  source: "deterministic-runtime" | "openai-responses"
  monitorThreadId?: string
  usage?: MonitorUsageEstimate
  fallbackReason?: string
}

type MonitorUsageEstimate = {
  inputTokens: number
  cachedInputTokens?: number
  outputTokens: number
  reasoningOutputTokens?: number
  estimatedSpendUsd?: number
}

async function runMonitorPass(input: {
  config: StackMonitorConfig
  actorState: StackMonitorActorRuntimeState
  threadId: string
  wakeId: string
  wakeReason: string
  triggerEventIds: string[]
  pendingEvents: StackThreadMetaEvent[]
  turn: StackCodexTurn
  agentContext: AgentContextSnapshot
  goalContext: CodexGoalSnapshot
  checks: FocusCheck[]
}): Promise<MonitorPassResult> {
  const deterministic = deterministicMonitorPass(input.config, input.checks)
  if (!shouldUseOpenAiResponses(input.config)) return deterministic
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    return {
      ...deterministic,
      fallbackReason: input.config.model.worker === "openai_responses"
        ? "OPENAI_API_KEY missing"
        : undefined,
    }
  }
  try {
    const model = await runOpenAiResponsesMonitorPass(input, deterministic, apiKey)
    return model
  } catch (error) {
    return {
      ...deterministic,
      fallbackReason: error instanceof Error ? error.message : String(error),
    }
  }
}

function deterministicMonitorPass(config: StackMonitorConfig, checks: FocusCheck[]): MonitorPassResult {
  const severity = combineSeverity(config, checks)
  const summary = summarizeChecks(checks, severity)
  return {
    checks,
    severity,
    summary,
    queueItems: queueItemsFor(config, checks),
    checkpointSummary: summary,
    source: "deterministic-runtime",
  }
}

function shouldUseOpenAiResponses(config: StackMonitorConfig): boolean {
  const override = process.env.STACK_MONITOR_MODEL_WORKER?.trim()
  const worker = override === "deterministic" || override === "openai_responses" || override === "auto"
    ? override
    : config.model.worker
  if (worker === "deterministic") return false
  if (worker === "openai_responses") return true
  return Boolean(process.env.OPENAI_API_KEY?.trim())
}

async function runOpenAiResponsesMonitorPass(
  input: {
    config: StackMonitorConfig
    actorState: StackMonitorActorRuntimeState
    threadId: string
    wakeId: string
    wakeReason: string
    triggerEventIds: string[]
    pendingEvents: StackThreadMetaEvent[]
    turn: StackCodexTurn
    agentContext: AgentContextSnapshot
    goalContext: CodexGoalSnapshot
    checks: FocusCheck[]
  },
  deterministic: MonitorPassResult,
  apiKey: string,
): Promise<MonitorPassResult> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${apiKey}`,
      "content-type": "application/json",
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
            text: monitorDeveloperPrompt(),
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
    throw new Error(`OpenAI monitor pass failed ${response.status}: ${truncate(JSON.stringify(payload ?? {}), 300)}`)
  }
  const parsed = parseOpenAiMonitorResult(payload, deterministic)
  return {
    ...parsed,
    source: "openai-responses",
    monitorThreadId: readString(asRecord(payload)?.id) ?? input.actorState.monitor_thread_id,
    usage: readOpenAiUsage(payload) ?? deterministic.usage,
  }
}

function monitorDeveloperPrompt(): string {
  return [
    "You are the Stack monitor actor watching a primary coding agent.",
    "Behave like calibrated human oversight: sparse, concrete, and non-spammy.",
    "Review only the delta events and rolling summary provided.",
    "Never claim direct tool access. Do not invent events.",
    "Return only a JSON object with this shape:",
    "{",
    '  "summary": "short operator-facing summary",',
    '  "severity": "none|low|medium|high",',
    '  "focus_results": {"style":"pass|warn|fail|disabled","goal_progress":"pass|warn|fail|disabled","skills":"pass|warn|fail|disabled","tool_use":"pass|warn|fail|disabled","scope_control":"pass|warn|fail|disabled","acceptance":"pass|warn|fail|disabled"},',
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

function parseOpenAiMonitorResult(payload: unknown, deterministic: MonitorPassResult): MonitorPassResult {
  const text = extractOpenAiOutputText(payload)
  const parsed = parseFirstJsonObject(text)
  if (!parsed) {
    throw new Error("OpenAI monitor response did not contain JSON")
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
  const summary = readString(parsed.summary) ?? deterministic.summary
  return {
    checks,
    severity,
    summary,
    queueItems: readQueueItems(parsed.queue_items) ?? deterministic.queueItems,
    checkpointSummary: readString(parsed.checkpoint_summary) ?? summary,
    source: "openai-responses",
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
    rollingSummary?: string
    severity?: MonitorSeverity
    wakeDelta?: number
    queueDelta?: number
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
    steer_counts: previous?.steer_counts ?? 0,
    skill_read_counts: previous?.skill_read_counts ?? 0,
    context_push_counts: previous?.context_push_counts ?? 0,
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
    checkAcceptance(config, input.turn),
  ]
}

function checkStyle(config: StackMonitorConfig, turn: StackCodexTurn): FocusCheck {
  if (!config.focus.style) return disabled("style")
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
  if (goal.status && goal.status !== "active") return {
    focus: "goal_progress",
    status: "warn",
    severity: "medium",
    summary: `goal status is ${goal.status}`,
  }
  return pass("goal_progress", "active goal context visible")
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
      summary: "turn appears to need Stack/Synth skills but no skill use was detected",
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

function checkAcceptance(config: StackMonitorConfig, turn: StackCodexTurn): FocusCheck {
  if (!config.focus.acceptance) return disabled("acceptance")
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

function summarizeChecks(checks: FocusCheck[], severity: MonitorSeverity): string {
  const actionable = checks.filter((check) => check.status === "warn" || check.status === "fail")
  if (actionable.length === 0 || severity === "none") return "No monitor action needed."
  return actionable.map((check) => `${check.focus}: ${check.summary}`).join(" · ")
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
  const focus = asRecord(latestSummary?.payload.focus_results)
  return {
    enabled: effective.enabled,
    actorId: monitorActorId(config),
    label: config.label,
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
    focusResults: focusResultsFromRecord(focus),
    modeSource: effective.source,
  }
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
    model: {
      provider: readString(parsed.model?.provider) ?? base.model.provider,
      model: readString(parsed.model?.model) ?? base.model.model,
      reasoningEffort: readString(parsed.model?.reasoning_effort) ?? base.model.reasoningEffort,
      worker: normalizeModelWorker(readString(parsed.model?.worker), base.model.worker),
    },
    wake: {
      maxWakesPerPrimaryTurn: readNumber(parsed.wake?.max_wakes_per_primary_turn) ?? base.wake.maxWakesPerPrimaryTurn,
      onTurnCompleted: readBoolean(parsed.wake?.on_turn_completed) ?? base.wake.onTurnCompleted,
      onToolCompleted: readBoolean(parsed.wake?.on_tool_completed) ?? base.wake.onToolCompleted,
      onToolFailed: readBoolean(parsed.wake?.on_tool_failed) ?? base.wake.onToolFailed,
      deltaEvents: readNumber(parsed.wake?.delta_events) ?? base.wake.deltaEvents,
      cooldownMs: readNumber(parsed.wake?.cooldown_ms) ?? base.wake.cooldownMs,
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
  }
}

function parseTomlLike(text: string): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {}
  let section = "monitor"
  result[section] = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim()
    if (!line) continue
    const sectionMatch = /^\[([A-Za-z0-9_.-]+)]$/.exec(line)
    if (sectionMatch?.[1]) {
      section = sectionMatch[1]
      result[section] ??= {}
      continue
    }
    const match = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line)
    if (!match?.[1] || match[2] === undefined) continue
    result[section] ??= {}
    result[section][match[1]] = parseTomlValue(match[2].trim())
  }
  return result
}

function parseTomlValue(raw: string): unknown {
  if (raw === "true") return true
  if (raw === "false") return false
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(",").map((part) => trimQuotes(part.trim()))
  }
  return trimQuotes(raw)
}

function stripTomlComment(line: string): string {
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') quoted = !quoted
    if (char === "#" && !quoted) return line.slice(0, index)
  }
  return line
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
    "[wake]",
    "max_wakes_per_primary_turn = 6",
    "on_turn_completed = true",
    "on_tool_completed = true",
    "on_tool_failed = true",
    "delta_events = 12",
    "cooldown_ms = 250",
    "",
    "[intervention]",
    "max_queued_items_per_thread = 8",
    'skill_context_push = "queue_or_steer"',
    "",
    "[skills]",
    "enabled = true",
    'allowed_skill_ids = ["stack-agent-bridge", "synth-via-stack", "stackeval"]',
    "push_when_confident = false",
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

function normalizeModelWorker(
  value: string | undefined,
  fallback: "auto" | "deterministic" | "openai_responses",
): "auto" | "deterministic" | "openai_responses" {
  if (value === "auto" || value === "deterministic" || value === "openai_responses") return value
  return fallback
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

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return undefined
  return value
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function trimQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
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
