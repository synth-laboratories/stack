import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { stackdBaseUrl, stackdLogsQuery } from "../client/stackd.js"
import type { StackConfig } from "../config.js"
import type { StackThreadMetaEvent } from "../thread-events.js"

export type StackLogQuery = {
  slot?: string
  query?: string
  eventDomain?: string
  service?: string
  runId?: string
  threadId?: string
  minutes?: number
  limit?: number
  timeoutSeconds?: number
}

export type StackLogQueryResult = {
  slot_id: string
  query: string
  records: Record<string, unknown>[]
  truncated: boolean
  victorialogs_url?: string
  retention_notice?: string
}

const DEFAULT_SLOT = "slot1"
const DEFAULT_QUERY_MINUTES = 60
const DEFAULT_QUERY_LIMIT = 100
const MCP_QUERY_LIMIT_MAX = 500
const DEFAULT_TIMEOUT_SECONDS = 20
const DEFAULT_WRITE_TIMEOUT_MS = 750

export async function queryStackLogs(_config: StackConfig, input: StackLogQuery): Promise<StackLogQueryResult> {
  const slot = normalizeSlot(input.slot)
  const limit = clampInteger(input.limit, DEFAULT_QUERY_LIMIT, 1, MCP_QUERY_LIMIT_MAX)
  const minutes = clampInteger(input.minutes, DEFAULT_QUERY_MINUTES, 1, 7 * 24 * 60)
  const timeoutSeconds = clampInteger(input.timeoutSeconds, DEFAULT_TIMEOUT_SECONDS, 1, 120)
  const baseUrl = process.env.STACK_API_URL?.trim() || stackdBaseUrl()
  const response = await stackdLogsQuery(
    {
      slot,
      query: input.query,
      event_domain: input.eventDomain,
      service: input.service,
      run_id: input.runId,
      thread_id: input.threadId,
      minutes,
      limit,
      timeout_seconds: timeoutSeconds,
    },
    baseUrl,
  )
  if (!response.ok) {
    throw new Error("stackd /logs/query returned ok=false")
  }
  const result = response.result
  const records = Array.isArray(result.records)
    ? result.records.filter((record): record is Record<string, unknown> => isRecord(record))
    : []
  const query = result.query ?? buildLogQuery(input)
  return {
    slot_id: result.slot_id ?? slot,
    query,
    records,
    truncated: records.length >= limit,
    ...(result.victorialogs_url ? { victorialogs_url: result.victorialogs_url } : {}),
    retention_notice: "local slot VictoriaLogs default retention is 7 days; Stack MCP caps results at 500",
  }
}

export function projectMetaEventToVictoriaLogs(stackRoot: string, event: StackThreadMetaEvent): void {
  if (process.env.STACK_VL_META_PROJECT === "0") return
  const writeUrl = victorialogsWriteUrl(stackRoot)
  if (!writeUrl) return
  const document = metaEventDocument(stackRoot, event)
  projectLogDocumentToVictoriaLogs(stackRoot, document)
}

