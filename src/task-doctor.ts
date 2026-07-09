import { existsSync, readFileSync } from "node:fs"
import { connect } from "node:net"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"
import { environmentAuthStatus, type StackConfig } from "./config.js"
import { readRemoteUsageSnapshot } from "./remote/usage.js"

export type TaskDoctorLevel = "pass" | "warn" | "fail"
export type TaskFailureClass = "auth" | "quota" | "config" | "transient"

export type TaskDoctorCheck = {
  id: string
  level: TaskDoctorLevel
  summary: string
  detail?: string
  class?: TaskFailureClass
}

export type TaskDoctorReport = {
  task_path: string
  task_id?: string
  title?: string
  checks: TaskDoctorCheck[]
}

type TaskDoctorContext = {
  config: StackConfig
  taskPath: string
  taskDir: string
  root: Record<string, unknown>
}

export async function runTaskDoctor(config: StackConfig, taskArg: string): Promise<TaskDoctorReport> {
  const taskPath = resolveTaskPath(taskArg)
  const checks: TaskDoctorCheck[] = [
    taskCheck("task.file", existsSync(taskPath) ? "pass" : "fail", existsSync(taskPath) ? "task TOML exists" : "task TOML is missing", {
      detail: taskPath,
      class: existsSync(taskPath) ? undefined : "config",
    }),
  ]

  if (!existsSync(taskPath)) {
    return { task_path: taskPath, checks }
  }

  let root: Record<string, unknown>
  try {
    root = parseTomlRecord(readFileSync(taskPath, "utf8"))
    checks.push(taskCheck("task.parse", "pass", "task TOML parsed"))
  } catch (error) {
    checks.push(taskCheck("task.parse", "fail", "task TOML did not parse", {
      detail: errorMessage(error),
      class: "config",
    }))
    return { task_path: taskPath, checks }
  }

  const ctx: TaskDoctorContext = { config, taskPath, taskDir: dirname(taskPath), root }
  const task = asRecord(root.task)
  const harness = asRecord(root.harness)
  const policy = asRecord(root.policy)
  const container = asRecord(root.container)

  checks.push(...taskMetadataChecks(ctx, task))
  checks.push(...pathChecks(ctx, task, harness))
  checks.push(...commandChecks(ctx, harness, container))
  checks.push(...envChecks(ctx, harness, policy))
  checks.push(await backendReachabilityCheck(config))
  checks.push(authCheck(config))
  checks.push(await usageCapCheck(config))
  checks.push(await optimizerCheck(config))
  checks.push(await optimizerServiceOrPortCheck(config))
  checks.push(await containerImageCheck(container))
  checks.push(await containerHealthOrLaunchCheck(ctx, harness, container))
  checks.push(await taskPortCheck(harness, container))
  checks.push(tunnelCheck(ctx))
  checks.push(privateTaskCheck(ctx))

  return {
    task_path: taskPath,
    task_id: readString(task?.id) ?? readString(asRecord(root.run)?.run_id),
    title: readString(task?.title),
    checks,
  }
}

function taskMetadataChecks(ctx: TaskDoctorContext, task: Record<string, unknown> | undefined): TaskDoctorCheck[] {
  const id = readString(task?.id) ?? readString(asRecord(ctx.root.run)?.run_id)
  const title = readString(task?.title)
  return [
    taskCheck(
      "task.id",
      id ? "pass" : "warn",
      id ? `task id ${id}` : "task id not declared",
      id ? undefined : { class: "config" },
    ),
    taskCheck(
      "task.title",
      title ? "pass" : "warn",
      title ? `task title ${title}` : "task title not declared",
      title ? undefined : { class: "config" },
    ),
  ]
}

