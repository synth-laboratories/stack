import { existsSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { defaultCodexPricing, type CodexModelPricing } from "./codex/usage-cost.js"
import { loadOpenAiPricing } from "./codex/openai-pricing.js"

const DEFAULT_CODEX_MODEL = "gpt-5.4-mini"
const DEFAULT_CODEX_REASONING_EFFORT = "medium"
const DEFAULT_CODEX_PROVIDER = "OpenAI"
const DEFAULT_CODEX_AUTH_PLAN = "ChatGPT"
const DEFAULT_CURSOR_MODEL = "composer-2.5"
const DEFAULT_CURSOR_PROVIDER = "Cursor"
const DEFAULT_CURSOR_AUTH_PLAN = "Cursor"
const DEFAULT_HARNESS = "codex"
const DEFAULT_OPTIMIZER_BIND = "127.0.0.1:8879"
const DEFAULT_OPTIMIZER_WORKERS = 4
const DEFAULT_ENVIRONMENT = "dev"
const DEFAULT_VOICE_STT_PROVIDER = "groq"
const DEFAULT_VOICE_STT_FALLBACK = "openai"
const DEFAULT_VOICE_STT_MODEL_GROQ = "whisper-large-v3-turbo"
const DEFAULT_VOICE_STT_MODEL_OPENAI = "gpt-4o-mini-transcribe"
const DEFAULT_VOICE_LANGUAGE = "en"

export const CODEX_MODEL_OPTIONS = ["gpt-5.4-mini", "gpt-5.5"] as const
export const CURSOR_MODEL_OPTIONS = ["composer-2.5", "auto"] as const
export const CODEX_REASONING_EFFORT_OPTIONS = ["low", "medium", "high", "xhigh"] as const
export const STACK_ENVIRONMENT_OPTIONS = ["dev", "staging", "prod"] as const
export const STACK_HARNESS_OPTIONS = ["codex", "cursor"] as const

export type StackHarnessKind = (typeof STACK_HARNESS_OPTIONS)[number]

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

export type StackVoiceConfig = {
  enabled: boolean
  sttProvider: "groq" | "openai"
  sttFallback: "groq" | "openai"
  sttModelGroq: string
  sttModelOpenai: string
  language: string
  envFile?: string
}

export type StackConfig = {
  appRoot: string
  stackDataRoot: string
  workspaceRoot: string
  workingDir: string
  // Local synth dev-stack checkout; dev-slot management is off unless explicitly configured.
  synthDevRoot?: string
  environmentName: StackEnvironmentName
  environment: StackEnvironmentConfig
  environments: Record<StackEnvironmentName, StackEnvironmentConfig>
  codexCommand: string
  codexArgs: string[]
  codexModel: string
  codexReasoningEffort: string
  codexProvider: string
  codexAuthPlan: string
  harness: StackHarnessKind
  cursorCommand: string
  cursorModel: string
  cursorProvider: string
  cursorAuthPlan: string
  codexSubagentsEnabled: boolean
  codexSubagentModel: string
  codexSubagentReasoningEffort: string
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
  devSlotInstance: string
  initialPromptFile?: string
  autoSubmitInitialPrompt: boolean
  voice: StackVoiceConfig
}

type StackConfigFile = {
  workingDir?: string
  synthDevRoot?: string
  defaultEnvironment?: string
  environments?: Partial<Record<StackEnvironmentName, Partial<Omit<StackEnvironmentConfig, "name">>>>
  devSlotInstance?: string
  codexPricing?: Array<{
    model?: string
    inputPerMillion?: number
    cachedInputPerMillion?: number
    outputPerMillion?: number
  }>
  voice?: {
    enabled?: boolean
    stt_provider?: string
    stt_fallback?: string
    stt_model_groq?: string
    stt_model_openai?: string
    language?: string
    env_file?: string
  }
}

const loadedAuthEnvFiles = new Map<string, string>()

export async function loadConfig(appRoot: string): Promise<StackConfig> {
  const fileConfig = readConfigFile(appRoot)
  const synthDevRootRaw = process.env.STACK_SYNTH_DEV_ROOT ?? fileConfig.synthDevRoot
  const synthDevRoot = synthDevRootRaw ? resolveConfigPath(appRoot, synthDevRootRaw) : undefined
  const workingDir = resolveConfigPath(
    appRoot,
    process.env.STACK_WORKING_DIR ?? fileConfig.workingDir ?? appRoot,
  )
  const codexModelProfile = parseCodexModelProfile(process.env.STACK_CODEX_MODEL)
  const codexModel = normalizeOption(
    codexModelProfile.model,
    CODEX_MODEL_OPTIONS,
    DEFAULT_CODEX_MODEL,
    "STACK_CODEX_MODEL",
  )
  const codexReasoningEffort = normalizeOption(
    process.env.STACK_CODEX_REASONING_EFFORT ?? codexModelProfile.reasoningEffort,
    CODEX_REASONING_EFFORT_OPTIONS,
    DEFAULT_CODEX_REASONING_EFFORT,
    "STACK_CODEX_REASONING_EFFORT",
  )
  const environments = resolveEnvironmentAuthFiles(appRoot, readEnvironments(fileConfig))
  const environmentName = normalizeOption(
    process.env.STACK_ENVIRONMENT ?? fileConfig.defaultEnvironment,
    STACK_ENVIRONMENT_OPTIONS,
    DEFAULT_ENVIRONMENT,
    process.env.STACK_ENVIRONMENT ? "STACK_ENVIRONMENT" : "defaultEnvironment",
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
  const stackMcpCommand = resolveStackMcpCommand(appRoot)
  const stackMcpEnabled = process.env.STACK_CODEX_STACK_MCP !== "0"
  const codexSubagentsEnabled = readBooleanEnv(process.env.STACK_CODEX_SUBAGENTS, true)
  const codexSubagentModel = process.env.STACK_CODEX_SUBAGENT_MODEL ?? "gpt-5.4-mini"
  const codexSubagentReasoningEffort = process.env.STACK_CODEX_SUBAGENT_REASONING_EFFORT ?? "medium"
  const harness = normalizeOption(
    process.env.STACK_HARNESS,
    STACK_HARNESS_OPTIONS,
    DEFAULT_HARNESS,
    "STACK_HARNESS",
  )
  const cursorModel = normalizeOption(
    process.env.STACK_CURSOR_MODEL,
    CURSOR_MODEL_OPTIONS,
    DEFAULT_CURSOR_MODEL,
    "STACK_CURSOR_MODEL",
  )

  // Data home (.stack) resolves like the Rust core's app_root (STACK_ROOT || cwd),
  // so TS and stackd agree on a per-workspace .stack rather than the install dir.
  // Prefer an explicitly configured workingDir's ./.stack if present; otherwise
  // the workspace cwd. Never an implicit workingDir==appRoot default, which would
  // scatter user state into the binary's home whenever the checkout happens to
  // already have a .stack dir (e.g. dev-from-checkout with cwd outside the repo).
  const explicitWorkingDir = process.env.STACK_WORKING_DIR ?? fileConfig.workingDir
  const workspaceHome = process.env.STACK_ROOT ?? process.cwd()
  const stackDataHome =
    explicitWorkingDir && existsSync(join(workingDir, ".stack")) ? workingDir : workspaceHome
  const sessionLogDir = process.env.STACK_SESSION_DIR ?? join(stackDataHome, ".stack", "sessions")
  const stackDataRoot = stackDataRootFromSessionDir(sessionLogDir) ?? stackDataHome

  return {
    appRoot,
    stackDataRoot,
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
          codexSubagentsEnabled,
          stackMcpEnabled ? stackMcpCommand : undefined,
          environmentName,
        ),
    codexModel,
    codexReasoningEffort,
    codexProvider: process.env.STACK_CODEX_PROVIDER ?? DEFAULT_CODEX_PROVIDER,
    codexAuthPlan: process.env.STACK_CODEX_AUTH_PLAN ?? DEFAULT_CODEX_AUTH_PLAN,
    harness,
    cursorCommand: process.env.STACK_CURSOR_COMMAND ?? "cursor",
    cursorModel,
    cursorProvider: process.env.STACK_CURSOR_PROVIDER ?? DEFAULT_CURSOR_PROVIDER,
    cursorAuthPlan: process.env.STACK_CURSOR_AUTH_PLAN ?? DEFAULT_CURSOR_AUTH_PLAN,
    codexSubagentsEnabled,
    codexSubagentModel,
    codexSubagentReasoningEffort,
    codexPricing: defaultCodexPricing(),
    codexPricingOverrides: readCodexPricingOverrides(fileConfig),
    codexArgsLocked: Boolean(process.env.STACK_CODEX_ARGS),
    stackMcpEnabled,
    stackMcpCommand,
    sessionLogDir,
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
    devSlotInstance:
      process.env.STACK_DEV_SLOT_INSTANCE ??
      fileConfig.devSlotInstance ??
      "slot1",
    initialPromptFile: process.env.STACK_INITIAL_PROMPT_FILE
      ? resolveConfigPath(appRoot, process.env.STACK_INITIAL_PROMPT_FILE)
      : undefined,
    autoSubmitInitialPrompt: process.env.STACK_AUTOSUBMIT === "1",
    voice: readVoiceConfig(appRoot, fileConfig),
  }
}

function readVoiceConfig(appRoot: string, fileConfig: StackConfigFile): StackVoiceConfig {
  const configured = fileConfig.voice ?? {}
  const enabledOverride = process.env.STACK_VOICE_ENABLED?.trim().toLowerCase()
  const enabled =
    enabledOverride === "1" || enabledOverride === "true"
      ? true
      : enabledOverride === "0" || enabledOverride === "false"
        ? false
        : configured.enabled === true
  const envFile = process.env.STACK_VOICE_ENV_FILE ?? configured.env_file
  return {
    enabled,
    sttProvider: readVoiceProvider(
      process.env.STACK_VOICE_STT_PROVIDER ?? configured.stt_provider,
      DEFAULT_VOICE_STT_PROVIDER,
    ),
    sttFallback: readVoiceProvider(
      process.env.STACK_VOICE_STT_FALLBACK ?? configured.stt_fallback,
      DEFAULT_VOICE_STT_FALLBACK,
    ),
    sttModelGroq:
      process.env.STACK_VOICE_STT_MODEL_GROQ ?? configured.stt_model_groq ?? DEFAULT_VOICE_STT_MODEL_GROQ,
    sttModelOpenai:
      process.env.STACK_VOICE_STT_MODEL_OPENAI ?? configured.stt_model_openai ?? DEFAULT_VOICE_STT_MODEL_OPENAI,
    language: process.env.STACK_VOICE_STT_LANGUAGE ?? configured.language ?? DEFAULT_VOICE_LANGUAGE,
    envFile: envFile ? resolveConfigPath(appRoot, envFile) : undefined,
  }
}

function readVoiceProvider(value: string | undefined, fallback: "groq" | "openai"): "groq" | "openai" {
  const normalized = value?.trim().toLowerCase()
  return normalized === "openai" || normalized === "groq" ? normalized : fallback
}

function readConfigFile(appRoot: string): StackConfigFile {
  const path = join(appRoot, "stack.config.json")
  if (!existsSync(path)) return {}
  return JSON.parse(readFileSync(path, "utf8")) as StackConfigFile
}

function resolveConfigPath(appRoot: string, path: string): string {
  return isAbsolute(path) ? path : resolve(appRoot, path)
}

function resolveStackMcpCommand(appRoot: string): string {
  const primary = resolveConfigPath(
    appRoot,
    process.env.STACK_MCP_COMMAND ?? join("bin", "stack-mcp"),
  )
  if (existsSync(primary)) return primary
  const fallbacks = [
    resolve(appRoot, "..", "..", "stack", "bin", "stack-mcp"),
    resolve(appRoot, "..", "stack", "bin", "stack-mcp"),
  ]
  for (const candidate of fallbacks) {
    if (existsSync(candidate)) return candidate
  }
  return primary
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

export function setCursorModel(config: StackConfig, model: string): void {
  config.cursorModel = model
}

export function setCodexReasoningEffort(config: StackConfig, reasoningEffort: string): void {
  config.codexReasoningEffort = reasoningEffort
  refreshCodexArgs(config)
}

export function setCodexSubagentsEnabled(config: StackConfig, enabled: boolean): void {
  config.codexSubagentsEnabled = enabled
  refreshCodexArgs(config)
}

export function setCodexSubagentModel(config: StackConfig, model: string): void {
  config.codexSubagentModel = model
}

export function setCodexSubagentReasoningEffort(config: StackConfig, reasoningEffort: string): void {
  config.codexSubagentReasoningEffort = reasoningEffort
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

export function loadEnvironmentAuth(environment: StackEnvironmentConfig): void {
  if (process.env[environment.authEnv] || !environment.authEnvFile) return
  const value = readEnvFileValue(environment.authEnvFile, environment.authEnv)
  if (!value) return
  process.env[environment.authEnv] = value
  loadedAuthEnvFiles.set(environment.authEnv, environment.authEnvFile)
}

export function isCursorHarness(config: Pick<StackConfig, "harness">): boolean {
  return config.harness === "cursor"
}

export function harnessModel(config: StackConfig): string {
  return isCursorHarness(config) ? config.cursorModel : config.codexModel
}

export function harnessAuthPlan(config: StackConfig): string {
  return isCursorHarness(config) ? config.cursorAuthPlan : config.codexAuthPlan
}

export function setStackHarness(config: StackConfig, harness: StackHarnessKind): void {
  if (!STACK_HARNESS_OPTIONS.includes(harness)) return
  config.harness = harness
}

export function harnessSessionCommand(config: StackConfig): string {
  if (isCursorHarness(config)) {
    return `${config.cursorCommand} agent acp`
  }
  return config.codexArgs.length > 0
    ? `${config.codexCommand} ${config.codexArgs.join(" ")}`
    : config.codexCommand
}

export function refreshCodexArgs(config: StackConfig): void {
  if (config.codexArgsLocked) return
  config.codexArgs = defaultCodexArgs(
    config.codexModel,
    config.codexReasoningEffort,
    config.codexSubagentsEnabled,
    config.stackMcpEnabled ? config.stackMcpCommand : undefined,
    config.environmentName,
  )
}

export function defaultCodexArgs(
  model: string,
  reasoningEffort: string,
  subagentsEnabled: boolean,
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
    "-c",
    `features.multi_agent=${subagentsEnabled ? "true" : "false"}`,
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

function readBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim().length === 0) return fallback
  const normalized = value.trim().toLowerCase()
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false
  throw new Error(`STACK_CODEX_SUBAGENTS=${JSON.stringify(value)} is not supported; expected on/off`)
}

function normalizeOption<T extends string>(
  value: string | undefined,
  options: readonly T[],
  fallback: T,
  label?: string,
): T {
  if (value === undefined || value.trim().length === 0) return fallback
  if (options.includes(value as T)) return value as T
  throw new Error(
    `${label ?? "option"}=${JSON.stringify(value)} is not supported; expected one of ${options.join(", ")}`,
  )
}

function parseCodexModelProfile(value: string | undefined): { model?: string; reasoningEffort?: string } {
  const trimmed = value?.trim()
  if (!trimmed) return {}
  for (const effort of CODEX_REASONING_EFFORT_OPTIONS) {
    const suffix = `-${effort}`
    if (!trimmed.endsWith(suffix)) continue
    const model = trimmed.slice(0, -suffix.length)
    if (CODEX_MODEL_OPTIONS.includes(model as (typeof CODEX_MODEL_OPTIONS)[number])) {
      return { model, reasoningEffort: effort }
    }
  }
  return { model: trimmed }
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

export function stackDataRootFromSessionDir(sessionLogDir: string): string | undefined {
  const normalized = sessionLogDir.replace(/\\/g, "/").replace(/\/+$/, "")
  const suffix = "/.stack/sessions"
  if (normalized.endsWith(suffix)) return normalized.slice(0, -suffix.length)
  return undefined
}

export function sessionHistoryScanDirs(config: Pick<StackConfig, "appRoot" | "sessionLogDir">): string[] {
  const dirs = [config.sessionLogDir]
  const legacy = join(config.appRoot, ".stack", "sessions")
  const normalize = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "")
  if (normalize(legacy) !== normalize(config.sessionLogDir) && existsSync(legacy)) {
    dirs.push(legacy)
  }
  return dirs
}

export function stackDataRootFromSessionPath(sessionPath: string): string | undefined {
  const normalized = sessionPath.replace(/\\/g, "/")
  const marker = "/.stack/sessions/"
  const index = normalized.lastIndexOf(marker)
  if (index >= 0) return normalized.slice(0, index)
  return undefined
}
