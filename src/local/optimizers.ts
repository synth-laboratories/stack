import { spawn, spawnSync } from "node:child_process"
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import type { StackConfig } from "../config.js"

export type OptimizerServiceStatus = "running" | "stopped" | "starting" | "error"

export type OptimizerRunSummary = {
  runId: string
  requestId?: string
  status: string
  phase?: string
  generation?: number
  candidateCount?: number
  bestCandidateId?: string
  configPath?: string
  submittedAt?: string
  startedAt?: string
  finishedAt?: string
  costUsd?: number
  totalTokens?: number
  error?: string
}

export type OptimizerSnapshot = {
  status: OptimizerServiceStatus
  serviceUrl: string
  dbPath: string
  logPath: string
  pid?: number
  pidAlive?: boolean
  message?: string
  checkedAt: string
  runCounts: Record<string, number>
  workerCount?: number
  activeWorkers?: number
  idleWorkers?: number
  queuedRunnable?: number
  queuedBlocked?: number
  staleLeases?: number
  runningCount?: number
  oldestQueuedAgeSeconds?: number
  lastProgressAt?: string
  runs: OptimizerRunSummary[]
}

type WorkspacePayload = {
  total?: number
  by_status?: Record<string, number>
  run_request_status_counts?: Record<string, number>
  liveness?: Record<string, unknown>
  scheduler?: Record<string, unknown>
  run_status?: Record<string, unknown>
}

type RunsPayload = {
  items?: unknown[]
  runs?: unknown[]
  run_requests?: unknown[]
}

export async function readOptimizerSnapshot(config: StackConfig): Promise<OptimizerSnapshot> {
  const pid = readPid(config.optimizerPidPath)
  const base: OptimizerSnapshot = {
    status: "stopped",
    serviceUrl: config.optimizerServiceUrl,
    dbPath: config.optimizerDbPath,
    logPath: config.optimizerLogPath,
    pid,
    pidAlive: pid === undefined ? undefined : isProcessAlive(pid),
    checkedAt: new Date().toISOString(),
    runCounts: {},
    runs: [],
  }

  try {
    await getJson(`${config.optimizerServiceUrl}/health`)
    const workspaceCandidate = await getJson(`${config.optimizerServiceUrl}/workspace`).catch(() => undefined)
    const statusPage = await getJson(`${config.optimizerServiceUrl}/status`).catch(() => undefined)
    const workspace = isNotFoundPayload(workspaceCandidate)
      ? statusPage
      : workspaceCandidate
    const runsPage = await getJson(`${config.optimizerServiceUrl}/runs?limit=12`).catch(() => workspace)
    const runs = readRuns(runsPage)
    const statusRuns = readRuns(statusPage)
    return {
      ...base,
      ...readWorkspace(workspace ?? statusPage),
      runs: runs.length > 0 ? runs : statusRuns.length > 0 ? statusRuns : readRuns(workspace),
      status: "running",
      message: "GEPA service is reachable",
      checkedAt: new Date().toISOString(),
    }
  } catch (error) {
    return {
      ...base,
      status: "stopped",
      message: `GEPA service is not reachable: ${errorMessage(error)}`,
      checkedAt: new Date().toISOString(),
    }
  }
}

export async function startOptimizerService(config: StackConfig): Promise<OptimizerSnapshot> {
  const current = await readOptimizerSnapshot(config)
  if (current.status === "running") return current

  mkdirSync(dirname(config.optimizerDbPath), { recursive: true })
  mkdirSync(dirname(config.optimizerLogPath), { recursive: true })
  mkdirSync(dirname(config.optimizerPidPath), { recursive: true })

  const logFd = openSync(config.optimizerLogPath, "a")
  const args = [
    "gepa",
    "service",
    "--db",
    config.optimizerDbPath,
    "--bind",
    config.optimizerBind,
  ]
  if (serviceSupportsWorkers(config.optimizerCommand)) {
    args.push("--workers", String(config.optimizerWorkers))
  }

  try {
    const child = spawn(config.optimizerCommand, args, {
      cwd: config.workspaceRoot,
      detached: true,
      stdio: ["ignore", logFd, logFd],
    })
    child.unref()
    writeFileSync(config.optimizerPidPath, `${child.pid ?? ""}\n`, "utf8")
  } catch (error) {
    closeSync(logFd)
    return {
      ...current,
      status: "error",
      message: `failed to start ${config.optimizerCommand}: ${errorMessage(error)}`,
      checkedAt: new Date().toISOString(),
    }
  }

  closeSync(logFd)
  return waitForOptimizerService(config)
}

