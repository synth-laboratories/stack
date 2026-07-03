import { existsSync, readFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import { parseTomlLike, readBoolean, readNumber, readString, type ParsedTomlSections } from "./actor-config.js"
import { environmentAuthStatus, setStackEnvironment, STACK_ENVIRONMENT_OPTIONS, type StackConfig, type StackEnvironmentName } from "./config.js"
import { readRemoteAccountSnapshot } from "./remote/account.js"
import { readRemoteUsageSnapshot } from "./remote/usage.js"

// Failure taxonomy for informative preflight errors: every red row names one class.
export type TaskPreflightFailureClass = "auth" | "quota" | "config" | "transient"

export type TaskPreflightRow = {
  id: string
  level: "pass" | "warn" | "fail"
  summary: string
  detail?: string
  failureClass?: TaskPreflightFailureClass
}

export type TaskServiceDecl = {
  name: string
  port: number
}

// Minimal task preflight declaration contract, read from a StackEval task TOML.
// Explicit decls live under [preflight]; ports fall back to [harness] container_port_base
// so existing task TOMLs (e.g. banking77-local-gepa.toml) work without edits.
//
// [preflight]
// containers = ["banking77-task-app"]   # docker containers that must be running
// images = ["banking77:latest"]         # docker images that must be present locally
// ports = [28800]                       # ports the task app binds; must be free
// services = ["policy:8000"]            # host:port endpoints that must be listening
// requires_auth = true                  # default true: check auth route + subscription/caps
// requires_tunnel = false               # default false: check tunnel route + lease listing
// backend = "staging"                   # optional environment override for backend checks
export type TaskPreflightDecl = {
  taskId?: string
  title?: string
  containers: string[]
  images: string[]
  ports: number[]
  services: TaskServiceDecl[]
  requiresAuth: boolean
  requiresTunnel: boolean
  backend?: StackEnvironmentName
}

export function resolveTaskTomlPath(config: StackConfig, taskArg: string): string {
  return isAbsolute(taskArg) ? taskArg : join(config.workingDir, taskArg)
}

export function readTaskPreflightDecl(parsed: ParsedTomlSections): TaskPreflightDecl {
  const preflight = parsed.preflight ?? {}
  const harness = parsed.harness ?? {}
  const task = parsed.task ?? {}
  const ports = readNumberArray(preflight.ports) ?? []
  const harnessPort = readNumber(harness.container_port_base)
  if (ports.length === 0 && harnessPort !== undefined) ports.push(harnessPort)
  const backendRaw = readString(preflight.backend)
  const backend = STACK_ENVIRONMENT_OPTIONS.find((option) => option === backendRaw)
  return {
    taskId: readString(task.id),
    title: readString(task.title),
    containers: readStringList(preflight.containers),
    images: readStringList(preflight.images),
    ports,
    services: readServiceDecls(preflight.services),
    requiresAuth: readBoolean(preflight.requires_auth) ?? true,
    requiresTunnel: readBoolean(preflight.requires_tunnel) ?? false,
    backend,
  }
}

export async function runTaskPreflight(config: StackConfig, taskArg: string): Promise<TaskPreflightRow[]> {
  const path = resolveTaskTomlPath(config, taskArg)
  if (!existsSync(path)) {
    return [
      fail("task", "config", `task TOML not found: ${path}`, "Pass a path relative to the Stack working dir or an absolute path."),
    ]
  }

  let parsed: ParsedTomlSections
  try {
    parsed = parseTomlLike(readFileSync(path, "utf8"))
  } catch (error) {
    return [fail("task", "config", `task TOML failed to parse: ${path}`, message(error))]
  }

  const decl = readTaskPreflightDecl(parsed)
  if (decl.backend && decl.backend !== config.environmentName) {
    setStackEnvironment(config, decl.backend)
  }

  const rows: TaskPreflightRow[] = [
    pass(
      "task",
      `task ${decl.taskId ?? path}${decl.title ? ` · ${decl.title}` : ""}`,
      `backend target ${config.environmentName} (${config.environment.apiBaseUrl})`,
    ),
  ]

  rows.push(...(await containerRows(decl)))
  rows.push(...(await portRows(decl)))
  rows.push(...(await serviceRows(decl)))
  const [authRow, capsRow, tunnelRow, backendRow] = await Promise.all([
    authRouteRow(config, decl),
    subscriptionCapsRow(config, decl),
    tunnelLeaseRow(config, decl),
    backendTargetRow(config),
  ])
  rows.push(authRow, capsRow, tunnelRow, backendRow)
  return rows
}

async function containerRows(decl: TaskPreflightDecl): Promise<TaskPreflightRow[]> {
  if (decl.containers.length === 0 && decl.images.length === 0) {
    return [pass("task-container", "no containers or images declared by task")]
  }
  const rows: TaskPreflightRow[] = []
  const daemon = await dockerCommand(["docker", "version", "--format", "{{.Server.Version}}"])
  if (!daemon.ok) {
    const why = "docker daemon is not reachable; start Docker Desktop (or the docker service) and re-run"
    for (const name of decl.containers) rows.push(fail(`task-container:${name}`, "transient", `container ${name} unknown — ${why}`, daemon.output))
    for (const image of decl.images) rows.push(fail(`task-image:${image}`, "transient", `image ${image} unknown — ${why}`, daemon.output))
    return rows
  }
  for (const name of decl.containers) {
    const inspect = await dockerCommand(["docker", "inspect", "--format", "{{.State.Status}}", name])
    if (!inspect.ok) {
      rows.push(
        fail(
          `task-container:${name}`,
          "config",
          `container ${name} does not exist`,
          `create it (task setup) before running; docker said: ${inspect.output}`,
        ),
      )
      continue
    }
    const state = inspect.output.trim()
    if (state === "running") {
      rows.push(pass(`task-container:${name}`, `container ${name} is running`))
    } else {
      rows.push(
        fail(
          `task-container:${name}`,
          "transient",
          `container ${name} is ${state || "not running"}`,
          `docker start ${name} to recover`,
        ),
      )
    }
  }
  for (const image of decl.images) {
    const inspect = await dockerCommand(["docker", "image", "inspect", "--format", "{{.Id}}", image])
    rows.push(
      inspect.ok
        ? pass(`task-image:${image}`, `image ${image} is present`)
        : fail(`task-image:${image}`, "config", `image ${image} is missing`, `pull or build it first; docker said: ${inspect.output}`),
    )
  }
  return rows
}

async function portRows(decl: TaskPreflightDecl): Promise<TaskPreflightRow[]> {
  if (decl.ports.length === 0) {
    return [pass("task-port", "no service ports declared by task")]
  }
  const rows: TaskPreflightRow[] = []
  for (const port of decl.ports) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      rows.push(fail(`task-port:${port}`, "config", `declared port ${port} is not a valid TCP port`))
      continue
    }
    // A wildcard-bound listener (0.0.0.0) can coexist with a 127.0.0.1 bind under
    // SO_REUSEADDR, so probe for an active listener first and only then try to bind.
    const inUse = (await portIsListening(port)) || !(await portIsFree(port))
    rows.push(
      inUse
        ? fail(
            `task-port:${port}`,
            "transient",
            `port ${port} is already in use`,
            `stop the conflicting process (lsof -i :${port}) or change the task port declaration`,
          )
        : pass(`task-port:${port}`, `port ${port} is free for the task app`),
    )
  }
  return rows
}

