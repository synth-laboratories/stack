import type { StackdMetaThreadManifest } from "../client/stackd.js"
import type { CodexGoalSnapshot } from "../codex/goal-context.js"

export type GoalModeState = {
  goalContext: CodexGoalSnapshot
  metaThreadManifest?: StackdMetaThreadManifest
}

export type GoalModeSnapshot = {
  objective?: string
  status?: string
  acceptanceCriteria: string[]
  blockers: string[]
  source: "manifest" | "codex" | "none"
  tokensUsed?: number
  tokenBudget?: string
  tokensRemaining?: string
  timeUsedSeconds?: number
}

export function activeGoalModeSnapshot(state: GoalModeState): GoalModeSnapshot {
  const meta = state.metaThreadManifest?.active_goal
  const metaObjective = meta?.objective?.trim()
  if (meta && metaObjective) {
    return {
      objective: metaObjective,
      status: meta.status,
      acceptanceCriteria: meta.acceptance_criteria,
      blockers: meta.blockers,
      source: "manifest",
      tokensUsed: state.goalContext.tokensUsed,
      tokenBudget: state.goalContext.tokenBudget,
      tokensRemaining: state.goalContext.tokensRemaining,
      timeUsedSeconds: state.goalContext.timeUsedSeconds,
    }
  }

  const codexObjective = state.goalContext.objective?.trim()
  return {
    objective: codexObjective,
    status: state.goalContext.status,
    acceptanceCriteria: state.goalContext.acceptanceCriteria ?? [],
    blockers: state.goalContext.blockers ?? [],
    source: codexObjective ? "codex" : "none",
    tokensUsed: state.goalContext.tokensUsed,
    tokenBudget: state.goalContext.tokenBudget,
    tokensRemaining: state.goalContext.tokensRemaining,
    timeUsedSeconds: state.goalContext.timeUsedSeconds,
  }
}

export function isGoalMode(state: GoalModeState): boolean {
  const goal = activeGoalModeSnapshot(state)
  if (!goal.objective) return false
  const status = goal.status?.trim().toLowerCase()
  return !status || status === "active" || status === "blocked" || status === "paused"
}
