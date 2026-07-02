import { randomUUID } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { projectMetaEventToVictoriaLogs } from "./observability/victorialogs.js"

export type StackThreadMetaEvent = {
  event_id: string
  type: string
  thread_id: string
  observed_at: string
  actor_id?: string
  actor_role?: "primary" | "gardener" | "monitor" | "remote_gardener" | "system" | "unknown"
  meta_thread_id?: string
  segment_id?: string
  artifact_id?: string
  payload: Record<string, unknown>
}

export function threadEventLogPath(stackRoot: string, threadId: string): string {
  return join(stackRoot, ".stack", "events", "threads", `${safeThreadId(threadId)}.jsonl`)
}

export function appendThreadMetaEvent(stackRoot: string, event: StackThreadMetaEvent): string {
  const path = threadEventLogPath(stackRoot, event.thread_id)
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify(event)}\n`)
  projectMetaEventToVictoriaLogs(stackRoot, event)
  return path
}

export function appendThreadMetaEventOnce(stackRoot: string, event: StackThreadMetaEvent): StackThreadMetaEvent | undefined {
  const existing = readThreadMetaEvents(stackRoot, event.thread_id)
  if (existing.some((entry) => entry.event_id === event.event_id)) return undefined
  appendThreadMetaEvent(stackRoot, event)
  return event
}

export function readThreadMetaEvents(stackRoot: string, threadId: string): StackThreadMetaEvent[] {
  const path = threadEventLogPath(stackRoot, threadId)
  if (!existsSync(path)) return []
  const events: StackThreadMetaEvent[] = []
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as StackThreadMetaEvent
      if (parsed && typeof parsed === "object" && parsed.thread_id === threadId) events.push(parsed)
    } catch {
      // Ignore malformed meta events; append-only logs should not break the TUI.
    }
  }
  return events
}

export function stackEventId(prefix: string): string {
  return `${prefix}_${randomUUID()}`
}

function safeThreadId(threadId: string): string {
  const safe = threadId.trim().replace(/[^A-Za-z0-9_.-]/g, "_")
  if (!safe || safe === "." || safe === "..") throw new Error(`invalid thread id: ${threadId}`)
  return safe
}
