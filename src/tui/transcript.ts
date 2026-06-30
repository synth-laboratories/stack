import { StyledText, bold, dim, fg, type TextChunk } from "@opentui/core"
import { randomUUID } from "node:crypto"
import type { CodexRateLimitsSnapshot } from "../codex/rate-limits.js"
import { parseRateLimitsFromCodexStdoutLine, parseRateLimitsFromEvent } from "../codex/rate-limits.js"
import { harnessSpeakerLabel } from "../harness.js"
import { readUsageFromCodexEvent } from "../session.js"
import { stackTuiTheme as theme } from "./theme.js"
import {
  applyMultiAgentFunctionOutput,
  isMultiAgentToolName,
  parseMultiAgentFunctionCall,
  subagentDisplayName,
  subagentDurationSeconds,
  subagentStatusLabel,
  upsertSubagentLog,
  type MultiAgentCallMeta,
  type SubagentLog,
} from "./subagents.js"

export type ToolLog = {
  id: string
  name: string
  status: string
  command?: string
  output?: string
  stdout?: string
  stderr?: string
  exitCode?: number | null
  startedAt?: string
  finishedAt?: string
}

export type TranscriptBlock =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "thinking"; text: string; live?: boolean; startedAt?: string; finishedAt?: string }
  | { id: string; kind: "tool"; toolId: string }
  | {
      id: string
      kind: "tool_group"
      toolIds: string[]
      live?: boolean
      startedAt?: string
      finishedAt?: string
    }
  | { id: string; kind: "agent"; text: string }
  | { id: string; kind: "stack"; text: string }
  | { id: string; kind: "subagent"; subagentId: string }
  | {
      id: string
      kind: "subagent_group"
      subagentIds: string[]
      live?: boolean
      startedAt?: string
      finishedAt?: string
    }

export type TranscriptViewport = {
  lines: number
  columns: number
  pageLines: number
}

export type TranscriptRenderOptions = {
  expandedBlockIds: ReadonlySet<string>
  showDetails: boolean
  liveThinkingText?: string
  running: boolean
  spinnerFrame: number
  /** Codex/opencode executable or full command — drives agent speaker label. */
  harnessCommand?: string
}

export type CodexLineResult = {
  usage?: {
    inputTokens?: number
    cachedInputTokens?: number
    outputTokens?: number
    reasoningOutputTokens?: number
  }
  tool?: ToolLog
  thinking?: string
  agentText?: string
  stackText?: string
  turnStarted?: boolean
  turnCompleted?: boolean
  threadId?: string
  rateLimits?: CodexRateLimitsSnapshot
  multiAgentCall?: MultiAgentCallMeta & { callId: string }
  multiAgentOutput?: { callId: string; output: string; finishedAt: string }
  subagent?: SubagentLog
}

export function parseCodexJsonLine(line: string): CodexLineResult | undefined {
  const rateLimits = parseRateLimitsFromCodexStdoutLine(line)
  let event: unknown
  try {
    event = JSON.parse(line)
  } catch {
    return rateLimits ? { rateLimits } : undefined
  }
  const parsed = parseCodexEvent(event)
  if (parsed && rateLimits) return { ...parsed, rateLimits }
  return parsed ?? (rateLimits ? { rateLimits } : undefined)
}

export function appendUserBlock(blocks: TranscriptBlock[], text: string): void {
  blocks.push({ id: randomUUID(), kind: "user", text: text.trim() || "(empty)" })
}

export function appendStackBlock(blocks: TranscriptBlock[], text: string): void {
  blocks.push({ id: randomUUID(), kind: "stack", text })
}

