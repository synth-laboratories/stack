const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

console.log(
  JSON.stringify({
    type: "thread.started",
    thread_id: "stack-smoke-thread",
  }),
)
await sleep(200)
console.log(JSON.stringify({ type: "turn.started" }))
await sleep(200)
console.log(
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
)
await sleep(200)
console.log(
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
)
await sleep(200)
console.log(
  JSON.stringify({
    type: "item.completed",
    item: {
      id: "item_0",
      type: "agent_message",
      text: "Not much. I'm here and ready to help with the local workspace.",
    },
  }),
)
await sleep(200)
console.log(
  JSON.stringify({
    type: "turn.completed",
    usage: {
      input_tokens: 12,
      cached_input_tokens: 3,
      output_tokens: 9,
      reasoning_output_tokens: 2,
    },
  }),
)
