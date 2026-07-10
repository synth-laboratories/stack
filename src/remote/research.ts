import { environmentAuthStatus, type StackConfig } from "../config.js"

export type RemoteResearchStatus = "ready" | "missing-auth" | "offline"
export type RemoteJsonValue =
  | null
  | boolean
  | number
  | string
  | RemoteJsonValue[]
  | { [key: string]: RemoteJsonValue }

export type RemoteSmrRunSummary = {
  runId: string
  projectId?: string
  state: string
  phase?: string
  runbook?: string
  createdAt?: string
  startedAt?: string
  updatedAt?: string
  finishedAt?: string
  reason?: string
}

export type RemoteArtifactSummary = {
  artifactId: string
  artifactType?: string
  title?: string
  createdAt?: string
}

export type RemoteWorkProductSummary = {
  workProductId: string
  kind?: string
  title?: string
  status?: string
  readiness?: string
  artifactId?: string
  createdAt?: string
}

export type RemoteRuntimeMessageSummary = {
  messageId: string
  status?: string
  mode?: string
  sender?: string
  target?: string
  action?: string
  body?: string
  createdAt?: string
}

export type RemoteRunFileMountSummary = {
  mountId: string
  fileId: string
  mountPath: string
  visibility?: string
  active: boolean
  contentType?: string
  contentBytes?: number
  createdAt?: string
}

export type HostedArtifactStatus = {
  runId: string
  status: "building" | "ready" | "published" | "none" | "unknown"
  hostedUrl?: string
  publicUrl?: string
  slug?: string
  visibility?: "private" | "org" | "public"
  urlStatus?: number
  message?: string
} // FRESH THIS TURN for CHANGED delta - skeptic fix (AC1+AC4)

export type HostedArtifactSummary = {
  hostedArtifactId: string
  projectId?: string
  runId?: string
  builtByRunId?: string
  workProductId?: string
  status?: string
  title?: string
  hostedUrl?: string
  canonicalUrl?: string
  publicUrl?: string
  slug?: string
  visibility?: string
  artifactVersion?: number
  sourceRunIds: string[]
  traceId?: string
  publishedAt?: string
}

export type PublishHostedArtifactRequest = {
  title: string
  htmlContent: string
  visibility?: "private" | "org" | "public"
  projectId?: string
  effortId?: string
  hostedArtifactId?: string
  sourceRunIds?: string[]
  traceId?: string
  slugHint?: string
}

export type PublishHostedArtifactResult = {
  ok: boolean
  status: number
  message: string
  hostedArtifactId?: string
  hostedUrl?: string
  canonicalUrl?: string
  publicUrl?: string
  slug?: string
  visibility?: string
  artifactVersion?: number
  sourceRunIds: string[]
  traceId?: string
  response?: unknown
}

export type PublishPublicHostedArtifactRequest = {
  slug: string
  kind?: string
  theme?: string
  summary?: string
  factoryId?: string
  effortId?: string
}

export type HostedArtifactsSnapshot = {
  status: RemoteResearchStatus
  environmentName: string
  apiBaseUrl: string
  checkedAt: string
  projectId?: string
  message?: string
  artifacts: HostedArtifactSummary[]
}

export type RemoteRunDetail = {
  runId: string
  artifactCount: number
  workProductCount: number
  runtimeMessageCount: number
  pendingRuntimeMessageCount: number
  fileMountCount: number
  activeFileMountCount: number
  artifactTypes: Record<string, number>
  workProductKinds: Record<string, number>
  artifacts: RemoteArtifactSummary[]
  workProducts: RemoteWorkProductSummary[]
  runtimeMessages: RemoteRuntimeMessageSummary[]
  fileMounts: RemoteRunFileMountSummary[]
  message?: string
}

export type RemoteFactorySummary = {
  factoryId: string
  name: string
  kind?: string
  status?: string
  canonicalProjectId?: string
  latestProjectId?: string
  nextWakeAt?: string
  activeEfforts?: number
  pausedOrWaiting?: number
  latestRunId?: string
  latestWorkProductId?: string
  runtimeState?: string
  runtimeEnabled?: boolean
  hasCloudDevEnv?: boolean
  cloudDevLabel?: string
  isRunning?: boolean
  controlLoops?: RemoteFactoryControlLoopSummary
  health?: RemoteFactoryHealthSummary
  operatingWindow?: RemoteFactoryOperatingWindowSummary
  latestExperiment?: RemoteExperimentBundleSummary
  statusError?: string
}

export type RemoteExperimentBundleSummary = {
  schemaVersion: string
  experimentId: string
  projectId: string
  runIds: string[]
  title?: string
  hypothesis?: string
  status?: string
  verdict?: string
  candidateId?: string
  candidateModel?: string
  candidatePrompt?: string
  candidatePromptArtifact?: string
  metric?: string
  baselineValue?: number
  candidateValue?: number
  delta?: number
  sampleSize?: number
  seedCount: number
  scorerId?: string
  costCents?: number
  tokens?: number
  traceCount: number
  integrityState?: string
  acceptedCycle: boolean
  missing: string[]
  synthWiki: Record<string, RemoteJsonValue>
  gitServer: Record<string, RemoteJsonValue>
  raw: Record<string, RemoteJsonValue>
}

export type RemoteFactoryControlLoopSummary = {
  serviceType?: string
  environment?: string
  runtimeState?: string
  runtimeEnabled?: boolean
  schedulerEnabled?: boolean
  reactorEnabled?: boolean
  schedulerObservedAt?: string
  reactorObservedAt?: string
}

export type RemoteFactoryVitalSummary = {
  status?: string
  inBand?: boolean
  reason?: string
  observed: Record<string, RemoteJsonValue>
}

export type RemoteFactoryHealthSummary = {
  status?: string
  healthScore?: number
  threshold?: number
  evaluatedAt?: string
  vitals: Record<string, RemoteFactoryVitalSummary>
}

export type RemoteFactoryOperatingWindowSummary = {
  status?: string
  evaluatedAt?: string
  windowStartedAt?: string
  windowDays?: number
  requiredCycles?: number
  observedCycles?: number
  remainingCycles?: number
  firstCycleAt?: string
  latestCycleAt?: string
  cycleRunIds: string[]
}

