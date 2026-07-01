import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { environmentAuthStatus, type StackConfig } from "./config.js"
import {
  stackdBaseUrl,
  stackdListCrashReports,
  stackdTelemetryStatus,
  type StackdCrashReportListResponse,
} from "./client/stackd.js"

export type RemoteCrashSummary = {
  ok: boolean
  window_days: number
  total: number
  by_crash_class: Record<string, number>
  by_surface: Record<string, number>
  by_version: Record<string, number>
  recent: Array<Record<string, unknown>>
}

export type CrashReportsView = {
  generated_at: string
  environment: string
  api_base_url: string
  local: {
    enabled: boolean
    outbox_path: string
    endpoint_configured: boolean
    local_record_count: number
    recent: StackdCrashReportListResponse | null
    error?: string
  }
  remote: RemoteCrashSummary | null
  remote_error?: string
}

export async function readCrashReportsView(
  config: StackConfig,
  options: { limit?: number; remote?: boolean; windowDays?: number } = {},
): Promise<CrashReportsView> {
  const limit = options.limit ?? 20
  const remote = options.remote ?? false
  const windowDays = options.windowDays ?? 7
  const view: CrashReportsView = {
    generated_at: new Date().toISOString(),
    environment: config.environmentName,
    api_base_url: config.environment.apiBaseUrl,
    local: {
      enabled: true,
      outbox_path: "",
      endpoint_configured: false,
      local_record_count: 0,
      recent: null,
    },
    remote: null,
  }

  try {
    const status = await stackdTelemetryStatus()
    view.local.enabled = status.crash_reporting.enabled
    view.local.outbox_path = status.crash_reporting.outbox_path
    view.local.endpoint_configured = status.crash_reporting.endpoint_configured
    view.local.local_record_count = status.crash_reporting.local_record_count
    view.local.recent = await stackdListCrashReports({ limit })
  } catch (error) {
    const statusError = error instanceof Error ? error.message : String(error)
    let listError: string | undefined
    try {
      const listed = await stackdListCrashReports({ limit })
      view.local.enabled = !crashReportingDisabled()
      view.local.outbox_path = listed.outbox_path
      view.local.endpoint_configured = false
      view.local.local_record_count = listed.total
      view.local.recent = listed
      view.local.error = `stackd telemetry status unavailable (${statusError})`
    } catch (listFailure) {
      listError = listFailure instanceof Error ? listFailure.message : String(listFailure)
      const fallback = readLocalCrashOutboxFallback(config, limit)
      if (fallback) {
        view.local.enabled = !crashReportingDisabled()
        view.local.outbox_path = fallback.outbox_path
        view.local.local_record_count = fallback.total
        view.local.recent = fallback
        view.local.error = formatStackdCrashDegradation(statusError, listError, true)
      } else {
        view.local.error = formatStackdCrashDegradation(statusError, listError, false)
      }
    }
  }

  if (remote) {
    const auth = environmentAuthStatus(config.environment)
    if (!auth.hasAuth) {
      view.remote_error = `${auth.authEnv} is not set; remote crash summary requires Synth auth`
    } else {
      try {
        view.remote = await readRemoteCrashSummary(config, windowDays, Math.min(limit, 10))
      } catch (error) {
        view.remote_error = error instanceof Error ? error.message : String(error)
      }
    }
  }

  return view
}

export async function readRemoteCrashSummary(
  config: StackConfig,
  windowDays = 7,
  recentLimit = 10,
): Promise<RemoteCrashSummary> {
  const token = process.env[config.environment.authEnv]?.trim()
  if (!token) throw new Error(`${config.environment.authEnv} is not set`)

  const url = new URL("/api/v1/product/stack-crashes/summary", config.environment.apiBaseUrl)
  url.searchParams.set("window_days", String(windowDays))
  url.searchParams.set("recent_limit", String(recentLimit))
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new Error(`remote crash summary returned ${response.status}`)
  }
  return (await response.json()) as RemoteCrashSummary
}

export async function runCrashReports(config: StackConfig, argv: string[]): Promise<number> {
  const json = argv.includes("--json")
  const remote = argv.includes("--remote")
  const limitArg = readNumericFlag(argv, "--limit")
  const windowArg = readNumericFlag(argv, "--window-days")
  const view = await readCrashReportsView(config, {
    limit: limitArg ?? 20,
    remote,
    windowDays: windowArg ?? 7,
  })

  if (json) {
    console.log(JSON.stringify(view, null, 2))
  } else {
    printCrashReports(view)
  }

  const localFailed =
    Boolean(view.local.error) &&
    view.local.local_record_count === 0 &&
    (view.local.recent?.items?.length ?? 0) === 0
  const remoteFailed = remote && Boolean(view.remote_error)
  return localFailed || remoteFailed ? 1 : 0
}

