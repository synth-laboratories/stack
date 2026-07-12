const CODE_FACTORY_API_PATH = "/api/v1/code-factory"

export const CODE_FACTORY_CONTRACT_VERSION = "internal-code-factory.milestone1.v1"
export const CODE_FACTORY_EVENT_CONTRACT_VERSION = "internal-code-factory.event.v1"
export const CODE_FACTORY_REQUIRED_MODEL = "gpt-5.6-sol"
export const DEFAULT_CODE_FACTORY_API_URL = "http://127.0.0.1:8787"
export const DEFAULT_CODE_FACTORY_AUTH_ENV = "SB_ADMIN_TOKEN"
export const DEFAULT_CODE_FACTORY_TIMEOUT_MS = 15_000

export type CodeFactoryJsonObject = Record<string, unknown>

export type CodeFactorySessionState =
  | "queued"
  | "starting"
  | "running"
  | "paused"
  | "waiting_for_ci"
  | "blocked"
  | "succeeded"
  | "failed"
  | "canceled"

export type CodeFactoryModelSelection = {
  model: string
  reasoning_effort: string
}

export type CodeFactoryCodexThreadIdentity = {
  codex_thread_id: string
  session_id: string
  provider: string
  runtime: string
  created_at: string
  last_observed_at: string
}

export type CodeFactoryRepositoryVerification = {
  verified_at: string
  clean: boolean
  committed: boolean
  pushed: boolean
  fetchable: boolean
  base_is_ancestor: boolean
  checkout_head_sha: string
  remote_ref: string
  remote_head_sha: string
}

export type CodeFactoryRepositoryRevision = {
  repository_id: string
  remote_url: string
  base_ref: string
  base_sha: string
  branch: string | null
  head_sha: string
  writable: boolean
  subdirectory: string
  verification: CodeFactoryRepositoryVerification
}

export type CodeFactoryWorkspaceRevision = {
  workspace_revision_id: string
  created_at: string
  repositories: CodeFactoryRepositoryRevision[]
  workspace_revision_digest: string
}

export type CodeFactoryBranchWriterLease = {
  branch_writer_lease_id: string
  session_id: string
  repository_id: string
  branch: string
  owner_actor_id: string
  fencing_token: number
  status: string
  acquired_at: string
  heartbeat_at: string
  expires_at: string
  released_at: string | null
  release_reason: string | null
}

export type CodeFactoryModelReceipt = {
  model_receipt_id: string
  session_id: string
  codex_thread_id: string
  provider: string
  runtime: string
  requested: CodeFactoryModelSelection
  observed: CodeFactoryModelSelection
  matches_request: boolean
  recorded_at: string
}

export type CodeFactoryCommandReceipt = {
  command_receipt_id: string
  request_id: string
  session_id: string
  command: string
  idempotency_key: string
  accepted_at: string
  replayed: boolean
  event_id: string
}

export type CodeFactoryCommitActor = {
  actor_id: string
  name: string
  email: string
}

export type CodeFactoryCommitReceipt = {
  commit_receipt_id: string
  session_id: string
  repository_id: string
  branch_writer_lease_id: string
  fencing_token: number
  branch: string
  base_sha: string
  parent_shas: string[]
  commit_sha: string
  commit_message: string
  author: CodeFactoryCommitActor
  committer: CodeFactoryCommitActor
  committed_at: string
  changed_files: string[]
  diff_digest: string
  workspace_revision_before_id: string
  workspace_revision_after_id: string
  pushed_at: string
  remote_ref: string
  remote_head_sha: string
  fetchability_verified_at: string
}

export type CodeFactoryDiffReceipt = {
  diff_receipt_id: string
  session_id: string
  repository_id: string
  workspace_revision_id: string
  base_sha: string
  head_sha: string
  changed_files: string[]
  insertions: number
  deletions: number
  patch_digest: string
  patch_uri: string | null
}

export type CodeFactoryOrderedEventEnvelope = {
  contract_version: string
  cursor: number
  event_id: string
  session_id: string
  event_type: string
  occurred_at: string
  persisted_at: string
  causation_id: string | null
  idempotency_key: string | null
  payload: CodeFactoryJsonObject
}