function pathChecks(
  ctx: TaskDoctorContext,
  task: Record<string, unknown> | undefined,
  harness: Record<string, unknown> | undefined,
): TaskDoctorCheck[] {
  const checks: TaskDoctorCheck[] = []
  for (const [id, label, raw] of [
    ["task.prompt_file", "prompt file", readString(task?.prompt_file)],
    ["task.spec_md", "task spec markdown", readString(task?.spec_md)],
  ] as const) {
    if (!raw) continue
    const path = resolveTaskRelative(ctx.taskDir, raw)
    checks.push(taskCheck(id, existsSync(path) ? "pass" : "fail", existsSync(path) ? `${label} exists` : `${label} missing`, {
      detail: path,
      class: existsSync(path) ? undefined : "config",
    }))
  }

  const template = readString(harness?.template)
  if (template) {
    const path = resolveTemplatePath(ctx, template)
    checks.push(taskCheck("task.harness_template", path ? "pass" : "fail", path ? "harness template exists" : "harness template missing", {
      detail: path ?? template,
      class: path ? undefined : "config",
    }))
  }

  return checks
}

function commandChecks(
  ctx: TaskDoctorContext,
  harness: Record<string, unknown> | undefined,
  container: Record<string, unknown> | undefined,
): TaskDoctorCheck[] {
  const checks: TaskDoctorCheck[] = []
  const harnessCommand = readString(harness?.command)
  if (harnessCommand) {
    const executable = firstCommandToken(harnessCommand)
    checks.push(commandAvailableCheck("task.harness_command", executable, harnessCommand))
  } else if (readString(harness?.template)) {
    checks.push(taskCheck("task.harness_command", "pass", "harness command is rendered from template"))
  } else {
    checks.push(taskCheck("task.harness_command", "warn", "harness command not declared", { class: "config" }))
  }

  const containerCommand = readStringArray(container?.command)
  if (containerCommand.length > 0) {
    checks.push(commandAvailableCheck("task.container_command", containerCommand[0], containerCommand.join(" ")))
  }

  const cwd = readString(container?.cwd)
  if (cwd) {
    const path = resolveTaskRelative(ctx.taskDir, cwd)
    checks.push(taskCheck("task.container_cwd", existsSync(path) ? "pass" : "fail", existsSync(path) ? "container cwd exists" : "container cwd missing", {
      detail: path,
      class: existsSync(path) ? undefined : "config",
    }))
  }

  return checks
}

function envChecks(
  ctx: TaskDoctorContext,
  harness: Record<string, unknown> | undefined,
  policy: Record<string, unknown> | undefined,
): TaskDoctorCheck[] {
  const refs = new Set<string>()
  for (const value of [
    readString(harness?.policy_api_key_env),
    readString(policy?.api_key_env),
  ]) {
    if (value) refs.add(value)
  }
  const envMap = asRecord(harness?.env)
  for (const [key, value] of Object.entries(envMap ?? {})) {
    if (key.endsWith("_API_KEY_ENV") && typeof value === "string") refs.add(value)
  }

  if (refs.size === 0) {
    return [taskCheck("task.policy_auth", "warn", "policy API key env var not declared", { class: "config" })]
  }

  return [...refs].map((name) => {
    const source = envVarSource(name, ctx.config)
    return taskCheck(
      `task.env.${name}`,
      source ? "pass" : "fail",
      source ? `${name} is available` : `${name} is missing`,
      {
        detail: source,
        class: source ? undefined : "auth",
      },
    )
  })
}

async function backendReachabilityCheck(config: StackConfig): Promise<TaskDoctorCheck> {
  const base = config.environment.apiBaseUrl.replace(/\/+$/, "")
  const attempts = ["/health", "/healthz"]
  const details: string[] = []
  for (const path of attempts) {
    try {
      const response = await fetchWithTimeout(`${base}${path}`, 1500)
      details.push(`${path} -> ${response.status}`)
      if (response.ok) {
        return taskCheck("task.backend", "pass", `${config.environmentName} backend reachable`, {
          detail: `${base}${path} -> ${response.status}`,
        })
      }
    } catch (error) {
      details.push(`${path} -> ${errorMessage(error)}`)
    }
  }
  return taskCheck("task.backend", "fail", `${config.environmentName} backend is not reachable`, {
    detail: details.join("; "),
    class: "transient",
  })
}

function authCheck(config: StackConfig): TaskDoctorCheck {
  const auth = environmentAuthStatus(config.environment)
  return taskCheck(
    "task.synth_auth",
    auth.hasAuth ? "pass" : "fail",
    auth.hasAuth ? `${auth.authEnv} available for ${config.environmentName}` : `${auth.authEnv} missing for ${config.environmentName}`,
    {
      detail: auth.message,
      class: auth.hasAuth ? undefined : "auth",
    },
  )
}