async function serviceRows(decl: TaskPreflightDecl): Promise<TaskPreflightRow[]> {
  if (decl.services.length === 0) return []
  const rows: TaskPreflightRow[] = []
  for (const service of decl.services) {
    rows.push(
      (await portIsListening(service.port))
        ? pass(`task-service:${service.name}`, `service ${service.name} is listening on ${service.port}`)
        : fail(
            `task-service:${service.name}`,
            "transient",
            `service ${service.name} is not listening on ${service.port}`,
            "start the declared service before running the task",
          ),
    )
  }
  return rows
}

async function authRouteRow(config: StackConfig, decl: TaskPreflightDecl): Promise<TaskPreflightRow> {
  if (!decl.requiresAuth) return pass("task-auth", "auth not required by task")
  const auth = environmentAuthStatus(config.environment)
  if (!auth.hasAuth) {
    return fail("task-auth", "auth", `${config.environment.authEnv} is not set`, auth.message ?? "sign in with stack auth open signin")
  }
  const account = await readRemoteAccountSnapshot(config)
  if (account.status === "connected") {
    return pass("task-auth", `auth route accepted ${config.environment.authEnv}`, account.orgName ? `org ${account.orgName}` : account.message)
  }
  if (account.status === "invalid-auth") {
    return fail("task-auth", "auth", `${config.environment.authEnv} was rejected by ${config.environment.apiBaseUrl}`, account.message)
  }
  return fail("task-auth", "transient", `auth route unreachable at ${config.environment.apiBaseUrl}`, account.message)
}

async function subscriptionCapsRow(config: StackConfig, decl: TaskPreflightDecl): Promise<TaskPreflightRow> {
  if (!decl.requiresAuth) return pass("task-caps", "subscription/caps not required by task")
  const usage = await readRemoteUsageSnapshot(config)
  if (usage.status === "missing-auth") {
    return fail("task-caps", "auth", "subscription state needs sign-in", usage.message)
  }
  if (usage.status === "offline") {
    const authRejected = /\b(401|403)\b|auth rejected|invalid[_ -]auth/i.test(usage.message ?? "")
    if (authRejected) {
      return fail("task-caps", "auth", `subscription/caps route rejected ${config.environment.authEnv}`, usage.message)
    }
    return fail("task-caps", "transient", "subscription/caps route unreachable", usage.message)
  }
  if (usage.blocked) {
    return fail("task-caps", "quota", "account is blocked from launching runs", usage.blockedReason ?? usage.message)
  }
  const exhausted = usage.allowanceWindows.filter((window) => window.capUsd > 0 && window.remainingUsd <= 0)
  if (exhausted.length > 0) {
    const names = exhausted.map((window) => `${window.modelClass}/${window.windowKind}`).join(", ")
    return fail("task-caps", "quota", `allowance exhausted: ${names}`, "wait for the window reset or raise the plan cap")
  }
  const planLabel = usage.planTier ? `plan ${usage.planTier}` : "plan unknown"
  return pass("task-caps", `subscription ok · ${planLabel}`, `${usage.allowanceWindows.length} allowance window(s) with headroom`)
}