export type CodeFactoryCleanupResourceReceipt = {
  resource_id: string
  resource_type: string
  owner_session_id: string
  action: string
  result: string
  evidence: CodeFactoryJsonObject
}

export type CodeFactoryCleanupReceipt = {
  cleanup_receipt_id: string
  session_id: string
  started_at: string
  completed_at: string
  status: string
  foreign_resources_touched: boolean
  resources: CodeFactoryCleanupResourceReceipt[]
  owned_resources_remaining: string[]
}

export type CodeFactoryCodingSession = {
  session_id: string
  objective: string
  state: CodeFactorySessionState | string
  codex_thread_id: string
  workspace_revision_id: string
  branch_writer_lease_ids: string[]
  model_receipt_id: string
  cleanup_receipt_id: string | null
  created_at: string
  updated_at: string
  last_event_cursor: number
}

export type CodeFactorySessionDetail = {
  contract_version: string
  session: CodeFactoryCodingSession
  codex_thread: CodeFactoryCodexThreadIdentity
  workspace_revision: CodeFactoryWorkspaceRevision
  branch_writer_leases: CodeFactoryBranchWriterLease[]
  model_receipt: CodeFactoryModelReceipt
  command_receipts: CodeFactoryCommandReceipt[]
  commits: CodeFactoryCommitReceipt[]
  diffs: CodeFactoryDiffReceipt[]
  events: CodeFactoryOrderedEventEnvelope[]
  cleanup_receipt: CodeFactoryCleanupReceipt | null
}

export type CodeFactorySessionSummary = {
  session: CodeFactoryCodingSession
  model: CodeFactoryModelReceipt
  repositories: CodeFactoryRepositoryRevision[]
}

/**
 * This is the v1 create body used by the Code Factory API. Stack sends it to
 * the API and does not retain any of these identities or revisions locally.
 */
export type CodeFactoryCreateSessionRequest = {
  request_id: string
  session_id?: string
  objective: string
  codex_thread: CodeFactoryCodexThreadIdentity
  workspace_revision: CodeFactoryWorkspaceRevision
  branch_writer_leases: CodeFactoryBranchWriterLease[]
  model_receipt: CodeFactoryModelReceipt
  [key: string]: unknown
}

export type CodeFactoryPromptRequest = {
  request_id: string
  prompt: string
}

export type CodeFactoryControlRequest = {
  request_id: string
}