export type RemoteDeploymentSummary = {
  deploymentId: string
  name: string
  status?: string
  preflightStatus?: string
  degradedReason?: string
  projectId?: string
  factoryId?: string
  topology?: string
  substrate?: string
  updatedAt?: string
  ready?: boolean
}

export type RemoteSyncRequestSummary = {
  eventId: string
  observedAt: string
  direction: string
  intent: string
  subjectKind: string
  subjectId: string
  projectId?: string
  runId?: string
  factoryId?: string
  deploymentId?: string
  metaThreadId?: string
  threadId?: string
  actorRole?: string
  actorId?: string
  note?: string
}

export type RemoteGardenerPassSummary = {
  eventId: string
  observedAt: string
  subjectKind: string
  subjectId: string
  projectId?: string
  runId?: string
  factoryId?: string
  deploymentId?: string
  metaThreadId?: string
  threadId?: string
  actorRole?: string
  actorId?: string
  narration?: string
  nextAction?: string
  runtimeStatus?: string
  authStatus?: string
}

export type RemoteSmrBindingSummary = {
  eventId: string
  observedAt: string
  metaThreadId?: string
  threadId?: string
  projectId?: string
  runId: string
  factoryId?: string
  deploymentId?: string
  bindingId?: string
  objective?: string
  remoteStatus?: string
  actorRole?: string
  actorId?: string
}

export type RemoteRunEventSummary = {
  eventId: string
  observedAt: string
  messageId: string
  projectId?: string
  runId: string
  status?: string
  mode?: string
  sender?: string
  target?: string
  action?: string
  body?: string
  createdAt?: string
}

export type RemoteSyncSnapshot = {
  pendingPush: RemoteSyncRequestSummary[]
  pendingPull: RemoteSyncRequestSummary[]
  recentRemoteGardenerPasses: RemoteGardenerPassSummary[]
  linkedSmrRuns: RemoteSmrBindingSummary[]
  recentRunEvents: RemoteRunEventSummary[]
}

export type RemoteResearchSnapshot = {
  status: RemoteResearchStatus
  environmentName: string
  apiBaseUrl: string
  checkedAt: string
  message?: string
  jobs: RemoteSmrRunSummary[]
  factories: RemoteFactorySummary[]
  deployments: RemoteDeploymentSummary[]
  runDetails: Record<string, RemoteRunDetail>
  hostedArtifacts: Record<string, HostedArtifactStatus>
  sync?: RemoteSyncSnapshot
}

export type RemoteTagScopeSummary = {
  scopeId: string
  name: string
  status: string
  isDefault: boolean
  factoryId?: string
  defaultProjectId?: string
}

export type RemoteProjectsPanelSnapshot = {
  status: RemoteResearchStatus
  environmentName: string
  apiBaseUrl: string
  checkedAt: string
  message?: string
  projects: RemoteProjectPanelEntry[]
  deployments: RemoteDeploymentSummary[]
  tagScope?: RemoteTagScopeSummary
  sync?: RemoteSyncSnapshot
}

export type RemoteProjectPanelEntry = {
  projectId: string
  name: string
  alias?: string
  updatedAt?: string
  activeRunId?: string
  experimentsLast7Days?: number
  experimentsLast7DaysCapped?: boolean
  factories: RemoteFactorySummary[]
  runs: RemoteSmrRunSummary[]
  deployments?: RemoteDeploymentSummary[]
}

const LIVE_PROJECT_LIMIT = 6
const FACTORIES_PER_PROJECT = 2
const RUNS_PER_PROJECT = 5
const FACTORY_LINK_PROBE_LIMIT = 16
const EXPERIMENTS_7D_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000
const EXPERIMENTS_7D_FETCH_LIMIT = 200

export async function readRemoteProjectsPanelSnapshot(config: StackConfig): Promise<RemoteProjectsPanelSnapshot> {
  const auth = environmentAuthStatus(config.environment)
  const base: RemoteProjectsPanelSnapshot = {
    status: auth.hasAuth ? "offline" : "missing-auth",
    environmentName: config.environmentName,
    apiBaseUrl: config.environment.apiBaseUrl,
    checkedAt: new Date().toISOString(),
    message: auth.hasAuth ? "not checked yet" : auth.message,
    projects: [],
    deployments: [],
  }

  if (!auth.hasAuth) return base

  try {
    const [projectsPayload, factoriesPayload, tagScope] = await Promise.all([
      getJson(config, `/smr/projects?limit=${LIVE_PROJECT_LIMIT}&include_archived=false`),
      getJson(config, "/smr/factories?include_archived=false"),
      readDefaultTagScope(config),
    ])
    const projects = readProjects(projectsPayload).slice(0, LIVE_PROJECT_LIMIT)
    const factories = readFactories(factoriesPayload).slice(0, FACTORY_LINK_PROBE_LIMIT)
    const factoriesByProject = await readFactoriesByProject(config, factories)
    const entries = await Promise.all(
      projects.map(async (project) => {
        const [runsPayload, experiments7d] = await Promise.all([
          getJson(
            config,
            `/smr/projects/${encodeURIComponent(project.projectId)}/runs?limit=${RUNS_PER_PROJECT}`,
          ),
          readProjectExperimentsLast7Days(config, project.projectId),
        ])
        const runs = readRuns(runsPayload).slice(0, RUNS_PER_PROJECT)
        const linkedFactories = await Promise.all(
          (factoriesByProject.get(project.projectId) ?? [])
            .slice()
            .sort((left, right) => factoryRecency(right) - factoryRecency(left))
            .slice(0, FACTORIES_PER_PROJECT)
            .map((factory) => readFactoryStatus(config, factory)),
        )
        return {
          ...project,
          ...experiments7d,
          factories: linkedFactories,
          runs,
        }
      }),
    )
    return {
      ...base,
      status: "ready",
      checkedAt: new Date().toISOString(),
      message: `${entries.length} projects`,
      projects: entries,
      tagScope,
    }
  } catch (error) {
    return {
      ...base,
      status: "offline",
      checkedAt: new Date().toISOString(),
      message: errorMessage(error),
    }
  }
}

async function readDefaultTagScope(config: StackConfig): Promise<RemoteTagScopeSummary | undefined> {
  try {
    const payload = asRecord(await getJson(config, "/api/tag/v1/scopes/default"))
    if (!payload) return undefined
    const scopeId = readString(payload.scope_id)
    const name = readString(payload.name)
    const status = readString(payload.status)
    if (!scopeId || !name || !status) return undefined
    return {
      scopeId,
      name,
      status,
      isDefault: Boolean(payload.is_default),
      factoryId: readString(payload.factory_id),
      defaultProjectId: readString(payload.default_project_id),
    }
  } catch {
    return undefined
  }
}

