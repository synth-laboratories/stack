import { existsSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { defaultCodexPricing, type CodexModelPricing } from "./codex/usage-cost.js"
import { loadOpenAiPricing } from "./codex/openai-pricing.js"

const DEFAULT_CODEX_MODEL = "gpt-5.4-mini"
const DEFAULT_CODEX_REASONING_EFFORT = "medium"
const DEFAULT_CODEX_PROVIDER = "OpenAI"
const DEFAULT_CODEX_AUTH_PLAN = "ChatGPT"
const DEFAULT_OPTIMIZER_BIND = "127.0.0.1:8879"
const DEFAULT_OPTIMIZER_WORKERS = 4
const DEFAULT_ENVIRONMENT = "dev"

export const CODEX_MODEL_OPTIONS = ["gpt-5.4-mini", "gpt-5.5"] as const
export const CODEX_REASONING_EFFORT_OPTIONS = ["low", "medium", "high", "xhigh"] as const
export const STACK_ENVIRONMENT_OPTIONS = ["dev", "staging", "prod"] as const

export type StackEnvironmentName = (typeof STACK_ENVIRONMENT_OPTIONS)[number]

export type StackEnvironmentConfig = {
  name: StackEnvironmentName
  label: string
  apiBaseUrl: string
  authEnv: string
  authEnvFile?: string
  optimizerDbPath?: string
  optimizerServiceUrl?: string
}

export type StackAuthStatus = {
  authEnv: string
  hasAuth: boolean
  source: "process" | "env-file" | "missing"
  envFile?: string
  message: string
}

export type StackConfig = {
  appRoot: string
  workspaceRoot: string
  workingDir: string
  synthDevRoot: string
  environmentName: StackEnvironmentName
  environment: StackEnvironmentConfig
  environments: Record<StackEnvironmentName, StackEnvironmentConfig>
  codexCommand: string
  codexArgs: string[]
  codexModel: string
  codexReasoningEffort: string
  codexProvider: string
  codexAuthPlan: string
  codexPricing: CodexModelPricing[]
  codexPricingSource?: string
  codexPricingOverrides: CodexModelPricing[]
  codexArgsLocked: boolean
  stackMcpEnabled: boolean
  stackMcpCommand: string
  sessionLogDir: string
  optimizerCommand: string
  optimizerBind: string
  optimizerWorkers: number
  optimizerDbPath: string
  optimizerLogPath: string
  optimizerPidPath: string
  optimizerServiceUrl: string
  evalCommand: string
  readmeSmokeSuite: string
  readmeSmokeTarget: string
  readmeSmokeInstance: string
}

type StackConfigFile = {
  workingDir?: string
  synthDevRoot?: string
  defaultEnvironment?: string
  environments?: Partial<Record<StackEnvironmentName, Partial<Omit<StackEnvironmentConfig, "name">>>>
  readmeSmoke?: {
    suite?: string
    target?: string
    instance?: string
  }
  codexPricing?: Array<{
    model?: string
    inputPerMillion?: number
    cachedInputPerMillion?: number
    outputPerMillion?: number
  }>
}

const loadedAuthEnvFiles = new Map<string, string>()

export async function loadConfig(appRoot: string): Promise<StackConfig> {
  const fileConfig = readConfigFile(appRoot)
  const synthDevRoot = resolveConfigPath(
    appRoot,
    process.env.STACK_SYNTH_DEV_ROOT ?? fileConfig.synthDevRoot ?? join(appRoot, "..", "synth-dev"),
  )
  const workingDir = resolveConfigPath(
    appRoot,
    process.env.STACK_WORKING_DIR ?? fileConfig.workingDir ?? appRoot,
  )
  const codexModel = normalizeOption(process.env.STACK_CODEX_MODEL, CODEX_MODEL_OPTIONS, DEFAULT_CODEX_MODEL)
  const codexReasoningEffort = normalizeOption(
    process.env.STACK_CODEX_REASONING_EFFORT,
    CODEX_REASONING_EFFORT_OPTIONS,
    DEFAULT_CODEX_REASONING_EFFORT,
  )
  const environments = resolveEnvironmentAuthFiles(appRoot, readEnvironments(fileConfig))
  const environmentName = normalizeOption(
    process.env.STACK_ENVIRONMENT ?? fileConfig.defaultEnvironment,
    STACK_ENVIRONMENT_OPTIONS,
    DEFAULT_ENVIRONMENT,
  )
  const environment = environments[environmentName]
  loadEnvironmentAuth(environment)
  const optimizerBind = process.env.STACK_OPTIMIZER_BIND ?? DEFAULT_OPTIMIZER_BIND
  const optimizerDbPath = resolveConfigPath(
    appRoot,
    process.env.STACK_OPTIMIZER_DB ??
      environment.optimizerDbPath ??
      join(appRoot, ".stack", "optimizers", "gepa-service.sqlite"),
  )
  const stackMcpCommand = resolveConfigPath(
    appRoot,
    process.env.STACK_MCP_COMMAND ?? join(appRoot, "bin", "stack-mcp"),
  )
  const stackMcpEnabled = process.env.STACK_CODEX_STACK_MCP !== "0"

  return {
    appRoot,
    synthDevRoot,
    workspaceRoot: workingDir,
    workingDir,
    environmentName,
    environment,
    environments,
    codexCommand: process.env.STACK_CODEX_COMMAND ?? "codex",
    codexArgs: process.env.STACK_CODEX_ARGS
      ? parseArgs(process.env.STACK_CODEX_ARGS)
      : defaultCodexArgs(
          codexModel,
          codexReasoningEffort,
          stackMcpEnabled ? stackMcpCommand : undefined,
          environmentName,
        ),
    codexModel,
    codexReasoningEffort,
    codexProvider: process.env.STACK_CODEX_PROVIDER ?? DEFAULT_CODEX_PROVIDER,
    codexAuthPlan: process.env.STACK_CODEX_AUTH_PLAN ?? DEFAULT_CODEX_AUTH_PLAN,
    codexPricing: defaultCodexPricing(),
    codexPricingOverrides: readCodexPricingOverrides(fileConfig),
    codexArgsLocked: Boolean(process.env.STACK_CODEX_ARGS),
    stackMcpEnabled,
    stackMcpCommand,
    sessionLogDir: process.env.STACK_SESSION_DIR ?? join(appRoot, ".stack", "sessions"),
    optimizerCommand: process.env.STACK_OPTIMIZER_COMMAND ?? "synth-optimizers",
    optimizerBind,
    optimizerWorkers: readPositiveInteger(process.env.STACK_OPTIMIZER_WORKERS, DEFAULT_OPTIMIZER_WORKERS),
    optimizerDbPath,
    optimizerLogPath:
      process.env.STACK_OPTIMIZER_LOG ?? join(appRoot, ".stack", "optimizers", "gepa-service.log"),
    optimizerPidPath:
      process.env.STACK_OPTIMIZER_PID ?? join(appRoot, ".stack", "optimizers", "gepa-service.pid"),
    optimizerServiceUrl:
      process.env.STACK_OPTIMIZER_SERVICE_URL ?? environment.optimizerServiceUrl ?? optimizerServiceUrl(optimizerBind),
    evalCommand:
      process.env.STACK_EVAL_COMMAND ?? join(synthDevRoot, "scripts", "eval.sh"),
    readmeSmokeSuite:
      process.env.STACK_README_SMOKE_SUITE ??
      fileConfig.readmeSmoke?.suite ??
      "smr/suites/readme_smoke_docker_codex.toml",
    readmeSmokeTarget:
      process.env.STACK_README_SMOKE_TARGET ??
      fileConfig.readmeSmoke?.target ??
      "local-dockerized",
    readmeSmokeInstance:
      process.env.STACK_README_SMOKE_INSTANCE ??
      fileConfig.readmeSmoke?.instance ??
      "slot1",
  }
}

function readConfigFile(appRoot: string): StackConfigFile {
  const path = join(appRoot, "stack.config.json")
  if (!existsSync(path)) return {}
  return JSON.parse(readFileSync(path, "utf8")) as StackConfigFile
}

function resolveConfigPath(appRoot: string, path: string): string {
  return isAbsolute(path) ? path : resolve(appRoot, path)
}

function resolveEnvironmentAuthFiles(
  appRoot: string,
  environments: Record<StackEnvironmentName, StackEnvironmentConfig>,
): Record<StackEnvironmentName, StackEnvironmentConfig> {
  const resolved = { ...environments }
  for (const name of STACK_ENVIRONMENT_OPTIONS) {
    const environment = resolved[name]
    resolved[name] = {
      ...environment,
      authEnvFile: environment.authEnvFile ? resolveConfigPath(appRoot, environment.authEnvFile) : undefined,
    }
  }
  return resolved
}

function readEnvFileValue(path: string, key: string): string | undefined {
  if (!existsSync(path)) return undefined
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (!match || match[1] !== key) continue
    return unquoteEnvValue(match[2] ?? "")
  }
  return undefined
}

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

