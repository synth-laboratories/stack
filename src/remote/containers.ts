import { environmentAuthStatus, type StackConfig } from "../config.js"

export type ContainersPanelStatus = "ready" | "missing-auth" | "offline"

export type ContainerSummary = {
  containerId: string
  name: string
  taskType?: string
  status: string
  internalUrl?: string
}

export type ContainersPanelSnapshot = {
  status: ContainersPanelStatus
  environmentName: string
  apiBaseUrl: string
  checkedAt: string
  message?: string
  containers: ContainerSummary[]
}

export async function readContainersPanelSnapshot(config: StackConfig): Promise<ContainersPanelSnapshot> {
  const auth = environmentAuthStatus(config.environment)
  const base: ContainersPanelSnapshot = {
    status: auth.hasAuth ? "offline" : "missing-auth",
    environmentName: config.environmentName,
    apiBaseUrl: config.environment.apiBaseUrl,
    checkedAt: new Date().toISOString(),
    message: auth.hasAuth ? "not checked yet" : auth.message,
    containers: [],
  }

  if (!auth.hasAuth) return base

  try {
    const payload = await getJson(config, "/v1/containers")
    return {
      ...base,
      status: "ready",
      checkedAt: new Date().toISOString(),
      message: "containers reachable",
      containers: readContainers(payload),
    }
  } catch (error) {
    return {
      ...base,
      status: "offline",
      checkedAt: new Date().toISOString(),
      message: errorMessage(error),
    }
  }
}

function readContainers(value: unknown): ContainerSummary[] {
  const items = Array.isArray(value) ? value : asArray(asRecord(value)?.items)
  return items
    .map((item): ContainerSummary | undefined => {
      const row = asRecord(item)
      const containerId = readString(row?.id) ?? readString(row?.container_id)
      if (!row || !containerId) return undefined
      return {
        containerId,
        name: readString(row.name) ?? containerId.slice(0, 8),
        taskType: readString(row.task_type),
        status: readString(row.status) ?? "unknown",
        internalUrl: readString(row.internal_url) ?? undefined,
      }
    })
    .filter((row): row is ContainerSummary => Boolean(row))
}

async function getJson(config: StackConfig, path: string): Promise<unknown> {
  const token = process.env[config.environment.authEnv]
  if (!token) throw new Error(environmentAuthStatus(config.environment).message)
  const response = await fetch(`${config.environment.apiBaseUrl.replace(/\/+$/, "")}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return JSON.parse(await response.text()) as unknown
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
