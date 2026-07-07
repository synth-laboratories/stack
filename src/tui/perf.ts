import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export type TuiPerfPath = "native" | "paint" | "remount" | "microbench"
export type TuiPerfSpeedRating = "fast" | "tolerable" | "slow"

export type TuiPerfEvent = {
  kind: string
  label: string
  duration_ms: number
  path: TuiPerfPath
  observed_at: string
  meta?: Record<string, unknown>
}

export type TuiPerfScenarioResult = {
  scenario: string
  path: TuiPerfPath
  samples: number
  p50_ms: number
  p95_ms: number
  min_ms: number
  max_ms: number
  speed: TuiPerfSpeedRating
  budget_ms?: number
  ok?: boolean
}

const events: TuiPerfEvent[] = []

export function tuiPerfEnabled(): boolean {
  const value = process.env.STACK_TUI_PERF?.trim().toLowerCase()
  return value === "1" || value === "true" || value === "yes"
}

export function tuiPerfOutputPath(stackRoot?: string): string | undefined {
  const explicit = process.env.STACK_TUI_PERF_OUTPUT?.trim()
  if (explicit) return explicit
  if (!stackRoot) return undefined
  return join(stackRoot, ".stack", "tui_perf.jsonl")
}

export function tuiPerfMark(
  kind: string,
  label: string,
  durationMs: number,
  path: TuiPerfPath,
  meta?: Record<string, unknown>,
): void {
  if (!tuiPerfEnabled()) return
  const event: TuiPerfEvent = {
    kind,
    label,
    duration_ms: roundMs(durationMs),
    path,
    observed_at: new Date().toISOString(),
    ...(meta ? { meta } : {}),
  }
  events.push(event)
  const outputPath = tuiPerfOutputPath(process.env.STACK_ROOT?.trim() || process.env.STACK_SESSION_DIR?.trim())
  if (outputPath) {
    mkdirSync(join(outputPath, ".."), { recursive: true })
    appendFileSync(outputPath, `${JSON.stringify(event)}\n`)
  }
}

export function tuiPerfMeasure<T>(
  kind: string,
  label: string,
  path: TuiPerfPath,
  run: () => T,
  meta?: Record<string, unknown>,
): T {
  const start = performance.now()
  try {
    return run()
  } finally {
    tuiPerfMark(kind, label, performance.now() - start, path, meta)
  }
}

export async function tuiPerfMeasureAsync<T>(
  kind: string,
  label: string,
  path: TuiPerfPath,
  run: () => Promise<T>,
  meta?: Record<string, unknown>,
): Promise<T> {
  const start = performance.now()
  try {
    return await run()
  } finally {
    tuiPerfMark(kind, label, performance.now() - start, path, meta)
  }
}

export function tuiPerfStart(kind: string, label: string, path: TuiPerfPath): () => void {
  const start = performance.now()
  return (meta?: Record<string, unknown>) => {
    tuiPerfMark(kind, label, performance.now() - start, path, meta)
  }
}

export function tuiPerfDrain(): TuiPerfEvent[] {
  return [...events]
}

export function tuiPerfReset(): void {
  events.length = 0
}

export function summarizeTuiPerfSamples(
  scenario: string,
  path: TuiPerfPath,
  samples: number[],
  budgetMs?: number,
): TuiPerfScenarioResult {
  const sorted = [...samples].sort((a, b) => a - b)
  const count = sorted.length
  const p50 = percentile(sorted, 0.5)
  const p95 = percentile(sorted, 0.95)
  const result: TuiPerfScenarioResult = {
    scenario,
    path,
    samples: count,
    p50_ms: roundMs(p50),
    p95_ms: roundMs(p95),
    min_ms: roundMs(sorted[0] ?? 0),
    max_ms: roundMs(sorted[count - 1] ?? 0),
    speed: rateTuiPerfSpeed(path, p95),
    ...(budgetMs !== undefined ? { budget_ms: budgetMs } : {}),
  }
  if (budgetMs !== undefined) result.ok = p95 <= budgetMs
  return result
}

export function formatTuiPerfTable(rows: TuiPerfScenarioResult[]): string {
  const headers = ["scenario", "path", "samples", "p50_ms", "p95_ms", "speed", "min_ms", "max_ms", "budget", "ok"]
  const body = rows.map((row) => [
    row.scenario,
    row.path,
    String(row.samples),
    formatMs(row.p50_ms),
    formatMs(row.p95_ms),
    row.speed,
    formatMs(row.min_ms),
    formatMs(row.max_ms),
    row.budget_ms !== undefined ? formatMs(row.budget_ms) : "—",
    row.ok === undefined ? "—" : row.ok ? "ok" : "FAIL",
  ])
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...body.map((line) => line[index]?.length ?? 0)),
  )
  const render = (cells: string[]) => cells.map((cell, index) => cell.padEnd(widths[index] ?? cell.length)).join("  ")
  const divider = widths.map((width) => "-".repeat(width)).join("  ")
  return [
    render(headers),
    divider,
    ...body.map((line) => render(line)),
    "",
    formatTuiPerfSpeedSummary(rows),
  ].join("\n")
}

export function writeTuiPerfReport(path: string, rows: TuiPerfScenarioResult[]): void {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(
    path,
    `${JSON.stringify({ generated_at: new Date().toISOString(), scenarios: rows }, null, 2)}\n`,
    "utf8",
  )
}

function percentile(sorted: number[], ratio: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)))
  return sorted[index] ?? 0
}

function rateTuiPerfSpeed(path: TuiPerfPath, p95Ms: number): TuiPerfSpeedRating {
  if (path === "native" || path === "paint" || path === "microbench") {
    if (p95Ms <= 5) return "fast"
    if (p95Ms <= 16) return "tolerable"
    return "slow"
  }
  if (p95Ms <= 50) return "fast"
  if (p95Ms <= 150) return "tolerable"
  return "slow"
}

function formatTuiPerfSpeedSummary(rows: readonly TuiPerfScenarioResult[]): string {
  const counts: Record<TuiPerfSpeedRating, number> = {
    fast: 0,
    tolerable: 0,
    slow: 0,
  }
  for (const row of rows) {
    counts[row.speed] += 1
  }
  return `speed summary: fast=${counts.fast} tolerable=${counts.tolerable} slow=${counts.slow}`
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10
}

function formatMs(value: number): string {
  return value.toFixed(1)
}