export function applyCodexLine(
  blocks: TranscriptBlock[],
  toolLogs: ToolLog[],
  subagentLogs: SubagentLog[],
  liveThinkingId: { current?: string },
  liveToolGroupId: { current?: string },
  liveSubagentGroupId: { current?: string },
  multiAgentCalls: Map<string, MultiAgentCallMeta & { callId: string }>,
  turnStartedAt: { current?: string },
  line: string,
): CodexLineResult | undefined {
  const rendered = parseCodexJsonLine(line)
  if (!rendered) return undefined

  if (rendered.turnStarted) {
    turnStartedAt.current = new Date().toISOString()
    liveToolGroupId.current = undefined
    liveSubagentGroupId.current = undefined
    const id = randomUUID()
    liveThinkingId.current = id
    blocks.push({ id, kind: "thinking", text: "…", live: true, startedAt: turnStartedAt.current })
  }

  if (rendered.thinking !== undefined) {
    updateLiveThinking(blocks, liveThinkingId.current, rendered.thinking, turnStartedAt.current)
  }

  if (rendered.multiAgentCall) {
    multiAgentCalls.set(rendered.multiAgentCall.callId, rendered.multiAgentCall)
    const subagent = parseMultiAgentFunctionCall(
      rendered.multiAgentCall.toolName,
      rendered.multiAgentCall.callId,
      rendered.multiAgentCall.arguments,
      rendered.multiAgentCall.startedAt,
    )
    if (subagent) {
      upsertSubagentLog(subagentLogs, subagent)
      noteSubagentInLiveGroup(blocks, liveSubagentGroupId, subagent.id, turnStartedAt.current)
      rendered.subagent = subagent
    }
  }

  if (rendered.multiAgentOutput) {
    const meta = multiAgentCalls.get(rendered.multiAgentOutput.callId)
    if (meta) {
      const beforeIds = subagentLogs.map((entry) => entry.id)
      applyMultiAgentFunctionOutput(
        subagentLogs,
        meta.toolName,
        rendered.multiAgentOutput.callId,
        rendered.multiAgentOutput.output,
        rendered.multiAgentOutput.finishedAt,
      )
      syncSubagentGroupIds(blocks, liveSubagentGroupId.current, beforeIds, subagentLogs)
      const touched = subagentLogs.find(
        (entry) => entry.spawnCallId === rendered.multiAgentOutput?.callId || beforeIds.includes(entry.id),
      )
      if (touched) rendered.subagent = touched
    } else if (rendered.tool) {
      upsertToolLog(toolLogs, rendered.tool)
      noteToolInLiveGroup(blocks, liveToolGroupId, rendered.tool.id, turnStartedAt.current)
    }
  } else if (rendered.tool) {
    if (!isMultiAgentToolName(rendered.tool.name)) {
      upsertToolLog(toolLogs, rendered.tool)
      noteToolInLiveGroup(blocks, liveToolGroupId, rendered.tool.id, turnStartedAt.current)
    }
  }

  if (rendered.agentText) {
    finalizeLiveToolGroup(blocks, liveToolGroupId)
    finalizeLiveSubagentGroup(blocks, liveSubagentGroupId)
    const last = blocks.at(-1)
    if (last?.kind === "agent") {
      last.text = rendered.agentText
    } else {
      blocks.push({ id: randomUUID(), kind: "agent", text: rendered.agentText })
    }
  }

  if (rendered.stackText) {
    finalizeLiveToolGroup(blocks, liveToolGroupId)
    finalizeLiveSubagentGroup(blocks, liveSubagentGroupId)
    appendStackBlock(blocks, rendered.stackText)
  }

  if (rendered.turnCompleted) {
    finalizeLiveThinking(blocks, liveThinkingId)
    finalizeLiveToolGroup(blocks, liveToolGroupId)
    finalizeLiveSubagentGroup(blocks, liveSubagentGroupId)
    turnStartedAt.current = undefined
  }

  return rendered
}

export function renderBlocksToText(
  blocks: readonly TranscriptBlock[],
  toolLogs: readonly ToolLog[],
  subagentLogs: readonly SubagentLog[],
  viewport: TranscriptViewport,
  options: TranscriptRenderOptions,
): string {
  const lines = blocksToLines(blocks, toolLogs, subagentLogs, viewport.columns, options)
  return lines.join("\n")
}

export type TranscriptLinePart = "label" | "body" | "inline" | "blank" | "meta"

export type AnnotatedTranscriptLine = {
  kind: TranscriptBlock["kind"] | "meta"
  part: TranscriptLinePart
  text: string
}

export function renderTranscriptView(
  blocks: readonly TranscriptBlock[],
  toolLogs: readonly ToolLog[],
  subagentLogs: readonly SubagentLog[],
  viewport: TranscriptViewport,
  options: TranscriptRenderOptions,
  scrollOffset: number,
): string {
  const annotated = blocksToAnnotatedLines(blocks, toolLogs, subagentLogs, viewport.columns, options)
  const { visible, offset } = sliceAnnotatedTranscript(annotated, viewport.lines, scrollOffset)
  const position = offset > 0 ? `\n[scroll ${offset} lines from live | End jumps to bottom]` : ""
  return `${visible.map((line) => line.text).join("\n")}${position}`
}

export function renderTranscriptStyledView(
  blocks: readonly TranscriptBlock[],
  toolLogs: readonly ToolLog[],
  subagentLogs: readonly SubagentLog[],
  viewport: TranscriptViewport,
  options: TranscriptRenderOptions,
  scrollOffset: number,
): StyledText {
  const annotated = blocksToAnnotatedLines(blocks, toolLogs, subagentLogs, viewport.columns, options)
  const { visible, offset } = sliceAnnotatedTranscript(annotated, viewport.lines, scrollOffset)
  const chunks: TextChunk[] = []
  for (const line of visible) {
    chunks.push(...styleAnnotatedTranscriptLine(line))
  }
  if (offset > 0) {
    chunks.push(
      dim(fg(theme.transcript.meta)(`\n[scroll ${offset} lines from live | End jumps to bottom]`)),
    )
  }
  return new StyledText(chunks)
}

export function maxTranscriptScrollOffset(
  blocks: readonly TranscriptBlock[],
  toolLogs: readonly ToolLog[],
  subagentLogs: readonly SubagentLog[],
  columns: number,
  options: TranscriptRenderOptions,
  viewportLines: number,
): number {
  const lines = blocksToLines(blocks, toolLogs, subagentLogs, columns, options)
  return Math.max(0, lines.length - viewportLines)
}

