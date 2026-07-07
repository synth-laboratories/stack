/**
 * Deterministic row-heights for the gardener pane's pinned bottom widgets (plan checklist + agents
 * block). Every row in those widgets is clamped to a single terminal line, so height is exact.
 *
 * These exist so the transcript pane can *reserve* rows for the widgets below it. The transcript
 * renders a fixed line budget; if that budget isn't reduced by the widgets' height, the transcript
 * content overflows onto them and composites as garbled overlapping text. gardener-pane-layout.test
 * asserts the reservation keeps the composited pane within the viewport.
 */

/** header + up to 6 agent rows + an overflow row when there are more than 6. */
export function gardenerAgentBlockHeight(agentCount: number): number {
  if (agentCount <= 0) return 0
  return 1 + Math.min(agentCount, 6) + (agentCount > 6 ? 1 : 0)
}

/** header + one row per plan step. */
export function gardenerPlanBlockHeight(stepCount: number): number {
  if (stepCount <= 0) return 0
  return 1 + stepCount
}

/**
 * Transcript rows after reserving space for the fixed bottom widgets. Clamped to at least 1 so a
 * too-small viewport degrades gracefully instead of producing a negative height.
 */
export function gardenerTranscriptRowsWithReserve(viewportLines: number, ...widgetHeights: number[]): number {
  const reserve = widgetHeights.reduce((sum, height) => sum + Math.max(0, height), 0)
  return Math.max(1, viewportLines - reserve)
}
