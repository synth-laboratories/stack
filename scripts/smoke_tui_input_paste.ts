#!/usr/bin/env bun

import {
  consumeBracketedPasteSequences,
  feedBracketedPaste,
  isEditableInputChunk,
  normalizePasteText,
  splitSubmitLines,
} from "../src/tui/input-paste.ts"

const failures: string[] = []

function expect(name: string, ok: boolean, detail?: unknown): void {
  if (!ok) failures.push(`${name}${detail === undefined ? "" : `: ${String(detail)}`}`)
}

const bracketed = feedBracketedPaste("", "\x1b[200~/goal Craftax hillclimb\n/goal criteria add baseline\x1b[201~")
expect("bracketed paste extracted", bracketed.paste === "/goal Craftax hillclimb\n/goal criteria add baseline")
expect("bracketed prefix empty", bracketed.prefix === "")

const chunkedStart = feedBracketedPaste("", "\x1b[200~line one\n")
expect("chunked start accumulates", chunkedStart.accumulator === "line one\n" && chunkedStart.paste === null)

const chunkedEnd = feedBracketedPaste(chunkedStart.accumulator, "line two\x1b[201~")
expect("chunked end completes", chunkedEnd.paste === "line one\nline two")

expect("normalize crlf", normalizePasteText("a\r\nb") === "a\nb")
expect("editable multiline chunk", isEditableInputChunk("hello\nworld"))
expect("split submit lines", splitSubmitLines("/goal a\n/goal criteria add x").length === 2)
expect("reject control char", !isEditableInputChunk("hello\x00world"))

let pasted = ""
let chunks: string[] = []
const consumed = consumeBracketedPasteSequences(
  undefined,
  "\x1b[200~paste me\nsecond line\x1b[201~",
  (paste) => {
    pasted = paste
  },
  (chunk) => {
    chunks.push(chunk)
    return true
  },
)
expect("consume bracketed paste", pasted === "paste me\nsecond line")
expect("consume handled", consumed.handled === true)

const inline = consumeBracketedPasteSequences(
  undefined,
  "plain\ninline",
  () => failures.push("inline should not call onPaste"),
  (chunk) => {
    chunks.push(`inline:${chunk}`)
    return true
  },
)
expect("inline chunk forwarded", inline.handled === true)

if (failures.length > 0) {
  console.error(failures.join("\n"))
  process.exit(1)
}

console.log("stack_tui_input_paste_ok")
console.log(JSON.stringify({ pasted, chunks }, null, 2))
