#!/usr/bin/env bun

import { hydrateCodexPricing, harnessSessionCommand, loadConfig } from "./config.js"
import { ensureStackCodexSkills } from "./codex/install-skills.js"
import { runLocalDemo } from "./demo.js"
import { runDoctor } from "./doctor.js"
import { detectWorkspace } from "./local/workspace.js"
import { createSession } from "./session.js"
import { ensureStackDefaults } from "./seed/defaults.js"
import { runStackApp } from "./tui/app.js"
import { resetTerminalAfterTui } from "./tui/terminal-cleanup.js"
import { runUpdate } from "./update.js"
import { runVoiceCheck, voiceStatusLine, writeVoiceStatus, resolveVoiceStatus } from "./voice/status.js"
import { printStackVersion, stackAppRoot, wantsVersionFlag } from "./version.js"

if (wantsVersionFlag(process.argv)) {
  printStackVersion("stack")
  process.exit(0)
}

try {
  const config = await loadConfig(stackAppRoot())
  if (process.argv[2] === "doctor") {
    process.exit(await runDoctor(config, process.argv.slice(3)))
  }
  if (process.argv[2] === "demo") {
    process.exit(await runLocalDemo(config, process.argv.slice(3)))
  }
  if (process.argv[2] === "update") {
    process.exit(await runUpdate(config, process.argv.slice(3)))
  }
  if (process.argv[2] === "voice" && process.argv[3] === "check") {
    const threadArgIndex = process.argv.indexOf("--thread-id")
    const threadId = threadArgIndex >= 0 ? process.argv[threadArgIndex + 1] : undefined
    const status = await runVoiceCheck(config, { threadId })
    console.log(voiceStatusLine(status))
    if (status.lastCheck?.transcript) console.log(`transcript: ${status.lastCheck.transcript}`)
    console.log(`status: ${status.statusPath}`)
    process.exit(status.health === "READY" || status.health === "DEGRADED" ? 0 : 1)
  }
  if (process.argv[2] === "voice" && process.argv[3] === "status") {
    const status = writeVoiceStatus(config, resolveVoiceStatus(config))
    console.log(voiceStatusLine(status))
    console.log(`status: ${status.statusPath}`)
    process.exit(status.health === "OFF" || status.health === "READY" || status.health === "DEGRADED" ? 0 : 1)
  }
  ensureStackDefaults(config.stackDataRoot, config.appRoot)
  ensureStackCodexSkills(config.appRoot)
  await hydrateCodexPricing(config)
  const workspace = await detectWorkspace(config.workingDir)
  const session = createSession(config.workspaceRoot, harnessSessionCommand(config))

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
