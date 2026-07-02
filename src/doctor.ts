import { existsSync } from "node:fs"
import { join } from "node:path"
import { environmentAuthStatus, type StackConfig } from "./config.js"
import { stackdListCrashReports, stackdTelemetryStatus } from "./client/stackd.js"
import { readRemoteInferenceCatalog, type RemoteInferenceCatalogSnapshot } from "./remote/inference.js"
import { ensureStackDefaults } from "./seed/defaults.js"
import { readStackProfile } from "./operator-profile.js"
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
    profileCheck(config),
    await telemetryCheck(),
    check(
      "auth",
      auth.hasAuth ? "pass" : "warn",
      auth.hasAuth ? `${auth.authEnv} is present; cloud features enabled` : "Local ready; sign in for cloud with stack auth open signin",
      auth.message,
    ),
    await inferenceCatalogCheck(config),
    await stackdCheck(),
    await crashReportingCheck(config),
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

function profileCheck(config: StackConfig): DoctorCheck {
  try {
    const profile = readStackProfile(config.stackDataRoot)
    return check(
      "profile",
      "pass",
      `Stack profile ${profile.active}`,
      profile.explicit ? profile.path : `default ${profile.active}; ${profile.path} not written yet`,
    )
  } catch (error) {
    return check(
      "profile",
      "fail",
      "Stack profile config is invalid",
      error instanceof Error ? error.message : String(error),
    )
  }
}

function check(id: string, level: DoctorLevel, summary: string, detail?: string): DoctorCheck {
  return { id, level, summary, detail }
}

function fileCheck(id: string, path: string, summary: string): DoctorCheck {
  return existsSync(path) ? check(id, "pass", summary) : check(id, "warn", `${summary} missing`)
}

async function telemetryCheck(): Promise<DoctorCheck> {
  const url = process.env.STACK_API_URL?.trim() || "http://127.0.0.1:8792"
  try {
    const status = await stackdTelemetryStatus(url)
    const basic = status.tiers.basic_dau === "on" ? "on" : "off"
    const advanced = advancedTelemetryLabel(status.tiers.advanced_product)
    const detail = [
      `default=${status.local_product_telemetry.default}`,
      `install_id=${status.tiers.install_id_present ? "present" : "missing"}`,
      status.local_product_telemetry.endpoint_configured
        ? "upload endpoint configured"
        : "upload endpoint not configured",
    ].join("; ")
    return check("telemetry", "pass", `Telemetry basic DAU ${basic}; advanced product ${advanced}`, detail)
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : String(failure)
    return check(
      "telemetry",
      "warn",
      "Telemetry posture defaults to basic DAU on; advanced product asks first",
      message,
    )
  }
}

function advancedTelemetryLabel(value: string): string {
  if (value === "accepted") return "accepted"
  if (value === "declined") return "declined"
  return "asks first"
}

async function crashReportingCheck(config: StackConfig): Promise<DoctorCheck> {
  const disabled = ["0", "false", "off", "no"].includes(
    (process.env.STACK_CRASH_REPORT ?? "").trim().toLowerCase(),
  )
  if (disabled) {
    return check(
      "crash-reporting",
      "warn",
      "Client crash reporting disabled by STACK_CRASH_REPORT=0",
    )
  }

  const url = process.env.STACK_API_URL?.trim() || "http://127.0.0.1:8792"
  try {
    const status = await stackdTelemetryStatus(url)
    const crash = status.crash_reporting
    if (!crash.enabled) {
      return check("crash-reporting", "warn", "stackd reports crash reporting disabled")
    }
    const detail = [
      `outbox=${crash.outbox_path}`,
      `records=${crash.local_record_count}`,
      crash.endpoint_configured ? "cloud endpoint configured" : "cloud endpoint not configured",
      status.local_product_telemetry.reason.includes("unavailable")
        ? "product telemetry contract unavailable on stackd app_root"
        : undefined,
    ]
      .filter(Boolean)
      .join("; ")
    return check(
      "crash-reporting",
      crash.endpoint_configured ? "pass" : "warn",
      `Crash reporting on by default; ${crash.local_record_count} local record(s)`,
      detail,
    )
  } catch (statusFailure) {
    const statusError =
      statusFailure instanceof Error ? statusFailure.message : String(statusFailure)
    try {
      const listed = await stackdListCrashReports({ limit: 1 }, url)
      return check(
        "crash-reporting",
        "warn",
        `stackd crash list reachable (${listed.total} record(s)); telemetry status unavailable`,
        listed.outbox_path,
      )
    } catch (listFailure) {
      const listError = listFailure instanceof Error ? listFailure.message : String(listFailure)
      const fallbackOutbox = readLocalCrashOutboxPath(config)
      return check(
        "crash-reporting",
        "warn",
        "stackd crash status unavailable (stale binary?)",
        [
          statusError,
          listError,
          fallbackOutbox ? `local outbox candidate: ${fallbackOutbox}` : undefined,
          "Rebuild stackd (cargo build -p stackd) and restart with STACK_ROOT set to your Stack checkout.",
        ]
          .filter(Boolean)
          .join("; "),
      )
    }
  }
}

async function inferenceCatalogCheck(config: StackConfig): Promise<DoctorCheck> {
  const catalog = await readRemoteInferenceCatalog(config)
  const detail = inferenceCatalogDetail(catalog)
  if (catalog.status === "ready") {
    return check(
      "inference",
      "pass",
      `Synth inference catalog loaded; ${catalog.models.length} model(s); worker opt-in only`,
      detail,
    )
  }
  if (catalog.status === "missing-auth") {
    return check(
      "inference",
      "warn",
      "Synth inference catalog needs sign-in; local Codex worker unchanged",
      detail,
    )
  }
  return check(
    "inference",
    "warn",
    `Synth inference catalog ${catalog.status}; worker opt-in only`,
    detail,
  )
}

function inferenceCatalogDetail(catalog: RemoteInferenceCatalogSnapshot): string {
  const modelList = catalog.models
    .map((model) => `${model.id}:${model.billingTier}:${model.availability}`)
    .join(", ")
  const parts = [
    catalog.message,
    `worker=${catalog.workerDefault}`,
    `synth_worker=${catalog.workerSynthInference}`,
    modelList ? `models=${modelList}` : undefined,
    ...catalog.errors,
  ]
  return parts.filter((part): part is string => Boolean(part)).join("; ")
}

function readLocalCrashOutboxPath(config: StackConfig): string | undefined {
  const envOutbox = process.env.STACK_CRASH_REPORT_OUTBOX?.trim()
  const candidates = [
    envOutbox,
    join(config.stackDataRoot, "telemetry", "crashes.jsonl"),
    join(config.appRoot, ".stack", "telemetry", "crashes.jsonl"),
  ].filter((value): value is string => Boolean(value && value.trim().length > 0))
  return candidates.find((path) => existsSync(path))
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
