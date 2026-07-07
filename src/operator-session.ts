import { randomUUID } from "node:crypto"
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { appendFile } from "node:fs/promises"
import { join } from "node:path"
import { stackVersion } from "./version.js"

export const OPERATOR_SESSION_SCHEMA_VERSION = "stack.operator_session.v1" as const

export type OperatorSessionStatus = "open" | "closed" | "interrupted"

export type OperatorSessionUploadStatus = "disabled" | "pending" | "uploaded" | "failed"

export type OperatorSessionRecord = {
  schema_version: typeof OPERATOR_SESSION_SCHEMA_VERSION
  operator_session_id: string
  workspace_root: string
  stack_data_root: string
  started_at: string
  ended_at: string | null
  status: OperatorSessionStatus
  stack_version: string
  pid: number
  active_thread_id?: string
  tagged_effort_slug?: string
  effort_session_id?: string
  capture_count: number
  upload_status: OperatorSessionUploadStatus
}

export type OperatorSessionCurrentPointer = {
  operator_session_id: string
  path: string
  pid: number
  started_at: string
  workspace_root: string
}

export type OperatorSessionEvent = {
  event_id: string
  type: string
  operator_session_id: string
  observed_at: string
  thread_id?: string
  meta_thread_id?: string
  effort_ref?: string
  effort_session_id?: string
  payload: Record<string, unknown>
}

export type OperatorSessionSummary = {
  operator_session_id: string
  path: string
  started_at: string
  ended_at: string | null
  status: OperatorSessionStatus
  duration_ms: number | null
  tagged_effort_slug?: string
  effort_session_id?: string
  capture_count: number
  upload_status: OperatorSessionUploadStatus
}

export type OperatorSessionCounts = {
  local: number
  cloud: number
  open: number
}

export type StartOperatorSessionInput = {
  stackDataRoot: string
  workspaceRoot: string
  pid?: number
  activeThreadId?: string
  taggedEffortSlug?: string | null
  effortSessionId?: string
}

export type CloseOperatorSessionInput = {
  stackDataRoot: string
  operatorSessionId?: string
  status?: Extract<OperatorSessionStatus, "closed" | "interrupted">
  activeThreadId?: string
  captureCount?: number
  uploadStatus?: OperatorSessionUploadStatus
}

export function operatorSessionsRoot(stackDataRoot: string): string {
  return join(stackDataRoot, ".stack", "operator-sessions")
}

export function operatorSessionDir(stackDataRoot: string, operatorSessionId: string): string {
  return join(operatorSessionsRoot(stackDataRoot), operatorSessionId)
}

export function operatorSessionManifestPath(stackDataRoot: string, operatorSessionId: string): string {
  return join(operatorSessionDir(stackDataRoot, operatorSessionId), "SESSION.json")
}

export function operatorSessionEventsPath(stackDataRoot: string, operatorSessionId: string): string {
  return join(operatorSessionDir(stackDataRoot, operatorSessionId), "events.jsonl")
}

export function operatorSessionCapturesDir(stackDataRoot: string, operatorSessionId: string): string {
  return join(operatorSessionDir(stackDataRoot, operatorSessionId), "captures")
}

export function operatorSessionCurrentPointerPath(stackDataRoot: string): string {
  return join(operatorSessionsRoot(stackDataRoot), "CURRENT.json")
}

export function newOperatorSessionId(): string {
  return `opesess_${randomUUID()}`
}

export function newOperatorSessionEventId(): string {
  return `opesvt_${randomUUID()}`
}

export function startOperatorSession(input: StartOperatorSessionInput): OperatorSessionRecord {
  const operatorSessionId = newOperatorSessionId()
  const startedAt = new Date().toISOString()
  const sessionDir = operatorSessionDir(input.stackDataRoot, operatorSessionId)
  mkdirSync(sessionDir, { recursive: true })
  mkdirSync(operatorSessionCapturesDir(input.stackDataRoot, operatorSessionId), { recursive: true })

  const record: OperatorSessionRecord = {
    schema_version: OPERATOR_SESSION_SCHEMA_VERSION,
    operator_session_id: operatorSessionId,
    workspace_root: input.workspaceRoot,
    stack_data_root: input.stackDataRoot,
    started_at: startedAt,
    ended_at: null,
    status: "open",
    stack_version: stackVersion(),
    pid: input.pid ?? process.pid,
    ...(input.activeThreadId ? { active_thread_id: input.activeThreadId } : {}),
    ...(normalizeOptionalString(input.taggedEffortSlug)
      ? { tagged_effort_slug: normalizeOptionalString(input.taggedEffortSlug) }
      : {}),
    ...(input.effortSessionId ? { effort_session_id: input.effortSessionId } : {}),
    capture_count: 0,
    upload_status: "disabled",
  }

  writeOperatorSessionManifest(input.stackDataRoot, record)
  writeOperatorSessionCurrentPointer(input.stackDataRoot, {
    operator_session_id: operatorSessionId,
    path: relativeStackPath(input.stackDataRoot, sessionDir),
    pid: record.pid,
    started_at: startedAt,
    workspace_root: input.workspaceRoot,
  })
  appendOperatorSessionEventSync(input.stackDataRoot, {
    event_id: newOperatorSessionEventId(),
    type: "operator_session.started",
    operator_session_id: operatorSessionId,
    observed_at: startedAt,
    ...(input.activeThreadId ? { thread_id: input.activeThreadId } : {}),
    ...(record.tagged_effort_slug ? { effort_ref: record.tagged_effort_slug } : {}),
    ...(record.effort_session_id ? { effort_session_id: record.effort_session_id } : {}),
    payload: {
      workspace_root: input.workspaceRoot,
      stack_version: record.stack_version,
    },
  })

  return record
}