export function setCodexModel(config: StackConfig, model: string): void {
  config.codexModel = model
  refreshCodexArgs(config)
}

export function setCodexReasoningEffort(config: StackConfig, reasoningEffort: string): void {
  config.codexReasoningEffort = reasoningEffort
  refreshCodexArgs(config)
}

export function setStackEnvironment(config: StackConfig, environmentName: StackEnvironmentName): void {
  config.environmentName = environmentName
  config.environment = config.environments[environmentName]
  loadEnvironmentAuth(config.environment)
  refreshCodexArgs(config)
}

export function environmentAuthStatus(environment: StackEnvironmentConfig): StackAuthStatus {
  const loadedFrom = loadedAuthEnvFiles.get(environment.authEnv)
  if (process.env[environment.authEnv]) {
    return {
      authEnv: environment.authEnv,
      hasAuth: true,
      source: loadedFrom ? "env-file" : "process",
      envFile: loadedFrom ?? environment.authEnvFile,
      message: loadedFrom ? `${environment.authEnv} loaded from ${loadedFrom}` : `${environment.authEnv} is set`,
    }
  }

  return {
    authEnv: environment.authEnv,
    hasAuth: false,
    source: "missing",
    envFile: environment.authEnvFile,
    message: environment.authEnvFile
      ? `${environment.authEnv} is not set; expected ${environment.authEnvFile}`
      : `${environment.authEnv} is not set`,
  }
}

