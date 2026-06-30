import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import type { StackConfig } from "./config.js"
import type { CodexGoalSnapshot } from "./codex/goal-context.js"
import {
  CodexAppServerClient,
  codexAppServerArgs,
  extractThreadId,
  type JsonRpcNotification,
  type JsonRpcServerRequest,
} from "./codex/app-server-client.js"
import { autoApproveServerRequest, CodexAppServerEventBridge } from "./codex/app-server-bridge.js"
import type { StackMonitorConfig } from "./monitor.js"
import type { StackCodexUsage } from "./session.js"
import { stackVersion } from "./version.js"
import type { StackThreadMetaEvent } from "./thread-events.js"

export type StackMonitorSidecarTurn = {
  id: string
  prompt: string
  startedAt: string
  finishedAt?: string
  exitCode?: number
  stdout: string
  stderr: string
  codexThreadId?: string
  usage?: StackCodexUsage
}

export type StackMonitorSidecarTranscript = {
  schema: "stack/monitor-sidecar-transcript/v1"
  threadId: string
  actorId: string
  codexThreadId?: string
  turns: StackMonitorSidecarTurn[]
}

export type MonitorCodexSidecarRunResult = {
  turn: StackMonitorSidecarTurn
  codexThreadId: string
  assistantText?: string
  usage?: StackCodexUsage
}

export function monitorSidecarTranscriptPath(stackRoot: string, threadId: string, actorId: string): string {
  return join(
    stackRoot,
    ".stack",
    "actors",
    safePathSegment(threadId),
    "monitors",
    `${safePathSegment(actorId)}.codex.json`,
  )
}

export function readMonitorSidecarTranscript(
  stackRoot: string,
  threadId: string,
  actorId: string,
): StackMonitorSidecarTranscript | undefined {
  const path = monitorSidecarTranscriptPath(stackRoot, threadId, actorId)
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as StackMonitorSidecarTranscript
    if (parsed?.schema !== "stack/monitor-sidecar-transcript/v1") return undefined
    if (parsed.threadId !== threadId || parsed.actorId !== actorId) return undefined
    parsed.turns ??= []
    return parsed
  } catch {
    return undefined
  }
}

