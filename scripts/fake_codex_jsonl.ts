#!/usr/bin/env bun

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

if (process.argv.includes("app-server")) {
  const decoder = new TextDecoder()
  let buffer = ""
  let turnCounter = 0

  function send(message: Record<string, unknown>): void {
    process.stdout.write(`${JSON.stringify(message)}\n`)
  }

  function handle(message: Record<string, unknown>): void {
    const method = typeof message.method === "string" ? message.method : ""
    const id = message.id
    const params = typeof message.params === "object" && message.params ? message.params as Record<string, unknown> : {}
    if (method === "initialize") {
      send({ jsonrpc: "2.0", id, result: { serverInfo: { name: "fake-codex" } } })
      return
    }
    if (method === "initialized") return
    if (method === "thread/start") {
      send({ jsonrpc: "2.0", id, result: { thread: { id: "stack-smoke-sidecar-thread" } } })
      return
    }
    if (method === "thread/resume") {
      send({ jsonrpc: "2.0", id, result: { thread: { id: params.threadId ?? "stack-smoke-sidecar-thread" } } })
      return
    }
    if (method === "turn/start") {
      turnCounter += 1
      const turnId = `stack-smoke-sidecar-turn-${turnCounter}`
      send({ jsonrpc: "2.0", id, result: { turn: { id: turnId } } })
      send({ jsonrpc: "2.0", method: "turn/started", params: { turn: { id: turnId } } })
      send({
        jsonrpc: "2.0",
        method: "agent/messageDelta",
        params: { delta: "Codex sidecar reviewed the Harbor criterion events and is waiting for the next wake." },
      })
      send({
        jsonrpc: "2.0",
        method: "item/completed",
        params: { item: { id: "pause-tool", type: "mcpToolCall", tool: "stack_sidecar_pause_for_restart" } },
      })
      send({
        jsonrpc: "2.0",
        method: "turn/completed",
        params: {
          turn: {
            id: turnId,
            usage: {
              inputTokens: 12,
              cachedInputTokens: 3,
              outputTokens: 9,
              reasoningOutputTokens: 2,
            },
          },
        },
      })
    }
  }

  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk)
    while (buffer.includes("\n")) {
      const index = buffer.indexOf("\n")
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (!line) continue
      handle(JSON.parse(line) as Record<string, unknown>)
    }
  }
  process.exit(0)
}

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
