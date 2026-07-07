#!/usr/bin/env bun

import { performance } from "node:perf_hooks"
import { createRemountCoordinator } from "../src/tui/remount-coordinator.js"
import {
  shouldUseNativeAgentInput,
  isEditableInputChunk,
} from "../src/tui/input-paste.js"
import { slashMenuEditNeedsRemount } from "../src/tui/slash-commands.js"
import {
  maxTranscriptScrollOffset,
  renderTranscriptStyledView,
  type TranscriptBlock,
  type TranscriptRenderOptions,
  type ToolLog,
} from "../src/tui/transcript.js"
import {
  formatTuiPerfTable,
  summarizeTuiPerfSamples,
  type TuiPerfScenarioResult,
  writeTuiPerfReport,
} from "../src/tui/perf.js"

const json = process.argv.includes("--json")
const iterations = readIterations()
const fixture = buildFixtureTranscript(80)

const rows: TuiPerfScenarioResult[] = await buildRows()

async function buildRows(): Promise<TuiPerfScenarioResult[]> {
  return [
    benchRouting("idle_worker_char", "a", "agent", "idle", true, 5),
    benchRouting("running_worker_char", "a", "agent", "running", false, 5),
    benchRouting("gardener_char", "a", "gardener", "idle", false, 5),
    benchRouting("monitor_char", "a", "monitor", "idle", false, 5),
    benchSlashRemountDecision("slash_open", "", "/", 20),
    benchTranscript("transcript_render", () => {
      renderTranscriptStyledView(
        fixture.blocks,
        fixture.tools,
        fixture.subagents,
        { lines: 24, columns: 100, pageLines: 3 },
        transcriptOptions(),
        0,
      )
    }, 5),
    benchTranscript("transcript_scroll_max_offset", () => {
      maxTranscriptScrollOffset(
        fixture.blocks,
        fixture.tools,
        fixture.subagents,
        100,
        transcriptOptions(),
        24,
      )
    }, 5),
    benchTranscript("scroll_tick_layout_twice", () => {
      const viewport = { lines: 24, columns: 100, pageLines: 3 }
      const options = transcriptOptions()
      const maxOffset = maxTranscriptScrollOffset(fixture.blocks, fixture.tools, fixture.subagents, 100, options, 24)
      const offset = Math.min(12, maxOffset)
      maxTranscriptScrollOffset(fixture.blocks, fixture.tools, fixture.subagents, 100, options, 24)
      renderTranscriptStyledView(fixture.blocks, fixture.tools, fixture.subagents, viewport, options, offset)
    }, 20),
    await benchRemountCoordinator(iterations),
  ]
}

const reportPath = process.env.STACK_TUI_PERF_REPORT?.trim()
if (reportPath) writeTuiPerfReport(reportPath, rows)

if (json) {
  console.log(JSON.stringify({ iterations, scenarios: rows }, null, 2))
} else {
  console.log("Stack TUI perf benchmark")
  console.log(`iterations=${iterations} transcript_blocks=${fixture.blocks.length}`)
  console.log("")
  console.log(formatTuiPerfTable(rows))
  console.log("")
  const failures = rows.filter((row) => row.ok === false)
  if (failures.length > 0) {
    console.error(`tui_perf_failed: ${failures.map((row) => row.scenario).join(", ")}`)
    process.exit(1)
  }
  console.log("tui_perf_ok")
}

function benchRouting(
  scenario: string,
  sequence: string,
  focusMode: string,
  status: string,
  expectNative: boolean,
  budgetMs: number,
): TuiPerfScenarioResult {
  const samples: number[] = []
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now()
    const native = shouldUseNativeAgentInput(sequence, focusMode, status)
    const editable = isEditableInputChunk(sequence)
    samples.push(performance.now() - start)
    if (native !== expectNative || !editable) {
      throw new Error(`${scenario}: routing mismatch native=${native} editable=${editable}`)
    }
  }
  return summarizeTuiPerfSamples(scenario, expectNative ? "native" : "remount", samples, budgetMs)
}

