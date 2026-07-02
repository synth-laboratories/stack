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
import { emitSessionEnded, emitSessionFunnel } from "./telemetry/funnel.js"
import { resolveEnvironmentFromArgv, runTelemetryDigest } from "./telemetry-digest.js"
import { runStackApp } from "./tui/app.js"
import { resetTerminalAfterTui } from "./tui/terminal-cleanup.js"
import { runUpdate } from "./update.js"
import { runVoiceCheck, voiceStatusLine, writeVoiceStatus, resolveVoiceStatus } from "./voice/status.js"
import { printStackVersion, stackAppRoot, stackVersion, wantsVersionFlag } from "./version.js"

if (wantsHelpFlag(process.argv)) {
  printStackHelp(process.argv)
  process.exit(0)
}

if (wantsVersionFlag(process.argv)) {
  printStackVersion("stack")
  process.exit(0)
}

try {
  if (process.argv[2] === "telemetry" && process.argv[3] === "digest") {
    const env = resolveEnvironmentFromArgv(process.argv.slice(4))
    if (env) process.env.STACK_ENVIRONMENT = env
  }

  const config = await loadConfig(stackAppRoot())
  if (process.argv[2] === "doctor") {
    process.exit(await runDoctor(config, process.argv.slice(3)))
  }
  if (process.argv[2] === "auth") {
    const { runAuthCli } = await import("./auth-cli.js")
    process.exit(await runAuthCli(config, process.argv.slice(2)))
  }
  if (process.argv[2] === "login" || process.argv[2] === "signup") {
    const { runAuthCli } = await import("./auth-cli.js")
    const target = process.argv[2] === "signup" ? "signup" : "signin"
    process.exit(await runAuthCli(config, ["auth", "open", target, ...process.argv.slice(3)]))
  }
  if (process.argv[2] === "whoami") {
    const { runAuthCli } = await import("./auth-cli.js")
    process.exit(await runAuthCli(config, ["auth", "verify", ...process.argv.slice(3)]))
  }
  if (process.argv[2] === "inference") {
    const { runInferenceCli } = await import("./inference-cli.js")
    process.exit(await runInferenceCli(config, process.argv.slice(2)))
  }
  if (process.argv[2] === "crashes") {
    process.exit(await runCrashReports(config, process.argv.slice(3)))
  }
  if (process.argv[2] === "telemetry" && process.argv[3] === "digest") {
    process.exit(await runTelemetryDigest(config, process.argv.slice(4)))
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
  await emitSessionEnded()
} catch (error) {
  resetTerminalAfterTui()
  if (error instanceof Error) {
    console.error(`stack startup failed: ${error.stack ?? error.message}`)
  } else {
    console.error(`stack startup failed: ${String(error)}`)
  }
  process.exit(1)
}

function wantsHelpFlag(argv: string[]): boolean {
  const args = argv.slice(2)
  if (args.length === 0) return false
  if (args[0] === "help" || args[0] === "--help" || args[0] === "-h") return true
  return args[0] === "goal" && (args[1] === "--help" || args[1] === "-h")
}

function printStackHelp(argv: string[]): void {
  const args = argv.slice(2)
  console.log(`stack ${stackVersion(stackAppRoot())}`)
  console.log("")
  if (args[0] === "goal") {
    console.log("Usage:")
    console.log("  stack                         Open the TUI")
    console.log("  /goal <objective>             Start a goal inside the TUI")
    console.log("  /goal clear                   Clear the active in-app goal")
    console.log("")
    console.log("Goal mode is an in-app command, not a standalone CLI subcommand.")
    return
  }
  console.log("Usage:")
  console.log("  stack                         Open the TUI")
  console.log("  stack login [--no-browser]    Open optional Synth sign-in")
  console.log("  stack signup [--no-browser]   Open optional Synth signup")
  console.log("  stack whoami [--json]          Check Synth account status")
  console.log("  stack doctor [--json]          Check local readiness")
  console.log("  stack auth <command>           Manage optional Synth auth")
  console.log("  stack inference <list|usage> [--json]")
  console.log("  stack telemetry digest [--env dev|staging|prod]")
  console.log("  stack crashes <command>")
  console.log("  stack resume [query]")
  console.log("  stack demo <command>")
  console.log("  stack update")
  console.log("  stack --version")
  console.log("")
  console.log("Local worker paths do not require SYNTH_API_KEY; sign-in unlocks hosted/cloud surfaces.")
}
