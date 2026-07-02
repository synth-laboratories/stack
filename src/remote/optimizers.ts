import { spawn, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { basename, join, resolve } from "node:path"
import { environmentAuthStatus, type StackConfig } from "../config.js"

export type HostedOptimizerStatus = "ready" | "missing-auth" | "offline"

export type HostedOptimizerRunSummary = {
  runId: string
  projectId?: string
  algorithm: string
  status: string
  finalizeState?: string
  storageMode?: string
  cursorSeq?: number
  cancellationRequested?: boolean
  submittedAt?: string
  terminalAt?: string
  createdAt?: string
  updatedAt?: string
  error?: string
}

export type HostedOptimizerRunDetail = {
  runId: string
  status?: string
  backendUpdatedAt?: string
  resultKeys: string[]
  stateKeys: string[]
  artifactNames: string[]
  eventCount: number
  latestEventSeq?: number
  eventTypes: string[]
  message?: string
}

export type HostedOptimizerSnapshot = {
  status: HostedOptimizerStatus
  environmentName: string
  apiBaseUrl: string
  checkedAt: string
  message?: string
  runs: HostedOptimizerRunSummary[]
  runDetails: Record<string, HostedOptimizerRunDetail>
}

export type HostedOptimizerActionResult = {
  ok: boolean
  status: number
  message: string
  data?: Record<string, unknown>
}

export type HostedGepaTunnelProvider = "auto" | "synth_tunnel" | "cloudflared" | "ngrok"

export type HostedGepaSubmitOptions = {
  configPath: string
  runId?: string
  idempotencyKey?: string
  projectId?: string
  tunnelUrl?: string
  tunnelProvider?: HostedGepaTunnelProvider
  tunnelTtlSeconds?: number
  containerPool?: string
  containerTaskId?: string
  follow?: boolean
  timeoutSeconds?: number
}

export type HostedGepaSubmitResult = {
  ok: boolean
  status: number
  message: string
  environmentName: string
  apiBaseUrl: string
  command: string
  args: string[]
  runId?: string
  exitCode?: number
  signal?: string
  timedOut: boolean
  stdout: string
  stderr: string
  submittedAt: string
  finishedAt: string
}

type CommandInvocation = {
  command: string
  args: string[]
}

export type HostedOptimizerArtifactPreview = {
  environmentName: string
  runId: string
  artifactName: string
  contentType?: string
  bytes: number
  previewBytes: number
  truncated: boolean
  preview: string
  previewedAt: string
}

export type HostedOptimizerArtifactDownload = {
  environmentName: string
  runId: string
  artifactName: string
  contentType?: string
  outputPath: string
  filename: string
  bytes: number
  downloadedAt: string
}

export async function readHostedOptimizerSnapshot(config: StackConfig): Promise<HostedOptimizerSnapshot> {
  const auth = environmentAuthStatus(config.environment)
  const base: HostedOptimizerSnapshot = {
    status: auth.hasAuth ? "offline" : "missing-auth",
    environmentName: config.environmentName,
    apiBaseUrl: config.environment.apiBaseUrl,
    checkedAt: new Date().toISOString(),
    message: auth.hasAuth ? "not checked yet" : auth.message,
    runs: [],
    runDetails: {},
  }

  if (!auth.hasAuth) return base

  try {
    const payload = await getJson(config, "/api/v1/optimizers/runs?limit=12")
    const runs = readRuns(payload)
    return {
      ...base,
      status: "ready",
      checkedAt: new Date().toISOString(),
      message: "hosted optimizers reachable",
      runs,
      runDetails: await readRunDetails(config, runs.slice(0, 4)),
    }
  } catch (error) {
    return {
      ...base,
      status: "offline",
      checkedAt: new Date().toISOString(),
      message: errorMessage(error),
    }
  }
}

export async function submitHostedGepaRun(
  config: StackConfig,
  options: HostedGepaSubmitOptions,
): Promise<HostedGepaSubmitResult> {
  const auth = environmentAuthStatus(config.environment)
  const submittedAt = new Date().toISOString()
  const follow = options.follow ?? Boolean(options.tunnelUrl)
  const args = [
    "gepa",
    "submit",
    "--config",
    options.configPath,
    "--base-url",
    config.environment.apiBaseUrl,
    "--api-key-env",
    config.environment.authEnv,
    "--json",
  ]

  if (!auth.hasAuth) {
    return {
      ok: false,
      status: 0,
      message: auth.message,
      environmentName: config.environmentName,
      apiBaseUrl: config.environment.apiBaseUrl,
      command: config.optimizerCommand,
      args,
      timedOut: false,
      stdout: "",
      stderr: "",
      submittedAt,
      finishedAt: new Date().toISOString(),
    }
  }

  if (options.runId) args.push("--run-id", options.runId)
  if (options.idempotencyKey) args.push("--idempotency-key", options.idempotencyKey)
  if (options.projectId) args.push("--project-id", options.projectId)
  if (options.tunnelUrl) {
    args.push("--tunnel-url", options.tunnelUrl)
    args.push("--tunnel-provider", options.tunnelProvider ?? "synth_tunnel")
    if (options.tunnelTtlSeconds) args.push("--tunnel-ttl-seconds", String(options.tunnelTtlSeconds))
  }
  if (options.containerPool) args.push("--container-pool", options.containerPool)
  if (options.containerTaskId) args.push("--container-task-id", options.containerTaskId)
  if (follow) args.push("--follow")

  const invocation = hostedGepaCommandInvocation(config, args)

  const timeoutSeconds = clampInteger(options.timeoutSeconds, follow ? 3600 : 300, 30, 86400)
  const result = await runCommandTail(invocation.command, invocation.args, {
    cwd: config.workspaceRoot,
    timeoutMs: timeoutSeconds * 1000,
  })
  const combined = `${result.stdout}\n${result.stderr}`
  const runId = readSubmittedRunId(combined)
  const stdout = redactHostedOptimizerText(result.stdout)
  const stderr = redactHostedOptimizerText(result.stderr)
  const ok = result.exitCode === 0 && !result.timedOut
  const message = ok
    ? `submitted hosted GEPA${runId ? ` run ${runId}` : ""}`
    : result.timedOut
      ? `hosted GEPA submit timed out after ${timeoutSeconds}s`
      : stderr.trim().split(/\r?\n/).find((line) => line.trim().length > 0) ??
        `hosted GEPA submit exited ${result.exitCode ?? "unknown"}`

  return {
    ok,
    status: result.exitCode ?? 0,
    message,
    environmentName: config.environmentName,
    apiBaseUrl: config.environment.apiBaseUrl,
    command: invocation.command,
    args: invocation.args,
    ...(runId ? { runId } : {}),
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    stdout,
    stderr,
    submittedAt,
    finishedAt: new Date().toISOString(),
  }
}

function hostedGepaCommandInvocation(config: StackConfig, args: string[]): CommandInvocation {
  if (config.optimizerCommand !== "synth-optimizers" || commandSupportsHostedSubmit(config.optimizerCommand)) {
    return { command: config.optimizerCommand, args }
  }
  const optimizersRoot = resolveOptimizersRoot(config)
  if (!optimizersRoot) return { command: config.optimizerCommand, args }
  return {
    command: "uv",
    args: ["run", "--project", optimizersRoot, "synth-optimizers", ...args],
  }
}

function commandSupportsHostedSubmit(command: string): boolean {
  const result = spawnSync(command, ["gepa", "submit", "--help"], {
    encoding: "utf8",
    timeout: 2500,
  })
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
  return result.status === 0 || output.includes("--tunnel-url")
}

function resolveOptimizersRoot(config: StackConfig): string | undefined {
  const candidates = [
    process.env.STACK_SYNTH_OPTIMIZERS_ROOT,
    join(config.workspaceRoot, "optimizers"),
    resolve(config.appRoot, "..", "optimizers"),
    resolve(config.appRoot, "..", "..", "optimizers"),
  ].filter((candidate): candidate is string => Boolean(candidate))
  return candidates.find((candidate) => existsSync(join(candidate, "pyproject.toml")))
}

export async function cancelHostedOptimizerRun(
  config: StackConfig,
  run: HostedOptimizerRunSummary,
): Promise<HostedOptimizerActionResult> {
  const result = await postJson(config, `/api/v1/optimizers/runs/${encodeURIComponent(run.runId)}/cancel`)
  return {
    ok: result.ok,
    status: result.status,
    message: result.ok ? `cancel requested for ${run.runId}` : result.message,
  }
}

export async function previewHostedOptimizerArtifact(
  config: StackConfig,
  run: HostedOptimizerRunSummary,
  artifactName: string,
  maxBytes = 8192,
): Promise<HostedOptimizerActionResult> {
  const maxPreviewBytes = Math.max(1, Math.min(Math.floor(maxBytes), 64 * 1024))
  const result = await getBytes(
    config,
    `/api/v1/optimizers/runs/${encodeURIComponent(run.runId)}/artifacts/${encodeURIComponent(artifactName)}`,
    { rangeBytes: maxPreviewBytes },
  )
  if (!result.ok) return result
  const bytes = result.bytes ?? Buffer.alloc(0)
  const previewBytes = Math.min(bytes.length, maxPreviewBytes)
  const payload: HostedOptimizerArtifactPreview = {
    environmentName: config.environmentName,
    runId: run.runId,
    artifactName,
    ...(result.contentType ? { contentType: result.contentType } : {}),
    bytes: bytes.length,
    previewBytes,
    truncated: bytes.length > previewBytes,
    preview: bytes.subarray(0, previewBytes).toString("utf8"),
    previewedAt: new Date().toISOString(),
  }
  return {
    ok: true,
    status: result.status,
    message: `previewed ${previewBytes}${payload.truncated ? `/${bytes.length}` : ""} bytes from hosted artifact ${artifactName}`,
    data: payload,
  }
}

export async function downloadHostedOptimizerArtifact(
  config: StackConfig,
  run: HostedOptimizerRunSummary,
  artifactName: string,
): Promise<HostedOptimizerActionResult> {
  const result = await getBytes(
    config,
    `/api/v1/optimizers/runs/${encodeURIComponent(run.runId)}/artifacts/${encodeURIComponent(artifactName)}`,
  )
  if (!result.ok) return result
  const bytes = result.bytes ?? Buffer.alloc(0)
  const directory = join(config.appRoot, ".stack", "downloads", config.environmentName, safePathSegment(run.runId))
  const filename = basename(artifactName) || "artifact"
  const outputPath = join(directory, `hosted-optimizer-${safePathSegment(filename)}`)
  await mkdir(directory, { recursive: true })
  await writeFile(outputPath, bytes)
  const payload: HostedOptimizerArtifactDownload = {
    environmentName: config.environmentName,
    runId: run.runId,
    artifactName,
    ...(result.contentType ? { contentType: result.contentType } : {}),
    outputPath,
    filename,
    bytes: bytes.length,
    downloadedAt: new Date().toISOString(),
  }
  return {
    ok: true,
    status: result.status,
    message: `saved ${bytes.length} bytes to ${outputPath}`,
    data: payload,
  }
}

async function readRunDetails(
  config: StackConfig,
  runs: HostedOptimizerRunSummary[],
): Promise<Record<string, HostedOptimizerRunDetail>> {
  const entries = await Promise.all(runs.map((run) => readRunDetail(config, run)))
  return Object.fromEntries(entries.map((detail) => [detail.runId, detail]))
}

async function readRunDetail(
  config: StackConfig,
  run: HostedOptimizerRunSummary,
): Promise<HostedOptimizerRunDetail> {
  const [runResult, stateResult, eventsResult] = await Promise.allSettled([
    getJson(config, `/api/v1/optimizers/runs/${encodeURIComponent(run.runId)}`),
    getJson(config, `/api/v1/optimizers/runs/${encodeURIComponent(run.runId)}/state`),
    getText(config, `/api/v1/optimizers/runs/${encodeURIComponent(run.runId)}/events?stream=false&limit=20`),
  ])
  const payload = runResult.status === "fulfilled" ? asRecord(runResult.value) : undefined
  const statePayload = stateResult.status === "fulfilled" ? asRecord(stateResult.value) : undefined
  const events = eventsResult.status === "fulfilled" ? readEvents(eventsResult.value) : []
  const backendProjection = asRecord(payload?.backend_projection)
  const resultPayload = asRecord(payload?.result)
  const messages = [
    runResult.status === "rejected" ? `run: ${errorMessage(runResult.reason)}` : "",
    stateResult.status === "rejected" ? `state: ${errorMessage(stateResult.reason)}` : "",
    eventsResult.status === "rejected" ? `events: ${errorMessage(eventsResult.reason)}` : "",
  ].filter((message) => message.length > 0)

  return {
    runId: run.runId,
    status: readString(payload?.status) ?? run.status,
    backendUpdatedAt: readString(backendProjection?.updated_at) ?? run.updatedAt,
    resultKeys: resultPayload ? Object.keys(resultPayload).slice(0, 5) : [],
    stateKeys: statePayload ? Object.keys(statePayload).slice(0, 5) : [],
    artifactNames: readArtifactNames(payload),
    eventCount: events.length,
    latestEventSeq: latestEventSeq(events),
    eventTypes: events.map((event) => event.eventType).filter((type): type is string => Boolean(type)).slice(-5),
    message: messages.length ? messages.join("; ") : undefined,
  }
}

function readRuns(value: unknown): HostedOptimizerRunSummary[] {
  return asArray(value)
    .map((item): HostedOptimizerRunSummary | undefined => {
      const run = asRecord(item)
      const runId = readString(run?.run_id) ?? readString(run?.id)
      if (!run || !runId) return undefined
      return {
        runId,
        projectId: readString(run.project_id),
        algorithm: readString(run.algorithm) ?? "unknown",
        status: readString(run.status) ?? "unknown",
        finalizeState: readString(run.finalize_state),
        storageMode: readString(run.storage_mode),
        cursorSeq: readNumber(run.cursor_seq),
        cancellationRequested: readBoolean(run.cancellation_requested),
        submittedAt: readString(run.submitted_at),
        terminalAt: readString(run.terminal_at),
        createdAt: readString(run.created_at),
        updatedAt: readString(run.updated_at),
        error: readString(run.error),
      }
    })
    .filter((run): run is HostedOptimizerRunSummary => Boolean(run))
}

function readArtifactNames(payload: Record<string, unknown> | undefined): string[] {
  const handles = asRecord(payload?.artifact_handles)
  if (handles) return Object.keys(handles).slice(0, 5)
  const artifacts = asArray(payload?.artifacts)
  return artifacts
    .map((item) => {
      const artifact = asRecord(item)
      return readString(artifact?.artifact_name) ?? readString(artifact?.name)
    })
    .filter((name): name is string => Boolean(name))
    .slice(0, 5)
}

function readEvents(text: string): { seq?: number; eventType?: string }[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        const payload = asRecord(JSON.parse(line) as unknown)
        return {
          seq: readNumber(payload?.seq),
          eventType: readString(payload?.event_type),
        }
      } catch {
        return {}
      }
    })
}

