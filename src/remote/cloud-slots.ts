import {
  CLOUD_SLOT_OPTIONS,
  environmentAuthStatus,
  type CloudSlotIdentity,
  type StackConfig,
} from "../config.js"

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const MATERIALIZATION_REQUEST_TIMEOUT_MS = 930_000

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
  lastFencingToken: number | null
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

export type CloudSlotService = {
  serviceId: string
  kind: string
  required: boolean
  endpoint?: string
  healthChecks: Record<string, unknown>[]
  logsSupported: boolean
}

export type CloudSlotServices = {
  schemaVersion: "cloud-deployment-services-v1"
  deploymentId: string
  vmName: string
  serviceUrl?: string
  services: CloudSlotService[]
  deploymentHealth: Record<string, unknown>
}

export type CloudSlotWorkspaceLiveState = {
  available: boolean
  headCommitSha?: string
  branch?: string
  detached: boolean
  dirtyPathCount?: number
}

export type CloudSlotWorkspaceRepository = {
  repository: string
  path: string
  remoteRepo: string
  declaredBranch: string
  declaredSourceCommitSha: string
  authority: string
  live: CloudSlotWorkspaceLiveState
}

export type CloudSlotWorkspace = {
  schemaVersion: "cloud-deployment-workspace-v1"
  deploymentId: string
  vmName: string
  workspaceRoot: string
  repositories: CloudSlotWorkspaceRepository[]
}

export type CloudSlotWorkspaceMaterialization = {
  schemaVersion: "cloud-deployment-workspace-materialization-v1"
  deploymentId: string
  vmName: string
  repository: string
  path: string
  branch: string
  sourceCommitSha: string
  clean: boolean
  detached: boolean
}

export type CloudSlotExecResult = {
  schemaVersion: "cloud-deployment-exec-v1"
  deploymentId: string
  vmName: string
  workingDirectory: string
  argvCount: number
  timeoutSeconds: number
  exitCode: number
  stdout: string
  stderr: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
}

export type CloudSlotLogs = {
  schemaVersion: "cloud-deployment-logs-v1"
  deploymentId: string
  vmName: string
  serviceId: string
  tail: number
  exitCode: number
  stdout: string
  stderr: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
}

export type CloudSlotArtifactRoot = {
  rootId: string
  repository: string
  path: string
  relativePath: string
  description: string
  authority: string
  available: boolean
  prefixAvailable: boolean
}

export type CloudSlotArtifactDescriptor = {
  rootId: string
  relativePath: string
  sizeBytes: number
  modifiedAtEpochSeconds: number
}

export type CloudSlotArtifacts = {
  schemaVersion: "cloud-deployment-artifacts-v1"
  deploymentId: string
  vmName: string
  relativePrefix: string
  roots: CloudSlotArtifactRoot[]
  artifacts: CloudSlotArtifactDescriptor[]
  truncated: boolean
  nextAfter?: string
}

