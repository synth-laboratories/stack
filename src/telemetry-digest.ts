import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { environmentAuthStatus, type StackConfig, type StackEnvironmentName } from "./config.js"
import { stackdTelemetryStatus } from "./client/stackd.js"
import { readCrashReportsView, readRemoteCrashSummary } from "./crash-reports.js"
import { stackChannel, stackVersion } from "./version.js"

type JsonlRecord = Record<string, unknown>

export type GrowthFunnelRollup = {
  ok: boolean
  product: string
  window_days: number
  stages: Array<{ stage: string; events: string[]; count: number }>
  pending_stages?: string[]
  pending_note?: string
  error?: string
}

export type TelemetryDigestView = {
  generated_at: string
  date_utc: string
  stack_version: string
  channel: string
  environment: string
  api_base_url: string
  stackd: {
    reachable: boolean
    local_product_telemetry: Record<string, unknown> | null
    crash_reporting: Record<string, unknown> | null
    allowlisted_event_count: number
    error?: string
  }
  local: {
    events_outbox_path: string | null
    events_sent_cursor_path: string | null
    events_total_in_outbox: number
    events_sent_count: number
    events_pending_upload: number
    events_on_date: number
    events_by_name: Record<string, number>
    crashes_outbox_path: string | null
    crashes_total_in_outbox: number
    crashes_on_date: number
    crashes_by_class: Record<string, number>
  }
  remote: {
    growth_funnel: GrowthFunnelRollup | null
    crash_summary: Awaited<ReturnType<typeof readRemoteCrashSummary>> | null
    crash_ready: { ok: boolean; route?: string; error?: string } | null
    errors: string[]
  }
}

export async function readTelemetryDigestView(
  config: StackConfig,
  options: {
    dateUtc: string
    remote?: boolean
    windowDays?: number
  },
): Promise<TelemetryDigestView> {
  const windowDays = options.windowDays ?? 1
  const view: TelemetryDigestView = {
    generated_at: new Date().toISOString(),
    date_utc: options.dateUtc,
    stack_version: stackVersion(config.appRoot),
    channel: stackChannel(config.appRoot),
    environment: config.environmentName,
    api_base_url: config.environment.apiBaseUrl,
    stackd: {
      reachable: false,
      local_product_telemetry: null,
      crash_reporting: null,
      allowlisted_event_count: 0,
    },
    local: {
      events_outbox_path: null,
      events_sent_cursor_path: null,
      events_total_in_outbox: 0,
      events_sent_count: 0,
      events_pending_upload: 0,
      events_on_date: 0,
      events_by_name: {},
      crashes_outbox_path: null,
      crashes_total_in_outbox: 0,
      crashes_on_date: 0,
      crashes_by_class: {},
    },
    remote: {
      growth_funnel: null,
      crash_summary: null,
      crash_ready: null,
      errors: [],
    },
  }

  try {
    const status = await stackdTelemetryStatus()
    view.stackd.reachable = true
    view.stackd.local_product_telemetry = status.local_product_telemetry as unknown as Record<string, unknown>
    view.stackd.crash_reporting = status.crash_reporting as unknown as Record<string, unknown>
    view.stackd.allowlisted_event_count = status.events.length
  } catch (error) {
    view.stackd.error = error instanceof Error ? error.message : String(error)
  }

  const eventPaths = telemetryOutboxCandidates(config)
  for (const path of eventPaths) {
    const parsed = readJsonlFile(path)
    if (!parsed) continue
    view.local.events_outbox_path = path
    view.local.events_total_in_outbox = parsed.all.length
    const sent = readSentTelemetryCursor(config, path)
    view.local.events_sent_cursor_path = sent.path
    view.local.events_sent_count = sent.ids.size
    view.local.events_pending_upload = parsed.all.filter((row) => {
      const eventId = typeof row.event_id === "string" ? row.event_id : ""
      return eventId.length > 0 && !sent.ids.has(eventId)
    }).length
    const onDay = parsed.all.filter((row) => observedOnUtcDate(row, options.dateUtc))
    view.local.events_on_date = onDay.length
    view.local.events_by_name = countBy(onDay, (row) => String(row.name ?? "unknown"))
    break
  }

  const crashView = await readCrashReportsView(config, { limit: 500, remote: false })
  const crashItems = crashView.local.recent?.items ?? []
  view.local.crashes_outbox_path = crashView.local.outbox_path || null
  view.local.crashes_total_in_outbox = crashView.local.local_record_count
  const crashesOnDay = crashItems.filter((row) => observedOnUtcDate(row, options.dateUtc))
  view.local.crashes_on_date = crashesOnDay.length
  view.local.crashes_by_class = countBy(crashesOnDay, (row) => String(row.crash_class ?? "unknown"))

  if (options.remote) {
    try {
      view.remote.growth_funnel = await readGrowthFunnelRollup(config, windowDays)
    } catch (error) {
      view.remote.errors.push(
        `growth funnel: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    try {
      view.remote.crash_ready = await readCrashRouteReady(config)
    } catch (error) {
      view.remote.crash_ready = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }

    const auth = environmentAuthStatus(config.environment)
    if (!auth.hasAuth) {
      view.remote.errors.push(`${auth.authEnv} is not set; remote crash summary skipped`)
    } else {
      try {
        view.remote.crash_summary = await readRemoteCrashSummary(config, windowDays, 20)
      } catch (error) {
        view.remote.errors.push(
          `crash summary: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }

  return view
}

export async function runTelemetryDigest(config: StackConfig, argv: string[]): Promise<number> {
  const json = argv.includes("--json")
  const remote = argv.includes("--remote")
  const writeEvidence = argv.includes("--write-evidence")
  const dateUtc = readStringFlag(argv, "--date") ?? utcDateString(new Date())
  const windowDays = readNumericFlag(argv, "--window-days") ?? 1

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateUtc)) {
    console.error(`invalid --date ${JSON.stringify(dateUtc)}; expected YYYY-MM-DD`)
    return 1
  }

  const view = await readTelemetryDigestView(config, { dateUtc, remote, windowDays })

  if (writeEvidence) {
    const dir = join(
      config.stackDataRoot,
      "evidence",
      "telemetry-digest",
      `${utcStamp()}-${dateUtc}`,
    )
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "summary.json"), `${JSON.stringify(view, null, 2)}\n`, "utf8")
    if (!json) console.log(`evidence: ${dir}/summary.json`)
  }

  if (json) {
    console.log(JSON.stringify(view, null, 2))
  } else {
    printTelemetryDigest(view, { remote, windowDays })
  }

  return 0
}

