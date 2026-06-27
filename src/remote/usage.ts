import { environmentAuthStatus, type StackConfig } from "../config.js"

export type RemoteUsageStatus = "ready" | "missing-auth" | "offline"

export type RemoteBillingAllowanceWindow = {
  modelClass: string
  windowKind: string
  capUsd: number
  consumedUsd: number
  remainingUsd: number
  resetsAt?: string
}

export type RemoteUsageBreakdownRow = {
  label: string
  costUsd: number
  chargedUsd?: number
  eventCount?: number
}

export type RemoteUsageBreakdown = {
  days: number
  byType: RemoteUsageBreakdownRow[]
  bySubtype: RemoteUsageBreakdownRow[]
  byLane: RemoteUsageBreakdownRow[]
  byProject: RemoteUsageBreakdownRow[]
  byFactory: RemoteUsageBreakdownRow[]
  byActor: RemoteUsageBreakdownRow[]
}

export type RemoteUsageSnapshot = {
  status: RemoteUsageStatus
  environmentName: string
  apiBaseUrl: string
  checkedAt: string
  message?: string
  planTier?: string
  legacyPlan?: string
  billingMode?: string
  walletUsd?: number
  walletExpiresAt?: string
  blocked?: boolean
  blockedReason?: string
  allowanceWindows: RemoteBillingAllowanceWindow[]
  spendTodayUsd?: number
  spend7dUsd?: number
  spend30dUsd?: number
  usage7dUsd?: number
  usageBreakdown?: RemoteUsageBreakdown
}

export function emptyRemoteUsageSnapshot(
  config: StackConfig,
  status: RemoteUsageStatus = "offline",
  message?: string,
): RemoteUsageSnapshot {
  return {
    status,
    environmentName: config.environmentName,
    apiBaseUrl: config.environment.apiBaseUrl,
    checkedAt: new Date().toISOString(),
    message,
    allowanceWindows: [],
  }
}

export async function readRemoteUsageSnapshot(config: StackConfig): Promise<RemoteUsageSnapshot> {
  const auth = environmentAuthStatus(config.environment)
  const base = emptyRemoteUsageSnapshot(
    config,
    auth.hasAuth ? "offline" : "missing-auth",
    auth.hasAuth ? "not checked yet" : auth.message,
  )
  if (!auth.hasAuth) return base

  try {
    const [planPayload, overviewPayload] = await Promise.all([
      getJson(config, "/smr/billing/plan"),
      fetchUsageOverviewPayload(config),
    ])
    return parseUsageSnapshot(config, planPayload, overviewPayload)
  } catch (error) {
    return {
      ...base,
      status: "offline",
      checkedAt: new Date().toISOString(),
      message: errorMessage(error),
    }
  }
}

function parseUsageSnapshot(
  config: StackConfig,
  planPayload: unknown,
  overviewPayload: unknown,
): RemoteUsageSnapshot {
  const plan = asRecord(planPayload)
  const wallet = asRecord(plan?.wallet)
  const allowanceWindows = readAllowanceWindows(plan)
  const overview = asRecord(overviewPayload)
  const spend = asRecord(overview?.spend_summary)
  const usageSummary = asRecord(overview?.usage_summary)

  const planTier = readString(plan?.plan_tier)
  const legacyPlan = readString(plan?.legacy_plan)
  const billingMode = readString(plan?.billing_mode)
  const walletUsd = microcentsToUsd(readNumber(wallet?.balance_microcents))
  const blocked = readBoolean(plan?.blocked)

  return {
    status: "ready",
    environmentName: config.environmentName,
    apiBaseUrl: config.environment.apiBaseUrl,
    checkedAt: new Date().toISOString(),
    message: planTier ? `plan ${planTier}` : "billing plan loaded",
    planTier,
    legacyPlan,
    billingMode,
    walletUsd,
    walletExpiresAt: readString(wallet?.expires_at),
    blocked,
    blockedReason: readString(plan?.blocked_reason),
    allowanceWindows,
    spendTodayUsd: readNumber(spend?.today_charged_usd),
    spend7dUsd: readNumber(spend?.last_7d_charged_usd),
    spend30dUsd: readNumber(spend?.last_30d_charged_usd),
    usage7dUsd:
      readNumber(usageSummary?.total_nominal_usd) ??
      readNumber(usageSummary?.total_cost_usd) ??
      readNumber(usageSummary?.total_charged_usd),
    usageBreakdown: usageSummary ? readUsageBreakdown(usageSummary, 7) : undefined,
  }
}

