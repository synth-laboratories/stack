import { StyledText, bold, dim, fg, type TextChunk } from "@opentui/core"
import { randomUUID } from "node:crypto"
import type { StackMonitorSnapshot } from "../monitor.js"
import type { StackMonitorSidecarTurn } from "../monitor-sidecar-codex.js"
import type { StackThreadMetaEvent } from "../thread-events.js"
import { stackTuiTheme as theme } from "./theme.js"
import {
  blocksFromTurnStdout,
  maxTranscriptScrollOffset,
  renderTranscriptStyledView,
  appendUserBlock,
  type TranscriptBlock,
  type TranscriptRenderOptions,
} from "./transcript.js"

type SidecarBuild = ReturnType<typeof blocksFromTurnStdout>

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

// The HUMAN-facing events feed. Deliberately excludes the internal per-pass mechanics —
// monitor.summary (checkpoint), monitor.progress (internal narration record), monitor.wake,
// monitor.checkpoint, monitor.pause_for_restart, monitor.trigger_queued, monitor.usage — so the
// operator sees deliberate updates, not plumbing. The real update rides monitor.goal_status with
// for_human:true (type=status, headline=title, note=content); steers ride monitor.steer.
const GOAL_SHUTTER_EVENT_TYPES = new Set([
  "monitor.chat.reply",
  "monitor.goal_status",
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
    const body = sidecarTurnOutputLines(turn.stdout, width)
    const errorText = turn.stderr.trim()
    // A quiet wake (only the internal pause tool + NO_USER_UPDATE) has no body — don't show its
    // header either. The sidecar thread shows monitor ACTIVITY, not every heartbeat.
    if (body.length === 0 && !errorText) continue
    if (lines.length > 0) lines.push({ text: "", kind: "blank" })
    lines.push(...wrapPlain(`› ${sidecarTurnPromptLabel(turn.prompt)}`, width).map((text) => ({
      text,
      kind: "ask" as const,
    })))
    for (const line of body) lines.push(line)
    if (errorText) {
      lines.push(...wrapPlain(`error · ${errorText}`, width).map((text, index) => ({
        text,
        kind: index === 0 ? "reply-label" as const : "reply-body" as const,
      })))
    }
  }
  if (lines.length === 0) return [{ text: "(monitor watching · no update yet)", kind: "empty" }]
  return lines
}

// Rendered like the worker chat: interleaved tool calls + thinking + the monitor's message —
// with the runtime mechanics (the mandatory pause tool, the bridge's start+complete double-emit)
// and the "staying quiet" marker filtered out, and the machine directive prefix cleaned off.
const SIDECAR_PAUSE_TOOL = "stack_sidecar_pause_for_restart"

function isSidecarQuietMarker(text: string): boolean {
  return /^\s*NO_USER_UPDATE\.?\s*$/i.test(text)
}