type ProjectExperiments7dSummary = Pick<
  RemoteProjectPanelEntry,
  "experimentsLast7Days" | "experimentsLast7DaysCapped"
>

async function readProjectExperimentsLast7Days(
  config: StackConfig,
  projectId: string,
): Promise<ProjectExperiments7dSummary> {
  const sinceMs = Date.now() - EXPERIMENTS_7D_LOOKBACK_MS
  const createdAfter = new Date(sinceMs).toISOString()
  const path = `/smr/projects/${encodeURIComponent(projectId)}`
  try {
    const payload = await getJson(
      config,
      `${path}/experiments?limit=${EXPERIMENTS_7D_FETCH_LIMIT}`,
    )
    const rows = asArray(payload)
    const count = countRowsCreatedOnOrAfter(rows, sinceMs)
    return {
      experimentsLast7Days: count,
      experimentsLast7DaysCapped: rows.length >= EXPERIMENTS_7D_FETCH_LIMIT && count >= EXPERIMENTS_7D_FETCH_LIMIT,
    }
  } catch {
    try {
      const payload = await getJson(
        config,
        `${path}/runs?created_after=${encodeURIComponent(createdAfter)}&limit=${EXPERIMENTS_7D_FETCH_LIMIT}`,
      )
      const rows = asArray(payload)
      return {
        experimentsLast7Days: rows.length,
        experimentsLast7DaysCapped: rows.length >= EXPERIMENTS_7D_FETCH_LIMIT,
      }
    } catch {
      return {}
    }
  }
}

function countRowsCreatedOnOrAfter(rows: unknown[], sinceMs: number): number {
  let count = 0
  for (const item of rows) {
    const row = asRecord(item)
    const createdAt = readString(row?.created_at)
    if (!createdAt) continue
    const createdMs = Date.parse(createdAt)
    if (Number.isFinite(createdMs) && createdMs >= sinceMs) count += 1
  }
  return count
}

async function readFactoriesByProject(
  config: StackConfig,
  factories: RemoteFactorySummary[],
): Promise<Map<string, RemoteFactorySummary[]>> {
  const byProject = new Map<string, RemoteFactorySummary[]>()
  const links = await Promise.all(
    factories.map(async (factory) => {
      try {
        const payload = await getJson(config, `/smr/factories/${encodeURIComponent(factory.factoryId)}/projects`)
        return { factory, projectIds: readFactoryProjectIds(payload) }
      } catch {
        return { factory, projectIds: [] as string[] }
      }
    }),
  )
  for (const link of links) {
    for (const projectId of link.projectIds) {
      const bucket = byProject.get(projectId) ?? []
      bucket.push(link.factory)
      byProject.set(projectId, bucket)
    }
  }
  return byProject
}

function readFactoryProjectIds(value: unknown): string[] {
  const ids: string[] = []
  for (const item of asArray(value)) {
    const link = asRecord(item)
    const project = asRecord(link?.project)
    const status = readString(link?.status)?.toLowerCase()
    if (status === "archived" || readBoolean(project?.archived)) continue
    const projectId = readString(link?.project_id) ?? readString(project?.project_id)
    if (projectId && !ids.includes(projectId)) ids.push(projectId)
  }
  return ids
}

function readProjects(value: unknown): Omit<RemoteProjectPanelEntry, "factories" | "runs">[] {
  return asArray(value)
    .map((item): Omit<RemoteProjectPanelEntry, "factories" | "runs"> | undefined => {
      const project = asRecord(item)
      const projectId = readString(project?.project_id) ?? readString(project?.id)
      if (!project || !projectId || readBoolean(project.archived)) return undefined
      return {
        projectId,
        name: readString(project.name) ?? readString(project.project_alias) ?? projectId,
        alias: readString(project.project_alias),
        updatedAt: readString(project.updated_at),
        activeRunId: readString(project.active_run_id),
      }
    })
    .filter((project): project is Omit<RemoteProjectPanelEntry, "factories" | "runs"> => Boolean(project))
}

function factoryRecency(factory: RemoteFactorySummary): number {
  const stamp = factory.nextWakeAt ?? factory.latestRunId ?? factory.factoryId
  return Date.parse(stamp) || 0
}

export async function readRemoteResearchSnapshot(config: StackConfig): Promise<RemoteResearchSnapshot> {
  const auth = environmentAuthStatus(config.environment)
  const base: RemoteResearchSnapshot = {
    status: auth.hasAuth ? "offline" : "missing-auth",
    environmentName: config.environmentName,
    apiBaseUrl: config.environment.apiBaseUrl,
    checkedAt: new Date().toISOString(),
    message: auth.hasAuth ? "not checked yet" : auth.message,
    jobs: [],
    factories: [],
    deployments: [],
    runDetails: {},
    hostedArtifacts: {},
  }

  if (!auth.hasAuth) return base

  try {
    const [jobsPayload, factoriesPayload] = await Promise.all([
      getJson(config, "/smr/jobs?limit=8"),
      getJson(config, "/smr/factories?include_archived=false"),
    ])
    const jobs = readRuns(jobsPayload)
    const [runDetails, factories] = await Promise.all([
      readRunDetails(config, jobs.slice(0, 4)),
      Promise.resolve(readFactories(factoriesPayload).slice(0, 6)),
    ])
    const statusFactories = await Promise.all(
      factories.slice(0, 3).map((factory) => readFactoryStatus(config, factory)),
    )

    const mergedFactories = factories.map((factory) => {
      const status = statusFactories.find((item) => item.factoryId === factory.factoryId)
      return status ? { ...factory, ...status } : factory
    })

    // Load hosted artifact status for recent jobs (artifact_builder surface)
    const hostedArtifactEntries = await Promise.all(
      jobs.slice(0, 6).map(async (j) => {
        const ha = await readRunHostedArtifactStatus(config, j.runId)
        return [j.runId, ha] as const
      }),
    )
    const hostedArtifacts: Record<string, HostedArtifactStatus> = {}
    for (const [rid, ha] of hostedArtifactEntries) hostedArtifacts[rid] = ha

    return {
      ...base,
      status: "ready",
      checkedAt: new Date().toISOString(),
      message: "remote SMR reachable",
      jobs,
      factories: mergedFactories,
      runDetails,
      hostedArtifacts,
    }
  } catch (error) {
    return {
      ...base,
      status: "offline",
      checkedAt: new Date().toISOString(),
      message: errorMessage(error),
      hostedArtifacts: {},
    }
  }
}

