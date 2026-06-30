import type { JsonRpcNotification } from "./app-server-client.js"

export class CodexAppServerEventBridge {
  private agentMessageText = ""
  private reasoningText = ""

  resetForTurn(): void {
    this.agentMessageText = ""
    this.reasoningText = ""
  }

  toExecJsonl(message: JsonRpcNotification): string | undefined {
    const params = asRecord(message.params)
    if (!params) return undefined

    switch (message.method) {
      case "thread/started":
        return JSON.stringify({
          type: "thread.started",
          thread_id: readString(params.threadId) ?? readNestedString(params, "thread", "id"),
        })
      case "turn/started":
        return JSON.stringify({ type: "turn.started" })
      case "turn/completed":
        return JSON.stringify({
          type: "turn.completed",
          usage: readTurnUsage(params.turn),
        })
      case "turn/failed":
      case "turn/interrupted":
        return JSON.stringify({
          type: "error",
          message: readString(params.message) ?? message.method,
        })
      case "error":
        return JSON.stringify({
          type: "error",
          id: readString(params.id) ?? readNestedString(params, "item", "id"),
          message:
            readString(params.message) ??
            readNestedString(params, "error", "message") ??
            "codex app-server error",
        })
      case "agent/messageDelta": {
        const delta = readString(params.delta) ?? ""
        this.agentMessageText += delta
        return JSON.stringify({ type: "agent_message", text: this.agentMessageText })
      }
      case "reasoning/textDelta":
      case "reasoningSummary/textDelta": {
        const delta = readString(params.delta) ?? readString(params.text) ?? ""
        this.reasoningText += delta
        return JSON.stringify({ type: "reasoning_summary", text: this.reasoningText })
      }
      case "item/started":
        return itemLifecycleLine(params.item, "started")
      case "item/completed":
        return itemLifecycleLine(params.item, "completed")
      case "commandExecution/outputDelta":
        return JSON.stringify({
          type: "command_execution",
          id: readString(params.itemId) ?? readString(params.id),
          status: "in_progress",
          aggregated_output: readString(params.delta) ?? readString(params.output),
        })
      case "thread/tokenUsageUpdated":
        return JSON.stringify({
          type: "turn.completed",
          usage: readTurnUsage(params),
        })
      case "account/rateLimits/updated":
        return JSON.stringify({ type: "token_count", ...params })
      default:
        return undefined
    }
  }
}

function itemLifecycleLine(item: unknown, phase: "started" | "completed"): string | undefined {
  const record = asRecord(item)
  if (!record) return undefined
  const type = readString(record.type) ?? ""
  if (type === "commandExecution") {
    return JSON.stringify({
      type: "command_execution",
      id: readString(record.id),
      status: readString(record.status) ?? (phase === "started" ? "in_progress" : "completed"),
      command: readString(record.command),
      aggregated_output: readString(record.aggregatedOutput) ?? readString(record.output),
      stdout: readString(record.stdout) ?? readString(record.aggregatedOutput),
      stderr: readString(record.stderr),
      exit_code: readNumber(record.exitCode),
    })
  }
  if (type === "agentMessage") {
    const text = readString(record.text)
    if (!text) return undefined
    return JSON.stringify({ type: "agent_message", text })
  }
  if (type === "error") {
    return JSON.stringify({
      type: "error",
      id: readString(record.id),
      message: readString(record.message) ?? readString(record.text) ?? "codex error item",
    })
  }
  if (type === "functionCall" || type === "mcpToolCall") {
    return JSON.stringify({
      type: "function_call",
      id: readString(record.id),
      name: readString(record.tool) ?? readString(record.name) ?? type,
      arguments: readString(record.arguments) ?? JSON.stringify(record.arguments ?? {}),
    })
  }
  if (type === "functionCallOutput" || type === "mcpToolCallOutput") {
    const output = readString(record.output) ?? readString(record.result) ?? ""
    return JSON.stringify({
      type: "function_call_output",
      call_id: readString(record.callId) ?? readString(record.id),
      output,
    })
  }
  return undefined
}

function readTurnUsage(value: unknown): Record<string, number | undefined> | undefined {
  const record = asRecord(value)
  if (!record) return undefined
  const usage = asRecord(record.usage) ?? record
  const mapped = {
    input_tokens: readNumber(usage.inputTokens ?? usage.input_tokens),
    cached_input_tokens: readNumber(usage.cachedInputTokens ?? usage.cached_input_tokens),
    output_tokens: readNumber(usage.outputTokens ?? usage.output_tokens),
    reasoning_output_tokens: readNumber(usage.reasoningOutputTokens ?? usage.reasoning_output_tokens),
  }
  if (Object.values(mapped).every((value) => value === undefined)) return undefined
  return mapped
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

function readNestedString(record: Record<string, unknown>, ...path: string[]): string | undefined {
  let current: unknown = record
  for (const part of path) {
    current = asRecord(current)?.[part]
  }
  return readString(current)
}

export function autoApproveServerRequest(method: string): unknown {
  if (method.includes("requestApproval")) {
    return { decision: "acceptForSession" }
  }
  if (method === "item/tool/requestUserInput") {
    return { answers: [] }
  }
  if (method === "mcpServer/elicitation/request") {
    return { action: "decline" }
  }
  return {}
}
