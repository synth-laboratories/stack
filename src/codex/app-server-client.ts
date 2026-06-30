import type { Subprocess } from "bun"

export type JsonRpcId = number | string

export type JsonRpcRequest = {
  jsonrpc: "2.0"
  id: JsonRpcId
  method: string
  params?: unknown
}

export type JsonRpcNotification = {
  jsonrpc: "2.0"
  method: string
  params?: unknown
}

export type JsonRpcResponse = {
  jsonrpc: "2.0"
  id: JsonRpcId
  result?: unknown
  error?: { code?: number; message?: string; data?: unknown }
}

export type JsonRpcServerRequest = JsonRpcRequest

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse | JsonRpcServerRequest

export type CodexAppServerLaunch = {
  command: string
  args: string[]
  cwd: string
  env?: Record<string, string | undefined>
}

export type CodexAppServerClientOptions = {
  launch: CodexAppServerLaunch
  clientName?: string
  clientTitle?: string
  clientVersion?: string
  onNotification?: (message: JsonRpcNotification) => void
  onServerRequest?: (message: JsonRpcServerRequest) => Promise<unknown>
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export class CodexAppServerClient {
  private readonly proc: Subprocess
  private readonly pending = new Map<number, PendingRequest>()
  private readonly deferred: JsonRpcMessage[] = []
  private readonly received: JsonRpcMessage[] = []
  private readonly sent: JsonRpcMessage[] = []
  private nextId = 1
  private stdinClosed = false
  private stdoutClosed = false
  private readonly pumpPromise: Promise<void>
  private readonly options: CodexAppServerClientOptions

  private constructor(proc: Subprocess, options: CodexAppServerClientOptions) {
    this.proc = proc
    this.options = options
    this.pumpPromise = this.pumpStdout()
  }

  static async start(options: CodexAppServerClientOptions): Promise<CodexAppServerClient> {
    const { launch } = options
    const proc = Bun.spawn([launch.command, ...launch.args], {
      cwd: launch.cwd,
      env: launch.env ? { ...process.env, ...launch.env } : process.env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })
    const client = new CodexAppServerClient(proc, options)
    void client.drainStderr()
    await client.initialize()
    return client
  }

  get sentMessages(): readonly JsonRpcMessage[] {
    return this.sent
  }

  get receivedMessages(): readonly JsonRpcMessage[] {
    return this.received
  }

  request(method: string, params: unknown, timeoutMs = 120_000): Promise<unknown> {
    const id = this.nextId++
    const payload: JsonRpcRequest = { jsonrpc: "2.0", id, method, params }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`codex app-server timed out waiting for response ${id} (${method})`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      void this.send(payload).catch((error) => {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      })
    })
  }

  async notify(method: string, params?: unknown): Promise<void> {
    await this.send({ jsonrpc: "2.0", method, params })
  }

  async close(): Promise<void> {
    if (!this.stdinClosed) {
      this.stdinClosed = true
      try {
        const stdin = this.proc.stdin
        if (stdin && typeof stdin !== "number" && "end" in stdin) {
          stdin.end()
        }
      } catch {
        // ignore
      }
    }
    if (this.proc.exitCode === null) {
      this.proc.kill("SIGTERM")
    }
    await Promise.race([this.pumpPromise, this.proc.exited])
  }

  private async initialize(): Promise<void> {
    await this.request("initialize", {
      clientInfo: {
        name: this.options.clientName ?? "stack",
        title: this.options.clientTitle ?? "Stack",
        version: this.options.clientVersion ?? "0.0.0",
      },
    })
    await this.notify("initialized")
  }

  private async send(payload: JsonRpcMessage): Promise<void> {
    if (this.stdinClosed) {
      throw new Error("codex app-server stdin is closed")
    }
    this.sent.push(payload)
    const line = `${JSON.stringify(payload)}\n`
    const stdin = this.proc.stdin
    if (!stdin || typeof stdin === "number") {
      throw new Error("codex app-server stdin unavailable")
    }
    if (typeof (stdin as { write?: (chunk: string) => void }).write === "function") {
      ;(stdin as { write: (chunk: string) => void }).write(line)
      return
    }
    throw new Error("codex app-server stdin is not writable")
  }

  async startTurn(params: unknown, timeoutMs = 120_000): Promise<string> {
    const result = await this.request("turn/start", params, timeoutMs)
    const turnId = extractTurnIdFromResult(result)
    if (turnId) return turnId
    return this.waitForTurnStarted(-1, timeoutMs)
  }

  async steerTurn(params: unknown, timeoutMs = 30_000): Promise<void> {
    await this.request("turn/steer", params, timeoutMs)
  }

  async interruptTurn(params: unknown, timeoutMs = 30_000): Promise<void> {
    await this.request("turn/interrupt", params, timeoutMs)
  }

  async waitForTurnStarted(requestId: number, timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const message = await this.readNext(Math.min(1_000, deadline - Date.now()))
      if (!message) continue
      if (requestId >= 0 && "id" in message && message.id === requestId && !("method" in message && message.method)) {
        const turnId = extractTurnIdFromResult((message as JsonRpcResponse).result)
        if (turnId) return turnId
        const response = message as JsonRpcResponse
        if (response.error) {
          throw new Error(`codex turn/start failed: ${JSON.stringify(response.error)}`)
        }
      }
      if ("method" in message && message.method === "turn/started") {
        const turnId = extractTurnId(message)
        if (turnId) return turnId
      }
    }
    throw new Error("codex app-server timed out waiting for turn/started")
  }

  async waitForTurnEnd(turnId: string, timeoutMs: number): Promise<JsonRpcNotification> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const message = await this.readNext(Math.min(1_000, deadline - Date.now()))
      if (!message) continue
      if ("method" in message && message.method) {
        const notification = message as JsonRpcNotification
        if (
          (notification.method === "turn/completed" ||
            notification.method === "turn/failed" ||
            notification.method === "turn/interrupted") &&
          notificationTurnId(notification) === turnId
        ) {
          return notification
        }
      }
    }
    throw new Error(`codex app-server timed out waiting for turn ${turnId} to finish`)
  }

  private incoming: JsonRpcMessage[] = []
  private incomingWaiters: Array<(message: JsonRpcMessage | undefined) => void> = []

  private pushIncoming(message: JsonRpcMessage): void {
    if (this.incomingWaiters.length > 0) {
      const waiter = this.incomingWaiters.shift()
      waiter?.(message)
      return
    }
    this.incoming.push(message)
  }

  private readNext(timeoutMs: number): Promise<JsonRpcMessage | undefined> {
    if (this.deferred.length > 0) {
      return Promise.resolve(this.deferred.shift())
    }
    if (this.incoming.length > 0) {
      return Promise.resolve(this.incoming.shift())
    }
    if (this.stdoutClosed) {
      return Promise.resolve(undefined)
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const index = this.incomingWaiters.indexOf(resolve)
        if (index >= 0) this.incomingWaiters.splice(index, 1)
        resolve(undefined)
      }, timeoutMs)
      this.incomingWaiters.push((message) => {
        clearTimeout(timer)
        resolve(message)
      })
    })
  }

  private async pumpStdout(): Promise<void> {
    const stdout = this.proc.stdout
    if (!stdout || typeof stdout === "number") {
      this.stdoutClosed = true
      return
    }
    const reader = stdout.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        while (true) {
          const newlineIndex = buffer.indexOf("\n")
          if (newlineIndex < 0) break
          const line = buffer.slice(0, newlineIndex).trim()
          buffer = buffer.slice(newlineIndex + 1)
          if (!line) continue
          let message: JsonRpcMessage
          try {
            message = JSON.parse(line) as JsonRpcMessage
          } catch {
            continue
          }
          this.received.push(message)
          if ("id" in message && message.id !== undefined && !("method" in message && message.method)) {
            const pending = this.pending.get(Number(message.id))
            if (pending) {
              this.pending.delete(Number(message.id))
              const response = message as JsonRpcResponse
              if (response.error) pending.reject(new Error(JSON.stringify(response.error)))
              else pending.resolve(response.result)
            }
            continue
          }
          if ("method" in message && message.method && "id" in message && message.id !== undefined) {
            void this.handleServerRequest(message as JsonRpcServerRequest)
            continue
          }
          if ("method" in message && message.method) {
            this.options.onNotification?.(message as JsonRpcNotification)
            this.pushIncoming(message)
          }
        }
      }
    } finally {
      this.stdoutClosed = true
      reader.releaseLock()
      for (const pending of this.pending.values()) {
        pending.reject(new Error("codex app-server stdout closed"))
      }
      this.pending.clear()
      for (const waiter of this.incomingWaiters.splice(0)) {
        waiter(undefined)
      }
    }
  }

  private async drainStderr(): Promise<void> {
    const stderr = this.proc.stderr
    if (!stderr || typeof stderr === "number") return
    const reader = stderr.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      void decoder.decode(value, { stream: true })
    }
    reader.releaseLock()
  }

  private async handleServerRequest(message: JsonRpcServerRequest): Promise<void> {
    const handler = this.options.onServerRequest
    if (!handler) {
      await this.send({ jsonrpc: "2.0", id: message.id, error: { message: "no server-request handler" } })
      return
    }
    try {
      const result = await handler(message)
      await this.send({ jsonrpc: "2.0", id: message.id, result })
    } catch (error) {
      await this.send({
        jsonrpc: "2.0",
        id: message.id,
        error: { message: error instanceof Error ? error.message : String(error) },
      })
    }
  }
}