export function countNewTranscriptLines(
  block: TranscriptBlock,
  toolLogs: readonly ToolLog[],
  subagentLogs: readonly SubagentLog[],
  columns: number,
  options: TranscriptRenderOptions,
): number {
  return blockToLines(block, toolLogs, subagentLogs, columns, options).length
}

export function blocksFromTurnStdout(
  prompt: string,
  stdout: string,
): { blocks: TranscriptBlock[]; tools: ToolLog[]; subagents: SubagentLog[] } {
  const blocks: TranscriptBlock[] = []
  const tools: ToolLog[] = []
  const subagents: SubagentLog[] = []
  const liveThinkingId: { current?: string } = {}
  const liveToolGroupId: { current?: string } = {}
  const liveSubagentGroupId: { current?: string } = {}
  const multiAgentCalls = new Map<string, MultiAgentCallMeta & { callId: string }>()
  const turnStartedAt: { current?: string } = {}
  appendUserBlock(blocks, prompt)
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue
    applyCodexLine(
      blocks,
      tools,
      subagents,
      liveThinkingId,
      liveToolGroupId,
      liveSubagentGroupId,
      multiAgentCalls,
      turnStartedAt,
      line,
    )
  }
  finalizeLiveThinking(blocks, liveThinkingId)
  finalizeLiveToolGroup(blocks, liveToolGroupId)
  finalizeLiveSubagentGroup(blocks, liveSubagentGroupId)
  return { blocks, tools, subagents }
}

function blocksToLines(
  blocks: readonly TranscriptBlock[],
  toolLogs: readonly ToolLog[],
  subagentLogs: readonly SubagentLog[],
  columns: number,
  options: TranscriptRenderOptions,
): string[] {
  return blocksToAnnotatedLines(blocks, toolLogs, subagentLogs, columns, options).map((line) => line.text)
}

function blocksToAnnotatedLines(
  blocks: readonly TranscriptBlock[],
  toolLogs: readonly ToolLog[],
  subagentLogs: readonly SubagentLog[],
  columns: number,
  options: TranscriptRenderOptions,
): AnnotatedTranscriptLine[] {
  const lines: AnnotatedTranscriptLine[] = []
  for (const block of blocks) {
    lines.push(...blockToAnnotatedLines(block, toolLogs, subagentLogs, columns, options))
  }
  const hasLiveThinkingBlock =
    options.running && blocks.some((block) => block.kind === "thinking" && block.live)
  if (options.running && options.liveThinkingText && !hasLiveThinkingBlock) {
    lines.push(
      ...annotatePlainLines(
        "thinking",
        wrapLine(`⎿ thinking ▸ ${spinner(options.spinnerFrame)} ${cleanThinkingText(options.liveThinkingText)}`, columns),
        columns,
        options,
        { kind: "thinking", expanded: false, inlineOnly: true },
      ),
    )
    lines.push({ kind: "thinking", part: "blank", text: "" })
  }
  return lines.length > 0 ? lines : [{ kind: "meta", part: "meta", text: " " }]
}

function blockToAnnotatedLines(
  block: TranscriptBlock,
  toolLogs: readonly ToolLog[],
  subagentLogs: readonly SubagentLog[],
  columns: number,
  options: TranscriptRenderOptions,
): AnnotatedTranscriptLine[] {
  const expanded = options.showDetails || options.expandedBlockIds.has(block.id)
  const plainLines = blockToLines(block, toolLogs, subagentLogs, columns, options)
  return annotatePlainLines(block.kind, plainLines, columns, options, {
    kind: block.kind,
    expanded,
    inlineOnly: isInlineTranscriptBlock(block, expanded, plainLines),
  })
}

function annotatePlainLines(
  kind: TranscriptBlock["kind"],
  plainLines: string[],
  columns: number,
  options: TranscriptRenderOptions,
  shape: { kind: TranscriptBlock["kind"]; expanded: boolean; inlineOnly: boolean },
): AnnotatedTranscriptLine[] {
  const annotated: AnnotatedTranscriptLine[] = []
  let contentLineIndex = 0
  for (const text of plainLines) {
    if (text === "") {
      annotated.push({ kind, part: "blank", text: "" })
      continue
    }
    let part: TranscriptLinePart
    if (shape.inlineOnly) {
      part = "inline"
    } else if (contentLineIndex === 0) {
      part = "label"
    } else {
      part = "body"
    }
    annotated.push({ kind, part, text })
    contentLineIndex += 1
  }
  return annotated
}

function isInlineTranscriptBlock(
  block: TranscriptBlock,
  expanded: boolean,
  plainLines: string[],
): boolean {
  if (expanded) return false
  if (block.kind !== "thinking" && block.kind !== "tool" && block.kind !== "tool_group" && block.kind !== "subagent" && block.kind !== "subagent_group") return false
  return plainLines.filter((line) => line !== "").length === 1
}

