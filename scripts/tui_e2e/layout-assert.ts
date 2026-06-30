/** Layout invariants for goal shutter / sidecar progress (Termless E2E). */

export type GoalShutterLayoutCheck = {
  ok: boolean
  failures: string[]
  anchors: {
    goalTitleLine?: number
    sidecarThreadLine?: number
    sidecarInputLine?: number
    monitorStreamLine?: number
  }
}

const OVERLAP_PATTERNS: RegExp[] = [
  /^G[oO]event/i,
  /Goal\s*[·.].*(?:monitor\s+low|event\s+delta|command_execution)/i,
  /^Goal\s*[·.].{0,8}monitor/i,
  /Sidecar thread.*monitor\s+low/i,
]

export function terminalLines(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
}

export function assertGoalShutterLayout(text: string): GoalShutterLayoutCheck {
  const lines = terminalLines(text)
  const failures: string[] = []
  const anchors: GoalShutterLayoutCheck["anchors"] = {}

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim()
    if (!trimmed) continue

    for (const pattern of OVERLAP_PATTERNS) {
      if (pattern.test(trimmed)) {
        failures.push(`line ${index + 1} overlap: ${JSON.stringify(trimmed.slice(0, 120))}`)
      }
    }

    if (trimmed.includes("Goal ·") && anchors.goalTitleLine === undefined) {
      anchors.goalTitleLine = index
    }
    if (trimmed.includes("Sidecar thread") && anchors.sidecarThreadLine === undefined) {
      anchors.sidecarThreadLine = index
    }
    if (trimmed.includes("Message sidecar") && anchors.sidecarInputLine === undefined) {
      anchors.sidecarInputLine = index
    }
    if (
      (trimmed.includes("monitor low") || trimmed.includes("monitor  ") || trimmed.includes("Sidecar progress")) &&
      anchors.monitorStreamLine === undefined &&
      !trimmed.includes("Sidecar thread")
    ) {
      anchors.monitorStreamLine = index
    }
  }

  if (anchors.goalTitleLine === undefined) {
    failures.push('missing anchor: "Goal ·" title line')
  }
  if (anchors.sidecarInputLine === undefined) {
    failures.push('missing anchor: "Message sidecar" input line')
  }
  if (anchors.sidecarThreadLine === undefined) {
    failures.push('missing anchor: "Sidecar thread" panel title')
  }

  if (
    anchors.goalTitleLine !== undefined &&
    anchors.sidecarInputLine !== undefined &&
    anchors.goalTitleLine >= anchors.sidecarInputLine
  ) {
    failures.push("goal title must appear above sidecar input")
  }

  if (
    anchors.sidecarThreadLine !== undefined &&
    anchors.sidecarInputLine !== undefined &&
    anchors.sidecarThreadLine >= anchors.sidecarInputLine
  ) {
    failures.push("sidecar thread panel must appear above sidecar input")
  }

  return { ok: failures.length === 0, failures, anchors }
}
