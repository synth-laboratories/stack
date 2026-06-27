const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

function emit(value: unknown): void {
  console.log(JSON.stringify(value))
}

emit({
  type: "thread.started",
  thread_id: "stack-resilience-thread",
})
await sleep(120)
emit({ type: "turn.started" })

const chunks = [
  "I'm checking whether the Stack live-ops tools are exposed in this session.",
  "I found the session has MCP access, but I still need the specific Stack bridge tools before I can touch live ops.",
  "I'm narrowing the search to the Stack status/control surface now.",
  "Simulated long agent turn for OpenTUI remount/spinner stress at narrow terminal widths.",
]

for (const [index, text] of chunks.entries()) {
  await sleep(280)
  emit({
    type: "item.completed",
    item: {
      id: `item_${index}`,
      type: "agent_message",
      text,
    },
  })
}

await sleep(320)
emit({
  type: "item.completed",
  item: {
    id: "item_tool",
    type: "command_execution",
    command: "/bin/zsh -lc 'printf STACK_RESILIENCE_TOOL_OK'",
    aggregated_output: "",
    exit_code: null,
    status: "in_progress",
  },
})
await sleep(180)
emit({
  type: "item.completed",
  item: {
    id: "item_tool",
    type: "command_execution",
    command: "/bin/zsh -lc 'printf STACK_RESILIENCE_TOOL_OK'",
    aggregated_output: "STACK_RESILIENCE_TOOL_OK",
    exit_code: 0,
    status: "completed",
  },
})

await sleep(200)
emit({
  type: "item.completed",
  item: {
    id: "item_final",
    type: "agent_message",
    text: "STACK_RESILIENCE_SMOKE_OK — live turn completed without TUI crash.",
  },
})

emit({
  type: "turn.completed",
  usage: {
    input_tokens: 70_840,
    cached_input_tokens: 33_408,
    output_tokens: 806,
    reasoning_output_tokens: 512,
  },
})
