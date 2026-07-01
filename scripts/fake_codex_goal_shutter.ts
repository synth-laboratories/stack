const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

function emit(value: unknown): void {
  console.log(JSON.stringify(value))
}

emit({ type: "thread.started", thread_id: "stack-goal-shutter-thread" })
await sleep(120)
emit({ type: "turn.started" })

const chunks = [
  "Goal shutter smoke: scanning the Craftax code-policy lane for baseline settings.",
  "Reading gamebench task instructions and staged artifacts for the policy optimization goal.",
  "Simulated worker turn for goal-mode Sidecar events OpenTUI buffer stress.",
]

for (const [index, text] of chunks.entries()) {
  await sleep(220)
  emit({
    type: "item.completed",
    item: {
      id: `item_${index}`,
      type: "agent_message",
      text,
    },
  })
}

await sleep(180)
emit({
  type: "item.completed",
  item: {
    id: "item_tool",
    type: "command_execution",
    command: "/bin/zsh -lc 'printf STACK_GOAL_SHUTTER_WORKER_OK'",
    aggregated_output: "STACK_GOAL_SHUTTER_WORKER_OK",
    exit_code: 0,
    status: "completed",
  },
})

await sleep(160)
emit({
  type: "item.completed",
  item: {
    id: "item_final",
    type: "agent_message",
    text: "STACK_GOAL_SHUTTER_SMOKE_OK — worker turn completed in goal shutter smoke.",
  },
})

emit({
  type: "turn.completed",
  usage: {
    input_tokens: 12_400,
    cached_input_tokens: 4_800,
    output_tokens: 420,
    reasoning_output_tokens: 128,
  },
})
