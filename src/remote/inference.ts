import { environmentAuthStatus, type StackConfig } from "../config.js"

export type RemoteInferenceCatalogStatus = "ready" | "partial" | "missing-auth" | "offline"
export type RemoteInferenceLane = "free_aux" | "billed_glm"
export type RemoteInferenceBillingTier = "free_aux" | "billed"
export type RemoteInferenceAvailability = "available" | "requires_auth" | "catalog_pending"

export type RemoteInferencePricing = {
  inputUsd?: number
  cachedInputUsd?: number
  outputUsd?: number
  reasoningOutputUsd?: number
  source?: string
}

export type RemoteInferenceModel = {
  id: string
  displayName: string
  description?: string
  lane: RemoteInferenceLane
  billingTier: RemoteInferenceBillingTier
  provider: string
  source: "synth_models" | "smr_agent_models" | "stack_policy"
  route: string
  wire?: string
  actorRoles: string[]
  blockedActorRoles: string[]
  aliases: string[]
  contextWindowTokens?: number
  usageRequired?: boolean
  pricingPresent?: boolean
  pricing?: RemoteInferencePricing
  promo?: Record<string, unknown>
  availability: RemoteInferenceAvailability
  workerOptInRequired: boolean
}

export type RemoteInferenceCatalogSnapshot = {
  status: RemoteInferenceCatalogStatus
  environmentName: string
  apiBaseUrl: string
  checkedAt: string
  message?: string
  requiresAuth: boolean
  localOnlySupported: boolean
  workerDefault: "codex_byok"
  workerSynthInference: "explicit_profile_only"
  models: RemoteInferenceModel[]
  errors: string[]
}

export function emptyRemoteInferenceCatalog(
  config: StackConfig,
  status: RemoteInferenceCatalogStatus = "offline",
  message?: string,
): RemoteInferenceCatalogSnapshot {
  return {
    status,
    environmentName: config.environmentName,
    apiBaseUrl: config.environment.apiBaseUrl,
    checkedAt: new Date().toISOString(),
    message,
    requiresAuth: true,
    localOnlySupported: true,
    workerDefault: "codex_byok",
    workerSynthInference: "explicit_profile_only",
    models: policyModels(status === "missing-auth" ? "requires_auth" : "catalog_pending"),
    errors: [],
  }
}

export async function readRemoteInferenceCatalog(config: StackConfig): Promise<RemoteInferenceCatalogSnapshot> {
  const auth = environmentAuthStatus(config.environment)
  const base = emptyRemoteInferenceCatalog(
    config,
    auth.hasAuth ? "offline" : "missing-auth",
    auth.hasAuth ? "not checked yet" : auth.message,
  )
  if (!auth.hasAuth) return base

  const [synthModelsResult, smrModelsResult] = await Promise.allSettled([
    getJson(config, "/api/v1/synth/models"),
    getJson(config, "/smr/agent-models"),
  ])
  const errors: string[] = []
  const models = new Map<string, RemoteInferenceModel>(
    policyModels("catalog_pending").map((model) => [model.id, model]),
  )
  let readyCatalogs = 0

  if (synthModelsResult.status === "fulfilled") {
    readyCatalogs += 1
    for (const model of readSynthModels(synthModelsResult.value)) {
      models.set(model.id, model)
    }
  } else {
    errors.push(`synth models: ${errorMessage(synthModelsResult.reason)}`)
  }

  if (smrModelsResult.status === "fulfilled") {
    readyCatalogs += 1
    const glmModel = readSmrGlmModel(smrModelsResult.value)
    if (glmModel) models.set(glmModel.id, glmModel)
  } else {
    errors.push(`SMR agent models: ${errorMessage(smrModelsResult.reason)}`)
  }

  const status: RemoteInferenceCatalogStatus =
    readyCatalogs === 2 ? "ready" : readyCatalogs > 0 ? "partial" : "offline"
  const readyCount = [...models.values()].filter((model) => model.availability === "available").length
  const message =
    status === "ready"
      ? `${readyCount} Synth inference catalog model(s) loaded`
      : status === "partial"
        ? `partial Synth inference catalog; ${readyCount} model(s) loaded`
        : "Synth inference catalog unavailable"

  return {
    ...base,
    status,
    checkedAt: new Date().toISOString(),
    message,
    models: [...models.values()].sort((left, right) => laneOrder(left.lane) - laneOrder(right.lane)),
    errors,
  }
}

function policyModels(availability: RemoteInferenceAvailability): RemoteInferenceModel[] {
  return [
    {
      id: "nemotron-3-ultra",
      displayName: "Nemotron 3 Ultra (Synth aux)",
      description: "Free promo inference for Stack sidekick agents only",
      lane: "free_aux",
      billingTier: "free_aux",
      provider: "baseten",
      source: "stack_policy",
      route: "/api/v1/stack-aux/openai/v1/responses",
      wire: "openai_responses",
      actorRoles: ["monitor", "gardener", "aux"],
      blockedActorRoles: ["worker", "primary", "codex", "cursor"],
      aliases: [],
      contextWindowTokens: 128000,
      promo: {
        enabled: true,
        tier: "free_aux",
        synth_wide_cap_usd: 200,
        per_org_daily_cap_usd: 20,
      },
      availability,
      workerOptInRequired: false,
    },
    {
      id: "baseten/zai-org/GLM-5.2",
      displayName: "GLM 5.2 (Baseten)",
      description: "Billed Synth inference catalog model; primary worker requires explicit profile opt-in",
      lane: "billed_glm",
      billingTier: "billed",
      provider: "baseten",
      source: "stack_policy",
      route: "/api/v1/stack-inference/openai/v1/responses",
      wire: "openai_responses",
      actorRoles: ["monitor", "gardener", "remote_gardener", "worker_opt_in"],
      blockedActorRoles: ["worker_without_explicit_profile"],
      aliases: ["glm-5.2", "baseten-glm-5.2"],
      contextWindowTokens: 262144,
      usageRequired: true,
      pricingPresent: true,
      availability,
      workerOptInRequired: true,
    },
  ]
}

