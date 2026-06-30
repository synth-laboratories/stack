import { join } from "node:path"
import { randomUUID } from "node:crypto"
import type { StackConfig } from "../config.js"
import { STACK_HARNESS_NAME } from "../harness.js"
import type { LocalContextFile } from "../local/workspace.js"
import type { StackCodexTurn } from "../session.js"
import { stackVersion } from "../version.js"
import {
  CodexAppServerClient,
  codexAppServerArgs,
  extractThreadId,
  type JsonRpcNotification,
  type JsonRpcServerRequest,
} from "./app-server-client.js"
import { autoApproveServerRequest, CodexAppServerEventBridge } from "./app-server-bridge.js"

export type CodexRunOptions = {
  config: StackConfig
  userPrompt: string
  selectedFiles: LocalContextFile[]
  priorTurns: StackCodexTurn[]
  onOutput: (chunk: string) => void
}

export async function runCodexTurn(options: CodexRunOptions): Promise<StackCodexTurn> {
  const startedAt = new Date().toISOString()
  const prompt = await buildStackHarnessPrompt(options)
  const args = [...options.config.codexArgs, "-C", options.config.workspaceRoot, "-"]
  const proc = Bun.spawn([options.config.codexCommand, ...args], {
    cwd: options.config.workspaceRoot,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })

  proc.stdin.write(prompt)
  proc.stdin.end()

  const [stdout, stderr, exitCode] = await Promise.all([
    collectStream(proc.stdout, options.onOutput),
    collectStream(proc.stderr, (chunk) => options.onOutput(`\n[stderr] ${chunk}`)),
    proc.exited,
  ])

  return {
    id: randomUUID(),
    prompt: options.userPrompt,
    selectedPaths: options.selectedFiles.map((file) => file.path),
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode,
    stdout,
    stderr,
  }
}

export async function buildStackHarnessPrompt(options: CodexRunOptions): Promise<string> {
  const selectedContext = await Promise.all(
    options.selectedFiles.map(async (file) => {
      const text = await readShortFile(join(options.config.workspaceRoot, file.path))
      return `### ${file.path}\n${text}`
    }),
  )
  const recentTranscript = options.priorTurns
    .slice(-3)
    .map((turn, index) => {
      const answer = truncate(turn.stdout || turn.stderr || "(no output)", 3000)
      return `Turn ${index + 1}\nUser: ${turn.prompt}\nCodex: ${answer}`
    })
    .join("\n\n")

  return [
    stackHarnessInstructions(options.config),
    "",
    "## User prompt",
    options.userPrompt,
    "",
    "## Recent Stack transcript",
    recentTranscript || "(none)",
    "",
    "## Selected local context",
    selectedContext.join("\n\n") || "(none selected)",
  ].join("\n")
}

export function stackHarnessInstructions(config: StackConfig): string {
  return [
    `You are running inside ${STACK_HARNESS_NAME}, a local OpenTUI Codex cockpit.`,
    "Stack shows live SMR, Factory, hosted optimizer, and local optimizer status in the left rail.",
    "When the Stack live-ops MCP tools are available, use them for mediated live operations instead of bypassing backend owner routes.",
    "Use Stack MCP for live status, live SMR messages/control, Factory-project messages, hosted optimizer cancel, and README-smoke launch/status.",
    "If Stack MCP reports missing auth, offline routes, or no active target, say that directly and do not fall back to raw databases, Redis keys, or compatibility projections.",
    "Keep the answer concise and actionable.",
    `Workspace: ${config.workspaceRoot}`,
  ].join("\n")
}

async function readShortFile(path: string): Promise<string> {
  const file = Bun.file(path)
  if (!(await file.exists())) return "(missing)"
  if (file.size > 100_000) return `(omitted: ${file.size} bytes, larger than Prototype 0 context limit)`
  return truncate(await file.text(), 12_000)
}

