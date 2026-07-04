import { existsSync } from "node:fs"
import { resolve } from "node:path"
import type { StackConfig } from "./config.js"
import {
  EFFORT_WIRED_LAUNCH_CAPABILITIES,
  assertCapabilityInScope,
  readEffort,
  recordEffortLaunch,
  type StackEffortLaunchCapability,
  type StackEffortRef,
  type StackEffortRefLane,
} from "./effort.js"
import { launchLocalGepaRun } from "./local/optimizers.js"
import { createRemoteFactory, createRemoteLaunch, createRemoteRunnableProject, type RemoteFactoryCreateRequest, type RemoteProjectCreateRequest } from "./remote/actions.js"
import { deployContainerPoolRuntimeImage, executeContainerPoolRollout, type ContainerPoolRuntimeImageReleaseRequest } from "./remote/containers.js"
import { submitHostedGepaRun } from "./remote/optimizers.js"

export const EFFORT_LAUNCH_KINDS = ["optimizer", "smr", "container", "project", "factory", "training", "artifact"] as const
export type EffortLaunchKind = (typeof EFFORT_LAUNCH_KINDS)[number]

export const EFFORT_LAUNCH_OPTIMIZERS = ["gepa", "gelo"] as const
export type EffortLaunchOptimizer = (typeof EFFORT_LAUNCH_OPTIMIZERS)[number]

export type EffortLaunchInput = {
  effortRef: string
  kind: EffortLaunchKind
  capability: StackEffortLaunchCapability
  configPath?: string
  tunnelUrl?: string
  containerPool?: string
  goal?: string
  projectId?: string
  factoryId?: string
  poolId?: string
  taskId?: string
  split?: string
  seed?: number
  policyName?: string
  policyConfig?: Record<string, unknown>
  request?: Record<string, unknown>
  name?: string
  description?: string
  status?: string
  imageRef?: string
  serviceUrl?: string
  runtimeKind?: string
  releaseName?: string
  provider?: string
  archiveBase64?: string
  sourceStorageUri?: string
  dockerfilePath?: string
  baseImageRef?: string
}

export type EffortLaunchResult = {
  ok: boolean
  capability: StackEffortLaunchCapability
  kind: EffortLaunchKind
  lane: StackEffortRefLane
  message: string
  id: string | null
  ref: StackEffortRef | null
  recorded_in: string | null
  detail: Record<string, unknown>
}

export type EffortLaunchCapabilityMetadata = {
  capability: StackEffortLaunchCapability
  kind: EffortLaunchKind
  lane: StackEffortRefLane
  wired: boolean
  scopeOnly?: boolean
  optimizer?: EffortLaunchOptimizer
}

export const EFFORT_LAUNCH_CAPABILITY_METADATA: Partial<Record<StackEffortLaunchCapability, EffortLaunchCapabilityMetadata>> = {
  "optimizer.gepa.local": {
    capability: "optimizer.gepa.local",
    kind: "optimizer",
    lane: "local",
    wired: true,
    optimizer: "gepa",
  },
  "optimizer.gepa.hosted": {
    capability: "optimizer.gepa.hosted",
    kind: "optimizer",
    lane: "hosted",
    wired: true,
    optimizer: "gepa",
  },
  "optimizer.gelo.hosted": {
    capability: "optimizer.gelo.hosted",
    kind: "optimizer",
    lane: "hosted",
    wired: false,
    optimizer: "gelo",
  },
  "smr.hosted": {
    capability: "smr.hosted",
    kind: "smr",
    lane: "hosted",
    wired: true,
  },
  "container.pool.hosted": {
    capability: "container.pool.hosted",
    kind: "container",
    lane: "hosted",
    wired: true,
  },
  "container.deploy.hosted": {
    capability: "container.deploy.hosted",
    kind: "container",
    lane: "hosted",
    wired: true,
  },
  "project.hosted": {
    capability: "project.hosted",
    kind: "project",
    lane: "hosted",
    wired: true,
  },
  "factory.hosted": {
    capability: "factory.hosted",
    kind: "factory",
    lane: "hosted",
    wired: true,
  },
  "training.tinker.hosted": {
    capability: "training.tinker.hosted",
    kind: "training",
    lane: "hosted",
    wired: false,
    scopeOnly: true,
  },
  "artifact.publish.hosted": {
    capability: "artifact.publish.hosted",
    kind: "artifact",
    lane: "hosted",
    wired: false,
    scopeOnly: true,
  },
}

