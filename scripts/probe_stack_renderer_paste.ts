#!/usr/bin/env bun

import { createCliRenderer, decodePasteBytes, type PasteEvent } from "@opentui/core"
import { normalizePasteText } from "../src/tui/input-paste.ts"

const pasteLog = process.argv[2] ?? "/tmp/stack-tui-input-paste-integration.log"
await Bun.write(pasteLog, "")

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  useMouse: true,
  useKittyKeyboard: {
    events: true,
    disambiguate: true,
    alternateKeys: true,
  },
})

const onPaste = (event: PasteEvent) => {
  const paste = normalizePasteText(decodePasteBytes(event.bytes))
  if (!paste) return
  void Bun.write(pasteLog, paste).finally(() => {
    renderer.destroy()
    process.exit(0)
  })
  event.preventDefault()
  event.stopPropagation()
}

if (typeof renderer.keyInput.prependListener === "function") {
  renderer.keyInput.prependListener("paste", onPaste)
} else {
  renderer.keyInput.on("paste", onPaste)
}

setTimeout(() => {
  console.error("stack renderer paste probe timed out")
  renderer.destroy()
  process.exit(1)
}, 8000)

process.stdin.resume()
