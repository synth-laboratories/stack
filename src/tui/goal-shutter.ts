import { Box, StyledText, Text, dim, fg, type TextChunk } from "@opentui/core"
import {
  goalCompletionSummaryLines,
  goalCompletionSummaryLinesForHistoryEntry,
  goalCompletionSummaryLineCount,
} from "./goal-completion-summary.js"
import { formatGoalCompute } from "../codex/goal-context.js"
import { formatEstimatedSpend } from "../codex/usage-cost.js"
import {
  eventsForGoalHistoryEntry,
  goalHistoryEntryKey,
  listGoalHistory,
  reduceGoalSessionSnapshot,
  type GoalHistoryEntry,
  type ListGoalHistoryOptions,
} from "../goal-session.js"
import { parseCriterionEntry } from "../meta-thread-goal-criteria.js"
import type { StackMonitorSnapshot } from "../monitor.js"
import type { StackMonitorSidecarTurn } from "../monitor-sidecar-codex.js"
import type { StackThreadMetaEvent } from "../thread-events.js"
import { activeGoalModeSnapshot, type GoalModeState } from "./goal-mode.js"
import { deriveMetaGoalName } from "../meta-goal.js"
import {
  goalShutterStreamLineCount,
  renderGoalProgressStripStyled,
  renderGoalProgressTimelineStyled,
  renderGoalShutterStreamStyled,
  renderRecentGoalHumanUpdatesStyled,
  recentGoalHumanUpdateLines,
  renderGoalSidecarThreadRich,
} from "./monitor-thread.js"
import type { TranscriptRenderOptions } from "./transcript.js"
import { anchorTranscriptBox } from "./transcript-slot.js"
import { sidecarAgentActive, sidecarInputStatusLine, type SidecarQueueUiState } from "./sidecar-queue.js"
import { stackTuiTheme as theme, goalLifecycleStatusColor } from "./theme.js"

export type GoalShutterRenderInput = {
  state: GoalModeState & {
    monitorSnapshot: StackMonitorSnapshot
    monitorInputBuffer: string
    focusMode: string
    agentViewEnabled: boolean
    status?: string
    sidecarChatInFlight?: boolean
    sidecarQueuedMessages?: readonly string[]
    spinnerFrame?: number
  }
  events: StackThreadMetaEvent[]
  workerStatus?: "idle" | "running" | "error" | string
  workerTurnStartedAt?: string
  sidecarTurns?: readonly StackMonitorSidecarTurn[]
  sidecarRenderOptions: TranscriptRenderOptions
  sidecarView: "thread" | "events"
  sidecarThreadScrollOffset: number
  columns: number
  visibleRows: number
  streamRows?: number
  scrollOffset: number
  metaThreadId?: string
  metaThreadTitle?: string
  sidecarMenuElements?: ReturnType<typeof Text>[]
  onFocusSidecar?: () => void
  onPrefillSidecar?: (prompt: string) => void
  onSelectChatTab?: () => void
  onSelectProgressTab?: () => void
  onSelectSidecarThread?: () => void
  onSelectSidecarEvents?: () => void
}

function goalTabChip(label: string, hint: string, active: boolean, onSelect: () => void): ReturnType<typeof Box> {
  return Box(
    {
      flexDirection: "row",
      flexShrink: 0,
      padding: 1,
      gap: 1,
      onMouseDown(event: { preventDefault?: () => void; stopPropagation?: () => void }) {
        event.preventDefault?.()
        event.stopPropagation?.()
        onSelect()
      },
    },
    Text({
      content: label,
      fg: active ? theme.fgOnAccent : theme.synth.amber,
      bg: active ? theme.bgChipActive : theme.bgSubtle,
      flexShrink: 0,
    }),
    Text({
      content: hint,
      fg: theme.fgMuted,
      flexShrink: 0,
    }),
  )
}

/** Clickable mode tab for monitor/gardener panels — padded chips with gap (panelGap is 0 globally). */
export function panelTabChip(label: string, active: boolean, onSelect: () => void): ReturnType<typeof Box> {
  return Box(
    {
      flexDirection: "row",
      flexShrink: 0,
      paddingLeft: 1,
      paddingRight: 1,
      onMouseDown(event: { preventDefault?: () => void; stopPropagation?: () => void }) {
        event.preventDefault?.()
        event.stopPropagation?.()
        onSelect()
      },
    },
    Text({
      content: label,
      fg: active ? theme.fgOnAccent : theme.synth.amber,
      bg: active ? theme.bgChipActive : theme.bgSubtle,
      flexShrink: 0,
    }),
  )
}

export function renderPanelTabBar(
  tabs: ReadonlyArray<{ label: string; active: boolean; onSelect: () => void }>,
): ReturnType<typeof Box> {
  return Box(
    {
      flexDirection: "row",
      gap: 1,
      alignItems: "center",
      width: "100%",
      flexShrink: 0,
    },
    ...tabs.map((tab) => panelTabChip(tab.label, tab.active, tab.onSelect)),
  )
}

export function renderGoalPanelTabBar(input: {
  active: "chat" | "progress"
  onSelectChat: () => void
  onSelectProgress: () => void
}): ReturnType<typeof Box> {
  return Box(
    {
      flexDirection: "row",
      width: "100%",
      flexShrink: 0,
      gap: 1,
      alignItems: "center",
      onMouseDown(event: { preventDefault?: () => void; stopPropagation?: () => void }) {
        event.preventDefault?.()
        event.stopPropagation?.()
      },
    },
    Text({ content: "view", fg: theme.fgMuted, flexShrink: 0 }),
    goalTabChip("chat", "1", input.active === "chat", input.onSelectChat),
    goalTabChip("progress", "2", input.active === "progress", input.onSelectProgress),
  )
}