function benchSlashRemountDecision(
  scenario: string,
  previous: string,
  next: string,
  budgetMs: number,
): TuiPerfScenarioResult {
  const samples: number[] = []
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now()
    const needsRemount = slashMenuEditNeedsRemount(previous, next)
    samples.push(performance.now() - start)
    if (!needsRemount) throw new Error(`${scenario}: expected slash remount decision true`)
  }
  return summarizeTuiPerfSamples(scenario, "remount", samples, budgetMs)
}

function benchTranscript(scenario: string, run: () => unknown, budgetMs: number): TuiPerfScenarioResult {
  run()
  const samples: number[] = []
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now()
    run()
    samples.push(performance.now() - start)
  }
  return summarizeTuiPerfSamples(scenario, "microbench", samples, budgetMs)
}

function benchRemountCoordinator(iterationCount: number): Promise<TuiPerfScenarioResult> {
  const samples: number[] = []
  return (async () => {
    for (let i = 0; i < iterationCount; i += 1) {
      let mountCount = 0
      const coordinator = createRemountCoordinator(0)
      coordinator.bind({
        mount: () => {
          mountCount += 1
          const start = performance.now()
          renderTranscriptStyledView(
            fixture.blocks,
            fixture.tools,
            fixture.subagents,
            { lines: 24, columns: 100, pageLines: 3 },
            transcriptOptions(),
            i % 12,
          )
          samples.push(performance.now() - start)
        },
        render: () => {
          // paint-only path
        },
      })
      coordinator.remountNow()
      await flushMicrotasks()
      coordinator.dispose()
      if (mountCount !== 1) {
        throw new Error(`mock_full_remount_body: expected one mount, got ${mountCount}`)
      }
    }
    return summarizeTuiPerfSamples("mock_full_remount_body", "remount", samples, 25)
  })()
}

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve))
}

function transcriptOptions(): TranscriptRenderOptions {
  return {
    expandedBlockIds: new Set<string>(),
    showDetails: false,
    running: false,
    spinnerFrame: 0,
    harnessCommand: "codex",
  }
}

function buildFixtureTranscript(blockCount: number): {
  blocks: TranscriptBlock[]
  tools: ToolLog[]
  subagents: ReturnType<typeof emptySubagents>
} {
  const blocks: TranscriptBlock[] = []
  const tools: ToolLog[] = []
  const subagents = emptySubagents()
  for (let i = 0; i < blockCount; i += 1) {
    if (i % 4 === 0) {
      blocks.push({
        id: `user-${i}`,
        kind: "user",
        text: `operator prompt ${i}: tune the hillclimb candidate and report deltas for generation ${i}`,
      })
    } else if (i % 4 === 1) {
      blocks.push({
        id: `thinking-${i}`,
        kind: "thinking",
        text: `thinking ${i}: inspect traces, compare heldout score, and propose the next mutation`,
      })
    } else if (i % 4 === 2) {
      const toolId = `tool-${i}`
      tools.push({
        id: toolId,
        name: "shell",
        status: "completed",
        command: `rg -n "candidate_${i}" src`,
        output: `match ${i}\n`.repeat(6),
      })
      blocks.push({ id: `tool-block-${i}`, kind: "tool", toolId })
    } else {
      blocks.push({
        id: `agent-${i}`,
        kind: "agent",
        text: `agent ${i}: updated prompt and queued rollout; score improved by ${(i % 7) / 100}`,
      })
    }
  }
  return { blocks, tools, subagents }
}

function emptySubagents() {
  return [] as import("../src/tui/transcript.js").SubagentLog[]
}

function readIterations(): number {
  const fromEnv = Number.parseInt(process.env.STACK_TUI_PERF_ITERATIONS?.trim() ?? "", 10)
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv
  const fromArg = process.argv.find((arg) => arg.startsWith("--iterations="))
  if (fromArg) {
    const parsed = Number.parseInt(fromArg.slice("--iterations=".length), 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return 200
}
