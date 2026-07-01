import { StyledText, bold, dim, fg, type TextChunk } from "@opentui/core"
import type { StackSessionSummary, StackSessionUsageSummary } from "../session.js"
import { resolveThreadDisplayLabel } from "../thread-display-name.js"
import { formatEstimatedSpend, formatThreadUsageLine, formatTokenTotal, sessionTokenTotal } from "../codex/usage-cost.js"
import { stackTuiTheme as theme } from "./theme.js"

export type ThreadsRailRenderInput = {
  focusMode: string
  history: readonly StackSessionSummary[]
  selectedHistoryIndex: number
  currentSessionId: string
  visibleRows: number
  columns: number
  liveTokensPerSecond?: string
  gardenerThreadIds: ReadonlySet<string>
  gardenerInboxCount: number
  gardenerTalkMode: boolean
  threadMetaThreadTitles?: ReadonlyMap<string, string>
  usageForSummary: (summary: StackSessionSummary) => StackSessionUsageSummary | undefined
}

export function renderThreadsRailStyled(input: ThreadsRailRenderInput): StyledText {
  const chunks: TextChunk[] = []
  const focusHint = input.focusMode === "history" ? "j/k select" : "tab threads"
  chunks.push(dim(fg(theme.fgMuted)(focusHint)))
  chunks.push(fg(theme.fgPrimary)("\n"))
  chunks.push(dim(fg(theme.synth.amber)("n new · enter resume · f fork · stack resume <id> · p gardener")))
  chunks.push(fg(theme.fgPrimary)("\n"))
  chunks.push(
    fg(input.gardenerTalkMode ? "#3fb950" : theme.fgMuted)(
      `Gardener · inbox ${input.gardenerInboxCount} · ${input.gardenerTalkMode ? "talk ON" : "G talk"} · p panel`,
    ),
  )
  chunks.push(fg(theme.fgPrimary)("\n"))

  const rows = threadRowSpecs(input)
  for (const [index, row] of rows.entries()) {
    if (index > 0) chunks.push(fg(theme.fgPrimary)("\n"))
    chunks.push(...styleThreadRow(row))
  }

  return new StyledText(chunks)
}

type ThreadRowSpec =
  | { kind: "pager"; text: string }
  | {
      kind: "thread"
      selected: boolean
      active: boolean
      gardener: boolean
      time: string
      prompt: string
      usage?: string
      usageTokens?: string
      usageSpend?: string
      usageTps?: string
    }

function threadRowSpecs(input: ThreadsRailRenderInput): ThreadRowSpec[] {
  if (input.history.length === 0) {
    return [{ kind: "pager", text: "(no threads yet)" }]
  }

  const start = historyWindowStart(input.history.length, input.selectedHistoryIndex, input.visibleRows)
  const rows: ThreadRowSpec[] = []

  if (start > 0) rows.push({ kind: "pager", text: `  ... ${start} newer` })

  for (const [offset, summary] of input.history.slice(start, start + input.visibleRows).entries()) {
    const index = start + offset
    const usageSummary = input.usageForSummary(summary)
    const usageParts = splitThreadUsage(usageSummary, input.columns - 4, summary.id === input.currentSessionId, input.liveTokensPerSecond)
    const isGardener = input.gardenerThreadIds.has(summary.id)
    rows.push({
      kind: "thread",
      selected: index === input.selectedHistoryIndex,
      active: summary.id === input.currentSessionId,
      gardener: isGardener,
      time: formatRelativeTime(summary.updatedAt),
      prompt: resolveThreadDisplayLabel(summary, {
        isGardener,
        maxLength: 22,
        metaThreadTitle: input.threadMetaThreadTitles?.get(summary.id),
      }),
      usage: usageParts?.combined,
      usageTokens: usageParts?.tokens,
      usageSpend: usageParts?.spend,
      usageTps: usageParts?.tps,
    })
  }

  const hiddenOlder = input.history.length - (start + input.visibleRows)
  if (hiddenOlder > 0) rows.push({ kind: "pager", text: `  ... ${hiddenOlder} older` })
  return rows
}

function styleThreadRow(row: ThreadRowSpec): TextChunk[] {
  if (row.kind === "pager") {
    return [dim(fg(theme.fgMuted)(row.text))]
  }

  const chunks: TextChunk[] = []
  const cursor = row.selected ? "›" : " "
  const activeMarker = row.active ? " ·" : "  "

  if (row.selected) {
    chunks.push(bold(fg(theme.synth.orange)(`${cursor} `)))
    chunks.push(fg(theme.synth.amber)(row.time.padStart(3)))
    if (row.active) chunks.push(fg(theme.synth.orange)(activeMarker))
    else chunks.push(fg(theme.fgMuted)(activeMarker))
    if (row.gardener) chunks.push(fg("#3fb950")(" gard"))
    chunks.push(fg(theme.fgPrimary)(` ${row.prompt}`))
  } else {
    chunks.push(dim(fg(theme.fgMuted)(`${cursor} ${row.time.padStart(3)}${activeMarker}`)))
    if (row.gardener) chunks.push(fg("#3fb950")(" gard"))
    chunks.push(fg(theme.fgMuted)(" "))
    chunks.push(fg(row.active ? theme.fgSecondary : theme.fgMuted)(row.prompt))
  }

  if (row.usageTokens || row.usageSpend || row.usageTps) {
    chunks.push(fg(theme.fgMuted)("\n    "))
    if (row.usageTokens) chunks.push(fg(theme.synth.gold)(row.usageTokens))
    if (row.usageSpend) {
      if (row.usageTokens) chunks.push(dim(fg(theme.synth.warmDim)(" · ")))
      chunks.push(fg(theme.synth.warmMuted)(row.usageSpend))
    }
    if (row.usageTps) {
      if (row.usageTokens || row.usageSpend) chunks.push(dim(fg(theme.synth.warmDim)(" · ")))
      chunks.push(fg(theme.synth.orangeDark)(row.usageTps))
    }
  } else if (row.usage) {
    chunks.push(fg(theme.fgMuted)("\n    "))
    chunks.push(dim(fg(theme.synth.warmMuted)(row.usage)))
  }

  return chunks
}

function splitThreadUsage(
  summary: StackSessionUsageSummary | undefined,
  maxWidth: number,
  isCurrent: boolean,
  liveTokensPerSecond?: string,
): { combined?: string; tokens?: string; spend?: string; tps?: string } | undefined {
  const base = formatThreadUsageLine(summary, maxWidth)
  if (!base) return undefined

  if (!summary) return { combined: base }

  const tokens = `${formatTokenTotal(sessionTokenTotal(summary.totals))} tok`
  const spend = formatEstimatedSpend(summary.estimatedSpendUsd)
  if (isCurrent && liveTokensPerSecond) {
    return { tokens, spend, tps: liveTokensPerSecond }
  }
  if (!spend) return { combined: base, tokens }
  return { combined: base, tokens, spend }
}

function historyWindowStart(historyLength: number, selectedIndex: number, visibleRows: number): number {
  if (historyLength <= visibleRows) return 0
  const middleOffset = Math.floor(visibleRows / 2)
  return Math.max(0, Math.min(historyLength - visibleRows, selectedIndex - middleOffset))
}

function formatRelativeTime(value: string): string {
  const parsed = parseTimestamp(value)
  if (!parsed) return "--"
  const diffMs = Math.max(0, Date.now() - parsed.getTime())
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 14) return `${days}d`
  return `${Math.floor(days / 7)}w`
}

function parseTimestamp(value: string): Date | undefined {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return undefined
  return new Date(parsed)
}

function oneLine(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`
}
