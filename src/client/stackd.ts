import type { StackSessionUsageSummary } from "../session.js"

export const DEFAULT_STACK_API_URL = "http://127.0.0.1:8792"
export const STACKD_RUNTIME_EVENT_LIMITS = {
  eventTypeBytes: 160,
  sourceBytes: 160,
  subjectKindBytes: 160,
  subjectIdBytes: 512,
  observedAtBytes: 128,
  payloadBytes: 64 * 1024,
} as const

export type StackdHealth = {
  ok: boolean
  stackd_version: string
  stack_version?: string
  channel?: string
  session_log_dir: string
}

export type StackdThreadSummary = {
  id: string
  path: string
  startedAt: string
  updatedAt: string
  turnCount: number
  lastPrompt?: string
  displayName?: string
  harness?: "codex" | "cursor" | string
  metaThreadId?: string
  segmentId?: string
  segmentRole?: string
  codexThreadId?: string
  usageSummary?: unknown
}

export type StackdTrace = {
  stack_session_id: string
  stack_session_path: string
  codex_thread_id?: string
  codex_session_path?: string
  turn_count: number
  usage_summary?: unknown
  turns: Array<{
    index: number
    prompt_preview?: string
    exit_code?: number
    started_at: string
    finished_at?: string
  }>
}

export type StackdStatus = {
  ok: boolean
  stackd_version: string
  stack_version?: string
  channel?: string
  session_log_dir: string
  runtime_status_path: string
  session_count: number
  latest_session?: StackdThreadSummary
  runtime?: StackdRuntimeStatusProjection | Record<string, unknown> | null
}

export type StackdRuntimeFactoryResponse = {
  status: "ready" | "empty" | string
  events_appended?: number
  snapshot?: StackdFactorySnapshot | null
}

export type StackdRuntimeStatusProjection = {
  schema: "stack.runtime_status.v1" | string
  updated_at: string
  events_appended: number
  factory: StackdFactorySnapshot
}

export type StackdRuntimeEventsResponse = {
  events: unknown[]
}

export type StackdRuntimeEvent = {
  event_id: string
  seq: number
  event_type: string
  source: string
  observed_at: string
  subject: {
    kind: string
    id: string
  }
  correlation?: StackdRuntimeCorrelation
  payload?: unknown
}

export type StackdRuntimeCorrelation = {
  stack_session_id?: string | null
  project_id?: string | null
  run_id?: string | null
  factory_id?: string | null
  deployment_id?: string | null
  optimizer_run_id?: string | null
  trace_id?: string | null
  commit_sha?: string | null
  feature_id?: string | null
  flag_key?: string | null
  variant?: string | null
}

export type StackdRuntimeEventAppendRequest = {
  event_type: `lever.${string}`
  source: `lever.${string}`
  observed_at?: string
  subject: {
    kind: string
    id: string
  }
  correlation?: StackdRuntimeCorrelation
  payload?: unknown
}

export type StackdRuntimeEventAppendResponse = {
  status: "ready" | string
  events_appended: number
  events: StackdRuntimeEvent[]
  snapshot: StackdFactorySnapshot
}

export type StackdRuntimeEventRef = {
  seq: number
  event_type: string
  source: string
  observed_at: string
  subject_kind: string
  subject_id: string
}

export type StackdFactorySnapshot = {
  schema: "stack.factory_snapshot.v1" | string
  updated_at: string
  control_state:
    | "quiescent"
    | "local_gepa_running"
    | "remote_run_active"
    | "hosted_optimizer_active"
    | "dual_active"
    | "degraded"
    | string
  local_gepa: {
    sync_enabled: boolean
    service_status: string
    service_url?: string | null
    active_run_id?: string | null
    active_run_count: number
    last_progress_at?: string | null
    last_error?: string | null
  }
  remote_synth: {
    sync_enabled: boolean
    auth_status: string
    environment_name?: string | null
    api_base_url?: string | null
    active_project_count: number
    active_run_count: number
    active_factory_count: number
    active_hosted_optimizer_count: number
    deployment_count?: number
    degraded_deployment_count?: number
    last_ok_at?: string | null
    projects: StackdRemoteProjectSnapshot[]
    runs: StackdRemoteRunSnapshot[]
    factories: StackdRemoteFactorySnapshot[]
    hosted_optimizers: StackdRemoteHostedOptimizerSnapshot[]
    deployments?: StackdRemoteDeploymentSnapshot[]
    pending_push?: StackdRemoteSyncRequestSnapshot[]
    pending_pull?: StackdRemoteSyncRequestSnapshot[]
    recent_remote_gardener_passes?: StackdRemoteGardenerPassSnapshot[]
    linked_smr_runs?: StackdRemoteSmrRunBindingSnapshot[]
  }
  recent_events: StackdRuntimeEventRef[]
}