function latestEventSeq(events: { seq?: number }[]): number | undefined {
  return events.reduce<number | undefined>((latest, event) => {
    if (event.seq === undefined) return latest
    return latest === undefined ? event.seq : Math.max(latest, event.seq)
  }, undefined)
}

async function getJson(config: StackConfig, path: string): Promise<unknown> {
  return JSON.parse(await getText(config, path)) as unknown
}

async function getText(config: StackConfig, path: string): Promise<string> {
  const token = process.env[config.environment.authEnv]
  if (!token) throw new Error(environmentAuthStatus(config.environment).message)
  const response = await fetch(`${config.environment.apiBaseUrl.replace(/\/+$/, "")}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return await response.text()
}

async function getBytes(
  config: StackConfig,
  path: string,
  options: { rangeBytes?: number } = {},
): Promise<HostedOptimizerActionResult & { bytes?: Buffer; contentType?: string }> {
  const token = process.env[config.environment.authEnv]
  if (!token) return { ok: false, status: 0, message: environmentAuthStatus(config.environment).message }
  try {
    const response = await fetch(`${config.environment.apiBaseUrl.replace(/\/+$/, "")}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "*/*",
        ...(options.rangeBytes ? { Range: `bytes=0-${options.rangeBytes - 1}` } : {}),
      },
      signal: AbortSignal.timeout(15000),
    })
    const bytes = Buffer.from(await response.arrayBuffer())
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        message: bytes.toString("utf8").slice(0, 160) || response.statusText,
      }
    }
    return {
      ok: true,
      status: response.status,
      message: "ok",
      bytes,
      contentType: response.headers.get("content-type") ?? undefined,
    }
  } catch (error) {
    return { ok: false, status: 0, message: errorMessage(error) }
  }
}