async function tunnelLeaseRow(config: StackConfig, decl: TaskPreflightDecl): Promise<TaskPreflightRow> {
  if (!decl.requiresTunnel) return pass("task-tunnel", "tunnel not required by task")
  const base = config.environment.apiBaseUrl.replace(/\/+$/, "")
  try {
    const health = await fetchWithTimeout(`${base}/v1/tunnels/health`, 4000)
    if (!health.ok) {
      return fail("task-tunnel", "transient", `tunnel route returned ${health.status}`, `${base}/v1/tunnels/health`)
    }
  } catch (error) {
    return fail("task-tunnel", "transient", "tunnel route unreachable", message(error))
  }
  const auth = environmentAuthStatus(config.environment)
  if (!auth.hasAuth) {
    return fail("task-tunnel", "auth", `tunnel lease needs ${config.environment.authEnv}`, auth.message)
  }
  try {
    const token = process.env[config.environment.authEnv] ?? ""
    const response = await fetchWithTimeout(`${base}/v1/tunnels/`, 4000, token)
    if (response.status === 401 || response.status === 403) {
      return fail("task-tunnel", "auth", `tunnel lease listing rejected ${config.environment.authEnv}`, `${base}/v1/tunnels/ returned ${response.status}`)
    }
    if (!response.ok) {
      return fail("task-tunnel", "transient", `tunnel lease listing returned ${response.status}`, `${base}/v1/tunnels/`)
    }
    const payload = (await response.json().catch(() => undefined)) as unknown
    const count = Array.isArray(payload) ? payload.length : undefined
    return pass("task-tunnel", "tunnel route healthy; lease listing ok", count === undefined ? undefined : `${count} active lease(s)`)
  } catch (error) {
    return fail("task-tunnel", "transient", "tunnel lease listing unreachable", message(error))
  }
}

async function backendTargetRow(config: StackConfig): Promise<TaskPreflightRow> {
  const base = config.environment.apiBaseUrl.replace(/\/+$/, "")
  try {
    const response = await fetchWithTimeout(`${base}/health`, 4000)
    if (response.ok) {
      return pass("task-backend", `backend target ${config.environmentName} reachable`, `${base}/health`)
    }
    return fail("task-backend", "transient", `backend target ${config.environmentName} returned ${response.status}`, `${base}/health`)
  } catch (error) {
    return fail("task-backend", "transient", `backend target ${config.environmentName} unreachable`, `${base}/health: ${message(error)}`)
  }
}

async function dockerCommand(command: string[]): Promise<{ ok: boolean; output: string }> {
  try {
    const proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" })
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const output = (exitCode === 0 ? stdout : stderr || stdout).trim()
    return { ok: exitCode === 0, output }
  } catch (error) {
    return { ok: false, output: message(error) }
  }
}

async function portIsFree(port: number): Promise<boolean> {
  try {
    const listener = Bun.listen({
      hostname: "127.0.0.1",
      port,
      socket: {
        data: () => {},
      },
    })
    listener.stop(true)
    return true
  } catch {
    return false
  }
}

async function portIsListening(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), 1500)
    Bun.connect({
      hostname: "127.0.0.1",
      port,
      socket: {
        open: (socket) => {
          clearTimeout(timeout)
          socket.end()
          resolve(true)
        },
        data: () => {},
        error: () => {
          clearTimeout(timeout)
          resolve(false)
        },
        connectError: () => {
          clearTimeout(timeout)
          resolve(false)
        },
      },
    }).catch(() => {
      clearTimeout(timeout)
      resolve(false)
    })
  })
}

async function fetchWithTimeout(url: string, timeoutMs: number, bearer?: string): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : undefined,
    })
  } finally {
    clearTimeout(timeout)
  }
}

function pass(id: string, summary: string, detail?: string): TaskPreflightRow {
  return { id, level: "pass", summary, detail }
}

function fail(id: string, failureClass: TaskPreflightFailureClass, summary: string, detail?: string): TaskPreflightRow {
  return { id, level: "fail", summary: `[${failureClass}] ${summary}`, detail, failureClass }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item).trim()).filter((item) => item.length > 0)
}

function readNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined
  const numbers = value
    .map((item) => (typeof item === "number" ? item : Number(String(item).trim())))
    .filter((item) => Number.isFinite(item))
  return numbers
}

function readServiceDecls(value: unknown): TaskServiceDecl[] {
  if (!Array.isArray(value)) return []
  const services: TaskServiceDecl[] = []
  for (const item of value) {
    const raw = String(item).trim()
    const separator = raw.lastIndexOf(":")
    if (separator <= 0) continue
    const name = raw.slice(0, separator).trim()
    const port = Number(raw.slice(separator + 1).trim())
    if (!name || !Number.isInteger(port)) continue
    services.push({ name, port })
  }
  return services
}
