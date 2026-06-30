import { StyledText, dim, fg, type TextChunk } from "@opentui/core"
import type { StackMonitorSnapshot } from "../monitor.js"
import type { StackThreadMetaEvent } from "../thread-events.js"
import { stackTuiTheme as theme } from "./theme.js"

const NARRATIVE_EVENT_TYPES = new Set([
  "monitor.operator_message",
  "monitor.wake",
  "monitor.summary",
  "monitor.queued",
  "monitor.steer",
  "monitor.skill_context_push",
  "monitor.error",
])

const WATCH_EVENT_TYPES = new Set([
  "agent.tool.started",
  "agent.tool.completed",
  "agent.tool.failed",
  "agent.message.delta",
  "agent.turn.started",
  "agent.turn.completed",
  "agent.error",
])

export function monitorThreadEvents(events: StackThreadMetaEvent[]): StackThreadMetaEvent[] {
  return events.filter(
    (event) =>
      event.actor_role === "monitor" ||
      event.type.startsWith("monitor.") ||
      event.type === "thread.named" ||
      WATCH_EVENT_TYPES.has(event.type),
  )
}

export function monitorNarrativeLineCount(
  events: StackThreadMetaEvent[],
  snapshot: StackMonitorSnapshot,
  columns: number,
): number {
  return monitorNarrativeLines(events, snapshot, columns).length
}

export function monitorEventStreamLineCount(events: StackThreadMetaEvent[], columns: number): number {
  return monitorEventStreamLines(events, columns).length
}

export function monitorNarrativeLines(
  events: StackThreadMetaEvent[],
  snapshot: StackMonitorSnapshot,
  columns: number,
): string[] {
  const width = Math.max(16, columns - 2)
  const lines: string[] = []
  const threadEvents = monitorThreadEvents(events).filter((event) => NARRATIVE_EVENT_TYPES.has(event.type))
  if (threadEvents.length === 0) {
    lines.push(snapshot.enabled ? "(no messages yet)" : "(off)")
    if (snapshot.lastSummary) lines.push(oneLine(`monitor  ${snapshot.lastSummary}`, width))
    return lines
  }

  for (const event of threadEvents) {
    for (const line of formatNarrativeEvent(event, width, events)) {
      lines.push(line)
    }
  }
  return lines
}

export function monitorEventStreamLines(events: StackThreadMetaEvent[], columns: number): string[] {
  const width = Math.max(14, columns - 2)
  const threadEvents = monitorThreadEvents(events)
  if (threadEvents.length === 0) return ["(no events yet)"]
  return threadEvents.map((event) => formatEventStreamLine(event, width, events))
}

export function renderMonitorNarrativeStyled(
  events: StackThreadMetaEvent[],
  snapshot: StackMonitorSnapshot,
  columns: number,
  visibleRows: number,
  scrollOffset = 0,
): StyledText {
  return renderMonitorLinesStyled(
    monitorNarrativeLines(events, snapshot, columns),
    visibleRows,
    scrollOffset,
    styledNarrativeLine,
  )
}

export function renderMonitorEventStreamStyled(
  events: StackThreadMetaEvent[],
  columns: number,
  visibleRows: number,
  scrollOffset = 0,
): StyledText {
  return renderMonitorLinesStyled(
    monitorEventStreamLines(events, columns),
    visibleRows,
    scrollOffset,
    styledEventStreamLine,
  )
}

export function monitorLiveStatusLine(
  snapshot: StackMonitorSnapshot,
  workerRunning: boolean,
  spinnerFrame: number,
  columns: number,
): string | undefined {
  const width = Math.max(16, columns - 2)
  if (snapshot.status === "running") {
    return oneLine(`◆ Monitor ▸ ${spinner(spinnerFrame)} reviewing…`, width)
  }
  if (workerRunning) {
    return oneLine(`◆ Worker ▸ ${spinner(spinnerFrame)} running…`, width)
  }
  return undefined
}

export function renderMonitorLiveStatusStyled(
  snapshot: StackMonitorSnapshot,
  workerRunning: boolean,
  spinnerFrame: number,
  columns: number,
): StyledText | undefined {
  const line = monitorLiveStatusLine(snapshot, workerRunning, spinnerFrame, columns)
  if (!line) return undefined
  return new StyledText([dim(fg(theme.transcript.planningLabel)(line))])
}

function renderMonitorLinesStyled(
  lines: string[],
  visibleRows: number,
  scrollOffset: number,
  styleLine: (line: string) => TextChunk[],
): StyledText {
  const window = scrollWindow(lines, scrollOffset, visibleRows)
  const chunks: TextChunk[] = []
  for (const [index, line] of window.entries()) {
    if (index > 0) chunks.push(fg(theme.fgPrimary)("\n"))
    chunks.push(...styleLine(line))
  }
  if (lines.length > window.length && scrollOffset > 0) {
    chunks.unshift(dim(`↑ ${scrollOffset + window.length}/${lines.length}\n`))
  } else if (lines.length > window.length) {
    chunks.unshift(dim(`↓ ${window.length}/${lines.length}\n`))
  }
  return new StyledText(chunks)
}

