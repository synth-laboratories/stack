import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { parseRolloutTranscript } from "../src/tui/rollout-transcript.js"

const here = dirname(fileURLToPath(import.meta.url))
const fixture = join(here, "..", "fixtures", "codex", "rollout-sample.jsonl")

function assert(cond: boolean, message: string): void {
  if (!cond) {
    console.error(`FAIL: ${message}`)
    process.exit(1)
  }
}

const text = await readFile(fixture, "utf8")
const { blocks, tools } = parseRolloutTranscript(text)

const userBlocks = blocks.filter((b) => b.kind === "user")
const agentBlocks = blocks.filter((b) => b.kind === "agent")
const userText = userBlocks.map((b) => ("text" in b ? b.text : "")).join("\n")
const agentText = agentBlocks.map((b) => ("text" in b ? b.text : "")).join("\n")

// Injected context (developer permissions + AGENTS.md user message) must not appear.
assert(!userText.includes("AGENTS.md"), "AGENTS.md injected user message leaked into transcript")
assert(!agentText.includes("permissions instructions"), "developer permissions message leaked as agent text")

// The real operator prompt is shown as a user block.
assert(userBlocks.length === 1, `expected exactly 1 real user block, got ${userBlocks.length}`)
assert(userText.includes("find the gamebench craftax"), "real user prompt missing from transcript")

// Assistant messages render as agent blocks (and are not double-counted from event_msg duplicates).
assert(agentBlocks.length === 2, `expected 2 agent blocks, got ${agentBlocks.length}`)
assert(agentText.includes("locate the baseline policy"), "first assistant message missing")
assert(agentText.includes("100-seed sweep"), "second assistant message missing")

// Tool call + output were reconstructed.
assert(tools.length >= 1, "expected at least one reconstructed tool call")
const exec = tools.find((t) => (t.command ?? "").includes("ls baselines/"))
assert(Boolean(exec), "exec_command tool call not reconstructed")
assert((exec?.output ?? exec?.stdout ?? "").includes("visible_ladder_v1.py"), "tool output not attached")

console.log("stack_rollout_transcript_smoke_ok")