async function collectStream(stream: ReadableStream<Uint8Array>, onChunk: (chunk: string) => void): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let output = ""

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    output += chunk
    onChunk(chunk)
  }

  const trailing = decoder.decode()
  if (trailing) {
    output += trailing
    onChunk(trailing)
  }

  return output
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}\n...(truncated ${value.length - maxLength} chars)`
}

export type CodexAppServerSessionOptions = {
  config: StackConfig
  resumeThreadId?: string
  onOutput: (chunk: string) => void
}

export class CodexAppServerSession {
  private client?: CodexAppServerClient
  private threadId?: string
  private activeTurnId?: string
  private turnInFlight = false
  private readonly queuedPrompts: string[] = []
  private readonly bridge = new CodexAppServerEventBridge()
  private readonly options: CodexAppServerSessionOptions
  private stdoutLog = ""
  private closed = false
  private pendingUiOutput = ""
  private uiOutputFlushTimer?: ReturnType<typeof setTimeout>

  constructor(options: CodexAppServerSessionOptions) {
    this.options = options
    if (options.resumeThreadId) this.threadId = options.resumeThreadId
  }

  get isTurnActive(): boolean {
    return this.turnInFlight
  }

  get queueLength(): number {
    return this.queuedPrompts.length
  }

  get codexThreadId(): string | undefined {
    return this.threadId
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
    this.client = await CodexAppServerClient.start({
      launch: {
        command: config.codexCommand,
        args: codexAppServerArgs(config.codexArgs),
        cwd: config.workspaceRoot,
      },
      clientName: "stack",
      clientTitle: STACK_HARNESS_NAME,
      clientVersion: stackVersion(config.appRoot),
      onNotification: (message) => this.handleNotification(message),
      onServerRequest: (message) => this.handleServerRequest(message),
    })
    if (this.threadId) {
      await this.client.request("thread/resume", { threadId: this.threadId })
      return
    }
    const response = await this.client.request("thread/start", this.threadStartParams(config))
    const threadId = extractThreadIdFromResult(response)
    if (!threadId) {
      throw new Error(`codex thread/start missing thread id: ${JSON.stringify(response)}`)
    }
    this.threadId = threadId
    this.emitExecLine(JSON.stringify({ type: "thread.started", thread_id: threadId }))
  }

  async trySteer(prompt: string): Promise<boolean> {
    if (!this.client || !this.threadId || !this.activeTurnId || !this.turnInFlight) return false
    try {
      await this.client.steerTurn({
        threadId: this.threadId,
        expectedTurnId: this.activeTurnId,
        input: textTurnInput(prompt),
      })
      return true
    } catch {
      return false
    }
  }

  async interrupt(): Promise<void> {
    if (!this.client || !this.threadId || !this.activeTurnId || !this.turnInFlight) return
    await this.client.interruptTurn({
      threadId: this.threadId,
      turnId: this.activeTurnId,
    })
  }

  async runTurn(runOptions: Omit<CodexRunOptions, "onOutput">): Promise<StackCodexTurn> {
    await this.ensureReady()
    if (!this.client || !this.threadId) {
      throw new Error("codex app-server session is not ready")
    }
    if (this.turnInFlight) {
      throw new Error("codex app-server turn already in flight")
    }

    const startedAt = new Date().toISOString()
    this.stdoutLog = ""
    this.bridge.resetForTurn()
    this.turnInFlight = true
    const prompt = await buildStackHarnessPrompt({ ...runOptions, onOutput: () => undefined })

    try {
      const turnId = await this.client.startTurn({
        threadId: this.threadId,
        cwd: runOptions.config.workspaceRoot,
        model: runOptions.config.codexModel,
        effort: runOptions.config.codexReasoningEffort,
        input: textTurnInput(prompt),
      })
      this.activeTurnId = turnId
      const finalNotification = await this.client.waitForTurnEnd(turnId, 3_600_000)
      this.flushUiOutput()
      const exitCode = finalNotification.method === "turn/completed" ? 0 : 1
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
    } finally {
      this.turnInFlight = false
      this.activeTurnId = undefined
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

  private threadStartParams(config: StackConfig): Record<string, unknown> {
    return {
      model: config.codexModel,
      cwd: config.workspaceRoot,
      developerInstructions: stackHarnessInstructions(config),
      serviceName: "stack",
      approvalPolicy: "on-failure",
    }
  }

  private handleNotification(message: JsonRpcNotification): void {
    const line = this.bridge.toExecJsonl(message)
    if (line) this.emitExecLine(line)
  }

  private handleServerRequest(message: JsonRpcServerRequest): Promise<unknown> {
    this.emitExecLine(JSON.stringify({ type: "stack", message: `codex request: ${message.method}` }))
    return Promise.resolve(autoApproveServerRequest(message.method))
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

  setOutputHandler(onOutput: (chunk: string) => void): void {
    this.options.onOutput = onOutput
  }
}

function textTurnInput(text: string): Array<{ type: "text"; text: string; text_elements: [] }> {
  return [{ type: "text", text, text_elements: [] }]
}

function extractThreadIdFromResult(result: unknown): string | undefined {
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

export async function runCodexAppServerTurn(
  options: CodexRunOptions,
  session: CodexAppServerSession,
): Promise<StackCodexTurn> {
  return session.runTurn(options)
}

export async function probeCodexAppServerAvailability(config: StackConfig): Promise<boolean> {
  try {
    const client = await Promise.race([
      CodexAppServerClient.start({
        launch: {
          command: config.codexCommand,
          args: codexAppServerArgs(config.codexArgs),
          cwd: config.workspaceRoot,
        },
        clientName: "stack",
        clientTitle: STACK_HARNESS_NAME,
        clientVersion: stackVersion(config.appRoot),
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("codex app-server probe timed out")), 10_000)
      }),
    ])
    await client.close()
    return true
  } catch {
    return false
  }
}
