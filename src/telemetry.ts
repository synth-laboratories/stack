// Machine-global product telemetry preference + anonymous install identity.
//
// Telemetry is ON by default and disclosed. It is a per-machine choice (like
// DO_NOT_TRACK), not per-project. Both this TS layer and stackd (Rust) read the
// same precedence so the decision is consistent across the process boundary:
//
//   DO_NOT_TRACK > STACK_TELEMETRY env > ~/.stack/telemetry/preference > default ON
//
// We never send code, prompts, paths, or secrets — only allowlisted scalar
// product events. See docs/TELEMETRY.md and docs/TELEMETRY_EVENTS.json.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { stackdRecordTelemetryEvent } from "./client/stackd.js"

export function telemetryDir(): string {
  return join(homedir(), ".stack", "telemetry")
}

function installIdPath(): string {
  return join(telemetryDir(), "install_id")
}

function preferencePath(): string {
  return join(telemetryDir(), "preference")
}

function disclosureMarkerPath(): string {
  return join(telemetryDir(), "disclosed")
}

function ensureDir(): void {
  mkdirSync(telemetryDir(), { recursive: true })
}

function parseBool(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "on":
    case "yes":
    case "enabled":
      return true
    case "0":
    case "false":
    case "off":
    case "no":
    case "disabled":
      return false
    default:
      return undefined
  }
}

function doNotTrackSet(): boolean {
  const raw = process.env.DO_NOT_TRACK
  if (raw === undefined) return false
  return parseBool(raw) ?? raw.trim().length > 0
}

export function readPreferenceFile(): boolean | undefined {
  try {
    return parseBool(readFileSync(preferencePath(), "utf8"))
  } catch {
    return undefined
  }
}

export function setPreference(enabled: boolean): void {
  ensureDir()
  writeFileSync(preferencePath(), enabled ? "on\n" : "off\n")
}

/** Resolve the effective telemetry decision. `fileDefault` is the shipped
 *  stack.config.json value (default true). Env + preference file override it. */
export function resolveTelemetryEnabled(fileDefault: boolean): boolean {
  if (doNotTrackSet()) return false
  const envPref = parseBool(process.env.STACK_TELEMETRY)
  if (envPref !== undefined) return envPref
  const filePref = readPreferenceFile()
  if (filePref !== undefined) return filePref
  return fileDefault
}

export function telemetryEnabledReason(fileDefault: boolean): string {
  if (doNotTrackSet()) return "disabled by DO_NOT_TRACK"
  const envPref = parseBool(process.env.STACK_TELEMETRY)
  if (envPref !== undefined) {
    return `${envPref ? "enabled" : "disabled"} by STACK_TELEMETRY=${process.env.STACK_TELEMETRY?.trim()}`
  }
  const filePref = readPreferenceFile()
  if (filePref !== undefined) {
    return `${filePref ? "enabled" : "disabled"} by ~/.stack/telemetry/preference`
  }
  return `${fileDefault ? "enabled" : "disabled"} by default (anonymous; toggle with \`stack telemetry on|off\`)`
}

/** Stable, anonymous, resettable install id. Random — contains no PII. */
export function loadInstallId(): string {
  try {
    const existing = readFileSync(installIdPath(), "utf8").trim()
    if (existing) return existing
  } catch {
    // fall through to create
  }
  const next = `inst_${crypto.randomUUID().replace(/-/g, "")}`
  ensureDir()
  writeFileSync(installIdPath(), `${next}\n`)
  return next
}

export function resetInstallId(): string {
  try {
    rmSync(installIdPath(), { force: true })
  } catch {
    // ignore
  }
  return loadInstallId()
}

/** Print the one-time telemetry disclosure. Default-on must never be silent. */
export function maybePrintFirstRunDisclosure(enabled: boolean): void {
  if (existsSync(disclosureMarkerPath())) return
  ensureDir()
  try {
    writeFileSync(disclosureMarkerPath(), `${new Date().toISOString()}\n`)
  } catch {
    return
  }
  const state = enabled ? "on" : "off"
  process.stderr.write(
    [
      "",
      `Stack sends anonymous usage telemetry (currently ${state}) to improve the product.`,
      "It never includes your code, prompts, file paths, commands, or secrets.",
      "Turn it off anytime: `stack telemetry off` (or STACK_TELEMETRY=0 / DO_NOT_TRACK=1).",
      "Details: docs/TELEMETRY.md",
      "",
    ].join("\n") + "\n",
  )
}

/** Best-effort activity signal for DAU. Never blocks or fails startup. */
export async function emitSessionStarted(opts: { enabled: boolean; authState?: string }): Promise<void> {
  if (!opts.enabled) return
  try {
    await stackdRecordTelemetryEvent({
      name: "stack_session_started",
      payload: {
        install_id: loadInstallId(),
        auth_state: opts.authState ?? "anonymous",
      },
    })
  } catch {
    // telemetry must never block or slow startup
  }
}

export async function runTelemetryCommand(args: string[], ctx: { telemetryEnabled: boolean }): Promise<number> {
  const sub = args[0]
  if (sub === "on" || sub === "off") {
    setPreference(sub === "on")
    process.stdout.write(`telemetry ${sub} (preference written to ${preferencePath()})\n`)
    return 0
  }
  if (sub === "reset-id") {
    const id = resetInstallId()
    process.stdout.write(`telemetry install id reset: ${id}\n`)
    return 0
  }
  if (sub === undefined || sub === "status") {
    process.stdout.write(
      [
        `telemetry: ${ctx.telemetryEnabled ? "enabled" : "disabled"}`,
        `reason: ${telemetryEnabledReason(true)}`,
        `install_id: ${loadInstallId()}`,
        `preference file: ${preferencePath()}`,
        `outbox: ~/.stack/telemetry/events.jsonl (local; upload pipeline is P1)`,
        "toggle: stack telemetry on | stack telemetry off | stack telemetry reset-id",
      ].join("\n") + "\n",
    )
    return 0
  }
  process.stderr.write("usage: stack telemetry [status|on|off|reset-id]\n")
  return 1
}
