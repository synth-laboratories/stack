export const DEFAULT_STACK_API_URL = "http://127.0.0.1:8792"

export type StackdHealth = {
  ok: boolean
  stackd_version: string
  stack_version?: string
  channel?: string
  session_log_dir: string
}

export type StackdThreadSummary = {
  id: string
  path: string
  startedAt: string
  updatedAt: string
  turnCount: number
  lastPrompt?: string
  codexThreadId?: string
  usageSummary?: unknown
}

export type StackdTrace = {
  stack_session_id: string
  stack_session_path: string
  codex_thread_id?: string
  codex_session_path?: string
  turn_count: number
  usage_summary?: unknown
  turns: Array<{
    index: number
    prompt_preview?: string
    exit_code?: number
    started_at: string
    finished_at?: string
  }>
}

export type StackdStatus = {
  ok: boolean
  stackd_version: string
  stack_version?: string
  channel?: string
  session_log_dir: string
  runtime_status_path: string
  session_count: number
  latest_session?: StackdThreadSummary
  runtime?: unknown
}

export type StackdExport = {
  export_dir: string
}

export function stackdBaseUrl(): string {
  return process.env.STACK_API_URL?.trim() || DEFAULT_STACK_API_URL
}

export async function stackdHealthOk(baseUrl = stackdBaseUrl()): Promise<boolean> {
  try {
    const health = await stackdHealth(baseUrl)
    return health.ok === true
  } catch {
    return false
  }
}

export async function stackdHealth(baseUrl = stackdBaseUrl()): Promise<StackdHealth> {
  return requestJson<StackdHealth>(baseUrl, "/health")
}

export async function stackdStatus(baseUrl = stackdBaseUrl()): Promise<StackdStatus> {
  return requestJson<StackdStatus>(baseUrl, "/status")
}

export async function stackdThreads(baseUrl = stackdBaseUrl()): Promise<StackdThreadSummary[]> {
  return requestJson<StackdThreadSummary[]>(baseUrl, "/threads")
}

export async function stackdThread(id: string, baseUrl = stackdBaseUrl()): Promise<unknown> {
  return requestJson<unknown>(baseUrl, `/threads/${encodeURIComponent(id)}`)
}

export async function stackdTrace(id: string, baseUrl = stackdBaseUrl()): Promise<StackdTrace> {
  return requestJson<StackdTrace>(baseUrl, `/threads/${encodeURIComponent(id)}/trace`)
}

export async function stackdExport(id: string, baseUrl = stackdBaseUrl()): Promise<StackdExport> {
  return requestJson<StackdExport>(baseUrl, `/threads/${encodeURIComponent(id)}/export`)
}

async function requestJson<T>(baseUrl: string, path: string): Promise<T> {
  const response = await fetch(new URL(path, ensureTrailingSlash(baseUrl)))
  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`stackd ${path} failed with ${response.status}: ${body}`)
  }
  return (await response.json()) as T
}

function ensureTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
}