async function readGrowthFunnelRollup(
  config: StackConfig,
  windowDays: number,
): Promise<GrowthFunnelRollup> {
  const url = new URL("/api/v1/growth/funnel/stack", config.environment.apiBaseUrl)
  url.searchParams.set("window_days", String(windowDays))
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`growth funnel returned ${response.status}`)
  }
  return (await response.json()) as GrowthFunnelRollup
}

async function readCrashRouteReady(
  config: StackConfig,
): Promise<{ ok: boolean; route?: string; error?: string }> {
  const url = new URL("/api/v1/product/stack-crashes/ready", config.environment.apiBaseUrl)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`/stack-crashes/ready returned ${response.status}`)
  }
  const body = (await response.json()) as Record<string, unknown>
  return {
    ok: body.ok === true,
    route: typeof body.query_route === "string" ? body.query_route : undefined,
  }
}

function telemetryOutboxCandidates(config: StackConfig): string[] {
  const envOutbox = process.env.STACK_TELEMETRY_OUTBOX?.trim()
  return [
    envOutbox,
    join(config.stackDataRoot, "telemetry", "events.jsonl"),
    join(config.appRoot, ".stack", "telemetry", "events.jsonl"),
  ].filter((value): value is string => Boolean(value && value.length > 0))
}

function readJsonlFile(path: string): { all: JsonlRecord[] } | null {
  if (!existsSync(path)) return null
  const text = readFileSync(path, "utf8")
  const all = text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as JsonlRecord)
  return { all }
}

