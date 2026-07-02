import { spawn, spawnSync } from "node:child_process"
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import type { StackConfig } from "../config.js"
import { stackdRuntimeAppendEvent } from "../client/stackd.js"
import { emitOptimizerRunStarted } from "../telemetry/funnel.js"

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

export type LocalGepaLaunchOptions = {
  configPath: string
  requestId?: string
  metadata?: Record<string, unknown>
  startService?: boolean
}

export type LocalGepaLaunchResult = {
  ok: boolean
  status: number
  message: string
  service: OptimizerSnapshot
  run?: OptimizerRunSummary
  container?: LocalGepaContainerLaunch
  response?: Record<string, unknown>
}

export type LocalGepaContainerLaunch = {
  url: string
  pid?: number
  logPath: string
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

  void emitOptimizerRunStarted("local_gepa", "service")

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

  let child
  try {
    child = spawn(config.optimizerCommand, args, {
      cwd: config.workspaceRoot,
      detached: true,
      stdio: ["ignore", logFd, logFd],
    })
  } catch (error) {
    closeSync(logFd)
    await recordOptimizerLeverEvent(config, "lever.local_gepa.service.start_failed", {
      error: errorMessage(error),
    })
    return {
      ...current,
      status: "error",
      message: `failed to start ${config.optimizerCommand}: ${errorMessage(error)}`,
      checkedAt: new Date().toISOString(),
    }
  }

  const spawnError = await immediateSpawnError(child)
  if (spawnError) {
    closeSync(logFd)
    await recordOptimizerLeverEvent(config, "lever.local_gepa.service.start_failed", {
      error: errorMessage(spawnError),
    })
    return {
      ...current,
      status: "error",
      message: `failed to start ${config.optimizerCommand}: ${errorMessage(spawnError)}`,
      checkedAt: new Date().toISOString(),
    }
  }

  child.unref()
  writeFileSync(config.optimizerPidPath, `${child.pid ?? ""}\n`, "utf8")

  closeSync(logFd)
  const snapshot = await waitForOptimizerService(config)
  await recordOptimizerLeverEvent(config, "lever.local_gepa.service.start_requested", {
    pid: snapshot.pid ?? null,
    status: snapshot.status,
    message: snapshot.message ?? null,
  })
  return snapshot
}

export async function launchLocalGepaRun(
  config: StackConfig,
  options: LocalGepaLaunchOptions,
): Promise<LocalGepaLaunchResult> {
  const service = options.startService === false
    ? await readOptimizerSnapshot(config)
    : await startOptimizerService(config)
  if (service.status !== "running") {
    return {
      ok: false,
      status: 0,
      message: service.message ?? `GEPA service is not running at ${config.optimizerServiceUrl}`,
      service,
    }
  }

  const jsonMode = await servicePrefersJsonRuns(config.optimizerServiceUrl)
  const jsonRequest = jsonMode ? readLocalGepaServiceRequest(options.configPath) : undefined
  const container = jsonRequest ? await startLocalGepaContainer(config, options.configPath, jsonRequest) : undefined
  const requestBody: Record<string, unknown> = jsonRequest ? localGepaRequestBody(jsonRequest) : {
    config_path: options.configPath,
    ...(options.requestId ? { request_id: options.requestId } : {}),
    ...(options.metadata ? { metadata: options.metadata } : {}),
  }
  const result = await postJson(`${config.optimizerServiceUrl}/runs`, requestBody, {
    ...(options.requestId ? { "idempotency-key": options.requestId } : {}),
  })
  const payload = asRecord(result.data) ?? {}
  const run = readRun(payload) ?? readRun(asRecord(payload.run)) ?? readRun(asRecord(payload.request))
  await recordOptimizerLeverEvent(config, "lever.local_gepa.run.submit_requested", {
    ok: result.ok,
    status: result.status,
    message: result.message,
    config_path: options.configPath,
    request_id: options.requestId ?? null,
    run_id: run?.runId ?? readString(payload.run_id) ?? readString(payload.id) ?? null,
    submit_mode: jsonRequest ? "json" : "config_path",
    container_url: container?.url ?? null,
    container_pid: container?.pid ?? null,
  })
  return {
    ok: result.ok,
    status: result.status,
    message: result.ok ? `submitted local GEPA run${run?.runId ? ` ${run.runId}` : ""}` : result.message,
    service,
    ...(run ? { run } : {}),
    ...(container ? { container } : {}),
    response: payload,
  }
}

