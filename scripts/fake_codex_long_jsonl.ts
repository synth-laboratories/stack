const lines = Array.from({ length: 80 }, (_, index) => {
  const lineNumber = index + 1
  if (lineNumber === 61) return "PAGEUP_SCROLL_SENTINEL_61"
  if (lineNumber === 79) return "BOTTOM_VISIBLE_SENTINEL_79"
  return `scroll-proof-line-${String(lineNumber).padStart(2, "0")}`
})

console.log(JSON.stringify({ type: "turn.started" }))
console.log(
  JSON.stringify({
    type: "item.completed",
    item: {
      id: "item_long",
      type: "agent_message",
      text: lines.join("\n"),
    },
  }),
)
console.log(
  JSON.stringify({
    type: "turn.completed",
    usage: {
      input_tokens: 5,
      cached_input_tokens: 0,
      output_tokens: 80,
      reasoning_output_tokens: 0,
    },
  }),
)