export function renderGoalWorkerPeekPanel(input: {
  active: "chat" | "progress"
  onSelectChat: () => void
  onSelectProgress: () => void
  transcript: StyledText
  objective?: string
  metaThreadTitle?: string
}): ReturnType<typeof Box> {
  const title = input.metaThreadTitle?.trim() || (input.objective ? deriveMetaGoalName(input.objective) : undefined)
  return Box(
    {
      flexDirection: "column",
      flexGrow: 1,
      minHeight: 0,
      gap: 1,
    },
    ...(title
      ? [
          Text({
            content: `Goal · ${title}`,
            fg: theme.synth.amber,
            width: "100%",
            flexShrink: 0,
          }),
        ]
      : []),
    renderGoalPanelTabBar({
      active: input.active,
      onSelectChat: input.onSelectChat,
      onSelectProgress: input.onSelectProgress,
    }),
    anchorTranscriptBox(input.transcript),
  )
}

export const GOAL_SHUTTER_SIDECAR_THREAD_ROWS = 5

export function goalWorkerPeekTranscriptRows(visibleRows: number, goalStripLines = 0): number {
  const chromeRows = 2 + Math.max(0, goalStripLines) + 5 + 2
  return Math.max(4, visibleRows - chromeRows)
}

export function goalShutterStreamVisibleRows(
  visibleRows: number,
  goalCardLineCount: number,
  sidecarMenuRows = 0,
): number {
  const chromeRows = 3 + goalCardLineCount + 7 + sidecarMenuRows
  return Math.max(3, visibleRows - chromeRows)
}

export function goalShutterCardLineCount(
  input: Pick<GoalShutterRenderInput, "state" | "events" | "columns" | "metaThreadId">,
): number {
  return goalCardLines(input).length
}

export function renderSidecarQueuedMessages(
  messages: readonly string[],
  columns: number,
): ReturnType<typeof Box> | undefined {
  if (messages.length === 0) return undefined
  const width = Math.max(16, columns - 4)
  return Box(
    {
      border: true,
      borderStyle: "single",
      borderColor: theme.synth.amber,
      title: "queued",
      flexDirection: "column",
      padding: 1,
      flexShrink: 0,
      gap: 0,
      width: "100%",
    },
    ...messages.map((message) =>
      Text({
        content: oneLine(`○ ${message}`, width),
        fg: theme.fgSecondary,
        width: "100%",
        flexShrink: 0,
      }),
    ),
    Text({
      content: "sends when sidecar is free · ctrl+enter send now",
      fg: theme.fgMuted,
      width: "100%",
      flexShrink: 0,
    }),
  )
}

export function goalShutterProgressChromeRows(_events: StackThreadMetaEvent[], _columns: number): number {
  return goalProgressChromeRowCount(6)
}

export type MonitorGoalViewInput = Pick<
  GoalShutterRenderInput,
  "state" | "events" | "columns" | "metaThreadId" | "metaThreadTitle" | "workerStatus" | "workerTurnStartedAt"
>

const MONITOR_GOAL_TIMELINE_ROWS = 4
const MONITOR_GOAL_TIMELINE_ROWS_COMPLETE = 3
const MONITOR_GOAL_COMPLETION_MAX_LINES = 10
const MONITOR_GOAL_HUMAN_UPDATE_ROWS = 5

function monitorGoalHumanUpdateChromeRows(input: MonitorGoalViewInput): number {
  const lineCount = recentGoalHumanUpdateLines(
    input.events,
    input.state.monitorSnapshot,
    input.columns,
    MONITOR_GOAL_HUMAN_UPDATE_ROWS,
  ).length
  if (lineCount === 0) return 0
  return lineCount + 2
}

function goalProgressChromeRowCount(timelineRows: number): number {
  return 1 + timelineRows + 2
}

function goalProgressChromeElements(
  events: StackThreadMetaEvent[],
  columns: number,
  timelineRows: number,
  title: string,
): Array<ReturnType<typeof Text> | ReturnType<typeof Box>> {
  const progressWidth = Math.max(24, columns - 4)
  const progressStrip = renderGoalProgressStripStyled(events, progressWidth)
  return [
    progressStrip
      ? Text({ content: progressStrip, width: "100%", flexShrink: 0 })
      : Text({
          content: oneLine("◦ waiting for monitor progress updates", progressWidth),
          fg: theme.fgMuted,
          width: "100%",
          flexShrink: 0,
        }),
    Box(
      {
        border: true,
        borderStyle: "single",
        borderColor: theme.borderInactive,
        titleColor: theme.synth.orange,
        title,
        flexDirection: "column",
        padding: 1,
        flexShrink: 0,
        width: "100%",
        overflow: "hidden",
      },
      Text({
        content: renderGoalProgressTimelineStyled(events, progressWidth, timelineRows),
        width: "100%",
        flexShrink: 0,
      }),
    ),
  ]
}

function monitorGoalFixedChromeRows(input: MonitorGoalViewInput): number {
  const completionCount = goalCompletionSummaryLineCount(input)
  const timelineRows = completionCount > 0 ? MONITOR_GOAL_TIMELINE_ROWS_COMPLETE : MONITOR_GOAL_TIMELINE_ROWS
  const progressRows = goalProgressChromeRowCount(timelineRows)
  if (completionCount > 0) {
    return Math.min(completionCount, MONITOR_GOAL_COMPLETION_MAX_LINES) + 2 + progressRows + monitorGoalHumanUpdateChromeRows(input)
  }
  return 3 + progressRows + monitorGoalHumanUpdateChromeRows(input)
}

