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
      // The monitor must see what the worker produced to narrate positive progress,
      // not just that a turn finished. Feed the prompt + a bounded tail of stdout (the
      // tail holds the result). Without this the monitor is blind to successful work.
      // Redact BEFORE taking the tail so a secret straddling the cut can't survive as a partial.
      // Pre-bound the redaction input so the regex work stays proportional to what we keep.
      prompt: boundedTail(redactSecrets(boundedTail(input.turn.prompt, 1200)), 600),
      stdout_excerpt: boundedTail(redactSecrets(boundedTail(input.turn.stdout, 4000)), 2000),
    },
  })
}

export function boundedTail(text: string | undefined, max: number): string {
  if (!text) return ""
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  return "…[truncated]\n" + trimmed.slice(trimmed.length - max)
}

// Mask common secret shapes before worker output enters the durable event log. Covers token
// formats (JWT, provider keys with `-`/`_`, Google, GitHub, Slack, AWS), PEM private-key blocks,
// URL credentials for any scheme, Authorization headers, and KEY/SECRET/TOKEN/PASSWORD assignments
// in both env (`X=y`) and JSON (`"x": "y"`) form. Redaction false-positives are safe (they only
// mask a non-secret); false-negatives leak — so this errs toward over-masking.
export function redactSecrets(text: string): string {
  if (!text) return ""
  return text
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}\b/g, "[REDACTED_JWT]")
    .replace(/\bya29\.[A-Za-z0-9._-]{20,}/g, "[REDACTED_TOKEN]")
    .replace(/\bAIza[0-9A-Za-z_-]{35}\b/g, "[REDACTED_KEY]")
    .replace(/\b(sk|rk|pk)[-_][A-Za-z0-9_-]{16,}\b/g, "[REDACTED_KEY]")
    .replace(/\b(gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}\b/g, "[REDACTED_TOKEN]")
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED_TOKEN]")
    .replace(/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, "$1 [REDACTED_TOKEN]")
    .replace(/\b([a-z][a-z0-9+.-]*):\/\/[^\s/@"']+:[^\s/@"']+@/gi, "$1://[REDACTED]@")
    .replace(
      /("?[A-Za-z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE)[A-Za-z0-9_]*"?)(\s*[:=]\s*)("?)[^\s"',}]{6,}\3/gi,
      "$1$2[REDACTED]",
    )
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
      // Redact BEFORE truncating: truncation can split a secret past its anchor, defeating the
      // prefix-anchored redaction rules and leaving a usable partial secret.
      command: truncate(redactText(readString(record.command) ?? ""), 1200),
      status,
      exit_code: exitCode ?? null,
      output: truncate(redactText(output), 1800),
      stdout: truncate(redactText(readString(record.stdout) ?? ""), 1200),
      stderr: truncate(redactText(readString(record.stderr) ?? ""), 1200),
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

// One redactor for the whole event pipeline. Tool events (the high-volume path) route through
// here too, so they get the same coverage as turn output — no weaker second redactor.
function redactText(value: string): string {
  return redactSecrets(value)
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
