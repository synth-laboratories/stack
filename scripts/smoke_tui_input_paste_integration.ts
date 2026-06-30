#!/usr/bin/env bun

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "")
const pasteLog = "/tmp/stack-tui-input-paste-integration.log"
const marker = "STACK_TUI_PASTE_INTEGRATION_MARKER"

rmSync(pasteLog, { force: true })

const expectScript = `
set timeout 20
log_user 0
spawn bun run ${join(repoRoot, "scripts/probe_stack_renderer_paste.ts")} ${pasteLog}
set sid $spawn_id
after 800
send -i $sid -- "\\x1b\\[200~/goal ${marker} line one\\n/goal criteria add ${marker} line two\\x1b\\[201~"
expect eof
`

const result = spawnSync("expect", ["-c", expectScript], {
  cwd: repoRoot,
  encoding: "utf8",
})

if (result.status !== 0) {
  console.error(result.stderr || result.stdout)
  process.exit(result.status ?? 1)
}

if (!existsSync(pasteLog)) {
  console.error("integration paste log missing")
  process.exit(1)
}

const pasted = readFileSync(pasteLog, "utf8")
if (!pasted.includes(marker)) {
  console.error("integration paste log missing marker:", pasted)
  process.exit(1)
}

console.log("stack_tui_input_paste_integration_ok")
