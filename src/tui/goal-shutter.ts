import { Box, StyledText, Text, dim, fg } from "@opentui/core"
import { formatEstimatedSpend } from "../codex/usage-cost.js"
import { reduceGoalSessionSnapshot } from "../goal-session.js"
import { parseCriterionEntry } from "../meta-thread-goal-criteria.js"
import type { StackMonitorSnapshot } from "../monitor.js"
import type { StackMonitorSidecarTurn } from "../monitor-sidecar-codex.js"
import type { StackThreadMetaEvent } from "../thread-events.js"
import { activeGoalModeSnapshot, type GoalModeState } from "./goal-mode.js"
import { deriveMetaGoalName } from "../meta-goal.js"
import {
  goalShutterStreamLineCount,
  renderGoalShutterStreamStyled,
  renderGoalSidecarThreadRich,
} from "./monitor-thread.js"
import type { TranscriptRenderOptions } from "./transcript.js"
import { anchorTranscriptBox } from "./transcript-slot.js"
import { sidecarAgentActive, sidecarInputStatusLine, type SidecarQueueUiState } from "./sidecar-queue.js"
import { stackTuiTheme as theme } from "./theme.js"

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
  sidecarTurns?: readonly StackMonitorSidecarTurn[]
  sidecarRenderOptions: TranscriptRenderOptions
  sidecarView: "thread" | "events"
  sidecarThreadScrollOffset: number
  columns: number
  visibleRows: number
  streamRows?: number
  scrollOffset: number
  metaThreadId?: string
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
}): ReturnType<typeof Box> {
  return Box(
    {
      flexDirection: "column",
      flexGrow: 1,
      minHeight: 0,
      gap: 1,
    },
    ...(input.objective
      ? [
          Text({
            content: `Goal · ${deriveMetaGoalName(input.objective)}`,
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

export function renderGoalShutter(input: GoalShutterRenderInput): ReturnType<typeof Box> {
  const goal = activeGoalModeSnapshot(input.state)
  const cardLines = goalCardLines(input)
  const sidecarMenuRows = input.sidecarMenuElements?.length ? 1 : 0
  const streamRows =
    input.streamRows ??
    // The goal card is now a single compact strip (1 row), not the full multi-line card.
    goalShutterStreamVisibleRows(input.visibleRows, 1, sidecarMenuRows)
  const sidecarColumns = Math.max(20, input.columns - 4)
  const sidecarThreadRows = Math.max(3, streamRows)
  const title = goal.objective
    ? `Goal · ${oneLine(goal.objective, Math.max(24, input.columns - 10))}`
    : "Goal shutter"
  const monitorModel = input.state.monitorSnapshot.model
  const monitorEffort = input.state.monitorSnapshot.reasoningEffort
  // Model goes on a line INSIDE the box, not in the border title — a long title gets truncated in
  // the narrow split layout, which would clip the "Sidecar thread" anchor.
  const monitorModelLine = monitorModel
    ? `monitor · ${monitorModel}${monitorEffort ? ` · ${monitorEffort}` : ""}`
    : undefined
  const sidecarTitle = input.sidecarView === "events"
    ? input.state.agentViewEnabled ? "Agent tape" : "Sidecar events"
    : "Sidecar thread"

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
          gap: 0,
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
            Text({
              content: renderGoalShutterStreamStyled(
                input.events,
                input.state.monitorSnapshot,
                sidecarColumns,
                streamRows,
                input.scrollOffset,
                input.state.agentViewEnabled,
              ),
              flexShrink: 0,
              width: "100%",
            }),
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
        ...(input.sidecarMenuElements ?? []),
          ]),
    ),
    ...(input.state.sidecarQueuedMessages?.length
      ? [renderSidecarQueuedMessages(input.state.sidecarQueuedMessages, input.columns)!]
      : []),
    Text({
      content: "1 worker · 2 sidecar · t thread · e events · m message sidecar · esc worker peek · g goal · a agent tape",
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
  if (preview) {
    return new StyledText([
      fg(theme.synth.amber)("› "),
      sidecarAgentActive(state) ? fg(theme.synth.amber)(statusLine) : dim(fg(theme.fgMuted)(statusLine)),
      fg(theme.fgMuted)(" · "),
      fg(theme.fgInput)(preview),
      fg(theme.synth.gold)("_"),
    ])
  }
  return new StyledText([
    fg(theme.synth.amber)("› "),
    sidecarAgentActive(state) ? fg(theme.synth.amber)(statusLine) : dim(fg(theme.fgMuted)(statusLine)),
  ])
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
  const lines = [
    `status ${session?.status ?? goal.status ?? "active"} · criteria ${done}/${total}${total > 0 ? ` (${pct}%)` : ""}`,
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