export type CodeFactoryClientOptions = {
  baseUrl?: string
  token?: string
  authEnv?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export type CodeFactoryStreamOptions = {
  afterCursor?: number
  signal?: AbortSignal
}

export type CodeFactoryWatchOptions = CodeFactoryStreamOptions & {
  reconnectDelayMs?: number
}

export class CodeFactoryHttpError extends Error {
  readonly baseUrl: string
  readonly path: string
  readonly status: number
  readonly body: string

  constructor(baseUrl: string, path: string, status: number, body: string) {
    super(`Code Factory request failed: ${status} ${path}`)
    this.name = "CodeFactoryHttpError"
    this.baseUrl = baseUrl
    this.path = path
    this.status = status
    this.body = body
  }
}

export class CodeFactoryProtocolError extends Error {
  constructor(message: string) {
    super(`Code Factory protocol error: ${message}`)
    this.name = "CodeFactoryProtocolError"
  }
}

export class CodeFactoryAuthError extends Error {
  constructor(authEnv: string) {
    super(
      `Code Factory mutations require a bearer token; set STACK_CODE_FACTORY_API_TOKEN or ${authEnv}`,
    )
    this.name = "CodeFactoryAuthError"
  }
}

type RequestOptions = {
  body?: unknown
  idempotencyKey?: string
  mutation?: boolean
  signal?: AbortSignal
  stream?: boolean
}

export class CodeFactoryClient {
  readonly baseUrl: string
  readonly authEnv: string
  private readonly token?: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: CodeFactoryClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_CODE_FACTORY_API_URL)
    this.authEnv = options.authEnv?.trim() || DEFAULT_CODE_FACTORY_AUTH_ENV
    this.token = nonEmpty(options.token)
    this.timeoutMs = options.timeoutMs ?? DEFAULT_CODE_FACTORY_TIMEOUT_MS
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async listSessions(): Promise<CodeFactorySessionSummary[]> {
    const payload = await this.requestJson<unknown>("GET", `${CODE_FACTORY_API_PATH}/sessions`)
    const values = arrayPayload(payload, "sessions")
    return values.map((value, index) => parseSessionSummary(value, `sessions[${index}]`))
  }

  async getSession(sessionId: string): Promise<CodeFactorySessionDetail> {
    const id = requiredIdentifier(sessionId, "session id")
    const payload = await this.requestJson<unknown>(
      "GET",
      `${CODE_FACTORY_API_PATH}/sessions/${encodeURIComponent(id)}`,
    )
    return parseSessionDetail(payload)
  }

  async createSession(
    request: CodeFactoryCreateSessionRequest,
    idempotencyKey: string,
  ): Promise<CodeFactoryCommandReceipt> {
    const body = requireObject(request, "create request") as CodeFactoryCreateSessionRequest
    return parseCommandReceipt(
      await this.requestJson<unknown>("POST", `${CODE_FACTORY_API_PATH}/sessions`, {
        body,
        idempotencyKey,
        mutation: true,
      }),
    )
  }

  async prompt(
    sessionId: string,
    prompt: string,
    idempotencyKey: string,
    requestId = idempotencyKey,
  ): Promise<CodeFactoryCommandReceipt> {
    const body: CodeFactoryPromptRequest = {
      request_id: requiredIdentifier(requestId, "request id"),
      prompt: requireText(prompt, "prompt"),
    }
    return parseCommandReceipt(
      await this.requestJson<unknown>(
        "POST",
        `${CODE_FACTORY_API_PATH}/sessions/${encodeURIComponent(requiredIdentifier(sessionId, "session id"))}/prompts`,
        { body, idempotencyKey, mutation: true },
      ),
    )
  }

  async pause(
    sessionId: string,
    idempotencyKey: string,
    requestId = idempotencyKey,
  ): Promise<CodeFactoryCommandReceipt> {
    return this.control("pause", sessionId, idempotencyKey, requestId)
  }

  async resume(
    sessionId: string,
    idempotencyKey: string,
    requestId = idempotencyKey,
  ): Promise<CodeFactoryCommandReceipt> {
    return this.control("resume", sessionId, idempotencyKey, requestId)
  }

  async cancel(
    sessionId: string,
    idempotencyKey: string,
    requestId = idempotencyKey,
  ): Promise<CodeFactoryCommandReceipt> {
    return this.control("cancel", sessionId, idempotencyKey, requestId)
  }

  async listEvents(sessionId: string, afterCursor?: number): Promise<CodeFactoryOrderedEventEnvelope[]> {
    const cursor = optionalCursor(afterCursor)
    const path = `${CODE_FACTORY_API_PATH}/sessions/${encodeURIComponent(requiredIdentifier(sessionId, "session id"))}/events`
    const pathWithCursor = cursor === undefined ? path : `${path}?after_cursor=${cursor}`
    const payload = await this.requestJson<unknown>("GET", pathWithCursor)
    const values = arrayPayload(payload, "events")
    return parseEvents(values, cursor)
  }

  async *streamEvents(options: CodeFactoryStreamOptions & { sessionId: string }): AsyncGenerator<CodeFactoryOrderedEventEnvelope> {
    const afterCursor = optionalCursor(options.afterCursor)
    const sessionId = requiredIdentifier(options.sessionId, "session id")
    const path = `${CODE_FACTORY_API_PATH}/sessions/${encodeURIComponent(sessionId)}/events/stream`
    const url = this.url(path, afterCursor)
    const headers = this.headers("text/event-stream")
    if (afterCursor !== undefined) headers.set("Last-Event-ID", String(afterCursor))
    const response = await this.requestStream(url, path, headers, options.signal)
    if (!response.body) throw new CodeFactoryProtocolError("event stream response has no body")

    for await (const frame of parseSse(response.body)) {
      if (!frame.data) continue
      let payload: unknown
      try {
        payload = JSON.parse(frame.data) as unknown
      } catch {
        throw new CodeFactoryProtocolError("event stream data is not valid JSON")
      }
      const event = parseEvent(payload, "event stream")
      if (frame.id !== undefined && frame.id !== String(event.cursor)) {
        throw new CodeFactoryProtocolError(
          `event stream id ${JSON.stringify(frame.id)} does not match cursor ${event.cursor}`,
        )
      }
      if (frame.event !== undefined && frame.event !== event.event_type) {
        throw new CodeFactoryProtocolError(
          `event stream type ${JSON.stringify(frame.event)} does not match ${JSON.stringify(event.event_type)}`,
        )
      }
      yield event
    }
  }

  async *watchEvents(
    options: CodeFactoryWatchOptions & { sessionId: string },
  ): AsyncGenerator<CodeFactoryOrderedEventEnvelope> {
    let afterCursor = optionalCursor(options.afterCursor)
    const reconnectDelayMs = Math.max(0, Math.floor(options.reconnectDelayMs ?? 1000))

    while (!options.signal?.aborted) {
      try {
        for await (const event of this.streamEvents({
          sessionId: options.sessionId,
          afterCursor,
          signal: options.signal,
        })) {
          afterCursor = event.cursor
          yield event
        }
      } catch (error) {
        if (options.signal?.aborted || isAbortError(error)) return
        if (error instanceof CodeFactoryHttpError && error.status < 500) throw error
        if (!isTransientStreamError(error)) throw error
      }

      if (options.signal?.aborted) return
      await delayWithAbort(reconnectDelayMs, options.signal)
    }
  }

  private async control(
    command: "pause" | "resume" | "cancel",
    sessionId: string,
    idempotencyKey: string,
    requestId: string,
  ): Promise<CodeFactoryCommandReceipt> {
    const body: CodeFactoryControlRequest = {
      request_id: requiredIdentifier(requestId, "request id"),
    }
    return parseCommandReceipt(
      await this.requestJson<unknown>(
        "POST",
        `${CODE_FACTORY_API_PATH}/sessions/${encodeURIComponent(requiredIdentifier(sessionId, "session id"))}/${command}`,
        { body, idempotencyKey, mutation: true },
      ),
    )
  }

  private headers(accept: string): Headers {
    const headers = new Headers({ Accept: accept })
    if (this.token) headers.set("Authorization", `Bearer ${this.token}`)
    return headers
  }

  private url(path: string, afterCursor?: number): URL {
    const url = new URL(path, `${this.baseUrl}/`)
    if (afterCursor !== undefined) url.searchParams.set("after_cursor", String(afterCursor))
    return url
  }

  private async requestJson<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const headers = this.headers("application/json")
    const body = options.body === undefined ? undefined : JSON.stringify(options.body)
    if (body !== undefined) headers.set("Content-Type", "application/json")
    if (options.idempotencyKey !== undefined) {
      headers.set("Idempotency-Key", requiredIdentifier(options.idempotencyKey, "idempotency key"))
    }
    if (options.mutation && !this.token) throw new CodeFactoryAuthError(this.authEnv)

    const url = this.url(path)
    const response = await this.fetchWithTimeout(url, {
      method,
      headers,
      body,
      signal: options.signal,
    })
    const text = await response.text()
    if (!response.ok) throw new CodeFactoryHttpError(this.baseUrl, path, response.status, redact(text, this.token))
    if (!text.trim()) return undefined as T
    try {
      return JSON.parse(text) as T
    } catch {
      throw new CodeFactoryProtocolError(`${method} ${path} returned invalid JSON`)
    }
  }

  private async requestStream(
    url: URL,
    path: string,
    headers: Headers,
    signal?: AbortSignal,
  ): Promise<Response> {
    const response = await this.fetchWithTimeout(url, {
      method: "GET",
      headers,
      signal,
      stream: true,
    })
    if (!response.ok) {
      const text = await response.text()
      throw new CodeFactoryHttpError(this.baseUrl, path, response.status, redact(text, this.token))
    }
    return response
  }

  private async fetchWithTimeout(url: URL, init: RequestInit & { stream?: boolean }): Promise<Response> {
    if (init.stream) {
      const { stream: _stream, ...requestInit } = init
      return this.fetchImpl(url, requestInit)
    }
    const controller = new AbortController()
    const timeout = init.stream ? undefined : setTimeout(() => controller.abort(), this.timeoutMs)
    const forwardAbort = (): void => controller.abort()
    if (init.signal) {
      if (init.signal.aborted) controller.abort()
      else init.signal.addEventListener("abort", forwardAbort, { once: true })
    }
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal })
    } finally {
      if (timeout !== undefined) clearTimeout(timeout)
      init.signal?.removeEventListener("abort", forwardAbort)
    }
  }
}

