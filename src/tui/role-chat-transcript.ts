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
  "monitor.chat.request",
  "monitor.chat.reply",
  "monitor.goal_status",
  "monitor.steer",
  "monitor.error",
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
    case "monitor.chat.request":
      appendUserBlock(blocks, readString(payload.message) ?? "(empty)")
      return
    case "monitor.goal_status": {
      if (payload.for_human !== true && payload.for_human !== "true") return
      const headline = readString(payload.headline)
      const note = readString(payload.note)
      const status = readString(payload.status) ?? "update"
      const text =
        [headline, note && note !== headline ? note : undefined].filter(Boolean).join("\n") ||
        status.replace(/_/g, " ")
      blocks.push({ id: randomUUID(), kind: "agent", text })
      return
    }
    case "monitor.chat.reply":
      blocks.push({ id: randomUUID(), kind: "agent", text: readString(payload.answer) ?? "(empty reply)" })
      return
    case "monitor.steer": {
      const message = readString(payload.message)
      const focus = readString(payload.focus) ?? "worker"
      blocks.push({
        id: randomUUID(),
        kind: "agent",
        text: message ? `Steer · ${focus}\n${message}` : `Steer · ${focus}`,
      })
      return
    }
    case "monitor.error":
      blocks.push({ id: randomUUID(), kind: "agent", text: readString(payload.message) ?? "monitor failed" })
      return
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
