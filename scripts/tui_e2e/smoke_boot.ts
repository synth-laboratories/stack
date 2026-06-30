#!/usr/bin/env bun

import { resolveStackTuiE2eBackend, spawnStackTui, waitForStackPrompt } from "./harness.ts"

const backend = resolveStackTuiE2eBackend()
const session = await spawnStackTui({ backend })
const { term, cleanup } = session

try {
  await waitForStackPrompt(term)
  console.log("stack_tui_e2e_boot_ok")
  console.log(JSON.stringify({ backend, rows: term.rows, cols: term.cols }, null, 2))
} finally {
  await cleanup()
}
