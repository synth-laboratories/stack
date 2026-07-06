import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  stackdAssemblyList,
  type StackdAssemblyEvent,
  type StackdAssemblyLineRecord,
  type StackdAssemblyLineSnapshot,
} from "./client/stackd.js"

// Assembly context for the other cockpit actors. Monitors read the line +
// current station a worker is bound to (they audit and recommend — they never
// write gate verdicts or advance stations); the TUI writes handback artifacts
// under the line's artifacts folder. Binding resolution follows the manifest
// authority: a worker matches a line via the line's `meta_thread_ids` or
// `effort_ids` bindings against the worker's own meta-thread id / effort_ref.

export type StackAssemblyWorkerContext = {
  line_id: string
  title: string
  preset: StackdAssemblyLineSnapshot["preset"]
  current_station: string
  open_gate_station?: string
  next_action: string
}

const ASSEMBLY_CONTEXT_TTL_MS = 15_000

let cachedLines: { lines: StackdAssemblyLineSnapshot[]; fetchedAtMs: number } | undefined

async function listAssemblyLinesCached(): Promise<StackdAssemblyLineSnapshot[]> {
  const now = Date.now()
  if (cachedLines && now - cachedLines.fetchedAtMs < ASSEMBLY_CONTEXT_TTL_MS) {
    return cachedLines.lines
  }
  const { lines } = await stackdAssemblyList()
  cachedLines = { lines, fetchedAtMs: now }
  return lines
}

// The line a worker is bound to, or undefined when no line binds it. When a
// worker is bound to several lines the most recent (list order is
// created_at DESC) wins.
export async function resolveAssemblyContextForWorker(input: {
  metaThreadId?: string
  effortRef?: string
}): Promise<StackAssemblyWorkerContext | undefined> {
  if (!input.metaThreadId && !input.effortRef) return undefined
  const lines = await listAssemblyLinesCached()
  const match = lines.find(
    (line) =>
      (input.metaThreadId && (line.bindings.meta_thread_ids ?? []).includes(input.metaThreadId)) ||
      (input.effortRef && (line.bindings.effort_ids ?? []).includes(input.effortRef)),
  )
  if (!match) return undefined
  return {
    line_id: match.line_id,
    title: match.title,
    preset: match.preset,
    current_station: match.current_station,
    ...(match.open_gate ? { open_gate_station: match.open_gate.station } : {}),
    next_action: match.next_action,
  }
}

// A markdown handback for one line, written under
// `.stack/assembly/handbacks/<line_id>/`. The handback narrates the typed
// record — stations walked, bindings, gate history, next action — so the next
// owner starts from the log, not from memory.
export function writeAssemblyHandback(input: {
  stackDataRoot: string
  record: StackdAssemblyLineRecord
  events: readonly StackdAssemblyEvent[]
  snapshot: StackdAssemblyLineSnapshot
}): string {
  const { record, events, snapshot } = input
  const dir = join(input.stackDataRoot, ".stack", "assembly", "handbacks", record.id)
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const path = join(dir, `handback-${stamp}.md`)
  const gateEvents = events.filter(
    (event) => event.kind === "assembly.gate_failed" || event.kind === "assembly.gate_passed",
  )
  const lines = [
    `# Assembly handback — ${record.title}`,
    "",
    `line: ${record.id}`,
    `preset: ${record.preset}`,
    `owner: ${snapshot.owner}`,
    `current_station: ${snapshot.current_station} (${snapshot.station_state})`,
    `next_action: ${snapshot.next_action}`,
    ...(snapshot.open_gate
      ? [
          `open_gate: ${snapshot.open_gate.station} ${snapshot.open_gate.verdict} — ${snapshot.open_gate.next_owner} must ${snapshot.open_gate.next_safe_action}`,
        ]
      : []),
    ...(snapshot.shipped ? ["shipped: yes"] : []),
    "",
    "## Stations completed",
    ...(snapshot.completed_stations.length > 0
      ? snapshot.completed_stations.map((station) => `- ${station}`)
      : ["- none"]),
    "",
    "## Bindings",
    `- efforts: ${(record.bindings.effort_ids ?? []).join(", ") || "none"}`,
    `- meta-threads: ${(record.bindings.meta_thread_ids ?? []).join(", ") || "none"}`,
    `- workers: ${(record.bindings.worker_ids ?? []).join(", ") || "none"}`,
    `- gardeners: ${(record.bindings.gardener_ids ?? []).join(", ") || "none"}`,
    `- monitors: ${(record.bindings.monitor_ids ?? []).join(", ") || "none"}`,
    `- evidence: ${(snapshot.bindings.evidence_paths ?? []).join(", ") || "none"}`,
    `- ship bundle: ${record.bindings.ship_bundle_path ?? "none"}`,
    "",
    "## Standards verdicts",
    ...(gateEvents.length > 0
      ? gateEvents.map((event) => {
          const routing =
            event.kind === "assembly.gate_failed" && event.gate
              ? ` — next ${event.gate.next_owner ?? "?"}: ${event.gate.next_safe_action ?? "?"}`
              : ""
          return `- ${event.occurred_at} ${event.station ?? "?"} ${event.gate?.verdict ?? "n_a"} by ${event.actor_id}${routing}`
        })
      : ["- none"]),
    "",
    "## Event log",
    ...events.map(
      (event) =>
        `- ${event.occurred_at} ${event.kind}${event.station ? ` ${event.station}` : ""} actor=${event.actor_id}${event.note ? ` — ${event.note}` : ""}`,
    ),
    "",
  ]
  writeFileSync(path, lines.join("\n"), "utf8")
  return path
}