async function usageCapCheck(config: StackConfig): Promise<TaskDoctorCheck> {
  const auth = environmentAuthStatus(config.environment)
  if (!auth.hasAuth) {
    return taskCheck("task.subscription_caps", "fail", "subscription and cap state require Synth auth", {
      detail: auth.message,
      class: "auth",
    })
  }

  const usage = await readRemoteUsageSnapshot(config)
  if (usage.status !== "ready") {
    return taskCheck("task.subscription_caps", "warn", "subscription and cap state unavailable", {
      detail: usage.message,
      class: usage.status === "missing-auth" ? "auth" : "transient",
    })
  }
  if (usage.blocked) {
    return taskCheck("task.subscription_caps", "fail", "billing plan is blocked", {
      detail: usage.blockedMessage ?? usage.blockedReason ?? usage.nextActions?.[0]?.label,
      class: "quota",
    })
  }
  const orgDaily = usage.stackInferenceBudget?.orgDaily
  const synthWideDaily = usage.stackInferenceBudget?.synthWideDaily
  if (orgDaily && orgDaily.remainingUsd <= 0) {
    return taskCheck("task.subscription_caps", "fail", "org daily Stack inference cap exhausted", {
      detail: `cap=${orgDaily.capUsd} spent=${orgDaily.spentUsd}`,
      class: "quota",
    })
  }
  if (synthWideDaily && synthWideDaily.remainingUsd <= 0) {
    return taskCheck("task.subscription_caps", "fail", "synth-wide Stack inference cap exhausted", {
      detail: `cap=${synthWideDaily.capUsd} spent=${synthWideDaily.spentUsd}`,
      class: "quota",
    })
  }
  const detail = [
    usage.planTier ? `plan=${usage.planTier}` : undefined,
    orgDaily ? `org_remaining=${orgDaily.remainingUsd}` : undefined,
    synthWideDaily ? `synth_remaining=${synthWideDaily.remainingUsd}` : undefined,
  ].filter(Boolean).join("; ")
  return taskCheck("task.subscription_caps", "pass", "subscription and caps are readable", { detail })
}

async function optimizerCheck(config: StackConfig): Promise<TaskDoctorCheck> {
  return commandAvailableCheck("task.optimizer_cli", config.optimizerCommand, config.optimizerCommand)
}

async function optimizerServiceOrPortCheck(config: StackConfig): Promise<TaskDoctorCheck> {
  try {
    const response = await fetchWithTimeout(`${config.optimizerServiceUrl.replace(/\/+$/, "")}/health`, 800)
    if (response.ok) {
      return taskCheck("task.optimizer_service", "pass", "local optimizer service is reachable", {
        detail: `${config.optimizerServiceUrl}/health -> ${response.status}`,
      })
    }
  } catch {
    // Fall through to the port-free check; a stopped service is fine if the port is free.
  }

  const parsed = hostPortFromBind(config.optimizerBind)
  if (!parsed) {
    return taskCheck("task.optimizer_service", "warn", "optimizer bind was not parseable", {
      detail: config.optimizerBind,
      class: "config",
    })
  }
  const free = await isTcpPortFree(parsed.host, parsed.port)
  return taskCheck(
    "task.optimizer_service",
    free ? "pass" : "fail",
    free ? "optimizer service not running; configured port is free" : "optimizer service port is occupied and service health is unavailable",
    {
      detail: config.optimizerBind,
      class: free ? undefined : "transient",
    },
  )
}

async function containerImageCheck(container: Record<string, unknown> | undefined): Promise<TaskDoctorCheck> {
  const image = readString(container?.image)
  if (!image) return taskCheck("task.container_image", "pass", "container image not declared; no image preflight needed")
  const docker = await commandAvailable("docker")
  if (!docker) {
    return taskCheck("task.container_image", "warn", "docker not available for image preflight", {
      detail: image,
      class: "transient",
    })
  }
  const proc = Bun.spawn(["docker", "image", "inspect", image], { stdout: "ignore", stderr: "pipe" })
  const exitCode = await proc.exited
  return taskCheck(
    "task.container_image",
    exitCode === 0 ? "pass" : "fail",
    exitCode === 0 ? "container image exists locally" : "container image is not available locally",
    {
      detail: image,
      class: exitCode === 0 ? undefined : "config",
    },
  )
}