function loadEnvironmentAuth(environment: StackEnvironmentConfig): void {
  if (process.env[environment.authEnv] || !environment.authEnvFile) return
  const value = readEnvFileValue(environment.authEnvFile, environment.authEnv)
  if (!value) return
  process.env[environment.authEnv] = value
  loadedAuthEnvFiles.set(environment.authEnv, environment.authEnvFile)
}

function refreshCodexArgs(config: StackConfig): void {
  if (config.codexArgsLocked) return
  config.codexArgs = defaultCodexArgs(
    config.codexModel,
    config.codexReasoningEffort,
    config.stackMcpEnabled ? config.stackMcpCommand : undefined,
    config.environmentName,
  )
}

export function defaultCodexArgs(
  model: string,
  reasoningEffort: string,
  stackMcpCommand?: string,
  stackEnvironmentName?: StackEnvironmentName,
): string[] {
  const args = [
    "exec",
    "--json",
    "--color",
    "never",
    "--skip-git-repo-check",
    "-m",
    model,
    "-c",
    `model_reasoning_effort="${reasoningEffort}"`,
  ]
  if (stackMcpCommand) {
    args.push(
      "-c",
      `mcp_servers.stack_live_ops.command=${tomlString(stackMcpCommand)}`,
      "-c",
      "mcp_servers.stack_live_ops.args=[]",
      "-c",
      "mcp_servers.stack_live_ops.startup_timeout_sec=15",
      "-c",
      `mcp_servers.stack_live_ops.env.STACK_ENVIRONMENT=${tomlString(stackEnvironmentName ?? DEFAULT_ENVIRONMENT)}`,
    )
  }
  return args
}

function tomlString(value: string): string {
  return JSON.stringify(value)
}

function parseArgs(value: string): string[] {
  return value
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

function normalizeOption<T extends string>(value: string | undefined, options: readonly T[], fallback: T): T {
  if (value !== undefined && options.includes(value as T)) return value as T
  return fallback
}

function readEnvironments(fileConfig: StackConfigFile): Record<StackEnvironmentName, StackEnvironmentConfig> {
  const defaults: Record<StackEnvironmentName, StackEnvironmentConfig> = {
    dev: {
      name: "dev",
      label: "Dev",
      apiBaseUrl: "http://127.0.0.1:8000",
      authEnv: "SYNTH_API_KEY",
      authEnvFile: join("..", "synth-ai", ".env"),
      optimizerDbPath: join(".stack", "optimizers", "gepa-service.sqlite"),
      optimizerServiceUrl: optimizerServiceUrl(DEFAULT_OPTIMIZER_BIND),
    },
    staging: {
      name: "staging",
      label: "Staging",
      apiBaseUrl: "https://staging-api.usesynth.ai",
      authEnv: "SYNTH_STAGING_API_KEY",
    },
    prod: {
      name: "prod",
      label: "Prod",
      apiBaseUrl: "https://api.usesynth.ai",
      authEnv: "SYNTH_API_KEY",
    },
  }

  const merged = { ...defaults }
  for (const name of STACK_ENVIRONMENT_OPTIONS) {
    const override = fileConfig.environments?.[name]
    if (!override) continue
    merged[name] = {
      ...merged[name],
      ...override,
      name,
    }
  }
  return merged
}

function readCodexPricingOverrides(fileConfig: StackConfigFile): CodexModelPricing[] {
  const rows = fileConfig.codexPricing
  if (!rows?.length) return []
  return rows
    .map((row) => {
      if (!row.model || row.inputPerMillion === undefined || row.cachedInputPerMillion === undefined || row.outputPerMillion === undefined) {
        return undefined
      }
      return {
        model: row.model,
        inputPerMillion: row.inputPerMillion,
        cachedInputPerMillion: row.cachedInputPerMillion,
        outputPerMillion: row.outputPerMillion,
      }
    })
    .filter((row): row is CodexModelPricing => Boolean(row))
}

export async function hydrateCodexPricing(config: StackConfig, options?: { forceRefresh?: boolean }): Promise<void> {
  const result = await loadOpenAiPricing({
    appRoot: config.appRoot,
    models: [...new Set([...CODEX_MODEL_OPTIONS, config.codexModel])],
    configOverrides: config.codexPricingOverrides,
    forceRefresh: options?.forceRefresh,
  })
  config.codexPricing = result.rows
  config.codexPricingSource = result.source
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function optimizerServiceUrl(bind: string): string {
  const normalized = bind.startsWith("http://") || bind.startsWith("https://") ? bind : `http://${bind}`
  return normalized.replace(/\/+$/, "")
}
