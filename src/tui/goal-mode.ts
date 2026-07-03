import type { StackdMetaThreadManifest } from "../client/stackd.js"
import type { CodexGoalSnapshot } from "../codex/goal-context.js"
import { listGoalHistory } from "../goal-session.js"
import type { StackThreadMetaEvent } from "../thread-events.js"

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

/** Goal still bound to the thread (including done/complete) — use for monitor goal tab, not shutter layout. */
export function hasGoalContext(state: GoalModeState): boolean {
  const goal = activeGoalModeSnapshot(state)
  if (!goal.objective) return false
  const status = goal.status?.trim().toLowerCase()
  return status !== "cleared"
}

/** Worker goal/chat tabs when an active goal, terminal goal on thread, or prior goal history exists. */
export function showWorkerGoalTabs(state: GoalModeState, events: readonly StackThreadMetaEvent[]): boolean {
  if (isGoalMode(state) || hasGoalContext(state)) return true
  const manifest = state.metaThreadManifest?.active_goal
  return listGoalHistory(events, {
    metaThreadId: state.metaThreadManifest?.id,
    manifestGoal: manifest,
  }).length > 0
}