async function readRunDetails(
  config: StackConfig,
  runs: RemoteSmrRunSummary[],
): Promise<Record<string, RemoteRunDetail>> {
  const entries = await Promise.all(runs.map((run) => readRemoteRunDetail(config, run)))
  return Object.fromEntries(entries.map((detail) => [detail.runId, detail]))
}

export async function readRemoteRunDetail(config: StackConfig, run: RemoteSmrRunSummary): Promise<RemoteRunDetail> {
  const [artifactsResult, workProductsResult, runtimeMessagesResult, fileMountsResult] = await Promise.allSettled([
    getJson(config, `/smr/runs/${encodeURIComponent(run.runId)}/artifacts?limit=20`),
    run.projectId
      ? getJson(
          config,
          `/smr/projects/${encodeURIComponent(run.projectId)}/runs/${encodeURIComponent(run.runId)}/work-products`,
        )
      : Promise.resolve([]),
    run.projectId
      ? getJson(
          config,
          `/smr/projects/${encodeURIComponent(run.projectId)}/runs/${encodeURIComponent(run.runId)}/runtime/messages?limit=20`,
        )
      : getJson(config, `/smr/runs/${encodeURIComponent(run.runId)}/runtime/messages?limit=20`),
    getJson(config, `/smr/runs/${encodeURIComponent(run.runId)}/file-mounts`),
  ])
  const artifacts = artifactsResult.status === "fulfilled" ? readArtifacts(artifactsResult.value) : []
  const workProducts = workProductsResult.status === "fulfilled" ? readWorkProducts(workProductsResult.value) : []
  const runtimeMessages =
    runtimeMessagesResult.status === "fulfilled" ? readRuntimeMessages(runtimeMessagesResult.value) : []
  const fileMounts = fileMountsResult.status === "fulfilled" ? readFileMounts(fileMountsResult.value) : []
  const messages = [
    artifactsResult.status === "rejected" ? `artifacts: ${errorMessage(artifactsResult.reason)}` : "",
    workProductsResult.status === "rejected" ? `work products: ${errorMessage(workProductsResult.reason)}` : "",
    runtimeMessagesResult.status === "rejected" ? `runtime messages: ${errorMessage(runtimeMessagesResult.reason)}` : "",
    fileMountsResult.status === "rejected" ? `file mounts: ${errorMessage(fileMountsResult.reason)}` : "",
  ].filter((message) => message.length > 0)

  return {
    runId: run.runId,
    artifactCount: artifacts.length,
    workProductCount: workProducts.length,
    runtimeMessageCount: runtimeMessages.length,
    pendingRuntimeMessageCount: runtimeMessages.filter((message) => {
      const status = (message.status ?? "").toLowerCase()
      return status.length === 0 || ["pending", "queued", "new", "created"].includes(status)
    }).length,
    fileMountCount: fileMounts.length,
    activeFileMountCount: fileMounts.filter((mount) => mount.active).length,
    artifactTypes: countBy(artifacts, (artifact) => artifact.artifactType ?? "unknown"),
    workProductKinds: countBy(workProducts, (workProduct) => workProduct.kind ?? "unknown"),
    artifacts,
    workProducts,
    runtimeMessages,
    fileMounts,
    message: messages.length ? messages.join("; ") : undefined,
  }
}

export async function readHostedArtifacts(
  config: StackConfig,
  options: { projectId?: string; limit?: number } = {},
): Promise<HostedArtifactsSnapshot> {
  const auth = environmentAuthStatus(config.environment)
  const base: HostedArtifactsSnapshot = {
    status: auth.hasAuth ? "offline" : "missing-auth",
    environmentName: config.environmentName,
    apiBaseUrl: config.environment.apiBaseUrl,
    checkedAt: new Date().toISOString(),
    ...(options.projectId ? { projectId: options.projectId } : {}),
    message: auth.hasAuth ? "not checked yet" : auth.message,
    artifacts: [],
  }

  if (!auth.hasAuth) return base

  const limit = Math.max(1, Math.min(Math.floor(options.limit ?? 100), 500))
  const path = options.projectId
    ? `/smr/projects/${encodeURIComponent(options.projectId)}/hosted-artifacts?limit=${limit}`
    : `/smr/hosted-artifacts?limit=${limit}`
  try {
    const payload = asRecord(await getJson(config, path))
    const artifacts = readHostedArtifactRows(payload?.artifacts)
    return {
      ...base,
      status: "ready",
      checkedAt: new Date().toISOString(),
      message: `${artifacts.length} hosted artifacts`,
      artifacts,
    }
  } catch (error) {
    return {
      ...base,
      status: "offline",
      checkedAt: new Date().toISOString(),
      message: errorMessage(error),
      artifacts: [],
    }
  }
}

export async function publishHostedArtifact(
  config: StackConfig,
  request: PublishHostedArtifactRequest,
): Promise<PublishHostedArtifactResult> {
  const payload = {
    title: request.title,
    html_content: request.htmlContent,
    visibility: request.visibility ?? "org",
    project_id: request.projectId,
    effort_id: request.effortId,
    hosted_artifact_id: request.hostedArtifactId,
    source_run_ids: request.sourceRunIds ?? [],
    trace_id: request.traceId,
    slug_hint: request.slugHint,
  }
  const response = await postJsonBody(config, "/smr/hosted-artifacts", payload)
  if (!response.ok) {
    const message = response.status === 405
      ? `POST /smr/hosted-artifacts returned 405 from ${config.environment.apiBaseUrl}; deploy or restart a backend that exposes the hosted artifact create route`
      : response.message
    return {
      ok: false,
      status: response.status,
      message,
      sourceRunIds: [],
      response: response.payload,
    }
  }
  return hostedArtifactPublishResult(response.status, response.payload)
}