async function waitForOptimizerService(config: StackConfig): Promise<OptimizerSnapshot> {
  let last = await readOptimizerSnapshot(config)
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (last.status === "running") return last
    await sleep(250)
    last = await readOptimizerSnapshot(config)
  }
  return {
    ...last,
    status: last.status === "running" ? "running" : "starting",
    message: last.status === "running" ? last.message : `started process; waiting on ${config.optimizerServiceUrl}`,
    checkedAt: new Date().toISOString(),
  }
}

function readWorkspace(value: unknown): Partial<OptimizerSnapshot> {
  const workspace = asRecord(value) as WorkspacePayload | undefined
  if (!workspace) return {}
  const scheduler = asRecord(workspace.scheduler)
  const liveness = asRecord(workspace.liveness)
  const runStatus = asRecord(workspace.run_status)
  const runStatusCounts = asRecord(runStatus?.counts)
  const statusCounts =
    asRecord(workspace.by_status) ??
    asRecord(runStatus?.projected_status_counts) ??
    asRecord(workspace.run_request_status_counts) ??
    {}

  return {
    runCounts: readNumberMap(statusCounts),
    workerCount: readNumber(runStatusCounts?.worker_count) ?? readNumber(scheduler?.worker_count),
    activeWorkers: readNumber(runStatusCounts?.active_workers) ?? readNumber(scheduler?.active_workers),
    idleWorkers: readNumber(runStatusCounts?.idle_workers) ?? readNumber(scheduler?.idle_workers),
    queuedRunnable: readNumber(runStatusCounts?.queued_runnable) ?? readNumber(scheduler?.queued_runnable),
    queuedBlocked: readNumber(runStatusCounts?.queued_blocked) ?? readNumber(scheduler?.queued_blocked),
    staleLeases: readNumber(runStatusCounts?.stale_leases),
    runningCount: readNumber(liveness?.running_count),
    oldestQueuedAgeSeconds: readNumber(liveness?.oldest_queued_age_seconds),
    lastProgressAt: readString(liveness?.last_progress_at),
  }
}

function isNotFoundPayload(value: unknown): boolean {
  const payload = asRecord(value)
  return readString(payload?.error) === "not_found"
}

function serviceSupportsWorkers(command: string): boolean {
  const result = spawnSync(command, ["gepa", "service", "--help"], {
    encoding: "utf8",
    timeout: 2500,
  })
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`.includes("--workers")
}

function readRuns(value: unknown): OptimizerRunSummary[] {
  const payload = asRecord(value) as RunsPayload | undefined
  const items = firstNonEmptyArray(payload?.items, payload?.runs, payload?.run_requests)
  return items.map(readRun).filter((run): run is OptimizerRunSummary => Boolean(run))
}

function firstNonEmptyArray(...values: unknown[]): unknown[] {
  const fallback = values.find((value): value is unknown[] => Array.isArray(value))
  return values.find((value): value is unknown[] => Array.isArray(value) && value.length > 0) ?? fallback ?? []
}

function readRun(value: unknown): OptimizerRunSummary | undefined {
  const run = asRecord(value)
  const runId = readString(run?.run_id) ?? readString(run?.id) ?? readString(run?.request_id)
  if (!run || !runId) return undefined
  const usage = asRecord(run.usage)
  const error = asRecord(run.error)
  return {
    runId,
    requestId: readString(run.request_id),
    status: readString(run.status) ?? readString(run.request_status) ?? "unknown",
    phase: readString(run.phase),
    generation: readNumber(run.generation),
    candidateCount: readNumber(run.candidate_count),
    bestCandidateId: readString(run.best_candidate_id),
    configPath: readString(run.config_path),
    submittedAt: readString(run.submitted_at),
    startedAt: readString(run.started_at),
    finishedAt: readString(run.finished_at),
    costUsd: readNumber(usage?.cost_usd),
    totalTokens: readNumber(usage?.total_tokens),
    error: readString(error?.message) ?? readString(error?.reason),
  }
}

async function getJson(url: string): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 2500)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    return await response.json()
  } finally {
    clearTimeout(timeout)
  }
}

function readPid(path: string): number | undefined {
  if (!existsSync(path)) return undefined
  const parsed = Number.parseInt(readFileSync(path, "utf8").trim(), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readNumberMap(value: Record<string, unknown>): Record<string, number> {
  const next: Record<string, number> = {}
  for (const [key, raw] of Object.entries(value)) {
    const number = readNumber(raw)
    if (number !== undefined) next[key] = number
  }
  return next
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
