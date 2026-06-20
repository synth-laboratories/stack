#!/usr/bin/env bun

import { loadConfig } from "./config.js"
import { detectWorkspace } from "./local/workspace.js"
import { createSession } from "./session.js"
import { runStackApp } from "./tui/app.js"

const workspace = await detectWorkspace()
const config = await loadConfig(workspace.root)
const session = createSession(workspace.root, `${config.codexCommand} ${config.codexArgs.join(" ")}`)

await runStackApp({ config, workspace, session })
