import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { StackConfig } from "../config.js"

export type StackEvalLaunchStatus = "idle" | "starting" | "running" | "completed" | "failed" | "stale"

export type StackEvalLaunch = {
  status: StackEvalLaunchStatus
  command: string
  args: string[]
  suite: string
  target: string
  instance: string
  environmentName?: string
  statePath?: string
  lastUpdatedAt?: string
  startedAt?: string
  finishedAt?: string
  pid?: number
  exitCode?: number | null
  signal?: string | null
  message?: string
  runId?: string
  projectId?: string
  outputRoot?: string
  runlog?: string
  phaseLog?: string
  smrState?: string
  verificationState?: string
  verificationFailures?: string[]
  reward?: number
  gradeCost?: number
  actualCostCents?: number
  failureLines?: string[]
  outputTail: string[]
}

export function idleEvalLaunch(config: StackConfig): StackEvalLaunch {
  return {
    status: "idle",
    command: config.evalCommand,
    args: readmeSmokeArgs(config),
    suite: config.readmeSmokeSuite,
    target: config.readmeSmokeTarget,
    instance: config.readmeSmokeInstance,
    environmentName: config.environmentName,
    statePath: readmeSmokeStatePath(config),
    outputTail: [],
  }
}

export function readReadmeSmokeEvalLaunch(config: StackConfig): StackEvalLaunch {
  const path = readmeSmokeStatePath(config)
  if (!existsSync(path)) return idleEvalLaunch(config)
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<StackEvalLaunch>
    const snapshot = normalizeEvalLaunch(config, parsed)
    return refreshPersistedEvalLaunch(config, snapshot)
  } catch (error) {
    return {
      ...idleEvalLaunch(config),
      status: "failed",
      message: `readme smoke state read failed: ${errorMessage(error)}`,
    }
  }
}

