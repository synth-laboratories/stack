console.log(
  JSON.stringify({
    type: "thread.started",
    thread_id: "stack-smoke-thread",
  }),
)
console.log(JSON.stringify({ type: "turn.started" }))
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
