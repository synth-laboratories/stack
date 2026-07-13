import { expect, test } from "bun:test"
import { formatMonitorEventLine, filterThreadEvents, formatWorkerTraceLines } from "./gardener-visibility.js"
import type { StackThreadMetaEvent } from "./thread-events.js"

test("formatWorkerTraceLines includes recent prompts", () => {
  const lines = formatWorkerTraceLines({
    threadId: "thread_abc123",
    turnCount: 4,
    lastExitCode: 0,
    recentPrompts: ["first prompt", "second prompt"],
  }, "thread_abc123")
  expect(lines[0]?.includes("4 turns")).toBe(true)
  expect(lines.some((line) => line.includes("prompt:"))).toBe(true)
})

test("formatMonitorEventLine renders human goal status", () => {
  const line = formatMonitorEventLine({
    event_id: "e1",
    type: "monitor.goal_status",
    thread_id: "thread_1",
    observed_at: "2026-07-07T12:00:00.000Z",
    payload: {
      status: "advancing",
      headline: "baseline 0.42",
      note: "container smoke passed",
      for_human: true,
    },
  })
  expect(line.includes("advancing")).toBe(true)
  expect(line.includes("baseline 0.42")).toBe(true)
  expect(line.includes("human")).toBe(true)
})

test("filterThreadEvents supports monitor prefix and for_human", () => {
  const events: StackThreadMetaEvent[] = [
    {
      event_id: "e1",
      type: "agent.turn_completed",
      thread_id: "thread_1",
      observed_at: "2026-07-07T12:00:00.000Z",
      payload: {},
    },
    {
      event_id: "e2",
      type: "monitor.goal_status",
      thread_id: "thread_1",
      observed_at: "2026-07-07T12:01:00.000Z",
      payload: { for_human: false, headline: "internal" },
    },
    {
      event_id: "e3",
      type: "monitor.goal_status",
      thread_id: "thread_1",
      observed_at: "2026-07-07T12:02:00.000Z",
      payload: { for_human: true, headline: "operator sees this" },
    },
  ]
  const filtered = filterThreadEvents(events, {
    types: ["monitor.*"],
    forHumanOnly: true,
    limit: 10,
  })
  expect(filtered).toHaveLength(1)
  expect(filtered[0]?.event_id).toBe("e3")
})
