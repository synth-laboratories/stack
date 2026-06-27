#!/usr/bin/env bun

import { hydrateCodexPricing, loadConfig } from "./config.js"
import { ensureStackCodexSkills } from "./codex/install-skills.js"
import { detectWorkspace } from "./local/workspace.js"
import { createSession } from "./session.js"
import { runStackApp } from "./tui/app.js"
import { printStackVersion, wantsVersionFlag } from "./version.js"

if (wantsVersionFlag(process.argv)) {
  printStackVersion("stack")
  process.exit(0)
}

const appWorkspace = await detectWorkspace()
const config = await loadConfig(appWorkspace.root)
ensureStackCodexSkills(config.appRoot)
await hydrateCodexPricing(config)
const workspace = await detectWorkspace(config.workingDir)
const session = createSession(config.workspaceRoot, `${config.codexCommand} ${config.codexArgs.join(" ")}`)

await runStackApp({ config, workspace, session })