export type StackdRemoteProjectSnapshot = {
  project_id: string
  name: string
  alias?: string | null
  updated_at?: string | null
  active_run_id?: string | null
  run_ids: string[]
  factory_ids: string[]
}

export type StackdRemoteRunSnapshot = {
  run_id: string
  project_id?: string | null
  state: string
  phase?: string | null
  runbook?: string | null
  updated_at?: string | null
  terminal: boolean
}

export type StackdRemoteFactorySnapshot = {
  factory_id: string
  name: string
  kind?: string | null
  status?: string | null
  canonical_project_id?: string | null
  latest_project_id?: string | null
  latest_run_id?: string | null
  next_wake_at?: string | null
  active_efforts?: number | null
  has_cloud_dev_env?: boolean | null
  cloud_dev_label?: string | null
  is_running?: boolean | null
  project_ids: string[]
}

export type StackdRemoteHostedOptimizerSnapshot = {
  run_id: string
  status: string
  updated_at?: string | null
  terminal: boolean
}

export type StackdRemoteDeploymentSnapshot = {
  deployment_id: string
  name: string
  status?: string | null
  preflight_status?: string | null
  degraded_reason?: string | null
  project_id?: string | null
  factory_id?: string | null
  topology?: string | null
  substrate?: string | null
  updated_at?: string | null
  ready?: boolean | null
}

export type StackdRemoteSyncRequestSnapshot = {
  event_id: string
  seq: number
  observed_at: string
  direction: string
  intent: string
  subject_kind: string
  subject_id: string
  environment_name?: string | null
  api_base_url?: string | null
  project_id?: string | null
  run_id?: string | null
  factory_id?: string | null
  deployment_id?: string | null
  meta_thread_id?: string | null
  thread_id?: string | null
  actor_role?: string | null
  actor_id?: string | null
  note?: string | null
}

export type StackdRemoteGardenerPassSnapshot = {
  event_id: string
  seq: number
  observed_at: string
  subject_kind: string
  subject_id: string
  environment_name?: string | null
  api_base_url?: string | null
  actor_role?: string | null
  actor_id?: string | null
  meta_thread_id?: string | null
  thread_id?: string | null
  project_id?: string | null
  run_id?: string | null
  factory_id?: string | null
  deployment_id?: string | null
  narration?: string | null
  next_action?: string | null
  runtime_status?: string | null
  auth_status?: string | null
}

export type StackdRemoteSmrRunBindingSnapshot = {
  event_id: string
  seq: number
  observed_at: string
  environment_name?: string | null
  api_base_url?: string | null
  meta_thread_id?: string | null
  thread_id?: string | null
  project_id?: string | null
  run_id: string
  factory_id?: string | null
  deployment_id?: string | null
  binding_id?: string | null
  objective?: string | null
  remote_status?: string | null
  actor_role?: string | null
  actor_id?: string | null
}

export type StackdExport = {
  export_dir: string
}

export type StackdLogQuery = {
  ok: boolean
  source: string
  result: {
    records?: unknown[]
    query?: string
    slot_id?: string
    victorialogs_url?: string
  }
}

export type StackdTelemetryStatus = {
  ok: boolean
  schema_version: number
  local_product_telemetry: {
    enabled: boolean
    default: string
    reason: string
    endpoint_configured: boolean
  }
  tiers: {
    basic_dau: "on" | "off" | string
    advanced_product: "unset" | "accepted" | "declined" | string
    asked_at?: string | null
    asked_version?: string | null
    install_id_present: boolean
    config_path: string
  }
  crash_reporting: {
    enabled: boolean
    default: string
    reason: string
    outbox_path: string
    endpoint_configured: boolean
    local_record_count: number
  }
  event_count: number
  events: Array<{
    name: string
    class: string
    owner: string
    payload: string[]
  }>
  forbidden_fields: string[]
}

