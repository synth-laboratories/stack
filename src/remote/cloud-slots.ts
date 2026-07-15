import {
  CLOUD_SLOT_OPTIONS,
  environmentAuthStatus,
  type CloudSlotIdentity,
  type StackConfig,
} from "../config.js"

export type CloudSlotClaim = {
  claimId: string
  holder: string
  purpose: string
  fencingToken: number
  state: string
  expiresAt?: string
}

export type CloudSlotDeployment = {
  cloudSlot: CloudSlotIdentity
  deploymentId: string
  projectId?: string
  name: string
  lifecycle: string
  serviceUrl?: string
  sourceSha?: string
  vmName?: string
  vmDeleted: boolean
  failureReason?: string
  healthStatus?: string
  updatedAt?: string
  retiredAt?: string
  activeClaim?: CloudSlotClaim
  lastFencingToken: number
}

export type CloudSlotsSnapshot = {
  environmentName: string
  apiBaseUrl: string
  selectedCloudSlot?: CloudSlotIdentity
  status: "ready" | "missing-auth" | "offline"
  message: string
  checkedAt: string
  slots: CloudSlotDeployment[]
}

export type CloudSlotActionResult = {
  ok: boolean
  status: number
  message: string
  deployment?: CloudSlotDeployment
  claim?: CloudSlotClaim
}

export function isCloudSlotIdentity(value: unknown): value is CloudSlotIdentity {
  return typeof value === "string" && CLOUD_SLOT_OPTIONS.includes(value as CloudSlotIdentity)
}

export async function readCloudSlotsSnapshot(config: StackConfig): Promise<CloudSlotsSnapshot> {
  const auth = environmentAuthStatus(config.environment)
  const base: CloudSlotsSnapshot = {
    environmentName: config.environmentName,
    apiBaseUrl: config.environment.apiBaseUrl,
    selectedCloudSlot: config.cloudSlot,
    status: auth.hasAuth ? "offline" : "missing-auth",
    message: auth.hasAuth ? "cloud slots not checked" : auth.message,
    checkedAt: new Date().toISOString(),
    slots: [],
  }
  if (!auth.hasAuth) return base

  try {
    const payload = await cloudSlotRequest(config, "/smr/v1/deployments")
    const deployments = asArray(payload)
      .map(readCloudSlotDeployment)
      .filter((row): row is CloudSlotDeployment => Boolean(row))
      .filter((row) => row.lifecycle !== "retired")
    const duplicate = CLOUD_SLOT_OPTIONS.find((cloudSlot) =>
      deployments.filter((row) => row.cloudSlot === cloudSlot).length > 1)
    if (duplicate) {
      throw new Error(`${duplicate} has multiple active CloudDeployment bindings; ownership truth is ambiguous`)
    }
    const claims = await Promise.all(
      deployments.map(async (deployment) => mergeClaimProjection(
        deployment,
        await cloudSlotRequest(
          config,
          `/smr/v1/deployments/${encodeURIComponent(deployment.deploymentId)}/claims`,
        ),
      )),
    )
    return {
      ...base,
      status: "ready",
      message: claims.length > 0 ? `${claims.length} canonical cloud slots` : "no canonical cloud slots bound",
      checkedAt: new Date().toISOString(),
      slots: claims.sort((left, right) => left.cloudSlot.localeCompare(right.cloudSlot)),
    }
  } catch (error) {
    return { ...base, message: errorMessage(error), checkedAt: new Date().toISOString() }
  }
}

export async function observeCloudSlot(
  config: StackConfig,
  cloudSlot: CloudSlotIdentity,
): Promise<CloudSlotActionResult> {
  return deploymentAction(config, cloudSlot, "observe", {})
}

export async function deployCloudSlot(
  config: StackConfig,
  cloudSlot: CloudSlotIdentity,
  options: { reason?: string; fencingToken?: number },
): Promise<CloudSlotActionResult> {
  return deploymentAction(config, cloudSlot, "deploy", { reason: options.reason }, options.fencingToken)
}

export async function retireCloudSlot(
  config: StackConfig,
  cloudSlot: CloudSlotIdentity,
  options: {
    reason?: string
    deleteVm?: boolean
    confirmVmName?: string
    fencingToken?: number
  },
): Promise<CloudSlotActionResult> {
  return deploymentAction(
    config,
    cloudSlot,
    "retire",
    {
      reason: options.reason,
      delete_vm: options.deleteVm ?? false,
      confirm_vm_name: options.confirmVmName,
    },
    options.fencingToken,
  )
}

export async function acquireCloudSlotClaim(
  config: StackConfig,
  cloudSlot: CloudSlotIdentity,
  options: { holder: string; purpose: string; ttlSeconds: number },
): Promise<CloudSlotActionResult> {
  const deployment = await requireCloudSlot(config, cloudSlot)
  return claimAction(
    config,
    deployment,
    "/claims",
    { holder: options.holder, purpose: options.purpose, ttl_seconds: options.ttlSeconds },
  )
}

export async function heartbeatCloudSlotClaim(
  config: StackConfig,
  cloudSlot: CloudSlotIdentity,
  claimId: string,
): Promise<CloudSlotActionResult> {
  const deployment = await requireCloudSlot(config, cloudSlot)
  return claimAction(config, deployment, `/claims/${encodeURIComponent(claimId)}/heartbeat`, {})
}

export async function releaseCloudSlotClaim(
  config: StackConfig,
  cloudSlot: CloudSlotIdentity,
  claimId: string,
): Promise<CloudSlotActionResult> {
  const deployment = await requireCloudSlot(config, cloudSlot)
  return claimAction(config, deployment, `/claims/${encodeURIComponent(claimId)}/release`, {})
}