async function postJson(config: StackConfig, path: string): Promise<HostedOptimizerActionResult> {
  const token = process.env[config.environment.authEnv]
  if (!token) {
    return { ok: false, status: 0, message: environmentAuthStatus(config.environment).message }
  }
  try {
    const response = await fetch(`${config.environment.apiBaseUrl.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    })
    const text = await response.text()
    return {
      ok: response.ok,
      status: response.status,
      message: response.ok ? "ok" : text || response.statusText,
    }
  } catch (error) {
    return { ok: false, status: 0, message: errorMessage(error) }
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
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

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(Math.floor(value), max))
}

function readSubmittedRunId(text: string): string | undefined {
  const submitted = /submitted run_id=([A-Za-z0-9._:-]+)/.exec(text)
  if (submitted?.[1]) return submitted[1]
  const jsonStyle = /["']run_id["']\s*:\s*["']([^"']+)["']/.exec(text)
  if (jsonStyle?.[1]) return jsonStyle[1]
  const loose = /\brun_id[=\s:]+([A-Za-z0-9._:-]+)/.exec(text)
  return loose?.[1]
}

function redactHostedOptimizerText(value: string): string {
  let redacted = value.replace(
    /https?:\/\/[^\s"']*(?:AWSAccessKeyId|X-Amz-Credential|X-Amz-Signature|Signature)=[^\s"']*/g,
    "<signed-url-redacted>",
  )
  for (const field of ["account_id", "account_email", "account_label", "registered_account_id", "registered_account_label"]) {
    redacted = redacted.replace(new RegExp(`("${field}"\\s*:\\s*)"[^"]*"`, "g"), `$1"<redacted>"`)
  }
  redacted = redacted.replace(/("active_actor_claim_refs"\s*:\s*)\[[^\]]*\]/g, `$1[]`)
  redacted = redacted.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<email-redacted>")
  return redacted
}

function runCommandTail(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number },
): Promise<{ exitCode?: number; signal?: string; timedOut: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = ""
    let stderr = ""
    let timedOut = false
    let settled = false
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
    }, options.timeoutMs)

    const settle = (result: { exitCode?: number; signal?: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        ...result,
        timedOut,
        stdout,
        stderr,
      })
    }

    child.stdout?.on("data", (chunk) => {
      stdout = appendTail(stdout, String(chunk))
    })
    child.stderr?.on("data", (chunk) => {
      stderr = appendTail(stderr, String(chunk))
    })
    child.on("error", (error) => {
      stderr = appendTail(stderr, errorMessage(error))
      settle({})
    })
    child.on("close", (code, signal) => {
      settle({
        exitCode: code ?? undefined,
        signal: signal ?? undefined,
      })
    })
  })
}

function appendTail(current: string, chunk: string, maxChars = 64 * 1024): string {
  const next = `${current}${chunk}`
  return next.length <= maxChars ? next : next.slice(next.length - maxChars)
}

function safePathSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  return cleaned || "artifact"
}
