import type { StackConfig } from "./config.js"
import { auditEffort, readEffort, type StackEffortAudit } from "./effort.js"
import { readWorkerTraceDelta, type GardenerWorkerTraceDelta } from "./gardener-orchestrator.js"
import { readMetaThreadManifests } from "./meta-thread-goal.js"
import type { StackSessionSummary } from "./session.js"
import { readThreadMetaEvents, type StackThreadMetaEvent } from "./thread-events.js"

export type GardenerVisibilityInput = {
  config: StackConfig
  workerTargetId?: string
  workerSummaries?: readonly StackSessionSummary[]
}

export async function buildGardenerVisibilityPromptSections(input: GardenerVisibilityInput): Promise<string[]> {
  const sections: string[] = []
  const targetId = input.workerTargetId?.trim()
  const summaries = input.workerSummaries ?? []

  if (targetId) {
    const trace = await readWorkerTraceDelta(input.config, targetId, summaries, 3)
    const traceLines = formatWorkerTraceLines(trace, targetId)
    if (traceLines.length > 0) {
      sections.push("Target worker trace:", ...traceLines)
    }

    const monitorLines = recentMonitorEventLines(input.config.stackDataRoot, targetId, 6)
    if (monitorLines.length > 0) {
      sections.push("Recent monitor events (target worker):", ...monitorLines)
    }

    const effortLines = await passiveEffortAuditLines(input.config, targetId)
    if (effortLines.length > 0) {
      sections.push("Effort audit snapshot (target worker):", ...effortLines)
    }
  }

  return sections
}

export function formatWorkerTraceLines(
  trace: GardenerWorkerTraceDelta | undefined,
  threadId: string,
): string[] {
  if (!trace) {
    return [`- ${threadId.slice(0, 8)} · no session trace available`]
  }
  const exitLabel = trace.lastExitCode === undefined ? "n/a" : String(trace.lastExitCode)
  const lines = [`- ${trace.threadId.slice(0, 8)} · ${trace.turnCount} turns · last exit ${exitLabel}`]
  for (const prompt of trace.recentPrompts.slice(-3)) {
    lines.push(`  · prompt: ${truncateOneLine(prompt, 96)}`)
  }
  return lines
}

export function recentMonitorEventLines(stackRoot: string, threadId: string, limit = 6): string[] {
  const events = readThreadMetaEvents(stackRoot, threadId)
    .filter((event) => event.type.startsWith("monitor."))
    .slice(-limit)
  return events.map(formatMonitorEventLine)
}

export function formatMonitorEventLine(event: StackThreadMetaEvent): string {
  const payload = event.payload
  const time = event.observed_at.slice(0, 19).replace("T", " ")
  if (event.type === "monitor.goal_status") {
    const status = readPayloadString(payload, "status") ?? "working"
    const headline = readPayloadString(payload, "headline")
    const note = readPayloadString(payload, "note")
    const label = headline || note || "monitor update"
    const human = payload.for_human === true ? " · human" : ""
    return `- ${time} · ${status}: ${truncateOneLine(label, 88)}${human}`
  }
  if (event.type === "monitor.resumed" || event.type === "monitor.paused" || event.type === "monitor.mode_changed") {
    const strictness = readPayloadString(payload, "strictness") ?? readPayloadString(payload, "enabled")
    return `- ${time} · ${event.type.replace("monitor.", "")}${strictness ? ` · ${strictness}` : ""}`
  }
  const summary = readPayloadString(payload, "headline")
    ?? readPayloadString(payload, "note")
    ?? readPayloadString(payload, "reason")
    ?? event.type.replace("monitor.", "")
  return `- ${time} · ${truncateOneLine(summary, 96)}`
}

export function compactEffortAuditLines(audit: StackEffortAudit, maxChecks = 6): string[] {
  const findingTotal = Object.values(audit.counts.findings).reduce((sum, count) => sum + count, 0)
  const lines = [
    `- ${audit.slug} · audit ${audit.status} · activity ${audit.counts.activity_receipts} · findings ${findingTotal} · blockers ${audit.counts.blockers}`,
  ]
  const notable = audit.checks.filter((check) => check.status !== "pass").slice(0, maxChecks)
  for (const check of notable) {
    lines.push(`  · ${check.status} ${check.id}: ${truncateOneLine(check.summary, 88)}`)
  }
  if (audit.latest_blocker) {
    lines.push(`  · open blocker: ${truncateOneLine(audit.latest_blocker.blocker, 88)}`)
  }
  return lines
}

export async function passiveEffortAuditLines(config: StackConfig, threadId: string): Promise<string[]> {
  const manifests = await readMetaThreadManifests(config.stackDataRoot, "live")
  const manifest = manifests.find((entry) => entry.head_thread_id === threadId)
  const effortRef = manifest?.effort_ref?.trim()
  if (!effortRef) return []
  const effort = readEffort({
    stackDataRoot: config.stackDataRoot,
    workspaceRoot: config.workspaceRoot,
  }, effortRef)
  if (!effort) return [`- effort ${effortRef} not found locally`]
  return compactEffortAuditLines(auditEffort(effort))
}

export function filterThreadEvents(
  events: readonly StackThreadMetaEvent[],
  options?: {
    types?: readonly string[]
    limit?: number
    forHumanOnly?: boolean
  },
): StackThreadMetaEvent[] {
  const limit = Math.max(1, Math.min(options?.limit ?? 20, 100))
  const typeFilters = (options?.types ?? []).map((value) => value.trim()).filter(Boolean)
  let filtered = [...events]
  if (typeFilters.length > 0) {
    filtered = filtered.filter((event) =>
      typeFilters.some((filter) =>
        filter.endsWith(".*") || filter.endsWith(".")
          ? event.type.startsWith(filter.replace(/\.\*?$/, "."))
          : event.type === filter || event.type.startsWith(`${filter}.`),
      ),
    )
  }
  if (options?.forHumanOnly) {
    filtered = filtered.filter(
      (event) => event.type !== "monitor.goal_status" || event.payload.for_human === true,
    )
  }
  return filtered.slice(-limit)
}

export function threadEventsToJson(events: readonly StackThreadMetaEvent[]): Array<Record<string, unknown>> {
  return events.map((event) => ({
    event_id: event.event_id,
    type: event.type,
    thread_id: event.thread_id,
    observed_at: event.observed_at,
    actor_role: event.actor_role ?? null,
    meta_thread_id: event.meta_thread_id ?? null,
    payload: event.payload,
  }))
}

function readPayloadString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function truncateOneLine(value: string, maxLength: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim()
  if (trimmed.length <= maxLength) return trimmed
  if (maxLength <= 3) return trimmed.slice(0, maxLength)
  return `${trimmed.slice(0, maxLength - 1)}…`
}