export function writeMonitorSidecarTranscript(stackRoot: string, transcript: StackMonitorSidecarTranscript): string {
  const path = monitorSidecarTranscriptPath(stackRoot, transcript.threadId, transcript.actorId)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(transcript, null, 2)}\n`, "utf8")
  return path
}

export function appendMonitorSidecarTurn(input: {
  stackRoot: string
  threadId: string
  actorId: string
  codexThreadId?: string
  turn: StackMonitorSidecarTurn
}): StackMonitorSidecarTranscript {
  const existing = readMonitorSidecarTranscript(input.stackRoot, input.threadId, input.actorId)
  const transcript: StackMonitorSidecarTranscript = existing ?? {
    schema: "stack/monitor-sidecar-transcript/v1",
    threadId: input.threadId,
    actorId: input.actorId,
    codexThreadId: input.codexThreadId,
    turns: [],
  }
  transcript.codexThreadId = input.codexThreadId ?? transcript.codexThreadId
  transcript.turns.push(input.turn)
  writeMonitorSidecarTranscript(input.stackRoot, transcript)
  return transcript
}

export async function runMonitorCodexSidecarTurn(input: {
  stackConfig: StackConfig
  monitorConfig: StackMonitorConfig
  threadId: string
  actorId: string
  codexThreadId?: string
  wakeId: string
  wakeReason: string
  triggerEventIds: string[]
  priorEvents: StackThreadMetaEvent[]
  pendingEvents: StackThreadMetaEvent[]
  goalContext: CodexGoalSnapshot
}): Promise<MonitorCodexSidecarRunResult> {
  return runMonitorCodexSidecarPrompt({
    stackConfig: input.stackConfig,
    monitorConfig: input.monitorConfig,
    threadId: input.threadId,
    actorId: input.actorId,
    codexThreadId: input.codexThreadId,
    prompt: monitorCodexWakePrompt(input),
  })
}

export async function runMonitorCodexSidecarChatTurn(input: {
  stackConfig: StackConfig
  monitorConfig: StackMonitorConfig
  threadId: string
  actorId: string
  codexThreadId?: string
  question: string
  requestEventId: string
  goalContext: CodexGoalSnapshot
  sidecarContext: Record<string, unknown>
}): Promise<MonitorCodexSidecarRunResult> {
  return runMonitorCodexSidecarPrompt({
    stackConfig: input.stackConfig,
    monitorConfig: input.monitorConfig,
    threadId: input.threadId,
    actorId: input.actorId,
    codexThreadId: input.codexThreadId,
    prompt: monitorCodexChatPrompt(input),
  })
}

async function runMonitorCodexSidecarPrompt(input: {
  stackConfig: StackConfig
  monitorConfig: StackMonitorConfig
  threadId: string
  actorId: string
  codexThreadId?: string
  prompt: string
}): Promise<MonitorCodexSidecarRunResult> {
  const startedAt = new Date().toISOString()
  const bridge = new CodexAppServerEventBridge()
  let stdout = ""
  let stderr = ""
  let codexThreadId = input.codexThreadId
  const client = await CodexAppServerClient.start({
    launch: {
      command: input.stackConfig.codexCommand,
      args: codexAppServerArgs(input.stackConfig.codexArgs),
      cwd: input.stackConfig.workspaceRoot,
    },
    clientName: "stack-sidecar",
    clientTitle: "Stack Sidecar Monitor",
    clientVersion: stackVersion(input.stackConfig.appRoot),
    onNotification(message: JsonRpcNotification) {
      const line = bridge.toExecJsonl(message)
      if (line) stdout += `${line}\n`
    },
    onServerRequest(message: JsonRpcServerRequest) {
      stdout += `${JSON.stringify({ type: "stack", message: `sidecar codex request: ${message.method}` })}\n`
      return Promise.resolve(autoApproveServerRequest(message.method))
    },
  })
  try {
    if (codexThreadId) {
      await client.request("thread/resume", { threadId: codexThreadId })
    } else {
      const started = await client.request("thread/start", {
        model: input.monitorConfig.model.model || input.stackConfig.codexModel,
        cwd: input.stackConfig.workspaceRoot,
        developerInstructions: monitorCodexDeveloperPrompt(input),
        serviceName: "stack-sidecar",
        approvalPolicy: "on-failure",
      })
      codexThreadId = extractThreadIdFromResult(started)
      if (!codexThreadId) {
        throw new Error(`sidecar thread/start missing thread id: ${JSON.stringify(started)}`)
      }
      stdout += `${JSON.stringify({ type: "thread.started", thread_id: codexThreadId })}\n`
    }
    const turnId = await client.startTurn({
      threadId: codexThreadId,
      cwd: input.stackConfig.workspaceRoot,
      model: input.monitorConfig.model.model || input.stackConfig.codexModel,
      effort: input.monitorConfig.model.reasoningEffort,
      input: textTurnInput(input.prompt),
    })
    const final = await client.waitForTurnEnd(turnId, 900_000)
    const exitCode = final.method === "turn/completed" ? 0 : 1
    const usage = readUsageFromStdout(stdout)
    const turn: StackMonitorSidecarTurn = {
      id: randomUUID(),
      prompt: input.prompt,
      startedAt,
      finishedAt: new Date().toISOString(),
      exitCode,
      stdout,
      stderr,
      codexThreadId,
      usage,
    }
    appendMonitorSidecarTurn({
      stackRoot: input.stackConfig.appRoot,
      threadId: input.threadId,
      actorId: input.actorId,
      codexThreadId,
      turn,
    })
    return {
      turn,
      codexThreadId,
      assistantText: extractLastAgentMessage(stdout),
      usage,
    }
  } catch (error) {
    stderr = error instanceof Error ? error.stack ?? error.message : String(error)
    if (codexThreadId) {
      appendMonitorSidecarTurn({
        stackRoot: input.stackConfig.appRoot,
        threadId: input.threadId,
        actorId: input.actorId,
        codexThreadId,
        turn: {
          id: randomUUID(),
          prompt: input.prompt,
          startedAt,
          finishedAt: new Date().toISOString(),
          exitCode: 1,
          stdout,
          stderr,
          codexThreadId,
        },
      })
    }
    throw error
  } finally {
    await client.close().catch(() => undefined)
  }
}

function monitorCodexDeveloperPrompt(input: {
  threadId: string
  actorId: string
}): string {
  return [
    "You are the Stack sidecar monitor, a persistent Codex agent paired with one primary worker thread.",
    "Your job is to watch the worker's event stream, explain progress to the operator, identify risks, and answer sidecar chat.",
    "The left Sidecar progress panel shows raw events. Your own long-running transcript is shown in the Sidecar thread panel.",
    "When you finish reviewing the current event batch, call the Stack MCP tool `stack_sidecar_pause_for_restart` with the worker thread id, your actor id, and a short reason.",
    "If that tool is unavailable, end your response with a concise status update and explicitly say you are waiting for the next worker event.",
    "Do not claim unseen tool output. Cite event ids when useful.",
    `Worker thread id: ${input.threadId}`,
    `Sidecar actor id: ${input.actorId}`,
  ].join("\n")
}

function monitorCodexWakePrompt(input: {
  wakeId: string
  wakeReason: string
  triggerEventIds: string[]
  priorEvents: StackThreadMetaEvent[]
  pendingEvents: StackThreadMetaEvent[]
  goalContext: CodexGoalSnapshot
}): string {
  return JSON.stringify(
    {
      wake_id: input.wakeId,
      wake_reason: input.wakeReason,
      trigger_event_ids: input.triggerEventIds,
      current_goal: input.goalContext,
      pending_events: input.pendingEvents.map(serializableEvent),
      recent_context_events: input.priorEvents.slice(-20).map(serializableEvent),
      instruction:
        "Review the pending events as the persistent sidecar monitor. Reply to the operator-facing thread with what matters now, then pause for restart when done.",
    },
    null,
    2,
  )
}

function monitorCodexChatPrompt(input: {
  question: string
  requestEventId: string
  goalContext: CodexGoalSnapshot
  sidecarContext: Record<string, unknown>
}): string {
  return JSON.stringify(
    {
      wake_reason: "operator_message",
      request_event_id: input.requestEventId,
      operator_message: input.question,
      current_goal: input.goalContext,
      sidecar_context: input.sidecarContext,
      instruction:
        "Answer the operator in the persistent sidecar thread using the current goal and sidecar context. After answering, call stack_sidecar_pause_for_restart so the runtime can wake you again on the next event.",
    },
    null,
    2,
  )
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

function textTurnInput(text: string): Array<{ type: "text"; text: string; text_elements: [] }> {
  return [{ type: "text", text, text_elements: [] }]
}

function extractThreadIdFromResult(result: unknown): string | undefined {
  const direct = extractThreadId({ jsonrpc: "2.0", method: "thread/started", params: result })
  if (direct) return direct
  if (!result || typeof result !== "object") return undefined
  const record = result as Record<string, unknown>
  const thread = record.thread
  if (thread && typeof thread === "object") {
    const id = (thread as Record<string, unknown>).id
    if (typeof id === "string" && id.length > 0) return id
  }
  const threadId = record.threadId
  return typeof threadId === "string" && threadId.length > 0 ? threadId : undefined
}

function extractLastAgentMessage(stdout: string): string | undefined {
  let latest: string | undefined
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      if (parsed.type === "agent_message" && typeof parsed.text === "string" && parsed.text.trim()) {
        latest = parsed.text.trim()
      }
    } catch {
      continue
    }
  }
  return latest
}

function readUsageFromStdout(stdout: string): StackCodexUsage | undefined {
  let usage: StackCodexUsage | undefined
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      if (parsed.usage && typeof parsed.usage === "object") {
        const record = parsed.usage as Record<string, unknown>
        usage = {
          inputTokens: readNumber(record.input_tokens),
          cachedInputTokens: readNumber(record.cached_input_tokens),
          outputTokens: readNumber(record.output_tokens),
          reasoningOutputTokens: readNumber(record.reasoning_output_tokens),
        }
      }
    } catch {
      continue
    }
  }
  return usage
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function safePathSegment(value: string): string {
  const safe = value.trim().replace(/[^A-Za-z0-9_.-]/g, "_")
  if (!safe || safe === "." || safe === "..") throw new Error(`invalid path segment: ${value}`)
  return safe
}