export type StackdTelemetryEventRequest = {
  name: string
  payload?: Record<string, string | number | boolean | null>
}

export type StackdTelemetryEventResponse = {
  ok: boolean
  accepted: boolean
  emitted: boolean
  reason: string
  outbox_path?: string
  event?: unknown
}

export type StackdTelemetryConfigRequest = {
  basic_dau?: "on" | "off"
  advanced_product?: "unset" | "accepted" | "declined"
  asked_version?: string
}

export type StackdTelemetryConfigResponse = {
  ok: boolean
  tiers: StackdTelemetryStatus["tiers"]
}

export type StackdTelemetryFlushResponse = {
  ok: boolean
  endpoint_configured: boolean
  attempted: number
  sent: number
  pending: number
  sent_cursor_path: string
  reason: string
}

export type StackdCrashReportRequest = {
  client_event_id: string
  observed_at: string
  crash_class: string
  surface: string
  message: string
  version?: string
  channel?: string
  target?: string
  metadata?: Record<string, string | number | boolean | null>
}

export type StackdCrashReportResponse = {
  ok: boolean
  recorded: boolean
  forwarded: boolean
  reason: string
  local_path?: string | null
  cloud_event_id?: string | null
}

export type StackdCrashReportListResponse = {
  ok: boolean
  outbox_path: string
  total: number
  returned: number
  items: Array<Record<string, unknown>>
}

export type StackdMetaThreadSegment = {
  segmentId: string
  threadId: string
  role: string
  agentRole: "worker"
  model: string
  reasoningEffort: string
  harness: "codex" | "cursor" | string
  status: "active" | "sealed" | "superseded" | string
  handoffOut?: string
  handoffIn?: string[]
  predecessorSegmentId?: string
  startedAt: string
  sealedAt?: string
  usageSummary?: StackSessionUsageSummary
}

export type StackdMetaThreadArtifact = {
  id: string
  metaThreadId: string
  artifactType: string
  path: string
  version: number
  createdBySegmentId: string
  createdByThreadId: string
  status: "draft" | "needs_review" | "approved" | "superseded" | string
  handoffId?: string
}

export type StackdHandoffRef = {
  id: string
  parentSegmentId: string
  parentThreadId: string
  childSegmentId?: string
  childThreadId?: string
  status: "draft" | "needs_review" | "approved" | "continued" | "rejected" | "superseded" | string
  createdAt: string
}

export type StackdMetaThreadActiveGoal = {
  objective: string
  status: string
  acceptance_criteria: string[]
  blockers: string[]
}

export type StackdMetaThreadRemoteBinding = {
  binding_id: string
  kind: "smr_run" | string
  environment: string
  api_base_url: string
  project_id?: string
  smr_run_id: string
  factory_id?: string
  deployment_id?: string
  objective?: string
  remote_status?: string
  bound_at: string
  bound_by: string
  reason?: string
}

export type StackdMonitorHeadline = {
  status: string
  headline: string
  note: string
  observed_at: string
  event_id: string
}

export type StackdMetaThreadManifest = {
  schema: "stack/meta-thread/v1"
  id: string
  title: string
  lifecycle_status?: StackdMetaThreadLifecycleStatus
  archived_at?: string
  archived_by?: string
  archive_reason?: string
  source?: string
  source_ref?: string
  repo_refs: string[]
  worktree_refs: string[]
  created_at: string
  updated_at: string
  segments: StackdMetaThreadSegment[]
  head_segment_id: string
  head_thread_id: string
  artifacts: StackdMetaThreadArtifact[]
  handoffs: StackdHandoffRef[]
  decisions: unknown[]
  gardener_thread_id?: string
  monitor_profile?: string
  monitor_headline?: StackdMonitorHeadline
  active_goal?: StackdMetaThreadActiveGoal
  smr_run_id?: string
  remote_bindings?: StackdMetaThreadRemoteBinding[]
  usage_summary?: StackSessionUsageSummary
}

export type StackdMetaThreadLifecycleStatus = "live" | "archived"

export type StackdAgentConfig = {
  agentRole: "worker" | "gardener" | "monitor" | string
  segmentRole?: string
  harness: "codex" | "cursor" | string
  model: string
  reasoningEffort: string
  harnessCommand?: string
  workspaceRoot?: string
  monitorProfile?: string
  threadId?: string
  segmentId?: string
}

