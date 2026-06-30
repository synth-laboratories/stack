import { StyledText, dim, fg, type TextChunk } from "@opentui/core"
import type { GardenerInboxItem } from "../gardener.js"
import type { StackThreadMetaEvent } from "../thread-events.js"
import { formatToolSummary, type ToolLog, type TranscriptBlock } from "./transcript.js"
import { stackTuiTheme as theme } from "./theme.js"

/** Operator ↔ gardener conversation only. Dispatch noise lives on the events tab. */
const GARDENER_CHAT_EVENT_TYPES = new Set(["gardener.message", "gardener.friction"])

/** Full narrative including garden doc updates (events tab / legacy views). */
const NARRATIVE_EVENT_TYPES = new Set([
  "gardener.message",
  "gardener.queued",
  "gardener.routed",
  "gardener.dispatched",
  "gardener.friction",
  "gardener.garden_updated",
  "gardener.workspace_updated",
  "gardener.maintenance_pass",
  "gardener.skill_suggest",
  "skills.registered",
])

type GardenerChatLine =
  | { kind: "empty" }
  | { kind: "user-header"; voice?: boolean }
  | { kind: "user-body"; text: string }
  | { kind: "gardener-header" }
  | { kind: "gardener-body"; text: string }
  | { kind: "friction"; text: string }
  | { kind: "system"; text: string }
  | { kind: "activity"; text: string }

export type GardenerLiveActivity = {
  blocks: readonly TranscriptBlock[]
  tools: readonly ToolLog[]
  thinking?: string
  running: boolean
  spinnerFrame: number
}

export type GardenerThreadContext = {
  talkToGardener: boolean
  workerTargetLabel?: string
  workerStatus: string
  pendingInbox: GardenerInboxItem[]
  selectedInboxIndex: number
}

export function gardenerThreadEvents(events: StackThreadMetaEvent[]): StackThreadMetaEvent[] {
  return events.filter((event) => event.type.startsWith("gardener."))
}

export function gardenerNarrativeLineCount(
  events: StackThreadMetaEvent[],
  context: GardenerThreadContext,
  columns: number,
): number {
  return gardenerNarrativeLines(events, context, columns).length
}

export function gardenerEventStreamLineCount(events: StackThreadMetaEvent[], columns: number): number {
  return gardenerEventStreamLines(events, columns).length
}

export function gardenerChatNarrativeLines(
  events: StackThreadMetaEvent[],
  columns: number,
): string[] {
  return gardenerChatLines(events, columns).map(formatChatLinePlain)
}

export function gardenerChatNarrativeLineCount(
  events: StackThreadMetaEvent[],
  columns: number,
  live?: GardenerLiveActivity,
): number {
  return buildCombinedChatLines(events, columns, live).length
}

export function renderGardenerChatNarrativeStyled(
  events: StackThreadMetaEvent[],
  columns: number,
  visibleRows: number,
  scrollOffset = 0,
  live?: GardenerLiveActivity,
): StyledText {
  return renderGardenerChatLinesStyled(
    buildCombinedChatLines(events, columns, live),
    visibleRows,
    scrollOffset,
  )
}

export function gardenerLiveStatusLine(running: boolean, spinnerFrame: number, columns: number): string | undefined {
  if (!running) return undefined
  const width = Math.max(16, columns - 2)
  const frames = ["|", "/", "-", "\\"]
  const spinner = frames[spinnerFrame % frames.length] ?? "|"
  return oneLine(`◆ Gardener ▸ ${spinner}`, width)
}

export function renderGardenerLiveStatusStyled(
  running: boolean,
  spinnerFrame: number,
  columns: number,
): StyledText | undefined {
  const line = gardenerLiveStatusLine(running, spinnerFrame, columns)
  if (!line) return undefined
  return new StyledText([dim(fg(theme.synth.amber)(line))])
}

