import { StyledText, fg, type TextChunk } from "@opentui/core"
import type { StackdMetaThreadManifest } from "../client/stackd.js"
import type { StackSessionSummary } from "../session.js"
import { stackTuiTheme as theme } from "./theme.js"

// Workers cockpit panel — the gardener's live workers, listed by manifest
// authority. A worker belongs here iff its meta-thread manifest says
// `gardener_thread_id === currentGardenerThreadId` and it is live; when an
// Effort is ON the list narrows to `effort_ref === activeEffort.id`. The
// Effort reverse index (`links.meta_thread_refs`) is a consistency check
// only: disagreement shows a quiet `⚠ index drift` marker on the row, never
// exclusion. Workers with no `gardener_thread_id` (manual/pre-metadata) are
// excluded from the main list and shown in a collapsed unassociated section.

export type WorkersPanelRow = {
  summary: StackSessionSummary
  manifest: StackdMetaThreadManifest
  model?: string
  effortLabel?: string
  monitorStatus?: string
  indexDrift: boolean
}

export type WorkersPanelActiveEffort = {
  effortId: string
  title?: string
  metaThreadRefs?: readonly string[]
}

export type WorkersPanelRowsInput = {
  summaries: readonly StackSessionSummary[]
  manifestsByThreadId: ReadonlyMap<string, StackdMetaThreadManifest>
  gardenerThreadId: string
  activeEffort?: WorkersPanelActiveEffort
  effortTitleByRef?: ReadonlyMap<string, string>
  monitorStatusByThreadId?: ReadonlyMap<string, string>
}

export type WorkersPanelRows = {
  associated: WorkersPanelRow[]
  unassociated: WorkersPanelRow[]
}

export function buildWorkersPanelRows(input: WorkersPanelRowsInput): WorkersPanelRows {
  const associated: WorkersPanelRow[] = []
  const unassociated: WorkersPanelRow[] = []
  for (const summary of input.summaries) {
    if (summary.id === input.gardenerThreadId) continue
    const manifest = input.manifestsByThreadId.get(summary.id)
    if (!manifest) continue
    if ((manifest.lifecycle_status ?? "live") !== "live") continue
    const row: WorkersPanelRow = {
      summary,
      manifest,
      model: headSegmentModel(manifest),
      effortLabel: manifest.effort_ref
        ? input.effortTitleByRef?.get(manifest.effort_ref) ?? manifest.effort_ref.slice(0, 12)
        : undefined,
      monitorStatus: input.monitorStatusByThreadId?.get(summary.id) ?? manifest.monitor_headline?.status,
      indexDrift: false,
    }
    if (!manifest.gardener_thread_id) {
      unassociated.push(row)
      continue
    }
    if (manifest.gardener_thread_id !== input.gardenerThreadId) continue
    if (input.activeEffort) {
      if (manifest.effort_ref !== input.activeEffort.effortId) continue
      row.indexDrift = !(input.activeEffort.metaThreadRefs ?? []).includes(manifest.id)
    }
    associated.push(row)
  }
  return { associated, unassociated }
}

function headSegmentModel(manifest: StackdMetaThreadManifest): string | undefined {
  const head = manifest.segments.find((segment) => segment.segmentId === manifest.head_segment_id)
  return (head ?? manifest.segments.at(-1))?.model
}

export type WorkersPanelRenderInput = {
  rows: WorkersPanelRows
  selectedIndex: number
  showUnassociated: boolean
  effortOnTitle?: string
  columns: number
  visibleRows: number
  loadError?: string
}

export function selectableWorkersPanelRows(rows: WorkersPanelRows, showUnassociated: boolean): WorkersPanelRow[] {
  return showUnassociated ? [...rows.associated, ...rows.unassociated] : rows.associated
}

