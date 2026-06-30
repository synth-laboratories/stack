#!/usr/bin/env bun

import { loadConfig } from "../src/config.ts"
import { CursorAcpSession } from "../src/cursor/acp-session.ts"
import { probeCursorAcpAvailability } from "../src/cursor/acp-client.ts"
import { readCursorAccountSnapshot } from "../src/cursor/account.ts"

const appRoot = process.cwd()
const config = await loadConfig(appRoot)
config.harness = "cursor"
config.cursorModel = "composer-2.5"

const available = await probeCursorAcpAvailability({
  command: config.cursorCommand,
  args: ["agent", "acp"],
  cwd: config.workspaceRoot,
})
if (!available) {
  console.error("cursor acp unavailable")
  process.exit(1)
}

const account = await readCursorAccountSnapshot(config.cursorCommand)
if (!account.authenticated) {
  console.error("cursor not authenticated")
  process.exit(1)
}

let output = ""
const session = new CursorAcpSession({
  config,
  onOutput: (chunk) => {
    output += chunk
  },
})

const turn = await session.runTurn({
  config,
  userPrompt: "Reply with exactly: pong",
  selectedFiles: [],
  priorTurns: [],
})

await session.close()

if (turn.exitCode !== 0) {
  console.error(`cursor turn failed: ${turn.stderr || turn.stdout}`)
  process.exit(1)
}

if (!output.includes("pong") && !turn.stdout.includes("pong")) {
  console.error(`cursor turn missing pong: ${output.slice(-500)}`)
  process.exit(1)
}

console.log("stack_cursor_acp_smoke_ok")
console.log(`account=${account.email ?? "unknown"} model=${config.cursorModel}`)
