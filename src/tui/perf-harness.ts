import { readdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import type { StackConfig } from "../config.js"
import type { StackLocalSession } from "../session.js"
import {
  buildHeavyTuiPerfFixture,
  readTuiPerfBlockCount,
  readTuiPerfIterations,
} from "./perf-fixture.js"
import {
  summarizeTuiPerfSamples,
  writeTuiPerfReport,
  type TuiPerfScenarioResult,
} from "./perf.js"

export type TuiPerfBenchMeta = {
  session_id: string
  session_turns: number
  transcript_blocks: number
  iterations: number
  seeded_fixture: boolean
}

let lastResults: TuiPerfScenarioResult[] | undefined
let lastMeta: TuiPerfBenchMeta | undefined

export function tuiPerfBenchEnabled(): boolean {
  const value = process.env.STACK_TUI_PERF_BENCH?.trim().toLowerCase()
  return value === "1" || value === "true" || value === "yes"
}

export function storeTuiPerfBenchResults(rows: TuiPerfScenarioResult[], meta: TuiPerfBenchMeta): void {
  lastResults = rows
  lastMeta = meta
}

export function takeTuiPerfBenchResults(): { rows: TuiPerfScenarioResult[]; meta: TuiPerfBenchMeta } | undefined {
  if (!lastResults || !lastMeta) return undefined
  const rows = lastResults
  const meta = lastMeta
  lastResults = undefined
  lastMeta = undefined
  return { rows, meta }
}

export function readTuiPerfBenchIterations(defaultValue = 30): number {
  return readTuiPerfIterations(defaultValue)
}

export async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve))
}

export async function measureRemount(remount: () => void): Promise<number> {
  const start = performance.now()
  remount()
  await flushMicrotasks()
  return performance.now() - start
}

export async function measureAsync(run: () => void | Promise<void>): Promise<number> {
  const start = performance.now()
  await run()
  await flushMicrotasks()
  return performance.now() - start
}

export function seedHeavyTranscriptState(
  state: {
    blocks: unknown[]
    toolLogs: unknown[]
    subagentLogs: unknown[]
    selectedToolIndex: number
    agentScrollOffset: number
  },
  blockCount = readTuiPerfBlockCount(),
): number {
  const fixture = buildHeavyTuiPerfFixture(blockCount)
  state.blocks = fixture.blocks
  state.toolLogs = fixture.tools
  state.subagentLogs = fixture.subagents
  state.selectedToolIndex = Math.max(0, fixture.tools.length - 1)
  state.agentScrollOffset = 0
  return fixture.blocks.length
}

export async function resolvePerfBenchSession(
  config: StackConfig,
  explicitSessionId?: string,
): Promise<StackLocalSession | undefined> {
  if (explicitSessionId?.trim()) {
    return readSessionById(config.sessionLogDir, explicitSessionId.trim())
  }
  return findLargestTurnSession(config.sessionLogDir)
}

export async function findLargestTurnSession(sessionLogDir: string): Promise<StackLocalSession | undefined> {
  let best: StackLocalSession | undefined
  let bestTurns = -1
  let entries: string[]
  try {
    entries = await readdir(sessionLogDir)
  } catch {
    return undefined
  }
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue
    const path = join(sessionLogDir, entry)
    try {
      const info = await stat(path)
      if (!info.isFile()) continue
      const session = JSON.parse(await readFile(path, "utf8")) as StackLocalSession
      const turnCount = session.turns?.length ?? 0
      if (turnCount > bestTurns) {
        bestTurns = turnCount
        best = session
      }
    } catch {
      continue
    }
  }
  return best
}

export async function readSessionById(
  sessionLogDir: string,
  sessionId: string,
): Promise<StackLocalSession | undefined> {
  const path = join(sessionLogDir, `${sessionId}.json`)
  try {
    return JSON.parse(await readFile(path, "utf8")) as StackLocalSession
  } catch {
    return undefined
  }
}

export function benchRemountSamples(
  scenario: string,
  samples: number[],
  budgetMs: number,
): TuiPerfScenarioResult {
  return summarizeTuiPerfSamples(scenario, "remount", samples, budgetMs)
}

export function benchPaintSamples(
  scenario: string,
  samples: number[],
  budgetMs: number,
): TuiPerfScenarioResult {
  return summarizeTuiPerfSamples(scenario, "paint", samples, budgetMs)
}

export function benchNativeSamples(
  scenario: string,
  samples: number[],
  budgetMs: number,
): TuiPerfScenarioResult {
  return summarizeTuiPerfSamples(scenario, "native", samples, budgetMs)
}

export function writeBenchReportIfConfigured(rows: TuiPerfScenarioResult[]): void {
  const reportPath = process.env.STACK_TUI_PERF_REPORT?.trim()
  if (reportPath) writeTuiPerfReport(reportPath, rows)
}
