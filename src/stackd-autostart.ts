import { spawn } from "node:child_process"
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs"
import { join } from "node:path"
import { DEFAULT_STACK_API_URL } from "./client/stackd.js"
import type { StackConfig } from "./config.js"

export type StackdAutostartResult = {
  baseUrl: string
  healthy: boolean
  started: boolean
  skippedReason?: string
  logPath?: string
}

const STACKD_STARTUP_ATTEMPTS = 20
const STACKD_STARTUP_DELAY_MS = 500

export async function ensureStackdAutostart(config: StackConfig): Promise<StackdAutostartResult> {
  const baseUrl = normalizeStackdBaseUrl(process.env.STACK_API_URL || DEFAULT_STACK_API_URL)
  process.env.STACK_API_URL = baseUrl

  if (process.env.STACKD_AUTOSTART === "0") {
    return { baseUrl, healthy: await stackdHealthOk(baseUrl), started: false, skippedReason: "disabled" }
  }
  if (await stackdHealthOk(baseUrl)) {
    return { baseUrl, healthy: true, started: false }
  }

  const listen = parseLocalStackdUrl(baseUrl)
  if (!listen) {
    return { baseUrl, healthy: false, started: false, skippedReason: "non-local-url" }
  }

  const launcher = resolveStackdLauncher(config.appRoot)
  if (!launcher) {
    return { baseUrl, healthy: false, started: false, skippedReason: "missing-stackd-launcher" }
  }

  const runtimeDir = join(config.appRoot, ".stack", "runtime")
  mkdirSync(runtimeDir, { recursive: true })
  const logPath = join(runtimeDir, "stackd.log")
  const logFd = openSync(logPath, "a")
  const child = spawn(launcher, ["serve"], {
    cwd: config.stackDataRoot,
    detached: true,
    env: {
      ...process.env,
      STACK_API_BIND: listen.bind,
      STACK_API_PORT: String(listen.port),
      STACK_INSTALL_ROOT: config.appRoot,
      STACK_ROOT: config.stackDataRoot,
      STACK_SESSION_DIR: config.sessionLogDir,
    },
    stdio: ["ignore", logFd, logFd],
  })
  child.unref()
  closeSync(logFd)

  for (let attempt = 0; attempt < STACKD_STARTUP_ATTEMPTS; attempt += 1) {
    await sleep(STACKD_STARTUP_DELAY_MS)
    if (await stackdHealthOk(baseUrl)) {
      return { baseUrl, healthy: true, started: true, logPath }
    }
  }

  return { baseUrl, healthy: false, started: true, logPath }
}

function resolveStackdLauncher(appRoot: string): string | undefined {
  const candidates = [
    join(appRoot, "target", "debug", "stackd"),
    join(appRoot, "target", "release", "stackd"),
    join(appRoot, "bin", "stackd"),
  ]
  return candidates.find((candidate) => existsSync(candidate))
}

function parseLocalStackdUrl(baseUrl: string): { bind: string; port: number } | undefined {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return undefined
  }
  if (url.protocol !== "http:") return undefined

  const hostname = url.hostname.toLowerCase()
  if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1") {
    return undefined
  }

  const port = Number(url.port || "8792")
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return undefined
  return { bind: hostname === "::1" ? "::1" : "127.0.0.1", port }
}

function normalizeStackdBaseUrl(value: string): string {
  const trimmed = value.trim() || DEFAULT_STACK_API_URL
  return trimmed.replace(/\/+$/, "")
}

async function stackdHealthOk(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1000) })
    if (!response.ok) return false
    const body = await response.json() as { ok?: unknown }
    return body.ok === true
  } catch {
    return false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