export async function publishHostedArtifactPublic(
  config: StackConfig,
  hostedArtifactId: string,
  request: PublishPublicHostedArtifactRequest,
): Promise<PublishHostedArtifactResult> {
  const response = await postJsonBody(
    config,
    `/smr/hosted-artifacts/${encodeURIComponent(hostedArtifactId)}/publish-public`,
    {
      slug: request.slug,
      kind: request.kind ?? "result",
      theme: request.theme,
      summary: request.summary,
      factory_id: request.factoryId,
      effort_id: request.effortId,
    },
  )
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      message: response.message,
      sourceRunIds: [],
      response: response.payload,
    }
  }
  return hostedArtifactPublishResult(response.status, response.payload)
}

async function readFactoryStatus(config: StackConfig, factory: RemoteFactorySummary): Promise<RemoteFactorySummary> {
  try {
    const payload = asRecord(await getJson(config, `/smr/factories/${encodeURIComponent(factory.factoryId)}/status`))
    if (!payload) return factory
    const latestRuns = asArray(payload.latest_runs)
    const projects = asArray(payload.projects)
    const linkedProjects = asArray(payload.linked_projects)
    const latestWorkProducts = asArray(payload.latest_work_products)
    const activeProjectIds = activeFactoryProjectIds(linkedProjects, projects)
    const hasProjectMetadata = linkedProjects.length > 0 || projects.length > 0
    const latestRunProjectId = readString(asRecord(latestRuns[0])?.project_id)
    const factoryRecord = asRecord(payload.factory)
    const runtime = asRecord(payload.runtime)
    const activeEfforts = readNumber(asRecord(payload.efforts_by_status)?.active)
    const factoryStatus = readString(factoryRecord?.status) ?? factory.status
    const runtimeState = readString(runtime?.state)
    const runtimeEnabled = readBoolean(runtime?.enabled)
    const controlLoopFlags = asRecord(runtime?.control_loop_flags)
    const reactor = asRecord(runtime?.reactor)
    const health = readFactoryHealth(payload.factory_health)
    const operatingWindow = readFactoryOperatingWindow(payload.operating_window)
    const latestExperiment = readExperimentBundleSummary(payload.experiment_observability)
    const cloudDev = readFactoryCloudDevEnv(payload)
    const isRunning = factoryIsRunning({
      factoryStatus,
      runtimeState,
      runtimeEnabled,
      activeEfforts,
    })
    return {
      ...factory,
      status: factoryStatus ?? factory.status,
      nextWakeAt: readString(payload.next_wake_at) ?? factory.nextWakeAt,
      activeEfforts,
      pausedOrWaiting: asArray(payload.paused_or_waiting).length,
      canonicalProjectId: activeProjectIds[0] ?? factory.canonicalProjectId,
      latestProjectId:
        latestRunProjectId && (!hasProjectMetadata || activeProjectIds.includes(latestRunProjectId))
          ? latestRunProjectId
          : factory.latestProjectId,
      latestRunId: readString(asRecord(latestRuns[0])?.run_id) ?? factory.latestRunId,
      latestWorkProductId: readString(asRecord(latestWorkProducts[0])?.work_product_id) ?? factory.latestWorkProductId,
      runtimeState,
      runtimeEnabled,
      hasCloudDevEnv: cloudDev.hasCloudDevEnv,
      cloudDevLabel: cloudDev.label,
      isRunning,
      controlLoops: {
        serviceType: readString(controlLoopFlags?.service_type),
        environment: readString(controlLoopFlags?.environment),
        runtimeState,
        runtimeEnabled: readOptionalBoolean(runtime?.enabled),
        schedulerEnabled: readOptionalBoolean(controlLoopFlags?.scheduler_enabled),
        reactorEnabled: readOptionalBoolean(controlLoopFlags?.reactor_enabled),
        schedulerObservedAt: readString(runtime?.last_observed_at),
        reactorObservedAt: readString(reactor?.last_observed_at),
      },
      health,
      operatingWindow,
      latestExperiment,
      statusError: undefined,
    }
  } catch (error) {
    return { ...factory, statusError: errorMessage(error) }
  }
}

export async function readExperimentBundle(
  config: StackConfig,
  projectId: string,
  experimentId: string,
): Promise<RemoteExperimentBundleSummary> {
  const payload = await getJson(
    config,
    `/smr/projects/${encodeURIComponent(projectId)}/experiments/${encodeURIComponent(experimentId)}/bundle`,
  )
  const bundle = readExperimentBundleSummary(payload)
  if (!bundle) throw new Error("backend returned an invalid experiment bundle")
  return bundle
}

function readExperimentBundleSummary(value: unknown): RemoteExperimentBundleSummary | undefined {
  const bundle = asRecord(value)
  const experimentId = readString(bundle?.experiment_id)
  const projectId = readString(bundle?.project_id)
  if (!bundle || !experimentId || !projectId) return undefined
  const experiment = asRecord(bundle.experiment)
  const candidate = asRecord(bundle.candidate)
  const evaluation = asRecord(asArray(bundle.evaluations)[0])
  const economics = asRecord(bundle.economics)
  const integrity = asRecord(bundle.integrity)
  const provenance = asRecord(bundle.provenance)
  return {
    schemaVersion: readString(bundle.schema_version) ?? "smr_experiment_bundle.v1",
    experimentId,
    projectId,
    runIds: asArray(bundle.run_ids).map(readString).filter((item): item is string => Boolean(item)),
    title: readString(experiment?.title),
    hypothesis: readString(experiment?.hypothesis),
    status: readString(experiment?.status),
    verdict: readString(experiment?.verdict),
    candidateId: readString(candidate?.candidate_id),
    candidateModel: readString(candidate?.model),
    candidatePrompt: readString(candidate?.prompt),
    candidatePromptArtifact: readString(candidate?.prompt_artifact),
    metric: readString(evaluation?.metric),
    baselineValue: readNumber(evaluation?.baseline_value),
    candidateValue: readNumber(evaluation?.value),
    delta: readNumber(evaluation?.delta),
    sampleSize: readNumber(evaluation?.sample_size),
    seedCount: asArray(evaluation?.seed_set).length,
    scorerId: readString(evaluation?.scorer_id),
    costCents: readNumber(economics?.cost_cents),
    tokens: readNumber(economics?.tokens),
    traceCount: asArray(bundle.trace_index).length,
    integrityState: readString(integrity?.state),
    acceptedCycle: readBoolean(integrity?.accepted_cycle) ?? false,
    missing: asArray(integrity?.missing).map(readString).filter((item): item is string => Boolean(item)),
    synthWiki: readJsonRecord(provenance?.synth_wiki),
    gitServer: readJsonRecord(provenance?.git_server),
    raw: readJsonRecord(bundle),
  }
}