function formatStackdCrashDegradation(
  statusError: string,
  listError: string | undefined,
  readLocalOutbox: boolean,
): string {
  const baseUrl = stackdBaseUrl()
  const stale =
    statusError.includes("telemetry contract") ||
    statusError.includes(" failed with 500:") ||
    listError?.includes(" failed with 404:") === true
  const prefix = readLocalOutbox
    ? `stackd crash APIs unavailable; read local outbox directly (${statusError})`
    : statusError
  if (!stale) return prefix
  const hint = `stackd at ${baseUrl} looks stale — rebuild (cargo build -p stackd) and restart with STACK_ROOT=<stack checkout>`
  return listError ? `${prefix}; ${listError}. ${hint}` : `${prefix}. ${hint}`
}

function crashReportingDisabled(): boolean {
  const raw = process.env.STACK_CRASH_REPORT?.trim().toLowerCase()
  return raw === "0" || raw === "false" || raw === "off" || raw === "no"
}

function readLocalCrashOutboxFallback(
  config: StackConfig,
  limit: number,
): (StackdCrashReportListResponse & { outbox_path: string }) | null {
  const envOutbox = process.env.STACK_CRASH_REPORT_OUTBOX?.trim()
  const candidates = [
    envOutbox,
    join(config.stackDataRoot, "telemetry", "crashes.jsonl"),
    join(config.appRoot, ".stack", "telemetry", "crashes.jsonl"),
  ].filter((value): value is string => Boolean(value && value.trim().length > 0))

  for (const outboxPath of candidates) {
    if (!existsSync(outboxPath)) continue
    const text = readFileSync(outboxPath, "utf8")
    const lines = text.split("\n").filter((line) => line.trim().length > 0)
    const items = lines
      .slice(Math.max(0, lines.length - limit))
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    return {
      ok: true,
      outbox_path: outboxPath,
      total: lines.length,
      returned: items.length,
      items,
    }
  }
  return null
}

function printCrashReports(view: CrashReportsView): void {
  console.log(`Stack crashes · ${view.environment} · ${view.generated_at}`)
  console.log("")
  console.log("Local")
  if (view.local.error) {
    console.log(`  error: ${view.local.error}`)
  } else {
    console.log(`  enabled: ${view.local.enabled}`)
    console.log(`  outbox: ${view.local.outbox_path}`)
    console.log(`  cloud endpoint configured: ${view.local.endpoint_configured}`)
    console.log(`  records: ${view.local.local_record_count}`)
    const items = view.local.recent?.items ?? []
    if (items.length === 0) {
      console.log("  recent: none")
    } else {
      console.log(`  recent (${items.length}):`)
      for (const item of items.slice().reverse()) {
        const crashClass = String(item.crash_class ?? "unknown")
        const surface = String(item.surface ?? "unknown")
        const message = String(item.message ?? "").slice(0, 120)
        const observedAt = String(item.observed_at ?? "")
        console.log(`    - ${crashClass} · ${surface} · ${observedAt} · ${message}`)
      }
    }
  }

  if (view.remote || view.remote_error) {
    console.log("")
    console.log("Remote")
    if (view.remote_error) {
      console.log(`  error: ${view.remote_error}`)
      return
    }
    const remote = view.remote
    if (!remote) return
    console.log(`  window_days: ${remote.window_days}`)
    console.log(`  total: ${remote.total}`)
    console.log(`  by_crash_class: ${formatCounts(remote.by_crash_class)}`)
    console.log(`  by_surface: ${formatCounts(remote.by_surface)}`)
    console.log(`  by_version: ${formatCounts(remote.by_version)}`)
    if (remote.recent.length > 0) {
      console.log("  recent:")
      for (const item of remote.recent) {
        const crashClass = String(item.crash_class ?? "unknown")
        const surface = String(item.surface ?? "unknown")
        const message = String(item.message ?? "").slice(0, 120)
        const recordedAt = String(item.recorded_at ?? "")
        console.log(`    - ${crashClass} · ${surface} · ${recordedAt} · ${message}`)
      }
    }
  }
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts)
  if (entries.length === 0) return "none"
  return entries.map(([key, value]) => `${key}=${value}`).join(", ")
}

function readNumericFlag(argv: string[], flag: string): number | undefined {
  const index = argv.indexOf(flag)
  if (index < 0) return undefined
  const raw = argv[index + 1]
  if (!raw) return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}