export type CloudSlotArtifactContent = {
  schemaVersion: "cloud-deployment-artifact-content-v1"
  deploymentId: string
  vmName: string
  rootId: string
  relativePath: string
  sizeBytes: number
  sha256?: string
  modifiedAtNs: string
  contentType: string
  encoding: "base64"
  offset: number
  bytesReturned: number
  eof: boolean
  contentBase64: string
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

export async function readCloudSlotServices(
  config: StackConfig,
  cloudSlot: CloudSlotIdentity,
): Promise<CloudSlotServices> {
  const deployment = await requireCloudSlot(config, cloudSlot)
  const value = await cloudSlotRequest(
    config,
    `/smr/v1/deployments/${encodeURIComponent(deployment.deploymentId)}/services`,
  )
  return parseCloudSlotServices(value, deployment)
}

export async function readCloudSlotWorkspace(
  config: StackConfig,
  cloudSlot: CloudSlotIdentity,
): Promise<CloudSlotWorkspace> {
  const deployment = await requireCloudSlot(config, cloudSlot)
  const value = await cloudSlotRequest(
    config,
    `/smr/v1/deployments/${encodeURIComponent(deployment.deploymentId)}/workspace`,
  )
  return parseCloudSlotWorkspace(value, deployment)
}

export async function materializeCloudSlotWorkspace(
  config: StackConfig,
  cloudSlot: CloudSlotIdentity,
  options: {
    repository: string
    branch: string
    sourceCommitSha: string
    fencingToken: number
  },
): Promise<CloudSlotWorkspaceMaterialization> {
  const deployment = await requireFencedCloudSlot(config, cloudSlot, options.fencingToken)
  const value = await cloudSlotRequest(
    config,
    `/smr/v1/deployments/${encodeURIComponent(deployment.deploymentId)}/workspace/materialize`,
    {
      method: "POST",
      body: {
        repository: options.repository,
        branch: options.branch,
        source_commit_sha: options.sourceCommitSha,
      },
      fencingToken: options.fencingToken,
      timeoutMs: MATERIALIZATION_REQUEST_TIMEOUT_MS,
    },
  )
  return parseCloudSlotWorkspaceMaterialization(value, deployment)
}

export async function execCloudSlot(
  config: StackConfig,
  cloudSlot: CloudSlotIdentity,
  options: {
    argv: string[]
    cwd?: string
    timeoutSeconds: number
    maxOutputBytes: number
    fencingToken: number
  },
): Promise<CloudSlotExecResult> {
  const deployment = await requireFencedCloudSlot(config, cloudSlot, options.fencingToken)
  const value = await cloudSlotRequest(
    config,
    `/smr/v1/deployments/${encodeURIComponent(deployment.deploymentId)}/exec`,
    {
      method: "POST",
      body: {
        argv: options.argv,
        cwd: options.cwd,
        timeout_seconds: options.timeoutSeconds,
        max_output_bytes: options.maxOutputBytes,
      },
      fencingToken: options.fencingToken,
      timeoutMs: options.timeoutSeconds * 1000 + DEFAULT_REQUEST_TIMEOUT_MS,
    },
  )
  return parseCloudSlotExecResult(value, deployment)
}

export async function readCloudSlotLogs(
  config: StackConfig,
  cloudSlot: CloudSlotIdentity,
  options: { serviceId: string; tail: number },
): Promise<CloudSlotLogs> {
  const deployment = await requireCloudSlot(config, cloudSlot)
  const query = new URLSearchParams({ service_id: options.serviceId, tail: String(options.tail) })
  const value = await cloudSlotRequest(
    config,
    `/smr/v1/deployments/${encodeURIComponent(deployment.deploymentId)}/logs?${query.toString()}`,
  )
  return parseCloudSlotLogs(value, deployment)
}

export async function readCloudSlotArtifacts(
  config: StackConfig,
  cloudSlot: CloudSlotIdentity,
  options: { rootId?: string; relativePrefix?: string; after?: string; limit: number },
): Promise<CloudSlotArtifacts> {
  const deployment = await requireCloudSlot(config, cloudSlot)
  const query = new URLSearchParams({ limit: String(options.limit) })
  if (options.rootId) query.set("root_id", options.rootId)
  if (options.relativePrefix) query.set("relative_prefix", options.relativePrefix)
  if (options.after) query.set("after", options.after)
  const value = await cloudSlotRequest(
    config,
    `/smr/v1/deployments/${encodeURIComponent(deployment.deploymentId)}/artifacts?${query.toString()}`,
  )
  return parseCloudSlotArtifacts(value, deployment, options)
}

export async function readCloudSlotArtifactContent(
  config: StackConfig,
  cloudSlot: CloudSlotIdentity,
  options: {
    rootId: string
    relativePath: string
    offset: number
    maxBytes: number
    includeSha256: boolean
  },
): Promise<CloudSlotArtifactContent> {
  const deployment = await requireCloudSlot(config, cloudSlot)
  const query = new URLSearchParams({
    root_id: options.rootId,
    relative_path: options.relativePath,
    offset: String(options.offset),
    max_bytes: String(options.maxBytes),
    include_sha256: String(options.includeSha256),
  })
  const value = await cloudSlotRequest(
    config,
    `/smr/v1/deployments/${encodeURIComponent(deployment.deploymentId)}/artifacts/content?${query.toString()}`,
    { preserveIntegerFields: ["modified_at_ns"] },
  )
  return parseCloudSlotArtifactContent(value, deployment, options)
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

async function requireFencedCloudSlot(
  config: StackConfig,
  cloudSlot: CloudSlotIdentity,
  fencingToken: number,
): Promise<CloudSlotDeployment> {
  const deployment = await requireCloudSlot(config, cloudSlot)
  if (!deployment.activeClaim) {
    throw new Error(`${cloudSlot} has no active claim; acquire a claim before mutating its workspace`)
  }
  if (deployment.activeClaim.fencingToken !== fencingToken) {
    throw new Error(`${cloudSlot} fencing token does not match its active claim`)
  }
  return deployment
}

async function cloudSlotRequest(
  config: StackConfig,
  path: string,
  options: {
    method?: "GET" | "POST"
    body?: Record<string, unknown>
    fencingToken?: number
    timeoutMs?: number
    preserveIntegerFields?: string[]
  } = {},
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
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS),
  })
  const text = await response.text()
  const payload = parsePayload(text, options.preserveIntegerFields)
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
  const source = asRecord(requestPayload?.resolved_source) ??
    asRecord(requestPayload?.source) ??
    asRecord(metadata?.source)
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
    lastFencingToken: null,
  }
}