function readFactoryHealth(value: unknown): RemoteFactoryHealthSummary | undefined {
  const health = asRecord(value)
  if (!health) return undefined
  const vitalsRecord = asRecord(health.vitals) ?? {}
  const vitals: Record<string, RemoteFactoryVitalSummary> = {}
  for (const [name, rawVital] of Object.entries(vitalsRecord)) {
    const vital = asRecord(rawVital)
    if (!vital) continue
    vitals[name] = {
      status: readString(vital.status),
      inBand: readOptionalBoolean(vital.in_band),
      reason: readString(vital.reason),
      observed: readJsonRecord(vital.observed),
    }
  }
  return {
    status: readString(health.status),
    healthScore: readNumber(health.health_score),
    threshold: readNumber(health.threshold),
    evaluatedAt: readString(health.evaluated_at),
    vitals,
  }
}

function readFactoryOperatingWindow(value: unknown): RemoteFactoryOperatingWindowSummary | undefined {
  const window = asRecord(value)
  if (!window) return undefined
  return {
    status: readString(window.status),
    evaluatedAt: readString(window.evaluated_at),
    windowStartedAt: readString(window.window_started_at),
    windowDays: readNumber(window.window_days),
    requiredCycles: readNumber(window.required_cycles),
    observedCycles: readNumber(window.observed_cycles),
    remainingCycles: readNumber(window.remaining_cycles),
    firstCycleAt: readString(window.first_cycle_at),
    latestCycleAt: readString(window.latest_cycle_at),
    cycleRunIds: readStringArray(window.cycle_run_ids),
  }
}

const LOCAL_FACTORY_HOST_KINDS = new Set(["local", "docker", "local-dockerized", "local_dockerized"])

function factoryIsRunning(input: {
  factoryStatus?: string
  runtimeState?: string
  runtimeEnabled?: boolean
  activeEfforts?: number
}): boolean {
  if (input.factoryStatus !== "active") return false
  if (input.runtimeEnabled === false) return false
  if ((input.activeEfforts ?? 0) > 0) return true
  const state = (input.runtimeState ?? "").toLowerCase()
  return state === "due" || state === "scheduled"
}

function readFactoryCloudDevEnv(payload: Record<string, unknown>): { hasCloudDevEnv: boolean; label?: string } {
  const workspace = asRecord(payload.workspace)
  const sources: unknown[] = [
    workspace,
    workspace?.workspace_context,
    workspace?.default_launch_profile,
    workspace?.resource_bindings,
    workspace?.resource_bindings_by_project,
    asRecord(payload.factory)?.metadata,
  ]
  for (const link of asArray(workspace?.projects)) {
    const projectLink = asRecord(link)
    sources.push(projectLink?.default_launch_profile, projectLink?.resource_bindings, projectLink?.metadata)
  }
  for (const link of asArray(payload.linked_projects)) {
    const projectLink = asRecord(link)
    sources.push(projectLink?.default_launch_profile, projectLink?.resource_bindings, projectLink?.metadata)
  }

  let hostKind: string | undefined
  let cloudSlot: string | undefined
  let substrateKind: string | undefined
  for (const source of sources) {
    hostKind = hostKind ?? findHostKind(source)
    cloudSlot = cloudSlot ?? findCloudSlotId(source)
    substrateKind = substrateKind ?? findSubstrateKind(source)
  }

  if (cloudSlot) {
    return { hasCloudDevEnv: true, label: shortCloudLabel(cloudSlot) }
  }
  if (substrateKind && !LOCAL_FACTORY_HOST_KINDS.has(substrateKind.toLowerCase())) {
    return { hasCloudDevEnv: true, label: shortCloudLabel(substrateKind) }
  }
  if (hostKind && !LOCAL_FACTORY_HOST_KINDS.has(hostKind.toLowerCase())) {
    return { hasCloudDevEnv: true, label: shortCloudLabel(hostKind) }
  }
  return { hasCloudDevEnv: false }
}

function findHostKind(value: unknown): string | undefined {
  const record = asRecord(value)
  if (!record) return undefined
  const direct = readString(record.host_kind) ?? readString(record.hostKind)
  if (direct) return direct
  for (const nestedKey of ["launch_profile", "launch_request", "workspace_profile", "smoke_targets", "execution"]) {
    const nested = asRecord(record[nestedKey])
    const nestedHost = readString(nested?.host_kind) ?? readString(nested?.hostKind)
    if (nestedHost) return nestedHost
  }
  return undefined
}

function findCloudSlotId(value: unknown): string | undefined {
  const record = asRecord(value)
  if (!record) return undefined
  return (
    readString(record.cloud_slot_id) ??
    readString(record.cloud_slot) ??
    readString(asRecord(record.substrate)?.cloud_slot_id) ??
    readString(asRecord(record.environment_spec)?.cloud_slot_id)
  )
}

function findSubstrateKind(value: unknown): string | undefined {
  const record = asRecord(value)
  if (!record) return undefined
  return readString(asRecord(record.substrate)?.kind) ?? readString(record.substrate_kind)
}

function shortCloudLabel(value: string): string {
  const normalized = value.replace(/\s+/g, "_").trim().toLowerCase()
  if (normalized.includes("railway")) return "railway"
  if (normalized.includes("daytona")) return "daytona"
  if (normalized.includes("exe_dev") || normalized.includes("exedev")) return "exe.dev"
  if (normalized.includes("modal")) return "modal"
  if (normalized.startsWith("cloud-") || normalized.startsWith("cloud_")) return normalized.slice(0, 12)
  const trimmed = value.replace(/\s+/g, " ").trim()
  return trimmed.length <= 10 ? trimmed : `${trimmed.slice(0, 9)}…`
}

