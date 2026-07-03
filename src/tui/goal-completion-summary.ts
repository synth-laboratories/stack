import { formatGoalCompute, type CodexGoalSnapshot } from "../codex/goal-context.js"
import { reduceGoalSessionSnapshot } from "../goal-session.js"
import type { StackThreadMetaEvent } from "../thread-events.js"
import { activeGoalModeSnapshot, type GoalModeState } from "./goal-mode.js"
import { formatGoalMetric, goalMilestonesFromEvents } from "./monitor-thread.js"
import type { StackMonitorSnapshot } from "../monitor.js"

export type GoalCompletionSummaryInput = {
  state: GoalModeState & { monitorSnapshot: StackMonitorSnapshot }
  events: readonly StackThreadMetaEvent[]
  metaThreadId?: string
  columns: number
}

const COMPLETION_RE =
  /\b(Goal marked complete|done|complete[d]?|goal (?:is )?met|finished the goal|marking .* done)\b/i

export function isTerminalGoalDisplayStatus(status: string | undefined): boolean {
  const normalized = status?.trim().toLowerCase()
  return normalized === "done" || normalized === "complete" || normalized === "completed"
}

function workerCompletionExcerpt(events: readonly StackThreadMetaEvent[]): string | undefined {
  for (const event of [...events].reverse()) {
    if (event.type !== "agent.turn.completed") continue
    const excerpt = readPayloadString(event.payload, "stdout_excerpt")
    if (excerpt && COMPLETION_RE.test(excerpt)) return excerpt
  }
  return undefined
}