export function effortLaunchCapabilityMetadata(capability: StackEffortLaunchCapability): EffortLaunchCapabilityMetadata {
  const metadata = EFFORT_LAUNCH_CAPABILITY_METADATA[capability]
  if (metadata) return metadata
  throw new Error(`config error: launch capability "${capability}" is valid for effort scope but is not launchable through stack effort launch; use its owning Stack cloud tool surface instead`)
}

export async function launchEffortRun(config: StackConfig, input: EffortLaunchInput): Promise<EffortLaunchResult> {
  const effort = readEffort(config, input.effortRef)
  if (!effort) throw new Error(`effort not found: ${input.effortRef}`)
  const metadata = effortLaunchCapabilityMetadata(input.capability)
  if (input.kind !== metadata.kind) {
    throw new Error(`config error: launch kind "${input.kind}" does not match capability "${input.capability}" (expected kind "${metadata.kind}")`)
  }
  const capability = metadata.capability
  assertCapabilityInScope(effort, capability)
  if (metadata.scopeOnly) {
    throw new Error(`config error: launch capability "${capability}" is scope-only in stack_effort_launch; it is guard-checked here, but reachable through its standalone Stack cloud tool surface`)
  }
  if (!metadata.wired || !(EFFORT_WIRED_LAUNCH_CAPABILITIES as readonly string[]).includes(capability)) {
    throw new Error(`config error: launch capability "${capability}" is declared in the capability registry but has no wired launch client yet; wired capabilities: ${EFFORT_WIRED_LAUNCH_CAPABILITIES.join(", ")}`)
  }

  const base = { capability, kind: metadata.kind, lane: metadata.lane }
  const launched = await executeEffortLaunch(config, capability, input, effort.manifest.id)
  if (!launched.ok || !launched.id) {
    return {
      ...base,
      ok: false,
      message: launched.ok && !launched.id
        ? `${launched.message}; no run id returned, nothing recorded on the effort`
        : launched.message,
      id: launched.id ?? null,
      ref: null,
      recorded_in: null,
      detail: launched.detail,
    }
  }

  const ref: StackEffortRef = { system: launched.system, id: launched.id, lane: metadata.lane, role: "launch" }
  const recorded = recordEffortLaunch({
    stackDataRoot: config.stackDataRoot,
    workspaceRoot: config.workspaceRoot,
    effortRef: effort.manifest.id,
    capability,
    kind: metadata.kind,
    lane: metadata.lane,
    system: launched.system,
    id: launched.id,
  })
  return {
    ...base,
    ok: true,
    message: launched.message,
    id: launched.id,
    ref,
    recorded_in: recorded.registry.folder_ref,
    detail: launched.detail,
  }
}

type EffortLaunchExecution = {
  ok: boolean
  message: string
  system: string
  id?: string
  detail: Record<string, unknown>
}

