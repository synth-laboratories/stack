import { StyledText, bold, dim, fg, type TextChunk } from "@opentui/core"
import type { StackdFactorySnapshot } from "../client/stackd.js"
import type {
  RemoteFactorySummary,
  RemoteProjectPanelEntry,
  RemoteProjectsPanelSnapshot,
  RemoteSmrRunSummary,
} from "../remote/research.js"
import type { StackSessionSummary, StackSessionUsageSummary } from "../session.js"
import type { StackThreadMetaEvent } from "../thread-events.js"
import { resolveThreadDisplayLabel, threadResumeToken } from "../thread-display-name.js"
import { gardenerThreadEvents } from "./gardener-thread.js"
import { monitorThreadEvents } from "./monitor-thread.js"
import { stackTuiTheme as theme } from "./theme.js"

const GARDENER_STREAM_EXCLUDE = new Set(["gardener.message", "gardener.friction"])

export type CoreEventStreamContext = "gardener" | "worker"

export type ActiveProjectsRenderInput = {
  snapshot: RemoteProjectsPanelSnapshot
  runtimeSnapshot?: StackdFactorySnapshot | null
  runtimeEventsAppended?: number | null
  selectedProjectIndex: number
  visibleRows: number
  columns: number
}

export type ActiveThreadsRenderInput = {
  focusMode: string
  history: readonly StackSessionSummary[]
  activeThreadIds: ReadonlySet<string>
  selectedHistoryIndex: number
  currentSessionId: string
  visibleRows: number
  columns: number
  gardenerThreadIds: ReadonlySet<string>
  liveTokensPerSecond?: string
  usageForSummary: (summary: StackSessionSummary) => StackSessionUsageSummary | undefined
  threadGoalStatus?: ReadonlyMap<string, ThreadGoalStatus>
  threadLifecycleStatus?: ReadonlyMap<string, ThreadLifecycleStatus>
  threadMetaThreadIds?: ReadonlyMap<string, string>
}

/** Gardener focus → gardener stream; worker/agent focus → monitor + actor stream. */
export function resolveCoreEventStreamContext(state: { focusMode: string }): CoreEventStreamContext {
  return state.focusMode === "gardener" ? "gardener" : "worker"
}

/** Intended: `agentViewEnabled` filters worker stream to curated monitor.* only vs full agent.* + monitor.* interleave. See stack_monitor_actor.md § Human-facing intermediary. */

export function activeProjectsLineCount(snapshot: RemoteProjectsPanelSnapshot): number {
  if (snapshot.projects.length === 0) return 2
  return snapshot.projects.length + 1
}

export function renderActiveProjectsStyled(input: ActiveProjectsRenderInput): StyledText {
  const chunks: TextChunk[] = []
  chunks.push(dim(fg(theme.fgMuted)("j/k select · f=factory · cloud=dev env")))
  chunks.push(fg(theme.fgPrimary)("\n"))
  chunks.push(...styleRuntimeSnapshotLine(input.runtimeSnapshot, input.runtimeEventsAppended, input.columns))
  chunks.push(fg(theme.fgPrimary)("\n"))

  const emptyLine = emptyProjectsLine(input.snapshot)
  if (input.snapshot.projects.length === 0) {
    chunks.push(dim(fg(theme.fgMuted)(emptyLine)))
    return new StyledText(chunks)
  }

  const rows = activeProjectRowSpecs(input)
  for (const [index, row] of rows.entries()) {
    if (index > 0) chunks.push(fg(theme.fgPrimary)("\n"))
    chunks.push(...styleActiveProjectRow(row))
  }
  return new StyledText(chunks)
}