export type StackdHandoff = {
  schema: "stack/handoff/v1"
  id: string
  metaThreadId: string
  summary: string
  parent: StackdAgentConfig
  child?: StackdAgentConfig
  artifactIds: string[]
  status: "draft" | "needs_review" | "approved" | "continued" | "rejected" | "superseded" | string
  createdAt: string
  sealedAt?: string
  approvedAt?: string
  continuedAt?: string
  approvedBy?: string
}

export type StackdMetaThreadCreateRequest = {
  title: string
  thread_id: string
  role?: string
  model: string
  reasoning_effort: string
  harness: "codex" | "cursor" | string
  source?: string
  source_ref?: string
  repo_refs?: string[]
  worktree_refs?: string[]
  gardener_thread_id?: string
  monitor_profile?: string
  active_goal?: StackdMetaThreadActiveGoal
}

export type StackdUpdateMetaThreadGoalRequest = {
  objective?: string
  status?: string
  acceptance_criteria?: string[]
  blockers?: string[]
}

export type StackdUpdateMetaThreadLifecycleRequest = {
  status: StackdMetaThreadLifecycleStatus
  reason?: string
  actor_id?: string
}

export type StackdUpdateMetaThreadTitleRequest = {
  title: string
  reason?: string
  actor_id?: string
}

export type StackdUpdateMetaThreadTitleResponse = {
  manifest: StackdMetaThreadManifest
  event_id?: string | null
}

export type StackdBindMetaThreadRemoteSmrRunRequest = {
  smr_run_id: string
  environment: string
  api_base_url: string
  project_id?: string
  factory_id?: string
  deployment_id?: string
  objective?: string
  remote_status?: string
  actor_id?: string
  reason?: string
}

export type StackdBindMetaThreadRemoteSmrRunResponse = {
  manifest: StackdMetaThreadManifest
  binding: StackdMetaThreadRemoteBinding
  event_id: string
}

export type StackdMetaThreadSealRequest = {
  summary?: string
  artifact_type?: string
  title?: string
  body?: string
  status?: string
  recommended_next_action?: string
  successor_role?: string
}

export type StackdMetaThreadContinueRequest = {
  role: string
  model: string
  reasoning_effort: string
  harness: "codex" | "cursor" | string
  harness_command: string
  workspace_root: string
  artifact_ids?: string[]
}

export type StackdMetaThreadContinueResponse = {
  manifest: StackdMetaThreadManifest
  handoff: StackdHandoff
  session: unknown
  prompt: string
  session_path: string
}

export type StackdSkillRecord = {
  skill_id: string
  name: string
  title: string
  description: string
  source_path: string
  origin: "preinstalled" | "bundled" | "custom" | string
  installed_at: string
  installed_by: "stackd" | "gardener" | "operator" | "user" | string
  allowed_actors: string
  mcp_exposed: boolean
}

export type StackdSkillListResponse = {
  count: number
  skills: StackdSkillRecord[]
}

export type StackdSkillReadResponse = {
  skill: StackdSkillRecord
  content: string
  truncated: boolean
}

export type StackdRegisterSkillRequest = {
  skill_id: string
  title?: string
  description?: string
  content?: string
  source_path?: string
  installed_by?: string
  allowed_actors?: string
  mcp_exposed?: boolean
}

export function stackdBaseUrl(): string {
  return process.env.STACK_API_URL?.trim() || DEFAULT_STACK_API_URL
}

export async function stackdHealthOk(baseUrl = stackdBaseUrl()): Promise<boolean> {
  try {
    const health = await stackdHealth(baseUrl)
    return health.ok === true
  } catch {
    return false
  }
}

export async function stackdHealth(baseUrl = stackdBaseUrl()): Promise<StackdHealth> {
  return requestJson<StackdHealth>(baseUrl, "/health")
}

export async function stackdStatus(baseUrl = stackdBaseUrl()): Promise<StackdStatus> {
  return requestJson<StackdStatus>(baseUrl, "/status")
}

export type StackdMetaSidePanel = {
  panel: string
  view?: string | null
  opened_by: string
  reason?: string | null
  opened_at?: string | null
}

