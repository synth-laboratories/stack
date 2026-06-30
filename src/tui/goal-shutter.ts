import { Box, StyledText, Text, dim, fg } from "@opentui/core"
import { formatEstimatedSpend } from "../codex/usage-cost.js"
import { reduceGoalSessionSnapshot } from "../goal-session.js"
import { parseCriterionEntry } from "../meta-thread-goal-criteria.js"
import type { StackMonitorSnapshot } from "../monitor.js"
import type { StackThreadMetaEvent } from "../thread-events.js"
import { activeGoalModeSnapshot, type GoalModeState } from "./goal-mode.js"
import {
  goalShutterStreamLineCount,
  goalShutterStreamRows,
  goalShutterStreamScrollWindow,
  styleGoalShutterStreamLine,
} from "./monitor-thread.js"
import { stackTuiTheme as theme } from "./theme.js"

export type GoalShutterRenderInput = {
  state: GoalModeState & {
    monitorSnapshot: StackMonitorSnapshot
    monitorInputBuffer: string
    focusMode: string
    agentViewEnabled: boolean
  }
  events: StackThreadMetaEvent[]
  columns: number
  visibleRows: number
  scrollOffset: number
  metaThreadId?: string
  sidecarMenuElements?: ReturnType<typeof Text>[]
  onFocusSidecar?: () => void
  onPrefillSidecar?: (prompt: string) => void
}

export function renderGoalShutter(input: GoalShutterRenderInput): ReturnType<typeof Box> {
  const goal = activeGoalModeSnapshot(input.state)
  const cardLines = goalCardLines(input)
  const streamRows = Math.max(4, input.visibleRows - cardLines.length - 5)
  const title = goal.objective
    ? `Goal · ${oneLine(goal.objective, Math.max(24, input.columns - 10))}`
    : "Goal shutter"

  return Box(
    {
      flexDirection: "column",
      flexGrow: 1,
      minHeight: 0,
      gap: 1,
    },
    Text({
      content: title,
      fg: theme.synth.amber,
      width: "100%",
      flexShrink: 0,
    }),
    Box(
      {
        border: true,
        borderStyle: "single",
        borderColor: theme.borderInactive,
        title: "Goal card",
        flexDirection: "column",
        padding: 1,
        flexShrink: 0,
        gap: 0,
        width: "100%",
      },
      ...cardLines.map((line) =>
        Text({
          content: line,
          fg: line.startsWith("blocker") ? theme.synth.red : theme.fgPrimary,
          width: "100%",
          flexShrink: 0,
        }),
      ),
    ),
    Box(
      {
        border: true,
        borderStyle: "single",
        borderColor: theme.borderInactive,
        title: input.state.agentViewEnabled ? "Agent tape" : "Sidecar progress",
        flexDirection: "column",
        padding: 1,
        flexGrow: 1,
        minHeight: 0,
        width: "100%",
        gap: 0,
      },
      ...renderGoalShutterStreamPanel(input, streamRows),
    ),
    Text({
      content: renderSidecarChatInputStyled(input.state),
      bg: sidecarInputBackground(input.state),
      width: "100%",
      flexShrink: 0,
      ...(input.onFocusSidecar
        ? {
            onMouseDown(event: { preventDefault?: () => void; stopPropagation?: () => void }) {
              event.preventDefault?.()
              event.stopPropagation?.()
              input.onFocusSidecar?.()
            },
          }
        : {}),
    }),
    ...(input.sidecarMenuElements ?? []),
    Text({
      content: "m sidecar · click stream · esc worker peek · g goal · a agent tape",
      fg: theme.fgMuted,
      width: "100%",
      flexShrink: 0,
    }),
  )
}

function renderGoalShutterStreamPanel(
  input: GoalShutterRenderInput,
  streamRows: number,
): ReturnType<typeof Text>[] {
  const rows = goalShutterStreamRows(
    input.events,
    input.state.monitorSnapshot,
    input.columns,
    input.state.agentViewEnabled,
  )
  const window = goalShutterStreamScrollWindow(rows, input.scrollOffset, streamRows)
  if (window.length === 0) {
    return [
      Text({
        content: new StyledText([dim(fg(theme.fgMuted)("(no sidecar events yet)"))]),
        flexGrow: 1,
      }),
    ]
  }
  return window.map((row) =>
    Text({
      content: new StyledText(styleGoalShutterStreamLine(row.line)),
      width: "100%",
      flexShrink: 0,
      ...(row.prefill && input.onPrefillSidecar
        ? {
            onMouseDown(event: { preventDefault?: () => void; stopPropagation?: () => void }) {
              event.preventDefault?.()
              event.stopPropagation?.()
              input.onPrefillSidecar?.(row.prefill!)
            },
          }
        : {}),
    }),
  )
}

export function goalShutterLineCount(
  events: StackThreadMetaEvent[],
  columns: number,
  visibleRows: number,
  agentViewEnabled: boolean,
): number {
  return goalShutterStreamLineCount(events, columns, visibleRows, agentViewEnabled)
}

