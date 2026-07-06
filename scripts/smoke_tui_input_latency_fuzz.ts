#!/usr/bin/env bun

import {
  agentPromptOwnsEditableInput,
  isEditableInputChunk,
  isRawEnterSequence,
  shouldUseNativeAgentInput,
} from "../src/tui/input-paste.ts"
import { slashMenuEditNeedsRemount, slashMenuVisible } from "../src/tui/slash-commands.ts"

const failures: string[] = []

function assert(condition: boolean, message: string): void {
  if (!condition) failures.push(message)
}

let seed = 0x5eed1234
function random(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 0x100000000
}

function randomPrintableString(maxLength: number): string {
  const length = Math.floor(random() * maxLength)
  let value = ""
  for (let i = 0; i < length; i += 1) {
    value += String.fromCharCode(32 + Math.floor(random() * 95))
  }
  return value
}

const editableSequences = [
  ...Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index)),
  "hello",
  "bd[]g12",
  "/",
  "/goal",
  " ",
]

for (const sequence of editableSequences) {
  assert(isEditableInputChunk(sequence), `expected editable sequence: ${JSON.stringify(sequence)}`)
  assert(
    shouldUseNativeAgentInput(sequence, "agent", "idle"),
    `idle agent input must delegate editable sequence to native Input: ${JSON.stringify(sequence)}`,
  )
  assert(
    !shouldUseNativeAgentInput(sequence, "agent", "running"),
    `running agent input must not delegate editable sequence to idle native Input: ${JSON.stringify(sequence)}`,
  )
  assert(
    !shouldUseNativeAgentInput(sequence, "monitor", "idle"),
    `non-agent input must not delegate editable sequence to worker native Input: ${JSON.stringify(sequence)}`,
  )
}

for (const sequence of ["b", "d", "g", "m", "t", "a", "1", "2", "[", "]"]) {
  assert(
    shouldUseNativeAgentInput(sequence, "agent", "idle"),
    `first keystroke ${JSON.stringify(sequence)} must be treated as text, not a global shortcut`,
  )
}

for (const sequence of ["\x7f", "\b", "\r", "\n", "\r\n", "\x1bOM", "\x1b[13~"]) {
  assert(
    shouldUseNativeAgentInput(sequence, "agent", "idle"),
    `idle agent native Input must own edit/submit sequence: ${JSON.stringify(sequence)}`,
  )
}

for (const sequence of ["\t", "\x1b", "\x01", "\x1b[A", "\x1b[B", "\x1b[3~"]) {
  assert(
    !shouldUseNativeAgentInput(sequence, "agent", "idle"),
    `navigation/control sequence must stay on app raw-input path: ${JSON.stringify(sequence)}`,
  )
}

assert(agentPromptOwnsEditableInput("agent", "idle"), "idle worker prompt must own editable input")
assert(!agentPromptOwnsEditableInput("agent", "running"), "running worker prompt must not own editable input")
assert(!agentPromptOwnsEditableInput("gardener", "idle"), "gardener prompt must not be classified as worker input")

for (let i = 0; i < 5000; i += 1) {
  const sequence =
    random() < 0.85
      ? randomPrintableString(16)
      : ["\x7f", "\b", "\r", "\n", "\t", "\x1b", "\x1b[A", "\x1b[B"][Math.floor(random() * 8)]
  const expected =
    sequence === "\x7f" ||
    sequence === "\b" ||
    isRawEnterSequence(sequence) ||
    (sequence !== "\t" && isEditableInputChunk(sequence))
  assert(
    shouldUseNativeAgentInput(sequence, "agent", "idle") === expected,
    `native route mismatch for ${JSON.stringify(sequence)}`,
  )
  assert(
    !shouldUseNativeAgentInput(sequence, "monitor", "idle"),
    `monitor route leaked to native worker input for ${JSON.stringify(sequence)}`,
  )
}

for (let i = 0; i < 5000; i += 1) {
  const previous = randomPrintableString(24).replace(/^\/+/, "x")
  const next = `${previous}${randomPrintableString(4).replace(/^\/+/, "x")}`
  if (!slashMenuVisible(previous) && !slashMenuVisible(next)) {
    assert(
      !slashMenuEditNeedsRemount(previous, next),
      `plain text edit must not request full remount: ${JSON.stringify(previous)} -> ${JSON.stringify(next)}`,
    )
  }
}

for (const [previous, next] of [
  ["", "/"],
  ["/", "/g"],
  ["/goal", "/goal "],
  ["/monitor", ""],
  ["hello", "/help"],
]) {
  assert(
    slashMenuEditNeedsRemount(previous, next),
    `slash menu transition must request remount: ${JSON.stringify(previous)} -> ${JSON.stringify(next)}`,
  )
}

if (failures.length > 0) {
  console.error(`tui_input_latency_fuzz_failed: ${failures.slice(0, 20).join("; ")}`)
  if (failures.length > 20) console.error(`... ${failures.length - 20} more failure(s)`)
  process.exit(1)
}

console.log("tui_input_latency_fuzz_ok")