function styleRuntimeSnapshotLine(
  snapshot: StackdFactorySnapshot | null | undefined,
  eventsAppended: number | null | undefined,
  columns: number,
): TextChunk[] {
  if (!snapshot) return [dim(fg(theme.fgMuted)("runtime: unavailable"))]
  const latest = snapshot.recent_events.at(-1)
  const remoteAuth = snapshot.remote_synth.auth_status
  const remoteEnvironment = snapshot.remote_synth.environment_name
    ? ` ${snapshot.remote_synth.environment_name}`
    : ""
  const localStatus = snapshot.local_gepa.service_status
  const eventSeq = latest ? ` ev:${latest.seq}` : ""
  const tickEvents = eventsAppended !== null && eventsAppended !== undefined
    ? ` tick:+${eventsAppended}`
    : ""
  const remoteRuns = snapshot.remote_synth.active_run_count > 0
    ? ` runs:${snapshot.remote_synth.active_run_count}`
    : ""
  const remoteOptimizers = snapshot.remote_synth.active_hosted_optimizer_count > 0
    ? ` opt:${snapshot.remote_synth.active_hosted_optimizer_count}`
    : ""
  const localRuns = snapshot.local_gepa.active_run_count > 0
    ? ` gepa:${snapshot.local_gepa.active_run_count}`
    : ""
  const state = snapshot.control_state
  const text = oneLine(`runtime ${state} local:${localStatus} synth${remoteEnvironment}:${remoteAuth}${remoteRuns}${remoteOptimizers}${localRuns}${eventSeq}${tickEvents}`, columns)
  const color = state === "degraded"
    ? theme.synth.red
    : remoteAuth === "ready" || localStatus === "running"
      ? theme.fgSecondary
      : theme.fgMuted
  return [dim(fg(color)(text))]
}

type ActiveProjectRow =
  | { kind: "pager"; text: string }
  | {
      kind: "project"
      selected: boolean
      active: boolean
      name: string
      runDetail?: string
      liveRunCount: number
      liveRunDetail?: string
      factory?: RemoteFactorySummary | null
      extraFactoryCount?: number
    }

function activeProjectRowSpecs(input: ActiveProjectsRenderInput): ActiveProjectRow[] {
  const projects = input.snapshot.projects
  if (projects.length === 0) return [{ kind: "pager", text: emptyProjectsLine(input.snapshot) }]

  const selectedIndex = Math.max(0, Math.min(input.selectedProjectIndex, projects.length - 1))
  const start = historyWindowStart(projects.length, selectedIndex, input.visibleRows)
  const rows: ActiveProjectRow[] = []
  if (start > 0) rows.push({ kind: "pager", text: `  ... ${start} newer` })

  for (const project of projects.slice(start, start + input.visibleRows)) {
    const index = projects.findIndex((entry) => entry.projectId === project.projectId)
    const selected = index === selectedIndex
    const liveRuns = projectLiveRuns(project)
    rows.push({
      kind: "project",
      selected,
      active: liveRuns.length > 0,
      name: projectDisplayName(project, input.columns),
      runDetail: projectRunDetail(project, liveRuns),
      liveRunCount: liveRuns.length,
      liveRunDetail: selected ? projectLiveRunDetail(project, liveRuns, input.columns) : undefined,
      factory: primaryProjectFactory(project),
      extraFactoryCount: Math.max(0, project.factories.length - 1),
    })
  }

  const hiddenOlder = projects.length - (start + input.visibleRows)
  if (hiddenOlder > 0) rows.push({ kind: "pager", text: `  ... ${hiddenOlder} older` })
  return rows
}

function styleActiveProjectRow(row: ActiveProjectRow): TextChunk[] {
  if (row.kind === "pager") return [dim(fg(theme.fgMuted)(row.text))]

  const cursor = row.selected ? "›" : " "
  const activeMarker = row.active ? "●" : "○"
  const chunks: TextChunk[] = []
  if (row.selected) {
    chunks.push(bold(fg(theme.synth.orange)(`${cursor}${activeMarker} `)))
    chunks.push(fg(theme.fgPrimary)(row.name))
  } else {
    chunks.push(dim(fg(theme.fgMuted)(`${cursor}${activeMarker} `)))
    chunks.push(fg(row.active ? theme.fgSecondary : theme.fgMuted)(row.name))
  }
  if (row.runDetail) {
    chunks.push(fg(row.selected ? theme.fgSecondary : theme.fgMuted)(` · ${row.runDetail}`))
  }
  if (row.liveRunCount > 1) {
    chunks.push(fg(row.selected ? theme.synth.amber : theme.fgMuted)(` · runs:${row.liveRunCount}`))
  }
  if (row.liveRunDetail) {
    chunks.push(dim(fg(row.selected ? theme.fgSecondary : theme.fgMuted)(` · ${row.liveRunDetail}`)))
  }
  chunks.push(...styleProjectFactoryBadges(row.factory, row.extraFactoryCount ?? 0, row.selected))
  return chunks
}