function cleanSidecarMessage(text: string): string {
  return text
    .replace(/^\s*PROGRESS_UPDATE\s*:\s*/i, "")
    .replace(/\bSTEER_WORKER\s*:\s*/gi, "steer → ")
    .replace(/\bNO_USER_UPDATE\b\.?/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
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
  const seenCalls = new Set<string>()
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
      if (name === SIDECAR_PAUSE_TOOL) continue // runtime mechanics — never shown to the operator
      // The bridge serializes the same call on item/started AND item/completed; de-dup so a tool
      // shows once, not twice.
      const callKey = `${String(parsed.call_id ?? parsed.id ?? name)}:${String(parsed.arguments ?? "")}`
      if (seenCalls.has(callKey)) continue
      seenCalls.add(callKey)
      lines.push(...wrapPlain(`tool · ${name}`, width).map((text, index) => ({
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
  if (latestAgentMessage && !isSidecarQuietMarker(latestAgentMessage)) {
    const message = cleanSidecarMessage(latestAgentMessage)
    if (message) {
      lines.push(...wrapPlain(message, width).map((text, index) => ({
        text,
        kind: index === 0 ? "reply-label" as const : "reply-body" as const,
      })))
    }
  }
  return lines
}

const WAKE_REASON_LABELS: Record<string, string> = {
  tool_completed: "tool completed",
  tool_failed: "tool failed",
  turn_completed: "turn completed",
  error: "worker error",
  operator_message: "operator message",
  cadence_tick: "scheduled check",
  stale_worker: "worker idle",
  event_batch: "activity batch",
  delta_events: "activity",
}

function sidecarTurnPromptLabel(prompt: string): string {
  try {
    const parsed = JSON.parse(prompt) as Record<string, unknown>
    const operatorMessage = typeof parsed.operator_message === "string" ? parsed.operator_message.trim() : ""
    if (operatorMessage) return operatorMessage
    const wakeReason = typeof parsed.wake_reason === "string" ? parsed.wake_reason : "wake"
    return WAKE_REASON_LABELS[wakeReason] ?? wakeReason.replace(/_/g, " ")
  } catch {
    return oneLine(prompt, 96)
  }
}

// Who the wake "user turn" actually came from: the operator (a sidecar message) or the runtime.
function sidecarTurnOrigin(prompt: string): string {
  try {
    const parsed = JSON.parse(prompt) as Record<string, unknown>
    if (typeof parsed.operator_message === "string" && parsed.operator_message.trim()) return "you"
  } catch {
    // fall through
  }
  return "runtime"
}

// --- Structured goal-progress visualization -------------------------------------------------
// The monitor writes typed `monitor.goal_status` events via the `stack_monitor_goal_status` tool.
// Rather than dump the free-text feed, we visualize the STRUCTURE: a one-line status/metric strip
// plus a milestone timeline. Simple beats a text dump.

export type GoalMilestone = {
  status: string
  note: string
  metric?: Record<string, unknown>
  at: string
}

export function goalMilestonesFromEvents(events: StackThreadMetaEvent[]): GoalMilestone[] {
  const out: GoalMilestone[] = []
  for (const event of events) {
    if (event.type !== "monitor.goal_status") continue
    const payload = event.payload as Record<string, unknown>
    const metric = payload.metric && typeof payload.metric === "object" && !Array.isArray(payload.metric)
      ? (payload.metric as Record<string, unknown>)
      : undefined
    out.push({
      status: readString(payload.status) ?? "working",
      note: readString(payload.note) ?? "",
      metric,
      at: event.observed_at,
    })
  }
  return out
}

function goalStatusIcon(status: string): string {
  switch (status) {
    case "goal_met":
      return "✓"
    case "goal_failed":
      return "✗"
    case "blocked":
    case "stalled":
      return "▲"
    case "advancing":
      return "◆"
    default:
      return "·"
  }
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function formatGoalMetric(metric?: Record<string, unknown>): string {
  if (!metric) return ""
  const value = readNumber(metric.value)
  const baseline = readNumber(metric.baseline)
  const target = readNumber(metric.target)
  const ratio = readNumber(metric.ratio) ?? (value !== undefined && baseline ? value / baseline : undefined)
  // A target can be a RATIO (be 2× better → "target 2×") or an absolute SCORE ("target ≥ 0.17").
  // Prefer explicit target_ratio/target_value; else disambiguate `target` by magnitude — ratios are
  // ≥ 1.5, absolute score bars here are < 1. This stops the "target 0.1742×" mislabel.
  const targetRatio = readNumber(metric.target_ratio) ?? (target !== undefined && target >= 1.5 ? target : undefined)
  const targetValue = readNumber(metric.target_value) ?? (target !== undefined && target < 1.5 ? target : undefined)
  const parts: string[] = []
  if (ratio !== undefined) parts.push(`${ratio.toFixed(2)}×`)
  if (value !== undefined) parts.push(baseline !== undefined ? `${value} vs ${baseline}` : `${value}`)
  if (targetRatio !== undefined) parts.push(`target ${targetRatio}×`)
  else if (targetValue !== undefined) parts.push(`target ≥ ${targetValue}`)
  return parts.join(" · ")
}

function goalMilestoneStyle(status: string): (text: string) => TextChunk {
  switch (status) {
    case "goal_met":
      return (text) => bold(fg(theme.synth.gold)(text))
    case "goal_failed":
    case "blocked":
    case "stalled":
      return (text) => fg(theme.synth.red)(text)
    case "advancing":
      return (text) => fg(theme.synth.amber)(text)
    default:
      return (text) => fg(theme.fgMuted)(text)
  }
}

// One-line headline: the latest structured status + its metric. Empty until the monitor emits one.
export function goalProgressStripLine(events: StackThreadMetaEvent[], columns: number): string | undefined {
  const milestones = goalMilestonesFromEvents(events)
  const latest = milestones.at(-1)
  if (!latest) return undefined
  const metric = formatGoalMetric(latest.metric)
  const label = latest.status.replace(/_/g, " ")
  return oneLine(
    `${goalStatusIcon(latest.status)} ${label}${metric ? ` · ${metric}` : ""}${latest.note ? ` · ${latest.note}` : ""}`,
    Math.max(16, columns - 2),
  )
}

export function renderGoalProgressStripStyled(events: StackThreadMetaEvent[], columns: number): StyledText | undefined {
  const milestones = goalMilestonesFromEvents(events)
  const latest = milestones.at(-1)
  if (!latest) return undefined
  const line = goalProgressStripLine(events, columns)
  if (!line) return undefined
  return new StyledText([goalMilestoneStyle(latest.status)(line)])
}

export function goalProgressTimelineLineCount(events: StackThreadMetaEvent[]): number {
  return Math.max(1, goalMilestonesFromEvents(events).length)
}

export function renderGoalProgressTimelineStyled(
  events: StackThreadMetaEvent[],
  columns: number,
  visibleRows: number,
  scrollOffset = 0,
): StyledText {
  const width = Math.max(16, columns - 2)
  const milestones = goalMilestonesFromEvents(events)
  if (milestones.length === 0) {
    return new StyledText([dim(fg(theme.fgMuted)("(no goal milestones yet)"))])
  }
  const lines = milestones.map((milestone) => {
    const metric = formatGoalMetric(milestone.metric)
    const body = [milestone.note, metric].filter(Boolean).join(" · ") || milestone.status.replace(/_/g, " ")
    return { status: milestone.status, text: oneLine(`${goalStatusIcon(milestone.status)} ${body}`, width) }
  })
  const maxOffset = Math.max(0, lines.length - visibleRows)
  const offset = Math.min(Math.max(0, scrollOffset), maxOffset)
  const window = lines.slice(offset, offset + visibleRows)
  const chunks: TextChunk[] = []
  for (const [index, line] of window.entries()) {
    if (index > 0) chunks.push(fg(theme.fgPrimary)("\n"))
    chunks.push(goalMilestoneStyle(line.status)(line.text))
  }
  return new StyledText(chunks)
}

// --- Rich sidecar-thread render ------------------------------------------------------------
// Render the monitor's transcript exactly like the worker chat — interleaved thinking + grouped
// tool calls — via the shared transcript renderer. Runtime mechanics (the pause tool, the bridge's
// start+complete double-emit) and the "staying quiet" marker are filtered first, and the machine
// directive prefix is cleaned off the message so PROGRESS_UPDATE reads as plain prose.

// Exposed for tests: the cleaning applied to a turn's JSONL stdout before it is rendered.
export function cleanSidecarStdout(stdout: string): string {
  const out: string[] = []
  const pauseCallIds = new Set<string>()
  for (const raw of stdout.split(/\r?\n/)) {
    if (!raw.trim()) continue
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>
    } catch {
      out.push(raw)
      continue
    }
    if (parsed.type === "function_call" && parsed.name === SIDECAR_PAUSE_TOOL) {
      const id = String(parsed.call_id ?? parsed.id ?? "")
      if (id) pauseCallIds.add(id)
      continue // the mandatory pause tool is runtime mechanics, never shown
    }
    if (parsed.type === "function_call_output" && pauseCallIds.has(String(parsed.call_id ?? parsed.id ?? ""))) {
      continue // and its result too, so no orphan tool block is grouped
    }
    if (parsed.type === "agent_message" && typeof parsed.text === "string") {
      const text = parsed.text.trim()
      if (isSidecarQuietMarker(text)) continue // a quiet review is not a message
      const cleaned = cleanSidecarMessage(text)
      if (!cleaned) continue
      out.push(JSON.stringify({ ...parsed, text: cleaned }))
      continue
    }
    out.push(raw)
  }
  return out.join("\n")
}

function buildSidecarBlocks(
  turns?: readonly StackMonitorSidecarTurn[],
  events?: readonly StackThreadMetaEvent[],
): SidecarBuild {
  const blocks: SidecarBuild["blocks"] = []
  const tools: SidecarBuild["tools"] = []
  const subagents: SidecarBuild["subagents"] = []
  const renderedTurnText: string[] = []
  for (const turn of turns ?? []) {
    // The wake "user turn" comes from the RUNTIME (or the operator, for a sidecar message). Keep the
    // user-block style but label the true origin so it reads "› runtime  scheduled check".
    const built = blocksFromTurnStdout(
      sidecarTurnPromptLabel(turn.prompt),
      cleanSidecarStdout(turn.stdout),
      sidecarTurnOrigin(turn.prompt),
    )
    // A quiet review yields only its wake-header block — skip it so the thread shows real activity.
    const hasContent = built.blocks.some((block) => block.kind !== "user") || built.tools.length > 0
    if (!hasContent) continue
    renderedTurnText.push(sidecarTurnPromptLabel(turn.prompt), cleanSidecarStdout(turn.stdout))
    blocks.push(...built.blocks)
    tools.push(...built.tools)
    subagents.push(...built.subagents)
  }
  appendSidecarChatEventBlocks(blocks, events ?? [], renderedTurnText.join("\n"))
  return { blocks, tools, subagents }
}

export function renderGoalSidecarThreadRich(input: {
  turns?: readonly StackMonitorSidecarTurn[]
  events?: readonly StackThreadMetaEvent[]
  columns: number
  visibleRows?: number
  scrollOffset?: number
  options: TranscriptRenderOptions
}): StyledText {
  const { blocks, tools, subagents } = buildSidecarBlocks(input.turns, input.events)
  if (blocks.length === 0) {
    return new StyledText([dim(fg(theme.fgMuted)("(monitor watching · no update yet)"))])
  }
  const columns = Math.max(16, input.columns - 2)
  const visibleRows = input.visibleRows ?? 5
  return renderTranscriptStyledView(
    blocks,
    tools,
    subagents,
    { lines: visibleRows, columns, pageLines: visibleRows },
    input.options,
    input.scrollOffset ?? 0,
  )
}

// Total rendered line count (for scroll bounds); mirrors the rich render's block build.
export function sidecarThreadRenderedLineCount(input: {
  turns?: readonly StackMonitorSidecarTurn[]
  events?: readonly StackThreadMetaEvent[]
  columns: number
  options: TranscriptRenderOptions
}): number {
  const { blocks, tools, subagents } = buildSidecarBlocks(input.turns, input.events)
  if (blocks.length === 0) return 1
  // A 0-line viewport makes maxTranscriptScrollOffset return the full annotated line count.
  return maxTranscriptScrollOffset(blocks, tools, subagents, Math.max(16, input.columns - 2), input.options, 0)
}

function appendSidecarChatEventBlocks(
  blocks: TranscriptBlock[],
  events: readonly StackThreadMetaEvent[],
  renderedTurnText: string,
): void {
  const chatEvents = events
    .filter((event) => event.type === "monitor.chat.request" || event.type === "monitor.chat.reply")
    .sort((left, right) => left.observed_at.localeCompare(right.observed_at))
  for (const event of chatEvents) {
    if (event.type === "monitor.chat.request") {
      const message = readString(event.payload.message)
      if (!message || renderedTurnText.includes(message)) continue
      appendUserBlock(blocks, message, "you")
      continue
    }
    const answer = readString(event.payload.answer)
    if (!answer || renderedTurnText.includes(answer)) continue
    blocks.push({ id: randomUUID(), kind: "agent", text: answer })
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
  return events.filter((event) => GOAL_SHUTTER_EVENT_TYPES.has(event.type) && isHumanFacingGoalFeedEvent(event))
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
    const empty = snapshot.enabled ? "(monitor watching · no human-facing updates yet)" : "(monitor off)"
    return [empty, ...substantiveSummaryLines(snapshot.lastSummary, width)]
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
    const empty = snapshot.enabled ? "(monitor watching · no human-facing updates yet)" : "(monitor off)"
    const rows: GoalShutterStreamRow[] = [{ line: empty }]
    for (const line of substantiveSummaryLines(snapshot.lastSummary, width)) rows.push({ line })
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

// The operator feed's primary entry: the monitor's `stack_monitor_goal_status` tool call, rendered
// as `type · headline` on line 1 with one content line beneath. type is derived from `status`, the
// title from `headline`, the content from `note`. Kept to two rows so events stay scannable.
function formatGoalStatusEvent(event: StackThreadMetaEvent, width: number): string[] {
  const payload = event.payload
  const status = readString(payload.status) ?? "working"
  const note = readString(payload.note)
  const headline = readString(payload.headline) ?? note ?? goalStatusLabel(status)
  const typeWord = goalStatusTypeWord(status)
  const lines = [clampLine(`  ${typeWord} · ${headline}`, width)]
  if (note && note !== headline) lines.push(clampLine(`    ${note}`, width))
  return lines
}

// Maps the structured `status` onto the short feed type-word + drives its color in styledNarrativeLine.
function goalStatusTypeWord(status: string): string {
  switch (status) {
    case "advancing":
      return "progress"
    case "working":
      return "working"
    case "blocked":
      return "blocked"
    case "stalled":
      return "stalled"
    case "goal_met":
      return "done"
    case "goal_failed":
      return "failed"
    default:
      return "monitor"
  }
}

function goalStatusLabel(status: string): string {
  return status.replace(/_/g, " ")
}

function formatNarrativeEvent(
  event: StackThreadMetaEvent,
  width: number,
  allEvents: StackThreadMetaEvent[] = [],
): string[] {
  const payload = event.payload
  switch (event.type) {
    case "monitor.operator_message":
      return [clampLine(`› you  ${readString(payload.message) ?? "(empty)"}`, width)]
    case "monitor.chat.request":
      return [clampLine(`› ask  ${readString(payload.message) ?? "(empty)"}`, width)]
    case "monitor.chat.reply": {
      const answer = readString(payload.answer) ?? "(empty reply)"
      const lines = [clampLine(`  sidecar · ${answer}`, width)]
      const criteriaRefs = readNumberArray(payload.criteria_refs)
      const cited = readStringArray(payload.cited_event_ids)
      if (criteriaRefs.length > 0) lines.push(clampLine(`      criteria · ${criteriaRefs.join(", ")}`, width))
      if (cited.length > 0) lines.push(clampLine(`      evidence · ${cited.slice(0, 3).join(", ")}`, width))
      return lines
    }
    case "monitor.wake": {
      const reason = readString(payload.wake_reason) ?? "trigger"
      if (reason === "operator_message") return []
      return [clampLine(`› runtime  ${monitorRuntimeWakeMessage(event, allEvents)}`, width)]
    }
    case "monitor.summary": {
      const summary = readString(payload.summary) ?? "(empty summary)"
      const severity = readString(payload.severity) ?? "none"
      const operatorUpdate = asRecord(payload.operator_update)
      const workingOn = readString(operatorUpdate?.working_on)
      const struggling = readString(operatorUpdate?.struggling_with)
      const progress = readString(operatorUpdate?.progress_note)
      const lead = struggling
        ? `  concern · ${struggling}`
        : progress
          ? `  progress · ${progress}`
          : workingOn
            ? `  working · ${workingOn}`
            : `  monitor · ${severity} · ${summary}`
      const lines = [clampLine(lead, width)]
      if (progress && struggling && !struggling.includes(progress)) lines.push(clampLine(`      progress · ${progress}`, width))
      if (workingOn && !lead.includes(workingOn)) lines.push(clampLine(`      working · ${workingOn}`, width))
      if (summary && severity !== "none" && !lead.includes(summary)) lines.push(clampLine(`      summary · ${summary}`, width))
      return lines
    }
    case "monitor.progress": {
      const text = (readString(payload.summary) ?? readString(payload.phase) ?? "").trim()
      if (!text || /^NO_USER_UPDATE\b/i.test(text)) return [] // defensive: never surface a quiet marker
      return [clampLine(`  progress · ${text.replace(/^\s*PROGRESS_UPDATE\s*:\s*/i, "")}`, width)]
    }
    case "monitor.queued":
      return [
        clampLine(
          `  queue · ${readString(payload.summary) ?? readString(payload.message) ?? readString(payload.reason) ?? "item"}`,
          width,
        ),
      ]
    case "monitor.steer":
      return [
        clampLine(
          readString(payload.rule_id) || readString(payload.guidance_id)
            ? `  steer · ${readString(payload.rule_id) ?? "rule"} · ${readString(payload.guidance_id) ?? "guide"}`
            : `  steer · ${readString(payload.focus) ?? "worker"}`,
          width,
        ),
        ...(readString(payload.message) ? [clampLine(`      ${readString(payload.message)!}`, width)] : []),
      ]
    case "monitor.skill_context_push":
      return [
        clampLine(`  push · ${readString(payload.skill_id) ?? "skill"} · ${readString(payload.reason) ?? "context"}`, width),
      ]
    case "monitor.error":
      return [clampLine(`  error · ${readString(payload.message) ?? "monitor failed"}`, width)]
    default:
      return []
  }
}

function formatGoalShutterEvent(
  event: StackThreadMetaEvent,
  width: number,
  allEvents: StackThreadMetaEvent[],
): string[] {
  if (event.type === "monitor.goal_status") return formatGoalStatusEvent(event, width)
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
    case "monitor.goal_status": {
      const headline = readString(payload.headline)
      if (headline) return `Tell me more about: ${headline.slice(0, 72)}`
      const note = readString(payload.note)
      if (note) return `Explain this update: ${note.slice(0, 72)}`
      return "What's the latest goal progress?"
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

function isHumanFacingGoalFeedEvent(event: StackThreadMetaEvent): boolean {
  switch (event.type) {
    case "monitor.steer":
    case "monitor.skill_context_push":
    case "monitor.error":
    case "monitor.chat.reply":
      return true
    case "monitor.goal_status":
      // The monitor opts an update into the operator feed by setting for_human on its tool call.
      return event.payload.for_human === true
    default:
      return false
  }
}

function substantiveSummaryLines(summary: string | undefined, width: number): string[] {
  if (!summary || isRuntimeOrQuietSummary(summary)) return []
  return [oneLine(`monitor  ${summary}`, width)]
}

function isRuntimeOrQuietSummary(summary: string): boolean {
  const text = summary.trim().toLowerCase()
  if (!text) return true
  if (/^no_user_update\.?$/.test(text)) return true
  if (/\bcheckpoint advanced\b/.test(text)) return true
  if (/\bwaiting for the next wake\b/.test(text)) return true
  if (
    /\breviewed\b.*\bevent(s)?\b/.test(text) &&
    !/\b(progress|baseline|candidate|blocked|stuck|failed|risk|score|criterion|done|target)\b/.test(text)
  ) {
    return true
  }
  return false
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
    case "event_batch":
      if (pendingCount !== undefined) {
        return `review ${pendingCount} worker event${pendingCount === 1 ? "" : "s"}`
      }
      return triggerDetail ? `review worker event batch · ${triggerDetail}` : "review worker event batch"
    case "cadence_tick":
      return triggerDetail ? `scheduled progress check · ${triggerDetail}` : "scheduled progress check"
    case "stale_worker":
      return triggerDetail ? `check silent worker · ${triggerDetail}` : "check silent worker"
    case "queued_trigger":
      return triggerDetail ? `drain queued trigger · ${triggerDetail}` : "drain queued trigger"
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
  if (line.startsWith("  working")) return [fg("#3fb950")(line)]
  if (line.startsWith("  done")) return [fg("#3fb950")(line)]
  if (line.startsWith("  concern")) return [fg(theme.synth.red)(line)]
  if (line.startsWith("  blocked")) return [fg(theme.synth.red)(line)]
  if (line.startsWith("  stalled")) return [fg(theme.synth.red)(line)]
  if (line.startsWith("  failed")) return [fg(theme.synth.red)(line)]
  if (line.startsWith("  steer")) return [fg("#3fb950")(line)]
  if (line.startsWith("  queue")) return [fg(theme.synth.amber)(line)]
  if (line.startsWith("  push")) return [fg(theme.synth.gold)(line)]
  if (line.startsWith("  error")) return [fg(theme.synth.red)(line)]
  if (line.startsWith("(no messages") || line.startsWith("(waiting") || line.startsWith("(monitor off)") || line.startsWith("(off)")) return [dim(fg(theme.fgMuted)(line))]
  // Indented rows (>= 4 leading spaces) are content beneath a header — dim so the type · headline scans first.
  if (/^\s{4,}\S/.test(line)) return [dim(fg(theme.fgSecondary)(line))]
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

// Like oneLine, but PRESERVES the leading indent so the feed's prefix-based coloring/dimming
// survives (a 2-space `  progress` header stays a header; a 4-space content line stays content).
// oneLine's trim() strips those leads and flattens the whole feed to one color — clampLine keeps them.
function clampLine(value: string, maxLength: number): string {
  const lead = value.match(/^ */)?.[0] ?? ""
  const body = value.slice(lead.length).replace(/\s+/g, " ").trimEnd()
  const line = lead + body
  if (line.length <= maxLength) return line
  if (maxLength <= 3) return line.slice(0, maxLength)
  return `${line.slice(0, maxLength - 1)}…`
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
