import { Box, Text } from "@opentui/core"
import type { StackdMetaThreadManifest } from "../client/stackd.js"
import type { CodexGoalSnapshot } from "../codex/goal-context.js"
import { parseCriterionEntry } from "../meta-thread-goal-criteria.js"
import { stackTuiTheme as theme } from "./theme.js"

export type GoalPanelState = {
  goalContext: CodexGoalSnapshot
  metaThreadManifest?: StackdMetaThreadManifest
  goalPanelSelectedIndex: number
}

export function openGoalPanel(state: GoalPanelState): void {
  state.goalPanelSelectedIndex = 0
}

export function activeGoalFromState(state: GoalPanelState): {
  objective?: string
  status?: string
  acceptanceCriteria: string[]
  blockers: string[]
} {
  const meta = state.metaThreadManifest?.active_goal
  return {
    objective: meta?.objective?.trim() || state.goalContext.objective?.trim(),
    status: meta?.status ?? state.goalContext.status,
    acceptanceCriteria: meta?.acceptance_criteria ?? [],
    blockers: meta?.blockers ?? [],
  }
}

export function goalPanelLines(state: GoalPanelState): string[] {
  const goal = activeGoalFromState(state)
  const lines = [
    goal.objective ? `status ${goal.status ?? "active"}` : "no active goal",
    goal.objective ?? "next: /goal <objective>",
    "j/k criteria · space toggle · p pause · r resume · c clear · esc close",
  ]
  if (goal.acceptanceCriteria.length === 0) {
    lines.push("(no criteria · /goal criteria add <text>)")
    return lines
  }
  for (const [index, entry] of goal.acceptanceCriteria.entries()) {
    const parsed = parseCriterionEntry(entry)
    const marker = state.goalPanelSelectedIndex === index ? ">" : " "
    const check = parsed.done ? "[x]" : "[ ]"
    lines.push(`${marker} ${index + 1}. ${check} ${parsed.label}`)
  }
  if (goal.blockers.length > 0) {
    lines.push(`blockers: ${goal.blockers.slice(0, 2).join(" · ")}`)
  }
  return lines
}

export function renderGoalPanel(state: GoalPanelState): ReturnType<typeof Box> {
  const lines = goalPanelLines(state)
  return Box(
    {
      border: true,
      borderStyle: "single",
      borderColor: theme.borderActive,
      title: "Goal Panel",
      padding: 1,
      flexDirection: "column",
      width: "100%",
      flexShrink: 0,
      gap: 0,
    },
    ...lines.map((line, index) => {
      const criterionIndex = index - 3
      const goal = activeGoalFromState(state)
      const isCriterionLine = criterionIndex >= 0 && criterionIndex < goal.acceptanceCriteria.length
      const selected = isCriterionLine && criterionIndex === state.goalPanelSelectedIndex
      return Text({
        content: line,
        fg: selected ? theme.synth.amber : line.startsWith(">") ? theme.fgPrimary : theme.fgSecondary,
        bg: selected ? theme.bgChipActive : undefined,
        width: "100%",
        flexShrink: 0,
      })
    }),
  )
}

export function navigateGoalPanelSelection(state: GoalPanelState, direction: "up" | "down"): void {
  const count = activeGoalFromState(state).acceptanceCriteria.length
  if (count === 0) {
    state.goalPanelSelectedIndex = 0
    return
  }
  if (direction === "up") {
    state.goalPanelSelectedIndex = Math.max(0, state.goalPanelSelectedIndex - 1)
    return
  }
  state.goalPanelSelectedIndex = Math.min(count - 1, state.goalPanelSelectedIndex + 1)
}
