import { blocksFromTurnStdout, renderBlocksToText } from "../src/tui/transcript.ts"
import { harnessSpeakerLabel } from "../src/harness.ts"

const stdout = [
  JSON.stringify({ type: "thread.started", thread_id: "stack-smoke-thread" }),
  JSON.stringify({ type: "turn.started" }),
  JSON.stringify({
    type: "item.completed",
    item: {
      id: "item_tool",
      type: "command_execution",
      command: "/bin/zsh -lc 'printf stack-tool-output'",
      aggregated_output: "",
      exit_code: null,
      status: "in_progress",
    },
  }),
  JSON.stringify({
    type: "item.completed",
    item: {
      id: "item_tool",
      type: "command_execution",
      command: "/bin/zsh -lc 'printf stack-tool-output'",
      aggregated_output: "stack-tool-output",
      exit_code: 0,
      status: "completed",
    },
  }),
  JSON.stringify({
    type: "item.completed",
    item: {
      id: "item_0",
      type: "agent_message",
      text: "Not much. I'm here and ready to help with the local workspace.",
    },
  }),
  JSON.stringify({
    type: "turn.completed",
    usage: {
      input_tokens: 12,
      cached_input_tokens: 3,
      output_tokens: 9,
      reasoning_output_tokens: 2,
    },
  }),
].join("\n")

const collapsed = blocksFromTurnStdout("hello from smoke", stdout)
const collapsedText = renderBlocksToText(collapsed.blocks, collapsed.tools, collapsed.subagents, viewport(), renderOptions(false))
const expandedText = renderBlocksToText(collapsed.blocks, collapsed.tools, collapsed.subagents, viewport(), renderOptions(true))

for (const required of ["you", "hello from smoke", "tools ▸", "shell", harnessSpeakerLabel(), "Not much"]) {
  if (!collapsedText.includes(required)) {
    console.error(`collapsed transcript missing: ${required}`)
    process.exit(1)
  }
}

if (collapsedText.includes("stack-tool-output")) {
  console.error("collapsed transcript should hide tool output until details are enabled")
  process.exit(1)
}

if (!expandedText.includes("stack-tool-output")) {
  console.error("expanded transcript should show tool output")
  process.exit(1)
}

const subagentStdout = [
  JSON.stringify({ type: "thread.started", thread_id: "stack-subagent-smoke" }),
  JSON.stringify({ type: "turn.started" }),
  JSON.stringify({
    type: "item.completed",
    item: {
      id: "fc_spawn",
      type: "function_call",
      name: "spawn_agent",
      call_id: "call_spawn_security",
      arguments: JSON.stringify({
        agent_type: "explorer",
        message: "Review auth middleware for security risks.",
      }),
    },
  }),
  JSON.stringify({
    type: "item.completed",
    item: {
      type: "function_call_output",
      call_id: "call_spawn_security",
      output: JSON.stringify({ agent_id: "agent_security_01", nickname: "Atlas" }),
    },
  }),
  JSON.stringify({
    type: "item.completed",
    item: {
      id: "fc_spawn_2",
      type: "function_call",
      name: "spawn_agent",
      call_id: "call_spawn_bugs",
      arguments: JSON.stringify({
        agent_type: "reviewer",
        message: "Look for logic bugs in the payment flow.",
      }),
    },
  }),
  JSON.stringify({
    type: "item.completed",
    item: {
      type: "function_call_output",
      call_id: "call_spawn_bugs",
      output: JSON.stringify({ agent_id: "agent_bugs_02", nickname: "Delta" }),
    },
  }),
  JSON.stringify({
    type: "item.completed",
    item: {
      id: "fc_wait",
      type: "function_call",
      name: "wait_agent",
      call_id: "call_wait_both",
      arguments: JSON.stringify({ targets: ["agent_security_01", "agent_bugs_02"], timeout_ms: 30000 }),
    },
  }),
  JSON.stringify({
    type: "item.completed",
    item: {
      type: "function_call_output",
      call_id: "call_wait_both",
      output: JSON.stringify({
        status: {
          agent_security_01: { completed: "No critical auth issues found." },
          agent_bugs_02: { completed: "One nil-check missing in refund path." },
        },
        timed_out: false,
      }),
    },
  }),
  JSON.stringify({
    type: "item.completed",
    item: {
      id: "item_agent",
      type: "agent_message",
      text: "Both subagents finished. Security looks clean; fix the refund nil-check.",
    },
  }),
  JSON.stringify({
    type: "turn.completed",
    usage: {
      input_tokens: 40,
      cached_input_tokens: 8,
      output_tokens: 24,
      reasoning_output_tokens: 6,
    },
  }),
].join("\n")

const subagentTurn = blocksFromTurnStdout("spawn review agents", subagentStdout)
const subagentCollapsed = renderBlocksToText(
  subagentTurn.blocks,
  subagentTurn.tools,
  subagentTurn.subagents,
  viewport(),
  renderOptions(false),
)
const subagentExpanded = renderBlocksToText(
  subagentTurn.blocks,
  subagentTurn.tools,
  subagentTurn.subagents,
  viewport(),
  renderOptions(true),
)

for (const required of ["↳ agents ▸", "Atlas", "Delta", "2 agents", "Both subagents finished"]) {
  if (!subagentCollapsed.includes(required)) {
    console.error(`subagent collapsed transcript missing: ${required}`)
    console.error(subagentCollapsed)
    process.exit(1)
  }
}

if (subagentTurn.subagents.length !== 2) {
  console.error(`expected 2 subagents, got ${subagentTurn.subagents.length}`)
  process.exit(1)
}

if (!subagentExpanded.includes("No critical auth issues found")) {
  console.error("expanded subagent transcript should show wait_agent results")
  console.error(subagentExpanded)
  process.exit(1)
}

if (subagentCollapsed.includes("spawn_agent")) {
  console.error("subagent tools should not appear as generic tool rows")
  process.exit(1)
}

const liveBlocks: typeof collapsed.blocks = []
const liveSubagents: typeof collapsed.subagents = []
const liveThinkingId: { current?: string } = {}
const liveToolGroupId: { current?: string } = {}
const liveSubagentGroupId: { current?: string } = {}
const multiAgentCalls = new Map()
const turnStartedAt: { current?: string } = {}
const { applyCodexLine } = await import("../src/tui/transcript.ts")
applyCodexLine(
  liveBlocks,
  [],
  liveSubagents,
  liveThinkingId,
  liveToolGroupId,
  liveSubagentGroupId,
  multiAgentCalls,
  turnStartedAt,
  JSON.stringify({ type: "turn.started" }),
)
const liveRunningText = renderBlocksToText(liveBlocks, [], liveSubagents, viewport(), {
  expandedBlockIds: new Set<string>(),
  showDetails: true,
  running: true,
  liveThinkingText: "…",
  spinnerFrame: 0,
})
const liveThinkingLines = liveRunningText.split("\n").filter((line) => line.includes("thinking ▸"))
if (liveThinkingLines.length !== 1) {
  console.error(`expected one live thinking line, got ${liveThinkingLines.length}`)
  console.error(liveRunningText)
  process.exit(1)
}

console.log("stack_transcript_smoke_ok")

function viewport() {
  return { lines: 40, columns: 100, pageLines: 30 }
}

function renderOptions(showDetails: boolean) {
  return {
    expandedBlockIds: new Set<string>(),
    showDetails,
    running: false,
    spinnerFrame: 0,
  }
}