export function renderSidecarChatInputStyled(state: {
  monitorInputBuffer: string
  monitorSnapshot: StackMonitorSnapshot
  focusMode: string
}): StyledText {
  const preview = state.monitorInputBuffer.replace(/\n/g, " ↵ ")
  if (state.monitorSnapshot.status === "running") {
    const running = "Ask sidecar · reviewing"
    if (preview) {
      return new StyledText([
        fg(theme.synth.amber)(`› ${running}`),
        fg(theme.fgMuted)(" · "),
        fg(theme.fgInput)(preview),
        fg(theme.synth.gold)("_"),
      ])
    }
    return new StyledText([fg(theme.synth.amber)(`› ${running}`)])
  }
  if (!preview) {
    return new StyledText([
      fg(theme.synth.amber)("› "),
      dim(fg(theme.fgMuted)("Ask sidecar about this goal · enter sends to monitor")),
    ])
  }
  return new StyledText([
    fg(theme.synth.amber)("› "),
    fg(theme.fgInput)(preview),
    fg(theme.synth.gold)("_"),
  ])
}

export function sidecarInputBackground(state: { focusMode: string; monitorInputBuffer: string }): string {
  if (state.focusMode === "monitor" || state.monitorInputBuffer.length > 0) return theme.bgInputFocused
  return theme.bgPanel
}

function goalCardLines(input: GoalShutterRenderInput): string[] {
  const goal = activeGoalModeSnapshot(input.state)
  const session = reduceGoalSessionSnapshot({
    events: input.events,
    goal,
    metaThreadId: input.metaThreadId,
    monitorThreadSpendUsd: input.state.monitorSnapshot.threadSpendUsd,
  })
  const criteria = session?.criteria_progress ?? criteriaProgress(goal.acceptanceCriteria)
  const operatorUpdate = session?.last_operator_update ?? latestOperatorUpdate(input.events)
  const done = criteria.done
  const total = criteria.total
  const pct = "pct" in criteria && typeof criteria.pct === "number"
    ? criteria.pct
    : total > 0 ? Math.round((done / total) * 100) : 0
  const eta = formatEta(asRecord(session?.last_eta ?? operatorUpdate?.eta))
  const source = goal.source === "manifest" ? "manifest" : goal.source === "codex" ? "codex" : "none"
  const lines = [
    `status ${session?.status ?? goal.status ?? "active"} · source ${source} · criteria ${done}/${total}${total > 0 ? ` (${pct}%)` : ""}`,
    goal.objective ? oneLine(goal.objective, Math.max(24, input.columns - 4)) : "no active goal",
  ]

  const spend = session?.spend
  if (spend || goal.timeUsedSeconds !== undefined || goal.tokensUsed !== undefined) {
    lines.push(
      [
        spend?.elapsed_s ? `elapsed ${formatDuration(spend.elapsed_s)}` : goal.timeUsedSeconds !== undefined ? `elapsed ${formatDuration(goal.timeUsedSeconds)}` : undefined,
        spend ? `worker ${formatEstimatedSpend(spend.worker_usd) ?? "~$0"}` : goal.tokensUsed !== undefined ? `worker ${formatCompactNumber(goal.tokensUsed)} tok` : undefined,
        spend ? `monitor ${formatEstimatedSpend(spend.monitor_usd) ?? "~$0"}` : `monitor ${formatEstimatedSpend(input.state.monitorSnapshot.threadSpendUsd) ?? "~$0"}`,
      ].filter(Boolean).join(" · "),
    )
  } else {
    lines.push(`spend pending · monitor ${formatEstimatedSpend(input.state.monitorSnapshot.threadSpendUsd) ?? "~$0"}`)
  }

  if (eta) lines.push(`eta ${eta}`)
  for (const criterion of goal.acceptanceCriteria.slice(0, 4)) {
    const parsed = parseCriterionEntry(criterion)
    lines.push(`${parsed.done ? "[x]" : "[ ]"} ${oneLine(parsed.label, Math.max(20, input.columns - 8))}`)
  }
  if (goal.acceptanceCriteria.length > 4) {
    lines.push(`... +${goal.acceptanceCriteria.length - 4} criteria`)
  }
  for (const blocker of goal.blockers.slice(0, 2)) {
    lines.push(`blocker · ${oneLine(blocker, Math.max(20, input.columns - 12))}`)
  }
  return lines
}

function criteriaProgress(criteria: readonly string[]): { done: number; total: number } {
  let done = 0
  for (const criterion of criteria) {
    if (parseCriterionEntry(criterion).done) done += 1
  }
  return { done, total: criteria.length }
}

function latestOperatorUpdate(events: readonly StackThreadMetaEvent[]): Record<string, unknown> | undefined {
  for (const event of [...events].reverse()) {
    if (event.type !== "monitor.summary" && event.type !== "monitor.chat.reply") continue
    const update = asRecord(event.payload.operator_update)
    if (update) return update
  }
  return undefined
}

function formatEta(record: Record<string, unknown> | undefined): string | undefined {
  if (!record) return undefined
  const confidence = readString(record.confidence)
  const low = readNumber(record.remaining_minutes_low)
  const high = readNumber(record.remaining_minutes_high)
  if (low === undefined || high === undefined) return undefined
  if (low === 0 && high === 0) return "done"
  const band = low === high ? `${low}m` : `${low}-${high}m`
  return confidence ? `${band} · ${confidence}` : band
}

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 10_000) return `${Math.round(value / 1000)}k`
  return value.toLocaleString("en-US")
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remMinutes = minutes % 60
  return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function oneLine(value: string, maxLength: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim()
  if (trimmed.length <= maxLength) return trimmed
  if (maxLength <= 3) return trimmed.slice(0, maxLength)
  return `${trimmed.slice(0, maxLength - 1)}…`
}