function sliceAnnotatedTranscript(
  annotated: readonly AnnotatedTranscriptLine[],
  viewportLines: number,
  scrollOffset: number,
): { visible: AnnotatedTranscriptLine[]; offset: number } {
  const maxOffset = Math.max(0, annotated.length - viewportLines)
  const offset = Math.min(scrollOffset, maxOffset)
  const end = annotated.length - offset
  const start = Math.max(0, end - viewportLines)
  return { visible: annotated.slice(start, end), offset }
}

function styleAnnotatedTranscriptLine(line: AnnotatedTranscriptLine): TextChunk[] {
  const palette = theme.transcript
  const text = line.text.endsWith("\n") ? line.text : `${line.text}\n`
  if (line.part === "blank") return [fg(theme.fgPrimary)("\n")]

  switch (line.kind) {
    case "user":
      if (line.part === "label") return [bold(fg(palette.userLabel)(text))]
      return [fg(palette.userBody)(text)]
    case "agent":
      if (line.part === "label") return [bold(fg(palette.agentLabel)(text))]
      return [fg(palette.agentBody)(text)]
    case "thinking":
      if (line.part === "inline") return [dim(fg(palette.planningLabel)(text))]
      if (line.part === "label") return [bold(fg(palette.planningLabel)(text))]
      return [dim(fg(palette.planningBody)(text))]
    case "tool":
    case "tool_group":
      if (line.part === "inline") return [dim(fg(palette.toolLabel)(text))]
      if (line.part === "label") return [dim(fg(palette.toolLabel)(text))]
      return [dim(fg(palette.toolBody)(text))]
    case "stack":
      if (line.part === "label") return [dim(fg(palette.stackLabel)(text))]
      return [dim(fg(palette.stackBody)(text))]
    case "subagent":
    case "subagent_group":
      if (line.part === "inline") return [dim(fg(palette.subagentLabel)(text))]
      if (line.part === "label") return [dim(fg(palette.subagentLabel)(text))]
      return [dim(fg(palette.subagentBody)(text))]
    case "meta":
      return [dim(fg(palette.meta)(text))]
    default:
      return [fg(theme.fgPrimary)(text)]
  }
}

function blockToLines(
  block: TranscriptBlock,
  toolLogs: readonly ToolLog[],
  subagentLogs: readonly SubagentLog[],
  columns: number,
  options: TranscriptRenderOptions,
): string[] {
  const expanded = options.showDetails || options.expandedBlockIds.has(block.id)
  switch (block.kind) {
    case "user":
      return sectionLines("›", ` ${block.text}`, columns, true)
    case "thinking":
      return renderThinkingBlock(block, columns, expanded, options)
    case "tool": {
      const tool = toolLogs.find((entry) => entry.id === block.toolId)
      if (!tool) return sectionLines("tool", "…", columns)
      return renderToolBlock(tool, columns, expanded)
    }
    case "tool_group":
      return renderToolGroupBlock(block, toolLogs, columns, expanded, options)
    case "subagent": {
      const subagent = subagentLogs.find((entry) => entry.id === block.subagentId)
      if (!subagent) return sectionLines("↳ agent", "…", columns)
      return renderSubagentBlock(subagent, columns, expanded)
    }
    case "subagent_group":
      return renderSubagentGroupBlock(block, subagentLogs, columns, expanded, options)
    case "agent":
      return sectionLines(harnessSpeakerLabel(undefined, options.harnessCommand), indent(block.text), columns)
    case "stack":
      return sectionLines("⎿ stack", indent(block.text), columns)
    default:
      return []
  }
}

function renderThinkingBlock(
  block: Extract<TranscriptBlock, { kind: "thinking" }>,
  columns: number,
  expanded: boolean,
  options: TranscriptRenderOptions,
): string[] {
  const duration = thinkingDurationLabel(block)
  const label = block.live && options.running
    ? `◆ Thinking ${spinner(options.spinnerFrame)}`
    : `◆ Thought${duration}${expanded ? " ▾" : ""}`
  const text = cleanThinkingText(block.text)
  const placeholder = !text || text === "…"
  if (!expanded || placeholder) {
    const summary = placeholder ? "" : ` ${truncateInline(text, 96)}`
    return sectionLines(label.trim(), summary.trim(), columns, true)
  }
  return sectionLines(label, indent(text), columns)
}

function renderToolGroupBlock(
  block: Extract<TranscriptBlock, { kind: "tool_group" }>,
  toolLogs: readonly ToolLog[],
  columns: number,
  expanded: boolean,
  options: TranscriptRenderOptions,
): string[] {
  const tools = block.toolIds
    .map((toolId) => toolLogs.find((entry) => entry.id === toolId))
    .filter((tool): tool is ToolLog => Boolean(tool))
  if (tools.length === 0) return []

  const duration = toolGroupDurationLabel(block)
  const callLabel = `${tools.length} call${tools.length === 1 ? "" : "s"}`
  const names = tools.map((tool) => toolDisplayName(tool)).join(" · ")
  const label = block.live && options.running
    ? `⎿ tools ▸ ${spinner(options.spinnerFrame)} ${callLabel}`
    : `⎿ tools ${expanded ? "▾" : "▸"}${duration} · ${callLabel}`

  if (!expanded) {
    const summary = names ? ` ${truncateInline(names, Math.max(16, columns - label.length - 4))}` : ""
    return sectionLines(label.trim(), summary.trim(), columns, true)
  }

  const body = tools
    .map((tool) => {
      const parts = [formatToolSummary(tool)]
      if (tool.command) parts.push(indent(tool.command))
      const output = toolOutputLine(tool)
      if ((tool.stdout ?? tool.output ?? "").trim()) parts.push(output)
      return parts.join("\n")
    })
    .join("\n\n")

  return sectionLines(label, body, columns)
}

