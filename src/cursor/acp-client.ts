import {
  NdjsonRpcClient,
  type JsonRpcNotification,
  type JsonRpcServerRequest,
  type NdjsonProcessLaunch,
} from "../jsonrpc/ndjson-client.js"

export type CursorAcpClientOptions = {
  launch: NdjsonProcessLaunch
  clientName?: string
  clientVersion?: string
  onNotification?: (message: JsonRpcNotification) => void
  onServerRequest?: (message: JsonRpcServerRequest) => Promise<unknown>
}

export class CursorAcpClient {
  private readonly inner: NdjsonRpcClient
  private readonly initializeResult?: unknown

  private constructor(inner: NdjsonRpcClient, initializeResult?: unknown) {
    this.inner = inner
    this.initializeResult = initializeResult
  }

  static async start(options: CursorAcpClientOptions): Promise<CursorAcpClient> {
    let initializeResult: unknown
    const inner = await NdjsonRpcClient.start({
      launch: options.launch,
      label: "cursor acp",
      onNotification: options.onNotification,
      onServerRequest: options.onServerRequest,
      initialize: async function initialize(this: NdjsonRpcClient) {
        initializeResult = await this.request("initialize", {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: {
            name: options.clientName ?? "stack",
            version: options.clientVersion ?? "0.0.0",
          },
        })
        await this.notify("notifications/initialized", {})
      },
    })
    return new CursorAcpClient(inner, initializeResult)
  }

  supportsMidTurnSteering(): boolean {
    const meta = asRecord(asRecord(this.initializeResult)?._meta)
    return meta?.midTurnSteering === true
  }

  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    return this.inner.request(method, params, timeoutMs)
  }

  notify(method: string, params?: unknown): Promise<void> {
    return this.inner.notify(method, params)
  }

  async close(): Promise<void> {
    await this.inner.close()
  }
}

export function cursorAcpArgs(): string[] {
  return ["agent", "acp"]
}

export async function probeCursorAcpAvailability(launch: NdjsonProcessLaunch): Promise<boolean> {
  try {
    const client = await Promise.race([
      CursorAcpClient.start({ launch }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("cursor acp probe timed out")), 10_000)
      }),
    ])
    await client.close()
    return true
  } catch {
    return false
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}
