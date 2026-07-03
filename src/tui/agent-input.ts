import { StyledText, dim, fg, type TextChunk } from "@opentui/core"
import {
  agentChatPauseEligible,
  agentChatPauseInputLine,
  agentChatPauseInstructions,
  type AgentChatPauseContext,
} from "./agent-chat-pause.js"
import { stackTuiTheme as theme } from "./theme.js"
import type { ToolLog } from "./transcript.js"
import {
  workerActivityStatusChunks,
  workerActivityStatusLineCount,
  type WorkerActivityStatusInput,
} from "./worker-activity-status.js"

type AgentInputState = AgentChatPauseContext & {
  inputBuffer: string
  queuedMessages: readonly string[]
  spinnerFrame: number
  toolLogs: readonly ToolLog[]
  currentTurnStartedAt?: string
  agentChatPaused?: boolean
  columns?: number
  showRecentToolActivity?: boolean
}

function queuedWorkerPromptPreview(messages: readonly string[]): string | undefined {
  const latest = messages.at(-1)?.replace(/\s+/g, " ").trim()
  if (!latest) return undefined
  const label = latest.startsWith("<stack_internal_context") ? "goal kickoff" : latest
  return label.length > 120 ? `${label.slice(0, 117)}...` : label
}

function workerActivityInput(input: AgentInputState): WorkerActivityStatusInput {
  return {
    status: input.status,
    toolLogs: input.toolLogs,
    currentTurnStartedAt: input.currentTurnStartedAt,
    agentChatPaused: input.agentChatPaused,
    queuedCount: input.queuedMessages.length,
    columns: input.columns,
    showRecentTools: input.showRecentToolActivity,
  }
}

function renderRunningPromptLine(
  state: AgentInputState,
  preview: string,
  promptColor: string,
  hint: string,
): TextChunk[] {
  const queuedPreview = preview ? undefined : queuedWorkerPromptPreview(state.queuedMessages)
  const chunks: TextChunk[] = [fg(promptColor)("> ")]
  if (preview) {
    chunks.push(fg(theme.fgInput)(preview), fg(theme.synth.gold)("_"))
  } else if (queuedPreview) {
    chunks.push(fg(theme.fgMuted)("queued: "), fg(theme.fgInput)(queuedPreview))
  } else {
    chunks.push(dim(fg(theme.fgMuted)(hint)))
  }
  return chunks
}

/** Worker input uses activity status + prompt while the turn is active. */
export function agentInputRenderedLineCount(state: AgentInputState): number {
  if (state.status === "running") {
    return workerActivityStatusLineCount(workerActivityInput(state)) + 1
  }
  return 1
}

export function renderWorkerAgentInputStyled(
  state: AgentInputState,
  input: {
    idleHint: string
    promptColor?: string
  },
): StyledText {
  const preview = state.inputBuffer.replace(/\n/g, " ↵ ")
  const promptColor = input.promptColor ?? theme.synth.amber

  if (state.status === "running" && state.agentChatPaused && agentChatPauseEligible(state)) {
    const statusLine = `${agentChatPauseInputLine(true)} · ${agentChatPauseInstructions(true)}`
    return new StyledText([
      ...workerActivityStatusChunks(workerActivityInput(state)),
      fg(theme.fgPrimary)("\n"),
      dim(fg(theme.synth.warmMuted)(statusLine)),
      fg(theme.fgPrimary)("\n"),
      ...renderRunningPromptLine(state, preview, promptColor, "type to draft · Enter steer · ctrl+enter queue"),
    ])
  }

  if (state.status === "running") {
    return new StyledText([
      ...workerActivityStatusChunks(workerActivityInput(state)),
      fg(theme.fgPrimary)("\n"),
      ...renderRunningPromptLine(state, preview, promptColor, "type to steer · ctrl+enter queue"),
    ])
  }

  if (!preview) {
    return new StyledText([fg(promptColor)("› "), dim(fg(theme.fgMuted)(input.idleHint))])
  }

  return new StyledText([fg(promptColor)("› "), fg(theme.fgInput)(preview), fg(theme.synth.gold)("_")])
}