function localGepaRequestBody(request: LocalGepaServiceRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(request)) {
    if (key.startsWith("__")) continue
    body[key] = value
  }
  return body
}

async function servicePrefersJsonRuns(serviceUrl: string): Promise<boolean> {
  try {
    const runs = asRecord(await getJson(`${serviceUrl}/runs?limit=1`))
    if (Array.isArray(runs?.items)) return true
  } catch {
    // Older services may expose only /status and accept config_path submissions.
  }
  try {
    const workspace = asRecord(await getJson(`${serviceUrl}/workspace`))
    if (asRecord(workspace?.scheduler) || asRecord(workspace?.run_status)) return true
  } catch {
    // Keep config_path mode when workspace discovery is unavailable.
  }
  return false
}

type LocalGepaServiceRequest = {
  container_url: string
  output_dir?: string
  policy: Record<string, unknown>
  proposer: Record<string, unknown>
  taskset: Record<string, unknown>
  task_pools: Record<string, unknown>
  manual_step: boolean
  stop_conditions: Record<string, unknown>[]
  advanced: Record<string, unknown>
  __container_command?: string[]
  __container_cwd?: string
  __container_startup_timeout_seconds?: number
}

function readLocalGepaServiceRequest(configPath: string): LocalGepaServiceRequest {
  const config = Bun.TOML.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>
  const container = requiredRecord(config.container, "container")
  const run = optionalRecord(config.run)
  const policy = optionalRecord(config.policy)
  const proposer = optionalRecord(config.proposer)
  const taskset = optionalRecord(config.taskset)
  const gepa = optionalRecord(config.gepa)
  const pipeline = optionalRecord(gepa.pipeline)
  const taskPools = optionalRecord(gepa.task_pools)
  const trainIds = readStringArray(taskset.train_ids)
  const heldoutIds = readStringArray(taskset.heldout_ids)
  const maxTotalRollouts = readInteger(gepa.max_total_rollouts, 1)
  const maxCostUsd = readFiniteNumber(gepa.max_cost_usd, 0)
  const stopConditions: Record<string, unknown>[] = [
    {
      kind: "max_rollouts",
      n: maxTotalRollouts,
      train: readInteger(gepa.max_train_rollouts, maxTotalRollouts),
      heldout: readInteger(gepa.max_heldout_rollouts, 1),
    },
    { kind: "max_generations", n: readInteger(gepa.max_generations, 1) },
  ]
  if (maxCostUsd > 0) stopConditions.push({ kind: "max_cost_usd", value: maxCostUsd })

  const proposerAuthMode = readStringValue(proposer.auth_mode, "chatgpt")
  const request: LocalGepaServiceRequest = {
    container_url: readRequiredString(container.url, "container.url"),
    output_dir: readString(run?.output_dir),
    policy: stripUndefined({
      provider: readStringValue(policy.provider, "openai"),
      model: readStringValue(policy.model, "gemini-3.1-flash-lite"),
      api_family: readStringValue(policy.api_family, "chat_completions"),
      credentials: { resolver: "env", env_var: readStringValue(policy.api_key_env, "GEMINI_API_KEY") },
      base_url: readString(policy.base_url),
      inference_url: readString(policy.inference_url),
      disable_reasoning: readStringValue(policy.disable_reasoning, "auto"),
    }),
    proposer: stripUndefined({
      provider: readStringValue(proposer.provider, "openai"),
      model: readStringValue(proposer.model, "gpt-5.4-mini"),
      api_family: readStringValue(proposer.api_family, "chat_completions"),
      auth_mode: proposerAuthMode,
      credentials: { resolver: "env", env_var: readStringValue(proposer.api_key_env, "OPENAI_API_KEY") },
      copy_host_auth: readBoolean(proposer.copy_host_auth, proposerAuthMode === "chatgpt" || proposerAuthMode === "host"),
      codex_home: readString(proposer.codex_home),
      base_url: readString(proposer.base_url),
    }),
    taskset: {
      train_ids: trainIds,
      heldout_ids: heldoutIds,
    },
    task_pools: {
      pareto: readStringArray(taskPools.pareto, trainIds),
      minibatch: readStringArray(taskPools.minibatch, trainIds),
      reflection: readStringArray(taskPools.reflection, trainIds),
      heldout: readStringArray(taskPools.heldout, heldoutIds),
    },
    manual_step: false,
    stop_conditions: stopConditions,
    advanced: {
      pipeline: {
        mode: readStringValue(pipeline.mode, "sync_serial"),
        max_generations: readInteger(gepa.max_generations, 1),
        proposals_per_generation: readInteger(gepa.proposals_per_generation, 1),
        minibatch_size: readInteger(gepa.minibatch_size, 1),
        rollout_chunk_size: readInteger(gepa.rollout_chunk_size, readInteger(gepa.minibatch_size, 1)),
      },
      budgets: {
        max_train_rollouts: readInteger(gepa.max_train_rollouts, maxTotalRollouts),
        max_heldout_rollouts: readInteger(gepa.max_heldout_rollouts, heldoutIds.length || 1),
      },
      proposer_io: stripUndefined({
        timeout_seconds: readInteger(proposer.timeout_seconds, 300),
        codex_home: readString(proposer.codex_home),
      }),
      adaptive_rollout_concurrency: false,
    },
    __container_command: readStringArray(container.command),
    __container_cwd: readString(container.cwd),
    __container_startup_timeout_seconds: readInteger(container.startup_timeout_seconds, 120),
  }
  return stripUndefined(request) as LocalGepaServiceRequest
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  const record = optionalRecord(value)
  if (!record) throw new Error(`GEPA config missing [${label}]`)
  return record
}

