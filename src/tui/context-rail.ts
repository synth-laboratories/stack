import { StyledText, dim, fg, type TextChunk } from "@opentui/core"
import type { AgentContextSnapshot } from "../codex/agent-context.js"
import { agentContextRailLines } from "../codex/agent-context.js"
import { stackTuiTheme as theme } from "./theme.js"

export function renderAgentContextStyled(snapshot: AgentContextSnapshot, workspaceRoot: string, columns: number): StyledText {
  const chunks: TextChunk[] = []
  const lines = agentContextRailLines(snapshot, columns, workspaceRoot)
  for (const [index, line] of lines.entries()) {
    if (index > 0) chunks.push(fg(theme.fgPrimary)("\n"))
    const splitAt = line.indexOf("  ")
    if (splitAt <= 0) {
      chunks.push(fg(theme.synth.amber)(line))
      continue
    }
    const label = line.slice(0, splitAt)
    const value = line.slice(splitAt)
    chunks.push(fg(theme.synth.orangeDark)(label))
    chunks.push(fg(theme.fgSecondary)(value))
  }
  return new StyledText(chunks)
}
