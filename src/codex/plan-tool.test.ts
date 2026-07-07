import { expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  extractLatestPlanFromRollout,
  formatPlanDots,
  parseUpdatePlanArgs,
  planProgress,
  readLatestAgentPlan,
} from "./plan-tool.js"

const PLAN_JSON = JSON.stringify({
  plan: [
    { step: "Re-check PR evidence", status: "completed" },
    { step: "Merge PR", status: "completed" },
    { step: "Monitor prod deploy", status: "in_progress" },
    { step: "Record handoff", status: "pending" },
  ],
  explanation: "why",
})

test("parseUpdatePlanArgs accepts a JSON string", () => {
  const plan = parseUpdatePlanArgs(PLAN_JSON)
  expect(plan?.steps.length).toBe(4)
  expect(plan?.explanation).toBe("why")
  expect(plan?.steps[2]).toEqual({ step: "Monitor prod deploy", status: "in_progress" })
})

test("parseUpdatePlanArgs accepts an already-parsed object", () => {
  const plan = parseUpdatePlanArgs(JSON.parse(PLAN_JSON))
  expect(plan?.steps.length).toBe(4)
})

test("parseUpdatePlanArgs drops malformed steps and bad statuses", () => {
  const plan = parseUpdatePlanArgs({
    plan: [
      { step: "keep me", status: "pending" },
      { step: "no status" },
      { step: "bad status", status: "doing" },
      { status: "completed" },
      "not an object",
    ],
  })
  expect(plan?.steps).toEqual([{ step: "keep me", status: "pending" }])
})

test("parseUpdatePlanArgs returns undefined for empty/invalid input", () => {
  expect(parseUpdatePlanArgs("{not json")).toBeUndefined()
  expect(parseUpdatePlanArgs({ plan: [] })).toBeUndefined()
  expect(parseUpdatePlanArgs({})).toBeUndefined()
  expect(parseUpdatePlanArgs(null)).toBeUndefined()
})

test("planProgress: current is first in_progress, else first pending", () => {
  const plan = parseUpdatePlanArgs(PLAN_JSON)!
  expect(planProgress(plan)).toEqual({ done: 2, total: 4, currentIndex: 2 })

  const noInProgress = parseUpdatePlanArgs({
    plan: [
      { step: "a", status: "completed" },
      { step: "b", status: "pending" },
    ],
  })!
  expect(planProgress(noInProgress)).toEqual({ done: 1, total: 2, currentIndex: 1 })

  const allDone = parseUpdatePlanArgs({
    plan: [{ step: "a", status: "completed" }],
  })!
  expect(planProgress(allDone)).toEqual({ done: 1, total: 1, currentIndex: -1 })
})

test("formatPlanDots renders dots and caps at 6 with +N overflow", () => {
  const plan = parseUpdatePlanArgs(PLAN_JSON)!
  expect(formatPlanDots(plan)).toBe("●●◐○")

  const eight = parseUpdatePlanArgs({
    plan: Array.from({ length: 8 }, (_, i) => ({
      step: `s${i}`,
      status: i < 6 ? "completed" : "pending",
    })),
  })!
  expect(formatPlanDots(eight)).toBe("●●●●●● +2")
})

test("extractLatestPlanFromRollout takes the newest update_plan (response_item envelope)", () => {
  const earlier = {
    type: "response_item",
    payload: {
      type: "function_call",
      name: "update_plan",
      arguments: JSON.stringify({ plan: [{ step: "old", status: "in_progress" }] }),
    },
  }
  const later = {
    type: "response_item",
    payload: { type: "function_call", name: "update_plan", arguments: PLAN_JSON },
  }
  const text = [JSON.stringify(earlier), JSON.stringify({ type: "response_item", payload: { type: "message" } }), JSON.stringify(later)].join("\n")
  const plan = extractLatestPlanFromRollout(text)
  expect(plan?.steps.length).toBe(4)
})

test("extractLatestPlanFromRollout returns undefined when there is no plan", () => {
  const text = JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant" } })
  expect(extractLatestPlanFromRollout(text)).toBeUndefined()
})

test("readLatestAgentPlan resolves a thread's rollout and returns the last plan", async () => {
  const root = mkdtempSync(join(tmpdir(), "stack-plan-"))
  const dayDir = join(root, "2026", "07", "07")
  mkdirSync(dayDir, { recursive: true })
  const threadId = "thread-abc"
  const rollout = join(dayDir, `rollout-2026-07-07T00-00-00-${threadId}.jsonl`)
  writeFileSync(
    rollout,
    [
      JSON.stringify({ type: "response_item", payload: { type: "function_call", name: "update_plan", arguments: JSON.stringify({ plan: [{ step: "first", status: "completed" }] }) } }),
      JSON.stringify({ type: "response_item", payload: { type: "function_call", name: "update_plan", arguments: PLAN_JSON } }),
    ].join("\n"),
  )
  const plan = await readLatestAgentPlan(threadId, root)
  expect(plan?.steps.length).toBe(4)
  expect(plan?.steps[0]?.step).toBe("Re-check PR evidence")
})