export function monitorGoalViewLineCount(input: MonitorGoalViewInput): number {
  const cardLines = goalCardLines(input)
  return monitorGoalFixedChromeRows(input) + monitorGoalScrollLines(cardLines).length
}

export function monitorGoalViewMaxScroll(input: MonitorGoalViewInput, visibleRows: number): number {
  const cardLines = goalCardLines(input)
  const fixedRows = monitorGoalFixedChromeRows(input)
  const scrollRows = Math.max(2, visibleRows - fixedRows)
  return Math.max(0, monitorGoalScrollLines(cardLines).length - scrollRows)
}

function renderGoalHumanUpdatesBox(input: MonitorGoalViewInput): ReturnType<typeof Box> | undefined {
  const styled = renderRecentGoalHumanUpdatesStyled(
    input.events,
    input.state.monitorSnapshot,
    input.columns,
    MONITOR_GOAL_HUMAN_UPDATE_ROWS,
  )
  if (!styled) return undefined
  return Box(
    {
      border: true,
      borderStyle: "single",
      borderColor: theme.borderInactive,
      titleColor: theme.synth.orange,
      title: "Monitor updates",
      flexDirection: "column",
      padding: 1,
      flexShrink: 0,
      width: "100%",
      overflow: "hidden",
    },
    Text({
      content: styled,
      width: "100%",
      flexShrink: 0,
    }),
  )
}

function renderGoalCompletionSummaryBox(
  lines: string[],
  columns: number,
): ReturnType<typeof Box> {
  const width = Math.max(20, columns - 4)
  return Box(
    {
      border: true,
      borderStyle: "single",
      borderColor: theme.synth.gold,
      titleColor: theme.synth.gold,
      title: "Complete",
      flexDirection: "column",
      padding: 1,
      flexShrink: 0,
      width: "100%",
      gap: 0,
      overflow: "hidden",
    },
    ...lines.slice(0, MONITOR_GOAL_COMPLETION_MAX_LINES).map((line, index) =>
      Text({
        content: oneLine(line, width),
        fg:
          index === 0
            ? theme.synth.gold
            : line.endsWith(":") || (!line.startsWith("  ") && index > 0)
              ? theme.synth.amber
              : theme.fgPrimary,
        width: "100%",
        flexShrink: 0,
      }),
    ),
  )
}

function monitorGoalDetailLines(cardLines: string[]): string[] {
  return cardLines.filter(
    (line) =>
      line.startsWith("[x]") ||
      line.startsWith("[ ]") ||
      line.startsWith("blocker") ||
      line.startsWith("eta ") ||
      line.startsWith("..."),
  )
}

function monitorGoalScrollLines(cardLines: string[]): string[] {
  const details = monitorGoalDetailLines(cardLines)
  if (details.length > 0) return details
  return cardLines.slice(1)
}

function goalHistoryListOptions(
  state: GoalModeState,
  metaThreadId?: string,
): ListGoalHistoryOptions {
  return {
    metaThreadId,
    manifestGoal: state.metaThreadManifest?.active_goal,
  }
}

