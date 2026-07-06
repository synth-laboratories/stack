import type { StackConfig } from "./config.js"
import {
  stackdAssemblyGet,
  stackdAssemblyList,
  stackdAssemblyTransition,
  StackdHttpError,
  type StackdAssemblyLineSnapshot,
  type StackdAssemblyTransitionRequest,
} from "./client/stackd.js"

// `stack assembly` — read + transition surface for Assembly Lines, the
// process layer above Efforts (docs/ASSEMBLY_LINES.md). Rendering follows the
// cockpit-style list convention: one row per line with id, preset, current
// station, owner, age, open gate, next action. No filters, no modes.

export async function runAssemblyCli(_config: StackConfig, argv: string[]): Promise<number> {
  const [, verb, ...rest] = argv
  try {
    if (verb === "list" || verb === undefined) {
      return await listLines()
    }
    if (verb === "get") {
      const lineId = rest[0]
      if (!lineId) {
        console.error("usage: stack assembly get <line-id>")
        return 2
      }
      return await getLine(lineId)
    }
    if (verb === "transition") {
      return await transitionLine(rest)
    }
    console.error(usage())
    return 2
  } catch (error) {
    if (error instanceof StackdHttpError) {
      console.error(`assembly request failed (${error.status}): ${error.body || error.message}`)
      return 1
    }
    console.error(`assembly request failed: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

function usage(): string {
  return [
    "usage:",
    "  stack assembly list",
    "  stack assembly get <line-id>",
    "  stack assembly transition <line-id> --kind <assembly.*> --actor <actor-id>",
    "      [--station <id>] [--verdict pass|concern|fail|n_a]",
    "      [--next-owner <actor-id>] [--next-safe-action <text>]",
    "      [--evidence <path>[,<path>...]] [--due-at <rfc3339>] [--note <text>]",
  ].join("\n")
}

async function listLines(): Promise<number> {
  const { lines } = await stackdAssemblyList()
  if (lines.length === 0) {
    console.log("no assembly lines yet — create one with stack_assembly_create (Stack MCP)")
    return 0
  }
  const rows = lines.map((line) => [
    line.line_id,
    line.preset,
    line.current_station,
    line.owner,
    formatAge(line.age_seconds),
    line.open_gate ? `${line.open_gate.station}:${line.open_gate.verdict}` : "-",
    line.next_action,
  ])
  printTable(["LINE", "PRESET", "STATION", "OWNER", "AGE", "GATE", "NEXT ACTION"], rows)
  return 0
}

async function getLine(lineId: string): Promise<number> {
  const { snapshot, events } = await stackdAssemblyGet(lineId)
  printSnapshot(snapshot)
  console.log("")
  console.log("recent events:")
  for (const event of events.slice(-10)) {
    const station = event.station ? ` station=${event.station}` : ""
    const gate = event.gate
      ? ` verdict=${event.gate.verdict}${event.gate.next_owner ? ` next_owner=${event.gate.next_owner}` : ""}`
      : ""
    console.log(`  ${event.occurred_at}  ${event.kind}${station}${gate}  actor=${event.actor_id}`)
  }
  return 0
}

async function transitionLine(rest: string[]): Promise<number> {
  const lineId = rest[0]
  if (!lineId || lineId.startsWith("--")) {
    console.error(usage())
    return 2
  }
  const flags = parseFlags(rest.slice(1))
  const kind = flags.get("kind")
  const actorId = flags.get("actor")
  if (!kind || !actorId) {
    console.error("transition requires --kind and --actor")
    return 2
  }
  const transition = buildTransition(kind, actorId, flags)
  const { event, snapshot } = await stackdAssemblyTransition(lineId, transition)
  console.log(`recorded ${event.kind} (${event.event_id})`)
  printSnapshot(snapshot)
  return 0
}

function buildTransition(
  kind: string,
  actorId: string,
  flags: Map<string, string>,
): StackdAssemblyTransitionRequest {
  const station = flags.get("station")
  const verdict = flags.get("verdict")
  const evidence = (flags.get("evidence") ?? "")
    .split(",")
    .map((path) => path.trim())
    .filter(Boolean)
  const note = flags.get("note")
  const requireStation = (): string => {
    if (!station) throw new Error(`--station is required for ${kind}`)
    return station
  }
  if (kind === "assembly.station_started") {
    return { kind, station: requireStation(), actor_id: actorId }
  }
  if (kind === "assembly.station_completed") {
    return { kind, station: requireStation(), actor_id: actorId, evidence_paths: evidence, note }
  }
  if (kind === "assembly.gate_failed") {
    if (verdict !== "concern" && verdict !== "fail") {
      throw new Error("assembly.gate_failed requires --verdict concern|fail")
    }
    const nextOwner = flags.get("next-owner")
    const nextSafeAction = flags.get("next-safe-action")
    if (!nextOwner || !nextSafeAction) {
      throw new Error("assembly.gate_failed requires --next-owner and --next-safe-action")
    }
    return {
      kind,
      station: requireStation(),
      actor_id: actorId,
      verdict,
      next_owner: nextOwner,
      next_safe_action: nextSafeAction,
      evidence_paths: evidence,
      note,
    }
  }
  if (kind === "assembly.gate_passed") {
    if (verdict !== "pass" && verdict !== "n_a") {
      throw new Error("assembly.gate_passed requires --verdict pass|n_a")
    }
    return { kind, station: requireStation(), actor_id: actorId, verdict, evidence_paths: evidence, note }
  }
  if (kind === "assembly.shipped") {
    return { kind, actor_id: actorId, evidence_paths: evidence, note }
  }
  if (kind === "assembly.follow_up_due") {
    const dueAt = flags.get("due-at")
    if (!dueAt) throw new Error("assembly.follow_up_due requires --due-at")
    return { kind, actor_id: actorId, due_at: dueAt, note }
  }
  throw new Error(`unknown transition kind: ${kind}`)
}

function printSnapshot(snapshot: StackdAssemblyLineSnapshot): void {
  console.log(`${snapshot.line_id}  [${snapshot.preset}]  ${snapshot.title}`)
  console.log(`  owner: ${snapshot.owner}  age: ${formatAge(snapshot.age_seconds)}`)
  console.log(`  station: ${snapshot.current_station} (${snapshot.station_state})`)
  if (snapshot.open_gate) {
    console.log(
      `  gate: ${snapshot.open_gate.station} ${snapshot.open_gate.verdict} — ${snapshot.open_gate.next_owner} must ${snapshot.open_gate.next_safe_action}`,
    )
  }
  if (snapshot.shipped) console.log("  shipped: yes")
  if (snapshot.follow_up_due_at) console.log(`  follow-up due: ${snapshot.follow_up_due_at}`)
  console.log(`  next action: ${snapshot.next_action}`)
}

function parseFlags(args: string[]): Map<string, string> {
  const flags = new Map<string, string>()
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg?.startsWith("--")) continue
    const value = args[index + 1]
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`flag ${arg} requires a value`)
    }
    flags.set(arg.slice(2), value)
    index += 1
  }
  return flags
}

function formatAge(seconds: number): string {
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`
  return `${Math.round(seconds / 86400)}d`
}

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? "").length)),
  )
  const render = (cells: string[]): string =>
    cells.map((cell, column) => cell.padEnd(widths[column] ?? cell.length)).join("  ")
  console.log(render(headers))
  for (const row of rows) console.log(render(row))
}