export function codexAppServerArgs(codexArgs: readonly string[]): string[] {
  const args = ["app-server"]
  let goalsEnabled = false
  for (let index = 0; index < codexArgs.length; index += 1) {
    const arg = codexArgs[index]
    if (
      arg === "exec" ||
      arg === "--json" ||
      arg === "--color" ||
      arg === "never" ||
      arg === "--skip-git-repo-check" ||
      arg === "--ephemeral" ||
      arg === "-o" ||
      arg === "-C" ||
      arg === "-"
    ) {
      if (arg === "-o" || arg === "-C") index += 1
      continue
    }
    if (arg === "-m" || arg === "-c" || arg === "--enable" || arg === "--disable") {
      const value = codexArgs[index + 1]
      if (value) {
        args.push(arg, value)
        if (arg === "--enable" && value === "goals") goalsEnabled = true
        index += 1
      }
      continue
    }
  }
  if (!goalsEnabled) args.push("--enable", "goals")
  return args
}

export function extractThreadId(message: JsonRpcMessage): string | undefined {
  const record = message as Record<string, unknown>
  const paths = ["/result/thread/id", "/result/threadId", "/params/thread/id", "/params/threadId"]
  for (const path of paths) {
    const value = pointer(record, path)
    if (typeof value === "string" && value.length > 0) return value
  }
  return undefined
}