function formatHistoryTimestamp(value: string | undefined): string | undefined {
  if (!value) return undefined
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return undefined
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function goalHistorySpendLine(
  entry: GoalHistoryEntry,
  events: readonly StackThreadMetaEvent[],
  metaThreadId?: string,
): string | undefined {
  const scoped = eventsForGoalHistoryEntry(events, entry)
  const session = reduceGoalSessionSnapshot({
    events: scoped,
    goal: { objective: entry.objective, status: entry.status, acceptanceCriteria: [] },
    metaThreadId,
  })
  if (!session) return undefined
  const tokens = (session.spend.worker_tokens ?? 0) + (session.spend.monitor_tokens ?? 0)
  const elapsed =
    entry.started_at && entry.ended_at
      ? Math.max(0, Math.round((Date.parse(entry.ended_at) - Date.parse(entry.started_at)) / 1000))
      : session.spend.elapsed_s
  return formatGoalCompute({
    source: "none",
    tokensUsed: tokens > 0 ? tokens : undefined,
    timeUsedSeconds: elapsed > 0 ? elapsed : undefined,
  })
}

function goalHistoryCardLines(input: {
  entry: GoalHistoryEntry
  events: readonly StackThreadMetaEvent[]
  state: GoalModeState & { monitorSnapshot: StackMonitorSnapshot }
  metaThreadId?: string
  columns: number
}): string[] {
  const scoped = eventsForGoalHistoryEntry(input.events, input.entry)
  const acceptanceCriteria = acceptanceCriteriaForHistoryEntry(scoped, input.entry.objective)
  const session = reduceGoalSessionSnapshot({
    events: scoped,
    goal: {
      objective: input.entry.objective,
      status: input.entry.status,
      acceptanceCriteria,
    },
    metaThreadId: input.metaThreadId,
    monitorThreadSpendUsd: input.state.monitorSnapshot.threadSpendUsd,
  })
  const criteria = session?.criteria_progress ?? criteriaProgress(acceptanceCriteria)
  const operatorUpdate = session?.last_operator_update ?? latestOperatorUpdate(scoped)
  const done = criteria.done
  const total = criteria.total
  const pct =
    "pct" in criteria && typeof criteria.pct === "number"
      ? criteria.pct
      : total > 0
        ? Math.round((done / total) * 100)
        : 0
  const eta = formatEta(asRecord(session?.last_eta ?? operatorUpdate?.eta))
  const status = normalizeDisplayGoalStatus(session?.status ?? input.entry.status ?? "done")
  const lines = [`status ${status} · criteria ${done}/${total}${total > 0 ? ` (${pct}%)` : ""}`]

  const spend = session?.spend
  if (spend) {
    lines.push(
      [
        spend.elapsed_s ? `elapsed ${formatDuration(spend.elapsed_s)}` : undefined,
        spend.worker_tokens ? `worker ${formatCompactNumber(spend.worker_tokens)} tok` : undefined,
        spend.monitor_tokens ? `monitor ${formatCompactNumber(spend.monitor_tokens)} tok` : undefined,
        formatEstimatedSpend(spend.worker_usd) ? `worker ${formatEstimatedSpend(spend.worker_usd)}` : undefined,
        formatEstimatedSpend(spend.monitor_usd) ? `monitor ${formatEstimatedSpend(spend.monitor_usd)}` : undefined,
      ]
        .filter(Boolean)
        .join(" · "),
    )
  }

  const started = formatHistoryTimestamp(input.entry.started_at)
  const ended = formatHistoryTimestamp(input.entry.ended_at)
  if (started || ended) {
    lines.push(
      [started ? `started ${started}` : undefined, ended ? `ended ${ended}` : undefined].filter(Boolean).join(" · "),
    )
  }

  if (eta) lines.push(`eta ${eta}`)
  const criteriaStates = session?.criteria_states ?? []
  if (criteriaStates.length > 0) {
    for (const criterion of criteriaStates.slice(0, 4)) {
      const doneMark =
        criterion.state === "audit_clean" || criterion.state === "worker_marked" ? "[x]" : "[ ]"
      lines.push(`${doneMark} ${oneLine(criterion.criterion, Math.max(20, input.columns - 8))}`)
    }
    if (criteriaStates.length > 4) lines.push(`... +${criteriaStates.length - 4} criteria`)
  } else {
    for (const criterion of acceptanceCriteria.slice(0, 4)) {
      const parsed = parseCriterionEntry(criterion)
      lines.push(`${parsed.done ? "[x]" : "[ ]"} ${oneLine(parsed.label, Math.max(20, input.columns - 8))}`)
    }
    if (acceptanceCriteria.length > 4) lines.push(`... +${acceptanceCriteria.length - 4} criteria`)
  }
  return lines
}

function acceptanceCriteriaForHistoryEntry(
  scoped: readonly StackThreadMetaEvent[],
  objective: string,
): string[] {
  for (const event of [...scoped].reverse()) {
    if (event.type !== "meta_thread.goal_updated") continue
    if (readString(event.payload.objective) !== objective) continue
    const raw = event.payload.acceptance_criteria
    if (!Array.isArray(raw)) continue
    return raw.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
  }
  return []
}

function previousGoalExpandedVisualRowCount(input: {
  entry: GoalHistoryEntry
  events: readonly StackThreadMetaEvent[]
  state: GoalModeState & { monitorSnapshot: StackMonitorSnapshot }
  metaThreadId?: string
  columns: number
}): number {
  const scoped = eventsForGoalHistoryEntry(input.events, input.entry)
  const completionLines = goalCompletionSummaryLinesForHistoryEntry({
    objective: input.entry.objective,
    status: input.entry.status,
    events: scoped,
    state: input.state,
    metaThreadId: input.metaThreadId,
    columns: input.columns,
  })
  const terminal = completionLines !== undefined
  const timelineRows = terminal ? MONITOR_GOAL_TIMELINE_ROWS_COMPLETE : MONITOR_GOAL_TIMELINE_ROWS
  let rows = goalProgressChromeRowCount(timelineRows)
  if (terminal && completionLines) {
    rows += Math.min(completionLines.length, MONITOR_GOAL_COMPLETION_MAX_LINES) + 2
  } else {
    rows += 1
  }
  const humanLineCount = recentGoalHumanUpdateLines(
    scoped,
    input.state.monitorSnapshot,
    input.columns,
    MONITOR_GOAL_HUMAN_UPDATE_ROWS,
  ).length
  if (humanLineCount > 0) rows += humanLineCount + 2
  rows += monitorGoalScrollLines(
    goalHistoryCardLines({
      entry: input.entry,
      events: input.events,
      state: input.state,
      metaThreadId: input.metaThreadId,
      columns: input.columns,
    }),
  ).length
  return rows + 1
}

function renderHistoryGoalHumanUpdatesBox(
  events: readonly StackThreadMetaEvent[],
  monitorSnapshot: StackMonitorSnapshot,
  columns: number,
): ReturnType<typeof Box> | undefined {
  const styled = renderRecentGoalHumanUpdatesStyled(
    [...events],
    monitorSnapshot,
    columns,
    MONITOR_GOAL_HUMAN_UPDATE_ROWS,
  )
  if (!styled) return undefined
  return Box(
    {
      border: true,
      borderStyle: "single",
      borderColor: theme.borderInactive,
      titleColor: theme.synth.orange,
      title: "Monitor updates",
      flexDirection: "column",
      padding: 1,
      flexShrink: 0,
      width: "100%",
      overflow: "hidden",
    },
    Text({
      content: styled,
      width: "100%",
      flexShrink: 0,
    }),
  )
}

function renderPreviousGoalExpandedPanel(input: {
  entry: GoalHistoryEntry
  events: readonly StackThreadMetaEvent[]
  state: GoalModeState & { monitorSnapshot: StackMonitorSnapshot }
  metaThreadId?: string
  columns: number
}): ReturnType<typeof Box> {
  const scoped = eventsForGoalHistoryEntry(input.events, input.entry)
  const cardLines = goalHistoryCardLines({
    entry: input.entry,
    events: input.events,
    state: input.state,
    metaThreadId: input.metaThreadId,
    columns: input.columns,
  })
  const completionLines = goalCompletionSummaryLinesForHistoryEntry({
    objective: input.entry.objective,
    status: input.entry.status,
    events: scoped,
    state: input.state,
    metaThreadId: input.metaThreadId,
    columns: input.columns,
  })
  const terminal = completionLines !== undefined
  const timelineRows = terminal ? MONITOR_GOAL_TIMELINE_ROWS_COMPLETE : MONITOR_GOAL_TIMELINE_ROWS
  const progressWidth = Math.max(24, input.columns - 4)
  const humanUpdatesBox = renderHistoryGoalHumanUpdatesBox(
    scoped,
    input.state.monitorSnapshot,
    input.columns,
  )
  const detailLines = monitorGoalScrollLines(cardLines)

  return Box(
    {
      flexDirection: "column",
      flexGrow: 0,
      flexShrink: 0,
      minHeight: 0,
      width: "100%",
      gap: 1,
      paddingLeft: 2,
      overflow: "hidden",
    },
    ...(terminal && completionLines
      ? [renderGoalCompletionSummaryBox(completionLines, input.columns)]
      : [
          Text({
            content: goalStatusStrip(cardLines, progressWidth),
            fg: theme.fgMuted,
            width: "100%",
            flexShrink: 0,
          }),
        ]),
    ...goalProgressChromeElements([...scoped], input.columns, timelineRows, "Audit trail"),
    ...(humanUpdatesBox ? [humanUpdatesBox] : []),
    ...detailLines.map((line) =>
      Text({
        content: line,
        fg: line.startsWith("blocker")
          ? theme.synth.orange
          : line.startsWith("[x]")
            ? theme.goalLifecycle.done
            : line.startsWith("[ ]")
              ? theme.fgSecondary
              : theme.fgPrimary,
        width: "100%",
        flexShrink: 0,
      }),
    ),
  )
}

export type PreviousGoalListItem =
  | {
      kind: "text"
      text: string
      fg: string
      entryKey?: string
      rowCount: number
    }
  | {
      kind: "expanded"
      entry: GoalHistoryEntry
      entryKey: string
      rowCount: number
    }

export function buildPreviousGoalsListItems(input: {
  state: GoalModeState & { monitorSnapshot: StackMonitorSnapshot }
  events: readonly StackThreadMetaEvent[]
  metaThreadId?: string
  columns: number
  expandedKeys: ReadonlySet<string>
  selectedIndex?: number
}): PreviousGoalListItem[] {
  const options = goalHistoryListOptions(input.state, input.metaThreadId)
  const entries = listGoalHistory(input.events, options)
  const width = Math.max(24, input.columns - 4)
  const items: PreviousGoalListItem[] = [
    { kind: "text", text: "Previous goals", fg: theme.synth.amber, rowCount: 1 },
    {
      kind: "text",
      text: "click or enter to expand · this metathread only",
      fg: theme.fgMuted,
      rowCount: 1,
    },
    { kind: "text", text: "", fg: theme.fgPrimary, rowCount: 1 },
  ]
  if (entries.length === 0) {
    items.push({
      kind: "text",
      text: "No previous goals on this metathread.",
      fg: theme.fgMuted,
      rowCount: 1,
    })
    return items
  }
  entries.forEach((entry, index) => {
    const key = goalHistoryEntryKey(entry)
    const expanded = input.expandedKeys.has(key)
    const selected = input.selectedIndex === index
    const marker = expanded ? "▾" : "▸"
    const prefix = selected ? "› " : "  "
    items.push({
      kind: "text",
      text: oneLine(`${prefix}${marker} ${entry.status} · ${entry.objective}`, width),
      fg: goalLifecycleStatusColor(entry.status),
      entryKey: key,
      rowCount: 1,
    })
    const stats = goalHistorySpendLine(entry, input.events, input.metaThreadId)
    if (stats) {
      items.push({
        kind: "text",
        text: oneLine(`    ${stats}`, width),
        fg: theme.fgMuted,
        entryKey: key,
        rowCount: 1,
      })
    }
    if (expanded) {
      items.push({
        kind: "expanded",
        entry,
        entryKey: key,
        rowCount: previousGoalExpandedVisualRowCount({
          entry,
          events: input.events,
          state: input.state,
          metaThreadId: input.metaThreadId,
          columns: input.columns,
        }),
      })
    }
  })
  return items
}

export type PreviousGoalListRow = {
  text: string
  fg: string
  entryIndex?: number
  entryKey?: string
  toggle?: () => void
}

export function buildPreviousGoalsListRows(input: {
  state: GoalModeState & { monitorSnapshot: StackMonitorSnapshot }
  events: readonly StackThreadMetaEvent[]
  metaThreadId?: string
  columns: number
  expandedKeys: ReadonlySet<string>
  selectedIndex?: number
}): PreviousGoalListRow[] {
  return buildPreviousGoalsListItems(input).flatMap((item) => {
    if (item.kind === "expanded") {
      return Array.from({ length: item.rowCount }, () => ({
        text: "",
        fg: theme.fgPrimary,
        entryKey: item.entryKey,
      }))
    }
    return [{ text: item.text, fg: item.fg, entryKey: item.entryKey }]
  })
}

export function previousGoalsListLineCount(input: {
  state: GoalModeState & { monitorSnapshot: StackMonitorSnapshot }
  events: readonly StackThreadMetaEvent[]
  metaThreadId?: string
  columns: number
  expandedKeys: ReadonlySet<string>
  selectedIndex?: number
}): number {
  return buildPreviousGoalsListItems(input).reduce((total, item) => total + item.rowCount, 0)
}

export function previousGoalsListMaxScroll(input: {
  state: GoalModeState & { monitorSnapshot: StackMonitorSnapshot }
  events: readonly StackThreadMetaEvent[]
  metaThreadId?: string
  columns: number
  expandedKeys: ReadonlySet<string>
  selectedIndex?: number
  visibleRows: number
}): number {
  return Math.max(0, previousGoalsListLineCount(input) - input.visibleRows)
}

export function renderPreviousGoalsListPanel(input: {
  state: GoalModeState & { monitorSnapshot: StackMonitorSnapshot }
  events: readonly StackThreadMetaEvent[]
  metaThreadId?: string
  columns: number
  visibleRows: number
  scrollOffset: number
  expandedKeys: ReadonlySet<string>
  selectedIndex: number
  onToggleEntry?: (entryKey: string) => void
}): ReturnType<typeof Box> {
  const items = buildPreviousGoalsListItems({
    state: input.state,
    events: input.events,
    metaThreadId: input.metaThreadId,
    columns: input.columns,
    expandedKeys: input.expandedKeys,
    selectedIndex: input.selectedIndex,
  })
  const maxScroll = Math.max(
    0,
    items.reduce((total, item) => total + item.rowCount, 0) - input.visibleRows,
  )
  const offset = Math.max(0, Math.min(input.scrollOffset, maxScroll))

  let skip = offset
  const children: Array<ReturnType<typeof Text> | ReturnType<typeof Box>> = []
  let used = 0

  for (const item of items) {
    if (skip >= item.rowCount) {
      skip -= item.rowCount
      continue
    }
    if (used >= input.visibleRows) break

    if (item.kind === "text") {
      children.push(
        Text({
          content: item.text || " ",
          fg: item.fg,
          width: "100%",
          flexShrink: 0,
          ...(item.entryKey && input.onToggleEntry
            ? {
                onMouseDown(event: { preventDefault?: () => void; stopPropagation?: () => void }) {
                  event.preventDefault?.()
                  event.stopPropagation?.()
                  input.onToggleEntry?.(item.entryKey!)
                },
              }
            : {}),
        }),
      )
      used += 1
      continue
    }

    children.push(
      renderPreviousGoalExpandedPanel({
        entry: item.entry,
        events: input.events,
        state: input.state,
        metaThreadId: input.metaThreadId,
        columns: input.columns,
      }),
    )
    used += item.rowCount
  }

  return Box(
    {
      flexDirection: "column",
      flexGrow: 1,
      minHeight: 0,
      width: "100%",
      gap: 1,
      overflow: "hidden",
    },
    ...children,
  )
}

export function renderMonitorGoalViewPanel(
  input: MonitorGoalViewInput & { visibleRows: number; scrollOffset: number },
): ReturnType<typeof Box> {
  const progressWidth = Math.max(24, input.columns - 4)
  const cardLines = goalCardLines(input)
  const goal = activeGoalModeSnapshot(input.state)
  const titleText = input.metaThreadTitle?.trim() || goal.objective
  const completionLines = goalCompletionSummaryLines(input)
  const terminal = completionLines !== undefined
  const timelineRows = terminal ? MONITOR_GOAL_TIMELINE_ROWS_COMPLETE : MONITOR_GOAL_TIMELINE_ROWS
  const scrollLines = monitorGoalScrollLines(cardLines)
  const fixedRows = monitorGoalFixedChromeRows(input)
  const scrollRows = Math.max(2, input.visibleRows - fixedRows)
  const maxScroll = Math.max(0, scrollLines.length - scrollRows)
  const offset = Math.max(0, Math.min(input.scrollOffset, maxScroll))
  const visibleDetail = scrollLines.slice(offset, offset + scrollRows)
  const humanUpdatesBox = renderGoalHumanUpdatesBox(input)

  return Box(
    {
      flexDirection: "column",
      flexGrow: 1,
      minHeight: 0,
      width: "100%",
      gap: 1,
      overflow: "hidden",
    },
    ...(!terminal && titleText
      ? [
          Text({
            content: `Goal · ${oneLine(titleText, progressWidth)}`,
            fg: theme.synth.amber,
            width: "100%",
            flexShrink: 0,
          }),
        ]
      : []),
    ...(terminal && completionLines
      ? [renderGoalCompletionSummaryBox(completionLines, input.columns)]
      : [
          Text({
            content: goalStatusStrip(cardLines, progressWidth),
            fg: theme.fgMuted,
            width: "100%",
            flexShrink: 0,
          }),
          Text({
            content: workerLivenessStrip(input, progressWidth),
            fg: workerLivenessColor(input),
            width: "100%",
            flexShrink: 0,
          }),
        ]),
    ...goalProgressChromeElements(
      input.events,
      input.columns,
      timelineRows,
      terminal ? "Audit trail" : "Goal progress",
    ),
    ...(humanUpdatesBox ? [humanUpdatesBox] : []),
    Box(
      {
        flexDirection: "column",
        flexGrow: 1,
        minHeight: 0,
        width: "100%",
        gap: 0,
        overflow: "hidden",
      },
      ...visibleDetail.map((line) =>
        Text({
          content: line,
          fg: line.startsWith("blocker")
            ? theme.synth.orange
            : line.startsWith("[x]")
              ? theme.goalLifecycle.done
              : line.startsWith("[ ]")
                ? theme.fgSecondary
                : theme.fgPrimary,
          width: "100%",
          flexShrink: 0,
        }),
      ),
    ),
  )
}

export function renderMonitorGoalViewStyled(
  input: MonitorGoalViewInput & { scrollOffset?: number; visibleRows: number },
): StyledText {
  const progressWidth = Math.max(24, input.columns - 4)
  const cardLines = goalCardLines(input)
  const goal = activeGoalModeSnapshot(input.state)
  const titleText = input.metaThreadTitle?.trim() || goal.objective
  const offset = input.scrollOffset ?? 0
  const chunks: TextChunk[] = []
  const lines: Array<{ text: string; fg: string }> = []
  if (titleText) lines.push({ text: `Goal · ${oneLine(titleText, progressWidth)}`, fg: theme.synth.amber })
  lines.push({ text: goalStatusStrip(cardLines, progressWidth), fg: theme.fgMuted })
  lines.push({ text: workerLivenessStrip(input, progressWidth), fg: workerLivenessColor(input) })
  lines.push({ text: "", fg: theme.fgPrimary })
  for (const line of cardLines) {
    lines.push({
      text: line,
      fg: line.startsWith("blocker")
        ? theme.synth.orange
        : line.startsWith("[x]")
          ? theme.goalLifecycle.done
          : theme.fgSecondary,
    })
  }
  for (const [index, line] of lines.slice(offset, offset + input.visibleRows).entries()) {
    if (index > 0) chunks.push(fg(theme.fgPrimary)("\n"))
    chunks.push(fg(line.fg)(line.text || " "))
  }
  return new StyledText(chunks)
}

export function renderGoalShutter(input: GoalShutterRenderInput): ReturnType<typeof Box> {
  const goal = activeGoalModeSnapshot(input.state)
  const cardLines = goalCardLines(input)
  const sidecarMenuRows = input.sidecarMenuElements?.length ? 1 : 0
  const progressWidth = Math.max(24, input.columns - 4)
  const progressChromeRows = goalProgressChromeRowCount(6)
  const streamRows =
    input.streamRows ??
    goalShutterStreamVisibleRows(input.visibleRows, 1, sidecarMenuRows + progressChromeRows)
  const sidecarColumns = Math.max(20, input.columns - 4)
  const sidecarThreadRows = Math.max(3, streamRows)
  const titleText = input.metaThreadTitle?.trim() || goal.objective
  const title = titleText
    ? `Goal · ${oneLine(titleText, Math.max(24, input.columns - 10))}`
    : "Goal shutter"
  const monitorModel = input.state.monitorSnapshot.model
  const monitorEffort = input.state.monitorSnapshot.reasoningEffort
  // Model goes on a line INSIDE the box, not in the border title — a long title gets truncated in
  // the narrow split layout, which would clip the "Sidecar thread" anchor.
  const monitorModelLine = monitorModel
    ? `monitor · ${monitorModel}${monitorEffort ? ` · ${monitorEffort}` : ""}`
    : undefined
  const sidecarTitle =
    input.sidecarView === "events"
      ? input.state.agentViewEnabled
        ? "Agent tape"
        : "Sidecar events"
      : "Sidecar thread"

  const goalProgressElements = goalProgressChromeElements(input.events, input.columns, 6, "Goal progress")

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
    ...(input.onSelectChatTab && input.onSelectProgressTab
      ? [
          renderGoalPanelTabBar({
            active: "progress",
            onSelectChat: input.onSelectChatTab,
            onSelectProgress: input.onSelectProgressTab,
          }),
        ]
      : []),
    // Compact one-line status strip instead of a bordered card — frees ~5 rows for the sidecar
    // thread. The full goal card (criteria list, ETA, blockers) lives in the progress tab.
    Text({
      content: goalStatusStrip(cardLines, Math.max(24, input.columns - 4)),
      fg: theme.fgMuted,
      width: "100%",
      flexShrink: 0,
    }),
    Text({
      content: workerLivenessStrip(input, Math.max(24, input.columns - 4)),
      fg: workerLivenessColor(input),
      width: "100%",
      flexShrink: 0,
    }),
    ...goalProgressElements,
    Box(
      {
        border: true,
        borderStyle: "single",
        borderColor: theme.borderInactive,
        titleColor: theme.synth.orange,
        title: sidecarTitle,
        flexDirection: "column",
        padding: 1,
        flexGrow: 1,
        minHeight: 0,
        width: "100%",
        gap: 1,
        overflow: "hidden",
      },
      Box(
        {
          flexDirection: "row",
          flexShrink: 0,
          width: "100%",
          gap: 1,
        },
        goalTabChip(
          "thread",
          "t",
          input.sidecarView === "thread",
          input.onSelectSidecarThread ?? (() => undefined),
        ),
        goalTabChip(
          "events",
          "e",
          input.sidecarView === "events",
          input.onSelectSidecarEvents ?? (() => undefined),
        ),
      ),
      ...(input.sidecarView === "thread" && monitorModelLine
        ? [Text({ content: monitorModelLine, fg: theme.fgMuted, width: "100%", flexShrink: 0 })]
        : []),
      ...(input.sidecarView === "events"
        ? [
            Box(
              {
                flexDirection: "column",
                flexGrow: 1,
                flexShrink: 1,
                minHeight: 0,
                overflow: "hidden",
                width: "100%",
              },
              anchorTranscriptBox(
                renderGoalShutterStreamStyled(
                  input.events,
                  input.state.monitorSnapshot,
                  sidecarColumns,
                  streamRows,
                  input.scrollOffset,
                  input.state.agentViewEnabled,
                ),
                1,
              ),
            ),
          ]
        : [
        Box(
          {
            flexDirection: "column",
            flexGrow: 1,
            flexShrink: 1,
            minHeight: 0,
            justifyContent: "flex-end",
            overflow: "hidden",
          },
          Text({
            content: renderGoalSidecarThreadRich(
              {
                turns: input.sidecarTurns,
                events: input.events,
                columns: sidecarColumns,
                visibleRows: sidecarThreadRows,
                scrollOffset: input.sidecarThreadScrollOffset,
                options: input.sidecarRenderOptions,
              },
            ),
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
          ]),
      ...(input.sidecarView === "events"
        ? [
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
          ]
        : []),
      ...(input.sidecarMenuElements ?? []),
    ),
    ...(input.state.sidecarQueuedMessages?.length
      ? [renderSidecarQueuedMessages(input.state.sidecarQueuedMessages, input.columns)!]
      : []),
    Text({
      content: "worker chat stays open · t thread · e events · m message sidecar · g goal · a agent tape",
      fg: theme.fgMuted,
      width: "100%",
      flexShrink: 0,
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

export function renderSidecarChatInputStyled(state: SidecarQueueUiState & {
  monitorInputBuffer: string
  focusMode: string
}): StyledText {
  const preview = state.monitorInputBuffer.replace(/\n/g, " ↵ ")
  const statusLine = sidecarInputStatusLine(state)
  const defaultIdle = statusLine === "Message sidecar · enter to send"

  if (defaultIdle) {
    if (preview) {
      return new StyledText([
        fg(theme.synth.amber)("› "),
        fg(theme.fgInput)(preview),
        fg(theme.synth.gold)("_"),
      ])
    }
    return new StyledText([
      fg(theme.synth.amber)("› "),
      dim(fg(theme.fgMuted)(statusLine)),
    ])
  }

  const chunks = [
    sidecarAgentActive(state) ? fg(theme.synth.amber)(statusLine) : dim(fg(theme.fgMuted)(statusLine)),
    fg(theme.fgPrimary)("\n"),
    fg(theme.synth.amber)("› "),
  ]
  if (preview) {
    chunks.push(fg(theme.fgInput)(preview), fg(theme.synth.gold)("_"))
  } else {
    chunks.push(dim(fg(theme.fgMuted)("type a message · /help")))
  }
  return new StyledText(chunks)
}

export function sidecarInputBackground(state: { focusMode: string; monitorInputBuffer: string }): string {
  if (state.focusMode === "monitor" || state.monitorInputBuffer.length > 0) return theme.bgInputFocused
  return theme.bgPanel
}

// Fold the goal card's status + spend lines into one compact strip for the chat view; the full
// card (criteria list, ETA, blockers) stays in the progress tab.
function goalStatusStrip(cardLines: string[], width: number): string {
  const compact = cardLines.filter((line) => !line.startsWith("·")).slice(0, 2).join("  ·  ")
  return oneLine(compact || "no active goal", width)
}

function workerLivenessStrip(
  input: Pick<
    GoalShutterRenderInput,
    "events" | "state" | "workerStatus" | "workerTurnStartedAt"
  >,
  width: number,
): string {
  const status = input.workerStatus ?? input.state.status ?? "idle"
  const latest = latestWorkerEvent(input.events)
  const latestAge = latest ? ageLabel(latest.observed_at) : "no events"
  const turnAge = input.workerTurnStartedAt ? ` · turn ${ageLabel(input.workerTurnStartedAt)}` : ""
  const monitorStatus = input.state.monitorSnapshot.status
  const sidecarStatus = input.state.sidecarChatInFlight
    ? " · sidecar sending"
    : input.state.sidecarQueuedMessages?.length
      ? ` · sidecar queued ${input.state.sidecarQueuedMessages.length}`
      : ""
  const eventLabel = latest ? latest.type.replace(/^agent\./, "") : "none"
  return oneLine(
    `worker ${status} · last ${eventLabel} ${latestAge}${turnAge} · monitor ${monitorStatus}${sidecarStatus}`,
    width,
  )
}

function workerLivenessColor(
  input: Pick<GoalShutterRenderInput, "events" | "state" | "workerStatus">,
): string {
  const status = input.workerStatus ?? input.state.status ?? "idle"
  if (status === "error") return theme.synth.red
  if (status === "running") return theme.synth.gold
  const latest = latestWorkerEvent(input.events)
  const ageMs = latest ? Date.now() - Date.parse(latest.observed_at) : Number.POSITIVE_INFINITY
  if (Number.isFinite(ageMs) && ageMs < 60_000) return theme.synth.amber
  return theme.fgMuted
}

function latestWorkerEvent(events: readonly StackThreadMetaEvent[]): StackThreadMetaEvent | undefined {
  for (const event of [...events].reverse()) {
    if (event.actor_role === "monitor") continue
    if (event.type.startsWith("monitor.")) continue
    if (event.type.startsWith("agent.") || event.type === "goal.started" || event.type.startsWith("goal.")) {
      return event
    }
  }
  return events.at(-1)
}

function ageLabel(iso: string): string {
  const timestamp = Date.parse(iso)
  if (!Number.isFinite(timestamp)) return "unknown age"
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 10) return "now"
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

function goalCardLines(input: Pick<GoalShutterRenderInput, "state" | "events" | "columns" | "metaThreadId">): string[] {
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
  const status = normalizeDisplayGoalStatus(session?.status ?? goal.status ?? "active")
  const lines = [
    `status ${status} · criteria ${done}/${total}${total > 0 ? ` (${pct}%)` : ""}`,
    ...(goal.objective ? [] : ["no active goal"]),
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

function normalizeDisplayGoalStatus(status: string): string {
  return status.trim().toLowerCase() === "blocked" ? "active" : status
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