function readPayloadString(payload: unknown, key: string): string | undefined {
  if (!payload || typeof payload !== "object") return undefined
  const value = (payload as Record<string, unknown>)[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function cleanCompletionLine(raw: string): string {
  return raw
    .replace(/^\s*[-*]\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function sectionNameFromLine(line: string): string | undefined {
  const trimmed = line.trim()
  const markdown = trimmed.match(/^\*\*(.+?)\*\*:?\s*$/)
  if (markdown) return markdown[1].replace(/\.$/, "").trim()
  const plain = trimmed.match(/^(Final goal state|Fresh evidence(?: used)?|Evidence|Outcome|Result)s?:?\s*$/i)
  if (plain) return plain[1].replace(/:.*$/, "").trim()
  return undefined
}

function parseCompletionSections(text: string): Array<{ name: string; lines: string[] }> {
  const sections: Array<{ name: string; lines: string[] }> = []
  let currentName = ""
  let currentLines: string[] = []

  const flush = () => {
    if (!currentName && currentLines.length === 0) return
    sections.push({ name: currentName || "Summary", lines: currentLines })
    currentName = ""
    currentLines = []
  }

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const sectionName = sectionNameFromLine(line)
    if (sectionName) {
      flush()
      currentName = sectionName
      continue
    }
    if (/^Goal marked complete/i.test(cleanCompletionLine(line))) {
      flush()
      currentName = "Goal marked complete"
      continue
    }
    currentLines.push(cleanCompletionLine(line))
  }
  flush()
  return sections
}

function oneLine(value: string, maxLength: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim()
  if (trimmed.length <= maxLength) return trimmed
  if (maxLength <= 1) return trimmed.slice(0, maxLength)
  return `${trimmed.slice(0, maxLength - 1)}…`
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remMinutes = minutes % 60
  return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`
}

function formatCompactTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M tokens`
  if (value >= 10_000) return `${Math.round(value / 1000)}k tokens`
  return `${value.toLocaleString("en-US")} tokens`
}

function fallbackFinalStateLines(
  goal: ReturnType<typeof activeGoalModeSnapshot>,
  goalContext: CodexGoalSnapshot,
  session: ReturnType<typeof reduceGoalSessionSnapshot>,
  width: number,
): string[] {
  const lines: string[] = []
  if (goal.objective) lines.push(oneLine(`objective · ${goal.objective}`, width))
  lines.push(`status · ${goal.status ?? session?.status ?? "done"}`)
  const compute = formatGoalCompute(goalContext)
  if (compute) lines.push(oneLine(compute.replace(/\btok\b/g, "tokens"), width))
  const elapsed = session?.spend?.elapsed_s ?? goalContext.timeUsedSeconds
  if (elapsed !== undefined && elapsed > 0) lines.push(`elapsed · ${formatDuration(elapsed)}`)
  return lines
}

function sectionWanted(name: string): boolean {
  const normalized = name.toLowerCase()
  return (
    normalized.includes("goal marked complete") ||
    normalized.includes("final goal") ||
    normalized.includes("fresh evidence") ||
    normalized.includes("evidence") ||
    normalized.includes("outcome") ||
    normalized.includes("result")
  )
}

export function goalCompletionSummaryLinesForHistoryEntry(input: {
  objective: string
  status?: string
  events: readonly StackThreadMetaEvent[]
  state: GoalCompletionSummaryInput["state"]
  metaThreadId?: string
  columns: number
}): string[] | undefined {
  const objective = input.objective.trim()
  if (!objective) return undefined

  const goal = {
    objective,
    status: input.status,
    acceptanceCriteria: [] as string[],
    blockers: [] as string[],
    source: "manifest" as const,
  }
  const session = reduceGoalSessionSnapshot({
    events: [...input.events],
    goal,
    metaThreadId: input.metaThreadId,
    monitorThreadSpendUsd: input.state.monitorSnapshot.threadSpendUsd,
  })
  const displayStatus = session?.status ?? input.status
  const terminal =
    isTerminalGoalDisplayStatus(displayStatus) ||
    isTerminalGoalDisplayStatus(input.status) ||
    session?.status === "done"
  if (!terminal) return undefined

  const width = Math.max(24, input.columns - 6)
  const lines: string[] = ["Goal marked complete."]

  const excerpt = workerCompletionExcerpt(input.events)
  if (excerpt) {
    for (const section of parseCompletionSections(excerpt)) {
      if (!sectionWanted(section.name)) continue
      if (!section.name.toLowerCase().includes("goal marked complete") && section.name) {
        lines.push(section.name)
      }
      for (const bodyLine of section.lines) {
        if (!bodyLine) continue
        lines.push(oneLine(`  ${bodyLine}`, width))
      }
    }
  }

  if (lines.length <= 1) {
    lines.push("Final goal state")
    const goalContext: CodexGoalSnapshot = {
      source: "none",
      objective,
      status: input.status,
      tokensUsed: session?.spend.worker_tokens,
      timeUsedSeconds: session?.spend.elapsed_s,
    }
    for (const bodyLine of fallbackFinalStateLines(goal, goalContext, session, width - 2)) {
      lines.push(oneLine(`  ${bodyLine}`, width))
    }
  }

  const goalMet = [...goalMilestonesFromEvents([...input.events])].reverse().find((m) => m.status === "goal_met")
  if (goalMet) {
    lines.push("Monitor audit")
    const metric = formatGoalMetric(goalMet.metric)
    const auditLine = [goalMet.note, metric].filter(Boolean).join(" · ")
    if (auditLine) lines.push(oneLine(`  ${auditLine}`, width))
  }

  return lines
}

export function goalCompletionSummaryLines(input: GoalCompletionSummaryInput): string[] | undefined {
  const goal = activeGoalModeSnapshot(input.state)
  if (!goal.objective) return undefined

  const session = reduceGoalSessionSnapshot({
    events: [...input.events],
    goal,
    metaThreadId: input.metaThreadId,
    monitorThreadSpendUsd: input.state.monitorSnapshot.threadSpendUsd,
  })
  const displayStatus = session?.status ?? goal.status
  const terminal =
    isTerminalGoalDisplayStatus(displayStatus) ||
    isTerminalGoalDisplayStatus(goal.status) ||
    session?.status === "done"
  if (!terminal) return undefined

  const width = Math.max(24, input.columns - 6)
  const lines: string[] = ["Goal marked complete."]

  const excerpt = workerCompletionExcerpt(input.events)
  if (excerpt) {
    for (const section of parseCompletionSections(excerpt)) {
      if (!sectionWanted(section.name)) continue
      if (!section.name.toLowerCase().includes("goal marked complete") && section.name) {
        lines.push(section.name)
      }
      for (const bodyLine of section.lines.slice(0, 8)) {
        if (!bodyLine) continue
        lines.push(oneLine(`  ${bodyLine}`, width))
      }
    }
  }

  if (lines.length <= 1) {
    lines.push("Final goal state")
    for (const bodyLine of fallbackFinalStateLines(goal, input.state.goalContext, session, width - 2)) {
      lines.push(oneLine(`  ${bodyLine}`, width))
    }
  }

  const goalMet = [...goalMilestonesFromEvents([...input.events])].reverse().find((m) => m.status === "goal_met")
  if (goalMet) {
    lines.push("Monitor audit")
    const metric = formatGoalMetric(goalMet.metric)
    const auditLine = [goalMet.note, metric].filter(Boolean).join(" · ")
    if (auditLine) lines.push(oneLine(`  ${auditLine}`, width))
  } else if (input.state.goalContext.tokensUsed !== undefined && lines.length <= 4) {
    lines.push(oneLine(`  ${formatCompactTokens(input.state.goalContext.tokensUsed)}`, width))
  }

  return lines
}

export function goalCompletionSummaryLineCount(input: GoalCompletionSummaryInput): number {
  return goalCompletionSummaryLines(input)?.length ?? 0
}
