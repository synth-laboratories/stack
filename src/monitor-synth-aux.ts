import type { StackConfig } from "./config.js"
import type { CodexGoalSnapshot } from "./codex/goal-context.js"
import type { StackMonitorConfig, MonitorUsageEstimate } from "./monitor.js"
import { runSynthResponsesTurn } from "./synth-responses.js"
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
  return await runMonitorSynthTurn({
    ...input,
    route: "/api/v1/stack-aux/openai/v1/responses",
    authError: `Synth aux monitor requires ${input.stackConfig.environment.authEnv}; local worker remains Codex/BYOK`,
    roleHeader: "monitor",
    promptKind: "Synth free aux inference",
    timeoutEnv: "STACK_MONITOR_SYNTH_AUX_TIMEOUT_MS",
    defaultTimeoutMs: 120_000,
    failurePrefix: "Synth aux monitor request failed",
  })
}

export async function runMonitorSynthInferenceTurn(input: {
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
  return await runMonitorSynthTurn({
    ...input,
    route: "/api/v1/stack-inference/openai/v1/responses",
    authError: `Synth billed inference monitor requires ${input.stackConfig.environment.authEnv}; local worker remains Codex/BYOK`,
    roleHeader: "monitor",
    promptKind: "Synth billed GLM inference",
    timeoutEnv: "STACK_MONITOR_SYNTH_INFERENCE_TIMEOUT_MS",
    defaultTimeoutMs: 180_000,
    failurePrefix: "Synth inference monitor request failed",
  })
}

async function runMonitorSynthTurn(input: {
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
  route: string
  authError: string
  roleHeader: string
  promptKind: string
  timeoutEnv: string
  defaultTimeoutMs: number
  failurePrefix: string
}): Promise<MonitorSynthAuxRunResult> {
  return await runSynthResponsesTurn({
    stackConfig: input.stackConfig,
    route: input.route,
    authError: input.authError,
    roleHeader: input.roleHeader,
    model: input.monitorConfig.model.model,
    prompt: synthAuxMonitorPrompt(input, input.promptKind),
    maxOutputTokens: 700,
    metadata: {
      thread_id: input.threadId,
      stack_thread_id: input.threadId,
      actor_role: input.roleHeader,
      actor_id: input.actorId,
      wake_id: input.wakeId,
      source: "stack_monitor",
    },
    timeoutEnv: input.timeoutEnv,
    defaultTimeoutMs: input.defaultTimeoutMs,
    failurePrefix: input.failurePrefix,
  })
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
}, promptKind = "Synth free aux inference"): string {
  return [
    `You are the Stack monitor running on ${promptKind}.`,
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
