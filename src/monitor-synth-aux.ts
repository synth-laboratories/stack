import { environmentAuthStatus, type StackConfig } from "./config.js"
import type { CodexGoalSnapshot } from "./codex/goal-context.js"
import type { StackMonitorConfig, MonitorUsageEstimate } from "./monitor.js"
import type { StackThreadMetaEvent } from "./thread-events.js"

export type MonitorSynthAuxRunResult = {
  assistantText?: string
  usage?: MonitorUsageEstimate
}

export async function runMonitorSynthAuxTurn(input: {
  stackConfig: StackConfig
  monitorConfig: StackMonitorConfig
  threadId: string
  actorId: string
  wakeId: string
  wakeReason: string
  triggerEventIds: string[]
  priorEvents: StackThreadMetaEvent[]
  pendingEvents: StackThreadMetaEvent[]
  goalContext: CodexGoalSnapshot
}): Promise<MonitorSynthAuxRunResult> {
  const auth = environmentAuthStatus(input.stackConfig.environment)
  const token = process.env[input.stackConfig.environment.authEnv]
  if (!auth.hasAuth || !token) {
    throw new Error(`Synth aux monitor requires ${input.stackConfig.environment.authEnv}; local worker remains Codex/BYOK`)
  }

  const response = await fetch(`${input.stackConfig.environment.apiBaseUrl.replace(/\/+$/, "")}/api/v1/stack-aux/openai/v1/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Stack-Actor-Role": "monitor",
    },
    body: JSON.stringify({
      model: input.monitorConfig.model.model,
      input: synthAuxMonitorPrompt(input),
      max_output_tokens: 700,
      metadata: {
        thread_id: input.threadId,
        stack_thread_id: input.threadId,
        actor_role: "monitor",
        actor_id: input.actorId,
        wake_id: input.wakeId,
        source: "stack_monitor",
      },
    }),
    signal: AbortSignal.timeout(synthAuxTimeoutMs()),
  })

  const payload = await response.json().catch(() => undefined)
  if (!response.ok) {
    throw new Error(`Synth aux monitor request failed: ${response.status} ${readErrorMessage(payload) ?? response.statusText}`)
  }

  return {
    assistantText: readResponseText(payload),
    usage: readUsage(payload),
  }
}

function synthAuxMonitorPrompt(input: {
  threadId: string
  actorId: string
  wakeId: string
  wakeReason: string
  triggerEventIds: string[]
  priorEvents: StackThreadMetaEvent[]
  pendingEvents: StackThreadMetaEvent[]
  goalContext: CodexGoalSnapshot
}): string {
  return [
    "You are the Stack monitor running on Synth free aux inference.",
    "Review the worker event batch and produce a concise monitor summary.",
    "Do not claim to call tools. Stack will record monitor events after your response.",
    "If the human needs a progress update, include a line exactly like `PROGRESS_UPDATE: <one sentence>`.",
    "If the worker needs steering, include a line exactly like `STEER_WORKER: <concise instruction>`.",
    "If there is no meaningful update, include `NO_USER_UPDATE`.",
    "",
    JSON.stringify(
      {
        wake_id: input.wakeId,
        wake_reason: input.wakeReason,
        trigger_event_ids: input.triggerEventIds,
        worker_thread_id: input.threadId,
        monitor_actor_id: input.actorId,
        current_goal: input.goalContext,
        pending_events: input.pendingEvents.map(serializableEvent),
        recent_context_events: input.priorEvents.slice(-20).map(serializableEvent),
      },
      null,
      2,
    ),
  ].join("\n")
}

function serializableEvent(event: StackThreadMetaEvent): Record<string, unknown> {
  return {
    event_id: event.event_id,
    type: event.type,
    observed_at: event.observed_at,
    actor_role: event.actor_role,
    payload: event.payload,
  }
}

function readResponseText(payload: unknown): string | undefined {
  const record = asRecord(payload)
  const outputText = readString(record?.output_text)
  if (outputText) return outputText
  const parts: string[] = []
  for (const output of asArray(record?.output)) {
    const outputRecord = asRecord(output)
    const directText = readString(outputRecord?.text)
    if (directText) parts.push(directText)
    for (const content of asArray(outputRecord?.content)) {
      const contentRecord = asRecord(content)
      const text = readString(contentRecord?.text) ?? readString(contentRecord?.output_text)
      if (text) parts.push(text)
    }
  }
  return parts.length > 0 ? parts.join("\n").trim() : undefined
}

function readUsage(payload: unknown): MonitorUsageEstimate | undefined {
  const usage = asRecord(asRecord(payload)?.usage)
  if (!usage) return undefined
  const inputTokens = readNumber(usage.input_tokens) ?? readNumber(usage.prompt_tokens) ?? 0
  const outputTokens = readNumber(usage.output_tokens) ?? readNumber(usage.completion_tokens) ?? 0
  const details = asRecord(usage.input_tokens_details)
  const outputDetails = asRecord(usage.output_tokens_details)
  return {
    inputTokens,
    cachedInputTokens: readNumber(details?.cached_tokens) ?? 0,
    outputTokens,
    reasoningOutputTokens: readNumber(outputDetails?.reasoning_tokens) ?? 0,
  }
}

function readErrorMessage(payload: unknown): string | undefined {
  const record = asRecord(payload)
  const detail = readString(record?.detail)
  if (detail) return detail
  const error = asRecord(record?.error)
  return readString(error?.message)
}

function synthAuxTimeoutMs(): number {
  const raw = process.env.STACK_MONITOR_SYNTH_AUX_TIMEOUT_MS
  if (!raw) return 120_000
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120_000
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}