function styleProjectFactoryBadges(
  factory: RemoteFactorySummary | null | undefined,
  extraFactoryCount: number,
  selected: boolean,
): TextChunk[] {
  if (factory === null) {
    return [dim(fg(theme.fgMuted)(" · no factory"))]
  }
  if (!factory) return []

  const chunks: TextChunk[] = [fg(selected ? theme.fgSecondary : theme.fgMuted)(` · f:${oneLine(factory.name, 14)}`)]
  if (extraFactoryCount > 0) {
    chunks.push(dim(fg(theme.fgMuted)(` +${extraFactoryCount}`)))
  }
  if (factory.hasCloudDevEnv) {
    chunks.push(fg("#3fb950")(` cloud${factory.cloudDevLabel ? `:${factory.cloudDevLabel}` : ""}`))
  } else if (factory.hasCloudDevEnv === false) {
    chunks.push(dim(fg(theme.fgMuted)(" · no cloud dev")))
  }
  if (factory.isRunning) {
    chunks.push(fg(theme.synth.amber)(" · run"))
  } else if (factory.status === "active") {
    chunks.push(dim(fg(theme.fgMuted)(" · idle")))
  } else if (factory.status) {
    chunks.push(dim(fg(theme.fgMuted)(` · ${factory.status}`)))
  }
  return chunks
}

function primaryProjectFactory(project: RemoteProjectPanelEntry): RemoteFactorySummary | null | undefined {
  if (project.factories.length === 0) return null
  return project.factories[0]
}

function projectDisplayName(project: RemoteProjectPanelEntry, columns: number): string {
  const alias = project.alias && project.alias !== project.name ? project.alias : project.name
  return oneLine(alias, Math.max(12, columns - 10))
}

function projectRunDetail(project: RemoteProjectPanelEntry, liveRuns: RemoteSmrRunSummary[]): string | undefined {
  if (project.activeRunId) {
    const active = project.runs.find((run) => run.runId === project.activeRunId) ?? project.runs[0]
    if (active) return `${active.runId.slice(0, 8)} · ${runStateLabel(active)}`
    return project.activeRunId.slice(0, 8)
  }
  const latest = liveRuns[0] ?? project.runs[0]
  if (latest) return `${latest.runId.slice(0, 8)} · ${runStateLabel(latest)}`
  return undefined
}

function runStateLabel(run: { state: string; phase?: string }): string {
  return run.phase ? `${run.state}/${run.phase}` : run.state
}

function projectLiveRuns(project: RemoteProjectPanelEntry): RemoteSmrRunSummary[] {
  const activeRunId = project.activeRunId
  return project.runs
    .filter((run) => !isTerminalRun(run) || run.runId === activeRunId)
    .sort((left, right) => {
      if (left.runId === activeRunId && right.runId !== activeRunId) return -1
      if (right.runId === activeRunId && left.runId !== activeRunId) return 1
      const leftTerminal = isTerminalRun(left)
      const rightTerminal = isTerminalRun(right)
      if (leftTerminal !== rightTerminal) return leftTerminal ? 1 : -1
      return runRecency(right) - runRecency(left)
    })
}

function projectLiveRunDetail(
  project: RemoteProjectPanelEntry,
  liveRuns: RemoteSmrRunSummary[],
  columns: number,
): string | undefined {
  if (liveRuns.length <= 1) return undefined
  const primaryRunId = project.activeRunId ?? liveRuns[0]?.runId
  const chips = liveRuns
    .filter((run) => run.runId !== primaryRunId)
    .slice(0, 3)
    .map(runChipLabel)
  if (chips.length === 0) return undefined
  const suffix = liveRuns.length > chips.length + 1 ? ` +${liveRuns.length - chips.length - 1}` : ""
  return oneLine(`live ${chips.join(" ")}${suffix}`, Math.max(18, Math.floor(columns * 0.42)))
}

function runChipLabel(run: RemoteSmrRunSummary): string {
  const runbook = run.runbook ? `:${oneLine(run.runbook, 8)}` : ""
  return `${run.runId.slice(0, 6)}:${runStateLabel(run)}${runbook}`
}

function isTerminalRun(run: RemoteSmrRunSummary): boolean {
  const state = `${run.state}${run.phase ? `/${run.phase}` : ""}`.toLowerCase()
  return /(done|complete|completed|failed|cancel|terminal|stopped|success|succeeded)/.test(state)
}

function runRecency(run: RemoteSmrRunSummary): number {
  return (
    Date.parse(run.updatedAt ?? "") ||
    Date.parse(run.startedAt ?? "") ||
    Date.parse(run.createdAt ?? "") ||
    Date.parse(run.finishedAt ?? "") ||
    0
  )
}

