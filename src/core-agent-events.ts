import {
  appendThreadMetaEvent,
  appendThreadMetaEventOnce,
  stackEventId,
  type StackThreadMetaEvent,
} from "./thread-events.js"
import type { StackCodexTurn, StackCodexUsage } from "./session.js"

export type CoreAgentEventType =
  | "agent.thread.started"
  | "agent.turn.started"
  | "agent.turn.completed"
  | "agent.tool.started"
  | "agent.tool.completed"
  | "agent.tool.failed"
  | "agent.message.delta"
  | "agent.message.completed"
  | "agent.usage"
  | "agent.error"

export type CoreAgentEventRecorderInput = {
  stackRoot: string
  threadId: string
  actorId?: string
  metaThreadId?: string
  segmentId?: string
}

export function recordCoreAgentEventsFromCodexLine(
  input: CoreAgentEventRecorderInput,
  line: string,
): StackThreadMetaEvent[] {
  const raw = parseJsonObject(line)
  if (!raw) return []
  const normalized = normalizeWrappedRecord(raw)
  if (!normalized) return []
  const events = coreEventsFromRecord(normalized)
  const appended: StackThreadMetaEvent[] = []
  for (const event of events) {
    const fullEvent: StackThreadMetaEvent = {
      event_id: stackEventId(event.type.replace(/\./g, "_")),
      type: event.type,
      thread_id: input.threadId,
      observed_at: new Date().toISOString(),
      actor_id: input.actorId ?? "primary_codex",
      actor_role: "primary",
      meta_thread_id: input.metaThreadId,
      segment_id: input.segmentId,
      payload: {
        ...event.payload,
        meta_thread_id: input.metaThreadId ?? null,
        segment_id: input.segmentId ?? null,
      },
    }
    appendThreadMetaEvent(input.stackRoot, fullEvent)
    appended.push(fullEvent)
  }
  return appended
}

export function recordCoreAgentTurnCompleted(input: {
  stackRoot: string
  threadId: string
  actorId?: string
  metaThreadId?: string
  segmentId?: string
  turn: StackCodexTurn
}): StackThreadMetaEvent | undefined {
  return appendThreadMetaEventOnce(input.stackRoot, {
    event_id: `agent_turn_completed_${safeEventComponent(input.turn.id)}`,
    type: "agent.turn.completed",
    thread_id: input.threadId,
    observed_at: input.turn.finishedAt ?? new Date().toISOString(),
    actor_id: input.actorId ?? "primary_codex",
    actor_role: "primary",
    meta_thread_id: input.metaThreadId,
    segment_id: input.segmentId,
    payload: {
      stack_turn_id: input.turn.id,
      meta_thread_id: input.metaThreadId ?? null,
      segment_id: input.segmentId ?? null,
      started_at: input.turn.startedAt,
      finished_at: input.turn.finishedAt,
      exit_code: input.turn.exitCode ?? null,
      usage: usagePayload(input.turn.usage),
    },
  })
}

type PendingCoreEvent = {
  type: CoreAgentEventType
  payload: Record<string, unknown>
}

function coreEventsFromRecord(record: Record<string, unknown>): PendingCoreEvent[] {
  const type = readString(record.type) ?? ""
  if (type === "thread.started") {
    return [{
      type: "agent.thread.started",
      payload: {
        codex_thread_id: readString(record.thread_id) ?? readString(record.threadId) ?? null,
      },
    }]
  }
  if (type === "turn.started") {
    return [{
      type: "agent.turn.started",
      payload: {
        codex_turn_id: readString(record.turn_id) ?? readString(record.turnId) ?? null,
      },
    }]
  }
  if (type === "turn.completed") {
    const usage = usagePayload(readUsage(record))
    const events: PendingCoreEvent[] = [{
      type: "agent.turn.completed",
      payload: {
        codex_turn_id: readString(record.turn_id) ?? readString(record.turnId) ?? null,
        usage,
      },
    }]
    if (usage) {
      events.push({
        type: "agent.usage",
        payload: usage,
      })
    }
    return events
  }
  if (type === "error") {
    return [{
      type: "agent.error",
      payload: {
        id: readString(record.id) ?? null,
        message: redactText(readString(record.message) ?? JSON.stringify(record)),
      },
    }]
  }
  if (type === "agent_message") {
    const text = readString(record.text) ?? ""
    return [{
      type: "agent.message.completed",
      payload: {
        text: redactText(truncate(text, 1800)),
        char_count: text.length,
      },
    }]
  }
  if (type === "reasoning_summary") {
    const text = readString(record.text) ?? ""
    return [{
      type: "agent.message.delta",
      payload: {
        channel: "reasoning",
        text: redactText(truncate(text, 1000)),
        char_count: text.length,
      },
    }]
  }
  if (type === "command_execution") {
    return [commandExecutionEvent(record)]
  }
  if (type === "function_call") {
    return [{
      type: "agent.tool.started",
      payload: {
        tool_id: readString(record.call_id) ?? readString(record.id) ?? null,
        tool_name: readString(record.name) ?? "tool",
        arguments: redactText(truncate(readString(record.arguments) ?? "", 1800)),
      },
    }]
  }
  if (type === "function_call_output") {
    const output = readString(record.output) ?? ""
    return [{
      type: "agent.tool.completed",
      payload: {
        tool_id: readString(record.call_id) ?? readString(record.id) ?? null,
        tool_name: "tool",
        output: redactText(truncate(output, 1800)),
        output_char_count: output.length,
      },
    }]
  }
  return []
}