async function executeEffortLaunch(
  config: StackConfig,
  capability: StackEffortLaunchCapability,
  input: EffortLaunchInput,
  effortId: string,
): Promise<EffortLaunchExecution> {
  if (capability === "optimizer.gepa.local") {
    const configPath = requireLaunchConfigPath(config, input, capability)
    const result = await launchLocalGepaRun(config, { configPath })
    return {
      ok: result.ok,
      message: result.message,
      system: "optimizer",
      ...(result.run?.runId ? { id: result.run.runId } : {}),
      detail: {
        status: result.status,
        service_status: result.service.status,
        service_url: result.service.serviceUrl,
        ...(result.container ? { container_url: result.container.url } : {}),
      },
    }
  }
  if (capability === "optimizer.gepa.hosted") {
    const configPath = requireLaunchConfigPath(config, input, capability)
    const result = await submitHostedGepaRun(config, {
      configPath,
      ...(input.tunnelUrl ? { tunnelUrl: input.tunnelUrl } : {}),
      ...(input.containerPool ? { containerPool: input.containerPool } : {}),
    })
    return {
      ok: result.ok,
      message: result.message,
      system: "optimizer",
      ...(result.runId ? { id: result.runId } : {}),
      detail: {
        status: result.status,
        environment: result.environmentName,
        api_base_url: result.apiBaseUrl,
        timed_out: result.timedOut,
      },
    }
  }
  if (capability === "smr.hosted") {
    const goal = input.goal?.trim()
    if (!goal) throw new Error(`config error: launch capability "${capability}" requires --goal <text>`)
    const result = await createRemoteLaunch(config, {
      objective: goal,
      ...(input.projectId ? { project_id: input.projectId } : {}),
      metadata: { source: "stack_effort_launch", effort_id: effortId },
    })
    const id = remoteLaunchId(result.data)
    return {
      ok: result.ok,
      message: result.message,
      system: "smr",
      ...(id ? { id } : {}),
      detail: {
        status: result.status,
        ...(result.data ? { response: result.data } : {}),
      },
    }
  }
  if (capability === "project.hosted") {
    const request = input.request
    if (!request || Object.keys(request).length === 0) {
      throw new Error(`config error: launch capability "${capability}" requires --request-json <SmrRunnableProjectCreateRequest>`)
    }
    const result = await createRemoteRunnableProject(config, request as RemoteProjectCreateRequest)
    const id = remoteEntityId(result.data, ["project_id", "projectId", "id"])
    return {
      ok: result.ok,
      message: result.ok ? "remote runnable project created" : result.message,
      system: "project",
      ...(id ? { id } : {}),
      detail: {
        status: result.status,
        environment: config.environmentName,
        api_base_url: config.environment.apiBaseUrl,
        ...(result.data ? { response: result.data } : {}),
      },
    }
  }
  if (capability === "factory.hosted") {
    const request: RemoteFactoryCreateRequest = {
      ...(input.request ?? {}),
    } as RemoteFactoryCreateRequest
    if (input.name) request.name = input.name
    if (input.description) request.description = input.description
    if (input.status) request.status = input.status
    if (!request.name || !String(request.name).trim()) {
      throw new Error(`config error: launch capability "${capability}" requires --name <factory name> or --request-json with name`)
    }
    const result = await createRemoteFactory(config, request)
    const id = remoteEntityId(result.data, ["factory_id", "factoryId", "id"])
    return {
      ok: result.ok,
      message: result.ok ? "remote factory created" : result.message,
      system: "factory",
      ...(id ? { id } : {}),
      detail: {
        status: result.status,
        environment: config.environmentName,
        api_base_url: config.environment.apiBaseUrl,
        ...(result.data ? { response: result.data } : {}),
      },
    }
  }
  const poolId = input.poolId?.trim()
  if (!poolId) throw new Error(`config error: launch capability "${capability}" requires --pool <id>`)
  if (capability === "container.deploy.hosted") {
    const result = await deployContainerPoolRuntimeImage(config, {
      poolId,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      body: containerDeployBody(input),
    })
    return {
      ok: result.ok,
      message: result.message,
      system: "container-pool",
      ...(result.ok ? { id: result.releaseId ?? poolId } : {}),
      detail: {
        status: result.status,
        environment: result.environmentName,
        api_base_url: result.apiBaseUrl,
        pool_id: poolId,
        ...(result.taskId ? { task_id: result.taskId } : {}),
        ...(result.releaseId ? { release_id: result.releaseId } : {}),
        ...(result.release ? { release: result.release } : {}),
        ...(result.binding ? { binding: result.binding } : {}),
        ...(result.data ? { response: result.data } : {}),
      },
    }
  }
  const result = await executeContainerPoolRollout(config, {
    poolId,
    ...(input.taskId ? { taskId: input.taskId } : {}),
    body: containerRolloutBody(input, effortId),
  })
  return {
    ok: result.ok,
    message: result.message,
    system: "container-pool",
    ...(result.ok ? { id: poolId } : {}),
    detail: {
      status: result.status,
      environment: result.environmentName,
      api_base_url: result.apiBaseUrl,
      ...(result.taskId ? { task_id: result.taskId } : {}),
      ...(result.data ? { response: result.data } : {}),
    },
  }
}