export type StackdMetaThreadSnapshot = {
  thread_id: string
  meta_thread_id?: string | null
  goal: { phase: string; objective?: string | null; status?: string | null }
  actors: Array<{
    actor_id: string
    role: string
    state: string
    cursor?: string | null
    queued_triggers: string[]
    next_wake_on?: string[] | null
    next_wake_at?: string | null
  }>
  ui: { side_panel?: StackdMetaSidePanel | null }
  headline?: { headline?: string | null; note?: string | null; status?: string | null } | null
}

export type StackdMetaStatus = {
  schema: string
  generated_at: string
  threads: StackdMetaThreadSnapshot[]
}

export type StackdGardenerPassCompleteRequest = {
  cursor_event_id?: string
  wake_reason?: string
  workspace_garden_path?: string
  gardener_garden_path?: string
  inbox_pending?: number
}

export type StackdGardenerPassCompleteResponse = {
  ok: boolean
  event: unknown
  actor: unknown
}

export async function stackdMetaStatus(baseUrl = stackdBaseUrl()): Promise<StackdMetaStatus> {
  return requestJson<StackdMetaStatus>(baseUrl, "/meta/status")
}

export async function stackdGardenerPassComplete(
  threadId: string,
  gardenerId: string,
  request: StackdGardenerPassCompleteRequest,
  baseUrl = stackdBaseUrl(),
): Promise<StackdGardenerPassCompleteResponse> {
  return requestJson<StackdGardenerPassCompleteResponse>(
    baseUrl,
    `/threads/${encodeURIComponent(threadId)}/gardeners/${encodeURIComponent(gardenerId)}/pass-complete`,
    jsonPost(request),
  )
}

export async function stackdRuntimeFactory(baseUrl = stackdBaseUrl()): Promise<StackdRuntimeFactoryResponse> {
  return requestJson<StackdRuntimeFactoryResponse>(baseUrl, "/runtime/factory")
}

export async function stackdRuntimeEvents(
  query: { afterSeq?: number; limit?: number; source?: string } = {},
  baseUrl = stackdBaseUrl(),
): Promise<StackdRuntimeEventsResponse> {
  validateRuntimeEventsQuery(query)
  const url = new URL("/runtime/events", ensureTrailingSlash(baseUrl))
  if (query.afterSeq !== undefined) url.searchParams.set("after_seq", String(query.afterSeq))
  if (query.limit !== undefined) url.searchParams.set("limit", String(query.limit))
  if (query.source !== undefined) url.searchParams.set("source", query.source)
  return requestJson<StackdRuntimeEventsResponse>(baseUrl, `${url.pathname}${url.search}`)
}

export async function stackdRuntimeAppendEvent(
  request: StackdRuntimeEventAppendRequest,
  baseUrl = stackdBaseUrl(),
): Promise<StackdRuntimeEventAppendResponse> {
  validateRuntimeEventAppendRequest(request)
  return requestJson<StackdRuntimeEventAppendResponse>(baseUrl, "/runtime/events", jsonPost(request))
}

export async function stackdRuntimeTick(baseUrl = stackdBaseUrl()): Promise<StackdRuntimeFactoryResponse> {
  return requestJson<StackdRuntimeFactoryResponse>(baseUrl, "/runtime/tick", jsonPost({}))
}

export async function stackdThreads(baseUrl = stackdBaseUrl()): Promise<StackdThreadSummary[]> {
  return requestJson<StackdThreadSummary[]>(baseUrl, "/threads")
}

export async function stackdThread(id: string, baseUrl = stackdBaseUrl()): Promise<unknown> {
  return requestJson<unknown>(baseUrl, `/threads/${encodeURIComponent(id)}`)
}

export async function stackdTrace(id: string, baseUrl = stackdBaseUrl()): Promise<StackdTrace> {
  return requestJson<StackdTrace>(baseUrl, `/threads/${encodeURIComponent(id)}/trace`)
}

export async function stackdExport(id: string, baseUrl = stackdBaseUrl()): Promise<StackdExport> {
  return requestJson<StackdExport>(baseUrl, `/threads/${encodeURIComponent(id)}/export`)
}

export async function stackdLogsQuery(
  query: Record<string, string | number | undefined>,
  baseUrl = stackdBaseUrl(),
): Promise<StackdLogQuery> {
  const url = new URL("/logs/query", ensureTrailingSlash(baseUrl))
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
  return requestJson<StackdLogQuery>(baseUrl, `${url.pathname}${url.search}`)
}