export function extractTurnId(message: JsonRpcMessage): string | undefined {
  const fromResult = extractTurnIdFromResult((message as JsonRpcResponse).result ?? (message as JsonRpcNotification).params)
  if (fromResult) return fromResult
  const record = message as Record<string, unknown>
  const paths = ["/result/turn/id", "/result/turnId", "/params/turn/id", "/params/turnId"]
  for (const path of paths) {
    const value = pointer(record, path)
    if (typeof value === "string" && value.length > 0) return value
  }
  return undefined
}

export function extractTurnIdFromResult(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined
  const record = result as Record<string, unknown>
  const turn = record.turn
  if (turn && typeof turn === "object") {
    const id = (turn as Record<string, unknown>).id
    if (typeof id === "string" && id.length > 0) return id
  }
  const turnId = record.turnId
  return typeof turnId === "string" && turnId.length > 0 ? turnId : undefined
}

function notificationTurnId(notification: JsonRpcNotification): string | undefined {
  const params = notification.params
  if (!params || typeof params !== "object") return undefined
  const turn = (params as Record<string, unknown>).turn
  if (turn && typeof turn === "object") {
    const id = (turn as Record<string, unknown>).id
    if (typeof id === "string") return id
  }
  const turnId = (params as Record<string, unknown>).turnId
  return typeof turnId === "string" ? turnId : undefined
}

function pointer(value: Record<string, unknown>, path: string): unknown {
  const parts = path.split("/").filter(Boolean)
  let current: unknown = value
  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

export function resolveCodexTransport(): "app-server" | "exec" {
  const raw = process.env.STACK_CODEX_TRANSPORT?.trim().toLowerCase()
  if (raw === "exec") return "exec"
  return "app-server"
}