function mergeClaimProjection(deployment: CloudSlotDeployment, value: unknown): CloudSlotDeployment {
  const projection = asRecord(value)
  if (!projection) {
    throw new Error(`${deployment.cloudSlot} claim projection is not an object`)
  }
  if (readString(projection.deployment_id) !== deployment.deploymentId) {
    throw new Error(`${deployment.cloudSlot} claim projection deployment_id does not match its CloudDeployment`)
  }
  if (!Object.hasOwn(projection, "active_claim")) {
    throw new Error(`${deployment.cloudSlot} claim projection is missing active_claim`)
  }
  if (!Object.hasOwn(projection, "last_fencing_token")) {
    throw new Error(`${deployment.cloudSlot} claim projection is missing last_fencing_token`)
  }
  const activeClaimValue = projection.active_claim
  const activeClaim = activeClaimValue === null ? undefined : readCloudSlotClaim(activeClaimValue)
  if (activeClaimValue !== null && !activeClaim) {
    throw new Error(`${deployment.cloudSlot} claim projection has malformed active_claim`)
  }
  const lastFencingTokenValue = projection.last_fencing_token
  let lastFencingToken: number | null
  if (lastFencingTokenValue === null) {
    lastFencingToken = null
  } else {
    const parsed = readNonNegativeInteger(lastFencingTokenValue)
    if (parsed === undefined) {
      throw new Error(`${deployment.cloudSlot} claim projection has malformed last_fencing_token`)
    }
    lastFencingToken = parsed
  }
  return {
    ...deployment,
    activeClaim,
    lastFencingToken,
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

function parseCloudSlotServices(value: unknown, deployment: CloudSlotDeployment): CloudSlotServices {
  const row = requireProjection(value, "cloud-deployment-services-v1", deployment)
  const services = requireArray(row.services, "services").map((value, index) => {
    const service = requireRecord(value, `services[${index}]`)
    return {
      serviceId: requireString(service.service_id, `services[${index}].service_id`),
      kind: requireString(service.kind, `services[${index}].kind`),
      required: requireBoolean(service.required, `services[${index}].required`),
      endpoint: optionalProjectionString(service.endpoint, `services[${index}].endpoint`),
      healthChecks: requireArray(service.health_checks, `services[${index}].health_checks`)
        .map((check, checkIndex) => requireRecord(check, `services[${index}].health_checks[${checkIndex}]`)),
      logsSupported: requireBoolean(service.logs_supported, `services[${index}].logs_supported`),
    }
  })
  return {
    schemaVersion: "cloud-deployment-services-v1",
    deploymentId: deployment.deploymentId,
    vmName: requireString(row.vm_name, "vm_name"),
    serviceUrl: optionalProjectionString(row.service_url, "service_url"),
    services,
    deploymentHealth: requireRecord(row.deployment_health, "deployment_health"),
  }
}

function parseCloudSlotWorkspace(value: unknown, deployment: CloudSlotDeployment): CloudSlotWorkspace {
  const row = requireProjection(value, "cloud-deployment-workspace-v1", deployment)
  const repositories = requireArray(row.repositories, "repositories").map((value, index) => {
    const repository = requireRecord(value, `repositories[${index}]`)
    const live = requireRecord(repository.live, `repositories[${index}].live`)
    return {
      repository: requireString(repository.repository, `repositories[${index}].repository`),
      path: requireString(repository.path, `repositories[${index}].path`),
      remoteRepo: requireString(repository.remote_repo, `repositories[${index}].remote_repo`),
      declaredBranch: requireString(repository.declared_branch, `repositories[${index}].declared_branch`),
      declaredSourceCommitSha: requireString(
        repository.declared_source_commit_sha,
        `repositories[${index}].declared_source_commit_sha`,
      ),
      authority: requireString(repository.authority, `repositories[${index}].authority`),
      live: {
        available: requireBoolean(live.available, `repositories[${index}].live.available`),
        headCommitSha: optionalProjectionString(
          live.head_commit_sha,
          `repositories[${index}].live.head_commit_sha`,
        ),
        branch: optionalProjectionString(live.branch, `repositories[${index}].live.branch`),
        detached: requireBoolean(live.detached, `repositories[${index}].live.detached`),
        dirtyPathCount: optionalProjectionInteger(
          live.dirty_path_count,
          `repositories[${index}].live.dirty_path_count`,
        ),
      },
    }
  })
  return {
    schemaVersion: "cloud-deployment-workspace-v1",
    deploymentId: deployment.deploymentId,
    vmName: requireString(row.vm_name, "vm_name"),
    workspaceRoot: requireString(row.workspace_root, "workspace_root"),
    repositories,
  }
}

function parseCloudSlotWorkspaceMaterialization(
  value: unknown,
  deployment: CloudSlotDeployment,
): CloudSlotWorkspaceMaterialization {
  const row = requireProjection(value, "cloud-deployment-workspace-materialization-v1", deployment)
  return {
    schemaVersion: "cloud-deployment-workspace-materialization-v1",
    deploymentId: deployment.deploymentId,
    vmName: requireString(row.vm_name, "vm_name"),
    repository: requireString(row.repository, "repository"),
    path: requireString(row.path, "path"),
    branch: requireString(row.branch, "branch"),
    sourceCommitSha: requireString(row.source_commit_sha, "source_commit_sha"),
    clean: requireBoolean(row.clean, "clean"),
    detached: requireBoolean(row.detached, "detached"),
  }
}

function parseCloudSlotExecResult(value: unknown, deployment: CloudSlotDeployment): CloudSlotExecResult {
  const row = requireProjection(value, "cloud-deployment-exec-v1", deployment)
  return {
    schemaVersion: "cloud-deployment-exec-v1",
    deploymentId: deployment.deploymentId,
    vmName: requireString(row.vm_name, "vm_name"),
    workingDirectory: requireString(row.working_directory, "working_directory"),
    argvCount: requireInteger(row.argv_count, "argv_count"),
    timeoutSeconds: requireNumber(row.timeout_seconds, "timeout_seconds"),
    exitCode: requireInteger(row.exit_code, "exit_code"),
    stdout: requireProjectionString(row.stdout, "stdout"),
    stderr: requireProjectionString(row.stderr, "stderr"),
    stdoutTruncated: requireBoolean(row.stdout_truncated, "stdout_truncated"),
    stderrTruncated: requireBoolean(row.stderr_truncated, "stderr_truncated"),
  }
}

function parseCloudSlotLogs(value: unknown, deployment: CloudSlotDeployment): CloudSlotLogs {
  const row = requireProjection(value, "cloud-deployment-logs-v1", deployment)
  return {
    schemaVersion: "cloud-deployment-logs-v1",
    deploymentId: deployment.deploymentId,
    vmName: requireString(row.vm_name, "vm_name"),
    serviceId: requireString(row.service_id, "service_id"),
    tail: requireInteger(row.tail, "tail"),
    exitCode: requireInteger(row.exit_code, "exit_code"),
    stdout: requireProjectionString(row.stdout, "stdout"),
    stderr: requireProjectionString(row.stderr, "stderr"),
    stdoutTruncated: requireBoolean(row.stdout_truncated, "stdout_truncated"),
    stderrTruncated: requireBoolean(row.stderr_truncated, "stderr_truncated"),
  }
}

function parseCloudSlotArtifacts(
  value: unknown,
  deployment: CloudSlotDeployment,
  expected: { rootId?: string; relativePrefix?: string; after?: string; limit: number },
): CloudSlotArtifacts {
  const row = requireProjection(value, "cloud-deployment-artifacts-v1", deployment)
  const roots = requireArray(row.roots, "roots").map((value, index) => {
    const root = requireRecord(value, `roots[${index}]`)
    return {
      rootId: requireString(root.root_id, `roots[${index}].root_id`),
      repository: requireString(root.repository, `roots[${index}].repository`),
      path: requireString(root.path, `roots[${index}].path`),
      relativePath: requireProjectionString(root.relative_path, `roots[${index}].relative_path`),
      description: requireString(root.description, `roots[${index}].description`),
      authority: requireString(root.authority, `roots[${index}].authority`),
      available: requireBoolean(root.available, `roots[${index}].available`),
      prefixAvailable: requireBoolean(root.prefix_available, `roots[${index}].prefix_available`),
    }
  })
  const artifacts = requireArray(row.artifacts, "artifacts").map((value, index) => {
    const artifact = requireRecord(value, `artifacts[${index}]`)
    return {
      rootId: requireString(artifact.root_id, `artifacts[${index}].root_id`),
      relativePath: requireString(artifact.relative_path, `artifacts[${index}].relative_path`),
      sizeBytes: requireNonNegativeInteger(artifact.size_bytes, `artifacts[${index}].size_bytes`),
      modifiedAtEpochSeconds: requireNumber(
        artifact.modified_at_epoch_seconds,
        `artifacts[${index}].modified_at_epoch_seconds`,
      ),
    }
  })
  const relativePrefix = requireProjectionString(row.relative_prefix, "relative_prefix")
  if (relativePrefix !== (expected.relativePrefix ?? "")) {
    throw new Error(`${deployment.cloudSlot} artifact projection relative_prefix does not match its request`)
  }
  if (expected.rootId && artifacts.some((artifact) => artifact.rootId !== expected.rootId)) {
    throw new Error(`${deployment.cloudSlot} artifact inventory returned an unexpected root`)
  }
  const truncated = requireBoolean(row.truncated, "truncated")
  const nextAfter = optionalProjectionString(row.next_after, "next_after")
  if (truncated && !nextAfter) {
    throw new Error(`${deployment.cloudSlot} truncated artifact inventory is missing next_after`)
  }
  if (artifacts.length > expected.limit) {
    throw new Error(`${deployment.cloudSlot} artifact inventory exceeded its requested limit`)
  }
  return {
    schemaVersion: "cloud-deployment-artifacts-v1",
    deploymentId: deployment.deploymentId,
    vmName: requireString(row.vm_name, "vm_name"),
    relativePrefix,
    roots,
    artifacts,
    truncated,
    nextAfter,
  }
}

function parseCloudSlotArtifactContent(
  value: unknown,
  deployment: CloudSlotDeployment,
  expected: { rootId: string; relativePath: string; offset: number; maxBytes: number },
): CloudSlotArtifactContent {
  const row = requireProjection(value, "cloud-deployment-artifact-content-v1", deployment)
  const rootId = requireString(row.root_id, "root_id")
  const relativePath = requireString(row.relative_path, "relative_path")
  const offset = requireNonNegativeInteger(row.offset, "offset")
  const bytesReturned = requireNonNegativeInteger(row.bytes_returned, "bytes_returned")
  const contentBase64 = requireProjectionString(row.content_base64, "content_base64")
  const contentBytes = requireCanonicalBase64(contentBase64, "content_base64")
  if (rootId !== expected.rootId || relativePath !== expected.relativePath || offset !== expected.offset) {
    throw new Error(`${deployment.cloudSlot} artifact content projection does not match its request`)
  }
  if (bytesReturned > expected.maxBytes || contentBytes.length !== bytesReturned) {
    throw new Error(`${deployment.cloudSlot} artifact content violates its declared byte bound`)
  }
  if (row.encoding !== "base64") {
    throw new Error(`${deployment.cloudSlot} artifact content encoding must be base64`)
  }
  return {
    schemaVersion: "cloud-deployment-artifact-content-v1",
    deploymentId: deployment.deploymentId,
    vmName: requireString(row.vm_name, "vm_name"),
    rootId,
    relativePath,
    sizeBytes: requireNonNegativeInteger(row.size_bytes, "size_bytes"),
    sha256: optionalProjectionString(row.sha256, "sha256"),
    modifiedAtNs: requireNonNegativeIntegerString(row.modified_at_ns, "modified_at_ns"),
    contentType: requireString(row.content_type, "content_type"),
    encoding: "base64",
    offset,
    bytesReturned,
    eof: requireBoolean(row.eof, "eof"),
    contentBase64,
  }
}

function requireProjection(
  value: unknown,
  schemaVersion: string,
  deployment: CloudSlotDeployment,
): Record<string, unknown> {
  const row = requireRecord(value, schemaVersion)
  if (row.schema_version !== schemaVersion) {
    throw new Error(`${deployment.cloudSlot} owner projection expected schema_version=${schemaVersion}`)
  }
  if (row.deployment_id !== deployment.deploymentId) {
    throw new Error(`${deployment.cloudSlot} owner projection deployment_id does not match its binding`)
  }
  return row
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  const row = asRecord(value)
  if (!row) throw new Error(`CloudDeployment owner projection ${field} must be an object`)
  return row
}

function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`CloudDeployment owner projection ${field} must be an array`)
  return value
}