function activeFactoryProjectIds(linkedProjects: unknown[], projects: unknown[]): string[] {
  const ids = linkedProjects
    .map((item) => {
      const link = asRecord(item)
      const project = asRecord(link?.project)
      const status = readString(link?.status)?.toLowerCase()
      if (status === "archived" || readBoolean(project?.archived)) return undefined
      return readString(link?.project_id) ?? readString(project?.project_id)
    })
    .filter((projectId): projectId is string => Boolean(projectId))
  for (const item of projects) {
    const project = asRecord(item)
    if (readBoolean(project?.archived)) continue
    const projectId = readString(project?.project_id)
    if (projectId && !ids.includes(projectId)) ids.push(projectId)
  }
  return ids
}

function readRuns(value: unknown): RemoteSmrRunSummary[] {
  return asArray(value)
    .map((item): RemoteSmrRunSummary | undefined => {
      const run = asRecord(item)
      const runId = readString(run?.run_id) ?? readString(run?.id)
      if (!run || !runId) return undefined
      return {
        runId,
        projectId: readString(run.project_id),
        state: readScalarString(run.public_state) ?? readString(run.status) ?? "unknown",
        phase: readScalarString(run.liveness_phase),
        runbook: readString(run.runbook),
        createdAt: readString(run.created_at),
        startedAt: readString(run.started_at),
        updatedAt: readString(run.updated_at),
        finishedAt: readString(run.finished_at),
        reason: readString(run.status_reason) ?? readString(run.stop_reason_message) ?? readString(run.stop_reason),
      }
    })
    .filter((run): run is RemoteSmrRunSummary => Boolean(run))
}

function readFactories(value: unknown): RemoteFactorySummary[] {
  return asArray(value)
    .map((item): RemoteFactorySummary | undefined => {
      const factory = asRecord(item)
      const factoryId = readString(factory?.factory_id) ?? readString(factory?.id)
      if (!factory || !factoryId) return undefined
      return {
        factoryId,
        name: readString(factory.name) ?? factoryId,
        kind: readString(factory.kind),
        status: readString(factory.status),
      }
    })
    .filter((factory): factory is RemoteFactorySummary => Boolean(factory))
}

function readArtifacts(value: unknown): RemoteArtifactSummary[] {
  return asArray(value)
    .map((item): RemoteArtifactSummary | undefined => {
      const artifact = asRecord(item)
      const artifactId = readString(artifact?.artifact_id) ?? readString(artifact?.id)
      if (!artifact || !artifactId) return undefined
      return {
        artifactId,
        artifactType: readString(artifact.artifact_type),
        title: readString(artifact.title),
        createdAt: readString(artifact.created_at),
      }
    })
    .filter((artifact): artifact is RemoteArtifactSummary => Boolean(artifact))
}

function readWorkProducts(value: unknown): RemoteWorkProductSummary[] {
  return asArray(value)
    .map((item): RemoteWorkProductSummary | undefined => {
      const workProduct = asRecord(item)
      const workProductId = readString(workProduct?.work_product_id) ?? readString(workProduct?.id)
      if (!workProduct || !workProductId) return undefined
      return {
        workProductId,
        kind: readString(workProduct.kind),
        title: readString(workProduct.title),
        status: readString(workProduct.status),
        readiness: readString(workProduct.readiness),
        artifactId: readString(workProduct.artifact_id),
        createdAt: readString(workProduct.created_at),
      }
    })
    .filter((workProduct): workProduct is RemoteWorkProductSummary => Boolean(workProduct))
}

function readRuntimeMessages(value: unknown): RemoteRuntimeMessageSummary[] {
  return asArray(value)
    .map((item): RemoteRuntimeMessageSummary | undefined => {
      const message = asRecord(item)
      const messageId = readString(message?.message_id) ?? readString(message?.id)
      if (!message || !messageId) return undefined
      return {
        messageId,
        status: readString(message.status),
        mode: readString(message.mode),
        sender: readString(message.sender),
        target: readString(message.target),
        action: readString(message.action),
        body: readString(message.body),
        createdAt: readString(message.created_at),
      }
    })
    .filter((message): message is RemoteRuntimeMessageSummary => Boolean(message))
}