export function renderWorkersPanelStyled(input: WorkersPanelRenderInput): StyledText {
  if (input.loadError) {
    return new StyledText([
      fg(theme.synth.red)("Workers could not be read"),
      fg(theme.fgPrimary)("\n"),
      fg(theme.fgMuted)(oneLine(input.loadError, Math.max(24, input.columns))),
    ])
  }
  const { columns } = input
  const selectable = selectableWorkersPanelRows(input.rows, input.showUnassociated)
  const selected = selectable[input.selectedIndex]
  const lines: Array<{ text: string; color: string }> = []
  lines.push({
    text: oneLine(
      `gardener workers: ${input.rows.associated.length}${input.effortOnTitle ? ` · effort ON: ${input.effortOnTitle}` : ""}`,
      columns,
    ),
    color: input.rows.associated.length > 0 ? theme.fgSecondary : theme.fgMuted,
  })
  lines.push({
    text: oneLine("authority: worker manifest gardener_thread_id + effort_ref · reverse index is a check", columns),
    color: theme.fgMuted,
  })
  if (selected) {
    lines.push({
      text: oneLine(`selected - ${selected.summary.id.slice(0, 8)} - j/k select - enter open thread - u unassociated - r refresh`, columns),
      color: theme.fgSecondary,
    })
  } else {
    lines.push({
      text: oneLine("j/k select - enter open thread - u unassociated - r refresh", columns),
      color: theme.fgMuted,
    })
  }
  lines.push({ text: "", color: theme.fgPrimary })

  if (input.rows.associated.length === 0) {
    lines.push({ text: "No live workers for this gardener.", color: theme.fgMuted })
  } else {
    lines.push({ text: `Workers (${input.rows.associated.length})`, color: theme.fgSecondary })
    for (const row of input.rows.associated) {
      pushWorkerRowLines(lines, row, row === selected, columns)
    }
  }

  lines.push({ text: "", color: theme.fgPrimary })
  if (input.showUnassociated) {
    lines.push({ text: `Unassociated workers (${input.rows.unassociated.length}) · debug · u hide`, color: theme.fgSecondary })
    if (input.rows.unassociated.length === 0) {
      lines.push({ text: "  none", color: theme.fgMuted })
    }
    for (const row of input.rows.unassociated) {
      pushWorkerRowLines(lines, row, row === selected, columns)
    }
  } else {
    lines.push({
      text: oneLine(`unassociated workers (${input.rows.unassociated.length}) · collapsed · u show`, columns),
      color: theme.fgMuted,
    })
  }

  const rendered = lines.slice(0, Math.max(1, input.visibleRows))
  const hidden = Math.max(0, lines.length - rendered.length)
  const chunks: TextChunk[] = []
  rendered.forEach((line, index) => {
    if (index > 0) chunks.push(fg(theme.fgPrimary)("\n"))
    chunks.push(fg(line.color)(line.text))
  })
  if (hidden > 0) {
    chunks.push(fg(theme.fgPrimary)("\n"))
    chunks.push(fg(theme.fgMuted)(`... ${hidden} more`))
  }
  return new StyledText(chunks)
}

function pushWorkerRowLines(
  lines: Array<{ text: string; color: string }>,
  row: WorkersPanelRow,
  selected: boolean,
  columns: number,
): void {
  const title = row.manifest.title?.trim() || row.summary.displayName?.trim() || row.summary.lastPrompt?.trim() || row.summary.id
  const drift = row.indexDrift ? " · ⚠ index drift" : ""
  lines.push({
    text: oneLine(`${selected ? ">" : " "} ${row.summary.id.slice(0, 8)} ${title}${drift}`, columns),
    color: selected ? theme.synth.amber : theme.fgPrimary,
  })
  const details = [
    row.model ?? "model unknown",
    row.effortLabel ? `effort ${row.effortLabel}` : "no effort",
    `source ${row.manifest.source ?? "manual"}`,
    row.manifest.lifecycle_status ?? "live",
    ...(row.monitorStatus ? [`monitor ${row.monitorStatus}`] : []),
  ].join(" - ")
  lines.push({
    text: oneLine(`  ${details}`, columns),
    color: theme.fgMuted,
  })
}

function oneLine(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim()
  if (flat.length <= max) return flat
  if (max <= 3) return flat.slice(0, max)
  return `${flat.slice(0, max - 3)}...`
}
