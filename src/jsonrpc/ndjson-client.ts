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

export type NdjsonProcessLaunch = {
  command: string
  args: string[]
  cwd: string
  env?: Record<string, string | undefined>
}

export type NdjsonClientOptions = {
  launch: NdjsonProcessLaunch
  label: string
  onNotification?: (message: JsonRpcNotification) => void
  onServerRequest?: (message: JsonRpcServerRequest) => Promise<unknown>
  initialize: () => Promise<void>
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export class NdjsonRpcClient {
  private readonly proc: Subprocess
  private readonly pending = new Map<number, PendingRequest>()
  private nextId = 1
  private stdinClosed = false
  private readonly pumpPromise: Promise<void>
  private readonly options: NdjsonClientOptions

  private constructor(proc: Subprocess, options: NdjsonClientOptions) {
    this.proc = proc
    this.options = options
    this.pumpPromise = this.pumpStdout()
  }

  static async start(options: NdjsonClientOptions): Promise<NdjsonRpcClient> {
    const { launch } = options
    const proc = Bun.spawn([launch.command, ...launch.args], {
      cwd: launch.cwd,
      env: launch.env ? { ...process.env, ...launch.env } : process.env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })
    const client = new NdjsonRpcClient(proc, options)
    void client.drainStderr()
    await options.initialize.call(client)
    return client
  }

  request(method: string, params: unknown, timeoutMs = 120_000): Promise<unknown> {
    const id = this.nextId++
    const payload: JsonRpcRequest = { jsonrpc: "2.0", id, method, params }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${this.options.label} timed out waiting for response ${id} (${method})`))
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

  protected async send(payload: JsonRpcMessage): Promise<void> {
    if (this.stdinClosed) {
      throw new Error(`${this.options.label} stdin is closed`)
    }
    const line = `${JSON.stringify(payload)}\n`
    const stdin = this.proc.stdin
    if (!stdin || typeof stdin === "number") {
      throw new Error(`${this.options.label} stdin unavailable`)
    }
    if (typeof (stdin as { write?: (chunk: string) => void }).write === "function") {
      ;(stdin as { write: (chunk: string) => void }).write(line)
      return
    }
    throw new Error(`${this.options.label} stdin is not writable`)
  }

  private async pumpStdout(): Promise<void> {
    const stdout = this.proc.stdout
    if (!stdout || typeof stdout === "number") return
    const reader = stdout.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newlineIndex = buffer.indexOf("\n")
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        if (line) this.handleLine(line)
        newlineIndex = buffer.indexOf("\n")
      }
    }

    const trailing = decoder.decode()
    if (trailing) buffer += trailing
    if (buffer.trim()) this.handleLine(buffer.trim())
    reader.releaseLock()
    for (const pending of this.pending.values()) {
      pending.reject(new Error(`${this.options.label} stdout closed`))
    }
    this.pending.clear()
  }

  private handleLine(line: string): void {
    let message: JsonRpcMessage
    try {
      message = JSON.parse(line) as JsonRpcMessage
    } catch {
      return
    }

    if ("method" in message && message.method && "id" in message && message.id !== undefined && !("result" in message) && !("error" in message)) {
      void this.handleServerRequest(message as JsonRpcServerRequest)
      return
    }

    if ("method" in message && message.method && !("id" in message)) {
      this.options.onNotification?.(message as JsonRpcNotification)
      return
    }

    if ("id" in message && message.id !== undefined) {
      const pending = this.pending.get(message.id as number)
      if (!pending) return
      this.pending.delete(message.id as number)
      const response = message as JsonRpcResponse
      if (response.error) {
        pending.reject(new Error(`${this.options.label} ${response.error.message ?? JSON.stringify(response.error)}`))
        return
      }
      pending.resolve(response.result)
    }
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
}