export function createCodeFactoryClientFromEnv(
  env: Record<string, string | undefined> = process.env,
): CodeFactoryClient {
  const authEnv = nonEmpty(env.STACK_CODE_FACTORY_AUTH_ENV) ?? DEFAULT_CODE_FACTORY_AUTH_ENV
  const token = nonEmpty(env.STACK_CODE_FACTORY_API_TOKEN) ?? nonEmpty(env[authEnv])
  return new CodeFactoryClient({
    baseUrl: nonEmpty(env.STACK_CODE_FACTORY_API_URL) ?? DEFAULT_CODE_FACTORY_API_URL,
    token,
    authEnv,
  })
}

function parseSessionSummary(value: unknown, context: string): CodeFactorySessionSummary {
  const record = requireObject(value, context)
  requireObject(record.session, `${context}.session`)
  requireObject(record.model, `${context}.model`)
  requireArray(record.repositories, `${context}.repositories`)
  return record as unknown as CodeFactorySessionSummary
}

function parseSessionDetail(value: unknown): CodeFactorySessionDetail {
  const record = requireObject(value, "session detail")
  if (record.contract_version !== CODE_FACTORY_CONTRACT_VERSION) {
    throw new CodeFactoryProtocolError(
      `session detail contract_version must be ${CODE_FACTORY_CONTRACT_VERSION}`,
    )
  }
  requireObject(record.session, "session detail.session")
  requireObject(record.codex_thread, "session detail.codex_thread")
  requireObject(record.workspace_revision, "session detail.workspace_revision")
  requireArray(record.branch_writer_leases, "session detail.branch_writer_leases")
  requireObject(record.model_receipt, "session detail.model_receipt")
  requireArray(record.command_receipts, "session detail.command_receipts")
  requireArray(record.commits, "session detail.commits")
  requireArray(record.diffs, "session detail.diffs")
  const events = requireArray(record.events, "session detail.events")
  parseEvents(events, undefined)
  return record as unknown as CodeFactorySessionDetail
}

