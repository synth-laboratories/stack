// P2 — the structural per-criterion state machine. Each acceptance criterion moves
// open → worker_marked → audit_clean | audit_failed, derived from the event log (worker completion
// claims + the monitor's goal_status audit). This is what lets the UI/gardener see WHICH criteria
// are proven vs merely claimed, instead of a flat done/total count.

import type { StackThreadMetaEvent } from "./thread-events.js"

export type CriterionState = "open" | "worker_marked" | "audit_clean" | "audit_failed"

export type CriterionStatus = {
  criterion: string
  state: CriterionState
}

const DONE_BOX = /^\s*[-*]?\s*\[\s*[xX]\s*\]\s*/
const OPEN_BOX = /^\s*[-*]?\s*\[\s*\]\s*/
const COMPLETION_RE = /\b(done|complete[d]?|goal (?:is )?met|finished the goal|marking .* done)\b/i

function parseCriterion(raw: string): { label: string; boxDone: boolean } {
  if (DONE_BOX.test(raw)) return { label: raw.replace(DONE_BOX, "").trim(), boxDone: true }
  if (OPEN_BOX.test(raw)) return { label: raw.replace(OPEN_BOX, "").trim(), boxDone: false }
  return { label: raw.trim(), boxDone: false }
}

function eventText(event: StackThreadMetaEvent): string {
  const p = event.payload as Record<string, unknown>
  return String(p.stdout_excerpt ?? p.summary ?? p.note ?? p.message ?? "")
}

// Derive each criterion's state from the criteria list + the thread's event log.
export function deriveCriteriaStates(
  criteria: readonly string[],
  events: readonly StackThreadMetaEvent[],
): CriterionStatus[] {
  // The monitor's most recent structured audit verdict is authoritative for clean/failed.
  const latestGoalStatus = [...events]
    .reverse()
    .find((e) => e.type === "monitor.goal_status")
  const verdict = latestGoalStatus ? String((latestGoalStatus.payload as Record<string, unknown>).status ?? "") : undefined
  const verdictNote = latestGoalStatus ? eventText(latestGoalStatus).toLowerCase() : ""

  // The worker claiming completion moves an open criterion to worker_marked (a claim, not proof).
  const workerClaimed = events.some(
    (e) => (e.type === "agent.turn.completed" || e.type === "agent.message") && COMPLETION_RE.test(eventText(e)),
  )

  return criteria.map((raw) => {
    const { label, boxDone } = parseCriterion(raw)
    let state: CriterionState = boxDone || workerClaimed ? "worker_marked" : "open"

    // Per-criterion refinement: if the audit note explicitly references this criterion, trust it.
    const tokens = label.toLowerCase().split(/[^a-z0-9_]+/).filter((t) => t.length > 3)
    const referenced = tokens.length > 0 && tokens.some((t) => verdictNote.includes(t))

    if (verdict === "goal_met") {
      state = "audit_clean"
    } else if (verdict === "goal_failed" || verdict === "blocked" || verdict === "stalled") {
      // a claimed-or-referenced criterion under a failing audit is refuted, not open
      if (state === "worker_marked" || referenced) state = "audit_failed"
    }
    return { criterion: label, state }
  })
}

export function summarizeCriteriaStates(states: readonly CriterionStatus[]): {
  total: number
  open: number
  worker_marked: number
  audit_clean: number
  audit_failed: number
} {
  const s = { total: states.length, open: 0, worker_marked: 0, audit_clean: 0, audit_failed: 0 }
  for (const c of states) s[c.state] += 1
  return s
}
