import { StyledText, dim, fg, type TextChunk } from "@opentui/core"
import type { ToolLog } from "./transcript.js"
import { stackTuiTheme as theme } from "./theme.js"

const MAX_RECENT_TOOLS = 3
const WORKING_COLOR = "#79c0ff"

export type WorkerActivityStatusInput = {
  status: "idle" | "running" | "error"
  toolLogs: readonly ToolLog[]
  currentTurnStartedAt?: string
  agentChatPaused?: boolean
  queuedCount?: number
  columns?: number
  showRecentTools?: boolean
}

function unwrapShellCommand(command: string): string {
  return command
    .replace(/^\/bin\/zsh\s+-lc\s+/, "")
    .replace(/^\/bin\/bash\s+-lc\s+/, "")
    .replace(/^['"]|['"]$/g, "")
    .trim()
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 3))}...`
}

/** Codex-style one-line headline for a completed tool call. */
export function codexToolActivityHeadline(tool: ToolLog): string {
  const raw = unwrapShellCommand(tool.command ?? "")
  if (tool.name === "command_execution" || raw) {
    const whichMatch = raw.match(/^which\s+(\S+)/)
    if (whichMatch) return `Ran which ${whichMatch[1]}`

    if (/^(rg|grep|find)\b/.test(raw) || /\bin\s+\S/.test(raw)) return "Explored"

    if (/^python3?\s/.test(raw) || /^uv\s/.test(raw) || /^cargo\s/.test(raw)) {
      return `Ran ${truncate(raw, 52)}`
    }

    const firstToken = raw.split(/\s+/)[0]
    if (firstToken && firstToken.length <= 28) return `Ran ${firstToken}`
    if (raw) return `Ran ${truncate(raw, 52)}`
    return "Ran shell"
  }

  if (tool.name && tool.name !== "tool") return `Ran ${tool.name}`
  return "Ran tool"
}

/** Codex-style detail line under a tool headline (output or command preview). */
export function codexToolActivityDetail(tool: ToolLog, columns = 120): string | undefined {
  const raw = unwrapShellCommand(tool.command ?? "")
  if (/^(rg|grep|find)\b/.test(raw)) return truncate(raw, columns - 2)

  const output = (tool.stdout ?? tool.output ?? "").trim()
  const firstLine = output.split("\n").map((line) => line.trim()).find(Boolean)
  if (firstLine) return truncate(firstLine, columns - 2)

  if (raw && !/^(which)\b/.test(raw)) return truncate(raw, columns - 2)
  return undefined
}

function toolsForCurrentTurn(input: WorkerActivityStatusInput): ToolLog[] {
  const turnStart = input.currentTurnStartedAt
    ? new Date(input.currentTurnStartedAt).getTime()
    : undefined
  return input.toolLogs.filter((tool) => {
    if (!turnStart) return true
    if (!tool.startedAt) return tool.status !== "completed"
    return new Date(tool.startedAt).getTime() >= turnStart - 500
  })
}

function workingElapsedSeconds(startedAt?: string): number {
  if (!startedAt) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
}

function workingSuffix(input: WorkerActivityStatusInput): string {
  const parts: string[] = [`${workingElapsedSeconds(input.currentTurnStartedAt)}s`]
  if ((input.queuedCount ?? 0) > 0) parts.push(`${input.queuedCount} queued`)
  parts.push(input.agentChatPaused ? "Enter steer" : "esc to pause")
  return parts.join(" · ")
}

export function workerActivityStatusLineCount(input: WorkerActivityStatusInput): number {
  if (input.status !== "running") return 0
  const completed = input.showRecentTools === false
    ? []
    : toolsForCurrentTurn(input)
        .filter((tool) => tool.status === "completed")
        .slice(-MAX_RECENT_TOOLS)
  let lines = 0
  for (const tool of completed) {
    lines += 1
    if (codexToolActivityDetail(tool, input.columns)) lines += 1
  }
  lines += 1
  return lines
}

export function workerActivityStatusChunks(input: WorkerActivityStatusInput): TextChunk[] {
  const chunks: TextChunk[] = []
  const columns = input.columns ?? 120
  const completed = input.showRecentTools === false
    ? []
    : toolsForCurrentTurn(input)
        .filter((tool) => tool.status === "completed")
        .slice(-MAX_RECENT_TOOLS)

  for (const tool of completed) {
    const detail = codexToolActivityDetail(tool, columns)
    chunks.push(fg(theme.fgPrimary)("• "), fg(theme.fgPrimary)(codexToolActivityHeadline(tool)), fg(theme.fgPrimary)("\n"))
    if (detail) {
      chunks.push(dim(fg(theme.fgMuted)(`└ ${detail}`)), fg(theme.fgPrimary)("\n"))
    }
  }

  const workingLabel = input.agentChatPaused ? "Paused" : "Working"
  chunks.push(
    fg(theme.fgPrimary)("• "),
    fg(WORKING_COLOR)(workingLabel),
    dim(fg(theme.fgMuted)(` (${workingSuffix(input)})`)),
  )
  return chunks
}

export function renderWorkerActivityStatusStyled(input: WorkerActivityStatusInput): StyledText {
  return new StyledText(workerActivityStatusChunks(input))
}