function containerRolloutBody(input: EffortLaunchInput, effortId: string): Record<string, unknown> {
  const policyName = input.policyName?.trim() || "stack_effort_launch"
  return {
    trace_correlation_id: `stack-effort-${effortId}`,
    env: {
      env_name: "banking77",
      config: {
        split: input.split ?? "test",
      },
      seed: input.seed ?? 7,
    },
    policy: {
      policy_name: policyName,
      config: input.policyConfig ?? {},
    },
  }
}

function containerDeployBody(input: EffortLaunchInput): ContainerPoolRuntimeImageReleaseRequest {
  const runtimeKind = input.runtimeKind ?? (input.serviceUrl ? "service_url" : "image_ref")
  const body: ContainerPoolRuntimeImageReleaseRequest = {
    runtime_kind: runtimeKind,
    ...(input.releaseName ? { name: input.releaseName } : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.imageRef ? { image_ref: input.imageRef } : {}),
    ...(input.serviceUrl ? { service_url: input.serviceUrl } : {}),
    ...(input.archiveBase64 ? { archive_base64: input.archiveBase64 } : {}),
    ...(input.sourceStorageUri ? { source_storage_uri: input.sourceStorageUri } : {}),
    ...(input.dockerfilePath ? { dockerfile_path: input.dockerfilePath } : {}),
    ...(input.baseImageRef ? { base_image_ref: input.baseImageRef } : {}),
    metadata: {
      source: "stack_effort_launch",
    },
  }
  if (runtimeKind === "image_ref" && !body.image_ref) {
    throw new Error(`config error: launch capability "container.deploy.hosted" requires --image-ref <ref> when runtime kind is image_ref`)
  }
  if (runtimeKind === "service_url" && !body.service_url) {
    throw new Error(`config error: launch capability "container.deploy.hosted" requires --service-url <url> when runtime kind is service_url`)
  }
  return body
}

function requireLaunchConfigPath(config: StackConfig, input: EffortLaunchInput, capability: StackEffortLaunchCapability): string {
  const raw = input.configPath?.trim()
  if (!raw) throw new Error(`config error: launch capability "${capability}" requires --config <gepa toml path>`)
  const configPath = resolve(config.workingDir, raw)
  if (!existsSync(configPath)) throw new Error(`config error: launch config does not exist: ${configPath}`)
  return configPath
}

function remoteLaunchId(data: Record<string, unknown> | undefined): string | undefined {
  if (!data) return undefined
  for (const key of ["run_id", "runId", "id", "launch_id", "launchId"]) {
    const value = data[key]
    if (typeof value === "string" && value.trim()) return value
  }
  const launch = data.launch
  if (launch && typeof launch === "object" && !Array.isArray(launch)) {
    for (const key of ["run_id", "runId", "id"]) {
      const value = (launch as Record<string, unknown>)[key]
      if (typeof value === "string" && value.trim()) return value
    }
  }
  return undefined
}

function remoteEntityId(data: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!data) return undefined
  for (const key of keys) {
    const value = data[key]
    if (typeof value === "string" && value.trim()) return value
  }
  return undefined
}
