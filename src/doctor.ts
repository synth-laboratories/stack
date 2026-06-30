import { existsSync } from "node:fs"
import { join } from "node:path"
import { environmentAuthStatus, type StackConfig } from "./config.js"
import { ensureStackDefaults } from "./seed/defaults.js"
import { stackChannel, stackReleaseVersion, stackVersion } from "./version.js"

type DoctorLevel = "pass" | "warn" | "fail"

type DoctorCheck = {
  id: string
  level: DoctorLevel
  summary: string
  detail?: string
}

type DoctorReport = {
  generated_at: string
  stack_version: string
  channel: string
  stable_release: string
  local_ready: boolean
  synth_sign_in_optional: boolean
  checks: DoctorCheck[]
}

export async function runDoctor(config: StackConfig, argv: string[]): Promise<number> {
  ensureStackDefaults(config.stackDataRoot, config.appRoot)
  const json = argv.includes("--json")
  const auth = environmentAuthStatus(config.environment)
  const checks: DoctorCheck[] = [
    check("version", "pass", `Stack ${stackVersion(config.appRoot)} (${stackChannel(config.appRoot)})`),
    check("local-mode", "pass", "Local ready; Synth sign-in optional"),
    check("telemetry", "pass", "Local product telemetry is treated as off unless explicitly configured"),
    check("auth", auth.hasAuth ? "pass" : "warn", auth.hasAuth ? `${auth.authEnv} is present` : `${auth.authEnv} is not set; hosted features will ask for sign-in`),
    await stackdCheck(),
    await commandCheck("git", ["git", "--version"], "git"),
    fileCheck("telemetry-doc", join(config.appRoot, "docs", "TELEMETRY.md"), "telemetry/privacy doc exists"),
    fileCheck("distribution-doc", join(config.appRoot, "docs", "DISTRIBUTION.md"), "distribution/download doc exists"),
  ]

  const report: DoctorReport = {
    generated_at: new Date().toISOString(),
    stack_version: stackVersion(config.appRoot),
    channel: stackChannel(config.appRoot),
    stable_release: stackReleaseVersion(config.appRoot),
    local_ready: !checks.some((item) => item.level === "fail"),
    synth_sign_in_optional: true,
    checks,
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    printDoctor(report)
  }

  return report.local_ready ? 0 : 1
}

function check(id: string, level: DoctorLevel, summary: string, detail?: string): DoctorCheck {
  return { id, level, summary, detail }
}

function fileCheck(id: string, path: string, summary: string): DoctorCheck {
  return existsSync(path) ? check(id, "pass", summary) : check(id, "warn", `${summary} missing`)
}

async function stackdCheck(): Promise<DoctorCheck> {
  const url = process.env.STACK_API_URL?.trim() || "http://127.0.0.1:8792"
  try {
    const response = await fetchWithTimeout(`${url}/health`, 1000)
    if (response.ok) return check("stackd", "pass", "stackd health endpoint is reachable")
    return check("stackd", "warn", `stackd health returned ${response.status}`)
  } catch {
    return check("stackd", "warn", "stackd health endpoint is not reachable", "The TUI wrapper normally autostarts stackd.")
  }
}

async function commandCheck(id: string, command: string[], label: string): Promise<DoctorCheck> {
  try {
    const proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" })
    const exitCode = await proc.exited
    return exitCode === 0 ? check(id, "pass", `${label} is available`) : check(id, "warn", `${label} command returned ${exitCode}`)
  } catch {
    return check(id, "warn", `${label} is not available`)
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

function printDoctor(report: DoctorReport): void {
  console.log(`Stack doctor · ${report.stack_version} · ${report.channel}`)
  console.log("Local ready · Synth sign-in optional")
  for (const item of report.checks) {
    const label = item.level.toUpperCase().padEnd(4)
    console.log(`${label} ${item.id}: ${item.summary}`)
    if (item.detail) console.log(`     ${item.detail}`)
  }
}