function optionalRecord(value: unknown): Record<string, unknown> {
  return asRecord(value) ?? {}
}

function readRequiredString(value: unknown, label: string): string {
  const text = readString(value)
  if (!text) throw new Error(`GEPA config missing ${label}`)
  return text
}

function readStringValue(value: unknown, fallback: string): string {
  return readString(value) ?? fallback
}

function readStringArray(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback
  return value.map((item) => String(item))
}

function readInteger(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10)
  return Number.isFinite(number) ? Math.trunc(number) : fallback
}

function readFiniteNumber(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""))
  return Number.isFinite(number) ? number : fallback
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as T
  }
  if (value !== null && typeof value === "object") {
    const next: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) next[key] = stripUndefined(item)
    }
    return next as T
  }
  return value
}

function safeFileSegment(value: string): string {
  const segment = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  return segment || "gepa"
}

async function startLocalGepaContainer(
  config: StackConfig,
  configPath: string,
  request: LocalGepaServiceRequest,
): Promise<LocalGepaContainerLaunch> {
  const command = request.__container_command
  if (!command?.length) {
    throw new Error("GEPA JSON service mode requires [container].command in the TOML config")
  }
  mkdirSync(dirname(config.optimizerLogPath), { recursive: true })
  const segment = safeFileSegment(basename(configPath, ".toml"))
  const logPath = join(dirname(config.optimizerLogPath), `${segment}.container.log`)
  const logFd = openSync(logPath, "a")
  let child
  try {
    child = spawn(command[0] ?? "", command.slice(1), {
      cwd: request.__container_cwd,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: process.env,
    })
  } catch (error) {
    closeSync(logFd)
    throw error
  }
  const spawnError = await immediateSpawnError(child)
  closeSync(logFd)
  if (spawnError) throw spawnError
  child.unref()
  await waitForLocalGepaContainer(request.container_url, request.__container_startup_timeout_seconds ?? 120)
  return {
    url: request.container_url,
    pid: child.pid,
    logPath,
  }
}