function commandExecutionEvent(record: Record<string, unknown>): PendingCoreEvent {
  const status = readString(record.status) ?? "completed"
  const exitCode = readNullableNumber(record.exit_code)
  let type: CoreAgentEventType = "agent.tool.started"
  if (status === "completed") type = exitCode !== undefined && exitCode !== null && exitCode !== 0 ? "agent.tool.failed" : "agent.tool.completed"
  const output = readString(record.aggregated_output) ?? readString(record.stdout) ?? readString(record.stderr) ?? ""
  return {
    type,
    payload: {
      tool_id: readString(record.id) ?? readString(record.call_id) ?? null,
      tool_name: "command_execution",
      command: redactText(truncate(readString(record.command) ?? "", 1200)),
      status,
      exit_code: exitCode ?? null,
      output: redactText(truncate(output, 1800)),
      stdout: redactText(truncate(readString(record.stdout) ?? "", 1200)),
      stderr: redactText(truncate(readString(record.stderr) ?? "", 1200)),
    },
  }
}

function normalizeWrappedRecord(record: Record<string, unknown>): Record<string, unknown> | undefined {
  const item = asRecord(record.item)
  if (item) return normalizeWrappedRecord(item)
  const payload = asRecord(record.payload)
  const recordType = readString(record.type)
  if ((recordType === "response_item" || recordType === "event_msg") && payload) return normalizeWrappedRecord(payload)
  return record
}

function parseJsonObject(line: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(line) as unknown
    return asRecord(parsed)
  } catch {
    return undefined
  }
}

function usagePayload(usage: StackCodexUsage | undefined): Record<string, number | undefined> | undefined {
  if (!usage) return undefined
  const payload = {
    input_tokens: usage.inputTokens,
    cached_input_tokens: usage.cachedInputTokens,
    output_tokens: usage.outputTokens,
    reasoning_output_tokens: usage.reasoningOutputTokens,
  }
  if (Object.values(payload).every((value) => value === undefined)) return undefined
  return payload
}

function readUsage(record: Record<string, unknown>): StackCodexUsage | undefined {
  const usage = asRecord(record.usage)
  if (!usage) return undefined
  return {
    inputTokens: readNumber(usage.input_tokens) ?? readNumber(usage.inputTokens),
    cachedInputTokens: readNumber(usage.cached_input_tokens) ?? readNumber(usage.cachedInputTokens),
    outputTokens: readNumber(usage.output_tokens) ?? readNumber(usage.outputTokens),
    reasoningOutputTokens: readNumber(usage.reasoning_output_tokens) ?? readNumber(usage.reasoningOutputTokens),
  }
}

function redactText(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, "[REDACTED_OPENAI_KEY]")
    .replace(/SYNTH_API_KEY=([A-Za-z0-9._-]+)/g, "SYNTH_API_KEY=[REDACTED]")
    .replace(/RUNPOD_API_KEY=([A-Za-z0-9._-]+)/g, "RUNPOD_API_KEY=[REDACTED]")
}

function safeEventComponent(value: string): string {
  const safe = value.trim().replace(/[^A-Za-z0-9_.-]/g, "_")
  return safe || "unknown"
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 20))}...(truncated)`
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function readNullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null
  return readNumber(value)
}