function parseCommandReceipt(value: unknown): CodeFactoryCommandReceipt {
  const record = requireObject(value, "command receipt")
  for (const key of [
    "command_receipt_id",
    "request_id",
    "session_id",
    "command",
    "idempotency_key",
    "accepted_at",
    "event_id",
  ]) {
    requireString(record[key], `command receipt.${key}`)
  }
  requireBoolean(record.replayed, "command receipt.replayed")
  return record as unknown as CodeFactoryCommandReceipt
}

function parseEvents(values: unknown[], afterCursor: number | undefined): CodeFactoryOrderedEventEnvelope[] {
  let previous = afterCursor ?? 0
  return values.map((value, index) => {
    const event = parseEvent(value, `events[${index}]`)
    if (event.cursor <= previous) {
      throw new CodeFactoryProtocolError(
        `events must have strictly increasing cursors; saw ${event.cursor} after ${previous}`,
      )
    }
    previous = event.cursor
    return event
  })
}

function parseEvent(value: unknown, context: string): CodeFactoryOrderedEventEnvelope {
  const record = requireObject(value, context)
  if (record.contract_version !== CODE_FACTORY_EVENT_CONTRACT_VERSION) {
    throw new CodeFactoryProtocolError(
      `${context}.contract_version must be ${CODE_FACTORY_EVENT_CONTRACT_VERSION}`,
    )
  }
  requireInteger(record.cursor, `${context}.cursor`)
  if ((record.cursor as number) < 1) throw new CodeFactoryProtocolError(`${context}.cursor must be positive`)
  for (const key of ["event_id", "session_id", "event_type", "occurred_at", "persisted_at"]) {
    requireString(record[key], `${context}.${key}`)
  }
  if (record.causation_id !== null) requireString(record.causation_id, `${context}.causation_id`)
  if (record.idempotency_key !== null) requireString(record.idempotency_key, `${context}.idempotency_key`)
  requireObject(record.payload, `${context}.payload`)
  return record as unknown as CodeFactoryOrderedEventEnvelope
}

