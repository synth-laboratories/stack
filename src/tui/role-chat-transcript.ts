import { randomUUID } from "node:crypto"
import type { StackMonitorSnapshot } from "../monitor.js"
import type { StackThreadMetaEvent } from "../thread-events.js"
import { gardenerThreadEvents } from "./gardener-thread.js"
import { monitorThreadEvents } from "./monitor-thread.js"
import type { SubagentLog } from "./subagents.js"
import {
  appendStackBlock,
  appendUserBlock,
  maxTranscriptScrollOffset,
  renderTranscriptStyledView,
  type ToolLog,
  type TranscriptBlock,
  type TranscriptRenderOptions,
  type TranscriptViewport,
} from "./transcript.js"

const GARDENER_CHAT_EVENT_TYPES = new Set(["gardener.message", "gardener.friction"])

const MONITOR_CHAT_EVENT_TYPES = new Set([
  "monitor.operator_message",
  "monitor.chat.reply",
  "monitor.summary",
  "monitor.steer",
  "monitor.skill_context_push",
  "monitor.error",
  "monitor.wake",
])

export function blocksFromGardenerChatEvents(events: StackThreadMetaEvent[]): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = []
  const chatEvents = gardenerThreadEvents(events)
    .filter((event) => GARDENER_CHAT_EVENT_TYPES.has(event.type))
    .sort((left, right) => left.observed_at.localeCompare(right.observed_at))

  for (const event of chatEvents) {
    appendGardenerChatEvent(blocks, event)
  }
  return blocks
}

export function blocksFromMonitorChatEvents(events: StackThreadMetaEvent[]): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = []
  const chatEvents = monitorThreadEvents(events)
    .filter((event) => MONITOR_CHAT_EVENT_TYPES.has(event.type))
    .sort((left, right) => left.observed_at.localeCompare(right.observed_at))

  for (const event of chatEvents) {
    appendMonitorChatEvent(blocks, event)
  }
  return blocks
}

export function mergeRoleChatBlocks(
  persisted: readonly TranscriptBlock[],
  live: readonly TranscriptBlock[],
): TranscriptBlock[] {
  if (live.length === 0) return [...persisted]
  return [...persisted, ...live]
}

export function gardenerTranscriptRenderOptions(
  base: TranscriptRenderOptions,
  running: boolean,
  liveThinking?: string,
): TranscriptRenderOptions {
  return {
    ...base,
    running,
    liveThinkingText: liveThinking,
    agentSpeakerLabel: "Gardener",
  }
}

export function monitorTranscriptRenderOptions(
  base: TranscriptRenderOptions,
  snapshot: StackMonitorSnapshot,
): TranscriptRenderOptions {
  return {
    ...base,
    running: snapshot.status === "running",
    agentSpeakerLabel: "Monitor",
  }
}

export function renderRoleChatTranscriptStyled(
  blocks: readonly TranscriptBlock[],
  toolLogs: readonly ToolLog[],
  subagentLogs: readonly SubagentLog[],
  viewport: TranscriptViewport,
  options: TranscriptRenderOptions,
  scrollOffset: number,
) {
  return renderTranscriptStyledView(blocks, toolLogs, subagentLogs, viewport, options, scrollOffset)
}

export function roleChatTranscriptLineCount(
  blocks: readonly TranscriptBlock[],
  toolLogs: readonly ToolLog[],
  subagentLogs: readonly SubagentLog[],
  columns: number,
  options: TranscriptRenderOptions,
): number {
  return maxTranscriptScrollOffset(blocks, toolLogs, subagentLogs, columns, options, 1) + 1
}

function appendGardenerChatEvent(blocks: TranscriptBlock[], event: StackThreadMetaEvent): void {
  const payload = event.payload
  switch (event.type) {
    case "gardener.message": {
      const role = readString(payload.role) ?? "user"
      const text = readString(payload.message) ?? "(empty)"
      if (role === "gardener") {
        blocks.push({ id: randomUUID(), kind: "agent", text })
        return
      }
      const source = readString(payload.source)
      const prefix = source === "voice" ? "(voice) " : ""
      appendUserBlock(blocks, `${prefix}${text}`)
      return
    }
    case "gardener.friction":
      appendStackBlock(
        blocks,
        `friction · ${readString(payload.summary) ?? readString(payload.pattern) ?? "note"}`,
      )
      return
    default:
      return
  }
}

function appendMonitorChatEvent(blocks: TranscriptBlock[], event: StackThreadMetaEvent): void {
  const payload = event.payload
  switch (event.type) {
    case "monitor.operator_message":
      appendUserBlock(blocks, readString(payload.message) ?? "(empty)")
      return
    case "monitor.summary": {
      const summary = readString(payload.summary) ?? "(empty summary)"
      const severity = readString(payload.severity)
      const operatorUpdate = asRecord(payload.operator_update)
      const lines = [severity && severity !== "none" ? `${severity} · ${summary}` : summary]
      const workingOn = readString(operatorUpdate?.working_on)
      const progress = readString(operatorUpdate?.progress_note)
      const struggling = readString(operatorUpdate?.struggling_with)
      if (workingOn && !summary.includes(workingOn)) lines.push(`goal · ${workingOn}`)
      if (progress && !summary.includes(progress)) lines.push(`progress · ${progress}`)
      if (struggling) lines.push(`stuck · ${struggling}`)
      blocks.push({ id: randomUUID(), kind: "agent", text: lines.join("\n") })
      return
    }
    case "monitor.chat.reply":
      blocks.push({ id: randomUUID(), kind: "agent", text: readString(payload.answer) ?? "(empty reply)" })
      return
    case "monitor.steer":
      appendStackBlock(
        blocks,
        readString(payload.rule_id) || readString(payload.guidance_id)
          ? `steer · ${readString(payload.rule_id) ?? "rule"} · ${readString(payload.guidance_id) ?? "guide"}${readString(payload.message) ? `\n${readString(payload.message)}` : ""}`
          : `steer · ${readString(payload.focus) ?? "worker"}${readString(payload.message) ? `\n${readString(payload.message)}` : ""}`,
      )
      return
    case "monitor.skill_context_push":
      appendStackBlock(
        blocks,
        `push · ${readString(payload.skill_id) ?? "skill"} · ${readString(payload.reason) ?? "context"}`,
      )
      return
    case "monitor.error":
      appendStackBlock(blocks, `error · ${readString(payload.message) ?? "monitor failed"}`)
      return
    case "monitor.wake": {
      const reason = readString(payload.wake_reason) ?? "trigger"
      if (reason === "operator_message") return
      appendStackBlock(blocks, `runtime · ${reason.replace(/_/g, " ")}`)
      return
    }
    default:
      return
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined
}