function formatNarrativeEvent(
  event: StackThreadMetaEvent,
  width: number,
  allEvents: StackThreadMetaEvent[] = [],
): string[] {
  const payload = event.payload
  switch (event.type) {
    case "monitor.operator_message":
      return [oneLine(`› you  ${readString(payload.message) ?? "(empty)"}`, width)]
    case "monitor.wake": {
      const reason = readString(payload.wake_reason) ?? "trigger"
      if (reason === "operator_message") return []
      return [oneLine(`› runtime  ${monitorRuntimeWakeMessage(event, allEvents)}`, width)]
    }
    case "monitor.summary": {
      const summary = readString(payload.summary) ?? "(empty summary)"
      const severity = readString(payload.severity) ?? "none"
      const lines = [oneLine(`  monitor  ${severity} · ${summary}`, width)]
      const operatorUpdate = asRecord(payload.operator_update)
      const workingOn = readString(operatorUpdate?.working_on)
      const struggling = readString(operatorUpdate?.struggling_with)
      const progress = readString(operatorUpdate?.progress_note)
      if (workingOn && !summary.includes(workingOn)) {
        lines.push(oneLine(`           goal · ${workingOn}`, width))
      }
      if (progress && !summary.includes(progress)) {
        lines.push(oneLine(`           progress · ${progress}`, width))
      }
      if (struggling) {
        lines.push(oneLine(`           stuck · ${struggling}`, width))
      }
      return lines
    }
    case "monitor.queued":
      return [
        oneLine(
          `  queue  ${readString(payload.summary) ?? readString(payload.message) ?? readString(payload.reason) ?? "item"}`,
          width,
        ),
      ]
    case "monitor.steer":
      return [
        oneLine(
          `  steer  ${readString(payload.rule_id) ?? "rule"} · ${readString(payload.guidance_id) ?? "guide"}`,
          width,
        ),
        ...(readString(payload.message) ? [oneLine(`         ${readString(payload.message)!}`, width)] : []),
      ]
    case "monitor.skill_context_push":
      return [
        oneLine(`  push  ${readString(payload.skill_id) ?? "skill"} · ${readString(payload.reason) ?? "context"}`, width),
      ]
    case "monitor.error":
      return [oneLine(`  error  ${readString(payload.message) ?? "monitor failed"}`, width)]
    default:
      return []
  }
}

function monitorRuntimeWakeMessage(wake: StackThreadMetaEvent, allEvents: StackThreadMetaEvent[]): string {
  const payload = wake.payload
  const reason = readString(payload.wake_reason) ?? "trigger"
  const pendingCount =
    typeof payload.pending_event_count === "number" && payload.pending_event_count > 0
      ? payload.pending_event_count
      : undefined
  const triggerIds = Array.isArray(payload.trigger_event_ids)
    ? payload.trigger_event_ids.filter((id): id is string => typeof id === "string")
    : []
  const triggers = triggerIds
    .map((id) => allEvents.find((entry) => entry.event_id === id))
    .filter((entry): entry is StackThreadMetaEvent => Boolean(entry))
  const triggerDetail = formatRuntimeTriggerDetail(triggers[0])

  switch (reason) {
    case "turn_completed":
      return triggerDetail ? `process worker turn · ${triggerDetail}` : "process worker turn completed"
    case "tool_completed":
      return triggerDetail ? `process tool completed · ${triggerDetail}` : "process tool completed"
    case "tool_failed":
      return triggerDetail ? `process tool failed · ${triggerDetail}` : "process tool failed"
    case "error":
      return triggerDetail ? `process worker error · ${triggerDetail}` : "process worker error"
    case "delta_events":
      if (pendingCount !== undefined) {
        return `process ${pendingCount} worker event${pendingCount === 1 ? "" : "s"}`
      }
      return triggerDetail ? `process worker delta · ${triggerDetail}` : "process worker event delta"
    default:
      return triggerDetail ? `${reason.replace(/_/g, " ")} · ${triggerDetail}` : reason.replace(/_/g, " ")
  }
}

function formatRuntimeTriggerDetail(event: StackThreadMetaEvent | undefined): string {
  if (!event) return ""
  const payload = event.payload
  if (event.type === "agent.tool.completed" || event.type === "agent.tool.failed" || event.type === "agent.tool.started") {
    const command = readString(payload.command)
    const toolName = readString(payload.tool_name)
    if (command) return command
    if (toolName) return toolName
  }
  if (event.type === "agent.turn.completed") return "turn completed"
  if (event.type === "agent.error") return readString(payload.message) ?? "agent error"
  return event.type.replace(/^agent\./, "").replace(/_/g, " ")
}