async function containerHealthOrLaunchCheck(
  ctx: TaskDoctorContext,
  harness: Record<string, unknown> | undefined,
  container: Record<string, unknown> | undefined,
): Promise<TaskDoctorCheck> {
  const url = readString(container?.url) ?? readString(harness?.container_url)
  if (!url) {
    const template = readString(harness?.template)
    return taskCheck(
      "task.container_health",
      template ? "pass" : "warn",
      template ? "container is launched by rendered harness template" : "live container URL not declared",
      {
        detail: template ? (resolveTemplatePath(ctx, template) ?? template) : undefined,
        class: template ? undefined : "config",
      },
    )
  }
  try {
    const response = await fetchWithTimeout(`${url.replace(/\/+$/, "")}/health`, 1500)
    return taskCheck(
      "task.container_health",
      response.ok ? "pass" : "fail",
      response.ok ? "container health is reachable" : "container health returned a non-2xx status",
      {
        detail: `${url}/health -> ${response.status}`,
        class: response.ok ? undefined : "transient",
      },
    )
  } catch (error) {
    return taskCheck("task.container_health", "fail", "container health is not reachable", {
      detail: `${url}/health -> ${errorMessage(error)}`,
      class: "transient",
    })
  }
}

async function taskPortCheck(
  harness: Record<string, unknown> | undefined,
  container: Record<string, unknown> | undefined,
): Promise<TaskDoctorCheck> {
  const url = readString(container?.url) ?? readString(harness?.container_url)
  const fromUrl = url ? hostPortFromUrl(url) : undefined
  if (fromUrl) {
    return taskCheck("task.service_port", "pass", "container URL declares service port", {
      detail: `${fromUrl.host}:${fromUrl.port}`,
    })
  }

  const base = readNumber(harness?.container_port_base)
  if (!base) return taskCheck("task.service_port", "warn", "container port not declared", { class: "config" })
  const free = await isTcpPortFree("127.0.0.1", base)
  return taskCheck(
    "task.service_port",
    free ? "pass" : "fail",
    free ? "container port base is free" : "container port base is occupied",
    {
      detail: `127.0.0.1:${base}`,
      class: free ? undefined : "config",
    },
  )
}

function tunnelCheck(ctx: TaskDoctorContext): TaskDoctorCheck {
  const tunnel = asRecord(ctx.root.tunnel)
  const hosted = asRecord(ctx.root.hosted)
  const provider = readString(tunnel?.provider) ?? readString(hosted?.tunnel_provider)
  const url = readString(tunnel?.url) ?? readString(hosted?.tunnel_url)
  if (!provider && !url) return taskCheck("task.tunnel", "pass", "no tunnel lease declared for this task")
  const auth = environmentAuthStatus(ctx.config.environment)
  if (!auth.hasAuth) {
    return taskCheck("task.tunnel", "fail", "tunnel lease requires Synth auth", {
      detail: auth.message,
      class: "auth",
    })
  }
  return taskCheck("task.tunnel", "pass", "tunnel lease inputs are declared and Synth auth is available", {
    detail: [provider ? `provider=${provider}` : undefined, url ? `url=${url}` : undefined].filter(Boolean).join("; "),
  })
}

function privateTaskCheck(ctx: TaskDoctorContext): TaskDoctorCheck {
  const task = asRecord(ctx.root.task)
  const privateTask = readBoolean(task?.private) === true || readBoolean(asRecord(ctx.root.privacy)?.private) === true
  if (!privateTask) return taskCheck("task.private_lane", "pass", "task is not marked private")

  const tunnel = asRecord(ctx.root.tunnel)
  const hosted = asRecord(ctx.root.hosted)
  const publish = asRecord(ctx.root.publish)
  if (tunnel || hosted || publish) {
    return taskCheck("task.private_lane", "fail", "private task declares cloud, tunnel, or publish settings", {
      class: "config",
    })
  }
  return taskCheck("task.private_lane", "pass", "private task has no cloud, tunnel, or publish declaration")
}