export function gardenerNarrativeLines(
  events: StackThreadMetaEvent[],
  context: GardenerThreadContext,
  columns: number,
): string[] {
  const width = Math.max(16, columns - 2)
  const lines: string[] = []
  const target = context.workerTargetLabel ?? "worker"
  lines.push(
    oneLine(
      `gardener · ${context.talkToGardener ? "talk on" : "talk off"} · ${target} · ${context.workerStatus}`,
      width,
    ),
  )

  const threadEvents = gardenerThreadEvents(events).filter((event) => NARRATIVE_EVENT_TYPES.has(event.type))
  if (threadEvents.length === 0) {
    lines.push("(no thread yet — G or /g to message)")
  } else {
    for (const event of threadEvents) {
      for (const line of formatNarrativeEvent(event, width)) {
        lines.push(line)
      }
    }
  }

  const pending = context.pendingInbox
  if (pending.length > 0) {
    lines.push("")
    lines.push("inbox")
    for (const [index, item] of pending.entries()) {
      const marker = index === context.selectedInboxIndex ? "▸" : " "
      lines.push(oneLine(`${marker} ${item.message}`, width))
    }
  }
  return lines
}

export function gardenerEventStreamLines(events: StackThreadMetaEvent[], columns: number): string[] {
  const width = Math.max(14, columns - 2)
  const threadEvents = gardenerThreadEvents(events)
  if (threadEvents.length === 0) return ["(no events yet)"]
  return threadEvents.map((event) => formatEventStreamLine(event, width))
}

export function renderGardenerNarrativeStyled(
  events: StackThreadMetaEvent[],
  context: GardenerThreadContext,
  columns: number,
  visibleRows: number,
  scrollOffset = 0,
): StyledText {
  return renderGardenerLinesStyled(
    gardenerNarrativeLines(events, context, columns),
    visibleRows,
    scrollOffset,
    styledNarrativeLine,
  )
}

export function renderGardenerEventStreamStyled(
  events: StackThreadMetaEvent[],
  columns: number,
  visibleRows: number,
  scrollOffset = 0,
): StyledText {
  return renderGardenerLinesStyled(
    gardenerEventStreamLines(events, columns),
    visibleRows,
    scrollOffset,
    styledEventStreamLine,
  )
}

function buildCombinedChatLines(
  events: StackThreadMetaEvent[],
  columns: number,
  live?: GardenerLiveActivity,
): GardenerChatLine[] {
  const lines = gardenerChatLines(events, columns)
  if (!live?.running) return lines
  const activity = buildLiveActivityLines(live, columns)
  if (activity.length === 0) return lines
  if (lines.length > 0 && lines.at(-1)?.kind !== "empty") lines.push({ kind: "empty" })
  lines.push(...activity)
  return lines
}

function buildLiveActivityLines(live: GardenerLiveActivity, columns: number): GardenerChatLine[] {
  const width = Math.max(20, columns - 2)
  const spinner = ["|", "/", "-", "\\"][live.spinnerFrame % 4] ?? "|"
  const lines: GardenerChatLine[] = []

  const liveToolGroup = [...live.blocks].reverse().find((block) => block.kind === "tool_group" && block.live)
  if (liveToolGroup?.kind === "tool_group") {
    const names = liveToolGroup.toolIds
      .map((toolId) => live.tools.find((entry) => entry.id === toolId))
      .filter((tool): tool is ToolLog => Boolean(tool))
      .map((tool) => tool.name)
      .join(" · ")
    lines.push({
      kind: "activity",
      text: oneLine(`⎿ tools ${spinner} ${names || "…"}`, width),
    })
  } else {
    const activeTool = [...live.tools].reverse().find((tool) => tool.status !== "completed")
    if (activeTool) {
      lines.push({ kind: "activity", text: oneLine(formatToolSummary(activeTool), width) })
    }
  }

  return lines.slice(-3)
}

function cleanThinkingPreview(text: string): string {
  return text.replace(/^thinking:\s*/i, "").replace(/\s+/g, " ").trim()
}

function gardenerChatLines(events: StackThreadMetaEvent[], columns: number): GardenerChatLine[] {
  const width = Math.max(24, columns)
  const bodyWidth = Math.max(20, width - 2)
  const threadEvents = gardenerThreadEvents(events).filter((event) => GARDENER_CHAT_EVENT_TYPES.has(event.type))
  if (threadEvents.length === 0) {
    return [{ kind: "system", text: "(no messages yet)" }]
  }

  const lines: GardenerChatLine[] = []
  for (const event of threadEvents) {
    const block = formatChatEvent(event, bodyWidth)
    if (block.length === 0) continue
    if (lines.length > 0) lines.push({ kind: "empty" })
    lines.push(...block)
  }
  return lines
}