function readFileMounts(value: unknown): RemoteRunFileMountSummary[] {
  return asArray(value)
    .map((item): RemoteRunFileMountSummary | undefined => {
      const mount = asRecord(item)
      const file = asRecord(mount?.file)
      const mountId = readString(mount?.mount_id) ?? readString(mount?.id)
      const fileId = readString(mount?.file_id) ?? readString(file?.file_id)
      const mountPath = readString(mount?.mount_path) ?? readString(file?.path)
      if (!mount || !mountId || !fileId || !mountPath) return undefined
      return {
        mountId,
        fileId,
        mountPath,
        visibility: readString(mount.visibility) ?? readString(file?.visibility),
        active: readBoolean(mount.active),
        contentType: readString(file?.content_type),
        contentBytes: readNumber(file?.content_bytes),
        createdAt: readString(mount.created_at) ?? readString(file?.created_at),
      }
    })
    .filter((mount): mount is RemoteRunFileMountSummary => Boolean(mount))
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items) {
    const key = keyFn(item)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

async function getJson(config: StackConfig, path: string): Promise<unknown> {
  const response = await fetch(`${config.environment.apiBaseUrl.replace(/\/+$/, "")}${path}`, {
    headers: {
      Authorization: `Bearer ${process.env[config.environment.authEnv]}`,
    },
    signal: AbortSignal.timeout(3000),
  })
  if (!response.ok) throw new Error(`${path} ${response.status} ${response.statusText}`)
  return await response.json()
}

async function postJsonBody(
  config: StackConfig,
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; message: string; payload?: unknown }> {
  const auth = environmentAuthStatus(config.environment)
  const token = process.env[config.environment.authEnv]
  if (!auth.hasAuth || !token) {
    return { ok: false, status: 0, message: auth.message }
  }
  try {
    const response = await fetch(`${config.environment.apiBaseUrl.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(dropUndefined(body)),
      signal: AbortSignal.timeout(30000),
    })
    const text = await response.text()
    let payload: unknown
    try {
      payload = text ? JSON.parse(text) as unknown : undefined
    } catch {
      payload = text
    }
    return {
      ok: response.ok,
      status: response.status,
      message: response.ok ? "ok" : readResponseErrorMessage(payload) ?? response.statusText,
      payload,
    }
  } catch (error) {
    return { ok: false, status: 0, message: errorMessage(error) }
  }
}

export async function headUrlStatus(url: string, timeoutMs = 3000): Promise<number | undefined> {
  if (!/^https?:\/\//i.test(url)) return undefined
  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(Math.max(250, Math.min(Math.floor(timeoutMs), 10000))),
    })
    return response.status
  } catch {
    return undefined
  }
}

function readScalarString(value: unknown): string | undefined {
  if (typeof value === "string") return value
  const record = asRecord(value)
  return readString(record?.value) ?? readString(record?.state) ?? readString(record?.name)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function readJsonRecord(value: unknown): Record<string, RemoteJsonValue> {
  const parsed = readJsonValue(value)
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
}

function readJsonValue(value: unknown): RemoteJsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (Array.isArray(value)) {
    const items: RemoteJsonValue[] = []
    for (const item of value) {
      const parsed = readJsonValue(item)
      if (parsed !== undefined) items.push(parsed)
    }
    return items
  }
  const record = asRecord(value)
  if (!record) return undefined
  const output: Record<string, RemoteJsonValue> = {}
  for (const [key, item] of Object.entries(record)) {
    const parsed = readJsonValue(item)
    if (parsed !== undefined) output[key] = parsed
  }
  return output
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function readBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : false
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function readStringArray(value: unknown): string[] {
  return asArray(value).filter((item): item is string => typeof item === "string" && item.length > 0)
}

function readHostedArtifactRows(value: unknown): HostedArtifactSummary[] {
  return asArray(value)
    .map((item): HostedArtifactSummary | undefined => {
      const artifact = asRecord(item)
      const hostedArtifactId = readString(artifact?.hosted_artifact_id) ?? readString(artifact?.hostedArtifactId)
      if (!artifact || !hostedArtifactId) return undefined
      return {
        hostedArtifactId,
        projectId: readString(artifact.project_id),
        runId: readString(artifact.run_id),
        builtByRunId: readString(artifact.built_by_run_id),
        workProductId: readString(artifact.work_product_id),
        status: readString(artifact.status),
        title: readString(artifact.title),
        hostedUrl: readString(artifact.hosted_url) ?? readString(artifact.hostedUrl),
        canonicalUrl: readString(artifact.canonical_url) ?? readString(artifact.canonicalUrl),
        publicUrl: readString(artifact.public_url) ?? readString(artifact.publicUrl),
        slug: readString(artifact.slug),
        visibility: readString(artifact.visibility),
        artifactVersion: readNumber(artifact.artifact_version),
        sourceRunIds: readStringArray(artifact.source_run_ids),
        traceId: readString(artifact.trace_id),
        publishedAt: readString(artifact.published_at),
      }
    })
    .filter((artifact): artifact is HostedArtifactSummary => Boolean(artifact))
}

function hostedArtifactPublishResult(status: number, value: unknown): PublishHostedArtifactResult {
  const payload = asRecord(value)
  const hostedArtifactId = readString(payload?.hosted_artifact_id) ?? readString(payload?.hostedArtifactId)
  const hostedUrl = readString(payload?.hosted_url) ?? readString(payload?.hostedUrl)
  const canonicalUrl = readString(payload?.canonical_url) ?? readString(payload?.canonicalUrl)
  const publicUrl = readString(payload?.public_url) ?? readString(payload?.publicUrl)
  return {
    ok: Boolean(hostedArtifactId || hostedUrl || publicUrl),
    status,
    message: hostedArtifactId || hostedUrl || publicUrl ? "ok" : "missing hosted artifact fields",
    hostedArtifactId,
    hostedUrl,
    canonicalUrl,
    publicUrl,
    slug: readString(payload?.slug),
    visibility: readString(payload?.visibility),
    artifactVersion: readNumber(payload?.artifact_version) ?? readNumber(payload?.artifactVersion),
    sourceRunIds: readStringArray(payload?.source_run_ids),
    traceId: readString(payload?.trace_id),
    response: value,
  }
}

function dropUndefined(value: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) cleaned[key] = entry
  }
  return cleaned
}

function readResponseErrorMessage(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 500)
  const record = asRecord(value)
  const detail = record?.detail
  if (typeof detail === "string" && detail.trim()) return detail.trim().slice(0, 500)
  const detailRecord = asRecord(detail)
  const message = readString(detailRecord?.message) ?? readString(record?.message) ?? readString(record?.error)
  return message?.slice(0, 500)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function readRunHostedArtifactStatus(
  config: StackConfig,
  runId: string,
): Promise<HostedArtifactStatus> {
  const base: HostedArtifactStatus = {
    runId,
    status: "none",
    message: "not checked",
  }
  const auth = environmentAuthStatus(config.environment)
  if (!auth.hasAuth) {
    return { ...base, status: "none", message: auth.message }
  }
  try {
    const payload = asRecord(
      await getJson(config, `/smr/runs/${encodeURIComponent(runId)}/hosted-artifact`),
    )
    if (!payload) {
      return { ...base, status: "none", message: "no hosted artifact record" }
    }
    const statusRaw = (readString(payload.status) ?? readString(payload.state) ?? "unknown").toLowerCase()
    let status: HostedArtifactStatus["status"] = "unknown"
    if (statusRaw.includes("build")) status = "building"
    else if (statusRaw.includes("publish")) status = "published"
    else if (statusRaw.includes("ready") || statusRaw.includes("draft")) status = "ready"
    else if (statusRaw.includes("none") || statusRaw.includes("absent")) status = "none"

    const hostedUrl = readString(payload.hosted_url) ?? readString(payload.hostedUrl)
    const publicUrl = readString(payload.public_url) ?? readString(payload.publicUrl) ?? readString(payload.openresearch_url)
    const slug = readString(payload.slug) ?? readString(payload.public_slug)
    const visibility = (readString(payload.visibility) as HostedArtifactStatus["visibility"]) || undefined
    const urlStatus = readNumber(payload.url_status) ?? readNumber(payload.http_status) ?? (hostedUrl ? 200 : undefined)

    return {
      runId,
      status,
      hostedUrl,
      publicUrl,
      slug,
      visibility,
      urlStatus,
      message: readString(payload.message) ?? (hostedUrl ? undefined : "hosted url not present"),
    }
  } catch (error) {
    // Treat 404 / missing as "none" (artifact not yet materialized)
    const msg = errorMessage(error)
    if (msg.includes("404") || msg.includes("not found")) {
      return { ...base, status: "none", message: "no hosted artifact for run" }
    }
    return {
      ...base,
      status: "unknown",
      message: msg,
    }
  }
}