function readUsageBreakdown(usageSummary: Record<string, unknown>, days: number): RemoteUsageBreakdown {
  return {
    days,
    byType: readUsageByTypeRows(usageSummary),
    bySubtype: [],
    byLane: [],
    byProject: readProjectRows(usageSummary),
    byFactory: readFactoryRows(usageSummary),
    byActor: readBreakdownMapRows(usageSummary.by_actor, 3, shortenActorLabel),
  }
}

function readUsageByTypeRows(usageSummary: Record<string, unknown>): RemoteUsageBreakdownRow[] {
  const rows: RemoteUsageBreakdownRow[] = []
  for (const entry of asArray(usageSummary.by_type)) {
    const record = asRecord(entry)
    if (!record) continue
    const usageType = readString(record.usage_type)
    if (!usageType) continue
    rows.push({
      label: formatUsageTypeLabel(usageType),
      costUsd: readNumber(record.total_cost_usd) ?? 0,
      chargedUsd: readNumber(record.charged_cost_usd),
      eventCount: readNumber(record.event_count),
    })
  }
  return topBreakdownRows(rows, 5)
}

function readProjectRows(usageSummary: Record<string, unknown>): RemoteUsageBreakdownRow[] {
  const rows: RemoteUsageBreakdownRow[] = []
  for (const entry of asArray(usageSummary.by_project)) {
    const record = asRecord(entry)
    if (!record) continue
    const name = readString(record.project_name) ?? readString(record.project_id)
    const projectId = readString(record.project_id)
    if (!name) continue
    rows.push({
      label: projectBreakdownLabel(name, projectId),
      costUsd: readNumber(record.total_cost_usd) ?? 0,
      chargedUsd: readNumber(record.charged_cost_usd),
      eventCount: readNumber(record.event_count),
    })
  }
  return topBreakdownRows(rows, 3)
}

function projectBreakdownLabel(name: string, projectId?: string): string {
  const shortName = oneLine(name, 20)
  if (!projectId) return shortName
  return `${shortName} (${projectId.slice(0, 6)})`
}

function readFactoryRows(usageSummary: Record<string, unknown>): RemoteUsageBreakdownRow[] {
  const rows: RemoteUsageBreakdownRow[] = []
  for (const entry of asArray(usageSummary.by_factory)) {
    const record = asRecord(entry)
    if (!record) continue
    const name = readString(record.factory_name) ?? readString(record.factory_id)
    if (!name) continue
    rows.push({
      label: oneLine(name, 22),
      costUsd: readNumber(record.total_cost_usd) ?? 0,
      chargedUsd: readNumber(record.charged_cost_usd),
      eventCount: readNumber(record.event_count),
    })
  }
  return topBreakdownRows(rows, 3)
}

function readBreakdownMapRows(
  value: unknown,
  limit: number,
  labelFn: (key: string) => string,
): RemoteUsageBreakdownRow[] {
  const map = asRecord(value)
  if (!map) return []
  const rows: RemoteUsageBreakdownRow[] = []
  for (const [key, entry] of Object.entries(map)) {
    const record = asRecord(entry)
    if (!record) continue
    rows.push({
      label: labelFn(key),
      costUsd: readNumber(record.nominal_usage_usd) ?? readNumber(record.internal_cost_usd) ?? 0,
      chargedUsd: readNumber(record.billed_amount_usd),
      eventCount: readNumber(record.event_count),
    })
  }
  return topBreakdownRows(rows, limit)
}

function topBreakdownRows(rows: RemoteUsageBreakdownRow[], limit: number): RemoteUsageBreakdownRow[] {
  return rows
    .filter((row) => row.costUsd > 0 || (row.eventCount ?? 0) > 0)
    .sort((left, right) => right.costUsd - left.costUsd || (right.eventCount ?? 0) - (left.eventCount ?? 0))
    .slice(0, limit)
}

function formatUsageTypeLabel(value: string): string {
  if (value === "inference") return "Inference"
  if (value === "sandbox") return "Sandbox"
  if (value === "tooling") return "Tooling"
  if (value === "third_party_infra") return "Third-party"
  return oneLine(value.replaceAll("_", " "), 14)
}

function shortenActorLabel(value: string): string {
  const roleMatch = /^(orchestrator|worker|reviewer):(.+)$/.exec(value)
  if (roleMatch) {
    const role = roleMatch[1] === "orchestrator" ? "orch" : roleMatch[1] === "reviewer" ? "review" : "worker"
    const id = roleMatch[2].split(":").at(-1) ?? roleMatch[2]
    return `${role} ${id.slice(0, 8)}`
  }
  if (value.startsWith("run-local:")) {
    return oneLine(value.replace(/^run-local:/, "local:"), 18)
  }
  return oneLine(value.slice(0, 8), 12)
}

