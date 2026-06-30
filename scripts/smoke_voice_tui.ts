#!/usr/bin/env bun

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { loadConfig } from "../src/config.js"
import { resolveVoiceStatus, voiceStatusLine, writeVoiceStatus } from "../src/voice/status.js"

const appRoot = resolve(import.meta.dir, "..")
const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z"
const proofDir = join(appRoot, ".stack", "evidence", "voice-tui", stamp)
const failures: string[] = []

mkdirSync(proofDir, { recursive: true })

process.env.STACK_VOICE_ENABLED = "0"
const disabledConfig = await loadConfig(appRoot)
const disabled = writeVoiceStatus(disabledConfig, resolveVoiceStatus(disabledConfig))
if (disabled.health !== "OFF") failures.push(`disabled status is ${disabled.health}, expected OFF`)
if (!voiceStatusLine(disabled).includes("Voice OFF")) failures.push("disabled status line missing Voice OFF")

process.env.STACK_VOICE_ENABLED = "1"
const enabledConfig = await loadConfig(appRoot)
const enabled = writeVoiceStatus(enabledConfig, resolveVoiceStatus(enabledConfig))
if (enabled.health === "OFF") failures.push("enabled voice resolved to OFF")
if (!["READY", "BLOCKED", "DEGRADED"].includes(enabled.health)) {
  failures.push(`enabled status has unknown health ${enabled.health}`)
}
if (!voiceStatusLine(enabled).startsWith(`Voice ${enabled.health}`)) {
  failures.push("enabled status line does not match health")
}

const appSource = readFileSync(join(appRoot, "src", "tui", "app.ts"), "utf8")
for (const needle of [
  'keyInput.on("keyrelease"',
  "handleVoiceKey",
  "isVoiceKeyCandidate",
  "isGardenerSession",
  "startVoiceHoldToGardener",
  "finishVoiceHoldToGardener",
]) {
  if (!appSource.includes(needle)) failures.push(`TUI source missing ${needle}`)
}
if (appSource.includes("voice directly to worker")) {
  failures.push("TUI source appears to support direct voice-to-worker routing")
}

const summary = {
  ok: failures.length === 0,
  stamp,
  disabled,
  enabled,
  status_path: enabled.statusPath,
  failures,
}
writeFileSync(join(proofDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`)

if (failures.length > 0) {
  console.error(`stack_voice_tui_failed: ${failures.join("; ")}`)
  process.exit(1)
}

console.log("stack_voice_tui_ok")
console.log(`disabled=${disabled.health}`)
console.log(`enabled=${enabled.health}`)
console.log(`proof_dir=${proofDir}`)