export function startReadmeSmokeEval(
  config: StackConfig,
  current: StackEvalLaunch,
  onUpdate: (snapshot: StackEvalLaunch) => void,
): StackEvalLaunch {
  const latest = refreshPersistedEvalLaunch(config, current)
  if (latest.status === "starting" || latest.status === "running") {
    return {
      ...latest,
      message: `readme smoke already ${latest.status}`,
    }
  }

  const args = readmeSmokeArgs(config)
  let snapshot: StackEvalLaunch = {
    status: "starting",
    command: config.evalCommand,
    args,
    suite: config.readmeSmokeSuite,
    target: config.readmeSmokeTarget,
    instance: config.readmeSmokeInstance,
    environmentName: config.environmentName,
    statePath: readmeSmokeStatePath(config),
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    message: "starting readme smoke eval",
    outputTail: [],
  }

  try {
    writeReadmeSmokeEvalLaunch(config, snapshot)
    const child = spawn(config.evalCommand, args, {
      cwd: dirname(config.evalCommand),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    snapshot = {
      ...snapshot,
      status: "running",
      pid: child.pid,
      lastUpdatedAt: new Date().toISOString(),
      message: child.pid ? `readme smoke running pid ${child.pid}` : "readme smoke running",
    }
    writeReadmeSmokeEvalLaunch(config, snapshot)

    child.stdout.on("data", (chunk: Buffer) => {
      snapshot = appendOutput(snapshot, chunk.toString("utf8"))
      persistUpdatedSnapshot(config, snapshot)
      onUpdate(snapshot)
    })
    child.stderr.on("data", (chunk: Buffer) => {
      snapshot = appendOutput(snapshot, chunk.toString("utf8"))
      persistUpdatedSnapshot(config, snapshot)
      onUpdate(snapshot)
    })
    child.on("error", (error) => {
      snapshot = {
        ...snapshot,
        status: "failed",
        finishedAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        message: error.message,
      }
      persistUpdatedSnapshot(config, snapshot)
      onUpdate(snapshot)
    })
    child.on("close", (exitCode, signal) => {
      snapshot = {
        ...snapshot,
        status: exitCode === 0 ? "completed" : "failed",
        finishedAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        exitCode,
        signal,
        message: exitCode === 0 ? "readme smoke completed" : `readme smoke failed exit ${exitCode ?? signal ?? "-"}`,
      }
      persistUpdatedSnapshot(config, snapshot)
      onUpdate(snapshot)
    })
  } catch (error) {
    snapshot = {
      ...snapshot,
      status: "failed",
      finishedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
    }
    persistUpdatedSnapshot(config, snapshot)
  }

  return snapshot
}

export function isEvalLaunchActive(launch: StackEvalLaunch): boolean {
  return launch.status === "starting" || launch.status === "running"
}

function readmeSmokeArgs(config: StackConfig): string[] {
  return [
    "run",
    config.readmeSmokeSuite,
    "--target",
    config.readmeSmokeTarget,
    "--instance",
    config.readmeSmokeInstance,
  ]
}

function readmeSmokeStatePath(config: StackConfig): string {
  return join(config.appRoot, ".stack", "evals", `readme-smoke-${config.environmentName}.json`)
}

function normalizeEvalLaunch(config: StackConfig, value: Partial<StackEvalLaunch>): StackEvalLaunch {
  const fallback = idleEvalLaunch(config)
  const outputTail = Array.isArray(value.outputTail)
    ? value.outputTail.filter((line): line is string => typeof line === "string").slice(-12)
    : []
  const failureLines = Array.isArray(value.failureLines)
    ? value.failureLines.filter((line): line is string => typeof line === "string").slice(-6)
    : []
  return {
    ...fallback,
    ...value,
    status: readEvalStatus(value.status) ?? fallback.status,
    command: typeof value.command === "string" ? value.command : fallback.command,
    args: Array.isArray(value.args) ? value.args.filter((item): item is string => typeof item === "string") : fallback.args,
    suite: typeof value.suite === "string" ? value.suite : fallback.suite,
    target: typeof value.target === "string" ? value.target : fallback.target,
    instance: typeof value.instance === "string" ? value.instance : fallback.instance,
    environmentName: config.environmentName,
    statePath: readmeSmokeStatePath(config),
    outputTail,
    failureLines,
  }
}

function refreshPersistedEvalLaunch(config: StackConfig, snapshot: StackEvalLaunch): StackEvalLaunch {
  if (!isEvalLaunchActive(snapshot)) return snapshot
  if (snapshot.pid === undefined || processIsAlive(snapshot.pid)) return snapshot
  const staleSnapshot: StackEvalLaunch = {
    ...snapshot,
    status: "stale",
    finishedAt: snapshot.finishedAt ?? new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    message: "readme smoke process is no longer running; final wrapper status was not captured",
  }
  persistUpdatedSnapshot(config, staleSnapshot)
  return staleSnapshot
}

function writeReadmeSmokeEvalLaunch(config: StackConfig, snapshot: StackEvalLaunch): void {
  const path = readmeSmokeStatePath(config)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ ...snapshot, statePath: path }, null, 2)}\n`, "utf8")
}

function persistUpdatedSnapshot(config: StackConfig, snapshot: StackEvalLaunch): void {
  try {
    writeReadmeSmokeEvalLaunch(config, snapshot)
  } catch (error) {
    snapshot.message = `readme smoke state write failed: ${errorMessage(error)}`
    snapshot.lastUpdatedAt = new Date().toISOString()
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : ""
    return code === "EPERM"
  }
}

function readEvalStatus(value: unknown): StackEvalLaunchStatus | undefined {
  if (
    value === "idle" ||
    value === "starting" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "stale"
  ) {
    return value
  }
  return undefined
}

function appendOutput(snapshot: StackEvalLaunch, chunk: string): StackEvalLaunch {
  const lines = chunk
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (lines.length === 0) return snapshot
  const enriched = lines.reduce((current, line) => enrichSnapshotFromLine(current, line), snapshot)
  const failureLines = appendFailureLines(enriched.failureLines ?? [], lines)
  return {
    ...enriched,
    lastUpdatedAt: new Date().toISOString(),
    outputTail: [...enriched.outputTail, ...lines].slice(-12),
    ...(failureLines.length ? { failureLines } : {}),
    message: lines[lines.length - 1],
  }
}

function enrichSnapshotFromLine(snapshot: StackEvalLaunch, line: string): StackEvalLaunch {
  return {
    ...snapshot,
    runId: readFirstGroup(line, /\brun_id=([0-9a-f-]{20,})\b/i) ?? snapshot.runId,
    projectId: readFirstGroup(line, /\bproject_id=([0-9a-f-]{20,})\b/i) ?? snapshot.projectId,
    outputRoot: readDelimitedValue(line, "output_root") ?? snapshot.outputRoot,
    runlog: readDelimitedValue(line, "runlog") ?? snapshot.runlog,
    phaseLog: readDelimitedValue(line, "phase_log") ?? snapshot.phaseLog,
    smrState: readFirstGroup(line, /\bstate=([a-z_][a-z0-9_-]*)\b/i) ?? snapshot.smrState,
    verificationState: readFirstGroup(line, /\bverification_state=([a-z_][a-z0-9_-]*)\b/i) ?? snapshot.verificationState,
    verificationFailures: readListValue(line, "verification_failures") ?? snapshot.verificationFailures,
    reward: readNumericValue(line, "reward") ?? snapshot.reward,
    gradeCost: readNumericValue(line, "cost") ?? snapshot.gradeCost,
    actualCostCents: readNumericValue(line, "run_total_actual_cost_cents") ?? snapshot.actualCostCents,
  }
}

function readDelimitedValue(line: string, key: string): string | undefined {
  const pattern = new RegExp(`\\b${escapeRegex(key)}=([^;|]+)`)
  return readFirstGroup(line, pattern)?.trim()
}

function readListValue(line: string, key: string): string[] | undefined {
  const raw = readDelimitedValue(line, key)
  if (!raw) return undefined
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

function readNumericValue(line: string, key: string): number | undefined {
  const raw = readFirstGroup(line, new RegExp(`\\b${escapeRegex(key)}=([0-9]+(?:\\.[0-9]+)?)`))
  if (!raw) return undefined
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) ? value : undefined
}

function readFirstGroup(line: string, pattern: RegExp): string | undefined {
  return pattern.exec(line)?.[1]
}

function appendFailureLines(current: string[], lines: string[]): string[] {
  const failures = lines.filter(isFailureLine)
  if (failures.length === 0) return current
  return [...current, ...failures].slice(-6)
}

function isFailureLine(line: string): boolean {
  const normalized = line.toLowerCase()
  return (
    normalized.includes("failed") ||
    normalized.includes("failure") ||
    normalized.includes("error") ||
    normalized.includes("exception") ||
    normalized.includes("traceback") ||
    normalized.includes("verification_failures") ||
    normalized.includes("resolved_host_kind")
  )
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