export function projectLogDocumentToVictoriaLogs(stackRoot: string, document: Record<string, unknown>): void {
  const writeUrl = victorialogsWriteUrl(stackRoot)
  if (!writeUrl) return
  if (typeof document.event_domain !== "string" || !document.event_domain.trim()) return
  const url = insertUrl(writeUrl)
  const headers: Record<string, string> = { "content-type": "application/stream+json" }
  const token = process.env.VICTORIA_LOGS_WRITE_BEARER_TOKEN ?? process.env.STACK_VICTORIA_LOGS_WRITE_BEARER_TOKEN
  if (token) headers.authorization = `Bearer ${token}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEFAULT_WRITE_TIMEOUT_MS)
  void fetch(url, {
    method: "POST",
    headers,
    body: `${JSON.stringify(document)}\n`,
    signal: controller.signal,
  })
    .catch(() => undefined)
    .finally(() => clearTimeout(timeout))
}

function buildLogQuery(input: StackLogQuery): string {
  const clauses: string[] = []
  if (input.query?.trim()) clauses.push(input.query.trim())
  if (input.eventDomain?.trim()) clauses.push(`event_domain:${logFieldValue(input.eventDomain)}`)
  if (input.service?.trim()) clauses.push(`service:${logFieldValue(input.service)}`)
  if (input.runId?.trim()) clauses.push(`run_id:${logFieldValue(input.runId)}`)
  if (input.threadId?.trim()) clauses.push(`thread_id:${logFieldValue(input.threadId)}`)
  return clauses.join(" AND ") || "*"
}

function metaEventDocument(stackRoot: string, event: StackThreadMetaEvent): Record<string, unknown> {
  const payload = isRecord(event.payload) ? event.payload : {}
  const eventType = event.type
  return {
    _time: event.observed_at,
    _msg: metaEventMessage(eventType, payload),
    level: eventType.includes("failed") || eventType.endsWith(".error") ? "error" : "info",
    logger: "stackd.meta",
    slot: normalizeSlot(process.env.STACK_VL_SLOT),
    service: "stackd",
    event_domain: "meta_harness",
    event_type: eventType,
    event_id: event.event_id,
    thread_id: event.thread_id,
    stack_session_id: event.thread_id,
    actor_id: event.actor_id ?? null,
    actor_role: event.actor_role ?? "unknown",
    stack_root: stackRoot,
    ...flattenSelectedPayload(payload),
  }
}

function flattenSelectedPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const keys = [
    "skill_id",
    "skill_name",
    "guidance_id",
    "query",
    "origin",
    "reason",
    "wake_reason",
    "severity",
    "friction_id",
    "run_id",
    "job_id",
    "project_id",
    "phase",
  ]
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") out[key] = value
  }
  return out
}

function metaEventMessage(eventType: string, payload: Record<string, unknown>): string {
  const subject =
    readPayloadString(payload, "skill_id") ??
    readPayloadString(payload, "guidance_id") ??
    readPayloadString(payload, "run_id") ??
    readPayloadString(payload, "wake_reason")
  return subject ? `${eventType} ${subject}` : eventType
}

function victorialogsWriteUrl(stackRoot: string): string | undefined {
  const explicit = process.env.VICTORIA_LOGS_WRITE_URL ?? process.env.STACK_VICTORIA_LOGS_WRITE_URL
  if (explicit?.trim()) return explicit.trim()
  const port = readSlotVictoriaLogsPort(stackRoot, normalizeSlot(process.env.STACK_VL_SLOT))
  return port ? `http://127.0.0.1:${port}` : undefined
}

function readSlotVictoriaLogsPort(stackRoot: string, slot: string): number | undefined {
  const slotPath = join(stackRoot, "..", "synth-dev", "config", "slots", `${slot}.toml`)
  if (!existsSync(slotPath)) return undefined
  const match = readFileSync(slotPath, "utf8").match(/^\s*victorialogs\s*=\s*(\d+)\s*$/m)
  if (!match?.[1]) return undefined
  const port = Number.parseInt(match[1], 10)
  return Number.isFinite(port) ? port : undefined
}

function insertUrl(writeUrl: string): string {
  const base = writeUrl.replace(/\/+$/, "")
  if (base.includes("/insert/")) {
    if (/[?&]_stream_fields=/.test(base)) return base
    return `${base}${base.includes("?") ? "&" : "?"}_stream_fields=slot,service,event_domain`
  }
  return `${base}/insert/jsonline?_stream_fields=slot,service,event_domain`
}

function normalizeSlot(value: string | undefined): string {
  const slot = value?.trim() || process.env.STACK_VL_SLOT?.trim() || DEFAULT_SLOT
  return /^[A-Za-z0-9_.-]+$/.test(slot) ? slot : DEFAULT_SLOT
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

function logFieldValue(value: string | undefined): string {
  const normalized = (value ?? "").trim()
  if (/^[A-Za-z0-9_.:-]+$/.test(normalized)) return normalized
  return `"${normalized.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

function readPayloadString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
