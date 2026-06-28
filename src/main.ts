#!/usr/bin/env bun

import { hydrateCodexPricing, loadConfig } from "./config.js"
import { ensureStackCodexSkills } from "./codex/install-skills.js"
import { detectWorkspace } from "./local/workspace.js"
import { createSession } from "./session.js"
import { runStackApp } from "./tui/app.js"
import { resetTerminalAfterTui } from "./tui/terminal-cleanup.js"
import { printStackVersion, stackAppRoot, wantsVersionFlag } from "./version.js"

if (wantsVersionFlag(process.argv)) {
  printStackVersion("stack")
  process.exit(0)
}

try {
  const config = await loadConfig(stackAppRoot())
  ensureStackCodexSkills(config.appRoot)
  await hydrateCodexPricing(config)
  const workspace = await detectWorkspace(config.workingDir)
  const session = createSession(config.workspaceRoot, `${config.codexCommand} ${config.codexArgs.join(" ")}`)

  await runStackApp({ config, workspace, session })
} catch (error) {
  resetTerminalAfterTui()
  if (error instanceof Error) {
    console.error(`stack startup failed: ${error.stack ?? error.message}`)
  } else {
    console.error(`stack startup failed: ${String(error)}`)
  }
  process.exit(1)
}
