import type { RemoteProjectPanelEntry, RemoteProjectsPanelSnapshot } from "../remote/research.js"

export function projectsPanelTitle(snapshot: RemoteProjectsPanelSnapshot): string {
  return `Projects · ${snapshot.environmentName}`
}

export function projectsPanelText(snapshot: RemoteProjectsPanelSnapshot, scrollOffset: number, visibleRows: number): string {
  const header = [
    `${snapshot.status}${snapshot.message ? ` · ${oneLine(snapshot.message, 28)}` : ""}`,
    "factories + runs per project",
  ]
  const body = projectPanelBody(snapshot.projects)
  const window = scrollWindow(body, scrollOffset, visibleRows)
  if (body.length === 0) {
    return [...header, "", emptyProjectsLine(snapshot)].join("\n")
  }
  if (window.length < body.length) {
    header.push(`scroll ${scrollOffset + 1}-${scrollOffset + window.length}/${body.length}`)
  }
  return [...header, "", ...window].join("\n")
}

function projectPanelBody(projects: RemoteProjectPanelEntry[]): string[] {
  if (projects.length === 0) return []
  const lines: string[] = []
  for (const project of projects) {
    lines.push(projectHeading(project))
    if (project.factories.length === 0) {
      lines.push("  (no linked factories)")
    } else {
      for (const factory of project.factories) {
        lines.push(`  f ${oneLine(factory.name, 18)} · ${factoryStatus(factory)}`)
      }
    }
    if (project.runs.length === 0) {
      lines.push("  (no runs yet)")
    } else {
      for (const run of project.runs) {
        lines.push(`  r ${run.runId.slice(0, 8)} · ${runState(run)} · ${runAge(run)}`)
      }
    }
    lines.push("")
  }
  if (lines.at(-1) === "") lines.pop()
  return lines
}

function projectHeading(project: RemoteProjectPanelEntry): string {
  const alias = project.alias && project.alias !== project.name ? ` (${oneLine(project.alias, 12)})` : ""
  const active = project.activeRunId ? ` · active ${project.activeRunId.slice(0, 8)}` : ""
  return `${oneLine(project.name, 22)}${alias}${active}`
}

function factoryStatus(factory: { status?: string; activeEfforts?: number; pausedOrWaiting?: number }): string {
  const parts = [factory.status ?? "unknown"]
  if (factory.activeEfforts !== undefined) parts.push(`${factory.activeEfforts} active`)
  if (factory.pausedOrWaiting) parts.push(`${factory.pausedOrWaiting} paused`)
  return parts.join(" ")
}

function runState(run: { state: string; phase?: string }): string {
  return run.phase ? `${run.state}/${run.phase}` : run.state
}

function runAge(run: { updatedAt?: string; createdAt?: string; finishedAt?: string }): string {
  const stamp = run.updatedAt ?? run.finishedAt ?? run.createdAt
  if (!stamp) return "-"
  const deltaMs = Date.now() - Date.parse(stamp)
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return "-"
  const minutes = Math.floor(deltaMs / 60_000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function emptyProjectsLine(snapshot: RemoteProjectsPanelSnapshot): string {
  if (snapshot.status === "missing-auth") return "add Synth API key to list projects"
  if (snapshot.status === "offline") return "dev API offline — start slot1"
  return "(no live projects)"
}

function scrollWindow(lines: string[], offset: number, visibleRows: number): string[] {
  if (visibleRows <= 0) return []
  const start = Math.max(0, Math.min(offset, Math.max(0, lines.length - visibleRows)))
  return lines.slice(start, start + visibleRows)
}

function oneLine(value: string, max: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, Math.max(0, max - 1))}…`
}
