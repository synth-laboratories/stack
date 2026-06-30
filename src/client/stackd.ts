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
  stackeval_packet_id?: string | null
  project_id?: string | null
  run_id?: string | null
  factory_id?: string | null
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
    last_ok_at?: string | null
    projects: StackdRemoteProjectSnapshot[]
    runs: StackdRemoteRunSnapshot[]
    factories: StackdRemoteFactorySnapshot[]
    hosted_optimizers: StackdRemoteHostedOptimizerSnapshot[]
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

export type StackdMetaThreadManifest = {
  schema: "stack/meta-thread/v1"
  id: string
  title: string
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
  active_goal?: StackdMetaThreadActiveGoal
  usage_summary?: StackSessionUsageSummary
}

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

export async function stackdRecordTelemetryEvent(
  request: StackdTelemetryEventRequest,
  baseUrl = stackdBaseUrl(),
): Promise<StackdTelemetryEventResponse> {
  return requestJson<StackdTelemetryEventResponse>(baseUrl, "/telemetry/events", jsonPost(request))
}

export async function stackdMetaThreads(baseUrl = stackdBaseUrl()): Promise<StackdMetaThreadManifest[]> {
  return requestJson<StackdMetaThreadManifest[]>(baseUrl, "/meta-threads")
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