export async function stackdTelemetryStatus(baseUrl = stackdBaseUrl()): Promise<StackdTelemetryStatus> {
  return requestJson<StackdTelemetryStatus>(baseUrl, "/telemetry/status")
}

export async function stackdUpdateTelemetryConfig(
  request: StackdTelemetryConfigRequest,
  baseUrl = stackdBaseUrl(),
): Promise<StackdTelemetryConfigResponse> {
  return requestJson<StackdTelemetryConfigResponse>(baseUrl, "/telemetry/config", jsonPost(request))
}

export async function stackdRecordTelemetryEvent(
  request: StackdTelemetryEventRequest,
  baseUrl = stackdBaseUrl(),
): Promise<StackdTelemetryEventResponse> {
  return requestJson<StackdTelemetryEventResponse>(baseUrl, "/telemetry/events", jsonPost(request))
}

export async function stackdFlushTelemetryEvents(baseUrl = stackdBaseUrl()): Promise<StackdTelemetryFlushResponse> {
  return requestJson<StackdTelemetryFlushResponse>(baseUrl, "/telemetry/flush", jsonPost({}))
}

export async function stackdRecordCrashReport(
  request: StackdCrashReportRequest,
  baseUrl = stackdBaseUrl(),
): Promise<StackdCrashReportResponse> {
  return requestJson<StackdCrashReportResponse>(baseUrl, "/telemetry/crashes", jsonPost(request))
}

export async function stackdListCrashReports(
  query: { limit?: number } = {},
  baseUrl = stackdBaseUrl(),
): Promise<StackdCrashReportListResponse> {
  const url = new URL("/telemetry/crashes", ensureTrailingSlash(baseUrl))
  if (typeof query.limit === "number") url.searchParams.set("limit", String(query.limit))
  return requestJson<StackdCrashReportListResponse>(baseUrl, `${url.pathname}${url.search}`)
}

export async function stackdMetaThreads(
  query: { lifecycle?: StackdMetaThreadLifecycleStatus | "all" } = {},
  baseUrl = stackdBaseUrl(),
): Promise<StackdMetaThreadManifest[]> {
  const url = new URL("/meta-threads", ensureTrailingSlash(baseUrl))
  if (query.lifecycle) url.searchParams.set("lifecycle", query.lifecycle)
  return requestJson<StackdMetaThreadManifest[]>(baseUrl, `${url.pathname}${url.search}`)
}

export async function stackdMetaThread(id: string, baseUrl = stackdBaseUrl()): Promise<StackdMetaThreadManifest> {
  return requestJson<StackdMetaThreadManifest>(baseUrl, `/meta-threads/${encodeURIComponent(id)}`)
}

export async function stackdHandoff(
  metaThreadId: string,
  handoffId: string,
  baseUrl = stackdBaseUrl(),
): Promise<StackdHandoff> {
  return requestJson<StackdHandoff>(
    baseUrl,
    `/meta-threads/${encodeURIComponent(metaThreadId)}/handoffs/${encodeURIComponent(handoffId)}`,
  )
}

export async function stackdCreateMetaThread(
  request: StackdMetaThreadCreateRequest,
  baseUrl = stackdBaseUrl(),
): Promise<StackdMetaThreadManifest> {
  return requestJson<StackdMetaThreadManifest>(baseUrl, "/meta-threads", jsonPost(request))
}

export async function stackdSealMetaThreadSegment(
  metaThreadId: string,
  segmentId: string,
  request: StackdMetaThreadSealRequest,
  baseUrl = stackdBaseUrl(),
): Promise<StackdMetaThreadArtifact> {
  return requestJson<StackdMetaThreadArtifact>(
    baseUrl,
    `/meta-threads/${encodeURIComponent(metaThreadId)}/segments/${encodeURIComponent(segmentId)}/seal`,
    jsonPost(request),
  )
}

export async function stackdApproveMetaThreadArtifact(
  metaThreadId: string,
  artifactId: string,
  request: { approved_by?: string; thread_id?: string } = {},
  baseUrl = stackdBaseUrl(),
): Promise<StackdMetaThreadArtifact> {
  return requestJson<StackdMetaThreadArtifact>(
    baseUrl,
    `/meta-threads/${encodeURIComponent(metaThreadId)}/artifacts/${encodeURIComponent(artifactId)}/approve`,
    jsonPost(request),
  )
}

