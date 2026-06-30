#!/usr/bin/env bun

import {
  emptyGoalContext,
  goalContextStripLines,
  goalContextVisible,
  mergeGoalContext,
  parseGoalFromCodexJsonLine,
  parseGoalFromSessionJsonl,
} from "../src/codex/goal-context.ts"

const getGoalOutput = JSON.stringify({
  goal: {
    threadId: "019f09bf-5398-74b2-bda1-258c2b57fbde",
    objective: "implement the next round of stack updates and line up stack eval 1",
    status: "active",
    tokensUsed: 147742,
    timeUsedSeconds: 912,
    createdAt: 1782575100,
    updatedAt: 1782575100,
  },
  remainingTokens: null,
  completionBudgetReport: null,
})

const fixture = [
  JSON.stringify({
    type: "response_item",
    payload: {
      type: "function_call",
      name: "get_goal",
      arguments: "{}",
      call_id: "call_test_goal",
    },
  }),
  JSON.stringify({
    type: "response_item",
    payload: {
      type: "function_call_output",
      call_id: "call_test_goal",
      output: getGoalOutput,
    },
  }),
  JSON.stringify({
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text: `<codex_internal_context source="goal">
<objective>
implement the next round of stack updates and line up stack eval 1
</objective>
Budget:
- Tokens used: 147742
- Token budget: none
- Tokens remaining: unbounded
</codex_internal_context>`,
        },
      ],
    },
  }),
].join("\n")

const parsed = parseGoalFromSessionJsonl(fixture)
if (!goalContextVisible(parsed)) {
  console.error("goal context parse failed: not visible", parsed)
  process.exit(1)
}
if (parsed.status !== "active" || parsed.tokensUsed !== 147742) {
  console.error("goal context parse failed: fields", parsed)
  process.exit(1)
}
if (!parsed.objective?.includes("stack eval 1")) {
  console.error("goal context parse failed: objective", parsed.objective)
  process.exit(1)
}

const merged = parseGoalFromSessionJsonl(fixture)
const lines = goalContextStripLines(merged, 72)
if (lines.length < 2 || !lines[0]?.includes("goal active") || !lines[1]?.includes("stack eval 1")) {
  console.error("goal strip render failed", lines)
  process.exit(1)
}

console.log("smoke_goal_context ok")
