const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

console.log(JSON.stringify({ type: "thread.started", thread_id: "stack-subagent-smoke" }))
await sleep(100)
console.log(JSON.stringify({ type: "turn.started" }))
await sleep(100)

console.log(
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
)
await sleep(100)

console.log(
  JSON.stringify({
    type: "item.completed",
    item: {
      type: "function_call_output",
      call_id: "call_spawn_security",
      output: JSON.stringify({
        agent_id: "agent_security_01",
        nickname: "Atlas",
      }),
    },
  }),
)
await sleep(100)

console.log(
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
)
await sleep(100)

console.log(
  JSON.stringify({
    type: "item.completed",
    item: {
      type: "function_call_output",
      call_id: "call_spawn_bugs",
      output: JSON.stringify({
        agent_id: "agent_bugs_02",
        nickname: "Delta",
      }),
    },
  }),
)
await sleep(100)

console.log(
  JSON.stringify({
    type: "item.completed",
    item: {
      id: "fc_wait",
      type: "function_call",
      name: "wait_agent",
      call_id: "call_wait_both",
      arguments: JSON.stringify({
        targets: ["agent_security_01", "agent_bugs_02"],
        timeout_ms: 30000,
      }),
    },
  }),
)
await sleep(100)

console.log(
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
)
await sleep(100)

console.log(
  JSON.stringify({
    type: "item.completed",
    item: {
      id: "item_agent",
      type: "agent_message",
      text: "Both subagents finished. Security looks clean; fix the refund nil-check.",
    },
  }),
)
await sleep(100)

console.log(
  JSON.stringify({
    type: "turn.completed",
    usage: {
      input_tokens: 40,
      cached_input_tokens: 8,
      output_tokens: 24,
      reasoning_output_tokens: 6,
    },
  }),
)
