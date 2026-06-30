import type {
  StackCodexTurn,
  StackCodexUsage,
  StackSessionUsageSummary,
  StackSessionUsageTotals,
} from "../session.js"

export type CodexModelPricing = {
  model: string
  inputPerMillion: number
  cachedInputPerMillion: number
  outputPerMillion: number
}

const DEFAULT_CODEX_PRICING: CodexModelPricing[] = [
  {
    model: "gpt-5.4-mini",
    inputPerMillion: 0.75,
    cachedInputPerMillion: 0.075,
    outputPerMillion: 4.5,
  },
  {
    model: "gpt-5.5",
    inputPerMillion: 5.0,
    cachedInputPerMillion: 0.5,
    outputPerMillion: 30.0,
  },
  {
    model: "gpt-5.4",
    inputPerMillion: 2.5,
    cachedInputPerMillion: 0.25,
    outputPerMillion: 15.0,
  },
  {
    model: "gpt-5.3-codex",
    inputPerMillion: 1.75,
    cachedInputPerMillion: 0.175,
    outputPerMillion: 14.0,
  },
  {
    model: "gpt-5-codex",
    inputPerMillion: 1.25,
    cachedInputPerMillion: 0.125,
    outputPerMillion: 10.0,
  },
]

export function defaultCodexPricing(): CodexModelPricing[] {
  return DEFAULT_CODEX_PRICING.map((row) => ({ ...row }))
}

export function aggregateSessionUsage(turns: readonly StackCodexTurn[]): StackSessionUsageTotals {
  const totals: StackSessionUsageTotals = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    turnCountWithUsage: 0,
  }

  for (const turn of turns) {
    if (!turn.usage) continue
    totals.turnCountWithUsage += 1
    totals.inputTokens += turn.usage.inputTokens ?? 0
    totals.cachedInputTokens += turn.usage.cachedInputTokens ?? 0
    totals.outputTokens += turn.usage.outputTokens ?? 0
    totals.reasoningOutputTokens += turn.usage.reasoningOutputTokens ?? 0
  }

  return totals
}

export function estimateUsageSpendUsd(
  usage: StackSessionUsageTotals | StackCodexUsage,
  model: string,
  pricingRows: readonly CodexModelPricing[] = DEFAULT_CODEX_PRICING,
): number | undefined {
  const row = resolveModelPricing(model, pricingRows)
  if (!row) return undefined

  const inputTokens = readUsageField(usage, "inputTokens")
  const cachedInputTokens = Math.min(readUsageField(usage, "cachedInputTokens"), inputTokens)
  const outputTokens = readUsageField(usage, "outputTokens")
  const reasoningOutputTokens = readUsageField(usage, "reasoningOutputTokens")
  const nonCachedInputTokens = Math.max(0, inputTokens - cachedInputTokens)

  const cost =
    (nonCachedInputTokens * row.inputPerMillion) / 1_000_000 +
    (cachedInputTokens * row.cachedInputPerMillion) / 1_000_000 +
    ((outputTokens + reasoningOutputTokens) * row.outputPerMillion) / 1_000_000

  return Number.isFinite(cost) ? cost : undefined
}

export function buildSessionUsageSummary(
  turns: readonly StackCodexTurn[],
  model: string,
  pricingRows: readonly CodexModelPricing[] = DEFAULT_CODEX_PRICING,
): StackSessionUsageSummary | undefined {
  const totals = aggregateSessionUsage(turns)
  if (totals.turnCountWithUsage === 0) return undefined
  return {
    model,
    totals,
    estimatedSpendUsd: estimateUsageSpendUsd(totals, model, pricingRows),
  }
}

export function sessionTokenTotal(totals: StackSessionUsageTotals): number {
  return totals.inputTokens + totals.outputTokens + totals.reasoningOutputTokens
}

export function formatTokenTotal(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
  if (value >= 10_000) return `${Math.round(value / 1000)}k`
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`
  return value.toLocaleString("en-US")
}

export function formatEstimatedSpend(usd: number | undefined): string | undefined {
  if (usd === undefined || !Number.isFinite(usd)) return undefined
  if (usd >= 10) return `~$${usd.toFixed(2)}`
  if (usd >= 1) return `~$${usd.toFixed(2)}`
  if (usd >= 0.01) return `~$${usd.toFixed(2)}`
  if (usd >= 0.001) return `~$${usd.toFixed(3)}`
  if (usd > 0) return `~$${usd.toFixed(4)}`
  return "~$0"
}

export function formatThreadUsageLine(summary: StackSessionUsageSummary | undefined, maxWidth = 34): string | undefined {
  if (!summary) return undefined
  const tokens = formatTokenTotal(sessionTokenTotal(summary.totals))
  const spend = formatEstimatedSpend(summary.estimatedSpendUsd)
  const parts = [`${tokens} tok`]
  if (spend) parts.push(spend)
  const line = parts.join(" · ")
  if (line.length <= maxWidth) return line
  return line.slice(0, Math.max(0, maxWidth - 1)) + "…"
}

export function formatSessionUsageSummary(summary: StackSessionUsageSummary | undefined): string {
  if (!summary) return "(after first turn with usage)"
  const tokens = formatTokenTotal(sessionTokenTotal(summary.totals))
  const spend = formatEstimatedSpend(summary.estimatedSpendUsd)
  const turns = `${summary.totals.turnCountWithUsage} turn${summary.totals.turnCountWithUsage === 1 ? "" : "s"}`
  const parts = [`${tokens} tok`, turns, `model ${summary.model}`]
  if (spend) parts.push(`${spend} eq. API`)
  return parts.join(" · ")
}

function resolveModelPricing(
  model: string,
  pricingRows: readonly CodexModelPricing[],
): CodexModelPricing | undefined {
  const normalized = model.trim().toLowerCase()
  const exact = pricingRows.find((row) => row.model.toLowerCase() === normalized)
  if (exact) return exact

  const prefix = pricingRows
    .filter((row) => normalized.startsWith(row.model.toLowerCase()) || row.model.toLowerCase().startsWith(normalized))
    .sort((left, right) => right.model.length - left.model.length)[0]
  if (prefix) return prefix

  return pricingRows[0]
}

function readUsageField(
  usage: StackSessionUsageTotals | StackCodexUsage,
  field: keyof StackSessionUsageTotals,
): number {
  if (field === "turnCountWithUsage") return 0
  const value = usage[field]
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}