function emptyProjectsLine(snapshot: RemoteProjectsPanelSnapshot): string {
  if (snapshot.status === "missing-auth") return "(add Synth API key)"
  if (snapshot.status === "offline") return "(API offline)"
  return "(no live projects)"
}

/** v1: current worker session + gardener routing target. Gardener will expand this later. */
export function resolveActiveThreadIds(
  sessionId: string,
  gardenerWorkerTargetId: string | undefined,
  history: readonly StackSessionSummary[] = [],
  threadLifecycleStatus: ReadonlyMap<string, ThreadLifecycleStatus> = new Map(),
): ReadonlySet<string> {
  const ids = new Set<string>([sessionId])
  if (gardenerWorkerTargetId && gardenerWorkerTargetId !== sessionId) {
    ids.add(gardenerWorkerTargetId)
  }
  for (const summary of history) {
    if (!summary.metaThreadId) continue
    if ((threadLifecycleStatus.get(summary.id) ?? "live") === "live") {
      ids.add(summary.id)
    }
  }
  return ids
}

export function activeThreadsFocusHint(focusMode: string): string {
  return focusMode === "history" ? "j/k select · enter resume" : "tab threads · p all · stack resume <id>"
}

/** Row specs for the active-threads list, in display order. Pager rows are non-interactive;
 * thread rows carry `historyIndex` so callers can wire per-row selection/resume on click. */
export function activeThreadRows(input: ActiveThreadsRenderInput): ActiveThreadRow[] {
  const showAll = input.focusMode === "history"
  const summaries = showAll
    ? input.history
    : input.history.filter((summary) => input.activeThreadIds.has(summary.id))

  if (summaries.length === 0) {
    return [{ kind: "pager", text: showAll ? "(no threads yet)" : "(no active threads)" }]
  }

  return activeThreadRowSpecs(input, summaries, showAll)
}

/** Styled content for a single active-threads row, for per-row clickable rendering. */
export function styleActiveThreadRowStyled(row: ActiveThreadRow): StyledText {
  return new StyledText(styleActiveThreadRow(row))
}

export function renderActiveThreadRowsStyled(input: ActiveThreadsRenderInput): StyledText {
  const chunks: TextChunk[] = []
  const rows = activeThreadRows(input)
  for (const [index, row] of rows.entries()) {
    if (index > 0) chunks.push(fg(theme.fgPrimary)("\n"))
    chunks.push(...styleActiveThreadRow(row))
  }
  return new StyledText(chunks)
}

export function renderActiveThreadsStyled(input: ActiveThreadsRenderInput): StyledText {
  const chunks: TextChunk[] = [
    dim(fg(theme.fgMuted)(activeThreadsFocusHint(input.focusMode))),
    fg(theme.fgPrimary)("\n"),
  ]
  const rows = renderActiveThreadRowsStyled(input)
  return new StyledText([...chunks, ...(rows.chunks ?? [])])
}

export type ThreadGoalStatus = "active" | "paused" | "blocked" | "done"
export type ThreadLifecycleStatus = "live" | "archived"

const THREAD_GOAL_STATUS_COLOR: Record<ThreadGoalStatus, string> = {
  active: "#58a6ff",
  done: "#3fb950",
  paused: "#f7a41d",
  blocked: "#fd6600",
}

export type ActiveThreadRow =
  | { kind: "pager"; text: string }
  | {
      kind: "thread"
      historyIndex: number
      selected: boolean
      active: boolean
      gardener: boolean
      goalStatus?: ThreadGoalStatus
      lifecycleStatus?: ThreadLifecycleStatus
      metaThreadId?: string
      time: string
      prompt: string
      resumeToken?: string
    }

