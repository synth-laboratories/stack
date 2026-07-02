import { environmentAuthStatus, type StackConfig } from "../config.js"

export type ContainerPoolRemoteStatus = "ready" | "missing-auth" | "offline"

export type ContainersPanelStatus = ContainerPoolRemoteStatus

export type ContainerPoolSummary = {
  poolId: string
  name?: string
  type?: string
  status?: string
  state?: string
  adapter?: string
  containerUrl?: string
  taskCount?: number
  createdAt?: string
  updatedAt?: string
}

export type ContainerSummary = {
  containerId: string
  name: string
  taskType?: string
  status: string
  internalUrl?: string
}

export type ContainerPoolsSnapshot = {
  status: ContainerPoolRemoteStatus
  environmentName: string
  apiBaseUrl: string
  checkedAt: string
  message?: string
  state?: string
  nextCursor?: string
  pools: ContainerPoolSummary[]
}

export type ContainerPoolHealthResult = {
  ok: boolean
  status: number
  environmentName: string
  apiBaseUrl: string
  poolId: string
  taskId?: string
  message: string
  data?: Record<string, unknown>
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
  const snapshot = await readContainerPools(config)
  return {
    status: snapshot.status,
    environmentName: snapshot.environmentName,
    apiBaseUrl: snapshot.apiBaseUrl,
    checkedAt: snapshot.checkedAt,
    message: snapshot.message,
    containers: snapshot.pools.map((pool) => ({
      containerId: pool.poolId,
      name: pool.name ?? pool.poolId.slice(0, 8),
      taskType: pool.type ?? pool.adapter,
      status: pool.status ?? pool.state ?? "unknown",
      internalUrl: pool.containerUrl,
    })),
  }
}

export async function readContainerPools(
  config: StackConfig,
  options: { limit?: number; state?: string } = {},
): Promise<ContainerPoolsSnapshot> {
  const auth = environmentAuthStatus(config.environment)
  const base: ContainerPoolsSnapshot = {
    status: auth.hasAuth ? "offline" : "missing-auth",
    environmentName: config.environmentName,
    apiBaseUrl: config.environment.apiBaseUrl,
    checkedAt: new Date().toISOString(),
    message: auth.hasAuth ? "not checked yet" : auth.message,
    state: options.state,
    pools: [],
  }
  if (!auth.hasAuth) return base

  const params = new URLSearchParams()
  if (options.limit) params.set("limit", String(options.limit))
  if (options.state) params.set("state", options.state)
  const path = `/v1/pools${params.size > 0 ? `?${params.toString()}` : ""}`
  const result = await requestJson(config, path)
  if (!result.ok) {
    return {
      ...base,
      status: "offline",
      checkedAt: new Date().toISOString(),
      message: result.message,
    }
  }

  const payload = asRecord(result.data)
  return {
    ...base,
    status: "ready",
    checkedAt: new Date().toISOString(),
    message: "container pools reachable",
    nextCursor: readString(payload?.next_cursor) ?? readString(payload?.nextCursor),
    pools: readPools(result.data),
  }
}

export async function readContainerPoolHealth(
  config: StackConfig,
  options: { poolId: string; taskId?: string },
): Promise<ContainerPoolHealthResult> {
  const auth = environmentAuthStatus(config.environment)
  const base = {
    environmentName: config.environmentName,
    apiBaseUrl: config.environment.apiBaseUrl,
    poolId: options.poolId,
    ...(options.taskId ? { taskId: options.taskId } : {}),
  }
  if (!auth.hasAuth) {
    return {
      ...base,
      ok: false,
      status: 0,
      message: auth.message,
    }
  }

  const poolId = encodeURIComponent(options.poolId)
  const path = options.taskId
    ? `/v1/pools/${poolId}/tasks/${encodeURIComponent(options.taskId)}/container/health`
    : `/v1/pools/${poolId}/container/health`
  const result = await requestJson(config, path)
  return {
    ...base,
    ok: result.ok,
    status: result.status,
    message: result.ok ? "container health reachable" : result.message,
    data: asRecord(result.data) ?? { value: result.data },
  }
}

function readPools(value: unknown): ContainerPoolSummary[] {
  return firstNonEmptyArray(value)
    .map(readPool)
    .filter((pool): pool is ContainerPoolSummary => Boolean(pool))
}

function firstNonEmptyArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  const payload = asRecord(value)
  if (!payload) return []
  for (const key of ["items", "pools", "results", "data"]) {
    const candidate = payload[key]
    if (Array.isArray(candidate) && candidate.length > 0) return candidate
  }
  return []
}

function readPool(value: unknown): ContainerPoolSummary | undefined {
  const record = asRecord(value)
  const pool = asRecord(record?.pool) ?? record
  if (!pool) return undefined
  const poolId = readString(pool.pool_id) ?? readString(pool.id)
  if (!poolId) return undefined
  const tasks = Array.isArray(pool.tasks) ? pool.tasks : undefined
  const config = asRecord(pool.config)
  return {
    poolId,
    name: readString(pool.name) ?? readString(pool.display_name),
    type: readString(pool.type) ?? readString(pool.container_type) ?? readString(config?.type),
    status: readString(pool.status),
    state: readString(pool.state),
    adapter: readString(pool.adapter) ?? readString(config?.adapter),
    containerUrl: readString(pool.container_url) ?? readString(config?.container_url),
    taskCount: readNumber(pool.task_count) ?? readNumber(pool.tasks_count) ?? tasks?.length,
    createdAt: readString(pool.created_at),
    updatedAt: readString(pool.updated_at),
  }
}

async function requestJson(
  config: StackConfig,
  path: string,
): Promise<{ ok: boolean; status: number; message: string; data?: unknown }> {
  const token = process.env[config.environment.authEnv]
  if (!token) {
    return { ok: false, status: 0, message: environmentAuthStatus(config.environment).message }
  }
  try {
    const response = await fetch(`${config.environment.apiBaseUrl.replace(/\/+$/, "")}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
    })
    const text = await response.text()
    const data = parseJson(text)
    return {
      ok: response.ok,
      status: response.status,
      message: response.ok ? "ok" : text.slice(0, 500) || response.statusText,
      data,
    }
  } catch (error) {
    return { ok: false, status: 0, message: errorMessage(error) }
  }
}

function parseJson(text: string): unknown {
  if (!text.trim()) return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    return { text }
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
