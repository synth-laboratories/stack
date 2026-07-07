import { expect, test } from "bun:test"
import { parseCollabSpawnItem } from "./subagents.js"
import { blocksFromTurnStdout } from "./transcript.js"

const START = "2026-07-07T00:00:00.000Z"

test("parseCollabSpawnItem: completed spawn becomes a running subagent keyed on the receiver thread", () => {
  const sub = parseCollabSpawnItem(
    {
      type: "collab_tool_call",
      tool: "spawn_agent",
      status: "completed",
      id: "item_1",
      receiver_thread_ids: ["019f3df8-4b68-7bc3-af47-c868c69fcc4e"],
      prompt: "You are a worker thread for the Stack Banking77 effort.\nSecond line ignored.",
    },
    START,
  )
  expect(sub).toBeDefined()
  expect(sub?.id).toBe("019f3df8-4b68-7bc3-af47-c868c69fcc4e")
  expect(sub?.status).toBe("running")
  expect(sub?.agentType).toBe("collab")
  expect(sub?.name).toBe("019f3df8")
  expect(sub?.message).toBe("You are a worker thread for the Stack Banking77 effort.")
})

test("parseCollabSpawnItem: in-progress spawn with no receiver yet is skipped", () => {
  expect(
    parseCollabSpawnItem(
      { type: "collab_tool_call", tool: "spawn_agent", status: "in_progress", receiver_thread_ids: [] },
      START,
    ),
  ).toBeUndefined()
})

test("parseCollabSpawnItem: failed spawn is errored", () => {
  const sub = parseCollabSpawnItem(
    { type: "collab_tool_call", tool: "spawn_agent", status: "failed", receiver_thread_ids: ["019fabc0-0000"] },
    START,
  )
  expect(sub?.status).toBe("errored")
})

test("parseCollabSpawnItem: non-spawn collab tools (wait/close) produce no subagent", () => {
  for (const tool of ["wait", "close", "send_input", "list_agents"]) {
    expect(
      parseCollabSpawnItem(
        { type: "collab_tool_call", tool, status: "in_progress", receiver_thread_ids: ["019fabc0-0000"] },
        START,
      ),
    ).toBeUndefined()
  }
})

test("blocksFromTurnStdout extracts a collab spawn as a subagent (end-to-end)", () => {
  const stdout = [
    JSON.stringify({ type: "thread.started", thread_id: "019f3df7-d519" }),
    JSON.stringify({ type: "turn.started" }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "I'll spawn a worker." } }),
    JSON.stringify({
      type: "item.completed",
      item: {
        type: "collab_tool_call",
        tool: "spawn_agent",
        status: "completed",
        id: "item_1",
        receiver_thread_ids: ["019f3df8-4b68-7bc3-af47-c868c69fcc4e"],
        prompt: "You are a worker thread for the Stack Banking77 effort.",
      },
    }),
    // A wait item on the same receiver must NOT create a second subagent or a tool block.
    JSON.stringify({
      type: "item.completed",
      item: { type: "collab_tool_call", tool: "wait", status: "in_progress", receiver_thread_ids: ["019f3df8-4b68-7bc3-af47-c868c69fcc4e"] },
    }),
  ].join("\n")
  const rich = blocksFromTurnStdout("", stdout)
  expect(rich.subagents.length).toBe(1)
  expect(rich.subagents[0]?.id).toBe("019f3df8-4b68-7bc3-af47-c868c69fcc4e")
  expect(rich.subagents[0]?.status).toBe("running")
  // The wait control item is dropped, not rendered as an anonymous tool.
  expect(rich.tools.length).toBe(0)
})
