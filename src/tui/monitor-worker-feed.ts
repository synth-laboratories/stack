import type { StackThreadMetaEvent } from "../thread-events.js"

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

export function formatMonitorSteerFeedText(payload: Record<string, unknown>): string {
  const message = readString(payload.message)
  const source = readString(payload.source)
  const focus = readString(payload.focus) ?? "worker"
  const ruleId = readString(payload.rule_id)
  const guidanceId = readString(payload.guidance_id)
  const severity = readString(payload.severity)

  const tags: string[] = ["monitor steer"]
  if (source === "sidecar_codex") tags.push("sidecar")
  else if (focus === "style" || ruleId) tags.push("style")
  else tags.push(focus)
  if (ruleId) tags.push(ruleId)
  else if (guidanceId) tags.push(guidanceId)
  if (severity && severity !== "none") tags.push(severity)

  const header = tags.join(" · ")
  const body = message ?? readString(payload.guidance_excerpt) ?? readString(payload.reason) ?? ""
  return body ? `${header}\n${body}` : header
}

export function formatMonitorQueuedFeedText(payload: Record<string, unknown>): string {
  const summary = readString(payload.summary) ?? readString(payload.message) ?? readString(payload.reason) ?? "item"
  const focus = readString(payload.focus)
  const severity = readString(payload.severity)
  const tags = ["monitor queued", focus, severity].filter(Boolean)
  const header = tags.join(" · ")
  const evidence = readString(payload.evidence)
  return evidence ? `${header}\n${summary}\n${evidence}` : `${header}\n${summary}`
}

export function undeliveredMonitorInterventions(
  events: StackThreadMetaEvent[],
  deliveredEventIds: ReadonlySet<string>,
): { steers: StackThreadMetaEvent[]; queued: StackThreadMetaEvent[] } {
  const steers: StackThreadMetaEvent[] = []
  const queued: StackThreadMetaEvent[] = []
  for (const event of events) {
    if (deliveredEventIds.has(event.event_id)) continue
    if (event.type === "monitor.steer") steers.push(event)
    else if (event.type === "monitor.queued") queued.push(event)
  }
  return { steers, queued }
}

export function existingMonitorInterventionEventIds(events: StackThreadMetaEvent[]): Set<string> {
  const ids = new Set<string>()
  for (const event of events) {
    if (event.type === "monitor.steer" || event.type === "monitor.queued") ids.add(event.event_id)
  }
  return ids
}