export function closeOperatorSession(input: CloseOperatorSessionInput): OperatorSessionRecord | undefined {
  const active = readActiveOperatorSession(input.stackDataRoot)
  const operatorSessionId = input.operatorSessionId ?? active?.operator_session_id
  if (!operatorSessionId) return undefined

  const existing = readOperatorSession(input.stackDataRoot, operatorSessionId)
  if (!existing) return undefined

  const endedAt = new Date().toISOString()
  const next: OperatorSessionRecord = {
    ...existing,
    ended_at: endedAt,
    status: input.status ?? "closed",
    ...(input.activeThreadId ? { active_thread_id: input.activeThreadId } : {}),
    ...(input.captureCount !== undefined ? { capture_count: input.captureCount } : {}),
    ...(input.uploadStatus ? { upload_status: input.uploadStatus } : {}),
  }

  writeOperatorSessionManifest(input.stackDataRoot, next)
  clearOperatorSessionCurrentPointer(input.stackDataRoot)
  appendOperatorSessionEventSync(input.stackDataRoot, {
    event_id: newOperatorSessionEventId(),
    type: "operator_session.closed",
    operator_session_id: operatorSessionId,
    observed_at: endedAt,
    ...(next.active_thread_id ? { thread_id: next.active_thread_id } : {}),
    ...(next.tagged_effort_slug ? { effort_ref: next.tagged_effort_slug } : {}),
    ...(next.effort_session_id ? { effort_session_id: next.effort_session_id } : {}),
    payload: {
      status: next.status,
      capture_count: next.capture_count,
      upload_status: next.upload_status,
    },
  })

  return next
}

export function readOperatorSession(
  stackDataRoot: string,
  operatorSessionId: string,
): OperatorSessionRecord | undefined {
  const path = operatorSessionManifestPath(stackDataRoot, operatorSessionId)
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as OperatorSessionRecord
    if (!parsed?.operator_session_id) return undefined
    return parsed
  } catch {
    return undefined
  }
}

export function readOperatorSessionCurrentPointer(
  stackDataRoot: string,
): OperatorSessionCurrentPointer | undefined {
  const path = operatorSessionCurrentPointerPath(stackDataRoot)
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as OperatorSessionCurrentPointer
    if (!parsed?.operator_session_id) return undefined
    return parsed
  } catch {
    return undefined
  }
}

export function readActiveOperatorSession(stackDataRoot: string): OperatorSessionRecord | undefined {
  const pointer = readOperatorSessionCurrentPointer(stackDataRoot)
  if (!pointer) return undefined
  if (!isProcessAlive(pointer.pid)) {
    clearOperatorSessionCurrentPointer(stackDataRoot)
    return undefined
  }
  const session = readOperatorSession(stackDataRoot, pointer.operator_session_id)
  if (!session || session.status !== "open") {
    clearOperatorSessionCurrentPointer(stackDataRoot)
    return undefined
  }
  return session
}

export function listOperatorSessions(stackDataRoot: string): OperatorSessionSummary[] {
  const root = operatorSessionsRoot(stackDataRoot)
  if (!existsSync(root)) return []

  const summaries: OperatorSessionSummary[] = []
  for (const entry of readdirSync(root)) {
    if (entry === "CURRENT.json") continue
    const session = readOperatorSession(stackDataRoot, entry)
    if (!session) continue
    summaries.push(summarizeOperatorSessionRecord(session, operatorSessionDir(stackDataRoot, entry)))
  }

  return summaries.sort((left, right) => right.started_at.localeCompare(left.started_at))
}

