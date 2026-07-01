import { readFile } from "node:fs/promises"
import { requireCodexSessionPath, resolveCodexSessionPath } from "../codex/agent-context.js"
import type { MultiAgentCallMeta, SubagentLog } from "./subagents.js"
import {
  appendUserBlock,
  applyCodexLine,
  finalizeLiveSubagentGroup,
  finalizeLiveThinking,
  finalizeLiveToolGroup,
  type ToolLog,
  type TranscriptBlock,
} from "./transcript.js"

export type RolloutTranscript = {
  blocks: TranscriptBlock[]
  tools: ToolLog[]
  subagents: SubagentLog[]
}

/**
 * Reads the canonical Codex thread (its rollout jsonl on disk) and renders it into transcript
 * blocks — the same blocks the live stream produces, so the worker chat shows the *real*
 * conversation on resume instead of an empty local-turns shadow. Returns undefined if the
 * thread's rollout can't be located.
 */
export async function readRolloutTranscript(
  threadId: string,
  opts: { maxItems?: number } = {},
): Promise<RolloutTranscript | undefined> {
  const path = await resolveCodexSessionPath(threadId)
  if (!path) return undefined
  let text: string
  try {
    text = await readFile(path, "utf8")
  } catch {
    return undefined
  }
  return parseRolloutTranscript(text, opts.maxItems)
}

/**
 * Strict variant for the resume path, where a worker thread's rollout MUST be present: it
 * locates the rollout via {@link requireCodexSessionPath} and reads it, letting a missing file
 * or read error surface as a thrown, informative failure instead of a silently-empty chat.
 */
export async function readRequiredRolloutTranscript(
  threadId: string,
  opts: { maxItems?: number } = {},
): Promise<RolloutTranscript> {
  const path = await requireCodexSessionPath(threadId)
  const text = await readFile(path, "utf8")
  return parseRolloutTranscript(text, opts.maxItems)
}

// User-role items that are injected context, not something the operator actually typed.
const INJECTED_USER_PREFIXES = [
  "# AGENTS.md instructions",
  "<environment_context",
  "<permissions instructions",
  "<codex_internal_context",
  "<turn_aborted",
  "<user_instructions",
  "Restored Stack transcript",
]

/**
 * Parses Codex rollout jsonl into transcript blocks. The rollout's `response_item` payloads are
 * Responses-API items (message / function_call / function_call_output / reasoning); they reuse the
 * exact streaming parser (`applyCodexLine` → `parseCodexEvent`, which already unwraps
 * `response_item`). User/developer messages are intercepted here because the streaming parser
 * treats every message as agent text.
 */
export function parseRolloutTranscript(text: string, maxItems = 400): RolloutTranscript {
  const items: Record<string, unknown>[] = []
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (!isRecord(event) || event.type !== "response_item") continue
    const payload = event.payload
    if (isRecord(payload)) items.push(payload)
  }

  const windowed = maxItems > 0 ? items.slice(-maxItems) : items
  const blocks: TranscriptBlock[] = []
  const tools: ToolLog[] = []
  const subagents: SubagentLog[] = []
  const liveThinkingId: { current?: string } = {}
  const liveToolGroupId: { current?: string } = {}
  const liveSubagentGroupId: { current?: string } = {}
  const multiAgentCalls = new Map<string, MultiAgentCallMeta & { callId: string }>()
  const turnStartedAt: { current?: string } = {}

  for (const item of windowed) {
    const itemType = typeof item.type === "string" ? item.type : ""
    if (itemType === "reasoning") continue
    if (itemType === "message") {
      const role = typeof item.role === "string" ? item.role : ""
      if (role === "developer" || role === "system") continue
      if (role === "user") {
        const text = messageText(item)
        if (!text || isInjectedUserText(text)) continue
        appendUserBlock(blocks, text)
        continue
      }
      // assistant messages fall through to the streaming parser (renders as agent blocks)
    }
    applyCodexLine(
      blocks,
      tools,
      subagents,
      liveThinkingId,
      liveToolGroupId,
      liveSubagentGroupId,
      multiAgentCalls,
      turnStartedAt,
      JSON.stringify({ type: "response_item", payload: item }),
    )
  }

  finalizeLiveThinking(blocks, liveThinkingId)
  finalizeLiveToolGroup(blocks, liveToolGroupId)
  finalizeLiveSubagentGroup(blocks, liveSubagentGroupId)
  return { blocks, tools, subagents }
}

function messageText(item: Record<string, unknown>): string {
  const content = item.content
  if (!Array.isArray(content)) return ""
  const parts: string[] = []
  for (const part of content) {
    if (!isRecord(part)) continue
    const text = part.text
    if (typeof text === "string") parts.push(text)
  }
  return parts.join("").trim()
}

function isInjectedUserText(text: string): boolean {
  const trimmed = text.trimStart()
  return INJECTED_USER_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