function arrayPayload(value: unknown, label: string): unknown[] {
  if (Array.isArray(value)) return value
  if (isRecord(value) && Array.isArray(value[label])) return value[label]
  throw new CodeFactoryProtocolError(`${label} response must be an array`)
}

function requireObject(value: unknown, context: string): CodeFactoryJsonObject {
  if (!isRecord(value)) throw new CodeFactoryProtocolError(`${context} must be an object`)
  return value
}

function requireArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) throw new CodeFactoryProtocolError(`${context} must be an array`)
  return value
}

function requireString(value: unknown, context: string): string {
  if (typeof value !== "string" || !value.trim()) throw new CodeFactoryProtocolError(`${context} must be a non-empty string`)
  return value
}

function requireText(value: string, context: string): string {
  if (!value.trim()) throw new CodeFactoryProtocolError(`${context} must not be empty`)
  return value
}

function requireBoolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") throw new CodeFactoryProtocolError(`${context} must be a boolean`)
  return value
}

function requireInteger(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new CodeFactoryProtocolError(`${context} must be an integer`)
  return value
}

function requiredIdentifier(value: string, context: string): string {
  const normalized = value.trim()
  if (!normalized) throw new CodeFactoryProtocolError(`${context} must not be empty`)
  return normalized
}

function optionalCursor(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || value < 0) throw new CodeFactoryProtocolError("after_cursor must be a non-negative integer")
  return value
}

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}

function normalizeBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, "")
  if (!normalized) throw new CodeFactoryProtocolError("Code Factory API URL must not be empty")
  try {
    new URL(`${normalized}/`)
  } catch {
    throw new CodeFactoryProtocolError("Code Factory API URL must be an absolute URL")
  }
  return normalized
}

function isRecord(value: unknown): value is CodeFactoryJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function redact(value: string, secret: string | undefined): string {
  if (!secret) return value
  return value.split(secret).join("[redacted]")
}

type SseFrame = {
  id?: string
  event?: string
  data: string
}

async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let id: string | undefined
  let event: string | undefined
  let data: string[] = []

  const dispatch = (): SseFrame | undefined => {
    if (data.length === 0) {
      id = undefined
      event = undefined
      return undefined
    }
    const frame: SseFrame = { id, event, data: data.join("\n") }
    id = undefined
    event = undefined
    data = []
    return frame
  }

  const consume = (line: string): SseFrame | undefined => {
    if (line === "") return dispatch()
    if (line.startsWith(":")) return undefined
    const separator = line.indexOf(":")
    const field = separator < 0 ? line : line.slice(0, separator)
    let value = separator < 0 ? "" : line.slice(separator + 1)
    if (value.startsWith(" ")) value = value.slice(1)
    if (field === "id") id = value
    else if (field === "event") event = value
    else if (field === "data") data.push(value)
    return undefined
  }

  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ""
      for (const line of lines) {
        const frame = consume(line)
        if (frame) yield frame
      }
    }
    buffer += decoder.decode()
    if (buffer) {
      const frame = consume(buffer.replace(/\r$/, ""))
      if (frame) yield frame
    }
    const frame = dispatch()
    if (frame) yield frame
  } finally {
    reader.releaseLock()
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError"
}

function isTransientStreamError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof CodeFactoryHttpError && error.status >= 500)
}

async function delayWithAbort(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0 || signal?.aborted) return
  await new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const abort = (): void => done()
    const done = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
      resolve()
    }
    timer = setTimeout(done, delayMs)
    signal?.addEventListener("abort", abort, { once: true })
  })
}
