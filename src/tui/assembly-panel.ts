import { StyledText, fg, type TextChunk } from "@opentui/core"
import type {
  StackdAssemblyEvent,
  StackdAssemblyLineRecord,
  StackdAssemblyLineSnapshot,
} from "../client/stackd.js"
import { stackTuiTheme as theme } from "./theme.js"

// Assembly Lines cockpit panel — the process layer above Efforts
// (docs/ASSEMBLY_LINES.md). The lane view renders one row per line from the
// AssemblyLineSnapshot projection; the detail view walks stations, bindings,
// gate history, and standards verdicts for one selected line. All actions go
// through typed stackd calls; this module only renders.

export type AssemblyPanelView = "lanes" | "detail"

export type AssemblyPanelDetail = {
  record: StackdAssemblyLineRecord
  events: StackdAssemblyEvent[]
  snapshot: StackdAssemblyLineSnapshot
}

export type AssemblyPanelRenderInput = {
  view: AssemblyPanelView
  lines: readonly StackdAssemblyLineSnapshot[]
  selectedIndex: number
  detail?: AssemblyPanelDetail
  loadError?: string
  columns: number
  visibleRows: number
}

export function renderAssemblyPanelStyled(input: AssemblyPanelRenderInput): StyledText {
  if (input.loadError) {
    return new StyledText([
      fg(theme.synth.red)("Assembly lines could not be read"),
      fg(theme.fgPrimary)("\n"),
      fg(theme.fgMuted)(oneLine(input.loadError, Math.max(24, input.columns))),
    ])
  }
  const lines: Array<{ text: string; color: string }> =
    input.view === "detail" && input.detail
      ? detailLines(input.detail, input.columns)
      : laneLines(input)
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

function laneLines(input: AssemblyPanelRenderInput): Array<{ text: string; color: string }> {
  const { columns } = input
  const selected = input.lines[input.selectedIndex]
  const open = input.lines.filter((line) => !line.complete)
  const lines: Array<{ text: string; color: string }> = []
  lines.push({
    text: oneLine(`assembly lines: ${input.lines.length} · ${open.length} open`, columns),
    color: input.lines.length > 0 ? theme.fgSecondary : theme.fgMuted,
  })
  lines.push({
    text: oneLine("new - /assembly new <title> [--preset ship|effort]", columns),
    color: theme.fgMuted,
  })
  if (selected) {
    lines.push({
      text: oneLine(`selected - ${selected.line_id} - j/k select - enter detail - n new - r refresh`, columns),
      color: theme.fgSecondary,
    })
  }
  lines.push({ text: "", color: theme.fgPrimary })
  if (input.lines.length === 0) {
    lines.push({ text: "No assembly lines yet.", color: theme.fgMuted })
    return lines
  }
  for (const line of input.lines) {
    const isSelected = line === selected
    const gate = line.open_gate ? `gate ${line.open_gate.station}:${line.open_gate.verdict}` : "no gate"
    lines.push({
      text: oneLine(`${isSelected ? ">" : " "} ${line.line_id} ${line.title}`, columns),
      color: line.open_gate ? theme.synth.red : isSelected ? theme.synth.amber : theme.fgPrimary,
    })
    lines.push({
      text: oneLine(
        `  ${line.preset} - station ${line.current_station} (${line.station_state}) - owner ${line.owner} - ${formatAge(line.age_seconds)} - ${gate}`,
        columns,
      ),
      color: theme.fgMuted,
    })
    lines.push({
      text: oneLine(`  next - ${line.next_action}`, columns),
      color: theme.fgMuted,
    })
  }
  return lines
}

function detailLines(detail: AssemblyPanelDetail, columns: number): Array<{ text: string; color: string }> {
  const { record, events, snapshot } = detail
  const lines: Array<{ text: string; color: string }> = []
  lines.push({
    text: oneLine(`${snapshot.line_id} [${snapshot.preset}] ${snapshot.title}`, columns),
    color: theme.synth.amber,
  })
  lines.push({
    text: oneLine(
      `owner ${snapshot.owner} · ${formatAge(snapshot.age_seconds)} · station ${snapshot.current_station} (${snapshot.station_state})${snapshot.shipped ? " · shipped" : ""}${snapshot.complete ? " · complete" : ""}`,
      columns,
    ),
    color: theme.fgSecondary,
  })
  lines.push({
    text: oneLine(`next - ${snapshot.next_action}`, columns),
    color: theme.fgSecondary,
  })
  if (snapshot.open_gate) {
    lines.push({
      text: oneLine(
        `gate open - ${snapshot.open_gate.station} ${snapshot.open_gate.verdict} - ${snapshot.open_gate.next_owner} must ${snapshot.open_gate.next_safe_action}`,
        columns,
      ),
      color: theme.synth.red,
    })
  }
  lines.push({
    text: oneLine(
      "enter lanes - s start - c complete - b bind effort ON - g route gardener - q quality review - e evidence - u bundle - H handback",
      columns,
    ),
    color: theme.fgMuted,
  })
  lines.push({ text: "", color: theme.fgPrimary })

  lines.push({ text: "Stations", color: theme.fgSecondary })
  const stationEvents = events.filter((event) => event.station)
  for (const station of stationWalk(snapshot)) {
    const startedAt = stationEvents.find(
      (event) => event.kind === "assembly.station_started" && event.station === station,
    )?.occurred_at
    const completedAt = stationEvents.find(
      (event) => event.kind === "assembly.station_completed" && event.station === station,
    )?.occurred_at
    const marker = completedAt ? "✓" : station === snapshot.current_station ? ">" : " "
    const timestamps = [
      ...(startedAt ? [`started ${shortTime(startedAt)}`] : []),
      ...(completedAt ? [`completed ${shortTime(completedAt)}`] : []),
    ].join(" - ")
    lines.push({
      text: oneLine(`${marker} ${station}${timestamps ? ` - ${timestamps}` : ""}`, columns),
      color: completedAt ? theme.fgMuted : station === snapshot.current_station ? theme.synth.amber : theme.fgPrimary,
    })
  }
  lines.push({ text: "", color: theme.fgPrimary })

  lines.push({ text: "Bindings", color: theme.fgSecondary })
  const bindings = record.bindings
  pushBindingLine(lines, "efforts", bindings.effort_ids, columns)
  pushBindingLine(lines, "meta-threads", bindings.meta_thread_ids, columns)
  pushBindingLine(lines, "workers", bindings.worker_ids, columns)
  pushBindingLine(lines, "gardeners", bindings.gardener_ids, columns)
  pushBindingLine(lines, "monitors", bindings.monitor_ids, columns)
  pushBindingLine(lines, "evidence", snapshot.bindings.evidence_paths, columns)
  lines.push({
    text: oneLine(`  ship bundle - ${bindings.ship_bundle_path ?? "none"}`, columns),
    color: bindings.ship_bundle_path ? theme.fgPrimary : theme.fgMuted,
  })
  lines.push({ text: "", color: theme.fgPrimary })

  lines.push({ text: "Gate history", color: theme.fgSecondary })
  const gateEvents = events.filter(
    (event) => event.kind === "assembly.gate_failed" || event.kind === "assembly.gate_passed",
  )
  if (gateEvents.length === 0) {
    lines.push({ text: "  no standards verdicts yet", color: theme.fgMuted })
  }
  for (const event of gateEvents) {
    const verdict = event.gate?.verdict ?? "n_a"
    const routing =
      event.kind === "assembly.gate_failed" && event.gate
        ? ` - next ${event.gate.next_owner ?? "?"}: ${event.gate.next_safe_action ?? "?"}`
        : ""
    lines.push({
      text: oneLine(`  ${shortTime(event.occurred_at)} ${event.station ?? "?"} ${verdict} by ${event.actor_id}${routing}`, columns),
      color: event.kind === "assembly.gate_failed" ? theme.synth.red : theme.fgPrimary,
    })
  }
  lines.push({ text: "", color: theme.fgPrimary })

  lines.push({ text: "Events", color: theme.fgSecondary })
  for (const event of events.slice(-8)) {
    lines.push({
      text: oneLine(
        `  ${shortTime(event.occurred_at)} ${event.kind}${event.station ? ` ${event.station}` : ""} - ${event.actor_id}`,
        columns,
      ),
      color: theme.fgMuted,
    })
  }
  return lines
}

// Display mirror of the preset station orders owned by
// stack_core::assembly_line (docs/ASSEMBLY_LINES.md). Rendering only — every
// transition is validated server-side against the Rust source of truth.
const PRESET_STATIONS: Record<StackdAssemblyLineSnapshot["preset"], readonly string[]> = {
  ship: [
    "intake",
    "problem_selection",
    "scope_lock",
    "build",
    "internal_proof",
    "quality_review",
    "staging",
    "prod",
    "readout",
  ],
  effort: ["intake", "plan", "execute", "validate", "review", "ship", "monitor", "follow_up"],
}

// The full station walk for the detail view: the preset order, with completed
// and current stations marked from the snapshot/events.
function stationWalk(snapshot: StackdAssemblyLineSnapshot): string[] {
  return [...PRESET_STATIONS[snapshot.preset]]
}

function pushBindingLine(
  lines: Array<{ text: string; color: string }>,
  label: string,
  values: readonly string[] | undefined,
  columns: number,
): void {
  const list = values ?? []
  lines.push({
    text: oneLine(`  ${label} (${list.length})${list.length > 0 ? ` - ${list.join(", ")}` : ""}`, columns),
    color: list.length > 0 ? theme.fgPrimary : theme.fgMuted,
  })
}

// The preset's quality-review station: `quality_review` for ship,
// `review` for effort.
export function assemblyReviewStation(preset: StackdAssemblyLineSnapshot["preset"]): string {
  return preset === "ship" ? "quality_review" : "review"
}

export function formatAge(seconds: number): string {
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`
  return `${Math.round(seconds / 86400)}d`
}

function shortTime(iso: string): string {
  return iso.length >= 16 ? `${iso.slice(5, 10)} ${iso.slice(11, 16)}` : iso
}

function oneLine(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim()
  if (flat.length <= max) return flat
  if (max <= 3) return flat.slice(0, max)
  return `${flat.slice(0, max - 3)}...`
}