function requireString(value: unknown, field: string): string {
  const result = readString(value)
  if (!result) throw new Error(`CloudDeployment owner projection ${field} must be a non-empty string`)
  return result
}

function requireProjectionString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`CloudDeployment owner projection ${field} must be a string`)
  return value
}

function optionalProjectionString(value: unknown, field: string): string | undefined {
  if (value === null || value === undefined) return undefined
  return requireString(value, field)
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`CloudDeployment owner projection ${field} must be a boolean`)
  return value
}

function requireNumber(value: unknown, field: string): number {
  const result = readNumber(value)
  if (result === undefined) throw new Error(`CloudDeployment owner projection ${field} must be a number`)
  return result
}

function requireInteger(value: unknown, field: string): number {
  const result = requireNumber(value, field)
  if (!Number.isInteger(result)) throw new Error(`CloudDeployment owner projection ${field} must be an integer`)
  return result
}

function requireNonNegativeInteger(value: unknown, field: string): number {
  const result = requireInteger(value, field)
  if (result < 0) throw new Error(`CloudDeployment owner projection ${field} must be non-negative`)
  return result
}

function requireNonNegativeIntegerString(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error(`CloudDeployment owner projection ${field} must be a non-negative integer string`)
  }
  return value
}

function requireCanonicalBase64(value: string, field: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`CloudDeployment owner projection ${field} must be canonical base64`)
  }
  const bytes = Buffer.from(value, "base64")
  if (bytes.toString("base64") !== value) {
    throw new Error(`CloudDeployment owner projection ${field} must be canonical base64`)
  }
  return bytes
}

function optionalProjectionInteger(value: unknown, field: string): number | undefined {
  if (value === null || value === undefined) return undefined
  return requireInteger(value, field)
}

function actionError(error: unknown): CloudSlotActionResult {
  const status = readNumber(asRecord(error)?.status) ?? 0
  return { ok: false, status, message: errorMessage(error) }
}

function parsePayload(text: string, preserveIntegerFields: string[] = []): unknown {
  if (!text) return undefined
  try {
    const exactText = preserveIntegerFields.reduce(
      (current, field) => current.replace(
        new RegExp(`("${field}"\\s*:\\s*)(-?\\d+)(?=\\s*[,}])`, "g"),
        "$1\"$2\"",
      ),
      text,
    )
    return JSON.parse(exactText) as unknown
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

function readNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