function formatChatEvent(event: StackThreadMetaEvent, bodyWidth: number): GardenerChatLine[] {
  const payload = event.payload
  switch (event.type) {
    case "gardener.message": {
      const role = readString(payload.role) ?? "user"
      const text = readString(payload.message) ?? "(empty)"
      if (role === "gardener") return formatGardenerMessage(text, bodyWidth)
      const source = readString(payload.source)
      return formatUserMessage(text, bodyWidth, source === "voice")
    }
    case "gardener.friction":
      return [
        {
          kind: "friction",
          text: readString(payload.summary) ?? readString(payload.pattern) ?? "friction noted",
        },
      ]
    default:
      return []
  }
}

function formatUserMessage(text: string, bodyWidth: number, voice: boolean): GardenerChatLine[] {
  const bodyLines = wrapText(text, bodyWidth)
  const lines: GardenerChatLine[] = [{ kind: "user-header", voice }]
  for (const line of bodyLines) lines.push({ kind: "user-body", text: line })
  return lines
}

function formatGardenerMessage(text: string, bodyWidth: number): GardenerChatLine[] {
  const bodyLines = wrapText(text, bodyWidth)
  const lines: GardenerChatLine[] = [{ kind: "gardener-header" }]
  for (const line of bodyLines) lines.push({ kind: "gardener-body", text: line })
  return lines
}

function renderGardenerChatLinesStyled(
  lines: GardenerChatLine[],
  visibleRows: number,
  scrollOffset: number,
): StyledText {
  const window = scrollWindow(lines, scrollOffset, visibleRows).slice(0, Math.max(0, visibleRows))
  const chunks: TextChunk[] = []
  for (const [index, line] of window.entries()) {
    if (index > 0) chunks.push(fg(theme.fgPrimary)("\n"))
    chunks.push(...styledChatLine(line))
  }
  return new StyledText(chunks)
}

function styledChatLine(line: GardenerChatLine): TextChunk[] {
  switch (line.kind) {
    case "empty":
      return [fg(theme.fgPrimary)("")]
    case "user-header":
      return [fg(theme.synth.gold)(line.voice ? "› you · voice" : "› you")]
    case "user-body":
      return [dim(fg(theme.synth.gold)(`  ${line.text}`))]
    case "gardener-header":
      return [fg("#3fb950")("◆ gardener")]
    case "gardener-body":
      return [fg(theme.fgPrimary)(`  ${line.text}`)]
    case "friction":
      return [fg(theme.synth.amber)(`⚠ ${line.text}`)]
    case "system":
      return [dim(fg(theme.fgMuted)(line.text))]
    case "activity":
      return [dim(fg(theme.transcript.planningLabel)(line.text))]
    default:
      return [fg(theme.fgPrimary)("")]
  }
}

function formatChatLinePlain(line: GardenerChatLine): string {
  switch (line.kind) {
    case "empty":
      return ""
    case "user-header":
      return line.voice ? "› you · voice" : "› you"
    case "user-body":
      return `  ${line.text}`
    case "gardener-header":
      return "◆ gardener"
    case "gardener-body":
      return `  ${line.text}`
    case "friction":
      return `⚠ ${line.text}`
    case "system":
      return line.text
    case "activity":
      return line.text
    default:
      return ""
  }
}

