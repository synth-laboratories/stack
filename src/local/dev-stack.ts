import { spawn, spawnSync } from "node:child_process"
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"
import type { StackConfig } from "../config.js"

export type DevApiBootstrapStatus = "ready" | "offline" | "starting" | "skipped" | "error"

export type LocalBootstrapSnapshot = {
  dockerAvailable: boolean
  dockerMessage?: string
  devApiStatus: DevApiBootstrapStatus
  devSlotInstance: string
  devSlotLogPath: string
  devSlotStartedAt?: string
  message?: string
  checkedAt: string
}

type DevSlotLaunchRecord = {
  startedAt: string
  instance: string
  pid?: number
  logPath: string
}

const DEV_SLOT_START_TIMEOUT_MS = 15 * 60 * 1000

export function bootstrapDir(config: StackConfig): string {
  return join(config.appRoot, ".stack", "bootstrap")
}

export function devSlotLogPath(config: StackConfig): string {
  return join(bootstrapDir(config), "dev-slot.log")
}

export function devSlotRecordPath(config: StackConfig): string {
  return join(bootstrapDir(config), "dev-slot.json")
}

export function isDockerAvailable(): { ok: boolean; message?: string } {
  try {
    const result = spawnSync("docker", ["info"], { encoding: "utf8", timeout: 4000 })
    if (result.status === 0) return { ok: true }
    const detail = `${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim()
    return { ok: false, message: detail ? oneLine(detail, 120) : "docker info failed" }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

export function shouldAutoStartDevSlot(config: StackConfig): boolean {
  if (config.environmentName !== "dev") return false
  const master = process.env.STACK_AUTO_START?.trim().toLowerCase()
  if (master === "0" || master === "false" || master === "no") return false
  const flag = process.env.STACK_AUTO_START_DEV_SLOT?.trim().toLowerCase()
  if (flag === "0" || flag === "false" || flag === "no") return false
  if (flag === "1" || flag === "true" || flag === "yes") return true
  return config.environmentName === "dev"
}

export async function probeDevApiReachable(config: StackConfig): Promise<boolean> {
  if (config.environmentName !== "dev") return false
  const base = config.environment.apiBaseUrl.replace(/\/+$/, "")
  const token = process.env[config.environment.authEnv]?.trim()
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  try {
    const response = await fetch(`${base}/smr/projects?limit=1`, {
      headers,
      signal: AbortSignal.timeout(3000),
    })
    return response.status > 0 && response.status < 500
  } catch {
    return false
  }
}

export function readDevSlotLaunchRecord(config: StackConfig): DevSlotLaunchRecord | undefined {
  const path = devSlotRecordPath(config)
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as DevSlotLaunchRecord
    if (!parsed.startedAt || !parsed.instance) return undefined
    return parsed
  } catch {
    return undefined
  }
}

export function writeDevSlotLaunchRecord(config: StackConfig, record: DevSlotLaunchRecord): void {
  mkdirSync(bootstrapDir(config), { recursive: true })
  writeFileSync(devSlotRecordPath(config), `${JSON.stringify(record, null, 2)}\n`, "utf8")
}

export function startDevSlotInBackground(config: StackConfig): { ok: boolean; message?: string } {
  if (!config.synthDevRoot) {
    return { ok: false, message: "synth dev stack not configured; set STACK_SYNTH_DEV_ROOT or config synthDevRoot" }
  }
  const scriptPath = join(config.synthDevRoot, "scripts", "local.sh")
  if (!existsSync(scriptPath)) {
    return { ok: false, message: `missing ${scriptPath}` }
  }

  const logPath = devSlotLogPath(config)
  const instance = config.devSlotInstance
  const existing = readDevSlotLaunchRecord(config)
  if (existing && isRecentLaunch(existing.startedAt) && existing.instance === instance) {
    return { ok: true, message: "dev slot launch already in progress" }
  }

  mkdirSync(dirname(logPath), { recursive: true })
  const logFd = openSync(logPath, "a")
  try {
    const child = spawn("./scripts/local.sh", ["up", instance], {
      cwd: config.synthDevRoot,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: process.env,
    })
    child.unref()
    writeDevSlotLaunchRecord(config, {
      startedAt: new Date().toISOString(),
      instance,
      pid: child.pid,
      logPath,
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  } finally {
    closeSync(logFd)
  }
}

export function emptyLocalBootstrapSnapshot(config: StackConfig): LocalBootstrapSnapshot {
  return {
    dockerAvailable: false,
    devApiStatus: config.environmentName === "dev" ? "offline" : "skipped",
    devSlotInstance: config.devSlotInstance,
    devSlotLogPath: devSlotLogPath(config),
    checkedAt: new Date().toISOString(),
  }
}

export async function refreshLocalBootstrapSnapshot(
  config: StackConfig,
  previous?: LocalBootstrapSnapshot,
): Promise<LocalBootstrapSnapshot> {
  const checkedAt = new Date().toISOString()
  const docker = isDockerAvailable()
  const base = emptyLocalBootstrapSnapshot(config)
  base.dockerAvailable = docker.ok
  base.dockerMessage = docker.message
  base.checkedAt = checkedAt

  if (config.environmentName !== "dev") {
    base.devApiStatus = "skipped"
    base.message = "dev slot auto-start only applies to dev environment"
    return base
  }

  const apiUp = await probeDevApiReachable(config)
  if (apiUp) {
    base.devApiStatus = "ready"
    base.message = "dev API reachable"
    return base
  }

  const launch = readDevSlotLaunchRecord(config)
  if (launch && isRecentLaunch(launch.startedAt)) {
    base.devApiStatus = "starting"
    base.devSlotStartedAt = launch.startedAt
    base.message = `starting slot ${launch.instance} — log ${launch.logPath}`
    return base
  }

  if (launch && !isRecentLaunch(launch.startedAt)) {
    base.devApiStatus = "error"
    base.devSlotStartedAt = launch.startedAt
    base.message = `dev API still offline — check ${launch.logPath}`
    return base
  }

  base.devApiStatus = previous?.devApiStatus === "starting" ? "error" : "offline"
  base.message =
    base.devApiStatus === "error"
      ? `dev slot start did not become ready — check ${base.devSlotLogPath}`
      : "dev API offline"
  return base
}

export async function ensureDevStackBootstrap(config: StackConfig): Promise<LocalBootstrapSnapshot> {
  let snapshot = await refreshLocalBootstrapSnapshot(config)
  if (!shouldAutoStartDevSlot(config)) return snapshot
  if (snapshot.devApiStatus === "ready" || snapshot.devApiStatus === "skipped") return snapshot
  if (snapshot.devApiStatus === "starting") return snapshot

  if (!snapshot.dockerAvailable) {
    snapshot.devApiStatus = "error"
    snapshot.message = snapshot.dockerMessage ?? "docker unavailable — start OrbStack/Docker Desktop"
    snapshot.checkedAt = new Date().toISOString()
    return snapshot
  }

  const started = startDevSlotInBackground(config)
  snapshot = await refreshLocalBootstrapSnapshot(config)
  if (!started.ok) {
    snapshot.devApiStatus = "error"
    snapshot.message = started.message ?? "failed to start dev slot"
  } else if (snapshot.devApiStatus === "offline") {
    snapshot.devApiStatus = "starting"
    snapshot.message = `starting slot ${snapshot.devSlotInstance} — log ${snapshot.devSlotLogPath}`
  }
  snapshot.checkedAt = new Date().toISOString()
  return snapshot
}

function isRecentLaunch(startedAt: string): boolean {
  const startedMs = Date.parse(startedAt)
  if (!Number.isFinite(startedMs)) return false
  return Date.now() - startedMs < DEV_SLOT_START_TIMEOUT_MS
}

function oneLine(value: string, max: number): string {
  const compact = value.replace(/\s+/g, " ").trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, max - 1)}…`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
