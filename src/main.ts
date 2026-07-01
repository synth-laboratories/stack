#!/usr/bin/env bun

import { hydrateCodexPricing, harnessSessionCommand, loadConfig } from "./config.js"
import { ensureStackCodexSkills } from "./codex/install-skills.js"
import { runLocalDemo } from "./demo.js"
import { runDoctor } from "./doctor.js"
import { runCrashReports } from "./crash-reports.js"
import { detectWorkspace } from "./local/workspace.js"
import { readMetaThreadManifest } from "./meta-thread-goal.js"
import { createSession, type StackLocalSession } from "./session.js"
import {
  readLatestResumeCheckpoint,
  resolveResumeBundle,
  resumeCheckpointFromCheckpoint,
  normalizeCheckpoint,
  type StackResumeCheckpoint,
} from "./resume-checkpoint.js"
import { ensureStackDefaults } from "./seed/defaults.js"
import { emitSessionFunnel } from "./telemetry/funnel.js"
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
  if (process.argv[2] === "crashes") {
    process.exit(await runCrashReports(config, process.argv.slice(3)))
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
  if (process.argv[2] === "resume") {
    const query = process.argv[3]
    const bundle = await resolveResumeBundle(config.stackDataRoot, config.sessionLogDir, query)
    if (!bundle) {
      const latest = await readLatestResumeCheckpoint(config.stackDataRoot)
      console.error(
        query
          ? `no resume checkpoint for ${JSON.stringify(query)}`
          : "no resume checkpoint saved yet",
      )
      if (latest) {
        console.error(`latest: stack resume ${resumeCheckpointFromCheckpoint(latest)} (${latest.sessionId.slice(0, 8)})`)
      } else {
        console.error("hint: work in a goal thread, then /exit — Stack saves a checkpoint automatically")
      }
      process.exit(1)
    }
    ensureStackDefaults(config.stackDataRoot, config.appRoot)
    ensureStackCodexSkills(config.appRoot)
    await hydrateCodexPricing(config)
    const workspace = await detectWorkspace(config.workingDir)
    void emitSessionFunnel()
    let resumeManifest = bundle.manifest
    const metaThreadId = normalizeCheckpoint(bundle.checkpoint as StackResumeCheckpoint).metaThreadId
    if (metaThreadId && !resumeManifest?.active_goal?.objective?.trim()) {
      resumeManifest = (await readMetaThreadManifest(config.stackDataRoot, metaThreadId)) ?? resumeManifest
    }
    await runStackApp({
      config,
      workspace,
      session: bundle.session as StackLocalSession,
      resumeCheckpoint: normalizeCheckpoint(bundle.checkpoint as StackResumeCheckpoint),
      resumeManifest,
    })
    await new Promise<never>(() => {})
  }
  ensureStackDefaults(config.stackDataRoot, config.appRoot)
  ensureStackCodexSkills(config.appRoot)
  await hydrateCodexPricing(config)
  const workspace = await detectWorkspace(config.workingDir)
  const session = createSession(config.workspaceRoot, harnessSessionCommand(config))

  void emitSessionFunnel()
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
