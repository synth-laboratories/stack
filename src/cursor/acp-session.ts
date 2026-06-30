import { randomUUID } from "node:crypto"
import type { StackConfig } from "../config.js"
import type { StackCodexTurn } from "../session.js"
import { STACK_HARNESS_NAME } from "../harness.js"
import { stackVersion } from "../version.js"
import type { CodexRunOptions } from "../codex/app-server-session.js"
import { buildStackHarnessPrompt } from "../codex/app-server-session.js"
import { CursorAcpClient, cursorAcpArgs, type CursorAcpClientOptions } from "./acp-client.js"
import { autoApproveCursorAcpRequest, CursorAcpEventBridge } from "./acp-bridge.js"
import type { JsonRpcNotification, JsonRpcServerRequest } from "../jsonrpc/ndjson-client.js"

/** ACP extension notifications for mid-turn input (Codex-acp / Claude-acp forks). */
const CURSOR_STEER_METHODS = ["_session/steer", "session/steer"] as const

export type CursorAcpSessionOptions = {
  config: StackConfig
  resumeSessionId?: string
  onOutput: (chunk: string) => void
}

export class CursorAcpSession {
  private client?: CursorAcpClient
  private sessionId?: string
  private promptInFlight = false
  private readonly queuedPrompts: string[] = []
  private readonly bridge = new CursorAcpEventBridge()
  private readonly options: CursorAcpSessionOptions
  private stdoutLog = ""
  private closed = false
  private pendingUiOutput = ""
  private uiOutputFlushTimer?: ReturnType<typeof setTimeout>

  constructor(options: CursorAcpSessionOptions) {
    this.options = options
    if (options.resumeSessionId) this.sessionId = options.resumeSessionId
  }

  get isTurnActive(): boolean {
    return this.promptInFlight
  }

  get queueLength(): number {
    return this.queuedPrompts.length
  }

  get codexThreadId(): string | undefined {
    return this.sessionId
  }

  get cursorSessionId(): string | undefined {
    return this.sessionId
  }

  enqueue(prompt: string): void {
    this.queuedPrompts.push(prompt)
  }

  takeQueuedPrompt(): string | undefined {
    return this.queuedPrompts.shift()
  }

  async ensureReady(): Promise<void> {
    if (this.client || this.closed) return
    const { config } = this.options
    this.client = await CursorAcpClient.start(this.clientOptions(config))
    if (this.sessionId) {
      try {
        await this.client.request("session/load", { sessionId: this.sessionId, cwd: config.workspaceRoot })
        this.emitExecLine(JSON.stringify({ type: "thread.started", thread_id: this.sessionId }))
        return
      } catch {
        this.sessionId = undefined
      }
    }
    const response = await this.client.request("session/new", this.sessionNewParams(config))
    const sessionId = extractSessionId(response)
    if (!sessionId) {
      throw new Error(`cursor session/new missing session id: ${JSON.stringify(response)}`)
    }
    this.sessionId = sessionId
    this.emitExecLine(JSON.stringify({ type: "thread.started", thread_id: sessionId }))
  }

  async trySteer(prompt: string): Promise<boolean> {
    if (!this.client?.supportsMidTurnSteering()) return false
    if (!this.client || !this.sessionId || !this.promptInFlight) return false
    const trimmed = prompt.trim()
    if (!trimmed) return false
    const params = {
      sessionId: this.sessionId,
      prompt: [{ type: "text", text: trimmed }],
    }
    for (const method of CURSOR_STEER_METHODS) {
      try {
        await this.client.notify(method, params)
        return true
      } catch {
        // try the next wire name
      }
    }
    return false
  }

  async interrupt(): Promise<void> {
    if (!this.client || !this.sessionId || !this.promptInFlight) return
    try {
      await this.client.notify("session/cancel", { sessionId: this.sessionId })
    } catch {
      // ignore — stdin may already be closed
    }
  }

