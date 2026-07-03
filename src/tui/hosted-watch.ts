import type {
  HostedOptimizerRunDetail,
  HostedOptimizerRunSummary,
  HostedOptimizerSnapshot,
} from "../remote/optimizers.js"
import type { RemoteUsageSnapshot } from "../remote/usage.js"

export function hostedOptimizerWatchLines(
  snapshot: HostedOptimizerSnapshot,
  selectedIndex: number,
  usage: RemoteUsageSnapshot,
): string[] {
  const run = snapshot.runs[clampIndex(selectedIndex, snapshot.runs.length)]
  if (!run) return ["watch: no hosted optimizer run selected"]
  const detail = snapshot.runDetails[run.runId]
  const terminal = hostedRunTerminal(run)
  const phase = terminal ? run.status : detail?.phase ?? run.finalizeState ?? run.status
  const artifactNames = detail?.artifactNames ?? []
  const latestEvent = detail?.eventTypes.at(-1)
  return [
    `watch ${terminal ? "terminal" : "live"} · ${oneLine(run.runId, 34)}`,
    `phase ${oneLine(phase, 24)} · cursor ${run.cursorSeq ?? detail?.latestEventSeq ?? "-"} · events ${detail?.eventCount ?? "-"}`,
    `rollouts ${formatNumber(detail?.rolloutCount)} · best ${bestScoreText(detail)} · candidate ${oneLine(detail?.bestCandidateId ?? "-", 18)}`,
    `cost ${formatCost(detail?.costUsd)} · tokens ${formatNumber(detail?.totalTokens)} · org today ${formatCost(usage.spendTodayUsd)}`,
    artifactNames.length
      ? `artifacts ${artifactNames.length}: ${oneLine(artifactNames.join(", "), 46)}`
      : "artifacts 0",
    latestEvent ? `latest event ${oneLine(latestEvent, 36)}` : "latest event -",
    terminal
      ? `terminal ${formatTimestamp(run.terminalAt ?? detail?.backendUpdatedAt)}${run.error ? ` · ${oneLine(run.error, 32)}` : ""}`
      : "terminal notification pending",
  ]
}

function bestScoreText(detail: HostedOptimizerRunDetail | undefined): string {
  if (!detail) return "-"
  if (detail.heldoutReward !== undefined) return `heldout ${formatScore(detail.heldoutReward)}`
  if (detail.trainReward !== undefined) return `train ${formatScore(detail.trainReward)}`
  return "-"
}

function hostedRunTerminal(run: HostedOptimizerRunSummary): boolean {
  if (run.terminalAt) return true
  const status = run.status.toLowerCase()
  return status === "succeeded" || status === "completed" || status === "failed" || status === "cancelled" || status === "canceled"
}

function clampIndex(selectedIndex: number, length: number): number {
  if (length <= 0) return 0
  return Math.max(0, Math.min(length - 1, selectedIndex))
}

function formatNumber(value: number | undefined): string {
  if (value === undefined) return "-"
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)
}

function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")
}

function formatCost(value: number | undefined): string {
  return value === undefined ? "-" : `$${value.toFixed(value > 1 ? 2 : 4)}`
}

function formatTimestamp(value: string | undefined): string {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toISOString().replace("T", " ").slice(0, 19)
}

function oneLine(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, " ").trim()
  return compact.length <= maxLength ? compact : `${compact.slice(0, Math.max(0, maxLength - 1))}…`
}