function observedOnUtcDate(row: JsonlRecord, dateUtc: string): boolean {
  const raw = String(row.observed_at ?? row.recorded_at ?? "")
  if (!raw) return false
  const parsed = Date.parse(raw)
  if (!Number.isFinite(parsed)) return false
  return utcDateString(new Date(parsed)) === dateUtc
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items) {
    const key = keyFn(item)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

function utcDateString(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function utcStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z")
}

function readStringFlag(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  if (index < 0) return undefined
  return argv[index + 1]
}

function readNumericFlag(argv: string[], flag: string): number | undefined {
  const index = argv.indexOf(flag)
  if (index < 0) return undefined
  const raw = argv[index + 1]
  if (!raw) return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

function printTelemetryDigest(
  view: TelemetryDigestView,
  options: { remote: boolean; windowDays: number },
): void {
  console.log(`Stack telemetry digest · ${view.date_utc} UTC · ${view.environment}`)
  console.log(`version: ${view.stack_version} (${view.channel}) · api: ${view.api_base_url}`)
  console.log("")

  console.log("stackd")
  if (view.stackd.error) {
    console.log(`  unreachable: ${view.stackd.error}`)
  } else {
    const telemetry = view.stackd.local_product_telemetry as { enabled?: boolean; reason?: string } | null
    const crash = view.stackd.crash_reporting as {
      enabled?: boolean
      local_record_count?: number
      endpoint_configured?: boolean
    } | null
    console.log(
      `  product telemetry: ${telemetry?.enabled ? "on" : "off"} (${telemetry?.reason ?? "—"})`,
    )
    console.log(
      `  crash reporting: ${crash?.enabled ? "on" : "off"} · local=${crash?.local_record_count ?? 0} · cloud=${crash?.endpoint_configured ? "configured" : "not configured"}`,
    )
    console.log(`  allowlisted events: ${view.stackd.allowlisted_event_count}`)
  }

  console.log("")
  console.log(`local events (${view.date_utc})`)
  if (!view.local.events_outbox_path) {
    console.log("  outbox: not found")
  } else {
    console.log(`  outbox: ${view.local.events_outbox_path}`)
    console.log(`  total in file: ${view.local.events_total_in_outbox}`)
    console.log(`  upload: pending=${view.local.events_pending_upload} · sent=${view.local.events_sent_count}`)
    console.log(`  on date: ${view.local.events_on_date}`)
    console.log(`  by name: ${formatCounts(view.local.events_by_name)}`)
  }

  console.log("")
  console.log(`local crashes (${view.date_utc})`)
  if (!view.local.crashes_outbox_path) {
    console.log("  outbox: not found")
  } else {
    console.log(`  outbox: ${view.local.crashes_outbox_path}`)
    console.log(`  total in stackd view: ${view.local.crashes_total_in_outbox}`)
    console.log(`  on date: ${view.local.crashes_on_date}`)
    console.log(`  by class: ${formatCounts(view.local.crashes_by_class)}`)
  }

  if (options.remote) {
    console.log("")
    console.log(`remote (window_days=${options.windowDays})`)
    if (view.remote.growth_funnel) {
      const funnel = view.remote.growth_funnel
      if (funnel.error) {
        console.log(`  growth funnel error: ${funnel.error}`)
      } else {
        console.log("  growth funnel stages:")
        for (const stage of funnel.stages ?? []) {
          console.log(`    - ${stage.stage}: ${stage.count}`)
        }
        if (funnel.pending_stages?.length) {
          console.log(`  pending: ${funnel.pending_stages.join(", ")}`)
        }
      }
    }
    if (view.remote.crash_ready) {
      console.log(
        `  crash route ready: ${view.remote.crash_ready.ok ? "yes" : "no"}${view.remote.crash_ready.route ? ` (${view.remote.crash_ready.route})` : ""}`,
      )
      if (view.remote.crash_ready.error) console.log(`    error: ${view.remote.crash_ready.error}`)
    }
    if (view.remote.crash_summary) {
      const summary = view.remote.crash_summary
      console.log(`  crash summary total: ${summary.total}`)
      console.log(`  by class: ${formatCounts(summary.by_crash_class)}`)
      console.log(`  by version: ${formatCounts(summary.by_version)}`)
    }
    for (const error of view.remote.errors) {
      console.log(`  error: ${error}`)
    }
  } else {
    console.log("")
    console.log("remote: skipped (pass --remote for growth funnel + cloud crash summary)")
  }
}

function readSentTelemetryCursor(
  config: StackConfig,
  outboxPath: string,
): { path: string; ids: Set<string> } {
  const envPath = process.env.STACK_TELEMETRY_SENT_CURSOR?.trim()
  const path = envPath && envPath.length > 0
    ? envPath
    : outboxPath === join(config.stackDataRoot, "telemetry", "events.jsonl")
      ? join(config.stackDataRoot, "telemetry", "events.sent.jsonl")
      : join(config.appRoot, ".stack", "telemetry", "events.sent.jsonl")
  const parsed = readJsonlFile(path)
  const ids = new Set<string>()
  for (const row of parsed?.all ?? []) {
    if (typeof row.event_id === "string" && row.event_id.length > 0) ids.add(row.event_id)
  }
  return { path, ids }
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts)
  if (entries.length === 0) return "none"
  return entries.map(([key, value]) => `${key}=${value}`).join(", ")
}

export function resolveEnvironmentFromArgv(argv: string[]): StackEnvironmentName | undefined {
  const raw = readStringFlag(argv, "--env")
  if (!raw) return undefined
  if (raw === "dev" || raw === "staging" || raw === "prod") return raw
  return undefined
}
