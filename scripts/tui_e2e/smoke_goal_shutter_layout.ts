#!/usr/bin/env bun

import { assertGoalShutterLayout } from "./layout-assert.ts"
import {
  focusStackAgentInput,
  resolveStackTuiE2eBackend,
  spawnStackTui,
  terminalText,
  waitForGoalShutterLayout,
  waitForScreenText,
  waitForStackPrompt,
} from "./harness.ts"

const marker = "STACK_TUI_E2E_LAYOUT_MARKER"
const backend = resolveStackTuiE2eBackend()

const session = await spawnStackTui({
  backend,
  monitorEnabled: true,
  withStackd: true,
  cols: 160,
  rows: 45,
})
const { term, cleanup } = session

try {
  await waitForStackPrompt(term)
  await focusStackAgentInput(term)
  await Bun.sleep(250)

  term.type(`/goal ${marker} layout smoke objective`)
  await waitForScreenText(term, marker, 8_000)
  term.press("Enter")

  await waitForScreenText(term, "Goal ·", 15_000)
  await waitForScreenText(term, "events", 15_000)

  // Wait for monitor activity when sidecar is enabled.
  await waitForScreenText(term, "monitor", 30_000).catch(() => undefined)
  const feedText = terminalText(term)
  const normalizedFeedText = feedText.replace(/[│└┘┌┐─]+/g, " ")
  if (!/t\s+thread[\s\S]*e\s+events/.test(normalizedFeedText)) {
    throw new Error(`goal shutter sidecar controls missing thread/events toggle:\n${feedText.slice(-1600)}`)
  }
  for (const forbidden of ["NO_USER_UPDATE", "checkpoint advanced", "pause_for_restart"]) {
    if (feedText.includes(forbidden)) throw new Error(`sidecar events feed leaked runtime/quiet text: ${forbidden}`)
  }

  term.press("t")
  await waitForScreenText(term, "Sidecar thread", 8_000)
  await waitForScreenText(term, "Message sidecar", 8_000)

  await waitForGoalShutterLayout(term, 10_000)

  const finalText = terminalText(term)
  const check = assertGoalShutterLayout(finalText)
  if (!check.ok) {
    throw new Error(`final layout check failed:\n${check.failures.join("\n")}`)
  }

  term.press("1")
  await Bun.sleep(400)
  await waitForScreenText(term, marker, 8_000)
  const chatText = terminalText(term)
  for (const pattern of [/^G[oO]event/i, /Goal\s*[·.].*(?:monitor\s+low|event\s+delta)/i]) {
    for (const line of chatText.split("\n")) {
      if (pattern.test(line.trim())) {
        throw new Error(`worker peek chat overlap: ${JSON.stringify(line.trim().slice(0, 120))}`)
      }
    }
  }

  console.log("stack_tui_e2e_goal_shutter_layout_ok")
  console.log(
    JSON.stringify(
      {
        backend,
        marker,
        anchors: check.anchors,
        screenTail: finalText.slice(-800),
      },
      null,
      2,
    ),
  )
} finally {
  await cleanup()
}