function formatEventStreamLine(
  event: StackThreadMetaEvent,
  width: number,
  allEvents: StackThreadMetaEvent[] = [],
): string {
  const time = shortTime(event.observed_at)
  const payload = event.payload
  if (event.type.startsWith("agent.")) {
    return oneLine(`${time} ${formatAgentWatchLine(event.type, payload)}`, width)
  }
  if (event.type === "monitor.wake") {
    const reason = readString(payload.wake_reason) ?? "trigger"
    if (reason !== "operator_message") {
      return oneLine(`${time} runtime · ${monitorRuntimeWakeMessage(event, allEvents)}`, width)
    }
  }
  const label = event.type.replace(/^monitor\./, "")
  if (event.type === "monitor.summary") {
    const operatorUpdate = asRecord(payload.operator_update)
    const progress = readString(operatorUpdate?.progress_note)
    const struggling = readString(operatorUpdate?.struggling_with)
    const detail =
      progress ??
      struggling ??
      readString(payload.summary) ??
      readString(payload.severity) ??
      ""
    return oneLine(`${time} mon ${label}${detail ? ` · ${detail}` : ""}`, width)
  }
  const detail =
    readString(payload.wake_reason) ??
    readString(payload.summary) ??
    readString(payload.message) ??
    readString(payload.reason) ??
    readString(payload.skill_id) ??
    readString(payload.rule_id) ??
    readString(payload.severity) ??
    ""
  return oneLine(`${time} ${label}${detail ? ` · ${detail}` : ""}`, width)
}

function formatAgentWatchLine(type: string, payload: Record<string, unknown>): string {
  const toolName = readString(payload.tool_name) ?? "tool"
  const command = readString(payload.command)
  switch (type) {
    case "agent.tool.started":
      return `⎿ ${toolName}${command ? ` · ${command}` : readString(payload.arguments) ? ` · ${readString(payload.arguments)}` : ""}`
    case "agent.tool.completed": {
      const exitCode = payload.exit_code
      const failed = typeof exitCode === "number" && exitCode !== 0
      const detail = command ?? readString(payload.output) ?? readString(payload.stdout) ?? ""
      return `⎿ ${toolName}${failed ? " ✗" : " ✓"}${detail ? ` · ${detail}` : ""}`
    }
    case "agent.tool.failed":
      return `⎿ ${toolName} ✗ ${readString(payload.message) ?? readString(payload.stderr) ?? readString(payload.output) ?? "failed"}`
    case "agent.message.delta": {
      const channel = readString(payload.channel) ?? "message"
      const text = readString(payload.text) ?? ""
      if (channel === "reasoning") return `◆ Thought · ${text}`
      return `◆ ${channel} · ${text}`
    }
    case "agent.turn.started":
      return "◆ Turn started"
    case "agent.turn.completed":
      return "◆ Turn completed"
    case "agent.error":
      return `✗ ${readString(payload.message) ?? "agent error"}`
    default:
      return type.replace(/^agent\./, "")
  }
}

function styledNarrativeLine(line: string): TextChunk[] {
  if (line.startsWith("› you")) return [fg(theme.synth.gold)(line)]
  if (line.startsWith("› runtime")) return [fg(theme.synth.amber)(line)]
  if (line.startsWith("  monitor")) return [fg("#3fb950")(line)]
  if (line.startsWith("  steer")) return [fg("#3fb950")(line)]
  if (line.startsWith("  queue")) return [fg(theme.synth.amber)(line)]
  if (line.startsWith("  push")) return [fg(theme.synth.gold)(line)]
  if (line.startsWith("  error")) return [fg(theme.synth.red)(line)]
  if (line.startsWith("(no messages") || line.startsWith("(off)")) return [dim(fg(theme.fgMuted)(line))]
  return [fg(theme.fgPrimary)(line)]
}

function styledEventStreamLine(line: string): TextChunk[] {
  if (line.startsWith("(no events")) return [dim(fg(theme.fgMuted)(line))]
  if (line.startsWith("◆ Thought") || line.includes(" Turn ")) return [dim(fg(theme.transcript.planningLabel)(line))]
  if (line.includes("⎿")) {
    if (line.includes(" ✗") || line.includes(" fail")) return [dim(fg(theme.synth.red)(line))]
    return [dim(fg(theme.transcript.toolLabel)(line))]
  }
  if (line.includes(" error") || line.includes(" fail") || line.startsWith("✗")) return [fg(theme.synth.red)(line)]
  if (line.includes(" steer") || line.includes(" summary")) return [fg("#3fb950")(line)]
  if (line.includes(" runtime ·")) return [fg(theme.synth.amber)(line)]
  if (line.includes(" queue")) return [fg(theme.synth.amber)(line)]
  if (line.includes(" operator_message")) return [fg(theme.synth.gold)(line)]
  return [fg(theme.fgSecondary)(line)]
}

function scrollWindow(lines: string[], scrollOffset: number, visibleRows: number): string[] {
  if (visibleRows <= 0) return []
  const maxOffset = Math.max(0, lines.length - visibleRows)
  const offset = Math.min(Math.max(0, scrollOffset), maxOffset)
  return lines.slice(offset, offset + visibleRows)
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined
}

function shortTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "--:--"
  return date.toTimeString().slice(0, 8)
}

function oneLine(value: string, maxLength: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim()
  if (trimmed.length <= maxLength) return trimmed
  if (maxLength <= 3) return trimmed.slice(0, maxLength)
  return `${trimmed.slice(0, maxLength - 1)}…`
}

function spinner(frame: number): string {
  return ["|", "/", "-", "\\"][frame % 4] ?? "|"
}