export function summarizeOperatorSessions(stackDataRoot: string): {
  counts: OperatorSessionCounts
  sessions: OperatorSessionSummary[]
  active?: OperatorSessionRecord
} {
  const sessions = listOperatorSessions(stackDataRoot)
  const active = readActiveOperatorSession(stackDataRoot)
  return {
    counts: operatorSessionCountsFromSummaries(sessions),
    sessions,
    ...(active ? { active } : {}),
  }
}

export function operatorSessionCounts(stackDataRoot: string): OperatorSessionCounts {
  return operatorSessionCountsFromSummaries(listOperatorSessions(stackDataRoot))
}

export async function appendOperatorSessionEvent(
  stackDataRoot: string,
  event: OperatorSessionEvent,
): Promise<string> {
  const path = operatorSessionEventsPath(stackDataRoot, event.operator_session_id)
  mkdirSync(operatorSessionDir(stackDataRoot, event.operator_session_id), { recursive: true })
  await appendFile(path, `${JSON.stringify(event)}\n`, "utf8")
  return path
}

export function appendOperatorSessionEventSync(stackDataRoot: string, event: OperatorSessionEvent): string {
  const path = operatorSessionEventsPath(stackDataRoot, event.operator_session_id)
  mkdirSync(operatorSessionDir(stackDataRoot, event.operator_session_id), { recursive: true })
  appendFileSync(path, `${JSON.stringify(event)}\n`, "utf8")
  return path
}

export function readOperatorSessionEvents(
  stackDataRoot: string,
  operatorSessionId: string,
): OperatorSessionEvent[] {
  const path = operatorSessionEventsPath(stackDataRoot, operatorSessionId)
  if (!existsSync(path)) return []

  const events: OperatorSessionEvent[] = []
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as OperatorSessionEvent
      if (parsed?.operator_session_id === operatorSessionId) events.push(parsed)
    } catch {
      // Ignore malformed lines; append-only logs should not break readers.
    }
  }
  return events
}

export function patchOperatorSessionRecord(
  stackDataRoot: string,
  operatorSessionId: string,
  patch: Partial<
    Pick<
      OperatorSessionRecord,
      "active_thread_id" | "tagged_effort_slug" | "effort_session_id" | "capture_count" | "upload_status"
    >
  >,
): OperatorSessionRecord | undefined {
  const existing = readOperatorSession(stackDataRoot, operatorSessionId)
  if (!existing || existing.status !== "open") return undefined
  const next: OperatorSessionRecord = {
    ...existing,
    ...patch,
  }
  writeOperatorSessionManifest(stackDataRoot, next)
  return next
}

function summarizeOperatorSessionRecord(
  record: OperatorSessionRecord,
  path: string,
): OperatorSessionSummary {
  const endedAt = record.ended_at
  const durationMs =
    endedAt === null ? null : Math.max(0, Date.parse(endedAt) - Date.parse(record.started_at))
  return {
    operator_session_id: record.operator_session_id,
    path,
    started_at: record.started_at,
    ended_at: record.ended_at,
    status: record.status,
    duration_ms: durationMs,
    ...(record.tagged_effort_slug ? { tagged_effort_slug: record.tagged_effort_slug } : {}),
    ...(record.effort_session_id ? { effort_session_id: record.effort_session_id } : {}),
    capture_count: record.capture_count,
    upload_status: record.upload_status,
  }
}

function operatorSessionCountsFromSummaries(sessions: OperatorSessionSummary[]): OperatorSessionCounts {
  let local = 0
  let cloud = 0
  let open = 0
  for (const session of sessions) {
    if (session.status === "open") open += 1
    if (session.status === "closed" || session.status === "interrupted") local += 1
    if (session.upload_status === "uploaded") cloud += 1
  }
  return { local, cloud, open }
}

function writeOperatorSessionManifest(stackDataRoot: string, record: OperatorSessionRecord): void {
  const path = operatorSessionManifestPath(stackDataRoot, record.operator_session_id)
  mkdirSync(operatorSessionDir(stackDataRoot, record.operator_session_id), { recursive: true })
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf8")
}

function writeOperatorSessionCurrentPointer(
  stackDataRoot: string,
  pointer: OperatorSessionCurrentPointer,
): void {
  mkdirSync(operatorSessionsRoot(stackDataRoot), { recursive: true })
  writeFileSync(operatorSessionCurrentPointerPath(stackDataRoot), `${JSON.stringify(pointer, null, 2)}\n`, "utf8")
}

function clearOperatorSessionCurrentPointer(stackDataRoot: string): void {
  const path = operatorSessionCurrentPointerPath(stackDataRoot)
  if (!existsSync(path)) return
  rmSync(path, { force: true })
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function relativeStackPath(stackDataRoot: string, absolutePath: string): string {
  if (absolutePath.startsWith(`${stackDataRoot}/`)) {
    return absolutePath.slice(stackDataRoot.length + 1)
  }
  return absolutePath
}