function renderToolBlock(tool: ToolLog, columns: number, expanded: boolean): string[] {
  const summary = formatToolSummary(tool)
  if (!expanded) return sectionLines(summary, "", columns, true)
  const body = [
    tool.command ? indent(tool.command) : "",
    toolOutputLine(tool),
  ]
    .filter(Boolean)
    .join("\n")
  return sectionLines(summary, body, columns)
}

function renderSubagentBlock(subagent: SubagentLog, columns: number, expanded: boolean): string[] {
  const summary = formatSubagentSummary(subagent)
  if (!expanded) {
    const preview = subagent.message ? ` ${truncateInline(subagent.message.replace(/\s+/g, " "), 72)}` : ""
    return sectionLines(summary.trim(), preview.trim(), columns, true)
  }
  const body = [
    subagent.message ? indent(subagent.message) : "",
    subagent.resultText ? indent(truncateInline(subagent.resultText.replace(/\s+/g, " "), 240)) : "",
    subagent.errorText ? indent(truncateInline(subagent.errorText.replace(/\s+/g, " "), 240)) : "",
  ]
    .filter(Boolean)
    .join("\n")
  return sectionLines(summary, body, columns)
}

function renderSubagentGroupBlock(
  block: Extract<TranscriptBlock, { kind: "subagent_group" }>,
  subagentLogs: readonly SubagentLog[],
  columns: number,
  expanded: boolean,
  options: TranscriptRenderOptions,
): string[] {
  const subagents = block.subagentIds
    .map((subagentId) => subagentLogs.find((entry) => entry.id === subagentId))
    .filter((subagent): subagent is SubagentLog => Boolean(subagent))
  if (subagents.length === 0) return []

  const duration = subagentGroupDurationLabel(block)
  const countLabel = `${subagents.length} agent${subagents.length === 1 ? "" : "s"}`
  const doneCount = subagents.filter((entry) => entry.status === "completed" || entry.status === "closed").length
  const runningCount = subagents.filter((entry) => entry.status === "running" || entry.status === "spawning").length
  const label = block.live && options.running
    ? `↳ agents ▸ ${spinner(options.spinnerFrame)} ${countLabel}`
    : `↳ agents ${expanded ? "▾" : "▸"}${duration} · ${countLabel}`

  if (!expanded) {
    const summary = ` · ${doneCount} done · ${runningCount} active · ${subagents.map((entry) => subagentDisplayName(entry)).join(" · ")}`
    return sectionLines(label.trim(), truncateInline(summary, Math.max(16, columns - label.length - 4)), columns, true)
  }

  const body = subagents
    .map((subagent) => {
      const parts = [formatSubagentSummary(subagent)]
      if (subagent.message) parts.push(indent(subagent.message))
      if (subagent.resultText) parts.push(indent(truncateInline(subagent.resultText.replace(/\s+/g, " "), 240)))
      if (subagent.errorText) parts.push(indent(truncateInline(subagent.errorText.replace(/\s+/g, " "), 240)))
      return parts.join("\n")
    })
    .join("\n\n")

  return sectionLines(label, body, columns)
}

export function formatSubagentSummary(subagent: SubagentLog): string {
  const name = subagentDisplayName(subagent)
  const duration = subagentDurationSeconds(subagent)
  const status = subagentStatusLabel(subagent.status)
  const durationText = duration === undefined ? "…" : `${duration}s`
  const role = subagent.agentType && subagent.agentType !== name ? `${subagent.agentType} · ` : ""
  return `↳ agent  ${role}${name} · ${durationText} · ${status}`
}

export function formatToolSummary(tool: ToolLog): string {
  const name = toolDisplayName(tool)
  const duration = toolDurationSeconds(tool)
  const status = toolStatusLabel(tool)
  const durationText = duration === undefined ? "…" : `${duration}s`
  return `⎿ tool  ${name} · ${durationText} · ${status}`
}

function sectionLines(label: string, body: string, columns: number, inline = false): string[] {
  const lines: string[] = []
  if (inline && body) {
    lines.push(...wrapLine(`${label}${body}`, columns))
  } else {
    lines.push(...wrapLine(label, columns))
    if (body) lines.push(...wrapLine(body, columns))
  }
  lines.push("")
  return lines
}

function wrapLine(text: string, columns: number): string[] {
  const lines: string[] = []
  for (const rawLine of text.split("\n")) {
    const line = rawLine.length === 0 ? " " : rawLine
    for (let index = 0; index < line.length; index += columns) {
      lines.push(line.slice(index, index + columns))
    }
  }
  return lines.length > 0 ? lines : [" "]
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n")
}