function readSynthModels(payload: unknown): RemoteInferenceModel[] {
  const rows = asArray(asRecord(payload)?.data)
  const models: RemoteInferenceModel[] = []
  for (const entry of rows) {
    const record = asRecord(entry)
    if (!record) continue
    const id = readString(record.id)
    if (!id) continue
    const lane: RemoteInferenceLane = id.includes("nemotron") ? "free_aux" : "billed_glm"
    const promo = asRecord(record.promo)
    const billing = asRecord(record.billing)
    const blockedActorRoles = readStringArray(record.blocked_actor_roles)
    const workerBlocked = blockedActorRoles.some((role) =>
      ["worker", "primary", "codex", "cursor"].includes(role),
    )
    models.push({
      id,
      displayName: readString(record.display_name) ?? id,
      description: readString(record.description),
      lane,
      billingTier: readString(promo?.tier) === "free_aux" ? "free_aux" : "billed",
      provider: "baseten",
      source: "synth_models",
      route: readString(record.inference_path) ?? "/api/v1/synth/models",
      wire: readString(record.wire),
      actorRoles: readStringArray(record.actor_roles),
      blockedActorRoles,
      aliases: readStringArray(record.aliases),
      contextWindowTokens: readNumber(record.context_window_default) ?? readNumber(record.context_window_tokens),
      usageRequired: readBoolean(record.usage_required),
      pricingPresent: readBoolean(record.pricing_present) ?? Boolean(billing),
      pricing: readPricing(record.pricing) ?? readBillingPricing(billing),
      promo: promo ? { ...promo } : undefined,
      availability: "available",
      workerOptInRequired: !workerBlocked && lane === "billed_glm",
    })
  }
  return models
}

function readSmrGlmModel(payload: unknown): RemoteInferenceModel | undefined {
  const rows = asArray(asRecord(payload)?.models)
  for (const entry of rows) {
    const record = asRecord(entry)
    if (!record) continue
    const id = readString(record.id)
    const aliases = readStringArray(record.aliases)
    if (id !== "baseten/zai-org/GLM-5.2" && !aliases.includes("glm-5.2")) continue
    return {
      id: id ?? "baseten/zai-org/GLM-5.2",
      displayName: readString(record.display_name) ?? "GLM 5.2 (Baseten)",
      lane: "billed_glm",
      billingTier: "billed",
      provider: readString(record.provider) ?? "baseten",
      source: "smr_agent_models",
      route: "/api/v1/stack-inference/openai/v1/responses",
      wire: "openai_responses",
      actorRoles: ["monitor", "gardener", "remote_gardener", "worker_opt_in"],
      blockedActorRoles: ["worker_without_explicit_profile"],
      aliases,
      contextWindowTokens: readNumber(record.context_window_tokens),
      usageRequired: readBoolean(record.usage_required),
      pricingPresent: readBoolean(record.pricing_present),
      pricing: readPricing(record.pricing),
      availability: "available",
      workerOptInRequired: true,
    }
  }
  return undefined
}

async function getJson(config: StackConfig, path: string): Promise<unknown> {
  const token = process.env[config.environment.authEnv]
  const response = await fetch(`${config.environment.apiBaseUrl.replace(/\/+$/, "")}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(3500),
  })
  if (response.status === 401 || response.status === 403) {
    throw new Error(`${path} ${response.status} auth rejected`)
  }
  if (!response.ok) throw new Error(`${path} ${response.status} ${response.statusText}`)
  return await response.json()
}

function readPricing(value: unknown): RemoteInferencePricing | undefined {
  const record = asRecord(value)
  if (!record) return undefined
  return {
    inputUsd: readNumber(record.input_usd),
    cachedInputUsd: readNumber(record.cached_input_usd),
    outputUsd: readNumber(record.output_usd),
    reasoningOutputUsd: readNumber(record.reasoning_output_usd),
    source: readString(record.source),
  }
}

function readBillingPricing(value: unknown): RemoteInferencePricing | undefined {
  const record = asRecord(value)
  if (!record) return undefined
  return {
    inputUsd: perMillionToTokenUsd(readNumber(record.input_usd_per_1m)),
    outputUsd: perMillionToTokenUsd(readNumber(record.output_usd_per_1m)),
    source: readString(record.provider) ? "synth_models_billing" : undefined,
  }
}

function perMillionToTokenUsd(value: number | undefined): number | undefined {
  return value === undefined ? undefined : value / 1_000_000
}

function laneOrder(lane: RemoteInferenceLane): number {
  if (lane === "free_aux") return 0
  return 1
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function readStringArray(value: unknown): string[] {
  return asArray(value)
    .map((item) => readString(item))
    .filter((item): item is string => Boolean(item))
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string" || value.trim().length === 0) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