function activeThreadRowSpecs(
  input: ActiveThreadsRenderInput,
  summaries: readonly StackSessionSummary[],
  showAll: boolean,
): ActiveThreadRow[] {
  if (summaries.length === 0) return [{ kind: "pager", text: "(no threads yet)" }]

  const selectedId = input.history[input.selectedHistoryIndex]?.id
  const start = historyWindowStart(summaries.length, summaries.findIndex((s) => s.id === selectedId), input.visibleRows)
  const rows: ActiveThreadRow[] = []
  if (start > 0) rows.push({ kind: "pager", text: `  ... ${start} newer` })

  for (const summary of summaries.slice(start, start + input.visibleRows)) {
    const index = input.history.findIndex((entry) => entry.id === summary.id)
    rows.push({
      kind: "thread",
      historyIndex: index,
      selected: index === input.selectedHistoryIndex,
      active: input.activeThreadIds.has(summary.id),
      gardener: input.gardenerThreadIds.has(summary.id),
      goalStatus: input.threadGoalStatus?.get(summary.id),
      lifecycleStatus: input.threadLifecycleStatus?.get(summary.id),
      metaThreadId: input.threadMetaThreadIds?.get(summary.id) ?? summary.metaThreadId,
      time: formatRelativeTime(summary.updatedAt),
      prompt: resolveThreadDisplayLabel(summary, {
        isGardener: input.gardenerThreadIds.has(summary.id),
        maxLength: Math.max(12, input.columns - 14),
      }),
      resumeToken: threadResumeToken(summary),
    })
  }

  const hiddenOlder = summaries.length - (start + input.visibleRows)
  if (hiddenOlder > 0) rows.push({ kind: "pager", text: `  ... ${hiddenOlder} older` })
  if (!showAll && input.history.length > summaries.length) {
    rows.push({ kind: "pager", text: `  p → all threads` })
  }
  return rows
}

function styleActiveThreadRow(row: ActiveThreadRow): TextChunk[] {
  if (row.kind === "pager") return [dim(fg(theme.fgMuted)(row.text))]

  const cursor = row.selected ? "›" : " "
  const activeMarker = row.active ? "●" : "○"
  const goalBadge = row.goalStatus ? [bold(fg(THREAD_GOAL_STATUS_COLOR[row.goalStatus])(" G"))] : []
  const lifecycleBadge = row.metaThreadId
    ? [
        dim(fg(row.lifecycleStatus === "archived" ? theme.fgMuted : "#3fb950")(
          ` [${row.lifecycleStatus ?? "live"}]`,
        )),
        ...(row.goalStatus ? [dim(fg(theme.fgMuted)(`:${row.goalStatus}`))] : []),
        dim(fg(theme.fgMuted)(` · ${row.metaThreadId.slice(0, 10)}`)),
      ]
    : []
  const resumeSuffix = row.resumeToken ? [dim(fg(theme.fgMuted)(` · ${row.resumeToken}`))] : []
  if (row.selected) {
    return [
      bold(fg(theme.synth.orange)(`${cursor}${activeMarker} `)),
      fg(theme.synth.amber)(row.time.padStart(3)),
      ...(row.gardener ? [fg("#3fb950")(" gard")] : []),
      ...goalBadge,
      fg(theme.fgPrimary)(` ${row.prompt}`),
      ...lifecycleBadge,
      ...resumeSuffix,
    ]
  }
  return [
    dim(fg(theme.fgMuted)(`${cursor}${activeMarker} ${row.time.padStart(3)}`)),
    ...(row.gardener ? [fg("#3fb950")(" gard")] : []),
    ...goalBadge,
    fg(row.active ? theme.fgSecondary : theme.fgMuted)(` ${row.prompt}`),
    ...lifecycleBadge,
    ...resumeSuffix,
  ]
}

/** Human-facing stream: monitor + handoff/meta events + agent failures only. Agent view adds full agent.* tape. */
export function curatedWorkerStreamEvents(events: StackThreadMetaEvent[]): StackThreadMetaEvent[] {
  return events.filter((event) => {
    if (event.type.startsWith("monitor.")) return true
    if (event.type.startsWith("handoff.")) return true
    if (event.type.startsWith("meta_thread.")) return true
    if (event.type === "agent.tool.failed" || event.type === "agent.error") return true
    if (event.type === "thread.named") return true
    return false
  })
}

export function coreEventStreamLineCount(
  context: CoreEventStreamContext,
  gardenerEvents: StackThreadMetaEvent[],
  workerEvents: StackThreadMetaEvent[],
  columns: number,
  agentViewEnabled = false,
): number {
  return coreEventStreamLines(context, gardenerEvents, workerEvents, columns, agentViewEnabled).length
}

