import { StyledText, dim, fg, type TextChunk } from "@opentui/core"
import type { SubagentLog } from "./subagents.js"
import type { ToolLog } from "./transcript.js"
import { stackTuiTheme as theme } from "./theme.js"

const MAX_RECENT_TOOLS = 3
const WORKING_COLOR = "#79c0ff"
const WAITING_COLOR = "#d29922"

export type WorkerActivityStatusInput = {
  status: "idle" | "running" | "error"
  spinnerFrame?: number
  toolLogs: readonly ToolLog[]
  subagentLogs?: readonly SubagentLog[]
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

function isActiveTool(tool: ToolLog): boolean {
  return tool.status !== "completed" && tool.status !== "failed" && tool.status !== "cancelled"
}

function activeToolsForCurrentTurn(input: WorkerActivityStatusInput): ToolLog[] {
  return toolsForCurrentTurn(input).filter(isActiveTool)
}

function isProcessWaitTool(tool: ToolLog): boolean {
  const name = tool.name.toLowerCase()
  return (
    name === "command_execution" ||
    name === "write_stdin" ||
    name === "exec_command" ||
    name === "unified_exec" ||
    name.includes("background_terminal") ||
    name.includes("process")
  )
}

function isAgentWaitTool(tool: ToolLog): boolean {
  const name = tool.name.toLowerCase()
  return name === "wait" || name === "wait_agent" || name === "collab_waiting"
}

function runningSubagentCount(input: WorkerActivityStatusInput): number {
  return (input.subagentLogs ?? []).filter(
    (agent) =>
      agent.status === "running" ||
      agent.status === "spawning" ||
      agent.status === "pending_init",
  ).length
}

/** Codex-style live status while a turn is blocked on tools/processes/agents. */
export function workerActivityLiveLabel(input: WorkerActivityStatusInput): {
  label: string
  color: string
} {
  if (input.agentChatPaused) return { label: "Paused", color: WORKING_COLOR }

  const active = activeToolsForCurrentTurn(input)
  const latest = active.at(-1)
  if (!latest) return { label: "Working", color: WORKING_COLOR }

  if (isAgentWaitTool(latest)) {
    const count = runningSubagentCount(input)
    if (count === 1) return { label: "Waiting for 1 agent", color: WAITING_COLOR }
    if (count > 1) return { label: `Waiting for ${count} agents`, color: WAITING_COLOR }
    return { label: "Waiting for agents", color: WAITING_COLOR }
  }

  if (isProcessWaitTool(latest)) {
    const raw = unwrapShellCommand(latest.command ?? "")
    if (raw) {
      const preview = truncate(raw.replace(/\s+/g, " ").trim(), 42)
      return { label: `Waiting for ${preview}`, color: WAITING_COLOR }
    }
    return { label: "Waiting for background terminal", color: WAITING_COLOR }
  }

  if (latest.name && latest.name !== "tool") {
    return { label: `Waiting for ${latest.name}`, color: WAITING_COLOR }
  }
  return { label: "Waiting", color: WAITING_COLOR }
}

export function workerActivityStatusLineCount(input: WorkerActivityStatusInput): number {
  return input.status === "running" ? 1 : 0
}

export function workerActivityStatusChunks(input: WorkerActivityStatusInput): TextChunk[] {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
  const paused = input.agentChatPaused === true
  const glyph = paused ? "Ⅱ" : (frames[(input.spinnerFrame ?? 0) % frames.length] ?? "⠋")
  const label = paused ? "Paused" : "Running"
  return [fg(paused ? WAITING_COLOR : theme.goalLifecycle.active)(`${glyph} `), fg(theme.fgPrimary)(label)]
}

export function renderWorkerActivityStatusStyled(input: WorkerActivityStatusInput): StyledText {
  return new StyledText(workerActivityStatusChunks(input))
}