  async runTurn(runOptions: Omit<CodexRunOptions, "onOutput">): Promise<StackCodexTurn> {
    await this.ensureReady()
    if (!this.client || !this.sessionId) {
      throw new Error("cursor acp session is not ready")
    }
    if (this.promptInFlight) {
      throw new Error("cursor acp turn already in flight")
    }

    const startedAt = new Date().toISOString()
    this.stdoutLog = ""
    this.bridge.resetForTurn()
    this.promptInFlight = true
    const prompt = await buildStackHarnessPrompt({ ...runOptions, onOutput: () => undefined })

    try {
      const result = await this.client.request(
        "session/prompt",
        {
          sessionId: this.sessionId,
          prompt: [{ type: "text", text: prompt }],
        },
        3_600_000,
      )
      this.flushUiOutput()
      const stopReason = readString(asRecord(result)?.stopReason)
      this.emitExecLine(JSON.stringify({ type: "turn.completed", stopReason: stopReason ?? "end_turn", usage: {} }))
      const exitCode = stopReason === "cancelled" ? 130 : stopReason === "end_turn" || stopReason === undefined ? 0 : 0
      return {
        id: randomUUID(),
        prompt: runOptions.userPrompt,
        selectedPaths: runOptions.selectedFiles.map((file) => file.path),
        startedAt,
        finishedAt: new Date().toISOString(),
        exitCode,
        stdout: this.stdoutLog,
        stderr: "",
      }
    } catch (error) {
      this.flushUiOutput()
      this.emitExecLine(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : String(error) }))
      return {
        id: randomUUID(),
        prompt: runOptions.userPrompt,
        selectedPaths: runOptions.selectedFiles.map((file) => file.path),
        startedAt,
        finishedAt: new Date().toISOString(),
        exitCode: 1,
        stdout: this.stdoutLog,
        stderr: error instanceof Error ? error.message : String(error),
      }
    } finally {
      this.promptInFlight = false
    }
  }

  async close(): Promise<void> {
    this.closed = true
    if (this.uiOutputFlushTimer) {
      clearTimeout(this.uiOutputFlushTimer)
      this.uiOutputFlushTimer = undefined
    }
    this.flushUiOutput()
    await this.client?.close()
    this.client = undefined
  }

  setOutputHandler(onOutput: (chunk: string) => void): void {
    this.options.onOutput = onOutput
  }

  private clientOptions(config: StackConfig): CursorAcpClientOptions {
    return {
      launch: {
        command: config.cursorCommand,
        args: cursorAcpArgs(),
        cwd: config.workspaceRoot,
      },
      clientName: "stack",
      clientVersion: stackVersion(config.appRoot),
      onNotification: (message) => this.handleNotification(message),
      onServerRequest: (message) => this.handleServerRequest(message),
    }
  }

  private sessionNewParams(config: StackConfig): Record<string, unknown> {
    return {
      cwd: config.workspaceRoot,
      model: config.cursorModel,
      mcpServers: stackMcpServers(config),
      developerInstructions: cursorHarnessInstructions(config),
    }
  }

  private handleNotification(message: JsonRpcNotification): void {
    const line = this.bridge.toExecJsonl(message)
    if (line) this.emitExecLine(line)
  }

  private handleServerRequest(message: JsonRpcServerRequest): Promise<unknown> {
    this.emitExecLine(JSON.stringify({ type: "stack", message: `cursor acp request: ${message.method}` }))
    return Promise.resolve(autoApproveCursorAcpRequest(message.method))
  }

  private emitExecLine(line: string): void {
    this.stdoutLog += `${line}\n`
    this.queueUiOutput(`${line}\n`)
  }

  private queueUiOutput(chunk: string): void {
    this.pendingUiOutput += chunk
    if (this.uiOutputFlushTimer) return
    this.uiOutputFlushTimer = setTimeout(() => {
      this.uiOutputFlushTimer = undefined
      this.flushUiOutput()
    }, 32)
  }

  private flushUiOutput(): void {
    if (!this.pendingUiOutput) return
    const chunk = this.pendingUiOutput
    this.pendingUiOutput = ""
    this.options.onOutput(chunk)
  }
}

export function cursorHarnessInstructions(config: StackConfig): string {
  return [
    `You are running inside ${STACK_HARNESS_NAME}, a local OpenTUI Cursor Agent cockpit.`,
    `Primary model: ${config.cursorModel}.`,
    "Stack shows live SMR, Factory, hosted optimizer, and local optimizer status in the left rail.",
    "When the Stack live-ops MCP tools are available, use them for mediated live operations instead of bypassing backend owner routes.",
    "Use Stack MCP for live status, live SMR messages/control, Factory-project messages, hosted optimizer cancel, and README-smoke launch/status.",
    "If Stack MCP reports missing auth, offline routes, or no active target, say that directly and do not fall back to raw databases, Redis keys, or compatibility projections.",
    "Keep the answer concise and actionable.",
    `Workspace: ${config.workspaceRoot}`,
  ].join("\n")
}

function stackMcpServers(config: StackConfig): Array<Record<string, unknown>> {
  if (!config.stackMcpEnabled) return []
  return [
    {
      name: "stack_live_ops",
      type: "stdio",
      command: config.stackMcpCommand,
      args: [],
      env: [{ name: "STACK_ENVIRONMENT", value: config.environmentName }],
    },
  ]
}

function extractSessionId(result: unknown): string | undefined {
  const record = asRecord(result)
  const sessionId = readString(record?.sessionId) ?? readString(record?.session_id)
  return sessionId && sessionId.length > 0 ? sessionId : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export { probeCursorAcpAvailability } from "./acp-client.js"