async function waitForLocalGepaContainer(containerUrl: string, timeoutSeconds: number): Promise<void> {
  const deadline = Date.now() + timeoutSeconds * 1000
  let lastError = ""
  while (Date.now() < deadline) {
    try {
      await getJson(`${containerUrl.replace(/\/+$/, "")}/health`)
      await getJson(`${containerUrl.replace(/\/+$/, "")}/program`)
      return
    } catch (error) {
      lastError = errorMessage(error)
      await sleep(1000)
    }
  }
  throw new Error(`GEPA container is not ready at ${containerUrl}: ${lastError}`)
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

function immediateSpawnError(child: ReturnType<typeof spawn>): Promise<Error | undefined> {
  return new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      child.off("error", onError)
      child.off("spawn", onSpawn)
      resolve(error)
    }
    const onError = (error: Error) => finish(error)
    const onSpawn = () => finish()
    child.once("error", onError)
    child.once("spawn", onSpawn)
    timer = setTimeout(() => finish(), 50)
  })
}

async function recordOptimizerLeverEvent(
  config: StackConfig,
  eventType:
    | "lever.local_gepa.service.start_requested"
    | "lever.local_gepa.service.start_failed"
    | "lever.local_gepa.run.submit_requested",
  payload: Record<string, unknown>,
): Promise<void> {
  const subject = eventType === "lever.local_gepa.run.submit_requested"
    ? {
        kind: "local_gepa_run",
        id: String(payload.run_id ?? payload.request_id ?? payload.config_path ?? config.optimizerServiceUrl),
      }
    : {
        kind: "local_gepa_service",
        id: config.optimizerServiceUrl,
      }
  await stackdRuntimeAppendEvent({
    event_type: eventType,
    source: "lever.local_gepa",
    subject,
    payload: {
      service_url: config.optimizerServiceUrl,
      bind: config.optimizerBind,
      command: config.optimizerCommand,
      db_path: config.optimizerDbPath,
      log_path: config.optimizerLogPath,
      pid_path: config.optimizerPidPath,
      workspace_root: config.workspaceRoot,
      workers: config.optimizerWorkers,
      ...payload,
    },
  }).catch(() => undefined)
}

function readRuns(value: unknown): OptimizerRunSummary[] {
  const payload = asRecord(value) as RunsPayload | undefined
  const items = firstNonEmptyArray(payload?.items, payload?.runs, payload?.run_requests)
  return items.map(readRun).filter((run): run is OptimizerRunSummary => Boolean(run))
}

function firstNonEmptyArray(...values: unknown[]): unknown[] {
  const arrays = values.flatMap((value) => {
    if (Array.isArray(value)) return [value]
    const items = asRecord(value)?.items
    return Array.isArray(items) ? [items] : []
  })
  const fallback = arrays[0]
  return arrays.find((value) => value.length > 0) ?? fallback ?? []
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

async function postJson(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ ok: boolean; status: number; message: string; data?: unknown }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await response.text()
    let data: unknown
    try {
      data = text.trim() ? JSON.parse(text) : {}
    } catch {
      data = { text }
    }
    return {
      ok: response.ok,
      status: response.status,
      message: response.ok ? response.statusText || "ok" : `${response.status} ${response.statusText}: ${text.slice(0, 500)}`,
      data,
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      message: errorMessage(error),
    }
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