export function renderCoreEventStreamStyled(
  context: CoreEventStreamContext,
  gardenerEvents: StackThreadMetaEvent[],
  workerEvents: StackThreadMetaEvent[],
  columns: number,
  visibleRows: number,
  scrollOffset = 0,
  agentViewEnabled = false,
): StyledText {
  const lines = coreEventStreamLines(context, gardenerEvents, workerEvents, columns, agentViewEnabled)
  const window = scrollWindow(lines, scrollOffset, visibleRows)
  const chunks: TextChunk[] = []
  for (const [index, line] of window.entries()) {
    if (index > 0) chunks.push(fg(theme.fgPrimary)("\n"))
    chunks.push(...styledCoreEventLine(line))
  }
  if (lines.length > window.length && scrollOffset > 0) {
    chunks.unshift(dim(`↑ ${scrollOffset}/${lines.length} newer\n`))
  }
  if (lines.length > window.length && scrollOffset < lines.length - visibleRows) {
    chunks.unshift(dim(`↓ ${scrollOffset + window.length}/${lines.length} older\n`))
  }
  return new StyledText(chunks)
}

function coreEventStreamLines(
  context: CoreEventStreamContext,
  gardenerEvents: StackThreadMetaEvent[],
  workerEvents: StackThreadMetaEvent[],
  columns: number,
  agentViewEnabled = false,
): string[] {
  const width = Math.max(14, columns - 2)
  const merged =
    context === "gardener"
      ? gardenerThreadEvents(gardenerEvents).filter((event) => !GARDENER_STREAM_EXCLUDE.has(event.type))
      : agentViewEnabled
        ? monitorThreadEvents(workerEvents)
        : curatedWorkerStreamEvents(workerEvents)
  const sorted = [...merged].sort((left, right) => right.observed_at.localeCompare(left.observed_at))
  if (sorted.length === 0) return ["(no events yet)"]
  return sorted.map((event) => formatCoreEventLine(event, width))
}

function formatCoreEventLine(event: StackThreadMetaEvent, width: number): string {
  const time = shortTime(event.observed_at)
  const source = event.type.startsWith("gardener.")
    ? "gard"
    : event.type.startsWith("monitor.")
      ? "mon"
      : event.type.startsWith("handoff.") || event.type.startsWith("meta_thread.")
        ? "meta"
      : event.type === "thread.named"
        ? readString(event.payload.named_by) === "gardener"
          ? "gard"
          : readString(event.payload.named_by) === "monitor"
            ? "mon"
            : "act"
        : "act"
  const label = event.type === "thread.named"
    ? "named"
    : event.type.replace(/^(gardener|monitor|agent|handoff|meta_thread)\./, "")
  const payload = event.payload
  const detail =
    readString(payload.display_name) ??
    readString(payload.message) ??
    readString(payload.summary) ??
    readString(payload.pattern) ??
    readString(payload.tool_name) ??
    readString(payload.name) ??
    readString(payload.kind) ??
    ""
  return oneLine(`${time} ${source} ${label}${detail ? ` · ${detail}` : ""}`, width)
}

function styledCoreEventLine(line: string): TextChunk[] {
  if (line.startsWith("(no events")) return [dim(fg(theme.fgMuted)(line))]
  if (line.includes(" gard ")) {
    if (line.includes(" friction") || line.includes(" queued")) return [fg(theme.synth.amber)(line)]
    if (line.includes(" routed") || line.includes(" dispatched") || line.includes(" garden") || line.includes(" named")) {
      return [fg("#3fb950")(line)]
    }
  }
  if (line.includes(" mon ")) return [fg(theme.synth.orangeDark)(line)]
  if (line.includes(" meta ")) return [fg(theme.synth.gold)(line)]
  if (line.includes(" act ")) return [fg(theme.fgSecondary)(line)]
  return [fg(theme.fgSecondary)(line)]
}

function scrollWindow<T>(lines: T[], scrollOffset: number, visibleRows: number): T[] {
  if (visibleRows <= 0) return []
  const maxOffset = Math.max(0, lines.length - visibleRows)
  const offset = Math.min(Math.max(0, scrollOffset), maxOffset)
  return lines.slice(offset, offset + visibleRows)
}

function historyWindowStart(historyLength: number, selectedIndex: number, visibleRows: number): number {
  if (historyLength <= visibleRows) return 0
  const middleOffset = Math.floor(visibleRows / 2)
  const safeIndex = Math.max(0, selectedIndex)
  return Math.max(0, Math.min(historyLength - visibleRows, safeIndex - middleOffset))
}

function formatRelativeTime(value: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return "--"
  const diffMs = Math.max(0, Date.now() - parsed)
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 14) return `${days}d`
  return `${Math.floor(days / 7)}w`
}

function oneLine(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`
}

function shortTime(value: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return "--:--"
  const date = new Date(parsed)
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}