export async function stackdContinueMetaThread(
  metaThreadId: string,
  request: StackdMetaThreadContinueRequest,
  baseUrl = stackdBaseUrl(),
): Promise<StackdMetaThreadContinueResponse> {
  return requestJson<StackdMetaThreadContinueResponse>(
    baseUrl,
    `/meta-threads/${encodeURIComponent(metaThreadId)}/handoff/continue`,
    jsonPost(request),
  )
}

export async function stackdUpdateMetaThreadGoal(
  metaThreadId: string,
  request: StackdUpdateMetaThreadGoalRequest,
  baseUrl = stackdBaseUrl(),
): Promise<StackdMetaThreadManifest> {
  return requestJson<StackdMetaThreadManifest>(
    baseUrl,
    `/meta-threads/${encodeURIComponent(metaThreadId)}/goal`,
    jsonPatch(request),
  )
}

export async function stackdUpdateMetaThreadLifecycle(
  metaThreadId: string,
  request: StackdUpdateMetaThreadLifecycleRequest,
  baseUrl = stackdBaseUrl(),
): Promise<StackdMetaThreadManifest> {
  return requestJson<StackdMetaThreadManifest>(
    baseUrl,
    `/meta-threads/${encodeURIComponent(metaThreadId)}/lifecycle`,
    jsonPatch(request),
  )
}

export async function stackdUpdateMetaThreadTitle(
  metaThreadId: string,
  request: StackdUpdateMetaThreadTitleRequest,
  baseUrl = stackdBaseUrl(),
): Promise<StackdUpdateMetaThreadTitleResponse> {
  return requestJson<StackdUpdateMetaThreadTitleResponse>(
    baseUrl,
    `/meta-threads/${encodeURIComponent(metaThreadId)}/title`,
    jsonPatch(request),
  )
}

export async function stackdBindMetaThreadRemoteSmrRun(
  metaThreadId: string,
  request: StackdBindMetaThreadRemoteSmrRunRequest,
  baseUrl = stackdBaseUrl(),
): Promise<StackdBindMetaThreadRemoteSmrRunResponse> {
  return requestJson<StackdBindMetaThreadRemoteSmrRunResponse>(
    baseUrl,
    `/meta-threads/${encodeURIComponent(metaThreadId)}/remote-smr-run`,
    jsonPatch(request),
  )
}

export type StackdResumeCheckpoint = {
  version: 1
  schema?: string
  savedAt: string
  sessionId: string
  metaThreadId?: string
  segmentId?: string
  codexThreadId?: string
  harness?: string
  codexTransport?: string
  goalShutterWorkerPeek?: boolean
  focusMode?: string
  displayName?: string
  harnessResume?: {
    provider: string
    backendSessionId?: string
    transport: string
    resumeMethod: string
    resumePhase: string
  }
  metaThreadState?: {
    phase: string
    metaThreadId?: string
    segmentId?: string
    headThreadId?: string
    goalStatus?: string
    goalObjective?: string
  }
}

export type StackdResumeBundle = {
  checkpoint: StackdResumeCheckpoint
  session: Record<string, unknown>
  manifest?: StackdMetaThreadManifest
  resumeToken: string
  resumeCommand: string
}

export type StackdSaveCheckpointResponse = {
  checkpoint: StackdResumeCheckpoint
  resumeToken: string
  resumeCommand: string
  paths: {
    latest: string
    thread?: string
    metaThread?: string
  }
}

export async function stackdLatestCheckpoint(baseUrl = stackdBaseUrl()): Promise<StackdResumeCheckpoint> {
  return requestJson<StackdResumeCheckpoint>(baseUrl, "/checkpoints/latest")
}

export async function stackdResolveCheckpoint(
  query?: string,
  baseUrl = stackdBaseUrl(),
): Promise<StackdResumeBundle> {
  const url = new URL("/checkpoints/resolve", ensureTrailingSlash(baseUrl))
  if (query?.trim()) url.searchParams.set("q", query.trim())
  return requestJson<StackdResumeBundle>(baseUrl, `${url.pathname}${url.search}`)
}