function taskCheck(
  id: string,
  level: TaskDoctorLevel,
  summary: string,
  options: { detail?: string; class?: TaskFailureClass } = {},
): TaskDoctorCheck {
  return { id, level, summary, detail: options.detail, class: options.class }
}

function parseTomlRecord(text: string): Record<string, unknown> {
  const parsed = Bun.TOML.parse(text)
  const record = asRecord(parsed)
  if (!record) throw new Error("top-level TOML did not parse to an object")
  return record
}

function resolveTaskPath(taskArg: string): string {
  return isAbsolute(taskArg) ? taskArg : resolve(process.cwd(), taskArg)
}

function resolveTaskRelative(taskDir: string, value: string): string {
  return isAbsolute(value) ? value : resolve(taskDir, value)
}

function resolveTemplatePath(ctx: TaskDoctorContext, template: string): string | undefined {
  const candidates = [
    resolveTaskRelative(ctx.taskDir, template),
    resolve(ctx.taskDir, "templates", template),
    resolve(dirname(ctx.taskDir), "templates", template),
    resolve(ctx.config.workingDir, template),
    resolve(ctx.config.appRoot, template),
  ]
  return candidates.find((path) => existsSync(path))
}

function commandAvailableCheck(id: string, executable: string | undefined, label: string): TaskDoctorCheck {
  if (!executable) return taskCheck(id, "warn", "command is not declared", { detail: label, class: "config" })
  if (executable.includes("{{")) {
    return taskCheck(id, "warn", "command is a template placeholder", { detail: label, class: "config" })
  }
  const ok = commandAvailableSync(executable)
  return taskCheck(id, ok ? "pass" : "fail", ok ? `${executable} is available` : `${executable} is not available`, {
    detail: label,
    class: ok ? undefined : "config",
  })
}

function commandAvailableSync(command: string): boolean {
  if (command.includes("/")) return existsSync(command)
  const proc = Bun.spawnSync(["which", command], { stdout: "ignore", stderr: "ignore" })
  return proc.exitCode === 0
}

async function commandAvailable(command: string): Promise<boolean> {
  if (command.includes("/")) return existsSync(command)
  const proc = Bun.spawn(["which", command], { stdout: "ignore", stderr: "ignore" })
  return (await proc.exited) === 0
}

function firstCommandToken(command: string): string | undefined {
  const trimmed = command.trim()
  if (!trimmed) return undefined
  const match = /^"([^"]+)"|'([^']+)'|(\S+)/.exec(trimmed)
  return match?.[1] ?? match?.[2] ?? match?.[3]
}

function envVarSource(name: string, config: StackConfig): string | undefined {
  if (process.env[name]?.trim()) return "process"
  const candidates = [
    config.environment.authEnvFile,
    join(config.appRoot, "..", "synth-ai", ".env"),
    join(config.workspaceRoot, "synth-ai", ".env"),
  ].filter((value): value is string => Boolean(value))
  for (const path of unique(candidates)) {
    if (readEnvFileValue(path, name)) return path
  }
  return undefined
}

function readEnvFileValue(path: string, key: string): string | undefined {
  if (!existsSync(path)) return undefined
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (!match || match[1] !== key) continue
    const value = unquoteEnvValue(match[2] ?? "")
    return value.trim() ? value : undefined
  }
  return undefined
}

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

async function isTcpPortFree(host: string, port: number): Promise<boolean> {
  return new Promise((resolveFree) => {
    const socket = connect({ host, port })
    socket.once("connect", () => {
      socket.destroy()
      resolveFree(false)
    })
    socket.once("error", () => {
      socket.destroy()
      resolveFree(true)
    })
    socket.setTimeout(800, () => {
      socket.destroy()
      resolveFree(true)
    })
  })
}

function hostPortFromBind(bind: string): { host: string; port: number } | undefined {
  const [host, portRaw] = bind.split(":")
  const port = Number(portRaw)
  if (!host || !Number.isInteger(port) || port <= 0) return undefined
  return { host, port }
}

function hostPortFromUrl(raw: string): { host: string; port: number } | undefined {
  try {
    const url = new URL(raw)
    const port = Number(url.port)
    if (!url.hostname || !Number.isInteger(port) || port <= 0) return undefined
    return { host: url.hostname, port }
  } catch {
    return undefined
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : []
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