function cleanThinkingText(text: string): string {
  return text.replace(/^thinking:\s*/i, "").trim()
}

function thinkingDurationLabel(block: Extract<TranscriptBlock, { kind: "thinking" }>): string {
  if (!block.startedAt) return ""
  const end = block.finishedAt ? new Date(block.finishedAt).getTime() : Date.now()
  const start = new Date(block.startedAt).getTime()
  const seconds = Math.max(0, (end - start) / 1000)
  if (!Number.isFinite(seconds) || seconds <= 0) return ""
  return ` for ${seconds.toFixed(1)}s`
}

function toolGroupDurationLabel(block: Extract<TranscriptBlock, { kind: "tool_group" }>): string {
  if (!block.startedAt) return ""
  const end = block.finishedAt ? new Date(block.finishedAt).getTime() : Date.now()
  const start = new Date(block.startedAt).getTime()
  const seconds = Math.max(0, (end - start) / 1000)
  if (!Number.isFinite(seconds) || seconds <= 0) return ""
  return `  ${seconds.toFixed(1)}s`
}

function subagentGroupDurationLabel(block: Extract<TranscriptBlock, { kind: "subagent_group" }>): string {
  if (!block.startedAt) return ""
  const end = block.finishedAt ? new Date(block.finishedAt).getTime() : Date.now()
  const start = new Date(block.startedAt).getTime()
  const seconds = Math.max(0, (end - start) / 1000)
  if (!Number.isFinite(seconds) || seconds <= 0) return ""
  return `  ${seconds.toFixed(1)}s`
}

function toolDurationSeconds(tool: ToolLog): number | undefined {
  if (!tool.startedAt || !tool.finishedAt) return undefined
  const elapsed = new Date(tool.finishedAt).getTime() - new Date(tool.startedAt).getTime()
  if (!Number.isFinite(elapsed) || elapsed < 0) return undefined
  return Math.round(elapsed / 100) / 10
}

function toolStatusLabel(tool: ToolLog): string {
  if (tool.status !== "completed") return "…"
  if (tool.exitCode === 0 || tool.exitCode === null) return "ok"
  return "fail"
}

function toolDisplayName(tool: ToolLog): string {
  if (tool.name === "command_execution") {
    if (tool.command) {
      const preview = tool.command.replace(/\s+/g, " ").trim()
      const match = preview.match(/(?:^|\s)(rg|grep|git|bun|npm|python\d*|uv|cargo|make|curl|sed|awk|zsh|bash|sh)\b/i)
      if (match?.[1]) return match[1].toLowerCase()
    }
    return "shell"
  }
  if (tool.command) {
    const preview = tool.command.replace(/\s+/g, " ").trim()
    const match = preview.match(/(?:^|\s)(rg|grep|git|bun|npm|python\d*|uv|cargo|make|curl|sed|awk|zsh|bash|sh)\b/i)
    if (match?.[1]) return match[1].toLowerCase()
    return truncateInline(preview, 18)
  }
  return tool.name
}

function toolOutputLine(tool: ToolLog): string {
  const output = (tool.stdout ?? tool.output ?? "").trim()
  if (!output) return indent("(empty)")
  return indent(truncateInline(output.replace(/\s+/g, " "), 240))
}

function spinner(frame: number): string {
  return ["|", "/", "-", "\\"][frame % 4] ?? "|"
}