async function deploymentAction(
  config: StackConfig,
  cloudSlot: CloudSlotIdentity,
  action: "observe" | "deploy" | "retire",
  body: Record<string, unknown>,
  fencingToken?: number,
): Promise<CloudSlotActionResult> {
  const deployment = await requireCloudSlot(config, cloudSlot)
  try {
    const raw = await cloudSlotRequest(
      config,
      `/smr/v1/deployments/${encodeURIComponent(deployment.deploymentId)}/${action}`,
      {
        method: "POST",
        body: action === "observe" ? undefined : body,
        fencingToken,
      },
    )
    const updated = readCloudSlotDeployment(raw)
    return {
      ok: true,
      status: 200,
      message: `${cloudSlot} ${action} accepted`,
      deployment: updated ?? deployment,
    }
  } catch (error) {
    return actionError(error)
  }
}

async function claimAction(
  config: StackConfig,
  deployment: CloudSlotDeployment,
  suffix: string,
  body: Record<string, unknown>,
): Promise<CloudSlotActionResult> {
  try {
    const raw = await cloudSlotRequest(
      config,
      `/smr/v1/deployments/${encodeURIComponent(deployment.deploymentId)}${suffix}`,
      { method: "POST", body: Object.keys(body).length > 0 ? body : undefined },
    )
    return {
      ok: true,
      status: 200,
      message: `${deployment.cloudSlot} claim action accepted`,
      deployment,
      claim: readCloudSlotClaim(raw),
    }
  } catch (error) {
    return actionError(error)
  }
}

async function requireCloudSlot(
  config: StackConfig,
  cloudSlot: CloudSlotIdentity,
): Promise<CloudSlotDeployment> {
  const snapshot = await readCloudSlotsSnapshot(config)
  if (snapshot.status !== "ready") throw new Error(snapshot.message)
  const deployment = snapshot.slots.find((row) => row.cloudSlot === cloudSlot)
  if (!deployment) throw new Error(`${cloudSlot} is not bound to an active CloudDeployment`)
  return deployment
}

async function cloudSlotRequest(
  config: StackConfig,
  path: string,
  options: { method?: "GET" | "POST"; body?: Record<string, unknown>; fencingToken?: number } = {},
): Promise<unknown> {
  const auth = environmentAuthStatus(config.environment)
  const token = process.env[config.environment.authEnv]
  if (!auth.hasAuth || !token) throw new Error(auth.message)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  }
  if (options.body) headers["Content-Type"] = "application/json"
  if (options.fencingToken !== undefined) headers["X-Fencing-Token"] = String(options.fencingToken)
  const response = await fetch(`${config.environment.apiBaseUrl.replace(/\/+$/, "")}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(dropUndefined(options.body)) : undefined,
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  const payload = parsePayload(text)
  if (!response.ok) {
    const error = new Error(`${path} ${response.status} ${response.statusText}: ${payloadMessage(payload)}`)
    Object.assign(error, { status: response.status, payload })
    throw error
  }
  return payload
}

function readCloudSlotDeployment(value: unknown): CloudSlotDeployment | undefined {
  const row = asRecord(value)
  const cloudSlot = row?.cloud_slot
  const deploymentId = readString(row?.deployment_id)
  if (!row || !isCloudSlotIdentity(cloudSlot) || !deploymentId) return undefined
  const metadata = asRecord(row.metadata)
  const requestPayload = asRecord(row.request_payload)
  const source = asRecord(requestPayload?.source) ?? asRecord(metadata?.source)
  const health = asRecord(row.health)
  return {
    cloudSlot,
    deploymentId,
    projectId: readString(row.project_id),
    name: readString(row.name) ?? cloudSlot,
    lifecycle: readString(row.state) ?? "unknown",
    serviceUrl: readString(row.service_url),
    sourceSha: readString(source?.source_commit_sha) ?? readString(metadata?.source_commit_sha),
    vmName: readString(row.vm_name),
    vmDeleted: readBoolean(row.vm_deleted) ?? false,
    failureReason: readString(row.failure_reason),
    healthStatus: readString(health?.status) ?? readString(health?.state),
    updatedAt: readString(row.updated_at),
    retiredAt: readString(row.retired_at),
    lastFencingToken: 0,
  }
}

function mergeClaimProjection(deployment: CloudSlotDeployment, value: unknown): CloudSlotDeployment {
  const projection = asRecord(value)
  return {
    ...deployment,
    activeClaim: readCloudSlotClaim(projection?.active_claim),
    lastFencingToken: readNumber(projection?.last_fencing_token) ?? 0,
  }
}

function readCloudSlotClaim(value: unknown): CloudSlotClaim | undefined {
  const row = asRecord(value)
  const claimId = readString(row?.claim_id)
  const holder = readString(row?.holder)
  const purpose = readString(row?.purpose)
  const fencingToken = readNumber(row?.fencing_token)
  if (!row || !claimId || !holder || !purpose || fencingToken === undefined) return undefined
  return {
    claimId,
    holder,
    purpose,
    fencingToken,
    state: readString(row.state) ?? "unknown",
    expiresAt: readString(row.expires_at),
  }
}

function actionError(error: unknown): CloudSlotActionResult {
  const status = readNumber(asRecord(error)?.status) ?? 0
  return { ok: false, status, message: errorMessage(error) }
}

function parsePayload(text: string): unknown {
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function payloadMessage(value: unknown): string {
  if (typeof value === "string") return value
  const row = asRecord(value)
  const detail = asRecord(row?.detail)
  return readString(row?.detail) ??
    readString(detail?.message) ??
    readString(detail?.error_code) ??
    readString(row?.message) ??
    "request failed"
}

function dropUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  const row = asRecord(value)
  return Array.isArray(row?.items) ? row.items : []
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
