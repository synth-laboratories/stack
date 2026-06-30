#!/usr/bin/env bun
// AT-STACK-UI-GOAL-001 — TUI meta-thread goal chip + checklist render.
// Pure render smoke over metaThreadGoalStripLines + mergeMetaThreadGoalContext.

import {
  mergeMetaThreadGoalContext,
  metaThreadGoalStripLines,
} from "../src/meta-thread-goal.ts"
import type { StackdMetaThreadManifest } from "../src/client/stackd.ts"
import { emptyGoalContext, mergeGoalContext } from "../src/codex/goal-context.ts"

const fail = (msg: string, detail?: unknown): never => {
  console.error(`stack_ui_meta_thread_goal FAIL: ${msg}`, detail ?? "")
  process.exit(1)
}

const objective = "Rebuild TicTacToe Harbor env; pass 20-scenario spectrum (harbor_reward=1.0)"

// metaThreadGoalStripLines only reads manifest.active_goal; cast a partial fixture.
const boundManifest = {
  active_goal: {
    objective,
    status: "active",
    acceptance_criteria: [
      "SE-TTT-HARBOR-1-WORKSPACE green",
      "SE-TTT-HARBOR-2-SERVICE green",
      "SE-TTT-HARBOR-3-SPECTRUM harbor_reward=1.0",
      "SE-TTT-HARBOR-4-TRACE export present",
      "SE-TTT-HARBOR-5-LANE no policy-hillclimb",
    ],
    blockers: ["awaiting Harbor service boot on :19081"],
  },
} as unknown as StackdMetaThreadManifest

const columns = 80

// 1. Goal chip renders when bound: first line carries status + objective.
const lines = metaThreadGoalStripLines(boundManifest, columns)
if (lines.length === 0) fail("no goal strip lines when manifest bound")
if (!lines[0]?.includes("mt ·") || !lines[0]?.includes("active")) {
  fail("goal chip header missing status badge", lines[0])
}
if (!lines[0]?.includes("Rebuild TicTacToe Harbor")) {
  fail("goal chip header missing objective", lines[0])
}

// 2. Checklist shows acceptance_criteria with a done/todo state, capped at 4 + overflow.
const checklistLines = lines.filter((l) => l.includes("[ ]") || l.includes("[x]"))
if (checklistLines.length < 1) fail("no checklist criteria rendered", lines)
const overflow = lines.find((l) => l.includes("+1 criteria"))
if (!overflow) fail("5 criteria should render 4 + overflow note", lines)
const blockerLine = lines.find((l) => l.includes("blocker ·"))
if (!blockerLine) fail("blocker not rendered", lines)

// 3. Chip survives handoff.continue: manifest.active_goal unchanged across a new
//    head_thread_id, so the rendered objective line is identical.
const afterContinue = {
  active_goal: boundManifest.active_goal,
} as unknown as StackdMetaThreadManifest
const linesAfter = metaThreadGoalStripLines(afterContinue, columns)
if (linesAfter[0] !== lines[0]) {
  fail("goal chip header changed across continue", { before: lines[0], after: linesAfter[0] })
}

// 4. Truncation respects columns.
const tooWide = lines.find((l) => l.length > Math.max(24, columns - 2))
if (tooWide) fail("line exceeds column width", tooWide)

// 5. Unbound session: no meta strip, and Codex goal context falls back unchanged.
if (metaThreadGoalStripLines(undefined, columns).length !== 0) {
  fail("unbound session should render no meta goal strip")
}
const codexGoal = mergeGoalContext(emptyGoalContext(), {
  objective: "unbound codex objective",
  status: "active",
  source: "context",
})
const fallback = mergeMetaThreadGoalContext(codexGoal, undefined)
if (fallback.objective !== "unbound codex objective") {
  fail("unbound fallback should preserve Codex goal", fallback)
}

const summary = {
  ok: true,
  objective_line: lines[0],
  checklist_count: checklistLines.length,
  overflow: Boolean(overflow),
  blocker_rendered: Boolean(blockerLine),
  survives_continue: linesAfter[0] === lines[0],
  unbound_fallback_objective: fallback.objective,
}
console.log("stack_ui_meta_thread_goal_ok")
console.log(JSON.stringify(summary, null, 2))