export async function stackdSaveCheckpoint(
  checkpoint: StackdResumeCheckpoint,
  baseUrl = stackdBaseUrl(),
): Promise<StackdSaveCheckpointResponse> {
  return requestJson<StackdSaveCheckpointResponse>(baseUrl, "/checkpoints", jsonPost(checkpoint))
}

export async function stackdThreadResume(threadId: string, baseUrl = stackdBaseUrl()): Promise<StackdResumeBundle> {
  return requestJson<StackdResumeBundle>(baseUrl, `/threads/${encodeURIComponent(threadId)}/resume`)
}

export async function stackdMetaThreadResume(
  metaThreadId: string,
  baseUrl = stackdBaseUrl(),
): Promise<StackdResumeBundle> {
  return requestJson<StackdResumeBundle>(baseUrl, `/meta-threads/${encodeURIComponent(metaThreadId)}/resume`)
}

export async function stackdListSkills(baseUrl = stackdBaseUrl()): Promise<StackdSkillListResponse> {
  return requestJson<StackdSkillListResponse>(baseUrl, "/skills")
}

export async function stackdReadSkill(
  skillId: string,
  options: { maxBytes?: number } = {},
  baseUrl = stackdBaseUrl(),
): Promise<StackdSkillReadResponse> {
  const url = new URL(`/skills/${encodeURIComponent(skillId)}`, ensureTrailingSlash(baseUrl))
  if (options.maxBytes !== undefined) url.searchParams.set("max_bytes", String(options.maxBytes))
  return requestJson<StackdSkillReadResponse>(baseUrl, `${url.pathname}${url.search}`)
}

export async function stackdSearchSkills(
  query: string,
  options: { limit?: number } = {},
  baseUrl = stackdBaseUrl(),
): Promise<StackdSkillListResponse> {
  const url = new URL("/skills/search", ensureTrailingSlash(baseUrl))
  url.searchParams.set("q", query)
  if (options.limit !== undefined) url.searchParams.set("limit", String(options.limit))
  return requestJson<StackdSkillListResponse>(baseUrl, `${url.pathname}${url.search}`)
}

export async function stackdRegisterSkill(
  request: StackdRegisterSkillRequest,
  baseUrl = stackdBaseUrl(),
): Promise<StackdSkillRecord> {
  return requestJson<StackdSkillRecord>(baseUrl, "/skills", jsonPost(request))
}

export async function stackdBootstrapSkills(baseUrl = stackdBaseUrl()): Promise<StackdSkillListResponse> {
  return requestJson<StackdSkillListResponse>(baseUrl, "/skills/bootstrap", jsonPost({}))
}

async function requestJson<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(new URL(path, ensureTrailingSlash(baseUrl)), init)
  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`stackd ${path} failed with ${response.status}: ${body}`)
  }
  return (await response.json()) as T
}

function validateRuntimeEventsQuery(query: { source?: string }): void {
  if (query.source !== undefined) {
    assertByteLength("source", query.source, STACKD_RUNTIME_EVENT_LIMITS.sourceBytes)
  }
}

function validateRuntimeEventAppendRequest(request: StackdRuntimeEventAppendRequest): void {
  assertByteLength("event_type", request.event_type, STACKD_RUNTIME_EVENT_LIMITS.eventTypeBytes)
  assertByteLength("source", request.source, STACKD_RUNTIME_EVENT_LIMITS.sourceBytes)
  assertByteLength("subject.kind", request.subject.kind, STACKD_RUNTIME_EVENT_LIMITS.subjectKindBytes)
  assertByteLength("subject.id", request.subject.id, STACKD_RUNTIME_EVENT_LIMITS.subjectIdBytes)
  if (request.observed_at !== undefined) {
    assertByteLength("observed_at", request.observed_at, STACKD_RUNTIME_EVENT_LIMITS.observedAtBytes)
  }
  assertByteLength("payload", JSON.stringify(request.payload ?? {}), STACKD_RUNTIME_EVENT_LIMITS.payloadBytes)
}

function assertByteLength(field: string, value: string, maxBytes: number): void {
  const bytes = Buffer.byteLength(value, "utf8")
  if (bytes > maxBytes) {
    throw new Error(`${field} is too large: ${bytes} bytes > ${maxBytes} bytes`)
  }
}

function jsonPost(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }
}

function jsonPatch(body: unknown): RequestInit {
  return {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }
}

function ensureTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
}
