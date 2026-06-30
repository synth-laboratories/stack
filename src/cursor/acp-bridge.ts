import type { JsonRpcNotification } from "../jsonrpc/ndjson-client.js"

export class CursorAcpEventBridge {
  private agentMessageText = ""
  private reasoningText = ""

  resetForTurn(): void {
    this.agentMessageText = ""
    this.reasoningText = ""
  }

  toExecJsonl(message: JsonRpcNotification): string | undefined {
    if (message.method !== "session/update") return undefined
    const params = asRecord(message.params)
    if (!params) return undefined
    const update = asRecord(params.update)
    if (!update) return undefined
    const sessionUpdate = readString(update.sessionUpdate)
    if (!sessionUpdate) return undefined

    switch (sessionUpdate) {
      case "agent_message_chunk": {
        const content = asRecord(update.content)
        const delta = readString(content?.text) ?? ""
        this.agentMessageText += delta
        return JSON.stringify({ type: "agent_message", text: this.agentMessageText })
      }
      case "agent_thought_chunk":
      case "reasoning_chunk": {
        const content = asRecord(update.content)
        const delta = readString(content?.text) ?? ""
        this.reasoningText += delta
        return JSON.stringify({ type: "reasoning_summary", text: this.reasoningText })
      }
      case "tool_call": {
        const toolCall = asRecord(update.toolCall) ?? update
        return JSON.stringify({
          type: "function_call",
          id: readString(toolCall.callId) ?? readString(toolCall.id),
          name: readString(toolCall.title) ?? readString(toolCall.name) ?? "tool",
          arguments: readString(toolCall.rawInput) ?? readString(toolCall.arguments) ?? "{}",
        })
      }
      case "tool_call_update": {
        const toolCall = asRecord(update.toolCall) ?? update
        const status = readString(toolCall.status) ?? "in_progress"
        return JSON.stringify({
          type: "command_execution",
          id: readString(toolCall.callId) ?? readString(toolCall.id),
          status: status === "completed" ? "completed" : "in_progress",
          aggregated_output: readString(toolCall.result) ?? readString(toolCall.output) ?? "",
        })
      }
      default:
        return undefined
    }
  }
}

export function autoApproveCursorAcpRequest(method: string): unknown {
  if (method.includes("request_permission") || method.includes("permission")) {
    return { outcome: "allow" }
  }
  if (method.includes("requestUserInput")) {
    return { answers: [] }
  }
  return {}
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}
