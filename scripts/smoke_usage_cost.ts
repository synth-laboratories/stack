#!/usr/bin/env bun

import {
  aggregateSessionUsage,
  buildSessionUsageSummary,
  estimateUsageSpendUsd,
  formatSessionUsageSummary,
  formatThreadUsageLine,
} from "../src/codex/usage-cost.ts"
import type { StackCodexTurn } from "../src/session.ts"

const turns: StackCodexTurn[] = [
  {
    id: "t1",
    prompt: "hello",
    selectedPaths: [],
    startedAt: "2026-06-26T00:00:00.000Z",
    stdout: "",
    stderr: "",
    usage: {
      inputTokens: 10_000,
      cachedInputTokens: 2_000,
      outputTokens: 500,
      reasoningOutputTokens: 100,
    },
  },
  {
    id: "t2",
    prompt: "again",
    selectedPaths: [],
    startedAt: "2026-06-26T00:01:00.000Z",
    stdout: "",
    stderr: "",
    usage: {
      inputTokens: 5_000,
      cachedInputTokens: 1_000,
      outputTokens: 250,
      reasoningOutputTokens: 50,
    },
  },
]

const totals = aggregateSessionUsage(turns)
if (totals.inputTokens !== 15_000 || totals.turnCountWithUsage !== 2) {
  console.error("aggregateSessionUsage failed")
  process.exit(1)
}

const spend = estimateUsageSpendUsd(totals, "gpt-5.4-mini")
if (spend === undefined || spend <= 0) {
  console.error("estimateUsageSpendUsd failed")
  process.exit(1)
}

const summary = buildSessionUsageSummary(turns, "gpt-5.4-mini")
if (!summary?.estimatedSpendUsd) {
  console.error("buildSessionUsageSummary failed")
  process.exit(1)
}

const threadLine = formatThreadUsageLine(summary)
const sessionLine = formatSessionUsageSummary(summary)
if (!threadLine?.includes("tok") || !sessionLine.includes("eq. API")) {
  console.error("formatting failed", threadLine, sessionLine)
  process.exit(1)
}

console.log("stack_usage_cost_smoke_ok")
console.log(threadLine)
console.log(sessionLine)
