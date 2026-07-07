import type { SubagentLog } from "./subagents.js"
import {
  maxTranscriptScrollOffset,
  renderTranscriptStyledView,
  type TranscriptBlock,
  type TranscriptRenderOptions,
  type ToolLog,
} from "./transcript.js"

export type TuiPerfFixture = {
  blocks: TranscriptBlock[]
  tools: ToolLog[]
  subagents: SubagentLog[]
}

const AGENT_PARAGRAPH =
  "The worker compared heldout scores, inspected rollout traces, and proposed the next prompt mutation for the hillclimb candidate. " +
  "Monitor sidecar narrated phase transitions while the gardener queued steer text for the operator. "

export function readTuiPerfBlockCount(): number {
  const fromEnv = Number.parseInt(process.env.STACK_TUI_PERF_BLOCKS?.trim() ?? "", 10)
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv
  return 800
}

export function readTuiPerfIterations(defaultValue = 50): number {
  const fromEnv = Number.parseInt(process.env.STACK_TUI_PERF_ITERATIONS?.trim() ?? "", 10)
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv
  return defaultValue
}

export function buildHeavyTuiPerfFixture(blockCount: number): TuiPerfFixture {
  const blocks: TranscriptBlock[] = []
  const tools: ToolLog[] = []
  const subagents: SubagentLog[] = []
  for (let i = 0; i < blockCount; i += 1) {
    const kind = i % 5
    if (kind === 0) {
      blocks.push({
        id: `user-${i}`,
        kind: "user",
        text: `operator ${i}: ${repeatParagraph(3)}`,
      })
    } else if (kind === 1) {
      blocks.push({
        id: `thinking-${i}`,
        kind: "thinking",
        text: repeatParagraph(4),
        ...(i % 17 === 0 ? { live: true } : {}),
      })
    } else if (kind === 2) {
      const toolId = `tool-${i}`
      tools.push({
        id: toolId,
        name: i % 2 === 0 ? "shell" : "apply_patch",
        status: i % 9 === 0 ? "running" : "completed",
        command: `rg -n "candidate_${i}" src tests bundled`,
        output: repeatParagraph(2),
        stdout: repeatParagraph(2),
      })
      blocks.push({ id: `tool-block-${i}`, kind: "tool", toolId })
    } else if (kind === 3) {
      blocks.push({
        id: `agent-${i}`,
        kind: "agent",
        text: `agent ${i}: ${repeatParagraph(6)}`,
      })
    } else {
      blocks.push({
        id: `stack-${i}`,
        kind: "stack",
        text: `stack ${i}: ${repeatParagraph(2)}`,
      })
    }
  }
  return { blocks, tools, subagents }
}

export function defaultTuiPerfTranscriptOptions(running = false): TranscriptRenderOptions {
  return {
    expandedBlockIds: new Set<string>(),
    showDetails: false,
    running,
    spinnerFrame: 3,
    harnessCommand: "codex",
  }
}

export function heavyTranscriptViewport() {
  return { lines: 36, columns: 132, pageLines: 3 }
}

export function renderHeavyTranscript(
  fixture: TuiPerfFixture,
  scrollOffset = 0,
  running = false,
) {
  const viewport = heavyTranscriptViewport()
  return renderTranscriptStyledView(
    fixture.blocks,
    fixture.tools,
    fixture.subagents,
    viewport,
    defaultTuiPerfTranscriptOptions(running),
    scrollOffset,
  )
}

export function simulateScrollTick(fixture: TuiPerfFixture, scrollOffset = 12): number {
  const viewport = heavyTranscriptViewport()
  const options = defaultTuiPerfTranscriptOptions()
  maxTranscriptScrollOffset(
    fixture.blocks,
    fixture.tools,
    fixture.subagents,
    viewport.columns,
    options,
    viewport.lines,
  )
  const maxOffset = maxTranscriptScrollOffset(
    fixture.blocks,
    fixture.tools,
    fixture.subagents,
    viewport.columns,
    options,
    viewport.lines,
  )
  const offset = Math.min(scrollOffset, maxOffset)
  renderHeavyTranscript(fixture, offset)
  return offset
}

function repeatParagraph(repeats: number): string {
  return AGENT_PARAGRAPH.repeat(repeats)
}
