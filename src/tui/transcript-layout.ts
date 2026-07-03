import type { SubagentLog } from "./subagents.js"
import type { ToolLog, TranscriptBlock, TranscriptViewport } from "./transcript.js"

export function estimateShortTranscriptLines(
  blocks: readonly TranscriptBlock[],
  toolLogs: readonly ToolLog[],
  subagentLogs: readonly SubagentLog[],
  columns: number,
): number | undefined {
  const width = Math.max(20, columns)
  let lines = 0
  for (const block of blocks) {
    switch (block.kind) {
      case "thinking":
        break
      case "user":
      case "agent":
        lines += 1 + estimateWrappedLines(block.text, width)
        break
      case "stack":
        lines += 2 + estimateWrappedLines(block.text, width)
        break
      case "tool":
      case "subagent":
        lines += 1
        break
      case "tool_group":
        lines += Math.max(1, Math.min(3, block.toolIds.length))
        break
      case "subagent_group":
        lines += Math.max(1, Math.min(3, block.subagentIds.length))
        break
    }
    if (lines > 160) return undefined
  }
  return Math.max(1, lines)
}

export function transcriptViewportForEstimatedContent(
  viewport: TranscriptViewport,
  estimatedLines: number | undefined,
): { viewport: TranscriptViewport; short: boolean } {
  const short = estimatedLines !== undefined && estimatedLines < viewport.lines
  if (!short) return { viewport, short }
  const lines = Math.max(1, estimatedLines)
  return {
    viewport: {
      ...viewport,
      lines,
      pageLines: lines,
    },
    short,
  }
}

export function transcriptPaneFlexGrowForContent(): number {
  return 1
}

export function estimateWrappedLines(text: string, columns: number): number {
  let count = 0
  for (const rawLine of text.split("\n")) {
    if (rawLine.length === 0) {
      count += 1
      continue
    }
    let remaining = rawLine
    while (remaining.length > columns) {
      let breakAt = remaining.lastIndexOf(" ", columns)
      if (breakAt <= 0) breakAt = columns
      count += 1
      remaining = remaining.slice(breakAt).trimStart()
    }
    count += 1
  }
  return Math.max(1, count)
}