function oneLine(value: string, max: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, Math.max(0, max - 1))}…`
}

function readAllowanceWindows(plan: Record<string, unknown> | undefined): RemoteBillingAllowanceWindow[] {
  const rows: RemoteBillingAllowanceWindow[] = []
  for (const entry of asArray(plan?.allowance_windows)) {
    const record = asRecord(entry)
    if (!record) continue
    const modelClass = readString(record.model_class)
    const windowKind = readString(record.window_kind)
    if (!modelClass || !windowKind) continue
    rows.push({
      modelClass,
      windowKind,
      capUsd: microcentsToUsd(readNumber(record.cap_microcents)) ?? 0,
      consumedUsd: microcentsToUsd(readNumber(record.consumed_microcents)) ?? 0,
      remainingUsd: microcentsToUsd(readNumber(record.remaining_microcents)) ?? 0,
      resetsAt: readString(record.resets_at),
    })
  }
  return sortAllowanceWindows(rows)
}

function sortAllowanceWindows(windows: RemoteBillingAllowanceWindow[]): RemoteBillingAllowanceWindow[] {
  const modelOrder = (value: string) => (value === "premium" ? 0 : value === "value" ? 1 : 2)
  const windowOrder = (value: string) => (value === "five_hour" ? 0 : value === "weekly" ? 1 : 2)
  return [...windows].sort((left, right) => {
    const modelDelta = modelOrder(left.modelClass) - modelOrder(right.modelClass)
    if (modelDelta !== 0) return modelDelta
    return windowOrder(left.windowKind) - windowOrder(right.windowKind)
  })
}

function microcentsToUsd(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  return value / 100_000_000
}

async function fetchUsageOverviewPayload(config: StackConfig): Promise<unknown | undefined> {
  try {
    return await getJson(config, "/api/v1/usage/overview?days=7&include_projects=true")
  } catch {
    return await buildProjectUsageOverviewFallback(config)
  }
}

async function buildProjectUsageOverviewFallback(config: StackConfig): Promise<unknown | undefined> {
  try {
    const projectsPayload = await getJson(config, "/smr/projects?limit=12&include_archived=false")
    const projects = readProjectSummaries(projectsPayload)
    if (projects.length === 0) return undefined

    const windows = await Promise.all(
      projects.slice(0, 8).map(async (project) => {
        try {
          const usagePayload = await getJson(config, `/smr/projects/${encodeURIComponent(project.id)}/usage`)
          const window = readProjectUsageWindow(usagePayload)
          return window ? { project, window } : undefined
        } catch {
          return undefined
        }
      }),
    )

    const active = windows.filter((entry): entry is ProjectUsageWindowEntry => Boolean(entry))
    if (active.length === 0) return undefined
    return synthesizeOverviewFromProjectWindows(active)
  } catch {
    return undefined
  }
}

type ProjectUsageSummary = {
  id: string
  name: string
}

type ProjectUsageWindow = {
  totalCostUsd: number
  totalChargedUsd: number
  eventCount: number
  bySourceTypeCents: Record<string, number>
  bySourceSubtypeCents: Record<string, number>
  byFundingLaneCents: Record<string, number>
  byActorCents: Record<string, number>
}

type ProjectUsageWindowEntry = {
  project: ProjectUsageSummary
  window: ProjectUsageWindow
}

function readProjectSummaries(payload: unknown): ProjectUsageSummary[] {
  const rows = Array.isArray(payload)
    ? payload
    : asArray(asRecord(payload)?.projects ?? asRecord(payload)?.items)
  const projects: ProjectUsageSummary[] = []
  for (const entry of rows) {
    const record = asRecord(entry)
    if (!record) continue
    const id = readString(record.project_id) ?? readString(record.id)
    if (!id) continue
    projects.push({
      id,
      name: readString(record.name) ?? readString(record.alias) ?? id.slice(0, 8),
    })
  }
  return projects
}

function readProjectUsageWindow(payload: unknown): ProjectUsageWindow | undefined {
  const record = asRecord(payload)
  const last7 = asRecord(record?.last_7_days)
  if (!last7) return undefined
  const breakdown = asRecord(last7.breakdown)
  const totalCostUsd = readNumber(last7.total_cost_usd) ?? 0
  const totalChargedUsd = readNumber(last7.total_charged_usd) ?? 0
  const eventCount = readNumber(breakdown?.event_count) ?? 0
  if (totalCostUsd <= 0 && totalChargedUsd <= 0 && eventCount <= 0) return undefined
  return {
    totalCostUsd,
    totalChargedUsd,
    eventCount,
    bySourceTypeCents: readCentMap(breakdown?.by_source_type ?? breakdown?.by_usage_category),
    bySourceSubtypeCents: readCentMap(breakdown?.by_source_subtype),
    byFundingLaneCents: readCentMap(breakdown?.by_funding_lane),
    byActorCents: readCentMap(breakdown?.by_actor),
  }
}

function readCentMap(value: unknown): Record<string, number> {
  const map = asRecord(value)
  if (!map) return {}
  const out: Record<string, number> = {}
  for (const [key, raw] of Object.entries(map)) {
    const cents = readNumber(raw)
    if (cents === undefined || cents <= 0) continue
    out[key] = cents
  }
  return out
}

function synthesizeOverviewFromProjectWindows(entries: ProjectUsageWindowEntry[]): unknown {
  let totalCostUsd = 0
  let totalChargedUsd = 0
  const byTypeUsd: Record<string, number> = {}
  const byActorUsd: Record<string, number> = {}

  for (const entry of entries) {
    totalCostUsd += entry.window.totalCostUsd
    totalChargedUsd += entry.window.totalChargedUsd
    for (const [key, usd] of Object.entries(
      allocateUsdByCentMap(entry.window.bySourceTypeCents, entry.window.totalCostUsd),
    )) {
      byTypeUsd[key] = (byTypeUsd[key] ?? 0) + usd
    }
    for (const [key, usd] of Object.entries(
      allocateUsdByCentMap(entry.window.byActorCents, entry.window.totalCostUsd),
    )) {
      byActorUsd[key] = (byActorUsd[key] ?? 0) + usd
    }
  }

  const byProject = entries
    .map(({ project, window }) => ({
      project_id: project.id,
      project_name: projectBreakdownLabel(project.name, project.id),
      total_cost_usd: window.totalCostUsd,
      charged_cost_usd: window.totalChargedUsd,
      internal_cost_usd: window.totalCostUsd,
      event_count: window.eventCount,
    }))
    .filter((row) => row.total_cost_usd >= 0.001 || row.event_count > 0)
    .sort((left, right) => right.total_cost_usd - left.total_cost_usd)

  return {
    usage_summary: {
      total_nominal_usd: totalCostUsd,
      total_cost_usd: totalCostUsd,
      total_charged_usd: totalChargedUsd,
      total_internal_cost_usd: totalCostUsd,
      by_type: Object.entries(byTypeUsd).map(([usage_type, total_cost_usd]) => ({
        usage_type,
        total_cost_usd,
        charged_cost_usd: 0,
        internal_cost_usd: total_cost_usd,
        event_count: 0,
      })),
      by_project: byProject,
      by_factory: [],
      by_actor: usdMapToOverviewBreakdown(byActorUsd),
    },
    spend_summary: {
      today_nominal_usd: 0,
      today_charged_usd: 0,
      last_7d_nominal_usd: totalCostUsd,
      last_7d_charged_usd: totalChargedUsd,
      last_30d_nominal_usd: totalCostUsd,
      last_30d_charged_usd: totalChargedUsd,
    },
  }
}

function allocateUsdByCentMap(
  centMap: Record<string, number>,
  totalUsd: number,
): Record<string, number> {
  const centTotal = Object.values(centMap).reduce((sum, value) => sum + value, 0)
  if (centTotal <= 0 || totalUsd <= 0) return {}
  const out: Record<string, number> = {}
  for (const [key, cents] of Object.entries(centMap)) {
    if (cents <= 0) continue
    out[key] = totalUsd * (cents / centTotal)
  }
  return out
}

function usdMapToOverviewBreakdown(
  usdMap: Record<string, number>,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {}
  for (const [key, usd] of Object.entries(usdMap)) {
    if (usd <= 0) continue
    out[key] = {
      nominal_usage_usd: usd,
      billed_amount_usd: 0,
      internal_cost_usd: usd,
      event_count: 0,
    }
  }
  return out
}

async function getJson(config: StackConfig, path: string): Promise<unknown> {
  const response = await fetch(`${config.environment.apiBaseUrl.replace(/\/+$/, "")}${path}`, {
    headers: {
      Authorization: `Bearer ${process.env[config.environment.authEnv]}`,
    },
    signal: AbortSignal.timeout(3500),
  })
  if (response.status === 401 || response.status === 403) {
    throw new Error(`${path} ${response.status} auth rejected`)
  }
  if (!response.ok) throw new Error(`${path} ${response.status} ${response.statusText}`)
  return await response.json()
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