function truncateInline(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`
}

function updateLiveThinking(
  blocks: TranscriptBlock[],
  thinkingId: string | undefined,
  thinking: string,
  startedAt?: string,
): void {
  if (!thinkingId) return
  const index = blocks.findIndex((block) => block.id === thinkingId && block.kind === "thinking")
  const text = cleanThinkingText(thinking) || "…"
  if (index < 0) {
    blocks.push({ id: thinkingId, kind: "thinking", text, live: true, startedAt })
    return
  }
  const current = blocks[index]
  if (current?.kind !== "thinking") return
  blocks[index] = { ...current, text, startedAt: current.startedAt ?? startedAt }
}

function finalizeLiveThinking(blocks: TranscriptBlock[], liveThinkingId: { current?: string }): void {
  if (!liveThinkingId.current) return
  const index = blocks.findIndex((block) => block.id === liveThinkingId.current && block.kind === "thinking")
  if (index >= 0) {
    const current = blocks[index]
    if (current?.kind === "thinking") {
      blocks[index] = { ...current, live: false, finishedAt: new Date().toISOString() }
    }
  }
  liveThinkingId.current = undefined
}

function noteToolInLiveGroup(
  blocks: TranscriptBlock[],
  liveToolGroupId: { current?: string },
  toolId: string,
  startedAt?: string,
): void {
  const now = startedAt ?? new Date().toISOString()
  if (!liveToolGroupId.current) {
    const id = randomUUID()
    liveToolGroupId.current = id
    blocks.push({ id, kind: "tool_group", toolIds: [toolId], live: true, startedAt: now })
    return
  }

  const index = blocks.findIndex((block) => block.id === liveToolGroupId.current && block.kind === "tool_group")
  if (index < 0) {
    const id = randomUUID()
    liveToolGroupId.current = id
    blocks.push({ id, kind: "tool_group", toolIds: [toolId], live: true, startedAt: now })
    return
  }

  const current = blocks[index]
  if (current?.kind !== "tool_group") return
  if (current.toolIds.includes(toolId)) return
  blocks[index] = {
    ...current,
    toolIds: [...current.toolIds, toolId],
    startedAt: current.startedAt ?? now,
  }
}

function finalizeLiveToolGroup(blocks: TranscriptBlock[], liveToolGroupId: { current?: string }): void {
  if (!liveToolGroupId.current) return
  const index = blocks.findIndex((block) => block.id === liveToolGroupId.current && block.kind === "tool_group")
  if (index >= 0) {
    const current = blocks[index]
    if (current?.kind === "tool_group") {
      if (current.toolIds.length === 0) {
        blocks.splice(index, 1)
      } else {
        blocks[index] = { ...current, live: false, finishedAt: new Date().toISOString() }
      }
    }
  }
  liveToolGroupId.current = undefined
}

function noteSubagentInLiveGroup(
  blocks: TranscriptBlock[],
  liveSubagentGroupId: { current?: string },
  subagentId: string,
  startedAt?: string,
): void {
  const now = startedAt ?? new Date().toISOString()
  if (!liveSubagentGroupId.current) {
    const id = randomUUID()
    liveSubagentGroupId.current = id
    blocks.push({ id, kind: "subagent_group", subagentIds: [subagentId], live: true, startedAt: now })
    return
  }

  const index = blocks.findIndex((block) => block.id === liveSubagentGroupId.current && block.kind === "subagent_group")
  if (index < 0) {
    const id = randomUUID()
    liveSubagentGroupId.current = id
    blocks.push({ id, kind: "subagent_group", subagentIds: [subagentId], live: true, startedAt: now })
    return
  }

  const current = blocks[index]
  if (current?.kind !== "subagent_group") return
  if (current.subagentIds.includes(subagentId)) return
  blocks[index] = {
    ...current,
    subagentIds: [...current.subagentIds, subagentId],
    startedAt: current.startedAt ?? now,
  }
}

function finalizeLiveSubagentGroup(blocks: TranscriptBlock[], liveSubagentGroupId: { current?: string }): void {
  if (!liveSubagentGroupId.current) return
  const index = blocks.findIndex((block) => block.id === liveSubagentGroupId.current && block.kind === "subagent_group")
  if (index >= 0) {
    const current = blocks[index]
    if (current?.kind === "subagent_group") {
      if (current.subagentIds.length === 0) {
        blocks.splice(index, 1)
      } else {
        blocks[index] = { ...current, live: false, finishedAt: new Date().toISOString() }
      }
    }
  }
  liveSubagentGroupId.current = undefined
}

function syncSubagentGroupIds(
  blocks: TranscriptBlock[],
  groupId: string | undefined,
  beforeIds: readonly string[],
  subagentLogs: readonly SubagentLog[],
): void {
  if (!groupId) return
  const index = blocks.findIndex((block) => block.id === groupId && block.kind === "subagent_group")
  if (index < 0) return
  const current = blocks[index]
  if (current?.kind !== "subagent_group") return
  const idMap = new Map<string, string>()
  for (const beforeId of beforeIds) {
    const entry =
      subagentLogs.find((subagent) => subagent.id === beforeId) ??
      subagentLogs.find((subagent) => subagent.spawnCallId === beforeId)
    if (entry) idMap.set(beforeId, entry.id)
  }
  blocks[index] = {
    ...current,
    subagentIds: current.subagentIds.map((subagentId) => idMap.get(subagentId) ?? subagentId),
  }
}

function upsertToolBlock(blocks: TranscriptBlock[], toolId: string): void {
  const index = blocks.findIndex((block) => block.kind === "tool" && block.toolId === toolId)
  if (index < 0) blocks.push({ id: randomUUID(), kind: "tool", toolId })
}

export function upsertToolLog(tools: ToolLog[], incoming: ToolLog): void {
  const now = new Date().toISOString()
  const index = tools.findIndex((tool) => tool.id === incoming.id)
  if (index < 0) {
    tools.push({
      ...incoming,
      startedAt: incoming.status === "completed" ? now : incoming.startedAt ?? now,
      finishedAt: incoming.status === "completed" ? incoming.finishedAt ?? now : incoming.finishedAt,
    })
    return
  }
  const previous = tools[index]
  tools[index] = {
    ...previous,
    ...incoming,
    startedAt: previous?.startedAt ?? incoming.startedAt ?? now,
    finishedAt: incoming.status === "completed" ? incoming.finishedAt ?? now : previous?.finishedAt,
  }
}

function parseCodexEvent(event: unknown): CodexLineResult | undefined {
  const record = asRecord(event)
  if (!record) return undefined

  const payload = asRecord(record.payload)
  if ((readString(record.type) === "response_item" || readString(record.type) === "event_msg") && payload) {
    return parseCodexEvent(payload)
  }

  const eventType = readString(record.type) ?? ""
  const item = asRecord(record.item)
  if (item) return parseCodexEvent(item)

  if (eventType === "thread.started") {
    return { threadId: readString(record.thread_id) ?? undefined }
  }
  if (eventType === "turn.started") return { turnStarted: true, thinking: "…" }
  if (eventType === "turn.completed") return { turnCompleted: true, usage: readUsageFromCodexEvent(record) }

  const payloadType = payload ? readString(payload.type) ?? "" : ""
  const type = payloadType || eventType

  if (payloadType === "token_count" || type === "token_count") {
    const rateLimits = parseRateLimitsFromEvent(record)
    const usage = readUsageFromCodexEvent(record)
    if (rateLimits || usage) return { rateLimits, usage }
  }

  if (readString(record.role) === "user" || readString(payload?.role) === "user") return {}

  if (type === "command_execution") {
    const tool = readCommandTool(record)
    return {
      tool,
      thinking: tool.status === "completed" ? undefined : `running ${toolDisplayName(tool)}`,
    }
  }

  const thinking = readThinkingPreview(record, payload, type)
  if (thinking) return { thinking }

  if (type === "function_call") {
    const name = readString(record.name) ?? readString(payload?.name) ?? "tool"
    const callId = readString(record.call_id) ?? readString(record.id) ?? randomUUID()
    const args = readString(record.arguments) ?? readString(payload?.arguments)
    if (isMultiAgentToolName(name)) {
      return {
        multiAgentCall: {
          toolName: name,
          callId,
          arguments: args,
          startedAt: new Date().toISOString(),
        },
        thinking: name === "spawn_agent" ? "spawning subagent" : `running ${name}`,
      }
    }
    const tool: ToolLog = {
      id: callId,
      name,
      status: "in_progress",
      command: args,
    }
    return { tool, thinking: `running ${toolDisplayName(tool)}` }
  }

  if (type === "function_call_output") {
    const output = readString(record.output) ?? readString(payload?.output) ?? ""
    const callId = readString(record.call_id) ?? randomUUID()
    return {
      multiAgentOutput: {
        callId,
        output,
        finishedAt: new Date().toISOString(),
      },
      tool: {
        id: callId,
        name: "tool",
        status: "completed",
        output,
        stdout: output,
        exitCode: 0,
      },
    }
  }

  if (type.includes("command") || type.includes("tool") || type.includes("exec")) {
    const name = readString(record.name) ?? readString(payload?.name) ?? type
    const text = extractText(record) ?? extractText(payload)
    const tool: ToolLog = {
      id: readString(record.id) ?? randomUUID(),
      name,
      status: "in_progress",
      command: text,
    }
    return { tool, thinking: `running ${name}` }
  }

  if (type.includes("message") || type.includes("output_text") || type.includes("assistant") || type === "agent_message") {
    const text = extractText(record) ?? extractText(payload)
    return text ? { agentText: truncateDisplay(text, 4000) } : undefined
  }

  if (eventType.includes("error") || type.includes("error")) {
    const text = extractText(record) ?? extractText(payload) ?? JSON.stringify(record)
    return { stackText: truncateDisplay(text, 1200) }
  }

  return undefined
}

function readCommandTool(record: Record<string, unknown>): ToolLog {
  return {
    id: readString(record.id) ?? readString(record.call_id) ?? readString(record.command) ?? randomUUID(),
    name: "command_execution",
    status: readString(record.status) ?? "completed",
    command: readString(record.command),
    output: readString(record.aggregated_output),
    stdout: readString(record.stdout) ?? readString(record.aggregated_output),
    stderr: readString(record.stderr),
    exitCode: readNullableNumber(record.exit_code),
  }
}

function readThinkingPreview(
  record: Record<string, unknown>,
  payload: Record<string, unknown> | undefined,
  type: string,
): string | undefined {
  const eventName = type.toLowerCase()
  if (
    !eventName.includes("reason") &&
    !eventName.includes("thought") &&
    !eventName.includes("thinking") &&
    !eventName.includes("summary")
  ) {
    return undefined
  }
  const text = extractText(record) ?? extractText(payload)
  return text ? cleanThinkingText(text) : "…"
}

function extractText(value: unknown): string | undefined {
  if (typeof value === "string") return value
  const record = asRecord(value)
  if (!record) {
    if (Array.isArray(value)) {
      const parts = value.map(extractText).filter((part): part is string => Boolean(part))
      return parts.length ? parts.join("\n") : undefined
    }
    return undefined
  }
  if (typeof record.text === "string") return record.text
  if (typeof record.content === "string") return record.content
  if (Array.isArray(record.content)) {
    const parts = record.content.map(extractText).filter((part): part is string => Boolean(part))
    return parts.length ? parts.join("\n") : undefined
  }
  return undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}

function readNullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null
  return readNumber(value)
}

function truncateDisplay(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}\n...(truncated ${value.length - maxLength} chars)`
}
