import { StyledText, bold, dim, fg, type TextChunk } from "@opentui/core"
import type { StackMonitorSnapshot } from "../monitor.js"
import type { StackMonitorSidecarTurn } from "../monitor-sidecar-codex.js"
import type { StackThreadMetaEvent } from "../thread-events.js"
import { stackTuiTheme as theme } from "./theme.js"

const NARRATIVE_EVENT_TYPES = new Set([
  "monitor.operator_message",
  "monitor.chat.reply",
  "monitor.wake",
  "monitor.summary",
  "monitor.progress",
  "monitor.queued",
  "monitor.steer",
  "monitor.skill_context_push",
  "monitor.error",
])

const GOAL_SHUTTER_EVENT_TYPES = new Set([
  "monitor.chat.request",
  "monitor.chat.reply",
  "monitor.summary",
  "monitor.progress",
  "monitor.queued",
  "monitor.steer",
  "monitor.error",
  "monitor.handoff_preempt.eligible",
  "monitor.handoff_preempt.skipped",
  "meta_thread.goal_updated",
  "goal.started",
  "goal.paused",
  "goal.resumed",
  "goal.cleared",
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

const GOAL_SHUTTER_SIDECAR_CHAT_TYPES = new Set([
  "monitor.operator_message",
  "monitor.chat.request",
  "monitor.chat.reply",
])

type GoalSidecarThreadLine = {
  text: string
  kind: "ask" | "reply-label" | "reply-body" | "blank" | "empty"
}

function wrapPlain(text: string, width: number): string[] {
  const lines: string[] = []
  for (const rawLine of text.split("\n")) {
    const line = rawLine.length === 0 ? " " : rawLine
    for (let index = 0; index < line.length; index += width) {
      lines.push(line.slice(index, index + width))
    }
  }
  return lines.length > 0 ? lines : [" "]
}

export function renderGoalSidecarThreadStyled(
  input: {
    turns?: readonly StackMonitorSidecarTurn[]
    events: StackThreadMetaEvent[]
    columns: number
    visibleRows?: number
    scrollOffset?: number
  },
): StyledText {
  const visibleRows = input.visibleRows ?? 5
  const allLines = goalSidecarThreadRenderLines({
    turns: input.turns,
    events: input.events,
    columns: input.columns,
  })
  const lines = sidecarThreadScrollWindow(allLines, input.scrollOffset ?? 0, visibleRows)
  const chunks: TextChunk[] = []
  for (const [index, line] of lines.entries()) {
    if (index > 0) chunks.push(fg(theme.fgPrimary)("\n"))
    chunks.push(...styledSidecarThreadLine(line))
  }
  return new StyledText(chunks)
}

export function goalSidecarThreadLineCount(input: {
  turns?: readonly StackMonitorSidecarTurn[]
  events: StackThreadMetaEvent[]
  columns: number
}): number {
  return goalSidecarThreadRenderLines(input).length
}

function goalSidecarThreadRenderLines(input: {
  turns?: readonly StackMonitorSidecarTurn[]
  events: StackThreadMetaEvent[]
  columns: number
}): GoalSidecarThreadLine[] {
  if (input.turns?.length) return goalSidecarCodexThreadLines(input.turns, input.columns)
  return [{ text: "(waiting for sidecar Codex thread)", kind: "empty" }]
}

function goalSidecarCodexThreadLines(
  turns: readonly StackMonitorSidecarTurn[],
  columns: number,
): GoalSidecarThreadLine[] {
  const width = Math.max(16, columns - 2)
  const lines: GoalSidecarThreadLine[] = []
  for (const turn of turns) {
    if (lines.length > 0) lines.push({ text: "", kind: "blank" })
    lines.push(...wrapPlain(`› ${sidecarTurnPromptLabel(turn.prompt)}`, width).map((text) => ({
      text,
      kind: "ask" as const,
    })))
    for (const line of sidecarTurnOutputLines(turn.stdout, width)) lines.push(line)
    if (turn.stderr.trim()) {
      lines.push(...wrapPlain(`error · ${turn.stderr.trim()}`, width).map((text, index) => ({
        text,
        kind: index === 0 ? "reply-label" as const : "reply-body" as const,
      })))
    }
  }
  if (lines.length === 0) return [{ text: "(waiting for sidecar messages)", kind: "empty" }]
  return lines
}

function sidecarThreadScrollWindow(
  lines: GoalSidecarThreadLine[],
  scrollOffset: number,
  visibleRows: number,
): GoalSidecarThreadLine[] {
  if (visibleRows <= 0) return []
  const maxOffset = Math.max(0, lines.length - visibleRows)
  const offset = Math.min(Math.max(0, scrollOffset), maxOffset)
  return lines.slice(offset, offset + visibleRows)
}

function sidecarTurnOutputLines(stdout: string, width: number): GoalSidecarThreadLine[] {
  const lines: GoalSidecarThreadLine[] = []
  let latestAgentMessage: string | undefined
  let latestReasoning: string | undefined
  for (const raw of stdout.split(/\r?\n/)) {
    if (!raw.trim()) continue
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>
    } catch {
      continue
    }
    if (parsed.type === "agent_message" && typeof parsed.text === "string" && parsed.text.trim()) {
      latestAgentMessage = parsed.text.trim()
      continue
    }
    if (parsed.type === "reasoning_summary" && typeof parsed.text === "string" && parsed.text.trim()) {
      latestReasoning = parsed.text.trim()
      continue
    }
    if (parsed.type === "function_call") {
      const name = typeof parsed.name === "string" ? parsed.name : "tool"
      lines.push(...wrapPlain(`tool · ${name}`, width).map((text, index) => ({
        text,
        kind: index === 0 ? "reply-label" as const : "reply-body" as const,
      })))
    }
    if (parsed.type === "function_call_output") {
      const output = typeof parsed.output === "string" ? parsed.output : ""
      const label = output.trim() ? `tool result · ${output.trim()}` : "tool result"
      lines.push(...wrapPlain(label, width).map((text, index) => ({
        text,
        kind: index === 0 ? "reply-label" as const : "reply-body" as const,
      })))
    }
  }
  if (latestReasoning) {
    lines.push(...wrapPlain(`thinking · ${latestReasoning}`, width).map((text, index) => ({
      text,
      kind: index === 0 ? "reply-label" as const : "reply-body" as const,
    })))
  }
  if (latestAgentMessage) {
    lines.push(...wrapPlain(`sidecar · ${latestAgentMessage}`, width).map((text, index) => ({
      text,
      kind: index === 0 ? "reply-label" as const : "reply-body" as const,
    })))
  }
  return lines
}

function sidecarTurnPromptLabel(prompt: string): string {
  try {
    const parsed = JSON.parse(prompt) as Record<string, unknown>
    const operatorMessage = typeof parsed.operator_message === "string" ? parsed.operator_message.trim() : ""
    if (operatorMessage) return operatorMessage
    const wakeReason = typeof parsed.wake_reason === "string" ? parsed.wake_reason : "wake"
    const wakeId = typeof parsed.wake_id === "string" ? parsed.wake_id : undefined
    return wakeId ? `${wakeReason} · ${wakeId}` : wakeReason
  } catch {
    return oneLine(prompt, 96)
  }
}

function styledSidecarThreadLine(line: GoalSidecarThreadLine): TextChunk[] {
  switch (line.kind) {
    case "ask":
      return [bold(fg(theme.transcript.userLabel)(line.text))]
    case "reply-label":
      return [bold(fg(theme.transcript.agentLabel)(line.text))]
    case "reply-body":
      return [fg(theme.transcript.agentBody)(line.text)]
    case "blank":
      return [fg(theme.fgPrimary)(line.text)]
    case "empty":
      return [dim(fg(theme.fgMuted)(line.text))]
  }
}

export function goalShutterStreamEvents(
  events: StackThreadMetaEvent[],
  agentViewEnabled = false,
): StackThreadMetaEvent[] {
  if (agentViewEnabled) {
    return monitorThreadEvents(events).filter((event) => !GOAL_SHUTTER_SIDECAR_CHAT_TYPES.has(event.type))
  }
  return events.filter((event) => {
    if (GOAL_SHUTTER_SIDECAR_CHAT_TYPES.has(event.type)) return false
    if (GOAL_SHUTTER_EVENT_TYPES.has(event.type)) return true
    if (event.type === "agent.tool.failed" || event.type === "agent.error") return true
    if (event.type !== "agent.tool.completed") return false
    return isGoalShutterToolCompletion(event)
  })
}

export function goalShutterStreamLines(
  events: StackThreadMetaEvent[],
  snapshot: StackMonitorSnapshot,
  columns: number,
  agentViewEnabled = false,
): string[] {
  const width = Math.max(16, columns - 2)
  const threadEvents = goalShutterStreamEvents(events, agentViewEnabled)
  if (threadEvents.length === 0) {
    const empty = snapshot.enabled ? "(waiting for sidecar progress)" : "(monitor off)"
    return snapshot.lastSummary
      ? [empty, oneLine(`monitor  ${snapshot.lastSummary}`, width)]
      : [empty]
  }
  const lines: string[] = []
  for (const event of threadEvents) {
    const formatted = agentViewEnabled
      ? [formatEventStreamLine(event, width, events)]
      : formatGoalShutterEvent(event, width, events)
    for (const line of formatted) lines.push(line)
  }
  return lines
}

export function goalShutterStreamLineCount(
  events: StackThreadMetaEvent[],
  columns: number,
  visibleRows: number,
  agentViewEnabled = false,
): number {
  return Math.max(
    visibleRows,
    goalShutterStreamRows(events, emptyGoalShutterSnapshot(), columns, agentViewEnabled).length,
  )
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

export type GoalShutterStreamRow = {
  line: string
  prefill?: string
}

export function goalShutterStreamRows(
  events: StackThreadMetaEvent[],
  snapshot: StackMonitorSnapshot,
  columns: number,
  agentViewEnabled = false,
): GoalShutterStreamRow[] {
  const width = Math.max(16, columns - 2)
  const threadEvents = goalShutterStreamEvents(events, agentViewEnabled)
  if (threadEvents.length === 0) {
    const empty = snapshot.enabled ? "(waiting for sidecar progress)" : "(monitor off)"
    const rows: GoalShutterStreamRow[] = [{ line: empty }]
    if (snapshot.lastSummary) {
      rows.push({ line: oneLine(`monitor  ${snapshot.lastSummary}`, width) })
    }
    return rows
  }
  const rows: GoalShutterStreamRow[] = []
  for (const event of threadEvents) {
    const prefill = sidecarPrefillPromptForEvent(event)
    const formatted = agentViewEnabled
      ? [formatEventStreamLine(event, width, events)]
      : formatGoalShutterEvent(event, width, events)
    formatted.forEach((line, index) => {
      rows.push({ line, prefill: index === 0 ? prefill : undefined })
    })
  }
  return rows
}

export function goalShutterStreamScrollWindow(
  rows: GoalShutterStreamRow[],
  scrollOffset: number,
  visibleRows: number,
): GoalShutterStreamRow[] {
  if (visibleRows <= 0) return []
  const maxOffset = Math.max(0, rows.length - visibleRows)
  const offset = Math.min(Math.max(0, scrollOffset), maxOffset)
  return rows.slice(offset, offset + visibleRows)
}

export function styleGoalShutterStreamLine(line: string): TextChunk[] {
  return styledGoalShutterLine(line)
}

export function renderGoalShutterStreamStyled(
  events: StackThreadMetaEvent[],
  snapshot: StackMonitorSnapshot,
  columns: number,
  visibleRows: number,
  scrollOffset = 0,
  agentViewEnabled = false,
): StyledText {
  const rows = goalShutterStreamRows(events, snapshot, columns, agentViewEnabled)
  const lines = rows.map((row) => row.line)
  return renderMonitorLinesStyled(
    lines,
    visibleRows,
    scrollOffset,
    styledGoalShutterLine,
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
  const showScrollIndicator = visibleRows > 1 && lines.length > visibleRows
  const contentRows = showScrollIndicator ? Math.max(1, visibleRows - 1) : visibleRows
  const window = scrollWindow(lines, scrollOffset, contentRows)
  const chunks: TextChunk[] = []
  for (const [index, line] of window.entries()) {
    if (index > 0) chunks.push(fg(theme.fgPrimary)("\n"))
    chunks.push(...styleLine(line))
  }
  if (showScrollIndicator && scrollOffset > 0) {
    chunks.unshift(dim(`↑ ${scrollOffset + window.length}/${lines.length}\n`))
  } else if (showScrollIndicator) {
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
    case "monitor.chat.request":
      return [oneLine(`› ask  ${readString(payload.message) ?? "(empty)"}`, width)]
    case "monitor.chat.reply": {
      const answer = readString(payload.answer) ?? "(empty reply)"
      const lines = [oneLine(`  sidecar  ${answer}`, width)]
      const criteriaRefs = readNumberArray(payload.criteria_refs)
      const cited = readStringArray(payload.cited_event_ids)
      if (criteriaRefs.length > 0) lines.push(oneLine(`           criteria · ${criteriaRefs.join(", ")}`, width))
      if (cited.length > 0) lines.push(oneLine(`           evidence · ${cited.slice(0, 3).join(", ")}`, width))
      return lines
    }
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
    case "monitor.progress":
      return [
        oneLine(
          `  progress  ${readString(payload.summary) ?? readString(payload.phase) ?? "goal progress"}`,
          width,
        ),
      ]
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

function formatGoalShutterEvent(
  event: StackThreadMetaEvent,
  width: number,
  allEvents: StackThreadMetaEvent[],
): string[] {
  if (event.type.startsWith("monitor.")) return formatNarrativeEvent(event, width, allEvents)
  if (event.type.startsWith("agent.")) return [oneLine(`  agent  ${formatAgentWatchLine(event.type, event.payload)}`, width)]
  const payload = event.payload
  const detail =
    readString(payload.summary) ??
    readString(payload.objective) ??
    readString(payload.status) ??
    readString(payload.reason) ??
    event.type
  return [oneLine(`  ${event.type.replace(/_/g, ".")}  ${detail}`, width)]
}

function sidecarPrefillPromptForEvent(event: StackThreadMetaEvent): string | undefined {
  const payload = event.payload
  switch (event.type) {
    case "monitor.summary": {
      const operatorUpdate = asRecord(payload.operator_update)
      const struggling = readString(operatorUpdate?.struggling_with)
      if (struggling) return `What's blocking progress on ${struggling.slice(0, 72)}?`
      const workingOn = readString(operatorUpdate?.working_on)
      if (workingOn) return `How is progress on ${workingOn.slice(0, 72)}?`
      const summary = readString(payload.summary)
      if (summary) return `Explain this sidecar update: ${summary.slice(0, 72)}`
      return undefined
    }
    case "monitor.chat.reply": {
      const answer = readString(payload.answer)
      if (answer) return `Tell me more about: ${answer.slice(0, 72)}`
      return undefined
    }
    case "monitor.progress":
      return "What's the latest goal progress?"
    case "agent.tool.failed": {
      const command = readString(payload.command) ?? readString(payload.tool_name)
      if (command) return `Why did ${command.slice(0, 72)} fail?`
      return "Why did the latest tool call fail?"
    }
    case "agent.error": {
      const message = readString(payload.message)
      if (message) return `What caused this worker error: ${message.slice(0, 72)}?`
      return "What caused the latest worker error?"
    }
    case "agent.tool.completed": {
      const command = readString(payload.command) ?? readString(payload.tool_name)
      if (command) return `What did ${command.slice(0, 72)} show?`
      return undefined
    }
    default:
      return undefined
  }
}

function isGoalShutterToolCompletion(event: StackThreadMetaEvent): boolean {
  const text = [
    readString(event.payload.tool_name),
    readString(event.payload.command),
    readString(event.payload.output),
    readString(event.payload.stdout),
  ].filter(Boolean).join(" ").toLowerCase()
  return /\b(test|pytest|bun|npm|pnpm|yarn|cargo|go test|tsc|ruff|mypy|build|smoke|verify|check)\b/.test(text)
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
  if (line.startsWith("› ask")) return [fg(theme.synth.gold)(line)]
  if (line.startsWith("› runtime")) return [fg(theme.synth.amber)(line)]
  if (line.startsWith("  monitor")) return [fg("#3fb950")(line)]
  if (line.startsWith("  sidecar")) return [fg("#3fb950")(line)]
  if (line.startsWith("  progress")) return [fg("#3fb950")(line)]
  if (line.startsWith("  steer")) return [fg("#3fb950")(line)]
  if (line.startsWith("  queue")) return [fg(theme.synth.amber)(line)]
  if (line.startsWith("  push")) return [fg(theme.synth.gold)(line)]
  if (line.startsWith("  error")) return [fg(theme.synth.red)(line)]
  if (line.startsWith("(no messages") || line.startsWith("(waiting") || line.startsWith("(monitor off)") || line.startsWith("(off)")) return [dim(fg(theme.fgMuted)(line))]
  return [fg(theme.fgPrimary)(line)]
}

function styledGoalShutterLine(line: string): TextChunk[] {
  if (line.includes(" ✗") || line.includes(" error") || line.includes("failed")) return [fg(theme.synth.red)(line)]
  if (line.startsWith("  agent")) return [dim(fg(theme.transcript.toolLabel)(line))]
  return styledNarrativeLine(line)
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

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
}

function readNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry))
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

function emptyGoalShutterSnapshot(): StackMonitorSnapshot {
  return {
    enabled: true,
    actorId: "monitor",
    label: "Monitor",
    runtime: "codex-app-server",
    model: "monitor",
    reasoningEffort: "medium",
    strictness: "passive",
    status: "watching",
    lastSeverity: "none",
    wakeCount: 0,
    queuedCount: 0,
    skillReadCount: 0,
    contextPushCount: 0,
    threadSpendUsd: 0,
    focusResults: {},
    modeSource: "config",
  }
}