function renderGardenerLinesStyled(
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

function formatNarrativeEvent(event: StackThreadMetaEvent, width: number): string[] {
  const payload = event.payload
  switch (event.type) {
    case "gardener.message": {
      const role = readString(payload.role) ?? "user"
      const text = readString(payload.message) ?? "(empty)"
      if (role === "gardener") {
        return [oneLine(`  gardener  ${text}`, width)]
      }
      const source = readString(payload.source)
      const prefix = source === "voice" ? "› you (voice)" : "› you"
      return [oneLine(`${prefix}  ${text}`, width)]
    }
    case "gardener.queued": {
      const source = readString(payload.source)
      const message = readString(payload.message) ?? "(empty)"
      const prefix = source === "voice" ? "› you (voice)" : "› you"
      return [oneLine(`${prefix}  ${message}`, width)]
    }
    case "gardener.routed":
      return [
        oneLine(
          `  gardener  routed → ${readString(payload.message) ?? "worker"}`,
          width,
        ),
      ]
    case "gardener.dispatched":
      return [
        oneLine(
          `  gardener  dispatch · ${readString(payload.kind) ?? "route"} · ${readString(payload.message) ?? ""}`,
          width,
        ),
      ]
    case "gardener.garden_updated":
      return [oneLine(`  gardener  thread garden updated`, width)]
    case "gardener.workspace_updated":
      return [oneLine(`  gardener  workspace garden updated`, width)]
    case "gardener.maintenance_pass":
      return [oneLine(`  gardener  maintenance pass`, width)]
    case "gardener.skill_suggest":
      return [
        oneLine(
          `  gardener  skill suggest · ${readString(payload.skill_id) ?? "?"} → worker ${readString(payload.worker_thread_id)?.slice(0, 8) ?? "?"}`,
          width,
        ),
      ]
    case "skills.registered":
      return [oneLine(`  gardener  registered skill ${readString(payload.skill_id) ?? "?"}`, width)]
    case "gardener.friction":
      return [oneLine(`  gardener  friction · ${readString(payload.summary) ?? readString(payload.pattern) ?? "note"}`, width)]
    default:
      return []
  }
}

function formatEventStreamLine(event: StackThreadMetaEvent, width: number): string {
  const time = shortTime(event.observed_at)
  const payload = event.payload
  const label = event.type.replace(/^gardener\./, "")
  const detail =
    readString(payload.message) ??
    readString(payload.summary) ??
    readString(payload.pattern) ??
    readString(payload.worker_thread_id) ??
    readString(payload.kind) ??
    ""
  return oneLine(`${time} ${label}${detail ? ` · ${detail}` : ""}`, width)
}

function styledNarrativeLine(line: string): TextChunk[] {
  if (line.startsWith("gardener ·")) return [fg(theme.synth.orangeDark)(line)]
  if (line.startsWith("› you")) return [fg(theme.synth.gold)(line)]
  if (line.startsWith("  gardener")) return [fg("#3fb950")(line)]
  if (line.startsWith("▸") || line.startsWith(" ")) return [fg(theme.synth.amber)(line)]
  if (line === "inbox") return [fg(theme.synth.orangeDark)(line)]
  if (line.startsWith("(no thread")) return [dim(fg(theme.fgMuted)(line))]
  return [fg(theme.fgPrimary)(line)]
}

function styledEventStreamLine(line: string): TextChunk[] {
  if (line.startsWith("(no events")) return [dim(fg(theme.fgMuted)(line))]
  if (line.includes(" friction") || line.includes(" queued")) return [fg(theme.synth.amber)(line)]
  if (line.includes(" routed") || line.includes(" dispatched") || line.includes(" garden")) return [fg("#3fb950")(line)]
  return [fg(theme.fgSecondary)(line)]
}

function scrollWindow<T>(lines: T[], scrollOffset: number, visibleRows: number): T[] {
  if (visibleRows <= 0) return []
  const maxOffset = Math.max(0, lines.length - visibleRows)
  const offset = Math.min(Math.max(0, scrollOffset), maxOffset)
  return lines.slice(offset, offset + visibleRows)
}

function normalizeChatBody(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/(?<=\S)\n(?=\S)/g, " ")
    .trim()
}

function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [text.trim()]
  const normalized = normalizeChatBody(text).replace(/\t/g, "  ")
  const paragraphs = normalized.split("\n")
  const lines: string[] = []
  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      continue
    }
    let current = ""
    for (const word of words) {
      if (word.length > width) {
        if (current) {
          lines.push(current)
          current = ""
        }
        let rest = word
        while (rest.length > width) {
          lines.push(rest.slice(0, width))
          rest = rest.slice(width)
        }
        current = rest
        continue
      }
      const candidate = current ? `${current} ${word}` : word
      if (candidate.length <= width) {
        current = candidate
      } else {
        if (current) lines.push(current)
        current = word
      }
    }
    if (current) lines.push(current)
  }
  return lines.length > 0 ? lines : ["(empty)"]
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
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
