import { randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { Database } from "bun:sqlite"

export type StackGuidanceEventType =
  | "guidance.doc_added"
  | "guidance.doc_updated"
  | "guidance.doc_deleted"
  | "guidance.used"
  | "guidance.impact_judged"
  | "guidance.query"

export type StackGuidanceImpact = "helped" | "hurt" | "neutral" | "unknown"

export type StackGuidanceEvent = {
  eventId: string
  eventType: StackGuidanceEventType
  guidanceId?: string
  actorId?: string
  actorRole?: "primary" | "monitor" | "system" | "unknown"
  threadId?: string
  impact?: StackGuidanceImpact
  confidence?: "low" | "medium" | "high"
  reason?: string
  evidenceEventIds: string[]
  payload: Record<string, unknown>
  createdAt: string
}

type GuidanceEventRow = {
  event_id: string
  event_type: StackGuidanceEventType
  guidance_id: string | null
  actor_id: string | null
  actor_role: "primary" | "monitor" | "system" | "unknown" | null
  thread_id: string | null
  impact: StackGuidanceImpact | null
  confidence: "low" | "medium" | "high" | null
  reason: string | null
  evidence_event_ids_json: string
  payload_json: string
  created_at: string
}

export function stackGuidanceEventsDbPath(stackRoot: string): string {
  return join(stackRoot, ".stack", "guidance", "events.sqlite")
}

export function recordStackGuidanceEvent(
  stackRoot: string,
  input: {
    eventType: StackGuidanceEventType
    guidanceId?: string
    actorId?: string
    actorRole?: "primary" | "monitor" | "system" | "unknown"
    threadId?: string
    impact?: StackGuidanceImpact
    confidence?: "low" | "medium" | "high"
    reason?: string
    evidenceEventIds?: string[]
    payload?: Record<string, unknown>
  },
): StackGuidanceEvent {
  const event: StackGuidanceEvent = {
    eventId: `guidance_${randomUUID()}`,
    eventType: input.eventType,
    guidanceId: input.guidanceId,
    actorId: input.actorId,
    actorRole: input.actorRole,
    threadId: input.threadId,
    impact: input.impact,
    confidence: input.confidence,
    reason: input.reason,
    evidenceEventIds: input.evidenceEventIds ?? [],
    payload: input.payload ?? {},
    createdAt: new Date().toISOString(),
  }
  withGuidanceEventsDb(stackRoot, (db) => {
    db.query(
      [
        "insert into guidance_events",
        "(event_id, event_type, guidance_id, actor_id, actor_role, thread_id, impact, confidence, reason, evidence_event_ids_json, payload_json, created_at)",
        "values ($event_id, $event_type, $guidance_id, $actor_id, $actor_role, $thread_id, $impact, $confidence, $reason, $evidence_event_ids_json, $payload_json, $created_at)",
      ].join(" "),
    ).run({
      $event_id: event.eventId,
      $event_type: event.eventType,
      $guidance_id: event.guidanceId ?? null,
      $actor_id: event.actorId ?? null,
      $actor_role: event.actorRole ?? null,
      $thread_id: event.threadId ?? null,
      $impact: event.impact ?? null,
      $confidence: event.confidence ?? null,
      $reason: event.reason ?? null,
      $evidence_event_ids_json: JSON.stringify(event.evidenceEventIds),
      $payload_json: JSON.stringify(event.payload),
      $created_at: event.createdAt,
    })
  })
  return event
}

export function listStackGuidanceEvents(
  stackRoot: string,
  options: {
    guidanceId?: string
    eventType?: StackGuidanceEventType
    threadId?: string
    limit?: number
  } = {},
): StackGuidanceEvent[] {
  return withGuidanceEventsDb(stackRoot, (db) => {
    const clauses: string[] = []
    const params: Record<string, string | number> = { $limit: options.limit ?? 50 }
    if (options.guidanceId) {
      clauses.push("guidance_id = $guidance_id")
      params.$guidance_id = options.guidanceId
    }
    if (options.eventType) {
      clauses.push("event_type = $event_type")
      params.$event_type = options.eventType
    }
    if (options.threadId) {
      clauses.push("thread_id = $thread_id")
      params.$thread_id = options.threadId
    }
    const where = clauses.length > 0 ? `where ${clauses.join(" and ")}` : ""
    const rows = db.query(
      `select * from guidance_events ${where} order by created_at desc, rowid desc limit $limit`,
    ).all(params) as GuidanceEventRow[]
    return rows.map(eventFromRow)
  })
}

export function guidanceEventToJson(event: StackGuidanceEvent): Record<string, unknown> {
  return {
    event_id: event.eventId,
    event_type: event.eventType,
    guidance_id: event.guidanceId ?? null,
    actor_id: event.actorId ?? null,
    actor_role: event.actorRole ?? null,
    thread_id: event.threadId ?? null,
    impact: event.impact ?? null,
    confidence: event.confidence ?? null,
    reason: event.reason ?? null,
    evidence_event_ids: event.evidenceEventIds,
    payload: event.payload,
    created_at: event.createdAt,
  }
}

function withGuidanceEventsDb<T>(stackRoot: string, fn: (db: Database) => T): T {
  const path = stackGuidanceEventsDbPath(stackRoot)
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  try {
    migrate(db)
    return fn(db)
  } finally {
    db.close()
  }
}

function migrate(db: Database): void {
  db.run("pragma journal_mode = wal")
  db.run("pragma foreign_keys = on")
  db.run(
    [
      "create table if not exists guidance_events (",
      "event_id text primary key,",
      "event_type text not null,",
      "guidance_id text,",
      "actor_id text,",
      "actor_role text,",
      "thread_id text,",
      "impact text,",
      "confidence text,",
      "reason text,",
      "evidence_event_ids_json text not null default '[]',",
      "payload_json text not null default '{}',",
      "created_at text not null",
      ")",
    ].join(" "),
  )
  db.run("create index if not exists idx_guidance_events_guidance_id on guidance_events(guidance_id)")
  db.run("create index if not exists idx_guidance_events_event_type on guidance_events(event_type)")
  db.run("create index if not exists idx_guidance_events_thread_id on guidance_events(thread_id)")
  db.run("create index if not exists idx_guidance_events_created_at on guidance_events(created_at)")
}

function eventFromRow(row: GuidanceEventRow): StackGuidanceEvent {
  return {
    eventId: row.event_id,
    eventType: row.event_type,
    guidanceId: row.guidance_id ?? undefined,
    actorId: row.actor_id ?? undefined,
    actorRole: row.actor_role ?? undefined,
    threadId: row.thread_id ?? undefined,
    impact: row.impact ?? undefined,
    confidence: row.confidence ?? undefined,
    reason: row.reason ?? undefined,
    evidenceEventIds: parseStringArray(row.evidence_event_ids_json),
    payload: parsePayload(row.payload_json),
    createdAt: row.created_at,
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) return parsed
  } catch {
    // Fall through to a safe empty list for corrupt local telemetry rows.
  }
  return []
}

function parsePayload(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    // Fall through to an empty payload for corrupt local telemetry rows.
  }
  return {}
}
