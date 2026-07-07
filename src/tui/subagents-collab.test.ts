import { expect, test } from "bun:test"
import { applyCollabAgentStates, conciseAgentBrief, parseCollabSpawnItem, type SubagentLog } from "./subagents.js"
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

test("applyCollabAgentStates updates a known subagent's live status and leaves unknowns alone", () => {
  const subs: SubagentLog[] = [{ id: "019f3df8", name: "019f3df8", status: "running", agentType: "collab" }]
  applyCollabAgentStates(
    subs,
    {
      "019f3df8": { status: "completed", message: "done: baseline recorded" },
      "019fZZZZ": { status: "running" },
    },
    "2026-07-07T01:00:00.000Z",
  )
  expect(subs.length).toBe(1)
  expect(subs[0]?.status).toBe("completed")
  expect(subs[0]?.message).toBe("done: baseline recorded")
  expect(subs[0]?.finishedAt).toBe("2026-07-07T01:00:00.000Z")
})

test("agents_states drives status end-to-end: a waited-on spawn reflects pending_init, not running", () => {
  const stdout = [
    JSON.stringify({
      type: "item.completed",
      item: {
        type: "collab_tool_call",
        tool: "spawn_agent",
        status: "completed",
        receiver_thread_ids: ["019f3df8-4b68"],
        prompt: "worker brief",
      },
    }),
    JSON.stringify({
      type: "item.completed",
      item: {
        type: "collab_tool_call",
        tool: "wait",
        status: "in_progress",
        receiver_thread_ids: ["019f3df8-4b68"],
        agents_states: { "019f3df8-4b68": { status: "pending_init", message: null } },
      },
    }),
  ].join("\n")
  const rich = blocksFromTurnStdout("", stdout)
  expect(rich.subagents.length).toBe(1)
  expect(rich.subagents[0]?.status).toBe("pending_init")
})

test("conciseAgentBrief drops role preamble and operator-ask lead-in", () => {
  expect(
    conciseAgentBrief(
      "You are a worker thread for the Stack Banking77 effort. The operator asked to implement the first Banking77 lane: get a container built.",
    ),
  ).toBe("Implement the first Banking77 lane: get a container built.")
  // Pure role sentence: strip "You are a" but keep the description.
  expect(conciseAgentBrief("You are a Stack worker instance running against the Craftax goal.")).toBe(
    "Stack worker instance running against the Craftax goal.",
  )
  // Only the first paragraph is considered (context after a blank line is dropped).
  expect(conciseAgentBrief("Fix the flaky test.\n\nWorkspace root: /tmp")).toBe("Fix the flaky test.")
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
