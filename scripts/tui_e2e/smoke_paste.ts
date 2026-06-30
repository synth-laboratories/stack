#!/usr/bin/env bun

import {
  bracketedPaste,
  focusStackAgentInput,
  resolveStackTuiE2eBackend,
  screenContains,
  spawnStackTui,
  terminalText,
  waitForScreenText,
  waitForStackPrompt,
} from "./harness.ts"

const marker = "STACK_TUI_E2E_PASTE_MARKER"
const backend = resolveStackTuiE2eBackend()

const session = await spawnStackTui({ backend })
const { term, cleanup } = session

try {
  await waitForStackPrompt(term)
  await focusStackAgentInput(term)
  await Bun.sleep(250)

  const pasteBody = `/goal ${marker} line one\n/goal criteria add ${marker} line two`
  term.type(bracketedPaste(pasteBody))
  await waitForScreenText(term, marker, 8_000)

  term.press("Enter")
  await waitForScreenText(term, "goal set", 10_000).catch(async () => {
    if (!screenContains(term, "goal failed")) {
      throw new Error("expected goal set or goal failed feedback after pasted /goal submit")
    }
  })

  console.log("stack_tui_e2e_paste_ok")
  console.log(
    JSON.stringify(
      {
        backend,
        marker,
        bracketedPaste: true,
        screenTail: terminalText(term).slice(-500),
      },
      null,
      2,
    ),
  )
} finally {
  await cleanup()
}
