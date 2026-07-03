import { StyledText, bold, dim, fg } from "@opentui/core"
import type { StackdMetaThreadManifest } from "../client/stackd.js"
import { formatGoalCompute, type CodexGoalSnapshot } from "../codex/goal-context.js"
import { stackTuiTheme as theme, goalLifecycleStatusColor } from "./theme.js"

function truncateLine(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text
  if (maxWidth <= 3) return text.slice(0, maxWidth)
  return `${text.slice(0, maxWidth - 1)}…`
}

function normalizeGoalStatus(status: string | undefined): string {
  const normalized = (status ?? "active").trim().toLowerCase()
  return normalized === "blocked" ? "active" : normalized
}

function humanizeGoalStatus(status: string | undefined): string {
  const normalized = normalizeGoalStatus(status)
  if (normalized === "active") return "Active"
  if (normalized === "paused") return "Paused"
  if (normalized === "done" || normalized === "complete" || normalized === "completed") return "Done"
  if (normalized === "cleared") return "Cleared"
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

function formatTokenSpend(snapshot: CodexGoalSnapshot): string | undefined {
  const compute = formatGoalCompute(snapshot)
  if (!compute) return undefined
  return compute.replace(/\btok\b/g, "tokens")
}

function goalPreviewMetrics(
  metaGoal: StackdMetaThreadManifest["active_goal"],
  goalContext: CodexGoalSnapshot,
): string[] {
  const metrics: string[] = []
  const spend = formatTokenSpend(goalContext)
  if (spend) metrics.push(spend)

  if (goalContext.tokenBudget && goalContext.tokenBudget !== "none") {
    metrics.push(`budget ${goalContext.tokenBudget}`)
  } else if (goalContext.tokensRemaining && goalContext.tokensRemaining !== "unbounded") {
    metrics.push(`${goalContext.tokensRemaining} left`)
  }

  const criteriaCount = metaGoal?.acceptance_criteria?.length ?? goalContext.acceptanceCriteria?.length ?? 0
  if (criteriaCount > 0) metrics.push(`${criteriaCount} criteria`)

  return metrics
}

/** Compact worker-input goal preview with colored status and an explicit blocker line when set. */
export function renderAgentGoalPreviewStyled(
  manifest: StackdMetaThreadManifest | undefined,
  goalContext: CodexGoalSnapshot,
  columns: number,
): StyledText[] {
  const width = Math.max(24, columns - 2)
  const metaGoal = manifest?.active_goal
  const objective = metaGoal?.objective?.trim() || goalContext.objective?.trim()
  if (!objective) return []

  const rawStatus = metaGoal?.status ?? goalContext.status
  const normalizedStatus = normalizeGoalStatus(rawStatus)
  const statusLabel = humanizeGoalStatus(normalizedStatus)
  const blockers = (metaGoal?.blockers ?? goalContext.blockers ?? [])
    .map((blocker) => blocker.replace(/\s+/g, " ").trim())
    .filter(Boolean)

  const objectiveClean = objective.replace(/\s+/g, " ").trim()
  const metrics = goalPreviewMetrics(metaGoal, goalContext)
  const metricsSuffix = metrics.length > 0 ? ` · ${metrics.join(" · ")}` : ""
  const statusSuffix = `${statusLabel}${metricsSuffix}`
  const goalPrefix = "Goal — "
  const inlineSeparator = " · "
  const reservedSuffixWidth = inlineSeparator.length + statusSuffix.length
  const maxHeadlineWidth = width - reservedSuffixWidth

  const lines: StyledText[] = []
  const statusStyled = [
    bold(fg(goalLifecycleStatusColor(normalizedStatus))(statusLabel)),
    ...(metricsSuffix ? [dim(fg(theme.fgMuted)(metricsSuffix))] : []),
  ]

  if (maxHeadlineWidth >= goalPrefix.length + 8) {
    const headline = truncateLine(`${goalPrefix}${objectiveClean}`, maxHeadlineWidth)
    lines.push(
      new StyledText([
        fg(theme.synth.amber)(headline),
        dim(fg(theme.fgMuted)(inlineSeparator)),
        ...statusStyled,
      ]),
    )
  } else {
    lines.push(new StyledText([fg(theme.synth.amber)(truncateLine(`${goalPrefix}${objectiveClean}`, width))]))
    lines.push(new StyledText(statusStyled))
  }

  if (blockers.length > 0) {
    if (blockers.length === 1) {
      lines.push(
        new StyledText([fg(theme.synth.orange)(truncateLine(`Needs attention — ${blockers[0]!}`, width))]),
      )
    } else if (blockers.length > 1) {
      const lead = truncateLine(blockers[0]!, Math.max(20, width - 16))
      lines.push(
        new StyledText([
          fg(theme.synth.orange)(`Needs attention — ${lead}`),
          dim(fg(theme.fgMuted)(` · +${blockers.length - 1} more`)),
        ]),
      )
    }
  }

  return lines
}

export function agentGoalPreviewLineCount(
  manifest: StackdMetaThreadManifest | undefined,
  goalContext: CodexGoalSnapshot,
  columns: number,
): number {
  return renderAgentGoalPreviewStyled(manifest, goalContext, columns).length
}

/** @deprecated Use renderAgentGoalPreviewStyled for colored output. */
export function agentGoalPreviewLines(
  manifest: StackdMetaThreadManifest | undefined,
  goalContext: CodexGoalSnapshot,
  columns: number,
): string[] {
  return renderAgentGoalPreviewStyled(manifest, goalContext, columns).map((line) => line.toString())
}

/** Rows reserved below the worker transcript for goal preview, input, controls, and panel chrome. */
export function agentPanelChromeRows(input: {
  goalPreviewLineCount: number
  inputLineCount: number
  slashMenuOpen: boolean
  goalMode: boolean
  gardenerSession: boolean
  railsVisible: boolean
}): number {
  let rows = 3
  if (input.railsVisible) rows += 1
  rows += input.goalPreviewLineCount
  rows += input.inputLineCount
  if (input.slashMenuOpen) rows += 1
  if (input.goalMode && !input.gardenerSession) rows += 1
  else if (input.gardenerSession) rows += 2
  else rows += 3
  rows += 1
  return rows
}
