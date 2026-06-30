import type { StackCodexTurn, StackCodexUsage } from "../session.js"

export const EMA_ALPHA = 0.35

export function turnOutputTokens(usage: StackCodexUsage | undefined): number | undefined {
  if (!usage) return undefined
  const output = usage.outputTokens ?? 0
  const reasoning = usage.reasoningOutputTokens ?? 0
  const total = output + reasoning
  return total > 0 ? total : undefined
}

export function turnTokensPerSecond(
  turn: Pick<StackCodexTurn, "startedAt" | "finishedAt" | "usage">,
  nowMs = Date.now(),
): number | undefined {
  const tokens = turnOutputTokens(turn.usage)
  if (tokens === undefined) return undefined
  const start = new Date(turn.startedAt).getTime()
  const end = turn.finishedAt ? new Date(turn.finishedAt).getTime() : nowMs
  const seconds = (end - start) / 1000
  if (!Number.isFinite(seconds) || seconds <= 0.05) return undefined
  return tokens / seconds
}

export function updateEmaTokensPerSecond(
  current: number | undefined,
  sample: number,
  alpha = EMA_ALPHA,
): number {
  if (current === undefined) return sample
  return alpha * sample + (1 - alpha) * current
}

export function seedEmaFromTurns(turns: readonly StackCodexTurn[]): number | undefined {
  let ema: number | undefined
  for (const turn of turns) {
    const sample = turnTokensPerSecond(turn)
    if (sample !== undefined) ema = updateEmaTokensPerSecond(ema, sample)
  }
  return ema
}

export function formatEmaTokensPerSecond(ema: number | undefined): string | undefined {
  return formatAverageTokensPerSecond(ema)
}

export function formatAverageTokensPerSecond(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined
  if (value >= 100) return `avg ${Math.round(value)} tok/s`
  if (value >= 10) return `avg ${value.toFixed(1)} tok/s`
  return `avg ${value.toFixed(2)} tok/s`
}

export function sessionAverageTokensPerSecond(
  turns: readonly StackCodexTurn[],
  nowMs = Date.now(),
  liveTurn?: Pick<StackCodexTurn, "startedAt" | "finishedAt" | "usage">,
): number | undefined {
  let totalTokens = 0
  let totalSeconds = 0
  for (const turn of turns) {
    accumulateTurnThroughput(turn, nowMs, (tokens, seconds) => {
      totalTokens += tokens
      totalSeconds += seconds
    })
  }
  if (liveTurn) {
    accumulateTurnThroughput(liveTurn, nowMs, (tokens, seconds) => {
      totalTokens += tokens
      totalSeconds += seconds
    })
  }
  if (totalSeconds <= 0 || totalTokens <= 0) return undefined
  return totalTokens / totalSeconds
}

export type SessionThroughputSnapshot = {
  averageTokensPerSecond?: number
  emaTokensPerSecond?: number
}

export type LiveTurnThroughput = Pick<StackCodexTurn, "startedAt" | "finishedAt" | "usage">

export function refreshSessionThroughput(
  target: SessionThroughputSnapshot,
  turns: readonly StackCodexTurn[],
  liveTurn?: LiveTurnThroughput,
  nowMs = Date.now(),
): void {
  target.averageTokensPerSecond = sessionAverageTokensPerSecond(turns, nowMs, liveTurn)
  target.emaTokensPerSecond = seedEmaFromTurns(turns)
  if (liveTurn?.usage) {
    const liveSample = turnTokensPerSecond(liveTurn, nowMs)
    if (liveSample !== undefined) {
      target.emaTokensPerSecond = updateEmaTokensPerSecond(target.emaTokensPerSecond, liveSample)
    }
  }
}

export function displayTokensPerSecond(snapshot: SessionThroughputSnapshot): number | undefined {
  return snapshot.averageTokensPerSecond ?? snapshot.emaTokensPerSecond
}

function accumulateTurnThroughput(
  turn: Pick<StackCodexTurn, "startedAt" | "finishedAt" | "usage">,
  nowMs: number,
  add: (tokens: number, seconds: number) => void,
): void {
  const tokens = turnOutputTokens(turn.usage)
  if (tokens === undefined) return
  const start = new Date(turn.startedAt).getTime()
  const end = turn.finishedAt ? new Date(turn.finishedAt).getTime() : nowMs
  const seconds = (end - start) / 1000
  if (!Number.isFinite(seconds) || seconds <= 0.05) return
  add(tokens, seconds)
}

export function resolveDisplayTokensPerSecond(
  turns: readonly StackCodexTurn[],
  emaTokensPerSecond: number | undefined,
  nowMs = Date.now(),
  liveTurn?: LiveTurnThroughput,
): number | undefined {
  return sessionAverageTokensPerSecond(turns, nowMs, liveTurn) ?? emaTokensPerSecond
}

export function compactUsageWithThroughput(
  usage: StackCodexUsage | undefined,
  emaTokensPerSecond: number | undefined,
): string {
  const base = compactUsageBase(usage)
  const throughput = formatAverageTokensPerSecond(emaTokensPerSecond)
  return throughput ? `${base} · ${throughput}` : base
}

function compactUsageBase(usage: StackCodexUsage | undefined): string {
  if (!usage) return "after first turn"
  const input = formatUsageNumber(usage.inputTokens)
  const output = formatUsageNumber(usage.outputTokens)
  return `in ${input} / out ${output}`
}

function formatUsageNumber(value: number | undefined): string {
  return value === undefined ? "-" : value.toLocaleString("en-US")
}
