import { createHash, randomUUID } from "node:crypto"
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  type Dirent,
} from "node:fs"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"
import { bundledDefaultsRoot } from "./seed/defaults.js"
import { stackAppRoot } from "./version.js"

export const STACK_EFFORT_SCHEMA = "stack/effort/v1"

export const STACK_EFFORT_STATUSES = ["active", "paused", "done", "archived"] as const
export type StackEffortStatus = (typeof STACK_EFFORT_STATUSES)[number]

export const STACK_EFFORT_FINDING_KINDS = ["idea", "code", "data", "proof", "result"] as const
export type StackEffortFindingKind = (typeof STACK_EFFORT_FINDING_KINDS)[number]

export const STACK_EFFORT_CAPTURE_KINDS = ["terminal", "browser", "screenshot", "video", "local", "monitor", "memory", "text", "benchmark", "optimizer"] as const
export type StackEffortCaptureKind = (typeof STACK_EFFORT_CAPTURE_KINDS)[number]

export const STACK_EFFORT_REF_LANES = ["hosted", "local"] as const
export type StackEffortRefLane = (typeof STACK_EFFORT_REF_LANES)[number]

export const EFFORT_LAUNCH_CAPABILITIES = [
  "optimizer.gepa.local",
  "optimizer.gepa.hosted",
  "optimizer.gelo.hosted",
  "smr.hosted",
  "project.hosted",
  "factory.hosted",
  "training.tinker.hosted",
  "artifact.publish.hosted",
  "container.pool.hosted",
  "container.deploy.hosted",
] as const
export type StackEffortLaunchCapability = (typeof EFFORT_LAUNCH_CAPABILITIES)[number]

export const EFFORT_WIRED_LAUNCH_CAPABILITIES = [
  "optimizer.gepa.local",
  "optimizer.gepa.hosted",
  "smr.hosted",
  "project.hosted",
  "factory.hosted",
  "container.pool.hosted",
  "container.deploy.hosted",
] as const satisfies readonly StackEffortLaunchCapability[]

export const STACK_EFFORT_IDEA_ORIGINS = ["HUMAN", "AGENT", "MIXED"] as const
export type StackEffortIdeaOrigin = (typeof STACK_EFFORT_IDEA_ORIGINS)[number]

export const STACK_EFFORT_NOTE_KINDS = ["human", "note"] as const
export type StackEffortNoteKind = (typeof STACK_EFFORT_NOTE_KINDS)[number]

export const STACK_EFFORT_ACCEPTANCE_UPDATE_STATES = ["recorded", "pending", "not_recorded"] as const
export type StackEffortAcceptanceUpdateState = (typeof STACK_EFFORT_ACCEPTANCE_UPDATE_STATES)[number]

export type StackEffortLinks = {
  meta_thread_refs: string[]
  repo_refs: string[]
  initiative_id: string
}

export type StackEffortRef = {
  system: string
  id: string
  lane: string
  role: string
}

export type StackEffortClaimNeedsRef = {
  system: string
  lane: string
  min: number
}

export type StackEffortClaimNeedsEvidence = {
  source_kind: string
  under: string
  min: number
}

export type StackEffortClaim = {
  label: string
  title: string
  required: boolean
  lanes?: StackEffortRefLane[]
  needs_refs: StackEffortClaimNeedsRef[]
  needs_evidence: StackEffortClaimNeedsEvidence[]
}

export type StackEffortScope = {
  capabilities: StackEffortLaunchCapability[]
}

export type StackEffortAcceptance = {
  criteria: string[]
}

export type StackEffortManifest = {
  schema: typeof STACK_EFFORT_SCHEMA
  id: string
  slug: string
  title: string
  template: string
  status: StackEffortStatus
  topic: string
  links: StackEffortLinks
  scope: StackEffortScope
  refs: StackEffortRef[]
  claims: StackEffortClaim[]
  acceptance: StackEffortAcceptance
}

export type StackEffortRegistryRecord = {
  schema: typeof STACK_EFFORT_SCHEMA
  id: string
  slug: string
  title: string
  template: string
  status: StackEffortStatus
  folder_ref: string
  meta_thread_refs: string[]
  refs: StackEffortRef[]
  created_at: string
  updated_at: string
}

export type StackEffort = {
  registry: StackEffortRegistryRecord
  manifest: StackEffortManifest
  folder_path: string
}

export type StackEffortActivityRecord = {
  activity_id: string
  type: string
  observed_at: string
  effort_id: string
  slug: string
  summary: string
  payload: Record<string, unknown>
}

export type StackEffortBlockerRecord = {
  activity_id: string
  observed_at: string
  effort_id: string
  slug: string
  summary: string
  blocker: string
  evidence: string
  owner: string
  next: string
  resolved_at?: string
  resolved_by_activity_id?: string
  resolution?: string
  resolution_evidence?: string
  resolved_by_owner?: string
}

export type StackEffortBlockerResolutionRecord = {
  activity_id: string
  observed_at: string
  effort_id: string
  slug: string
  summary: string
  blocker_activity_id: string
  blocker: string
  resolution: string
  evidence?: string
  owner?: string
}

export type StackEffortAuditStatus = "pass" | "warn" | "fail"

export type StackEffortAuditCheck = {
  id: string
  status: StackEffortAuditStatus
  summary: string
  evidence: string[]
}

export type StackEffortAudit = {
  ok: boolean
  status: StackEffortAuditStatus
  checked_at: string
  effort_id: string
  slug: string
  title: string
  template: string
  folder_ref: string
  paths: StackEffortPathRefs
  counts: {
    progress_entries: number
    activity_receipts: number
    blockers: number
    human_ideas: number
    human_notes: number
    repo_refs: number
    external_refs: number
    receipt_sidecars: number
    findings: Record<"ideas" | "code" | "data" | "proof" | "results", number>
  }
  latest_blocker: StackEffortBlockerRecord | null
  checks: StackEffortAuditCheck[]
}

export type StackEffortSummary = {
  id: string
  slug: string
  title: string
  template: string
  status: StackEffortStatus
  folder_ref: string
  meta_thread_refs: string[]
  refs: StackEffortRef[]
  updated_at: string
}

export type StackEffortPathRefs = {
  folder: string
  manifest: string
  playbook: string
  progress: string
  activity: string
  handoff: string
  acceptance_summary?: string
  research_log?: string
  ideas: string
  human: string
  notes: string
  repos: string
  findings: Record<"ideas" | "code" | "data" | "proof" | "results", string>
}

export type StackEffortArtifactInventory = {
  generated: {
    handoff?: string
    acceptance_summary?: string
    research_log?: string
  }
  ideas: string[]
  human: string[]
  notes: string[]
  repos: string[]
  findings: Record<"ideas" | "code" | "data" | "proof" | "results", string[]>
  receipt_sidecars: string[]
  receipt_sources: StackEffortArtifactReceiptSource[]
  all: string[]
  counts: {
    generated: number
    ideas: number
    human: number
    notes: number
    repos: number
    findings: Record<"ideas" | "code" | "data" | "proof" | "results", number>
    receipt_sidecars: number
    total: number
  }
}

export type StackEffortArtifactReceiptSource = {
  sidecar_path: string
  finding_path: string
  recorded_at?: string
  receipt: StackEffortFindingSourceReceipt
}

export type StackEffortOptimizerCandidateSummary = {
  activity_id: string
  observed_at: string
  optimizer_run_id: string
  candidate_id: string
  score?: string
  score_label?: string
  split?: string
  path: string
  source_receipt_path?: string
  source_kind?: string
  digest_sha256?: string
}

export type StackEffortEvidenceSummary = {
  activity_id: string
  observed_at: string
  source_kind: string
  title: string
  claim_label: string
  fields: Record<string, string>
  lists: Record<string, string[]>
  path: string
  source_receipt_path?: string
  source_receipt_kind?: string
  digest_sha256?: string
}

export type StackEffortClaimEvaluation = {
  label: string
  ok: boolean
  satisfied: string[]
  missing: string[]
}

export type StackEffortRunEvidenceSummary = {
  activity_id: string
  observed_at: string
  run_kind: string
  run_id: string
  project_id?: string
  output_id?: string
  artifact_name?: string
  metric?: string
  acceptance_level?: string
  path: string
  source_receipt_path?: string
  source_kind?: string
  digest_sha256?: string
}

export type StackEffortBenchmarkSummary = {
  activity_id: string
  observed_at: string
  benchmark_id?: string
  name: string
  version?: string
  source?: string
  license?: string
  task_shape?: string
  splits: string[]
  metrics: string[]
  path: string
  source_receipt_path?: string
  source_kind?: string
  digest_sha256?: string
}

export type StackEffortReleaseArtifactSummary = {
  activity_id: string
  observed_at: string
  version?: string
  channel?: string
  target?: string
  archive?: string
  sha256?: string
  size?: string
  manifest?: string
  release_site?: string
  publishable?: boolean
  publish_blockers: string[]
  path: string
  source_receipt_path?: string
  source_kind?: string
  digest_sha256?: string
}

export type StackEffortAcceptanceLevelState = "recorded" | "not_recorded" | "pending" | "missing" | "unknown"

export type StackEffortAcceptanceLevel = {
  label: string
  title: string
  status: string
  state: StackEffortAcceptanceLevelState
  required_for_v1: boolean
}

export type StackEffortAcceptancePacket = {
  path: string
  v1_status: "pass" | "missing" | "not_applicable"
  graduation_status: "complete" | "partial" | "open" | "not_applicable"
  levels: StackEffortAcceptanceLevel[]
  recorded_levels: string[]
  open_levels: string[]
  summary: string
}

export type StackEffortRemainingAcceptance = {
  label: string
  title: string
  status: string
  required_for_v1: boolean
}

export type StackEffortRemainingWork = {
  state: "open" | "clear" | "untracked"
  summary: string
  open_acceptance: StackEffortRemainingAcceptance[]
  out_of_scope: StackEffortRemainingAcceptance[]
  latest_blocker: StackEffortBlockerRecord | null
  next_actions: string[]
}

export type StackEffortTemplateSummary = {
  id: string
  label: string
  source: "bundled" | "installed"
  built_in: boolean
  installed_shadowed: boolean
  template_path: string
  playbook_path: string
  research_log: boolean
  findings: string[]
  acceptance_criteria: string[]
}

export type CreateEffortInput = {
  stackDataRoot: string
  workspaceRoot: string
  appRoot?: string
  slug?: string
  title: string
  template?: string
  topic?: string
  folderRef?: string
  acceptanceCriteria?: string[]
  metaThreadRefs?: string[]
}

export type EffortLookupInput = {
  stackDataRoot: string
  workspaceRoot: string
}

export type RecordEffortFindingInput = EffortLookupInput & {
  effortRef: string
  kind: StackEffortFindingKind
  title: string
  body?: string
  sourcePath?: string
  sourceReceipt?: StackEffortFindingSourceReceipt
  filename?: string
}

export type RecordEffortFindingResult = {
  effort: StackEffort
  path: string
  sourceReceiptPath?: string
  sourceReceipt?: StackEffortFindingSourceReceipt
}

export type RecordEffortCaptureInput = EffortLookupInput & {
  effortRef: string
  captureKind: StackEffortCaptureKind
  findingKind?: StackEffortFindingKind
  title: string
  body?: string
  sourcePath?: string
  sourceReceipt?: StackEffortFindingSourceReceipt
  filename?: string
}

export type RecordEffortCaptureResult = RecordEffortFindingResult & {
  captureKind: StackEffortCaptureKind
  kind: StackEffortFindingKind
}

export type RecordEffortOptimizerCandidateInput = EffortLookupInput & {
  effortRef: string
  title?: string
  optimizerRunId?: string
  candidateId?: string
  score?: string
  scoreLabel?: string
  split?: string
  body?: string
  sourcePath?: string
  sourceReceipt?: StackEffortFindingSourceReceipt
  filename?: string
}

export type RecordEffortOptimizerCandidateResult = RecordEffortFindingResult & {
  optimizerRunId?: string
  candidateId?: string
  score?: string
  scoreLabel?: string
  split?: string
}

export type RecordEffortRunEvidenceInput = EffortLookupInput & {
  effortRef: string
  runKind: string
  title?: string
  runId?: string
  projectId?: string
  outputId?: string
  artifactName?: string
  metric?: string
  acceptanceLevel?: string
  body?: string
  sourcePath?: string
  sourceReceipt?: StackEffortFindingSourceReceipt
  filename?: string
}

export type RecordEffortRunEvidenceResult = RecordEffortFindingResult & {
  runKind: string
  runId?: string
  projectId?: string
  outputId?: string
  artifactName?: string
  metric?: string
  acceptanceLevel?: string
}

export type RecordEffortBenchmarkInput = EffortLookupInput & {
  effortRef: string
  title?: string
  benchmarkId?: string
  name?: string
  version?: string
  source?: string
  license?: string
  taskShape?: string
  splits?: string[]
  metrics?: string[]
  body?: string
  sourcePath?: string
  sourceReceipt?: StackEffortFindingSourceReceipt
  filename?: string
}

export type RecordEffortBenchmarkResult = RecordEffortFindingResult & {
  benchmarkId?: string
  name: string
  version?: string
  source?: string
  license?: string
  taskShape?: string
  splits: string[]
  metrics: string[]
}

export type RecordEffortReleaseArtifactInput = EffortLookupInput & {
  effortRef: string
  title?: string
  version?: string
  channel?: string
  target?: string
  archive?: string
  sha256?: string
  size?: string
  manifest?: string
  releaseSite?: string
  publishable?: boolean
  publishBlockers?: string[]
  body?: string
  sourcePath?: string
  sourceReceipt?: StackEffortFindingSourceReceipt
  filename?: string
}

export type RecordEffortReleaseArtifactResult = RecordEffortFindingResult & {
  version?: string
  channel?: string
  target?: string
  archive?: string
  sha256?: string
  size?: string
  manifest?: string
  releaseSite?: string
  publishable?: boolean
  publishBlockers: string[]
}

export type RecordEffortArtifactInput = EffortLookupInput & {
  effortRef: string
  slug: string
  title: string
  localUrl?: string
  hostedUrl?: string
  hostedArtifactId?: string
  artifactVersion?: string
  sha256?: string
  splitsCited?: string[]
  body?: string
  sourcePath?: string
  filename?: string
}

export type RecordEffortArtifactResult = RecordEffortFindingResult & {
  slug: string
  title: string
  localUrl?: string
  hostedUrl?: string
  hostedArtifactId?: string
  artifactVersion?: string
  sha256?: string
  splitsCited: string[]
}

export type RefreshEffortReceiptDigestsInput = EffortLookupInput & {
  effortRef: string
}

export type RefreshEffortReceiptDigestRecord = {
  sidecar_path: string
  finding_path: string
  old_digest?: {
    sha256?: string
    bytes?: number
  }
  new_digest: {
    sha256: string
    bytes: number
  }
}

export type RefreshEffortReceiptDigestsResult = {
  effort: StackEffort
  checked: number
  updated: number
  skipped: string[]
  refreshed: RefreshEffortReceiptDigestRecord[]
}

export type RecordEffortAcceptanceInput = EffortLookupInput & {
  effortRef: string
  level: string
  state?: StackEffortAcceptanceUpdateState
  status?: string
  evidence?: string[]
  paths?: string[]
  result?: string
  decision?: string
  next?: string
}

export type RecordEffortAcceptanceResult = {
  effort: StackEffort
  path: string
  level: string
  state: StackEffortAcceptanceUpdateState
  status: string
}

export type StackEffortFindingSourceReceipt = {
  receipt_path: string
  artifact_kind?: string
  source_kind?: string
  environment?: string
  run_id?: string | null
  project_id?: string | null
  artifact_name?: string | null
  output_id?: string | null
  label?: string | null
  workspace_path: string
  digest?: {
    sha256?: string
    bytes?: number
  }
  pulled_at?: string
}

export type RecordEffortIdeaInput = EffortLookupInput & {
  effortRef: string
  origin: StackEffortIdeaOrigin
  title: string
  body?: string
  filename?: string
}

export type RecordEffortNoteInput = EffortLookupInput & {
  effortRef: string
  kind: StackEffortNoteKind
  title: string
  body?: string
  filename?: string
}

export type RecordEffortRepoInput = EffortLookupInput & {
  effortRef: string
  sourcePath: string
  repoRef?: string
  title?: string
  filename?: string
}

export type AppendEffortResearchLogInput = EffortLookupInput & {
  effortRef: string
  title: string
  operatorMessage?: string
  workSummary: string
  result?: string
  metrics?: string[]
  paths?: string[]
  reproduceCommands?: string[]
  next?: string
}

export type RecordEffortBlockerInput = EffortLookupInput & {
  effortRef: string
  blocker: string
  evidence: string
  owner: string
  next: string
}

export type ResolveEffortBlockerInput = EffortLookupInput & {
  effortRef: string
  blockerActivityId?: string
  resolution: string
  evidence?: string
  owner?: string
}

export type WriteEffortHandoffInput = EffortLookupInput & {
  effortRef: string
  summary?: string
  next?: string
  risks?: string[]
  owner?: string
}

export type WriteEffortEngineeringPacketInput = EffortLookupInput & {
  effortRef: string
  summary?: string
  repoPath?: string
  baseRef?: string
  files?: string[]
  diffStat?: string
  validations?: string[]
  skippedGates?: string[]
  risks?: string[]
  next?: string
  filename?: string
}

export type WriteEffortEngineeringPacketResult = {
  effort: StackEffort
  path: string
  changedFiles: string[]
  diffStat: string
  gitStatus: {
    ok: boolean
    message: string
  }
}

export type UpdateEffortRefInput = {
  system: string
  id: string
  lane?: string
  role?: string
}

export type UpdateEffortRefsInput = EffortLookupInput & {
  effortRef: string
  refs?: UpdateEffortRefInput[]
  factoryId?: string
  hostedEffortId?: string
  projectId?: string
  optimizerRunId?: string
  smrRunId?: string
  tinkerRunId?: string
  refLane?: string
  repoRef?: string
  initiativeId?: string
}

const SINGULAR_REF_SYSTEMS = new Set(["factory", "hosted-effort", "project"])

type EffortTemplateDefaults = {
  acceptanceCriteria: string[]
  claims: StackEffortClaim[]
  scope: StackEffortScope
  researchLog: boolean
}


export function effortsRegistryDir(stackDataRoot: string): string {
  return join(stackDataRoot, ".stack", "efforts")
}

export function effortTemplatesDir(stackDataRoot: string, appRoot = stackAppRoot()): string {
  const installed = join(stackDataRoot, ".stack", "efforts-templates")
  if (existsSync(installed)) return installed
  return join(bundledDefaultsRoot(appRoot), "efforts")
}

function effortTemplateDir(stackDataRoot: string, template: string, appRoot = stackAppRoot()): string {
  const bundled = join(bundledDefaultsRoot(appRoot), "efforts", template)
  if (existsSync(bundled)) return bundled
  return join(stackDataRoot, ".stack", "efforts-templates", template)
}

export function listEffortTemplates(input: { stackDataRoot: string; appRoot?: string }): StackEffortTemplateSummary[] {
  const appRoot = input.appRoot ?? stackAppRoot()
  const bundledRoot = join(bundledDefaultsRoot(appRoot), "efforts")
  const installedRoot = join(input.stackDataRoot, ".stack", "efforts-templates")
  const installedIds = new Set(
    effortTemplateDirs(installedRoot)
      .map((dir) => readEffortTemplateSummary(dir, "installed", false, false)?.id)
      .filter((id): id is string => Boolean(id)),
  )
  const templates: StackEffortTemplateSummary[] = []
  const seen = new Set<string>()
  for (const dir of effortTemplateDirs(bundledRoot)) {
    const summary = readEffortTemplateSummary(dir, "bundled", true, false)
    if (!summary || seen.has(summary.id)) continue
    summary.installed_shadowed = installedIds.has(summary.id)
    templates.push(summary)
    seen.add(summary.id)
  }
  for (const dir of effortTemplateDirs(installedRoot)) {
    const summary = readEffortTemplateSummary(dir, "installed", false, false)
    if (!summary || seen.has(summary.id)) continue
    templates.push(summary)
    seen.add(summary.id)
  }
  return templates.sort((left, right) => {
    if (left.source !== right.source) return left.source === "bundled" ? -1 : 1
    return left.id.localeCompare(right.id)
  })
}

export function createEffort(input: CreateEffortInput): StackEffort {
  const now = new Date().toISOString()
  const template = input.template?.trim() || "research"
  const title = input.title.trim()
  if (!title) throw new Error("effort title is required")
  const slug = safeSlug(input.slug ?? title)
  const id = `eff_${randomUUID()}`
  const folderPath = resolveEffortFolder(input.workspaceRoot, input.folderRef ?? join("efforts", slug))
  const folderRef = folderRefFor(input.workspaceRoot, folderPath)
  const templateDir = effortTemplateDir(input.stackDataRoot, template, input.appRoot)
  if (!existsSync(templateDir)) throw new Error(`effort template not found: ${template}`)
  const templateDefaults = readEffortTemplateDefaults(templateDir)
  const manifestPath = join(folderPath, "effort.toml")
  if (existsSync(manifestPath)) throw new Error(`effort already exists at ${folderRef}`)
  const registryPath = join(effortsRegistryDir(input.stackDataRoot), `${id}.json`)
  if (existsSync(registryPath)) throw new Error(`effort registry already exists for ${id}`)
  const requestedAcceptanceCriteria = cleanStringList(input.acceptanceCriteria)
  const acceptanceCriteria = requestedAcceptanceCriteria.length > 0
    ? requestedAcceptanceCriteria
    : templateDefaults.acceptanceCriteria

  mkdirSync(folderPath, { recursive: true })
  copyTemplateTree(templateDir, folderPath)
  ensureEffortDirs(folderPath, templateDefaults.researchLog)

  const manifest: StackEffortManifest = {
    schema: STACK_EFFORT_SCHEMA,
    id,
    slug,
    title,
    template,
    status: "active",
    topic: input.topic?.trim() || title,
    links: {
      meta_thread_refs: uniqueStrings(input.metaThreadRefs ?? []),
      repo_refs: [],
      initiative_id: "",
    },
    scope: templateDefaults.scope,
    refs: [],
    claims: templateDefaults.claims,
    acceptance: {
      criteria: acceptanceCriteria,
    },
  }
  const registry: StackEffortRegistryRecord = {
    schema: STACK_EFFORT_SCHEMA,
    id,
    slug,
    title,
    template,
    status: "active",
    folder_ref: folderRef,
    meta_thread_refs: manifest.links.meta_thread_refs,
    refs: manifest.refs,
    created_at: now,
    updated_at: now,
  }

  writeEffortManifest(manifestPath, manifest)
  writeRegistryRecord(input.stackDataRoot, registry)
  appendEffortProgressLine(folderPath, `Created Effort from template \`${template}\`.`)
  appendEffortActivityLine(folderPath, manifest, "effort.created", `Created Effort from template \`${template}\`.`, {
    template,
    folder_ref: folderRef,
  })
  return { registry, manifest, folder_path: folderPath }
}

export function listEfforts(input: EffortLookupInput): StackEffortSummary[] {
  return readRegistryRecords(input.stackDataRoot).map((record) => ({
    id: record.id,
    slug: record.slug,
    title: record.title,
    template: record.template,
    status: record.status,
    folder_ref: record.folder_ref,
    meta_thread_refs: record.meta_thread_refs,
    refs: normalizeRegistryRefs(record),
    updated_at: record.updated_at,
  }))
}

export function readEffort(input: EffortLookupInput, effortRef: string): StackEffort | undefined {
  const record = findRegistryRecord(input.stackDataRoot, effortRef)
  if (!record) return undefined
  record.refs = normalizeRegistryRefs(record)
  const folderPath = resolveEffortFolder(input.workspaceRoot, record.folder_ref)
  const manifest = readEffortManifest(join(folderPath, "effort.toml")) ?? registryToManifest(record)
  return { registry: record, manifest, folder_path: folderPath }
}

export function effortPathRefs(effort: StackEffort): StackEffortPathRefs {
  const ref = (...parts: string[]) => joinPathRef(effort.registry.folder_ref, ...parts)
  const paths: StackEffortPathRefs = {
    folder: effort.registry.folder_ref,
    manifest: ref("effort.toml"),
    playbook: ref("PLAYBOOK.md"),
    progress: ref("PROGRESS.md"),
    activity: ref("ACTIVITY.jsonl"),
    handoff: ref("HANDOFF.md"),
    ideas: ref("ideas"),
    human: ref("human"),
    notes: ref("notes"),
    repos: ref("repos"),
    findings: {
      ideas: ref("findings", "ideas"),
      code: ref("findings", "code"),
      data: ref("findings", "data"),
      proof: ref("findings", "proof"),
      results: ref("findings", "results"),
    },
  }
  if (existsSync(join(effort.folder_path, "research_log.md"))) {
    paths.research_log = ref("research_log.md")
  }
  if (existsSync(join(effort.folder_path, "findings", "results", "acceptance-summary.md"))) {
    paths.acceptance_summary = ref("findings", "results", "acceptance-summary.md")
  }
  return paths
}

export function effortArtifactInventory(effort: StackEffort): StackEffortArtifactInventory {
  const paths = effortPathRefs(effort)
  const generated = {
    ...(existsSync(join(effort.folder_path, "HANDOFF.md")) ? { handoff: paths.handoff } : {}),
    ...(paths.acceptance_summary ? { acceptance_summary: paths.acceptance_summary } : {}),
    ...(paths.research_log ? { research_log: paths.research_log } : {}),
  }
  const findings = {
    ideas: effortRelativeFiles(effort, "findings", "ideas"),
    code: effortRelativeFiles(effort, "findings", "code"),
    data: effortRelativeFiles(effort, "findings", "data"),
    proof: effortRelativeFiles(effort, "findings", "proof"),
    results: effortRelativeFiles(effort, "findings", "results"),
  }
  const receiptSidecars = Object.values(findings).flat().filter(isFindingReceiptSidecarRef)
  const receiptSources = effortFindingSourceReceiptRecords(effort, receiptSidecars)
  const inventory = {
    generated,
    ideas: effortRelativeFiles(effort, "ideas"),
    human: effortRelativeFiles(effort, "human"),
    notes: effortRelativeFiles(effort, "notes"),
    repos: effortRelativeFiles(effort, "repos"),
    findings,
    receipt_sidecars: receiptSidecars,
    receipt_sources: receiptSources,
  }
  const generatedRefs = Object.values(generated).filter((value): value is string => Boolean(value))
  const all = uniqueStrings([
    ...generatedRefs,
    ...inventory.ideas,
    ...inventory.human,
    ...inventory.notes,
    ...inventory.repos,
    ...Object.values(findings).flat(),
  ]).sort()
  return {
    ...inventory,
    all,
    counts: {
      generated: generatedRefs.length,
      ideas: inventory.ideas.length,
      human: inventory.human.length,
      notes: inventory.notes.length,
      repos: inventory.repos.length,
      findings: {
        ideas: findings.ideas.length,
        code: findings.code.length,
        data: findings.data.length,
        proof: findings.proof.length,
        results: findings.results.length,
      },
      receipt_sidecars: receiptSidecars.length,
      total: all.length,
    },
  }
}

export function readEffortAcceptancePacket(effort: StackEffort): StackEffortAcceptancePacket | undefined {
  const paths = effortPathRefs(effort)
  if (!paths.acceptance_summary) return undefined
  const path = join(effort.folder_path, "findings", "results", "acceptance-summary.md")
  if (!existsSync(path)) return undefined
  const text = safeReadText(path)
  const labels = uniqueStrings([
    ...effort.manifest.claims.map((claim) => claim.label),
    ...acceptanceLevelLabels(text),
  ])
  const levels = labels.map((label): StackEffortAcceptanceLevel => {
    const section = acceptanceSection(text, label)
    const heading = acceptanceSectionHeading(section, label)
    const status = acceptanceSectionStatus(section)
    return {
      label,
      title: heading,
      status: status.text,
      state: status.state,
      required_for_v1: effortClaim(effort.manifest, label)?.required === true,
    }
  })
  const recordedLevels = levels.filter((level) => level.state === "recorded").map((level) => level.label)
  const openLevels = levels
    .filter((level) => level.state !== "recorded")
    .map((level) => level.label)
  const requiredLevels = levels.filter((level) => level.required_for_v1)
  const v1Status = requiredLevels.length > 0
    ? requiredLevels.every((level) => level.state === "recorded") ? "pass" : "missing"
    : "not_applicable"
  const graduationLevels = levels.filter((level) => !level.required_for_v1 && Boolean(effortClaim(effort.manifest, level.label)))
  const graduationRecorded = graduationLevels.filter((level) => level.state === "recorded").length
  const graduationStatus = graduationLevels.length === 0
    ? "not_applicable"
    : graduationRecorded === graduationLevels.length
      ? "complete"
      : graduationRecorded > 0
        ? "partial"
        : "open"
  const summary = acceptancePacketSummary(v1Status, graduationStatus, levels)
  return {
    path: paths.acceptance_summary,
    v1_status: v1Status,
    graduation_status: graduationStatus,
    levels,
    recorded_levels: recordedLevels,
    open_levels: openLevels,
    summary,
  }
}

export function readEffortRemainingWork(effort: StackEffort): StackEffortRemainingWork {
  const acceptance = readEffortAcceptancePacket(effort)
  const scopeLanes = effortScopeLanes(effort.manifest)
  const claimOutOfScope = (label: string): boolean => {
    const claim = effortClaim(effort.manifest, label)
    return claim ? !claimInScope(claim, scopeLanes) : false
  }
  const openLevels = acceptance?.levels.filter((level) => level.state !== "recorded") ?? []
  const outOfScope = openLevels
    .filter((level) => claimOutOfScope(level.label))
    .map((level): StackEffortRemainingAcceptance => ({
      label: level.label,
      title: level.title,
      status: "out_of_scope",
      required_for_v1: level.required_for_v1,
    }))
  const openAcceptance = openLevels
    .filter((level) => !claimOutOfScope(level.label))
    .map((level): StackEffortRemainingAcceptance => ({
      label: level.label,
      title: level.title,
      status: level.status,
      required_for_v1: level.required_for_v1,
    }))
  const blockers = readEffortOpenBlockerTail(effort, 1)
  const latestBlocker = blockers[blockers.length - 1] ?? null
  const nextActions = uniqueStrings([
    latestBlocker?.next ?? "",
    ...openAcceptance.map((level) => `Record ${level.label}: ${level.title}${level.status ? ` (${level.status})` : ""}.`),
  ])
  const state: StackEffortRemainingWork["state"] = openAcceptance.length > 0 || latestBlocker
    ? "open"
    : acceptance
      ? "clear"
      : "untracked"
  const summaryParts: string[] = []
  if (openAcceptance.length > 0) {
    summaryParts.push(`open acceptance ${openAcceptance.map((level) => level.label).join("/")}`)
  }
  if (outOfScope.length > 0) {
    summaryParts.push(`out of scope ${outOfScope.map((level) => level.label).join("/")}`)
  }
  if (latestBlocker) {
    summaryParts.push(`latest blocker owner ${latestBlocker.owner || "unassigned"}`)
  }
  const summary = summaryParts.length > 0
    ? summaryParts.join(" - ")
    : state === "clear"
      ? "no structured remaining work"
      : "no structured remaining work recorded"
  return {
    state,
    summary,
    open_acceptance: openAcceptance,
    out_of_scope: outOfScope,
    latest_blocker: latestBlocker,
    next_actions: nextActions,
  }
}

function effortFindingSourceReceiptRecords(
  effort: StackEffort,
  sidecarRefs: string[],
): StackEffortArtifactReceiptSource[] {
  const records: StackEffortArtifactReceiptSource[] = []
  for (const ref of sidecarRefs) {
    const path = effortPathFromRef(effort, ref)
    const parsed = path ? readEffortFindingSourceReceipt(path) : undefined
    const receipt = normalizeEffortFindingSourceReceipt(parsed?.receipt)
    const findingPath = readString(parsed?.finding_path)?.trim()
    if (!receipt || !findingPath) continue
    const recordedAt = readString(parsed?.recorded_at)?.trim()
    records.push({
      sidecar_path: ref,
      finding_path: findingPath,
      ...(recordedAt ? { recorded_at: recordedAt } : {}),
      receipt,
    })
  }
  return records
}

export function readEffortProgressTail(effort: StackEffort, limit = 5): string[] {
  const path = join(effort.folder_path, "PROGRESS.md")
  if (!existsSync(path)) return []
  try {
    const entries = readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^- \d{4}-\d{2}-\d{2}T[^ ]+ - .+/.test(line))
      .map((line) => line.replace(/^- /, ""))
    return entries.slice(Math.max(0, entries.length - limit))
  } catch {
    return []
  }
}

export function readEffortActivityTail(effort: StackEffort, limit = 10): StackEffortActivityRecord[] {
  const records = readEffortActivityRecords(effort)
  return records.slice(Math.max(0, records.length - limit))
}

export function readEffortOptimizerCandidateSummaries(effort: StackEffort, limit = 5): StackEffortOptimizerCandidateSummary[] {
  return readEffortEvidenceSummaries(effort, { sourceKind: "optimizer.candidate", limit })
    .map((entry): StackEffortOptimizerCandidateSummary | undefined => {
      const optimizerRunId = entry.fields.optimizer_run_id
      const candidateId = entry.fields.candidate_id
      if (!optimizerRunId || !candidateId) return undefined
      return {
        activity_id: entry.activity_id,
        observed_at: entry.observed_at,
        optimizer_run_id: optimizerRunId,
        candidate_id: candidateId,
        ...(entry.fields.score ? { score: entry.fields.score } : {}),
        ...(entry.fields.score_label ? { score_label: entry.fields.score_label } : {}),
        ...(entry.fields.split ? { split: entry.fields.split } : {}),
        path: entry.path,
        ...(entry.source_receipt_path ? { source_receipt_path: entry.source_receipt_path } : {}),
        ...(entry.source_receipt_kind ? { source_kind: entry.source_receipt_kind } : {}),
        ...(entry.digest_sha256 ? { digest_sha256: entry.digest_sha256 } : {}),
      }
    })
    .filter((summary): summary is StackEffortOptimizerCandidateSummary => Boolean(summary))
}

export function readEffortEvidenceSummaries(
  effort: StackEffort,
  options: { sourceKind?: string; prefix?: string; limit?: number } = {},
): StackEffortEvidenceSummary[] {
  const boundedLimit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 50)))
  const summaries = readEffortActivityRecords(effort)
    .map((record) => normalizeEvidenceActivity(record))
    .filter((summary): summary is StackEffortEvidenceSummary => Boolean(summary))
    .filter((summary) => (options.sourceKind ? summary.source_kind === options.sourceKind : true))
    .filter((summary) => (options.prefix ? summary.source_kind.startsWith(options.prefix) : true))
  return summaries.slice(Math.max(0, summaries.length - boundedLimit))
}

const LEGACY_EVIDENCE_ACTIVITY_KINDS: Record<string, string> = {
  "effort.run_evidence_recorded": "",
  "effort.benchmark_recorded": "benchmark.intake",
  "effort.release_artifact_recorded": "release.artifact",
  "effort.optimizer_candidate_recorded": "optimizer.candidate",
}

const LEGACY_RECEIPT_SOURCE_KINDS: Record<string, string> = {
  smr_run_evidence: "run.smr",
  tinker_run_evidence: "run.tinker",
  benchmark_metadata: "benchmark.intake",
  release_artifact: "release.artifact",
  optimizer_candidate: "optimizer.candidate",
}

export function normalizeEvidenceSourceKind(kind: string | undefined): string {
  const cleaned = kind?.trim() ?? ""
  return LEGACY_RECEIPT_SOURCE_KINDS[cleaned] ?? cleaned
}

function normalizeEvidenceActivity(record: StackEffortActivityRecord): StackEffortEvidenceSummary | undefined {
  const isNative = record.type === "effort.evidence_recorded"
  if (!isNative && !(record.type in LEGACY_EVIDENCE_ACTIVITY_KINDS)) return undefined
  const payload = asRecord(record.payload)
  const path = readString(payload.path)?.trim()
  if (!path) return undefined
  const sourceKind = isNative
    ? readString(payload.source_kind)?.trim() ?? ""
    : record.type === "effort.run_evidence_recorded"
      ? `run.${readString(payload.run_kind)?.trim() ?? ""}`
      : LEGACY_EVIDENCE_ACTIVITY_KINDS[record.type] ?? ""
  if (!sourceKind || sourceKind === "run.") return undefined
  const fields: Record<string, string> = {}
  const lists: Record<string, string[]> = {}
  if (isNative) {
    const rawFields = asRecord(payload.fields)
    for (const [key, value] of Object.entries(rawFields)) {
      const text = readString(value)?.trim() ?? readNumberishString(value) ?? (typeof value === "boolean" ? String(value) : undefined)
      if (text) fields[key] = text
    }
    const rawLists = asRecord(payload.lists)
    for (const [key, value] of Object.entries(rawLists)) {
      const entries = readStringArray(value)
      if (entries.length > 0) lists[key] = entries
    }
  } else {
    for (const [key, value] of Object.entries(payload)) {
      if (key === "path" || key === "source_receipt" || key === "source_receipt_path" || key === "acceptance_level" || key === "title") continue
      const text = readString(value)?.trim() ?? readNumberishString(value) ?? (typeof value === "boolean" ? String(value) : undefined)
      if (text) {
        fields[key] = text
        continue
      }
      const entries = readStringArray(value)
      if (entries.length > 0) lists[key] = entries
    }
  }
  const sourceReceipt = asRecord(payload.source_receipt)
  const receiptKind = readString(sourceReceipt.source_kind)?.trim()
  const digest = asRecord(sourceReceipt.digest)
  const digestSha256 = readString(digest.sha256)?.trim()
  const sourceReceiptPath = readString(payload.source_receipt_path)?.trim()
  return {
    activity_id: record.activity_id,
    observed_at: record.observed_at,
    source_kind: sourceKind,
    title: readString(payload.title)?.trim() ?? "",
    claim_label: (readString(payload.claim_label) ?? readString(payload.acceptance_level))?.trim().toUpperCase() ?? "",
    fields,
    lists,
    path,
    ...(sourceReceiptPath ? { source_receipt_path: sourceReceiptPath } : {}),
    ...(receiptKind ? { source_receipt_kind: normalizeEvidenceSourceKind(receiptKind) } : {}),
    ...(digestSha256 ? { digest_sha256: digestSha256 } : {}),
  }
}

export function evaluateEffortClaim(effort: StackEffort, claim: StackEffortClaim): StackEffortClaimEvaluation {
  const satisfied: string[] = []
  const missing: string[] = []
  for (const need of claim.needs_refs) {
    const matches = effort.manifest.refs.filter((ref) => ref.system === need.system && (!need.lane || ref.lane === need.lane))
    const label = `ref system=${need.system}${need.lane ? ` lane=${need.lane}` : ""}`
    if (matches.length >= need.min) {
      satisfied.push(`${label}: ${matches.slice(0, 3).map((ref) => ref.id).join(", ")}`)
    } else {
      missing.push(`${label} (${matches.length}/${need.min})`)
    }
  }
  if (claim.needs_evidence.length > 0) {
    const evidence = readEffortEvidenceSummaries(effort, { limit: 200 })
    for (const need of claim.needs_evidence) {
      const matches = evidence.filter((entry) => {
        if (entry.source_kind !== need.source_kind) return false
        if (need.under && !entry.path.startsWith(`${need.under.replace(/\/$/, "")}/`)) return false
        if (entry.claim_label && entry.claim_label !== claim.label.toUpperCase()) return false
        const resolved = join(effort.folder_path, ...entry.path.split("/").filter(Boolean))
        return isPathInside(effort.folder_path, resolved) && existsSync(resolved)
      })
      const label = `evidence source_kind=${need.source_kind}${need.under ? ` under=${need.under}` : ""}`
      if (matches.length >= need.min) {
        satisfied.push(`${label}: ${matches.slice(0, 3).map((entry) => entry.path).join(", ")}`)
      } else {
        missing.push(`${label} (${matches.length}/${need.min})`)
      }
    }
  }
  return {
    label: claim.label,
    ok: missing.length === 0,
    satisfied,
    missing,
  }
}

export function readEffortRunEvidenceSummaries(effort: StackEffort, limit = 5): StackEffortRunEvidenceSummary[] {
  return readEffortEvidenceSummaries(effort, { prefix: "run.", limit })
    .map((entry): StackEffortRunEvidenceSummary | undefined => {
      const runId = entry.fields.run_id
      if (!runId) return undefined
      return {
        activity_id: entry.activity_id,
        observed_at: entry.observed_at,
        run_kind: entry.source_kind.slice("run.".length),
        run_id: runId,
        ...(entry.fields.project_id ? { project_id: entry.fields.project_id } : {}),
        ...(entry.fields.output_id ? { output_id: entry.fields.output_id } : {}),
        ...(entry.fields.artifact_name ? { artifact_name: entry.fields.artifact_name } : {}),
        ...(entry.fields.metric ? { metric: entry.fields.metric } : {}),
        ...(entry.claim_label ? { acceptance_level: entry.claim_label } : {}),
        path: entry.path,
        ...(entry.source_receipt_path ? { source_receipt_path: entry.source_receipt_path } : {}),
        ...(entry.source_receipt_kind ? { source_kind: entry.source_receipt_kind } : {}),
        ...(entry.digest_sha256 ? { digest_sha256: entry.digest_sha256 } : {}),
      }
    })
    .filter((summary): summary is StackEffortRunEvidenceSummary => Boolean(summary))
}

export function readEffortBenchmarkSummaries(effort: StackEffort, limit = 5): StackEffortBenchmarkSummary[] {
  return readEffortEvidenceSummaries(effort, { sourceKind: "benchmark.intake", limit })
    .map((entry): StackEffortBenchmarkSummary | undefined => {
      const name = entry.fields.name || entry.title
      if (!name) return undefined
      return {
        activity_id: entry.activity_id,
        observed_at: entry.observed_at,
        ...(entry.fields.benchmark_id ? { benchmark_id: entry.fields.benchmark_id } : {}),
        name,
        ...(entry.fields.version ? { version: entry.fields.version } : {}),
        ...(entry.fields.source ? { source: entry.fields.source } : {}),
        ...(entry.fields.license ? { license: entry.fields.license } : {}),
        ...(entry.fields.task_shape ? { task_shape: entry.fields.task_shape } : {}),
        splits: entry.lists.splits ?? [],
        metrics: entry.lists.metrics ?? [],
        path: entry.path,
        ...(entry.source_receipt_path ? { source_receipt_path: entry.source_receipt_path } : {}),
        ...(entry.source_receipt_kind ? { source_kind: entry.source_receipt_kind } : {}),
        ...(entry.digest_sha256 ? { digest_sha256: entry.digest_sha256 } : {}),
      }
    })
    .filter((summary): summary is StackEffortBenchmarkSummary => Boolean(summary))
}

export function readEffortReleaseArtifactSummaries(effort: StackEffort, limit = 5): StackEffortReleaseArtifactSummary[] {
  return readEffortEvidenceSummaries(effort, { sourceKind: "release.artifact", limit })
    .map((entry): StackEffortReleaseArtifactSummary => ({
      activity_id: entry.activity_id,
      observed_at: entry.observed_at,
      ...(entry.fields.version ? { version: entry.fields.version } : {}),
      ...(entry.fields.channel ? { channel: entry.fields.channel } : {}),
      ...(entry.fields.target ? { target: entry.fields.target } : {}),
      ...(entry.fields.archive ? { archive: entry.fields.archive } : {}),
      ...(entry.fields.sha256 ? { sha256: entry.fields.sha256 } : {}),
      ...(entry.fields.size ? { size: entry.fields.size } : {}),
      ...(entry.fields.manifest ? { manifest: entry.fields.manifest } : {}),
      ...(entry.fields.release_site ? { release_site: entry.fields.release_site } : {}),
      ...(entry.fields.publishable ? { publishable: entry.fields.publishable === "true" } : {}),
      publish_blockers: entry.lists.publish_blockers ?? [],
      path: entry.path,
      ...(entry.source_receipt_path ? { source_receipt_path: entry.source_receipt_path } : {}),
      ...(entry.source_receipt_kind ? { source_kind: entry.source_receipt_kind } : {}),
      ...(entry.digest_sha256 ? { digest_sha256: entry.digest_sha256 } : {}),
    }))
}

export function readEffortBlockerTail(effort: StackEffort, limit = 5): StackEffortBlockerRecord[] {
  const records = readEffortBlockerRecords(effort)
  return records.slice(Math.max(0, records.length - limit))
}

export function readEffortOpenBlockerTail(effort: StackEffort, limit = 5): StackEffortBlockerRecord[] {
  const records = readEffortBlockerRecords(effort).filter((record) => !record.resolved_at)
  return records.slice(Math.max(0, records.length - limit))
}

export function readEffortBlockerResolutionTail(effort: StackEffort, limit = 5): StackEffortBlockerResolutionRecord[] {
  const records = readEffortActivityRecords(effort)
    .map(effortBlockerResolutionFromActivity)
    .filter((record): record is StackEffortBlockerResolutionRecord => Boolean(record))
  return records.slice(Math.max(0, records.length - limit))
}

function readEffortBlockerRecords(effort: StackEffort): StackEffortBlockerRecord[] {
  const resolutions = new Map<string, StackEffortBlockerResolutionRecord>()
  for (const resolution of readEffortBlockerResolutionTail(effort, 2000)) {
    resolutions.set(resolution.blocker_activity_id, resolution)
  }
  return readEffortActivityRecords(effort)
    .map(effortBlockerFromActivity)
    .filter((record): record is StackEffortBlockerRecord => Boolean(record))
    .map((record) => {
      const resolution = resolutions.get(record.activity_id)
      if (!resolution) return record
      return {
        ...record,
        resolved_at: resolution.observed_at,
        resolved_by_activity_id: resolution.activity_id,
        resolution: resolution.resolution,
        ...(resolution.evidence ? { resolution_evidence: resolution.evidence } : {}),
        ...(resolution.owner ? { resolved_by_owner: resolution.owner } : {}),
      }
    })
}

export function auditEffort(effort: StackEffort): StackEffortAudit {
  const paths = effortPathRefs(effort)
  const checks: StackEffortAuditCheck[] = []
  const check = (id: string, status: StackEffortAuditStatus, summary: string, evidence: string[] = []) => {
    checks.push({ id, status, summary, evidence })
  }
  const requiredFiles = ["effort.toml", "PLAYBOOK.md", "PROGRESS.md", "ACTIVITY.jsonl"]
  const requiredDirs = ["ideas", "human", "notes", "repos", "findings/ideas", "findings/code", "findings/data", "findings/proof", "findings/results"]
  const missingFiles = requiredFiles.filter((rel) => !existsSync(join(effort.folder_path, rel)))
  const missingDirs = requiredDirs.filter((rel) => !isExistingDirectory(join(effort.folder_path, rel)))
  check(
    "folder_scaffold",
    missingFiles.length === 0 && missingDirs.length === 0 ? "pass" : "fail",
    missingFiles.length === 0 && missingDirs.length === 0 ? "Required Effort files and folders exist." : "Required Effort files or folders are missing.",
    [
      ...missingFiles.map((rel) => `missing file: ${joinPathRef(effort.registry.folder_ref, rel)}`),
      ...missingDirs.map((rel) => `missing dir: ${joinPathRef(effort.registry.folder_ref, rel)}`),
    ],
  )
  const researchRequired = existsSync(join(effort.folder_path, "research_log.md"))
  const researchLogPath = join(effort.folder_path, "research_log.md")
  check(
    "research_log",
    !researchRequired || existsSync(researchLogPath) ? "pass" : "fail",
    researchRequired
      ? "Effort carries a research_log.md."
      : "Effort does not carry a research log.",
    researchRequired ? [joinPathRef(effort.registry.folder_ref, "research_log.md")] : [],
  )
  if (researchRequired && existsSync(researchLogPath)) {
    const researchLog = researchLogShape(researchLogPath)
    check(
      "research_log_shape",
      researchLog.ok ? "pass" : "warn",
      researchLog.ok
        ? "Research log has dated entries with operator text and summarized work."
        : "Research log exists but is missing dated entries, operator text, or summarized work.",
      researchLog.evidence,
    )
  }
  const manifestMatchesRegistry = effort.manifest.id === effort.registry.id
    && effort.manifest.slug === effort.registry.slug
    && effort.manifest.template === effort.registry.template
    && effort.manifest.status === effort.registry.status
  check(
    "manifest_registry",
    manifestMatchesRegistry ? "pass" : "fail",
    manifestMatchesRegistry ? "Manifest and registry agree on id, slug, template, and status." : "Manifest and registry disagree.",
    [
      `manifest=${effort.manifest.id}/${effort.manifest.slug}/${effort.manifest.template}/${effort.manifest.status}`,
      `registry=${effort.registry.id}/${effort.registry.slug}/${effort.registry.template}/${effort.registry.status}`,
    ],
  )
  const progressTail = readEffortProgressTail(effort, 200)
  const activityRecords = readEffortActivityRecords(effort)
  const activityTail = activityRecords.slice(Math.max(0, activityRecords.length - 200))
  const blockerTail = readEffortBlockerTail(effort, 20)
  const openBlockerTail = readEffortOpenBlockerTail(effort, 20)
  check(
    "timeline",
    progressTail.length > 0 && activityTail.length > 0 ? "pass" : "fail",
    progressTail.length > 0 && activityTail.length > 0 ? "Progress and activity timelines are present." : "Progress or activity timeline is empty.",
    [`progress_entries=${progressTail.length}`, `activity_receipts=${activityTail.length}`],
  )
  const invalidBlockers = blockerTail.filter((blocker) =>
    blocker.blocker === "not recorded" || blocker.evidence === "not recorded" || blocker.owner === "not recorded" || blocker.next === "not recorded"
  )
  check(
    "blocker_receipts",
    invalidBlockers.length === 0 ? "pass" : "fail",
    invalidBlockers.length === 0 ? "Recorded blockers are structured with blocker, evidence, owner, and next action." : "Some blocker receipts are missing structured fields.",
    blockerTail.length > 0 ? blockerTail.map((blocker) => `${blocker.observed_at}: ${blocker.blocker}`) : ["no blockers recorded"],
  )
  const ideas = effortRelativeFiles(effort, "ideas")
  const humanIdeas = ideas.filter((path) => basename(path).startsWith("[HUMAN]-"))
  const humanNotes = effortRelativeFiles(effort, "human")
  const untaggedIdeas = ideas.filter((path) => !originTaggedIdeaPath(path))
  check(
    "human_context",
    humanIdeas.length > 0 || humanNotes.length > 0 ? "pass" : "warn",
    humanIdeas.length > 0 || humanNotes.length > 0 ? "Human-origin context is preserved." : "No human-origin idea or human note has been recorded yet.",
    [...humanIdeas, ...humanNotes].slice(0, 10),
  )
  check(
    "idea_origin_tags",
    untaggedIdeas.length === 0 ? "pass" : "warn",
    untaggedIdeas.length === 0 ? "Ideas carry [HUMAN], [AGENT], or [MIXED] origin tags." : "Some idea files are missing origin tags.",
    untaggedIdeas.length > 0 ? untaggedIdeas.slice(0, 10) : ideas.slice(0, 10),
  )
  const findingFiles = {
    ideas: effortRelativeFiles(effort, "findings", "ideas"),
    code: effortRelativeFiles(effort, "findings", "code"),
    data: effortRelativeFiles(effort, "findings", "data"),
    proof: effortRelativeFiles(effort, "findings", "proof"),
    results: effortRelativeFiles(effort, "findings", "results"),
  }
  const findingCount = Object.values(findingFiles).reduce((sum, files) => sum + files.length, 0)
  const artifactInventory = effortArtifactInventory(effort)
  check(
    "findings",
    findingCount > 0 ? "pass" : "warn",
    findingCount > 0 ? "Promoted findings are recorded." : "No promoted findings have been recorded yet.",
    Object.values(findingFiles).flat().slice(0, 15),
  )
  check(
    "artifact_inventory",
    artifactInventory.counts.total > 0 ? "pass" : "warn",
    artifactInventory.counts.total > 0 ? "Artifact inventory has machine-readable entries." : "Artifact inventory is empty.",
    [
      `total=${artifactInventory.counts.total}`,
      `generated=${artifactInventory.counts.generated}`,
      `ideas=${artifactInventory.counts.ideas}`,
      `human=${artifactInventory.counts.human}`,
      `repos=${artifactInventory.counts.repos}`,
      `findings=${Object.values(artifactInventory.counts.findings).reduce((sum, count) => sum + count, 0)}`,
      `receipt_sidecars=${artifactInventory.counts.receipt_sidecars}`,
    ],
  )
  const receiptSidecars = findingReceiptSidecarAudit(effort, findingFiles)
  check(
    "finding_receipt_sidecars",
    receiptSidecars.ok ? "pass" : "fail",
    receiptSidecars.ok
      ? receiptSidecars.count > 0
        ? "Finding receipt sidecars are structurally valid and point at existing findings."
        : "No finding receipt sidecars are recorded."
      : "Some finding receipt sidecars are malformed or point at missing findings.",
    receiptSidecars.evidence,
  )
  const receiptDigests = findingReceiptDigestAudit(effort, findingFiles)
  check(
    "finding_receipt_digests",
    receiptDigests.status,
    receiptDigests.status === "pass"
      ? receiptDigests.count > 0
        ? "Finding receipt digests match current Effort artifacts."
        : "No finding receipt digests are recorded."
      : receiptDigests.status === "warn"
        ? "Some finding receipts do not carry digest metadata."
        : "Some finding receipt digests do not match current Effort artifacts.",
    receiptDigests.evidence,
  )
  const promotedIdeaBacklinks = promotedIdeaBacklinkAudit(effort, findingFiles.ideas)
  check(
    "promoted_idea_backlinks",
    promotedIdeaBacklinks.missing.length === 0 ? "pass" : "warn",
    promotedIdeaBacklinks.missing.length === 0 ? "Promoted idea findings link back to raw idea files." : "Some promoted idea findings do not link back to a raw origin idea.",
    promotedIdeaBacklinks.evidence,
  )
  const evidenceAudit = effortEvidenceAudit(effort)
  check(
    "evidence_receipts",
    evidenceAudit.ok ? "pass" : "fail",
    evidenceAudit.ok
      ? "Typed evidence records are valid when present."
      : "Some typed evidence records are malformed or point at missing artifacts.",
    evidenceAudit.evidence,
  )
  const handoffPath = join(effort.folder_path, "HANDOFF.md")
  const handoffText = existsSync(handoffPath) ? safeReadText(handoffPath) : ""
  const handoffMissing: string[] = []
  const runEvidence = readEffortRunEvidenceSummaries(effort, 1)
  const benchmarks = readEffortBenchmarkSummaries(effort, 1)
  const releaseArtifacts = readEffortReleaseArtifactSummaries(effort, 1)
  if (!handoffText.includes("## Latest Activity")) handoffMissing.push("Latest Activity")
  if (paths.research_log && !handoffText.includes("## Research Log")) handoffMissing.push("Research Log")
  if ((artifactInventory.ideas.length > 0 || artifactInventory.findings.ideas.length > 0) && !handoffText.includes("## Idea Graph")) handoffMissing.push("Idea Graph")
  if (benchmarks.length > 0 && !handoffText.includes("## Benchmark Intake")) handoffMissing.push("Benchmark Intake")
  if (runEvidence.length > 0 && !handoffText.includes("## Run Evidence")) handoffMissing.push("Run Evidence")
  if (releaseArtifacts.length > 0 && !handoffText.includes("## Release Artifacts")) handoffMissing.push("Release Artifacts")
  if (blockerTail.length > 0 && !handoffText.includes("## Recorded Blockers")) handoffMissing.push("Recorded Blockers")
  if (paths.acceptance_summary && !handoffText.includes("## Acceptance Packet")) handoffMissing.push("Acceptance Packet")
  if (effort.manifest.claims.length > 0 && !handoffText.includes("## Claim Lanes")) handoffMissing.push("Claim Lanes")
  if (!handoffText.includes("## Audit")) handoffMissing.push("Audit")
  if (artifactInventory.counts.receipt_sidecars > 0 && !handoffText.includes("### Receipt Summary")) handoffMissing.push("Receipt Summary")
  check(
    "handoff_packet",
    existsSync(handoffPath) && handoffMissing.length === 0 ? "pass" : effort.manifest.acceptance.criteria.length > 0 ? "fail" : "warn",
    existsSync(handoffPath) && handoffMissing.length === 0 ? "Generated handoff packet contains required orientation sections." : "Generated handoff packet is missing or incomplete.",
    [
      existsSync(handoffPath) ? joinPathRef(effort.registry.folder_ref, "HANDOFF.md") : "missing HANDOFF.md",
      ...handoffMissing.map((section) => `missing section: ${section}`),
    ],
  )
  const remainingWork = readEffortRemainingWork(effort)
  const handoffRiskCoverage = handoffRiskCoverageAudit(handoffText, remainingWork)
  check(
    "handoff_risks",
    handoffRiskCoverage.ok ? "pass" : "fail",
    handoffRiskCoverage.ok
      ? "Generated handoff risks reflect structured remaining work."
      : "Generated handoff risks do not reflect structured remaining work.",
    handoffRiskCoverage.evidence,
  )
  check(
    "acceptance_packet",
    effort.manifest.acceptance.criteria.length === 0 || paths.acceptance_summary ? "pass" : "warn",
    effort.manifest.acceptance.criteria.length === 0
      ? "No acceptance criteria are recorded for this Effort."
      : paths.acceptance_summary
        ? "Acceptance criteria have a results summary packet."
        : "Acceptance criteria exist, but findings/results/acceptance-summary.md is not recorded.",
    effort.manifest.acceptance.criteria.length === 0 ? [] : [paths.acceptance_summary ?? joinPathRef(effort.registry.folder_ref, "findings", "results", "acceptance-summary.md")],
  )
  const acceptanceSummaryText = paths.acceptance_summary ? safeReadText(join(effort.folder_path, "findings", "results", "acceptance-summary.md")) : ""
  if (effort.manifest.acceptance.criteria.length > 0 && acceptanceSummaryText) {
    const coverage = acceptanceCriteriaCoverage(effort.manifest.acceptance.criteria, acceptanceSummaryText)
    check(
      "acceptance_criteria_coverage",
      coverage.missing.length === 0 ? "pass" : "fail",
      coverage.missing.length === 0 ? "Acceptance summary covers every recorded acceptance criterion." : "Acceptance summary is missing recorded acceptance criteria.",
      coverage.evidence,
    )
    const acceptancePacket = readEffortAcceptancePacket(effort)
    if (acceptancePacket) {
      const acceptanceReceipts = acceptanceReceiptAudit(acceptancePacket, activityRecords)
      check(
        "acceptance_receipts",
        acceptanceReceipts.status,
        acceptanceReceipts.status === "pass"
          ? "Recorded acceptance levels are covered by typed receipts or explicit v1 bootstrap evidence, and typed receipt state matches the packet."
          : "Some acceptance levels lack typed receipts or drift from the latest typed receipt.",
        acceptanceReceipts.evidence,
      )
    }
  }
  if (effort.manifest.claims.length > 0) {
    const claimsAudit = effortClaimsAudit(effort)
    check(
      "claims",
      claimsAudit.status,
      claimsAudit.status === "pass"
        ? "Recorded claims satisfy their declared requirements; open optional claims stay visible without degrading the audit."
        : claimsAudit.status === "warn"
          ? "Some required claims are still open with unmet requirements."
          : "Some recorded claims do not satisfy their declared requirements.",
      claimsAudit.evidence,
    )
  }
  const repoRefCount = effort.manifest.links.repo_refs.length
  const externalRefCount = effort.manifest.refs.length
  check(
    "refs",
    repoRefCount > 0 || externalRefCount > 0 || effort.manifest.links.meta_thread_refs.length > 0 ? "pass" : "warn",
    repoRefCount > 0 || externalRefCount > 0 || effort.manifest.links.meta_thread_refs.length > 0 ? "Effort has thread, repo, or external system refs." : "No thread, repo, or external system refs are recorded yet.",
    [
      `meta_threads=${effort.manifest.links.meta_thread_refs.length}`,
      `repo_refs=${repoRefCount}`,
      `external_refs=${externalRefCount}`,
      ...effortRefEvidenceLines(effort.manifest.refs),
    ],
  )
  const metaThreadBacklinks = metaThreadBacklinkAudit(effort)
  check(
    "meta_thread_backlinks",
    metaThreadBacklinks.mismatched.length > 0 ? "fail" : metaThreadBacklinks.missing.length > 0 ? "warn" : "pass",
    metaThreadBacklinks.mismatched.length > 0
      ? "Some bound meta-thread manifests point at a different Effort."
      : metaThreadBacklinks.missing.length > 0
        ? "Some bound meta-thread manifests are missing local effort_ref back-links."
        : "Bound meta-thread manifests point back to this Effort.",
    metaThreadBacklinks.evidence,
  )
  const status = checks.some((entry) => entry.status === "fail") ? "fail" : checks.some((entry) => entry.status === "warn") ? "warn" : "pass"
  return {
    ok: status !== "fail",
    status,
    checked_at: new Date().toISOString(),
    effort_id: effort.manifest.id,
    slug: effort.manifest.slug,
    title: effort.manifest.title,
    template: effort.manifest.template,
    folder_ref: effort.registry.folder_ref,
    paths,
    counts: {
      progress_entries: progressTail.length,
      activity_receipts: activityTail.length,
      blockers: blockerTail.length,
      human_ideas: humanIdeas.length,
      human_notes: humanNotes.length,
      repo_refs: repoRefCount,
      external_refs: externalRefCount,
      receipt_sidecars: artifactInventory.counts.receipt_sidecars,
      findings: {
        ideas: findingFiles.ideas.length,
        code: findingFiles.code.length,
        data: findingFiles.data.length,
        proof: findingFiles.proof.length,
        results: findingFiles.results.length,
      },
    },
    latest_blocker: openBlockerTail[openBlockerTail.length - 1] ?? null,
    checks,
  }
}

function readEffortActivityRecords(effort: StackEffort): StackEffortActivityRecord[] {
  const path = join(effort.folder_path, "ACTIVITY.jsonl")
  if (!existsSync(path)) return []
  const records: StackEffortActivityRecord[] = []
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue
      const parsed = JSON.parse(line) as StackEffortActivityRecord
      if (parsed?.effort_id === effort.manifest.id) records.push(parsed)
    }
  } catch {
    return []
  }
  return records
}

export function updateEffortStatus(input: EffortLookupInput & { effortRef: string; status: StackEffortStatus }): StackEffort {
  assertEffortStatus(input.status)
  const effort = requireEffort(input, input.effortRef)
  const previous = effort.manifest.status
  if (previous === input.status) return persistEffort(input, effort)
  effort.manifest.status = input.status
  effort.registry.status = input.status
  appendEffortProgressLine(effort.folder_path, `Status changed from \`${previous}\` to \`${input.status}\`.`)
  appendEffortActivityLine(effort.folder_path, effort.manifest, "effort.status_changed", `Status changed from \`${previous}\` to \`${input.status}\`.`, {
    previous_status: previous,
    status: input.status,
  })
  return persistEffort(input, effort)
}

export function bindEffortMetaThread(input: EffortLookupInput & { effortRef: string; metaThreadId: string }): StackEffort {
  const metaThreadId = input.metaThreadId.trim()
  if (!metaThreadId) throw new Error("metaThreadId is required")
  const effort = requireEffort(input, input.effortRef)
  effort.manifest.links.meta_thread_refs = uniqueStrings([...effort.manifest.links.meta_thread_refs, metaThreadId])
  effort.registry.meta_thread_refs = effort.manifest.links.meta_thread_refs
  appendEffortProgressLine(effort.folder_path, `Bound meta-thread \`${metaThreadId}\`.`)
  appendEffortActivityLine(effort.folder_path, effort.manifest, "effort.thread_bound", `Bound meta-thread \`${metaThreadId}\`.`, {
    meta_thread_id: metaThreadId,
  })
  return persistEffort(input, effort)
}

export function appendEffortProgress(input: EffortLookupInput & { effortRef: string; message: string }): StackEffort {
  const message = input.message.trim()
  if (!message) throw new Error("progress message is required")
  const effort = requireEffort(input, input.effortRef)
  appendEffortProgressLine(effort.folder_path, message)
  appendEffortActivityLine(effort.folder_path, effort.manifest, "effort.progress_updated", message, { message })
  return persistEffort(input, effort)
}

export function recordEffortBlocker(input: RecordEffortBlockerInput): StackEffort {
  const blocker = input.blocker.trim()
  const evidence = input.evidence.trim()
  const owner = input.owner.trim()
  const next = input.next.trim()
  if (!blocker) throw new Error("blocker is required")
  if (!evidence) throw new Error("blocker evidence is required")
  if (!owner) throw new Error("blocker owner is required")
  if (!next) throw new Error("blocker next action is required")
  const effort = requireEffort(input, input.effortRef)
  const message = `External blocker: ${blocker} Evidence: ${evidence} Next owner: ${owner} Next safe action: ${next}`
  appendEffortProgressLine(effort.folder_path, message)
  appendEffortActivityLine(effort.folder_path, effort.manifest, "effort.blocker_recorded", message, {
    blocker,
    evidence,
    owner,
    next,
  })
  return persistEffort(input, effort)
}

export function resolveEffortBlocker(input: ResolveEffortBlockerInput): StackEffort {
  const resolution = input.resolution.trim()
  if (!resolution) throw new Error("blocker resolution is required")
  const evidence = input.evidence?.trim()
  const owner = input.owner?.trim()
  const blockerActivityId = input.blockerActivityId?.trim()
  const effort = requireEffort(input, input.effortRef)
  const blockers = readEffortBlockerTail(effort, 2000)
  const unresolved = blockers.filter((blocker) => !blocker.resolved_at)
  const target = blockerActivityId
    ? blockers.find((blocker) => blocker.activity_id === blockerActivityId)
    : unresolved[unresolved.length - 1]
  if (!target) {
    throw new Error(blockerActivityId ? `blocker activity not found: ${blockerActivityId}` : "no unresolved blocker is recorded")
  }
  if (target.resolved_at) throw new Error(`blocker already resolved: ${target.activity_id}`)
  const message = `Resolved blocker: ${target.blocker} Resolution: ${resolution}${evidence ? ` Evidence: ${evidence}` : ""}${owner ? ` Owner: ${owner}` : ""}`
  appendEffortProgressLine(effort.folder_path, message)
  appendEffortActivityLine(effort.folder_path, effort.manifest, "effort.blocker_resolved", message, {
    blocker_activity_id: target.activity_id,
    blocker: target.blocker,
    resolution,
    ...(evidence ? { evidence } : {}),
    ...(owner ? { owner } : {}),
  })
  return persistEffort(input, effort)
}

export function appendEffortResearchLog(input: AppendEffortResearchLogInput): { effort: StackEffort; path: string } {
  const title = input.title.trim()
  if (!title) throw new Error("research log title is required")
  const workSummary = input.workSummary.trim()
  if (!workSummary) throw new Error("research log workSummary is required")
  const effort = requireEffort(input, input.effortRef)
  const path = join(effort.folder_path, "research_log.md")
  if (!existsSync(path)) throw new Error(`effort has no research_log.md: ${effort.manifest.slug}`)
  appendFileSync(path, `${pathEndsWithNewline(path) ? "\n" : "\n\n"}${researchLogEntryMarkdown(input)}\n`, "utf8")
  appendEffortProgressLine(effort.folder_path, `Appended research log entry: ${title}.`)
  appendEffortActivityLine(effort.folder_path, effort.manifest, "effort.research_log_recorded", `Appended research log entry: ${title}.`, {
    title,
    path: relative(effort.folder_path, path),
  })
  return { effort: persistEffort(input, effort), path }
}

export function writeEffortHandoff(input: WriteEffortHandoffInput): { effort: StackEffort; path: string } {
  const effort = requireEffort(input, input.effortRef)
  const path = join(effort.folder_path, "HANDOFF.md")
  const observedAt = new Date().toISOString()
  const progressEntry = formatEffortProgressEntry("Wrote handoff packet: HANDOFF.md.", observedAt)
  const activityRecord = makeEffortActivityRecord(effort.manifest, "effort.handoff_written", "Wrote handoff packet: HANDOFF.md.", {
    path: relative(effort.folder_path, path),
  }, observedAt)
  writeFileSync(path, effortHandoffMarkdown(effort, input, {
    progressEntries: [progressEntry],
    activityRecords: [activityRecord],
  }), "utf8")
  appendEffortProgressEntry(effort.folder_path, progressEntry)
  appendEffortActivityRecord(effort.folder_path, activityRecord)
  const persisted = persistEffort(input, effort)
  const current = readEffort(input, effort.manifest.id) ?? persisted
  const audit = auditEffort(current)
  writeFileSync(path, effortHandoffMarkdown(current, input, {}, audit), "utf8")
  return { effort: current, path }
}

export function recordEffortAcceptance(input: RecordEffortAcceptanceInput): RecordEffortAcceptanceResult {
  const effort = requireEffort(input, input.effortRef)
  const level = normalizeAcceptanceLevel(input.level)
  const state = input.state ?? "recorded"
  assertAcceptanceUpdateState(state)
  const status = acceptanceUpdateStatus(input.status, state)
  const evidence = cleanStringList(input.evidence)
  const acceptancePaths = cleanStringList(input.paths)
  assertAcceptanceUpdateAllowed(effort, {
    level,
    state,
  })
  const path = join(effort.folder_path, "findings", "results", "acceptance-summary.md")
  mkdirSync(dirname(path), { recursive: true })
  const previous = existsSync(path) ? safeReadText(path) : "# Acceptance summary\n"
  const observedAt = new Date().toISOString()
  writeFileSync(path, updateAcceptanceSummaryText(previous, {
    level,
    state,
    status,
    evidence,
    paths: acceptancePaths,
    result: input.result?.trim(),
    decision: input.decision?.trim(),
    next: input.next?.trim(),
    observedAt,
  }), "utf8")
  appendEffortProgressLine(effort.folder_path, `Recorded acceptance ${level}: ${status}.`)
  appendEffortActivityLine(effort.folder_path, effort.manifest, "effort.acceptance_recorded", `Recorded acceptance ${level}: ${status}.`, {
    level,
    state,
    status,
    evidence,
    paths: acceptancePaths,
    result: input.result?.trim() || "",
    decision: input.decision?.trim() || "",
    next: input.next?.trim() || "",
    path: relative(effort.folder_path, path),
  })
  return {
    effort: persistEffort(input, effort),
    path,
    level,
    state,
    status,
  }
}

export function writeEffortEngineeringPacket(input: WriteEffortEngineeringPacketInput): WriteEffortEngineeringPacketResult {
  const effort = requireEffort(input, input.effortRef)
  const dir = join(effort.folder_path, "findings", "results")
  mkdirSync(dir, { recursive: true })
  const gitSnapshot = input.repoPath ? readEngineeringGitSnapshot(input.repoPath, input.baseRef) : emptyEngineeringGitSnapshot()
  const changedFiles = uniqueStrings([...(input.files ?? []), ...gitSnapshot.changedFiles].map((file) => file.trim()).filter(Boolean))
  const diffStat = (input.diffStat?.trim() || gitSnapshot.diffStat.trim()).trim()
  const filename = input.filename?.trim() || "engineering-change-summary.md"
  const path = join(dir, filename)
  writeFileSync(path, engineeringPacketMarkdown(effort, input, {
    changedFiles,
    diffStat,
    gitStatus: gitSnapshot.status,
  }), "utf8")
  appendEffortProgressLine(effort.folder_path, `Wrote engineering change packet: ${relative(effort.folder_path, path)}.`)
  appendEffortActivityLine(effort.folder_path, effort.manifest, "effort.engineering_packet_written", `Wrote engineering change packet: ${relative(effort.folder_path, path)}.`, {
    path: relative(effort.folder_path, path),
    changed_files: changedFiles,
    repo_path: input.repoPath ?? "",
    base_ref: input.baseRef ?? "",
    validations: cleanStringList(input.validations),
    skipped_gates: cleanStringList(input.skippedGates),
    risks: cleanStringList(input.risks),
  })
  return {
    effort: persistEffort(input, effort),
    path,
    changedFiles,
    diffStat,
    gitStatus: gitSnapshot.status,
  }
}

export function updateEffortRefs(input: UpdateEffortRefsInput): StackEffort {
  const effort = requireEffort(input, input.effortRef)
  const changes: string[] = []
  const lane = cleanOptional(input.refLane) ?? ""
  const requested: UpdateEffortRefInput[] = [
    ...(input.refs ?? []),
    ...(cleanOptional(input.factoryId) ? [{ system: "factory", id: input.factoryId!.trim(), lane: lane || "hosted" }] : []),
    ...(cleanOptional(input.hostedEffortId) ? [{ system: "hosted-effort", id: input.hostedEffortId!.trim(), lane: lane || "hosted" }] : []),
    ...(cleanOptional(input.projectId) ? [{ system: "project", id: input.projectId!.trim(), lane: lane || "hosted" }] : []),
    ...(cleanOptional(input.optimizerRunId) ? [{ system: "optimizer", id: input.optimizerRunId!.trim(), lane }] : []),
    ...(cleanOptional(input.smrRunId) ? [{ system: "smr", id: input.smrRunId!.trim(), lane }] : []),
    ...(cleanOptional(input.tinkerRunId) ? [{ system: "tinker", id: input.tinkerRunId!.trim(), lane }] : []),
  ]
  for (const entry of requested) {
    const system = entry.system.trim()
    const id = entry.id.trim()
    if (!system || !id) continue
    const ref: StackEffortRef = {
      system,
      id,
      lane: entry.lane?.trim() ?? "",
      role: entry.role?.trim() ?? "",
    }
    const existing = effort.manifest.refs.find((candidate) => candidate.system === system && candidate.id === id)
    if (existing) {
      if (ref.lane && existing.lane !== ref.lane) {
        existing.lane = ref.lane
        changes.push(`${system}=${id} lane=${ref.lane}`)
      }
      if (ref.role && existing.role !== ref.role) {
        existing.role = ref.role
        changes.push(`${system}=${id} role=${ref.role}`)
      }
      continue
    }
    if (SINGULAR_REF_SYSTEMS.has(system)) {
      effort.manifest.refs = effort.manifest.refs.filter((candidate) => candidate.system !== system)
    }
    effort.manifest.refs = [...effort.manifest.refs, ref]
    changes.push(`${system}=${id}${ref.lane ? ` lane=${ref.lane}` : ""}`)
  }
  const repoRef = cleanOptional(input.repoRef)
  const initiativeId = cleanOptional(input.initiativeId)
  if (repoRef && !effort.manifest.links.repo_refs.includes(repoRef)) {
    effort.manifest.links.repo_refs = uniqueStrings([...effort.manifest.links.repo_refs, repoRef])
    changes.push(`repo_ref=${repoRef}`)
  }
  if (initiativeId !== undefined && effort.manifest.links.initiative_id !== initiativeId) {
    effort.manifest.links.initiative_id = initiativeId
    changes.push(`initiative_id=${initiativeId || "<cleared>"}`)
  }
  if (changes.length === 0) return persistEffort(input, effort)
  appendEffortProgressLine(effort.folder_path, `Updated refs: ${changes.join(", ")}.`)
  appendEffortActivityLine(effort.folder_path, effort.manifest, "effort.refs_updated", `Updated refs: ${changes.join(", ")}.`, {
    changes,
    refs: effort.manifest.refs,
    repo_refs: effort.manifest.links.repo_refs,
    initiative_id: effort.manifest.links.initiative_id,
  })
  return persistEffort(input, effort)
}

export function recordEffortFinding(input: RecordEffortFindingInput): RecordEffortFindingResult {
  assertFindingKind(input.kind)
  const effort = requireEffort(input, input.effortRef)
  const dir = join(effort.folder_path, "findings", findingDirName(input.kind))
  mkdirSync(dir, { recursive: true })
  const linkedPath = input.sourcePath ? resolveExistingEffortPath(effort.folder_path, input.sourcePath) : undefined
  if (linkedPath && isPathInside(effort.folder_path, linkedPath)) {
    const sourceReceipt = input.sourceReceipt ?? localEffortFindingSourceReceipt(linkedPath)
    const sourceReceiptPath = writeEffortFindingSourceReceipt(effort.folder_path, linkedPath, sourceReceipt)
    appendEffortProgressLine(effort.folder_path, `Recorded ${input.kind} finding: ${relative(effort.folder_path, linkedPath)}.`)
    appendEffortActivityLine(effort.folder_path, effort.manifest, "effort.finding_recorded", `Recorded ${input.kind} finding: ${relative(effort.folder_path, linkedPath)}.`, {
      kind: input.kind,
      title: input.title,
      path: relative(effort.folder_path, linkedPath),
      source_receipt_path: sourceReceiptPath ? relative(effort.folder_path, sourceReceiptPath) : undefined,
      source_receipt: sourceReceipt,
    })
    return { effort: persistEffort(input, effort), path: linkedPath, sourceReceiptPath, sourceReceipt }
  }
  const path = writeEffortArtifact({
    dir,
    filename: input.filename,
    title: input.title,
    body: input.body,
    sourcePath: input.sourcePath,
  })
  const sourceReceipt = input.sourceReceipt ?? (input.sourcePath && existsSync(input.sourcePath) ? localEffortFindingSourceReceipt(input.sourcePath) : undefined)
  const sourceReceiptPath = writeEffortFindingSourceReceipt(effort.folder_path, path, sourceReceipt)
  appendEffortProgressLine(effort.folder_path, `Recorded ${input.kind} finding: ${relative(effort.folder_path, path)}.`)
  appendEffortActivityLine(effort.folder_path, effort.manifest, "effort.finding_recorded", `Recorded ${input.kind} finding: ${relative(effort.folder_path, path)}.`, {
    kind: input.kind,
    title: input.title,
    path: relative(effort.folder_path, path),
    source_receipt_path: sourceReceiptPath ? relative(effort.folder_path, sourceReceiptPath) : undefined,
    source_receipt: sourceReceipt,
  })
  return {
    effort: persistEffort(input, effort),
    path,
    sourceReceiptPath,
    ...(sourceReceipt ? { sourceReceipt } : {}),
  }
}

export function refreshEffortReceiptDigests(input: RefreshEffortReceiptDigestsInput): RefreshEffortReceiptDigestsResult {
  const effort = requireEffort(input, input.effortRef)
  const refreshed: RefreshEffortReceiptDigestRecord[] = []
  const skipped: string[] = []
  let checked = 0
  for (const source of effortArtifactInventory(effort).receipt_sources) {
    const sidecarPath = effortPathFromRef(effort, source.sidecar_path)
    const findingPath = join(effort.folder_path, ...source.finding_path.split("/").filter(Boolean))
    if (!sidecarPath || !existsSync(sidecarPath)) {
      skipped.push(`${source.sidecar_path}: sidecar missing`)
      continue
    }
    if (!isPathInside(effort.folder_path, findingPath) || !existsSync(findingPath)) {
      skipped.push(`${source.sidecar_path}: finding missing`)
      continue
    }
    const parsed = readEffortFindingSourceReceipt(sidecarPath)
    const receipt = normalizeEffortFindingSourceReceipt(parsed?.receipt)
    if (!receipt) {
      skipped.push(`${source.sidecar_path}: receipt invalid`)
      continue
    }
    const digest = localPathDigest(findingPath)
    if (!digest) {
      skipped.push(`${source.sidecar_path}: digest unavailable`)
      continue
    }
    checked += 1
    if (receipt.digest?.sha256 === digest.sha256 && receipt.digest.bytes === digest.bytes) continue
    const payload = {
      schema: "stack/effort/finding-source-receipt/v1",
      receipt: {
        ...receipt,
        digest,
      },
      recorded_at: parsed?.recorded_at?.trim() || new Date().toISOString(),
      refreshed_at: new Date().toISOString(),
      finding_path: source.finding_path,
    }
    writeFileSync(sidecarPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
    refreshed.push({
      sidecar_path: source.sidecar_path,
      finding_path: source.finding_path,
      ...(receipt.digest ? { old_digest: receipt.digest } : {}),
      new_digest: digest,
    })
  }
  if (refreshed.length > 0) {
    appendEffortProgressLine(effort.folder_path, `Refreshed receipt digests: ${refreshed.length} updated, ${checked} checked.`)
    appendEffortActivityLine(effort.folder_path, effort.manifest, "effort.receipt_digests_refreshed", `Refreshed receipt digests: ${refreshed.length} updated, ${checked} checked.`, {
      checked,
      updated: refreshed.length,
      skipped,
      refreshed,
    })
  }
  return {
    effort: refreshed.length > 0 ? persistEffort(input, effort) : effort,
    checked,
    updated: refreshed.length,
    skipped,
    refreshed,
  }
}

export function recordEffortCapture(input: RecordEffortCaptureInput): RecordEffortCaptureResult {
  assertCaptureKind(input.captureKind)
  const kind = input.findingKind ?? defaultCaptureFindingKind(input.captureKind)
  assertFindingKind(kind)
  const sourceReceipt = input.sourceReceipt
    ? effortCaptureSourceReceipt(input.sourceReceipt, input.captureKind)
    : input.sourcePath && existsSync(input.sourcePath)
      ? effortCaptureSourceReceipt(localEffortFindingSourceReceipt(input.sourcePath), input.captureKind)
      : undefined
  const result = recordEffortFinding({
    stackDataRoot: input.stackDataRoot,
    workspaceRoot: input.workspaceRoot,
    effortRef: input.effortRef,
    kind,
    title: input.title,
    body: input.sourcePath ? input.body : effortCaptureBody(input.captureKind, input.body),
    sourcePath: input.sourcePath,
    sourceReceipt,
    filename: input.filename,
  })
  appendEffortProgressLine(result.effort.folder_path, `Captured ${input.captureKind} evidence: ${relative(result.effort.folder_path, result.path)}.`)
  appendEffortActivityLine(result.effort.folder_path, result.effort.manifest, "effort.capture_recorded", `Captured ${input.captureKind} evidence: ${relative(result.effort.folder_path, result.path)}.`, {
    capture_kind: input.captureKind,
    kind,
    title: input.title,
    path: relative(result.effort.folder_path, result.path),
    source_receipt_path: result.sourceReceiptPath ? relative(result.effort.folder_path, result.sourceReceiptPath) : undefined,
    source_receipt: result.sourceReceipt,
  })
  return {
    ...result,
    effort: persistEffort(input, result.effort),
    captureKind: input.captureKind,
    kind,
  }
}

export function recordEffortOptimizerCandidate(input: RecordEffortOptimizerCandidateInput): RecordEffortOptimizerCandidateResult {
  const optimizerRunId = input.optimizerRunId?.trim() || input.sourceReceipt?.run_id?.trim()
  const candidateId = input.candidateId?.trim()
  if (!optimizerRunId || !candidateId) {
    throw new Error("optimizer candidate proof requires optimizer_run_id and candidate_id so the candidate stays identifiable across handoffs")
  }
  const score = input.score?.trim()
  const scoreLabel = input.scoreLabel?.trim()
  const split = input.split?.trim()
  const title = input.title?.trim() || [
    `Candidate ${candidateId}`,
    score ? `${scoreLabel || "score"} ${score}` : "",
  ].filter(Boolean).join(" - ")
  const result = recordEffortEvidence({
    stackDataRoot: input.stackDataRoot,
    workspaceRoot: input.workspaceRoot,
    effortRef: input.effortRef,
    sourceKind: "optimizer.candidate",
    findingKind: "proof",
    title,
    fields: {
      optimizer_run_id: optimizerRunId,
      candidate_id: candidateId,
      score,
      score_label: scoreLabel,
      split,
    },
    refs: [{ system: "optimizer", id: optimizerRunId }],
    body: input.body,
    sourcePath: input.sourcePath,
    sourceReceipt: input.sourceReceipt,
    filename: input.filename,
  })
  return {
    effort: result.effort,
    path: result.path,
    sourceReceiptPath: result.sourceReceiptPath,
    ...(result.sourceReceipt ? { sourceReceipt: result.sourceReceipt } : {}),
    optimizerRunId,
    candidateId,
    ...(score ? { score } : {}),
    ...(scoreLabel ? { scoreLabel } : {}),
    ...(split ? { split } : {}),
  }
}

export type RecordEffortEvidenceInput = EffortLookupInput & {
  effortRef: string
  sourceKind: string
  findingKind?: StackEffortFindingKind
  title?: string
  claimLabel?: string
  fields?: Record<string, string | undefined>
  lists?: Record<string, string[] | undefined>
  body?: string
  refs?: UpdateEffortRefInput[]
  sourcePath?: string
  sourceReceipt?: StackEffortFindingSourceReceipt
  filename?: string
}

export type RecordEffortEvidenceResult = RecordEffortFindingResult & {
  sourceKind: string
  claimLabel?: string
  fields: Record<string, string>
  lists: Record<string, string[]>
}

export function recordEffortEvidence(input: RecordEffortEvidenceInput): RecordEffortEvidenceResult {
  const sourceKind = normalizeNewEvidenceSourceKind(input.sourceKind)
  const claimLabel = input.claimLabel?.trim().toUpperCase() || undefined
  const fields: Record<string, string> = {}
  for (const [key, value] of Object.entries(input.fields ?? {})) {
    const cleaned = value?.trim()
    if (cleaned) fields[key] = cleaned
  }
  const lists: Record<string, string[]> = {}
  for (const [key, value] of Object.entries(input.lists ?? {})) {
    const cleaned = cleanStringList(value)
    if (cleaned.length > 0) lists[key] = cleaned
  }
  const title = input.title?.trim() || [sourceKind, fields.run_id ?? fields.name ?? fields.version].filter(Boolean).join(" - ")
  const refs = (input.refs ?? []).filter((ref) => ref.system.trim() && ref.id.trim())
  const effort = refs.length > 0
    ? updateEffortRefs({
        stackDataRoot: input.stackDataRoot,
        workspaceRoot: input.workspaceRoot,
        effortRef: input.effortRef,
        refs,
      })
    : requireEffort(input, input.effortRef)
  const sourceReceipt = input.sourceReceipt
    ? evidenceSourceReceipt(input.sourceReceipt, sourceKind)
    : input.sourcePath && existsSync(input.sourcePath)
      ? evidenceSourceReceipt(localEffortFindingSourceReceipt(input.sourcePath), sourceKind)
      : undefined
  const result = recordEffortFinding({
    stackDataRoot: input.stackDataRoot,
    workspaceRoot: input.workspaceRoot,
    effortRef: effort.manifest.id,
    kind: input.findingKind ?? "proof",
    title,
    body: evidenceBody({ sourceKind, claimLabel, fields, lists, body: input.body }),
    sourcePath: input.sourcePath,
    sourceReceipt,
    filename: input.filename,
  })
  const summaryLine = `Recorded ${sourceKind} evidence: ${relative(result.effort.folder_path, result.path)}.`
  appendEffortProgressLine(result.effort.folder_path, summaryLine)
  appendEffortActivityLine(result.effort.folder_path, result.effort.manifest, "effort.evidence_recorded", summaryLine, {
    source_kind: sourceKind,
    title,
    claim_label: claimLabel,
    fields,
    lists,
    path: relative(result.effort.folder_path, result.path),
    source_receipt_path: result.sourceReceiptPath ? relative(result.effort.folder_path, result.sourceReceiptPath) : undefined,
    source_receipt: result.sourceReceipt,
  })
  return {
    ...result,
    effort: persistEffort(input, result.effort),
    sourceKind,
    ...(claimLabel ? { claimLabel } : {}),
    fields,
    lists,
  }
}

function normalizeNewEvidenceSourceKind(kind: string): string {
  const cleaned = normalizeEvidenceSourceKind(kind)
  if (!/^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$/.test(cleaned)) {
    throw new Error(`evidence source_kind must be a namespaced lowercase identifier like run.smr or benchmark.intake: ${kind}`)
  }
  return cleaned
}

function evidenceBody(input: {
  sourceKind: string
  claimLabel?: string
  fields: Record<string, string>
  lists: Record<string, string[]>
  body?: string
}): string {
  return [
    `Evidence kind: ${input.sourceKind}`,
    ...(input.claimLabel ? [`Claim: ${input.claimLabel}`] : []),
    ...Object.entries(input.fields).map(([key, value]) => `${evidenceFieldLabel(key)}: ${value}`),
    ...Object.entries(input.lists).map(([key, value]) => `${evidenceFieldLabel(key)}: ${value.join(", ")}`),
    "",
    input.body?.trim() || `${input.sourceKind} evidence.`,
  ].join("\n")
}

function evidenceFieldLabel(key: string): string {
  const spaced = key.replace(/_/g, " ")
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function recordEffortRunEvidence(input: RecordEffortRunEvidenceInput): RecordEffortRunEvidenceResult {
  const runKind = normalizeRunEvidenceKind(input.runKind)
  const runId = input.runId?.trim() || input.sourceReceipt?.run_id?.trim()
  if (!runId) {
    throw new Error("run evidence requires a run id: pass run_id or a source receipt that carries one")
  }
  const projectId = input.projectId?.trim() || input.sourceReceipt?.project_id?.trim() || undefined
  const acceptanceLevel = input.acceptanceLevel?.trim().toUpperCase()
  const result = recordEffortEvidence({
    stackDataRoot: input.stackDataRoot,
    workspaceRoot: input.workspaceRoot,
    effortRef: input.effortRef,
    sourceKind: `run.${runKind}`,
    findingKind: "proof",
    title: input.title?.trim() || [`${runKind} run evidence`, runId, input.metric?.trim()].filter(Boolean).join(" - "),
    claimLabel: acceptanceLevel,
    fields: {
      run_id: runId,
      project_id: projectId,
      output_id: input.outputId?.trim() || input.sourceReceipt?.output_id?.trim(),
      artifact_name: input.artifactName?.trim() || input.sourceReceipt?.artifact_name?.trim(),
      metric: input.metric,
    },
    refs: [
      { system: runKind, id: runId },
      ...(projectId ? [{ system: "project", id: projectId, lane: "hosted" }] : []),
    ],
    body: input.body,
    sourcePath: input.sourcePath,
    sourceReceipt: input.sourceReceipt,
    filename: input.filename,
  })
  return {
    effort: result.effort,
    path: result.path,
    sourceReceiptPath: result.sourceReceiptPath,
    ...(result.sourceReceipt ? { sourceReceipt: result.sourceReceipt } : {}),
    runKind,
    runId,
    ...(projectId ? { projectId } : {}),
    ...(result.fields.output_id ? { outputId: result.fields.output_id } : {}),
    ...(result.fields.artifact_name ? { artifactName: result.fields.artifact_name } : {}),
    ...(result.fields.metric ? { metric: result.fields.metric } : {}),
    ...(acceptanceLevel ? { acceptanceLevel } : {}),
  }
}

export function recordEffortBenchmark(input: RecordEffortBenchmarkInput): RecordEffortBenchmarkResult {
  const benchmarkId = input.benchmarkId?.trim()
  const name = input.name?.trim() || input.title?.trim() || benchmarkId || "Benchmark"
  const version = input.version?.trim()
  const source = input.source?.trim()
  const license = input.license?.trim()
  const taskShape = input.taskShape?.trim()
  const splits = cleanStringList(input.splits)
  const metrics = cleanStringList(input.metrics)
  const title = input.title?.trim() || [
    name,
    version ? `version ${version}` : "",
  ].filter(Boolean).join(" - ")
  const result = recordEffortEvidence({
    stackDataRoot: input.stackDataRoot,
    workspaceRoot: input.workspaceRoot,
    effortRef: input.effortRef,
    sourceKind: "benchmark.intake",
    findingKind: "data",
    title,
    fields: {
      benchmark_id: benchmarkId,
      name,
      version,
      source,
      license,
      task_shape: taskShape,
    },
    lists: {
      splits,
      metrics,
    },
    body: input.body,
    sourcePath: input.sourcePath,
    sourceReceipt: input.sourceReceipt,
    filename: input.filename,
  })
  return {
    effort: result.effort,
    path: result.path,
    sourceReceiptPath: result.sourceReceiptPath,
    ...(result.sourceReceipt ? { sourceReceipt: result.sourceReceipt } : {}),
    ...(benchmarkId ? { benchmarkId } : {}),
    name,
    ...(version ? { version } : {}),
    ...(source ? { source } : {}),
    ...(license ? { license } : {}),
    ...(taskShape ? { taskShape } : {}),
    splits,
    metrics,
  }
}

export function recordEffortReleaseArtifact(input: RecordEffortReleaseArtifactInput): RecordEffortReleaseArtifactResult {
  const parsed = input.sourcePath && existsSync(input.sourcePath)
    ? releaseArtifactFieldsFromPath(input.sourcePath)
    : {}
  const version = input.version?.trim() || parsed.version
  const channel = input.channel?.trim() || parsed.channel
  const target = input.target?.trim() || parsed.target
  const archive = input.archive?.trim() || parsed.archive
  const sha256 = input.sha256?.trim() || parsed.sha256
  const size = input.size?.trim() || parsed.size
  const manifest = input.manifest?.trim() || parsed.manifest
  const releaseSite = input.releaseSite?.trim() || parsed.releaseSite
  const publishable = input.publishable ?? parsed.publishable
  const publishBlockers = cleanStringList(input.publishBlockers).length > 0
    ? cleanStringList(input.publishBlockers)
    : parsed.publishBlockers ?? []
  if (!version || !sha256) {
    throw new Error("release artifact proof requires version and sha256: pass them explicitly or point --path at a release summary/manifest JSON that carries them")
  }
  const title = input.title?.trim() || [
    "Release artifact",
    version,
    target,
  ].filter(Boolean).join(" - ")
  const result = recordEffortEvidence({
    stackDataRoot: input.stackDataRoot,
    workspaceRoot: input.workspaceRoot,
    effortRef: input.effortRef,
    sourceKind: "release.artifact",
    findingKind: "proof",
    title,
    fields: {
      version,
      channel,
      target,
      archive,
      sha256,
      size,
      manifest,
      release_site: releaseSite,
      ...(publishable !== undefined ? { publishable: String(publishable) } : {}),
    },
    lists: {
      publish_blockers: publishBlockers,
    },
    body: input.body,
    sourcePath: input.sourcePath,
    sourceReceipt: input.sourceReceipt,
    filename: input.filename ?? releaseArtifactEvidenceFilename({ version, target, sha256, sourcePath: input.sourcePath }),
  })
  return {
    effort: result.effort,
    path: result.path,
    sourceReceiptPath: result.sourceReceiptPath,
    ...(result.sourceReceipt ? { sourceReceipt: result.sourceReceipt } : {}),
    ...(version ? { version } : {}),
    ...(channel ? { channel } : {}),
    ...(target ? { target } : {}),
    ...(archive ? { archive } : {}),
    ...(sha256 ? { sha256 } : {}),
    ...(size ? { size } : {}),
    ...(manifest ? { manifest } : {}),
    ...(releaseSite ? { releaseSite } : {}),
    ...(publishable !== undefined ? { publishable } : {}),
    publishBlockers,
  }
}

function releaseArtifactEvidenceFilename(input: { version: string; target?: string; sha256: string; sourcePath?: string }): string {
  const base = input.sourcePath ? basename(resolve(input.sourcePath)) : "release-artifact.md"
  return [
    "release-artifact",
    safeFileSegment(input.version),
    input.target ? safeFileSegment(input.target) : undefined,
    input.sha256.slice(0, 8),
    safeFileSegment(base),
  ].filter(Boolean).join("-")
}

export function recordEffortArtifact(input: RecordEffortArtifactInput): RecordEffortArtifactResult {
  const slug = input.slug.trim()
  const title = input.title.trim()
  if (!slug || !title) throw new Error("artifact evidence requires slug and title")
  const splitsCited = cleanStringList(input.splitsCited)
  const result = recordEffortEvidence({
    stackDataRoot: input.stackDataRoot,
    workspaceRoot: input.workspaceRoot,
    effortRef: input.effortRef,
    sourceKind: "artifact.webpage",
    findingKind: "result",
    title: `Artifact page - ${title}`,
    fields: {
      slug,
      title,
      local_url: input.localUrl,
      hosted_url: input.hostedUrl,
      hosted_artifact_id: input.hostedArtifactId,
      artifact_version: input.artifactVersion,
      sha256: input.sha256,
    },
    lists: {
      splits_cited: splitsCited,
    },
    body: input.body,
    sourcePath: input.sourcePath,
    filename: input.filename ?? `${safeFileSegment(slug)}-artifact-page.tsx`,
  })
  return {
    effort: result.effort,
    path: result.path,
    sourceReceiptPath: result.sourceReceiptPath,
    ...(result.sourceReceipt ? { sourceReceipt: result.sourceReceipt } : {}),
    slug,
    title,
    ...(result.fields.local_url ? { localUrl: result.fields.local_url } : {}),
    ...(result.fields.hosted_url ? { hostedUrl: result.fields.hosted_url } : {}),
    ...(result.fields.hosted_artifact_id ? { hostedArtifactId: result.fields.hosted_artifact_id } : {}),
    ...(result.fields.artifact_version ? { artifactVersion: result.fields.artifact_version } : {}),
    ...(result.fields.sha256 ? { sha256: result.fields.sha256 } : {}),
    splitsCited,
  }
}

export function recordEffortIdea(input: RecordEffortIdeaInput): { effort: StackEffort; path: string } {
  assertIdeaOrigin(input.origin)
  const effort = requireEffort(input, input.effortRef)
  const dir = join(effort.folder_path, "ideas")
  mkdirSync(dir, { recursive: true })
  const title = input.title.trim()
  const taggedTitle = title.startsWith(`[${input.origin}]`) ? title : `[${input.origin}] ${title}`
  const filename = input.filename ?? `[${input.origin}]-${safeFileSegment(title)}.md`
  const path = writeEffortArtifact({
    dir,
    filename,
    title: taggedTitle,
    body: input.body,
  })
  appendEffortProgressLine(effort.folder_path, `Recorded ${input.origin.toLowerCase()} idea: ${relative(effort.folder_path, path)}.`)
  appendEffortActivityLine(effort.folder_path, effort.manifest, "effort.idea_recorded", `Recorded ${input.origin.toLowerCase()} idea: ${relative(effort.folder_path, path)}.`, {
    origin: input.origin,
    title: taggedTitle,
    path: relative(effort.folder_path, path),
  })
  return { effort: persistEffort(input, effort), path }
}

export function recordEffortNote(input: RecordEffortNoteInput): { effort: StackEffort; path: string } {
  assertNoteKind(input.kind)
  const effort = requireEffort(input, input.effortRef)
  const dir = join(effort.folder_path, input.kind === "human" ? "human" : "notes")
  mkdirSync(dir, { recursive: true })
  const title = input.title.trim()
  if (!title) throw new Error("note title is required")
  const path = writeEffortArtifact({
    dir,
    filename: input.filename,
    title,
    body: input.body,
  })
  appendEffortProgressLine(effort.folder_path, `Recorded ${input.kind} note: ${relative(effort.folder_path, path)}.`)
  appendEffortActivityLine(effort.folder_path, effort.manifest, "effort.note_recorded", `Recorded ${input.kind} note: ${relative(effort.folder_path, path)}.`, {
    kind: input.kind,
    title,
    path: relative(effort.folder_path, path),
  })
  return { effort: persistEffort(input, effort), path }
}

export function recordEffortRepo(input: RecordEffortRepoInput): { effort: StackEffort; path: string } {
  const sourcePath = input.sourcePath.trim()
  if (!sourcePath) throw new Error("repo sourcePath is required")
  const effort = requireEffort(input, input.effortRef)
  const dir = join(effort.folder_path, "repos")
  mkdirSync(dir, { recursive: true })
  const linkedPath = resolveExistingEffortPath(effort.folder_path, sourcePath)
  const repoRef = cleanOptional(input.repoRef)
  if (repoRef && !effort.manifest.links.repo_refs.includes(repoRef)) {
    effort.manifest.links.repo_refs = uniqueStrings([...effort.manifest.links.repo_refs, repoRef])
  }
  if (linkedPath && isPathInside(effort.folder_path, linkedPath)) {
    appendEffortProgressLine(effort.folder_path, `Recorded repo attachment: ${relative(effort.folder_path, linkedPath)}.`)
    appendEffortActivityLine(effort.folder_path, effort.manifest, "effort.repo_recorded", `Recorded repo attachment: ${relative(effort.folder_path, linkedPath)}.`, {
      path: relative(effort.folder_path, linkedPath),
      repo_ref: repoRef ?? "",
    })
    return { effort: persistEffort(input, effort), path: linkedPath }
  }
  const resolvedSource = linkedPath ?? resolve(sourcePath)
  const path = statSync(resolvedSource).isDirectory()
    ? writeEffortRepoPointer({
        dir,
        filename: input.filename,
        title: input.title ?? basename(resolvedSource),
        sourcePath: resolvedSource,
        repoRef,
      })
    : writeEffortArtifact({
        dir,
        filename: input.filename,
        title: input.title ?? basename(resolvedSource),
        sourcePath: resolvedSource,
      })
  appendEffortProgressLine(effort.folder_path, `Recorded repo attachment: ${relative(effort.folder_path, path)}.`)
  appendEffortActivityLine(effort.folder_path, effort.manifest, "effort.repo_recorded", `Recorded repo attachment: ${relative(effort.folder_path, path)}.`, {
    path: relative(effort.folder_path, path),
    repo_ref: repoRef ?? "",
  })
  return { effort: persistEffort(input, effort), path }
}

export function readEffortManifest(path: string): StackEffortManifest | undefined {
  if (!existsSync(path)) return undefined
  const parsed = Bun.TOML.parse(readFileSync(path, "utf8")) as Record<string, unknown>
  const links = asRecord(parsed.links)
  const acceptance = asRecord(parsed.acceptance)
  const status = readString(parsed.status) || "active"
  assertEffortStatus(status)
  return {
    schema: STACK_EFFORT_SCHEMA,
    id: requireString(parsed.id, "effort.toml id"),
    slug: requireString(parsed.slug, "effort.toml slug"),
    title: requireString(parsed.title, "effort.toml title"),
    template: requireString(parsed.template, "effort.toml template"),
    status,
    topic: readString(parsed.topic) ?? "",
    links: {
      meta_thread_refs: readStringArray(links.meta_thread_refs),
      repo_refs: readStringArray(links.repo_refs),
      initiative_id: readString(links.initiative_id) ?? "",
    },
    scope: readEffortScope(parsed.scope),
    refs: mergeEffortRefs([
      ...readEffortRefEntries(parsed.refs),
      ...legacyHostedBlockRefs(asRecord(parsed.hosted)),
    ]),
    claims: readEffortClaimEntries(parsed.claims),
    acceptance: {
      criteria: readStringArray(acceptance.criteria),
    },
  }
}

export function readEffortScope(value: unknown): StackEffortScope {
  if (value === undefined) return { capabilities: [...EFFORT_WIRED_LAUNCH_CAPABILITIES] }
  const record = asRecord(value)
  if (!Object.prototype.hasOwnProperty.call(record, "capabilities")) {
    throw new Error(`config error: [scope] requires capabilities = [...]; omit [scope] for all wired capabilities`)
  }
  if (!Array.isArray(record.capabilities)) {
    throw new Error(`config error: [scope].capabilities must be a non-empty list; valid capabilities: ${EFFORT_LAUNCH_CAPABILITIES.join(", ")}`)
  }
  const listed = readStringArray(record.capabilities)
  if (listed.length === 0) {
    throw new Error(`config error: [scope].capabilities cannot be empty; valid capabilities: ${EFFORT_LAUNCH_CAPABILITIES.join(", ")}`)
  }
  return { capabilities: listed.map(parseEffortLaunchCapability) }
}

export function readEffortRefEntries(value: unknown): StackEffortRef[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry): StackEffortRef | undefined => {
      const record = asRecord(entry)
      const system = readString(record.system)?.trim()
      const id = readString(record.id)?.trim()
      if (!system || !id) return undefined
      return {
        system,
        id,
        lane: readString(record.lane)?.trim() ?? "",
        role: readString(record.role)?.trim() ?? "",
      }
    })
    .filter((ref): ref is StackEffortRef => Boolean(ref))
}

export function readEffortClaimEntries(value: unknown): StackEffortClaim[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry): StackEffortClaim | undefined => {
      const record = asRecord(entry)
      const label = readString(record.label)?.trim()
      if (!label) return undefined
      const lanes = readClaimLanes(record.lanes)
      return {
        label,
        title: readString(record.title)?.trim() ?? label,
        required: record.required === true,
        ...(lanes.length > 0 ? { lanes } : {}),
        needs_refs: readClaimNeedsRefs(record.needs_refs),
        needs_evidence: readClaimNeedsEvidence(record.needs_evidence),
      }
    })
    .filter((claim): claim is StackEffortClaim => Boolean(claim))
}

function readClaimLanes(value: unknown): StackEffortRefLane[] {
  const lanes = readStringArray(value)
  return STACK_EFFORT_REF_LANES.filter((lane) => lanes.includes(lane))
}

function readClaimNeedsRefs(value: unknown): StackEffortClaimNeedsRef[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry): StackEffortClaimNeedsRef | undefined => {
      const record = asRecord(entry)
      const system = readString(record.system)?.trim()
      if (!system) return undefined
      return {
        system,
        lane: readString(record.lane)?.trim() ?? "",
        min: readClaimMin(record.min),
      }
    })
    .filter((need): need is StackEffortClaimNeedsRef => Boolean(need))
}

function readClaimNeedsEvidence(value: unknown): StackEffortClaimNeedsEvidence[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry): StackEffortClaimNeedsEvidence | undefined => {
      const record = asRecord(entry)
      const sourceKind = readString(record.source_kind)?.trim()
      if (!sourceKind) return undefined
      return {
        source_kind: sourceKind,
        under: readString(record.under)?.trim() ?? "",
        min: readClaimMin(record.min),
      }
    })
    .filter((need): need is StackEffortClaimNeedsEvidence => Boolean(need))
}

function readClaimMin(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 1) return Math.floor(value)
  return 1
}

function legacyHostedBlockRefs(hosted: Record<string, unknown>): StackEffortRef[] {
  const refs: StackEffortRef[] = []
  const singular: Array<[string, string]> = [
    ["factory_id", "factory"],
    ["effort_id", "hosted-effort"],
    ["project_id", "project"],
  ]
  for (const [key, system] of singular) {
    const id = readString(hosted[key])?.trim()
    if (id) refs.push({ system, id, lane: "hosted", role: "" })
  }
  const plural: Array<[string, string]> = [
    ["optimizer_run_ids", "optimizer"],
    ["smr_run_ids", "smr"],
    ["tinker_run_ids", "tinker"],
  ]
  for (const [key, system] of plural) {
    for (const id of readStringArray(hosted[key])) {
      refs.push({ system, id, lane: "", role: "" })
    }
  }
  return refs
}

function mergeEffortRefs(refs: StackEffortRef[]): StackEffortRef[] {
  const seen = new Map<string, StackEffortRef>()
  for (const ref of refs) {
    const key = `${ref.system}${ref.id}`
    const existing = seen.get(key)
    if (!existing) {
      seen.set(key, ref)
      continue
    }
    seen.set(key, {
      system: existing.system,
      id: existing.id,
      lane: existing.lane || ref.lane,
      role: existing.role || ref.role,
    })
  }
  return Array.from(seen.values())
}

export function effortRefIds(manifest: StackEffortManifest, system: string, lane?: string): string[] {
  return manifest.refs
    .filter((ref) => ref.system === system && (lane === undefined || ref.lane === lane))
    .map((ref) => ref.id)
}

export function effortClaim(manifest: StackEffortManifest, label: string): StackEffortClaim | undefined {
  const normalized = label.trim().toUpperCase()
  return manifest.claims.find((claim) => claim.label.toUpperCase() === normalized)
}

export function parseEffortLaunchCapability(value: string): StackEffortLaunchCapability {
  const cleaned = value.trim()
  const capability = EFFORT_LAUNCH_CAPABILITIES.find((candidate) => candidate === cleaned)
  if (!capability) {
    throw new Error(`config error: unknown launch capability "${cleaned}"; valid capabilities: ${EFFORT_LAUNCH_CAPABILITIES.join(", ")}`)
  }
  return capability
}

export function effortScopeCapabilities(manifest: StackEffortManifest): StackEffortLaunchCapability[] {
  return manifest.scope.capabilities
}

export function effortScopeLanes(manifest: StackEffortManifest): StackEffortRefLane[] {
  return STACK_EFFORT_REF_LANES.filter((lane) =>
    manifest.scope.capabilities.some((capability) => capability.endsWith(`.${lane}`))
  )
}

export function claimInScope(claim: StackEffortClaim, scopeLanes: StackEffortRefLane[]): boolean {
  if (!claim.lanes || claim.lanes.length === 0) return true
  return claim.lanes.some((lane) => scopeLanes.includes(lane))
}

export function assertCapabilityInScope(effort: StackEffort, capability: StackEffortLaunchCapability): void {
  if (effort.manifest.scope.capabilities.includes(capability)) return
  throw new Error(
    `config error: launch capability "${capability}" is out of scope for effort ${effort.manifest.slug} (scope: ${effort.manifest.scope.capabilities.join(", ")}); widen it with \`stack effort scope ${effort.manifest.slug} --capabilities <list>\``,
  )
}

export function updateEffortScope(input: EffortLookupInput & { effortRef: string; capabilities: string[] }): StackEffort {
  const requested = uniqueStrings(input.capabilities.map((value) => value.trim()).filter(Boolean))
  if (requested.length === 0) {
    throw new Error(`config error: effort scope requires at least one capability; valid capabilities: ${EFFORT_LAUNCH_CAPABILITIES.join(", ")}`)
  }
  const capabilities = requested.map(parseEffortLaunchCapability)
  const effort = requireEffort(input, input.effortRef)
  const previous = effort.manifest.scope.capabilities
  effort.manifest.scope = { capabilities }
  appendEffortProgressLine(effort.folder_path, `Scope set to ${capabilities.join(", ")}.`)
  appendEffortActivityLine(effort.folder_path, effort.manifest, "effort.scope_updated", `Scope set to ${capabilities.join(", ")}.`, {
    previous_capabilities: previous,
    capabilities,
    lanes: effortScopeLanes(effort.manifest),
  })
  return persistEffort(input, effort)
}

export type RecordEffortLaunchInput = EffortLookupInput & {
  effortRef: string
  capability: StackEffortLaunchCapability
  kind: string
  lane: StackEffortRefLane
  system: string
  id: string
}

export function recordEffortLaunch(input: RecordEffortLaunchInput): StackEffort {
  const effort = updateEffortRefs({
    stackDataRoot: input.stackDataRoot,
    workspaceRoot: input.workspaceRoot,
    effortRef: input.effortRef,
    refs: [{ system: input.system, id: input.id, lane: input.lane, role: "launch" }],
  })
  appendEffortActivityLine(effort.folder_path, effort.manifest, "effort.launch_recorded", `Launched ${input.kind} via ${input.capability}: ${input.system}=${input.id} (lane ${input.lane}).`, {
    kind: input.kind,
    lane: input.lane,
    capability: input.capability,
    system: input.system,
    id: input.id,
  })
  return effort
}

function requireEffort(input: EffortLookupInput, effortRef: string): StackEffort {
  const effort = readEffort(input, effortRef)
  if (!effort) throw new Error(`effort not found: ${effortRef}`)
  return effort
}

function persistEffort(input: EffortLookupInput, effort: StackEffort): StackEffort {
  const now = new Date().toISOString()
  effort.registry.updated_at = now
  effort.registry.title = effort.manifest.title
  effort.registry.slug = effort.manifest.slug
  effort.registry.template = effort.manifest.template
  effort.registry.status = effort.manifest.status
  effort.registry.meta_thread_refs = effort.manifest.links.meta_thread_refs
  effort.registry.refs = effort.manifest.refs
  writeEffortManifest(join(effort.folder_path, "effort.toml"), effort.manifest)
  writeRegistryRecord(input.stackDataRoot, effort.registry)
  return effort
}

function writeRegistryRecord(stackDataRoot: string, record: StackEffortRegistryRecord): void {
  const dir = effortsRegistryDir(stackDataRoot)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf8")
}

function readRegistryRecords(stackDataRoot: string): StackEffortRegistryRecord[] {
  const dir = effortsRegistryDir(stackDataRoot)
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => {
      try {
        return JSON.parse(readFileSync(join(dir, entry.name), "utf8")) as StackEffortRegistryRecord
      } catch {
        return undefined
      }
    })
    .filter((record): record is StackEffortRegistryRecord => Boolean(record?.id))
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
}

function findRegistryRecord(stackDataRoot: string, effortRef: string): StackEffortRegistryRecord | undefined {
  const ref = effortRef.trim()
  if (!ref) return undefined
  const directPath = join(effortsRegistryDir(stackDataRoot), `${ref}.json`)
  if (existsSync(directPath)) {
    try {
      return JSON.parse(readFileSync(directPath, "utf8")) as StackEffortRegistryRecord
    } catch {
      return undefined
    }
  }
  return readRegistryRecords(stackDataRoot).find((record) => record.slug === ref || record.id === ref)
}

function writeEffortManifest(path: string, manifest: StackEffortManifest): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, effortManifestToml(manifest), "utf8")
}

function effortManifestToml(manifest: StackEffortManifest): string {
  return [
    `schema = ${tomlString(manifest.schema)}`,
    `id = ${tomlString(manifest.id)}`,
    `slug = ${tomlString(manifest.slug)}`,
    `title = ${tomlString(manifest.title)}`,
    `template = ${tomlString(manifest.template)}`,
    `status = ${tomlString(manifest.status)}`,
    `topic = ${tomlString(manifest.topic)}`,
    "",
    "[links]",
    `meta_thread_refs = ${tomlArray(manifest.links.meta_thread_refs)}`,
    `repo_refs = ${tomlArray(manifest.links.repo_refs)}`,
    `initiative_id = ${tomlString(manifest.links.initiative_id)}`,
    "",
    "[scope]",
    `capabilities = ${tomlArray(manifest.scope.capabilities)}`,
    "",
    ...manifest.refs.flatMap((ref) => [
      "[[refs]]",
      `system = ${tomlString(ref.system)}`,
      `id = ${tomlString(ref.id)}`,
      `lane = ${tomlString(ref.lane)}`,
      `role = ${tomlString(ref.role)}`,
      "",
    ]),
    ...manifest.claims.flatMap((claim) => [
      "[[claims]]",
      `label = ${tomlString(claim.label)}`,
      `title = ${tomlString(claim.title)}`,
      `required = ${claim.required}`,
      ...(claim.lanes && claim.lanes.length > 0 ? [`lanes = ${tomlArray(claim.lanes)}`] : []),
      `needs_refs = [${claim.needs_refs.map(claimNeedsRefToml).join(", ")}]`,
      `needs_evidence = [${claim.needs_evidence.map(claimNeedsEvidenceToml).join(", ")}]`,
      "",
    ]),
    "[acceptance]",
    `criteria = ${tomlArray(manifest.acceptance.criteria)}`,
    "",
  ].join("\n")
}

function claimNeedsRefToml(need: StackEffortClaimNeedsRef): string {
  const parts = [`system = ${tomlString(need.system)}`]
  if (need.lane) parts.push(`lane = ${tomlString(need.lane)}`)
  if (need.min > 1) parts.push(`min = ${need.min}`)
  return `{ ${parts.join(", ")} }`
}

function claimNeedsEvidenceToml(need: StackEffortClaimNeedsEvidence): string {
  const parts = [`source_kind = ${tomlString(need.source_kind)}`]
  if (need.under) parts.push(`under = ${tomlString(need.under)}`)
  if (need.min > 1) parts.push(`min = ${need.min}`)
  return `{ ${parts.join(", ")} }`
}

function registryToManifest(record: StackEffortRegistryRecord): StackEffortManifest {
  return {
    schema: STACK_EFFORT_SCHEMA,
    id: record.id,
    slug: record.slug,
    title: record.title,
    template: record.template,
    status: record.status,
    topic: record.title,
    links: {
      meta_thread_refs: record.meta_thread_refs,
      repo_refs: [],
      initiative_id: "",
    },
    scope: { capabilities: [...EFFORT_WIRED_LAUNCH_CAPABILITIES] },
    refs: normalizeRegistryRefs(record),
    claims: [],
    acceptance: { criteria: [] },
  }
}

function normalizeRegistryRefs(record: StackEffortRegistryRecord): StackEffortRef[] {
  const legacy = (record as unknown as Record<string, unknown>).hosted_refs
  return mergeEffortRefs([
    ...readEffortRefEntries(record.refs),
    ...legacyHostedBlockRefs(asRecord(legacy)),
  ])
}

function ensureEffortDirs(folderPath: string, includeResearchLog: boolean): void {
  for (const rel of [
    "ideas",
    "repos",
    "human",
    "notes",
    "findings/ideas",
    "findings/code",
    "findings/data",
    "findings/proof",
    "findings/results",
  ]) {
    mkdirSync(join(folderPath, rel), { recursive: true })
  }
  ensureReadme(join(folderPath, "ideas", "README.md"), "# Ideas\n\nUse `[HUMAN]`, `[AGENT]`, and `[MIXED]` prefixes to preserve idea origin.\n")
  ensureReadme(join(folderPath, "human", "README.md"), "# Human Context\n\nOperator notes, decisions, constraints, and original phrasing that should survive agent handoffs.\n")
  ensureReadme(join(folderPath, "notes", "README.md"), "# Notes\n\nWorking notes and links for this Effort.\n")
  ensureReadme(join(folderPath, "repos", "README.md"), "# Repos\n\nLocal repo, worktree, and evidence-packet pointers for this Effort. Directory attachments are recorded as pointer files instead of recursive copies.\n")
  if (includeResearchLog) {
    ensureReadme(
      join(folderPath, "research_log.md"),
      "# Research log\n\nChronological research log. Operator messages are verbatim; agent work is summarized.\n",
    )
  }
}

function ensureReadme(path: string, content: string): void {
  if (existsSync(path)) return
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, "utf8")
}

function copyTemplateTree(source: string, dest: string): void {
  let entries: Dirent[]
  try {
    entries = readdirSync(source, { withFileTypes: true })
  } catch {
    return
  }
  mkdirSync(dest, { recursive: true })
  for (const entry of entries) {
    if (entry.name === "template.toml") continue
    const srcPath = join(source, entry.name)
    const dstPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      copyTemplateTree(srcPath, dstPath)
      continue
    }
    if (entry.isFile() && !existsSync(dstPath)) cpSync(srcPath, dstPath)
  }
}

function readEffortTemplateDefaults(templateDir: string): EffortTemplateDefaults {
  const path = join(templateDir, "template.toml")
  const defaultScope = (): StackEffortScope => ({ capabilities: [...EFFORT_WIRED_LAUNCH_CAPABILITIES] })
  if (!existsSync(path)) return { acceptanceCriteria: [], claims: [], scope: defaultScope(), researchLog: false }
  try {
    const parsed = Bun.TOML.parse(readFileSync(path, "utf8")) as Record<string, unknown>
    const acceptance = asRecord(parsed.acceptance)
    return {
      acceptanceCriteria: readStringArray(acceptance.criteria),
      claims: readEffortClaimEntries(parsed.claims),
      scope: readEffortScope(parsed.scope),
      researchLog: asRecord(parsed.effort_template).research_log === true,
    }
  } catch {
    return { acceptanceCriteria: [], claims: [], scope: defaultScope(), researchLog: false }
  }
}

function effortTemplateDirs(root: string): string[] {
  if (!existsSync(root)) return []
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name))
      .filter((dir) => existsSync(join(dir, "template.toml")))
      .sort()
  } catch {
    return []
  }
}

function readEffortTemplateSummary(
  templateDir: string,
  source: StackEffortTemplateSummary["source"],
  builtIn: boolean,
  installedShadowed: boolean,
): StackEffortTemplateSummary | undefined {
  const path = join(templateDir, "template.toml")
  if (!existsSync(path)) return undefined
  try {
    const parsed = Bun.TOML.parse(readFileSync(path, "utf8")) as Record<string, unknown>
    const template = asRecord(parsed.effort_template)
    const defaults = asRecord(parsed.defaults)
    const acceptance = asRecord(parsed.acceptance)
    const id = readString(template.id)?.trim() || basename(templateDir)
    const label = readString(template.label)?.trim() || id
    return {
      id,
      label,
      source,
      built_in: builtIn,
      installed_shadowed: installedShadowed,
      template_path: path,
      playbook_path: join(templateDir, "PLAYBOOK.md"),
      research_log: template.research_log === true,
      findings: readStringArray(defaults.findings),
      acceptance_criteria: readStringArray(acceptance.criteria),
    }
  } catch {
    return undefined
  }
}

function resolveEffortFolder(workspaceRoot: string, folderRef: string): string {
  const root = resolve(workspaceRoot)
  const folder = isAbsolute(folderRef) ? resolve(folderRef) : resolve(root, folderRef)
  const rel = relative(root, folder)
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`effort folder must live under workspace root: ${folderRef}`)
  }
  return folder
}

function folderRefFor(workspaceRoot: string, folderPath: string): string {
  const rel = relative(resolve(workspaceRoot), resolve(folderPath))
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`effort folder must live under workspace root: ${folderPath}`)
  }
  return rel.split(/[\\/]/).join("/")
}

function joinPathRef(...parts: string[]): string {
  return parts
    .flatMap((part) => part.split(/[\\/]+/))
    .filter(Boolean)
    .join("/")
}

function formatEffortProgressEntry(message: string, observedAt = new Date().toISOString()): string {
  return `${observedAt} - ${message.trim()}`
}

function appendEffortProgressLine(folderPath: string, message: string): void {
  appendEffortProgressEntry(folderPath, formatEffortProgressEntry(message))
}

function appendEffortProgressEntry(folderPath: string, entry: string): void {
  const path = join(folderPath, "PROGRESS.md")
  const line = `- ${entry}`
  if (!existsSync(path)) {
    writeFileSync(path, `# Progress\n\n${line}\n`, "utf8")
    return
  }
  appendFileSync(path, `${pathEndsWithNewline(path) ? "" : "\n"}${line}\n`, "utf8")
}

function appendEffortActivityLine(
  folderPath: string,
  manifest: StackEffortManifest,
  type: string,
  summary: string,
  payload: Record<string, unknown> = {},
): void {
  appendEffortActivityRecord(folderPath, makeEffortActivityRecord(manifest, type, summary, payload))
}

function makeEffortActivityRecord(
  manifest: StackEffortManifest,
  type: string,
  summary: string,
  payload: Record<string, unknown> = {},
  observedAt = new Date().toISOString(),
): StackEffortActivityRecord {
  return {
    activity_id: `effact_${randomUUID()}`,
    type,
    observed_at: observedAt,
    effort_id: manifest.id,
    slug: manifest.slug,
    summary: summary.trim(),
    payload,
  }
}

function appendEffortActivityRecord(folderPath: string, record: StackEffortActivityRecord): void {
  const path = join(folderPath, "ACTIVITY.jsonl")
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8")
}

function researchLogEntryMarkdown(input: AppendEffortResearchLogInput): string {
  const date = new Date().toISOString().slice(0, 10)
  const lines = [`## ${date} - ${input.title.trim()}`, ""]
  const operatorMessage = input.operatorMessage
  if (operatorMessage?.trim()) {
    lines.push("**You:**")
    lines.push(...operatorMessage.split(/\r?\n/).map((line) => `> ${line}`))
    lines.push("")
  }
  lines.push(`**Work (summarized):** ${input.workSummary.trim()}`)
  const result = input.result?.trim()
  if (result) {
    lines.push("", "### Result", "", result)
  }
  const metrics = cleanStringList(input.metrics)
  if (metrics.length > 0) {
    lines.push("", "### Metrics", "")
    lines.push(...metrics.map((metric) => `- ${metric}`))
  }
  const paths = cleanStringList(input.paths)
  if (paths.length > 0) {
    lines.push("", "### Key paths", "")
    lines.push(...paths.map((path) => `- ${path}`))
  }
  const commands = cleanStringList(input.reproduceCommands)
  if (commands.length > 0) {
    lines.push("", "### Reproduce commands", "", "```text")
    lines.push(...commands)
    lines.push("```")
  }
  const next = input.next?.trim()
  if (next) {
    lines.push("", `**Next toward mission:** ${next}`)
  }
  return lines.join("\n")
}

function cleanStringList(values: string[] | undefined): string[] {
  return values?.map((value) => value.trim()).filter(Boolean) ?? []
}

function effortHandoffMarkdown(
  effort: StackEffort,
  input: WriteEffortHandoffInput,
  pending: { progressEntries?: string[]; activityRecords?: StackEffortActivityRecord[] } = {},
  audit?: StackEffortAudit,
): string {
  const paths = effortPathRefs(effort)
  const progress = [...readEffortProgressTail(effort, 8), ...(pending.progressEntries ?? [])].slice(-8)
  const activity = [...readEffortActivityTail(effort, 8), ...(pending.activityRecords ?? [])].slice(-8)
  const blockers = effortBlockerRecords(effort, pending.activityRecords ?? [], 10)
  const artifactInventory = effortArtifactInventory(effort)
  const findingFiles = artifactInventory.findings
  const acceptancePacket = findingFiles.results.find((path) => path.endsWith("/findings/results/acceptance-summary.md"))
  const parsedAcceptance = readEffortAcceptancePacket(effort)
  const researchLogLines = paths.research_log ? effortHandoffResearchLogLines(effort) : []
  const benchmarkLines = effortHandoffBenchmarkLines(effort)
  const runEvidenceLines = effortHandoffRunEvidenceLines(effort)
  const releaseArtifactLines = effortHandoffReleaseArtifactLines(effort)
  const remainingWork = readEffortRemainingWork(effort)
  const riskLines = effortHandoffRiskLines(input.risks, remainingWork)
  const lines = [
    `# ${effort.manifest.title} - handoff`,
    "",
    `Generated: ${new Date().toISOString()}`,
    `Status: ${effort.manifest.status}`,
    `Template: ${effort.manifest.template}`,
    `Effort id: ${effort.manifest.id}`,
    `Folder: ${effort.registry.folder_ref}`,
    "",
    "## Summary",
    "",
    input.summary?.trim() || effort.manifest.topic || effort.manifest.title,
    "",
    "## Orientation",
    "",
    `- Manifest: ${paths.manifest}`,
    `- Playbook: ${paths.playbook}`,
    `- Progress: ${paths.progress}`,
    `- Activity: ${paths.activity}`,
    ...(paths.research_log ? [`- Research log: ${paths.research_log}`] : []),
    `- Ideas: ${paths.ideas}`,
    `- Human context: ${paths.human}`,
    `- Notes: ${paths.notes}`,
    `- Repos: ${paths.repos}`,
    `- Findings: ${Object.values(paths.findings).join(", ")}`,
    "",
    "## Bound Threads And Refs",
    "",
    ...bulletLines("Meta-threads", effort.manifest.links.meta_thread_refs),
    ...bulletLines("Repos", effort.manifest.links.repo_refs),
  ]
  for (const ref of effort.manifest.refs) {
    const suffix = [ref.lane ? `lane=${ref.lane}` : "", ref.role ? `role=${ref.role}` : ""].filter(Boolean).join(" ")
    lines.push(`- ${ref.system}: ${ref.id}${suffix ? ` (${suffix})` : ""}`)
  }
  if (effort.manifest.links.initiative_id) lines.push(`- Initiative: ${effort.manifest.links.initiative_id}`)
  lines.push(
    "",
    "## Latest Progress",
    "",
    ...(progress.length > 0 ? progress.map((entry) => `- ${entry}`) : ["- No progress entries recorded."]),
    "",
    "## Latest Activity",
    "",
    ...(activity.length > 0
      ? activity.map((entry) => `- ${entry.observed_at} - ${entry.type}: ${entry.summary}`)
      : ["- No activity entries recorded."]),
    ...(paths.research_log ? [
      "",
      "## Research Log",
      "",
      ...researchLogLines,
    ] : []),
    ...(artifactInventory.ideas.length > 0 || artifactInventory.findings.ideas.length > 0 ? [
      "",
      "## Idea Graph",
      "",
      ...effortHandoffIdeaGraphLines(effort, artifactInventory),
    ] : []),
    ...(benchmarkLines.length > 0 ? [
      "",
      "## Benchmark Intake",
      "",
      ...benchmarkLines,
    ] : []),
    ...(runEvidenceLines.length > 0 ? [
      "",
      "## Run Evidence",
      "",
      ...runEvidenceLines,
    ] : []),
    ...(releaseArtifactLines.length > 0 ? [
      "",
      "## Release Artifacts",
      "",
      ...releaseArtifactLines,
    ] : []),
    "",
    "## Recorded Blockers",
    "",
    ...effortBlockerLines(blockers),
    "",
    "## Acceptance Criteria",
    "",
    ...(effort.manifest.acceptance.criteria.length > 0
      ? effort.manifest.acceptance.criteria.map((criterion) => `- ${criterion}`)
      : ["- No acceptance criteria recorded in effort.toml."]),
    "",
    "## Acceptance Packet",
    "",
    ...effortHandoffAcceptanceLines(acceptancePacket, parsedAcceptance),
    "",
    "## Remaining Work",
    "",
    ...effortHandoffRemainingWorkLines(remainingWork),
    ...(effort.manifest.claims.length > 0 ? [
      "",
      "## Claim Lanes",
      "",
      ...effortHandoffClaimLaneLines(effort, parsedAcceptance),
    ] : []),
    "",
    "## Audit",
    "",
    ...effortHandoffAuditLines(audit),
    "",
    "## Artifact Inventory",
    "",
    `Total indexed artifacts: ${artifactInventory.counts.total}`,
    `Receipt sidecars: ${artifactInventory.counts.receipt_sidecars}`,
    "",
    "### Receipt Summary",
    "",
    ...receiptSummaryLines(artifactInventory),
    "",
    "### Generated",
    "",
    ...limitedArtifactLines(Object.values(artifactInventory.generated).filter((value): value is string => Boolean(value))),
    "",
    "### Ideas",
    "",
    ...limitedArtifactLines(artifactInventory.ideas),
    "",
    "### Work folders",
    "",
    "#### human",
    "",
    ...limitedArtifactLines(artifactInventory.human),
    "",
    "#### notes",
    "",
    ...limitedArtifactLines(artifactInventory.notes),
    "",
    "#### repos",
    "",
    ...limitedArtifactLines(artifactInventory.repos),
    "",
    "### Findings",
    "",
  )
  for (const [kind, files] of Object.entries(findingFiles)) {
    lines.push(`#### ${kind}`, "", ...limitedArtifactLines(files), "")
  }
  lines.push(
    "### Receipt Sidecars",
    "",
    ...receiptSourceLines(artifactInventory),
    "",
  )
  lines.push(
    "## Risks And Open Threads",
    "",
    ...riskLines,
    "",
    "## Next",
    "",
    input.next?.trim() || "Review latest progress, research log, and findings before assigning the next thread.",
  )
  const owner = input.owner?.trim()
  if (owner) {
    lines.push("", "## Owner", "", owner)
  }
  return `${lines.join("\n")}\n`
}

function effortHandoffAuditLines(audit: StackEffortAudit | undefined): string[] {
  if (!audit) {
    return [
      "Status: pending",
      "Checked: after handoff receipt is written",
      "- pending handoff_packet: packet is being generated",
    ]
  }
  const failures = audit.checks.filter((check) => check.status === "fail").length
  const warnings = audit.checks.filter((check) => check.status === "warn").length
  const lines = [
    `Status: ${audit.status}`,
    `Checked: ${audit.checked_at}`,
    `Failures: ${failures}`,
    `Warnings: ${warnings}`,
    `Counts: progress=${audit.counts.progress_entries}, activity=${audit.counts.activity_receipts}, blockers=${audit.counts.blockers}, repos=${audit.counts.repo_refs}, external_refs=${audit.counts.external_refs}`,
  ]
  if (audit.latest_blocker) {
    lines.push(`Latest blocker: ${audit.latest_blocker.blocker} | owner=${audit.latest_blocker.owner} | next=${audit.latest_blocker.next}`)
  }
  for (const check of audit.checks) {
    lines.push(`- ${check.status} ${check.id}: ${check.summary}`)
  }
  return lines
}

function engineeringPacketMarkdown(
  effort: StackEffort,
  input: WriteEffortEngineeringPacketInput,
  snapshot: {
    changedFiles: string[]
    diffStat: string
    gitStatus: { ok: boolean; message: string }
  },
): string {
  const validations = cleanStringList(input.validations)
  const skippedGates = cleanStringList(input.skippedGates)
  const risks = cleanStringList(input.risks)
  const next = input.next?.trim()
  const lines = [
    `# ${effort.manifest.title} - engineering change packet`,
    "",
    `Generated: ${new Date().toISOString()}`,
    `Effort: ${effort.manifest.slug}`,
    `Status: ${effort.manifest.status}`,
    `Template: ${effort.manifest.template}`,
    ...(input.repoPath ? [`Repo path: ${input.repoPath}`] : []),
    ...(input.baseRef ? [`Base ref: ${input.baseRef}`] : []),
    `Git snapshot: ${snapshot.gitStatus.ok ? "ok" : "unavailable"} - ${snapshot.gitStatus.message}`,
    "",
    "## Summary",
    "",
    input.summary?.trim() || effort.manifest.topic || effort.manifest.title,
    "",
    "## Changed Files",
    "",
    ...(snapshot.changedFiles.length > 0 ? snapshot.changedFiles.map((file) => `- ${file}`) : ["- No changed files recorded."]),
    "",
    "## Diff Stat",
    "",
    "```text",
    snapshot.diffStat || "No diff stat recorded.",
    "```",
    "",
    "## Validation",
    "",
    ...(validations.length > 0 ? validations.map((entry) => `- ${entry}`) : ["- No validation recorded."]),
    "",
    "## Skipped Gates",
    "",
    ...(skippedGates.length > 0 ? skippedGates.map((entry) => `- ${entry}`) : ["- No skipped gates recorded."]),
    "",
    "## Risks",
    "",
    ...(risks.length > 0 ? risks.map((entry) => `- ${entry}`) : ["- No risks recorded."]),
    "",
    "## Next Action",
    "",
    next || "Review changed files, diff stat, validation, skipped gates, and risks before handoff or release.",
    "",
  ]
  return lines.join("\n")
}

function effortHandoffAcceptanceLines(
  acceptancePacket: string | undefined,
  parsed: StackEffortAcceptancePacket | undefined,
): string[] {
  if (!acceptancePacket) return ["- No acceptance summary recorded at findings/results/acceptance-summary.md."]
  const lines = [`- Summary: ${acceptancePacket}`]
  if (!parsed) return lines
  lines.push(`- Status: ${parsed.summary}`)
  for (const level of parsed.levels) {
    const required = level.required_for_v1 ? " required-v1" : ""
    lines.push(`- ${level.label}: ${acceptanceLevelStateLabel(level.state)}${required} - ${level.title} - ${level.status}`)
  }
  return lines
}

function effortHandoffResearchLogLines(effort: StackEffort): string[] {
  const path = join(effort.folder_path, "research_log.md")
  if (!existsSync(path)) return ["- No research log recorded."]
  const text = safeReadText(path)
  const entries = researchLogEntrySummaries(text).slice(-5)
  if (entries.length === 0) return [`- ${joinPathRef(effort.registry.folder_ref, "research_log.md")} has no dated entries yet.`]
  const lines = [`- Full log: ${joinPathRef(effort.registry.folder_ref, "research_log.md")}`]
  for (const entry of entries) {
    const parts = [
      entry.work ? `Work: ${entry.work}` : "",
      entry.result ? `Result: ${entry.result}` : "",
      entry.next ? `Next: ${entry.next}` : "",
    ].filter(Boolean)
    lines.push(`- ${entry.title}${parts.length > 0 ? ` | ${parts.join(" | ")}` : ""}`)
  }
  return lines
}

function effortHandoffIdeaGraphLines(effort: StackEffort, inventory: StackEffortArtifactInventory): string[] {
  const originCounts = new Map<string, number>()
  for (const idea of inventory.ideas) {
    incrementCount(originCounts, ideaOriginFromRef(idea))
  }
  const lines = [
    `- Raw ideas: ${inventory.ideas.length}`,
    `- Promoted idea findings: ${inventory.findings.ideas.length}`,
    `- Origin counts: ${formatCountMap(originCounts)}`,
    "",
    "### Raw Ideas",
    "",
    ...(inventory.ideas.length > 0
      ? inventory.ideas.map((idea) => `- ${ideaOriginFromRef(idea)}: ${idea}`)
      : ["- None recorded."]),
    "",
    "### Promoted Idea Links",
    "",
  ]
  if (inventory.findings.ideas.length === 0) {
    lines.push("- None recorded.")
    return lines
  }
  for (const finding of inventory.findings.ideas) {
    const links = promotedIdeaBacklinksForFinding(effort, finding)
    lines.push(`- ${finding}${links.length > 0 ? ` -> ${links.join(", ")}` : " -> missing raw idea backlink"}`)
  }
  return lines
}

function effortHandoffRunEvidenceLines(effort: StackEffort): string[] {
  const summaries = readEffortRunEvidenceSummaries(effort, 10)
  if (summaries.length === 0) return []
  return summaries.map((summary) => {
    const details = [
      `run=${summary.run_id}`,
      summary.project_id ? `project=${summary.project_id}` : "",
      summary.output_id ? `output=${summary.output_id}` : "",
      summary.artifact_name ? `artifact=${summary.artifact_name}` : "",
      summary.metric ? `metric=${summary.metric}` : "",
      summary.acceptance_level ? `acceptance=${summary.acceptance_level}` : "",
      summary.source_receipt_path ? `receipt=${summary.source_receipt_path}` : "",
    ].filter(Boolean).join(" - ")
    return `- ${summary.observed_at} - ${summary.run_kind.toUpperCase()}: ${summary.path} - ${details}`
  })
}

function effortHandoffBenchmarkLines(effort: StackEffort): string[] {
  const summaries = readEffortBenchmarkSummaries(effort, 10)
  if (summaries.length === 0) return []
  return summaries.map((summary) => {
    const details = [
      summary.benchmark_id ? `id=${summary.benchmark_id}` : "",
      summary.version ? `version=${summary.version}` : "",
      summary.source ? `source=${summary.source}` : "",
      summary.license ? `license=${summary.license}` : "",
      summary.task_shape ? `task=${summary.task_shape}` : "",
      summary.splits.length > 0 ? `splits=${summary.splits.join(",")}` : "",
      summary.metrics.length > 0 ? `metrics=${summary.metrics.join(",")}` : "",
      summary.source_receipt_path ? `receipt=${summary.source_receipt_path}` : "",
    ].filter(Boolean).join(" - ")
    return `- ${summary.observed_at} - ${summary.name}: ${summary.path} - ${details}`
  })
}

function effortHandoffReleaseArtifactLines(effort: StackEffort): string[] {
  const summaries = readEffortReleaseArtifactSummaries(effort, 10)
  if (summaries.length === 0) return []
  return summaries.map((summary) => {
    const details = [
      summary.version ? `version=${summary.version}` : "",
      summary.channel ? `channel=${summary.channel}` : "",
      summary.target ? `target=${summary.target}` : "",
      summary.sha256 ? `sha256=${summary.sha256}` : "",
      summary.size ? `size=${summary.size}` : "",
      summary.publishable !== undefined ? `publishable=${summary.publishable}` : "",
      summary.publish_blockers.length > 0 ? `blockers=${summary.publish_blockers.join(";")}` : "",
      summary.source_receipt_path ? `receipt=${summary.source_receipt_path}` : "",
    ].filter(Boolean).join(" - ")
    return `- ${summary.observed_at} - ${summary.path}${details ? ` - ${details}` : ""}`
  })
}

function ideaOriginFromRef(ref: string): string {
  const match = /^\[(HUMAN|AGENT|MIXED)\]-/.exec(basename(ref))
  return match?.[1] ?? "UNTAGGED"
}

function promotedIdeaBacklinksForFinding(effort: StackEffort, ref: string): string[] {
  const path = effortPathFromRef(effort, ref)
  const text = path ? safeReadText(path) : ""
  const links = new Set<string>()
  for (const match of text.matchAll(/\bideas\/\[(HUMAN|AGENT|MIXED)\]-[^\s)\]]+\.md\b/g)) {
    if (match[0]) links.add(match[0])
  }
  return Array.from(links).sort()
}

function researchLogEntrySummaries(text: string): Array<{ title: string; work?: string; result?: string; next?: string }> {
  const lines = text.split(/\r?\n/)
  const entries: Array<{ title: string; body: string[] }> = []
  let current: { title: string; body: string[] } | undefined
  for (const line of lines) {
    const heading = /^##\s+(.+)$/.exec(line)
    if (heading) {
      if (current) entries.push(current)
      current = { title: heading[1]?.trim() || "Untitled research log entry", body: [] }
      continue
    }
    if (current) current.body.push(line)
  }
  if (current) entries.push(current)
  return entries.map((entry) => {
    const body = entry.body.join("\n")
    return {
      title: clipHandoffLine(entry.title, 120),
      ...(extractResearchLogWork(body) ? { work: extractResearchLogWork(body) } : {}),
      ...(extractResearchLogResult(body) ? { result: extractResearchLogResult(body) } : {}),
      ...(extractResearchLogNext(body) ? { next: extractResearchLogNext(body) } : {}),
    }
  })
}

function extractResearchLogWork(body: string): string | undefined {
  const match = /\*\*Work \(summarized\):\*\*\s*(.+)/.exec(body)
  return match?.[1] ? clipHandoffLine(match[1], 180) : undefined
}

function extractResearchLogResult(body: string): string | undefined {
  const result = markdownSubsectionFirstParagraph(body, "Result")
  return result ? clipHandoffLine(result, 180) : undefined
}

function extractResearchLogNext(body: string): string | undefined {
  const match = /\*\*Next toward mission:\*\*\s*(.+)/.exec(body)
  return match?.[1] ? clipHandoffLine(match[1], 180) : undefined
}

function markdownSubsectionFirstParagraph(markdown: string, heading: string): string | undefined {
  const lines = markdown.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === `### ${heading}`)
  if (start < 0) return undefined
  const collected: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^#{2,3}\s+/.test(line)) break
    const trimmed = line.trim()
    if (!trimmed) {
      if (collected.length > 0) break
      continue
    }
    if (trimmed.startsWith("- ")) continue
    collected.push(trimmed)
  }
  return collected.join(" ").trim() || undefined
}

function clipHandoffLine(value: string, maxLength: number): string {
  const cleaned = value.replace(/\s+/g, " ").trim()
  if (cleaned.length <= maxLength) return cleaned
  return `${cleaned.slice(0, Math.max(0, maxLength - 3))}...`
}

function effortHandoffRemainingWorkLines(remaining: StackEffortRemainingWork): string[] {
  const lines = [
    `- State: ${remaining.state}`,
    `- Summary: ${remaining.summary}`,
  ]
  for (const level of remaining.open_acceptance) {
    const required = level.required_for_v1 ? " required-v1" : ""
    lines.push(`- Acceptance ${level.label}:${required} ${level.title} - ${level.status}`)
  }
  for (const level of remaining.out_of_scope) {
    lines.push(`- Acceptance ${level.label}: ${level.title} - out_of_scope`)
  }
  if (remaining.latest_blocker) {
    lines.push(`- Latest blocker: ${remaining.latest_blocker.blocker}`)
    lines.push(`- Blocker owner: ${remaining.latest_blocker.owner}`)
    lines.push(`- Next safe action: ${remaining.latest_blocker.next}`)
  }
  if (remaining.next_actions.length > 0) {
    lines.push(...remaining.next_actions.map((action) => `- Next: ${action}`))
  }
  return lines
}

function effortHandoffClaimLaneLines(
  effort: StackEffort,
  acceptance: StackEffortAcceptancePacket | undefined,
): string[] {
  const lines: string[] = []
  for (const claim of effort.manifest.claims) {
    const level = acceptance?.levels.find((candidate) => candidate.label === claim.label)
    const state = level?.state ?? "missing"
    const status = level?.status || "not recorded"
    const evaluation = evaluateEffortClaim(effort, claim)
    lines.push(`- ${claim.label} ${level?.title || claim.title}${claim.required ? " (required)" : ""}`)
    lines.push(`  State: ${state}; status: ${status}; requirements met: ${evaluation.ok}`)
    for (const line of evaluation.satisfied.slice(0, 5)) lines.push(`  Satisfied: ${line}`)
    for (const line of evaluation.missing.slice(0, 5)) lines.push(`  Missing: ${line}`)
    const next = state === "recorded"
      ? "No action needed unless new evidence supersedes the recorded acceptance."
      : evaluation.ok
        ? `Record ${claim.label} through the typed acceptance writer.`
        : `Satisfy the missing requirements, then record ${claim.label} through the typed acceptance writer.`
    lines.push(`  Next: ${next}`)
  }
  return lines
}




function effortHandoffRiskLines(inputRisks: string[] | undefined, remaining: StackEffortRemainingWork): string[] {
  const risks = cleanStringList(inputRisks)
  const openAcceptance = remaining.open_acceptance.map((level) => `${level.label} ${level.title} (${level.status})`)
  if (openAcceptance.length > 0) {
    risks.push(`Open acceptance remains: ${openAcceptance.join("; ")}.`)
  }
  if (remaining.latest_blocker) {
    risks.push(`Latest blocker: ${remaining.latest_blocker.blocker}. Owner: ${remaining.latest_blocker.owner}. Next safe action: ${remaining.latest_blocker.next}.`)
  }
  const uniqueRisks = uniqueStrings(risks)
  return uniqueRisks.length > 0
    ? uniqueRisks.map((risk) => `- ${risk}`)
    : ["- No risks recorded in this handoff packet."]
}

function handoffRiskCoverageAudit(handoffText: string, remaining: StackEffortRemainingWork): { ok: boolean; evidence: string[] } {
  const evidence = [
    `remaining_state=${remaining.state}`,
    `remaining_summary=${remaining.summary}`,
  ]
  if (remaining.state !== "open") return { ok: true, evidence }
  const section = markdownSectionText(handoffText, "Risks And Open Threads")
  const missing: string[] = []
  if (!section) missing.push("Risks And Open Threads section")
  if (section.includes("No risks recorded in this handoff packet.")) missing.push("no-risks placeholder")
  for (const level of remaining.open_acceptance) {
    if (!section.includes(level.label) || !section.includes(level.title)) missing.push(`open acceptance ${level.label}`)
  }
  if (remaining.latest_blocker && !section.includes(remaining.latest_blocker.blocker)) missing.push("latest blocker")
  return {
    ok: missing.length === 0,
    evidence: [
      ...evidence,
      `open_acceptance=${remaining.open_acceptance.map((level) => level.label).join(",") || "none"}`,
      `latest_blocker=${remaining.latest_blocker?.blocker ?? "none"}`,
      ...(missing.length > 0 ? missing.map((entry) => `missing: ${entry}`) : ["coverage=ok"]),
    ],
  }
}

function markdownSectionText(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`)
  if (start < 0) return ""
  const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line))
  return lines.slice(start + 1, end < 0 ? lines.length : end).join("\n")
}

function effortBlockerRecords(effort: StackEffort, pending: StackEffortActivityRecord[], limit: number): StackEffortBlockerRecord[] {
  const recordsById = new Map<string, StackEffortBlockerRecord>()
  for (const record of [...readEffortBlockerTail(effort, 200), ...pending.map(effortBlockerFromActivity).filter((entry): entry is StackEffortBlockerRecord => Boolean(entry))]) {
    recordsById.set(record.activity_id, record)
  }
  return Array.from(recordsById.values()).slice(-limit)
}

function effortBlockerLines(records: StackEffortBlockerRecord[]): string[] {
  if (records.length === 0) return ["- None recorded."]
  return records.map((record) => {
    const status = record.resolved_at
      ? `Resolved ${record.resolved_at}: ${record.resolution ?? "resolution recorded"}${record.resolution_evidence ? ` Evidence: ${record.resolution_evidence}.` : ""}`
      : `Open. Owner: ${record.owner}. Next safe action: ${record.next}.`
    return `- ${record.observed_at} - ${record.blocker} Evidence: ${record.evidence}. ${status}`
  })
}

function effortBlockerFromActivity(record: StackEffortActivityRecord): StackEffortBlockerRecord | undefined {
  if (record.type !== "effort.blocker_recorded") return undefined
  const payload = asRecord(record.payload)
  return {
    activity_id: record.activity_id,
    observed_at: record.observed_at,
    effort_id: record.effort_id,
    slug: record.slug,
    summary: record.summary,
    blocker: readString(payload.blocker)?.trim() || record.summary,
    evidence: readString(payload.evidence)?.trim() || "not recorded",
    owner: readString(payload.owner)?.trim() || "not recorded",
    next: readString(payload.next)?.trim() || "not recorded",
  }
}

function effortBlockerResolutionFromActivity(record: StackEffortActivityRecord): StackEffortBlockerResolutionRecord | undefined {
  if (record.type !== "effort.blocker_resolved") return undefined
  const payload = asRecord(record.payload)
  const blockerActivityId = readString(payload.blocker_activity_id)?.trim()
  const resolution = readString(payload.resolution)?.trim()
  if (!blockerActivityId || !resolution) return undefined
  const evidence = readString(payload.evidence)?.trim()
  const owner = readString(payload.owner)?.trim()
  return {
    activity_id: record.activity_id,
    observed_at: record.observed_at,
    effort_id: record.effort_id,
    slug: record.slug,
    summary: record.summary,
    blocker_activity_id: blockerActivityId,
    blocker: readString(payload.blocker)?.trim() || "not recorded",
    resolution,
    ...(evidence ? { evidence } : {}),
    ...(owner ? { owner } : {}),
  }
}

function bulletLines(label: string, values: string[]): string[] {
  return values.length > 0 ? values.map((value) => `- ${label}: ${value}`) : [`- ${label}: none recorded`]
}

function limitedArtifactLines(paths: string[]): string[] {
  if (paths.length === 0) return ["- None recorded."]
  const shown = paths.slice(0, 20).map((path) => `- ${path}`)
  if (paths.length > shown.length) shown.push(`- ... ${paths.length - shown.length} more`)
  return shown
}

function receiptSourceLines(inventory: StackEffortArtifactInventory): string[] {
  if (inventory.receipt_sidecars.length === 0) return ["- None recorded."]
  const sources = new Map(inventory.receipt_sources.map((source) => [source.sidecar_path, source]))
  const shown = inventory.receipt_sidecars.slice(0, 20).map((sidecarPath) => {
    const source = sources.get(sidecarPath)
    if (!source) return `- ${sidecarPath} -> unreadable source receipt; see audit`
    const receipt = source.receipt
    const label = [
      receipt.source_kind ?? "source",
      receipt.artifact_kind ?? "",
      receipt.environment ? `env=${receipt.environment}` : "",
    ].filter(Boolean).join(", ")
    const digest = receipt.digest?.sha256 ? ` sha256=${receipt.digest.sha256}` : ""
    return `- ${sidecarPath} -> ${source.finding_path} (${label}) source=${receipt.workspace_path}${digest}`
  })
  if (inventory.receipt_sidecars.length > shown.length) shown.push(`- ... ${inventory.receipt_sidecars.length - shown.length} more`)
  return shown
}

function receiptSummaryLines(inventory: StackEffortArtifactInventory): string[] {
  if (inventory.receipt_sidecars.length === 0) return ["- No receipt sidecars recorded."]
  const sourceKindCounts = new Map<string, number>()
  const artifactKindCounts = new Map<string, number>()
  const environmentCounts = new Map<string, number>()
  let digestCount = 0
  for (const source of inventory.receipt_sources) {
    incrementCount(sourceKindCounts, source.receipt.source_kind ?? "unknown")
    incrementCount(artifactKindCounts, source.receipt.artifact_kind ?? "unknown")
    incrementCount(environmentCounts, source.receipt.environment ?? "unknown")
    if (source.receipt.digest?.sha256) digestCount += 1
  }
  const unreadable = Math.max(0, inventory.receipt_sidecars.length - inventory.receipt_sources.length)
  return [
    `- Sidecars: ${inventory.receipt_sidecars.length}`,
    `- Readable source receipts: ${inventory.receipt_sources.length}`,
    `- Digest-backed receipts: ${digestCount}`,
    ...(unreadable > 0 ? [`- Unreadable source receipts: ${unreadable}`] : []),
    `- Source kinds: ${formatCountMap(sourceKindCounts)}`,
    `- Artifact kinds: ${formatCountMap(artifactKindCounts)}`,
    `- Environments: ${formatCountMap(environmentCounts)}`,
  ]
}

function incrementCount(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

function formatCountMap(counts: Map<string, number>): string {
  if (counts.size === 0) return "none"
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, count]) => `${key}=${count}`)
    .join(", ")
}

function effortRelativeFiles(effort: StackEffort, ...parts: string[]): string[] {
  const root = join(effort.folder_path, ...parts)
  if (!existsSync(root)) return []
  const files: string[] = []
  collectRelativeFiles(root, root, files)
  return files
    .filter((path) => !isScaffoldArtifactFile(path))
    .map((path) => joinPathRef(effort.registry.folder_ref, ...parts, path))
    .sort()
}

function collectRelativeFiles(root: string, dir: string, files: string[]): void {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      collectRelativeFiles(root, path, files)
    } else if (entry.isFile()) {
      files.push(relative(root, path))
    }
  }
}

function isScaffoldArtifactFile(path: string): boolean {
  return basename(path).toLowerCase() === "readme.md"
}

function researchLogShape(path: string): { ok: boolean; evidence: string[] } {
  const text = safeReadText(path)
  const datedEntries = text.match(/^## \d{4}-\d{2}-\d{2} - .+$/gm) ?? []
  const operatorBlocks = text.match(/^\*\*You:\*\*/gm) ?? []
  const workSummaries = text.match(/^\*\*Work \(summarized\):\*\*/gm) ?? []
  const resultSignals = text.match(/^(### (Result|Actual runs|Mechanism Result|Key paths|Reproduce commands)|\*\*(Run|Result):\*\*)/gm) ?? []
  return {
    ok: datedEntries.length > 0 && operatorBlocks.length > 0 && workSummaries.length > 0,
    evidence: [
      `dated_entries=${datedEntries.length}`,
      `operator_blocks=${operatorBlocks.length}`,
      `work_summaries=${workSummaries.length}`,
      `result_or_evidence_sections=${resultSignals.length}`,
    ],
  }
}

function originTaggedIdeaPath(path: string): boolean {
  return /^\[(HUMAN|AGENT|MIXED)\]-[^/]+\.md$/.test(basename(path))
}

function promotedIdeaBacklinkAudit(effort: StackEffort, promotedIdeaRefs: string[]): { missing: string[]; evidence: string[] } {
  const missing: string[] = []
  const linked: string[] = []
  for (const ref of promotedIdeaRefs) {
    const path = effortPathFromRef(effort, ref)
    const text = path ? safeReadText(path) : ""
    if (/\bideas\/\[(HUMAN|AGENT|MIXED)\]-[^\s)\]]+\.md\b/.test(text)) {
      linked.push(ref)
    } else {
      missing.push(ref)
    }
  }
  return {
    missing,
    evidence: promotedIdeaRefs.length === 0
      ? ["no promoted idea findings"]
      : [
          `linked=${linked.length}`,
          `missing=${missing.length}`,
          ...missing.slice(0, 10).map((ref) => `missing backlink: ${ref}`),
          ...linked.slice(0, 10).map((ref) => `linked: ${ref}`),
      ],
  }
}

function findingReceiptSidecarAudit(
  effort: StackEffort,
  findingFiles: Record<"ideas" | "code" | "data" | "proof" | "results", string[]>,
): { ok: boolean; count: number; evidence: string[] } {
  const sidecarRefs = Object.values(findingFiles).flat().filter(isFindingReceiptSidecarRef)
  const valid: string[] = []
  const invalid: string[] = []
  for (const ref of sidecarRefs) {
    const path = effortPathFromRef(effort, ref)
    const parsed = path ? parseJsonObject(path) : undefined
    const receipt = parsed?.receipt && typeof parsed.receipt === "object" && !Array.isArray(parsed.receipt)
      ? parsed.receipt as Record<string, unknown>
      : undefined
    const findingPath = readString(parsed?.finding_path)?.trim()
    const referencedFinding = findingPath ? join(effort.folder_path, ...findingPath.split("/").filter(Boolean)) : ""
    const problems: string[] = []
    if (!path) problems.push("outside Effort folder")
    if (readString(parsed?.schema) !== "stack/effort/finding-source-receipt/v1") problems.push("bad schema")
    if (!receipt) problems.push("missing receipt")
    if (!readString(receipt?.receipt_path)?.trim()) problems.push("missing receipt_path")
    if (!readString(receipt?.workspace_path)?.trim()) problems.push("missing workspace_path")
    if (!findingPath) problems.push("missing finding_path")
    else if (!isPathInside(effort.folder_path, referencedFinding) || !existsSync(referencedFinding)) problems.push("missing referenced finding")
    if (problems.length > 0) invalid.push(`${ref}: ${problems.join(", ")}`)
    else valid.push(ref)
  }
  return {
    ok: invalid.length === 0,
    count: sidecarRefs.length,
    evidence: sidecarRefs.length === 0
      ? ["receipt_sidecars=0"]
      : [
          `receipt_sidecars=${sidecarRefs.length}`,
          `valid=${valid.length}`,
          `invalid=${invalid.length}`,
          ...invalid.slice(0, 10),
          ...valid.slice(0, 10).map((ref) => `valid: ${ref}`),
        ],
  }
}

function findingReceiptDigestAudit(
  effort: StackEffort,
  findingFiles: Record<"ideas" | "code" | "data" | "proof" | "results", string[]>,
): { status: StackEffortAuditStatus; count: number; evidence: string[] } {
  const sidecarRefs = Object.values(findingFiles).flat().filter(isFindingReceiptSidecarRef)
  const checked: string[] = []
  const missingDigest: string[] = []
  const invalid: string[] = []
  for (const ref of sidecarRefs) {
    const path = effortPathFromRef(effort, ref)
    const parsed = path ? parseJsonObject(path) : undefined
    const findingPath = readString(parsed?.finding_path)?.trim()
    const referencedFinding = findingPath ? join(effort.folder_path, ...findingPath.split("/").filter(Boolean)) : ""
    const receipt = normalizeEffortFindingSourceReceipt(parsed?.receipt)
    const expected = receipt?.digest
    if (!path || !receipt || !findingPath || !isPathInside(effort.folder_path, referencedFinding) || !existsSync(referencedFinding)) {
      continue
    }
    if (!expected?.sha256 && expected?.bytes === undefined) {
      missingDigest.push(ref)
      continue
    }
    const actual = localPathDigest(referencedFinding)
    if (!actual) {
      invalid.push(`${ref}: digest unavailable for ${findingPath}`)
      continue
    }
    const problems: string[] = []
    if (expected.sha256 && expected.sha256 !== actual.sha256) problems.push(`sha256 ${expected.sha256} != ${actual.sha256}`)
    if (expected.bytes !== undefined && expected.bytes !== actual.bytes) problems.push(`bytes ${expected.bytes} != ${actual.bytes}`)
    if (problems.length > 0) invalid.push(`${ref}: ${problems.join(", ")}`)
    else checked.push(ref)
  }
  return {
    status: invalid.length > 0 ? "fail" : missingDigest.length > 0 ? "warn" : "pass",
    count: checked.length,
    evidence: sidecarRefs.length === 0
      ? ["receipt_sidecars=0"]
      : [
          `receipt_sidecars=${sidecarRefs.length}`,
          `checked=${checked.length}`,
          `missing_digest=${missingDigest.length}`,
          `invalid=${invalid.length}`,
          ...invalid.slice(0, 10),
          ...missingDigest.slice(0, 10).map((entry) => `missing digest: ${entry}`),
          ...checked.slice(0, 10).map((entry) => `valid digest: ${entry}`),
        ],
  }
}

function isFindingReceiptSidecarRef(ref: string): boolean {
  return ref.endsWith(".receipt.json") || ref === "_receipt.json" || ref.endsWith("/_receipt.json")
}

function acceptanceCriteriaCoverage(criteria: string[], summaryText: string): { missing: string[]; evidence: string[] } {
  const missing: string[] = []
  const covered: string[] = []
  for (const criterion of criteria) {
    const marker = acceptanceCriterionMarker(criterion)
    const matched = marker.kind === "section"
      ? acceptanceSection(summaryText, marker.value).trim().length > 0
      : normalizedIncludes(summaryText, marker.value)
    if (matched) {
      covered.push(criterion)
    } else {
      missing.push(criterion)
    }
  }
  return {
    missing,
    evidence: [
      `criteria=${criteria.length}`,
      `covered=${covered.length}`,
      `missing=${missing.length}`,
      ...missing.slice(0, 10).map((criterion) => `missing: ${criterion}`),
      ...covered.slice(0, 10).map((criterion) => `covered: ${criterion}`),
    ],
  }
}

function acceptanceCriterionMarker(criterion: string): { kind: "section" | "text"; value: string } {
  const phase = /^(A\d+)\b/.exec(criterion.trim())
  if (phase) return { kind: "section", value: phase[1] }
  const label = criterion.split(":")[0]?.trim()
  if (label) return { kind: "text", value: label }
  return { kind: "text", value: criterion.trim().split(/\s+/).slice(0, 6).join(" ") }
}



function effortEvidenceAudit(effort: StackEffort): { ok: boolean; evidence: string[] } {
  const entries = readEffortEvidenceSummaries(effort, { limit: 200 })
  const valid: string[] = []
  const invalid: string[] = []
  for (const entry of entries) {
    const problems: string[] = []
    const path = join(effort.folder_path, ...entry.path.split("/").filter(Boolean))
    if (!isPathInside(effort.folder_path, path) || !existsSync(path)) problems.push("missing evidence artifact")
    if (entry.source_receipt_path) {
      const sidecarPath = join(effort.folder_path, ...entry.source_receipt_path.split("/").filter(Boolean))
      if (!isPathInside(effort.folder_path, sidecarPath) || !existsSync(sidecarPath)) problems.push("missing source receipt sidecar")
      if (entry.source_receipt_kind && entry.source_receipt_kind !== entry.source_kind) {
        problems.push(`receipt source_kind ${entry.source_receipt_kind} does not match ${entry.source_kind}`)
      }
    }
    const summary = `${entry.observed_at} - ${entry.source_kind}: ${entry.path}`
    if (problems.length > 0) invalid.push(`${summary} (${problems.join(", ")})`)
    else valid.push(summary)
  }
  return {
    ok: invalid.length === 0,
    evidence: entries.length === 0
      ? ["evidence_records=0"]
      : [
          `evidence_records=${entries.length}`,
          `valid=${valid.length}`,
          `invalid=${invalid.length}`,
          ...invalid.slice(0, 10),
          ...valid.slice(0, 10).map((entry) => `evidence: ${entry}`),
        ],
  }
}

function effortClaimsAudit(effort: StackEffort): { status: StackEffortAuditStatus; evidence: string[] } {
  const packet = readEffortAcceptancePacket(effort)
  const scopeLanes = effortScopeLanes(effort.manifest)
  const evidence: string[] = []
  let failed = 0
  let open = 0
  let openRequired = 0
  let outOfScope = 0
  for (const claim of effort.manifest.claims) {
    if (!claimInScope(claim, scopeLanes)) {
      outOfScope += 1
      evidence.push(`${claim.label} state=out_of_scope required=${claim.required} (claim lanes: ${(claim.lanes ?? []).join("/")}; scope lanes: ${scopeLanes.join("/") || "none"})`)
      continue
    }
    const state = packet?.levels.find((level) => level.label === claim.label)?.state ?? "missing"
    const evaluation = evaluateEffortClaim(effort, claim)
    evidence.push(`${claim.label} state=${state} required=${claim.required} requirements_met=${evaluation.ok}`)
    evidence.push(...evaluation.satisfied.slice(0, 5).map((line) => `${claim.label} satisfied: ${line}`))
    evidence.push(...evaluation.missing.slice(0, 5).map((line) => `${claim.label} missing: ${line}`))
    if (state === "recorded" && !evaluation.ok) failed += 1
    if (state !== "recorded" && !evaluation.ok) {
      if (claim.required) openRequired += 1
      else open += 1
    }
  }
  return {
    status: failed > 0 ? "fail" : openRequired > 0 ? "warn" : "pass",
    evidence: [`claims=${effort.manifest.claims.length}`, `recorded_unmet=${failed}`, `open_required_unmet=${openRequired}`, `open_optional_unmet=${open}`, `out_of_scope=${outOfScope}`, ...evidence],
  }
}

function effortRefEvidenceLines(refs: StackEffortRef[]): string[] {
  const counts = new Map<string, number>()
  for (const ref of refs) {
    incrementCount(counts, ref.lane ? `${ref.system}/${ref.lane}` : ref.system)
  }
  return Array.from(counts.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([key, count]) => `${key}=${count}`)
}

function acceptanceReceiptAudit(
  acceptance: StackEffortAcceptancePacket,
  activityRecords: StackEffortActivityRecord[],
): { status: StackEffortAuditStatus; evidence: string[] } {
  const acceptanceRecords = activityRecords.filter((record) => record.type === "effort.acceptance_recorded")
  const recordsByLevel = new Map<string, StackEffortActivityRecord[]>()
  for (const record of acceptanceRecords) {
    const payload = asRecord(record.payload)
    const level = readString(payload.level)?.trim().toUpperCase()
    if (!level) continue
    recordsByLevel.set(level, [...(recordsByLevel.get(level) ?? []), record])
  }
  const recordedLevels = acceptance.levels.filter((level) => level.state === "recorded")
  const covered: string[] = []
  const legacyV1: string[] = []
  const missing: string[] = []
  const drift: string[] = []
  for (const [level, records] of recordsByLevel.entries()) {
    const latest = records[records.length - 1]
    if (!latest) continue
    const payload = asRecord(latest.payload)
    const receiptState = readString(payload.state)?.trim()
    const receiptStatus = readString(payload.status)?.trim()
    if (!receiptState || !isAcceptanceUpdateState(receiptState)) continue
    const packetLevel = acceptance.levels.find((entry) => entry.label === level)
    if (!packetLevel) {
      drift.push(`${level}: missing from packet; latest receipt ${latest.observed_at} is ${receiptState}`)
      continue
    }
    if (packetLevel.state !== receiptState || (receiptStatus && packetLevel.status !== receiptStatus)) {
      const receiptLabel = receiptStatus ? `${receiptState}/${receiptStatus}` : receiptState
      drift.push(`${level}: packet ${packetLevel.state}/${packetLevel.status}; latest receipt ${latest.observed_at} ${receiptLabel}`)
    }
  }
  for (const level of recordedLevels) {
    const matchingRecords = (recordsByLevel.get(level.label) ?? []).filter((record) => {
      const payload = asRecord(record.payload)
      return readString(payload.state)?.trim() === "recorded"
    })
    if (matchingRecords.length > 0) {
      const latest = matchingRecords[matchingRecords.length - 1]
      covered.push(`${level.label}: ${latest?.observed_at ?? "recorded"}`)
    } else if (level.required_for_v1) {
      legacyV1.push(`${level.label}: ${level.status}`)
    } else {
      missing.push(`${level.label}: ${level.status}`)
    }
  }
  return {
    status: missing.length === 0 && drift.length === 0 ? "pass" : "fail",
    evidence: [
      `recorded_levels=${recordedLevels.map((level) => level.label).join(",") || "none"}`,
      `acceptance_receipts=${acceptanceRecords.length}`,
      `covered=${covered.length}`,
      `legacy_v1_bootstrap=${legacyV1.length}`,
      `missing=${missing.length}`,
      `drift=${drift.length}`,
      ...covered.slice(0, 10).map((entry) => `receipt: ${entry}`),
      ...legacyV1.slice(0, 10).map((entry) => `legacy v1 bootstrap: ${entry}`),
      ...missing.slice(0, 10).map((entry) => `missing receipt: ${entry}`),
      ...drift.slice(0, 10).map((entry) => `receipt drift: ${entry}`),
    ],
  }
}



function acceptanceLevelLabels(summaryText: string): string[] {
  const labels = new Set<string>()
  const matches = summaryText.matchAll(/^##\s+(A\d+)\b/gm)
  for (const match of matches) {
    if (match[1]) labels.add(match[1])
  }
  return Array.from(labels).sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)))
}

function normalizeAcceptanceLevel(level: string): string {
  const normalized = level.trim().toUpperCase()
  if (!/^A\d+$/.test(normalized)) throw new Error("acceptance level must look like A0, A1, A2, ...")
  return normalized
}

function assertAcceptanceUpdateState(state: string): asserts state is StackEffortAcceptanceUpdateState {
  if (isAcceptanceUpdateState(state)) return
  throw new Error(`acceptance state must be one of ${STACK_EFFORT_ACCEPTANCE_UPDATE_STATES.join(", ")}`)
}

function isAcceptanceUpdateState(state: string): state is StackEffortAcceptanceUpdateState {
  return (STACK_EFFORT_ACCEPTANCE_UPDATE_STATES as readonly string[]).includes(state)
}

function acceptanceUpdateStatus(status: string | undefined, state: StackEffortAcceptanceUpdateState): string {
  const cleaned = status?.trim()
  if (cleaned) {
    const parsedState = acceptanceSectionStatus(`Status: ${cleaned}`).state
    if (parsedState === state) return cleaned
    if (parsedState !== "unknown") {
      throw new Error(`acceptance status text implies ${parsedState}, but state is ${state}`)
    }
    return `${acceptanceUpdateStateLabel(state)} - ${cleaned}`
  }
  if (state === "not_recorded") return "not recorded"
  return state
}

function acceptanceUpdateStateLabel(state: StackEffortAcceptanceUpdateState): string {
  return state === "not_recorded" ? "not recorded" : state
}

function assertAcceptanceUpdateAllowed(
  effort: StackEffort,
  input: {
    level: string
    state: StackEffortAcceptanceUpdateState
  },
): void {
  if (input.state !== "recorded") return
  const claim = effortClaim(effort.manifest, input.level)
  if (!claim || (claim.needs_refs.length === 0 && claim.needs_evidence.length === 0)) return
  if (!claimInScope(claim, effortScopeLanes(effort.manifest))) return
  const evaluation = evaluateEffortClaim(effort, claim)
  if (evaluation.ok) return
  throw new Error(`recorded ${claim.label} acceptance requires the declared claim evidence; missing: ${evaluation.missing.join("; ")}`)
}






function updateAcceptanceSummaryText(
  text: string,
  input: {
    level: string
    state: StackEffortAcceptanceUpdateState
    status: string
    evidence: string[]
    paths: string[]
    result?: string
    decision?: string
    next?: string
    observedAt: string
  },
): string {
  const lines = text.replace(/\s+$/g, "").split(/\r?\n/)
  const heading = new RegExp(`^##\\s+${escapeRegExp(input.level)}\\b`, "i")
  let start = lines.findIndex((line) => heading.test(line))
  if (start < 0) {
    if (lines.length === 1 && !lines[0]) lines.length = 0
    if (lines.length === 0) lines.push("# Acceptance summary")
    if (lines[lines.length - 1]?.trim()) lines.push("")
    lines.push(`## ${input.level} - ${input.level}`, "")
    start = lines.length - 2
  }
  const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line))
  const before = lines.slice(0, start)
  const section = lines.slice(start, end < 0 ? lines.length : end)
  const after = end < 0 ? [] : lines.slice(end)
  const updatedSection = updateAcceptanceSectionLines(section, input)
  return `${[...before, ...updatedSection, ...after].join("\n")}\n`
}

function updateAcceptanceSectionLines(
  section: string[],
  input: {
    level: string
    state: StackEffortAcceptanceUpdateState
    status: string
    evidence: string[]
    paths: string[]
    result?: string
    decision?: string
    next?: string
    observedAt: string
  },
): string[] {
  const lines = section.length > 0 ? [...section] : [`## ${input.level} - ${input.level}`]
  const statusIndex = lines.findIndex((line) => /^Status:\s*/i.test(line))
  if (statusIndex >= 0) {
    lines[statusIndex] = `Status: ${input.status}`
  } else {
    lines.splice(1, 0, "", `Status: ${input.status}`)
  }
  if (lines[lines.length - 1]?.trim()) lines.push("")
  lines.push(`### Stack acceptance update - ${input.observedAt}`, "")
  lines.push(`- State: ${input.state}`)
  if (input.evidence.length > 0) {
    lines.push(...input.evidence.map((entry) => `- Evidence: ${entry}`))
  }
  if (input.paths.length > 0) {
    lines.push(...input.paths.map((entry) => `- Path: ${entry}`))
  }
  if (input.result) lines.push(`- Result: ${input.result}`)
  if (input.decision) lines.push(`- Decision: ${input.decision}`)
  if (input.next) lines.push(`- Next: ${input.next}`)
  return lines
}

function acceptanceSectionHeading(section: string, label: string): string {
  const firstLine = section.split(/\r?\n/).find((line) => line.trim())?.trim() ?? ""
  const match = new RegExp(`^##\\s+${escapeRegExp(label)}\\s*-\\s*(.+)$`, "i").exec(firstLine)
  return match?.[1]?.trim() || label
}

function acceptanceSectionStatus(section: string): { text: string; state: StackEffortAcceptanceLevelState } {
  if (!section.trim()) return { text: "missing", state: "missing" }
  const status = /^Status:\s*(.+)$/im.exec(section)?.[1]?.trim() || "unknown"
  const normalized = normalizeForSearch(status)
  if (/\bnot recorded\b/.test(normalized)) return { text: status, state: "not_recorded" }
  if (/\bpending\b/.test(normalized)) return { text: status, state: "pending" }
  if (/\brecorded\b/.test(normalized)) return { text: status, state: "recorded" }
  return { text: status, state: "unknown" }
}

function acceptancePacketSummary(
  v1Status: StackEffortAcceptancePacket["v1_status"],
  graduationStatus: StackEffortAcceptancePacket["graduation_status"],
  levels: StackEffortAcceptanceLevel[],
): string {
  const levelSummary = levels
    .map((level) => `${level.label} ${acceptanceLevelStateLabel(level.state)}`)
    .join(", ")
  const parts = [`v1 ${v1Status}`]
  if (graduationStatus !== "not_applicable") parts.push(`graduation ${graduationStatus}`)
  if (levelSummary) parts.push(levelSummary)
  return parts.join(" - ")
}

function acceptanceLevelStateLabel(state: StackEffortAcceptanceLevelState): string {
  if (state === "not_recorded") return "not recorded"
  return state.replace(/_/g, " ")
}

function acceptanceSection(summaryText: string, label: string): string {
  const heading = new RegExp(`^##\\s+${escapeRegExp(label)}\\b`, "i")
  const lines = summaryText.split(/\r?\n/)
  const start = lines.findIndex((line) => heading.test(line))
  if (start < 0) return ""
  const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line))
  return lines.slice(start, end < 0 ? lines.length : end).join("\n")
}

function acceptanceSectionIsRecorded(section: string): boolean {
  return acceptanceSectionStatus(section).state === "recorded"
}

function sectionState(section: string): StackEffortAcceptanceLevelState {
  return acceptanceSectionStatus(section).state
}

function normalizedIncludes(text: string, needle: string): boolean {
  return normalizeForSearch(text).includes(normalizeForSearch(needle))
}

function normalizeForSearch(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function metaThreadBacklinkAudit(effort: StackEffort): { missing: string[]; mismatched: string[]; evidence: string[] } {
  const expectedRefs = new Set([effort.manifest.id, effort.manifest.slug])
  const workspaceRoot = inferWorkspaceRoot(effort)
  const metaThreadsRoot = join(workspaceRoot, ".stack", "meta-threads")
  const missing: string[] = []
  const mismatched: string[] = []
  const linked: string[] = []
  for (const id of effort.manifest.links.meta_thread_refs) {
    if (id.includes("/") || id.includes("\\")) {
      missing.push(`${id}: invalid local meta-thread id`)
      continue
    }
    const path = join(metaThreadsRoot, id, "manifest.json")
    if (!existsSync(path)) {
      missing.push(`${id}: missing manifest.json`)
      continue
    }
    const parsed = parseJsonObject(path)
    if (!parsed) {
      missing.push(`${id}: unreadable manifest.json`)
      continue
    }
    const effortRef = readString(parsed.effort_ref)?.trim() ?? ""
    if (expectedRefs.has(effortRef)) {
      linked.push(`${id}: ${effortRef}`)
    } else if (!effortRef) {
      missing.push(`${id}: no effort_ref`)
    } else {
      mismatched.push(`${id}: effort_ref=${effortRef}`)
    }
  }
  return {
    missing,
    mismatched,
    evidence: effort.manifest.links.meta_thread_refs.length === 0
      ? ["no bound meta-threads"]
      : [
          `meta_threads=${effort.manifest.links.meta_thread_refs.length}`,
          `linked=${linked.length}`,
          `missing=${missing.length}`,
          `mismatched=${mismatched.length}`,
          ...mismatched.slice(0, 10).map((entry) => `mismatched: ${entry}`),
          ...missing.slice(0, 10).map((entry) => `missing: ${entry}`),
          ...linked.slice(0, 10).map((entry) => `linked: ${entry}`),
        ],
  }
}

function inferWorkspaceRoot(effort: StackEffort): string {
  const depth = effort.registry.folder_ref.split("/").filter(Boolean).length
  return resolve(effort.folder_path, ...Array.from({ length: depth }, () => ".."))
}

function effortPathFromRef(effort: StackEffort, ref: string): string | undefined {
  const folderRef = joinPathRef(effort.registry.folder_ref)
  const normalized = joinPathRef(ref)
  if (normalized !== folderRef && !normalized.startsWith(`${folderRef}/`)) return undefined
  const rel = normalized === folderRef ? "" : normalized.slice(folderRef.length + 1)
  return join(effort.folder_path, ...rel.split("/").filter(Boolean))
}

function parseJsonObject(path: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown
    return asRecord(parsed)
  } catch {
    return undefined
  }
}

function pathEndsWithNewline(path: string): boolean {
  const text = readFileSync(path, "utf8")
  return text.endsWith("\n")
}

function writeEffortArtifact(input: {
  dir: string
  filename?: string
  title: string
  body?: string
  sourcePath?: string
}): string {
  const filename = input.filename ?? (
    input.sourcePath
      ? basename(resolve(input.sourcePath))
      : `${new Date().toISOString().replace(/[:.]/g, "-")}-${safeFileSegment(input.title)}.md`
  )
  const path = join(input.dir, filename)
  if (existsSync(path)) throw new Error(`effort artifact already exists: ${path}`)
  if (input.sourcePath) {
    const source = resolve(input.sourcePath)
    const stat = statSync(source)
    if (stat.isDirectory()) {
      cpSync(source, path, { recursive: true })
    } else {
      mkdirSync(dirname(path), { recursive: true })
      cpSync(source, path)
    }
    return path
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `# ${input.title.trim()}\n\n${input.body?.trim() ?? ""}\n`, "utf8")
  return path
}

function writeEffortFindingSourceReceipt(
  effortFolderPath: string,
  findingPath: string,
  receipt: StackEffortFindingSourceReceipt | undefined,
): string | undefined {
  if (!receipt) return undefined
  const path = effortFindingSourceReceiptPath(findingPath)
  const payload = {
    schema: "stack/effort/finding-source-receipt/v1",
    receipt,
    recorded_at: new Date().toISOString(),
    finding_path: relative(effortFolderPath, findingPath),
  }
  if (existsSync(path)) {
    const existing = readEffortFindingSourceReceipt(path)
    if (
      existing?.schema === payload.schema &&
      existing.finding_path === payload.finding_path &&
      JSON.stringify(existing.receipt) === JSON.stringify(payload.receipt)
    ) {
      return path
    }
    throw new Error(`effort finding receipt already exists: ${path}`)
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
  return path
}

function localEffortFindingSourceReceipt(sourcePath: string): StackEffortFindingSourceReceipt {
  const stat = statSync(sourcePath)
  const digest = localPathDigest(sourcePath)
  return {
    receipt_path: `local:${sourcePath}`,
    artifact_kind: stat.isDirectory() ? "local_directory" : "local_file",
    source_kind: "local_path",
    environment: "local",
    label: basename(sourcePath),
    workspace_path: sourcePath,
    ...(digest ? { digest } : {}),
  }
}

function localPathDigest(sourcePath: string): { sha256: string; bytes: number } | undefined {
  const stat = statSync(sourcePath)
  if (stat.isFile()) return fileDigestSync(sourcePath)
  if (!stat.isDirectory()) return undefined
  const files: string[] = []
  collectRelativeFiles(sourcePath, sourcePath, files)
  const hash = createHash("sha256")
  let bytes = 0
  for (const rel of files.filter((entry) => !isFindingReceiptSidecarRef(entry)).sort()) {
    const path = join(sourcePath, rel)
    const buffer = readFileSync(path)
    bytes += buffer.length
    hash.update(rel)
    hash.update("\0")
    hash.update(buffer)
    hash.update("\0")
  }
  return { sha256: hash.digest("hex"), bytes }
}

function fileDigestSync(path: string): { sha256: string; bytes: number } {
  const buffer = readFileSync(path)
  return {
    sha256: createHash("sha256").update(buffer).digest("hex"),
    bytes: buffer.length,
  }
}

function readEffortFindingSourceReceipt(path: string): {
  schema?: string
  receipt?: unknown
  finding_path?: string
  recorded_at?: string
} | undefined {
  try {
    const payload = JSON.parse(readFileSync(path, "utf8")) as unknown
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined
    return payload as { schema?: string; receipt?: unknown; finding_path?: string; recorded_at?: string }
  } catch {
    return undefined
  }
}

function normalizeEffortFindingSourceReceipt(value: unknown): StackEffortFindingSourceReceipt | undefined {
  const record = asRecord(value)
  const receiptPath = readString(record.receipt_path)?.trim()
  const workspacePath = readString(record.workspace_path)?.trim()
  if (!receiptPath || !workspacePath) return undefined
  const artifactKind = readString(record.artifact_kind)?.trim()
  const sourceKind = readString(record.source_kind)?.trim()
  const environment = readString(record.environment)?.trim()
  const runId = optionalNullableString(record.run_id)
  const projectId = optionalNullableString(record.project_id)
  const artifactName = optionalNullableString(record.artifact_name)
  const outputId = optionalNullableString(record.output_id)
  const label = optionalNullableString(record.label)
  const pulledAt = readString(record.pulled_at)?.trim()
  const digestRecord = asRecord(record.digest)
  const sha256 = readString(digestRecord.sha256)?.trim()
  const bytes = typeof digestRecord.bytes === "number" ? digestRecord.bytes : undefined
  const digest = sha256 || bytes !== undefined
    ? {
        ...(sha256 ? { sha256 } : {}),
        ...(bytes !== undefined ? { bytes } : {}),
      }
    : undefined
  return {
    receipt_path: receiptPath,
    ...(artifactKind ? { artifact_kind: artifactKind } : {}),
    ...(sourceKind ? { source_kind: sourceKind } : {}),
    ...(environment ? { environment } : {}),
    ...(runId !== undefined ? { run_id: runId } : {}),
    ...(projectId !== undefined ? { project_id: projectId } : {}),
    ...(artifactName !== undefined ? { artifact_name: artifactName } : {}),
    ...(outputId !== undefined ? { output_id: outputId } : {}),
    ...(label !== undefined ? { label } : {}),
    workspace_path: workspacePath,
    ...(digest ? { digest } : {}),
    ...(pulledAt ? { pulled_at: pulledAt } : {}),
  }
}

function effortCaptureSourceReceipt(receipt: StackEffortFindingSourceReceipt, captureKind: StackEffortCaptureKind): StackEffortFindingSourceReceipt {
  return {
    ...receipt,
    source_kind: `${captureKind}_capture`,
  }
}


function evidenceSourceReceipt(receipt: StackEffortFindingSourceReceipt, sourceKind: string): StackEffortFindingSourceReceipt {
  return {
    ...receipt,
    source_kind: sourceKind,
  }
}

function defaultCaptureFindingKind(captureKind: StackEffortCaptureKind): StackEffortFindingKind {
  if (captureKind === "benchmark") return "data"
  if (captureKind === "optimizer") return "proof"
  return "proof"
}

function effortCaptureBody(captureKind: StackEffortCaptureKind, body: string | undefined): string {
  const trimmed = body?.trim()
  return [`Capture kind: ${captureKind}`, "", trimmed || "Captured evidence."].join("\n")
}





function releaseArtifactFieldsFromPath(path: string): {
  version?: string
  channel?: string
  target?: string
  archive?: string
  sha256?: string
  size?: string
  manifest?: string
  releaseSite?: string
  publishable?: boolean
  publishBlockers?: string[]
} {
  try {
    const payload = JSON.parse(readFileSync(path, "utf8")) as unknown
    const record = asRecord(payload)
    const targets = asRecord(record.targets)
    const firstTarget = Object.keys(targets)[0]
    const targetRecord = asRecord(firstTarget ? targets[firstTarget] : undefined)
    const version = readString(record.version)?.trim()
    const channel = readString(record.channel)?.trim()
    const target = readString(record.target)?.trim() || firstTarget
    const archive = readString(record.archive)?.trim() || readString(targetRecord.url)?.trim()
    const sha256 = readString(record.sha256)?.trim() || readString(targetRecord.sha256)?.trim()
    const size = readNumberishString(record.size) || readNumberishString(targetRecord.size)
    const manifest = readString(record.manifest)?.trim()
    const releaseSite = readString(record.release_site)?.trim()
    const publishable = readBoolean(record.publishable)
    const publishBlockers = readStringArray(record.publish_blockers)
    return {
      ...(version ? { version } : {}),
      ...(channel ? { channel } : {}),
      ...(target ? { target } : {}),
      ...(archive ? { archive } : {}),
      ...(sha256 ? { sha256 } : {}),
      ...(size ? { size } : {}),
      ...(manifest ? { manifest } : {}),
      ...(releaseSite ? { releaseSite } : {}),
      ...(publishable !== undefined ? { publishable } : {}),
      ...(publishBlockers.length > 0 ? { publishBlockers } : {}),
    }
  } catch {
    return {}
  }
}

function readEngineeringGitSnapshot(repoPath: string, baseRef: string | undefined): {
  changedFiles: string[]
  diffStat: string
  status: { ok: boolean; message: string }
} {
  const repo = resolve(repoPath)
  if (!existsSync(repo) || !statSync(repo).isDirectory()) {
    return {
      changedFiles: [],
      diffStat: "",
      status: { ok: false, message: `repo path is not a directory: ${repoPath}` },
    }
  }
  const statusResult = runGit(repo, ["status", "--short"])
  const base = baseRef?.trim()
  const diffResult = runGit(repo, base ? ["diff", "--stat", base, "--"] : ["diff", "--stat", "HEAD", "--"])
  const changedFiles = base
    ? parseGitNameStatus(runGit(repo, ["diff", "--name-status", base, "--"]).stdout)
    : parseGitStatusFiles(statusResult.stdout)
  const ok = statusResult.ok && diffResult.ok
  return {
    changedFiles,
    diffStat: diffResult.stdout,
    status: {
      ok,
      message: ok ? "git diff captured" : [statusResult.stderr, diffResult.stderr].filter(Boolean).join("; ") || "git diff unavailable",
    },
  }
}

function emptyEngineeringGitSnapshot(): {
  changedFiles: string[]
  diffStat: string
  status: { ok: boolean; message: string }
} {
  return {
    changedFiles: [],
    diffStat: "",
    status: { ok: true, message: "manual packet" },
  }
}

function runGit(repoPath: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["git", "-C", repoPath, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })
  return {
    ok: result.success,
    stdout: decodeProcessOutput(result.stdout),
    stderr: decodeProcessOutput(result.stderr).trim(),
  }
}

function decodeProcessOutput(output: Uint8Array | string | null | undefined): string {
  if (!output) return ""
  if (typeof output === "string") return output
  return new TextDecoder().decode(output)
}

function parseGitStatusFiles(output: string): string[] {
  return uniqueStrings(output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => line.length > 3 ? line.slice(3).trim() : "")
    .filter(Boolean)
    .map((file) => file.includes(" -> ") ? file.split(" -> ").pop()?.trim() ?? file : file))
}

function parseGitNameStatus(output: string): string[] {
  return uniqueStrings(output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\t+/).filter(Boolean).pop()?.trim() ?? "")
    .filter(Boolean))
}

function optionalNullableString(value: unknown): string | null | undefined {
  if (value === null) return null
  const string = readString(value)?.trim()
  return string || undefined
}

function effortFindingSourceReceiptPath(findingPath: string): string {
  if (existsSync(findingPath) && statSync(findingPath).isDirectory()) {
    return join(findingPath, "_receipt.json")
  }
  return `${findingPath}.receipt.json`
}

function writeEffortRepoPointer(input: {
  dir: string
  filename?: string
  title: string
  sourcePath: string
  repoRef?: string
}): string {
  const filename = input.filename ?? `${new Date().toISOString().replace(/[:.]/g, "-")}-${safeFileSegment(input.title)}.md`
  const path = join(input.dir, filename)
  const text = effortRepoPointerMarkdown(input)
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") === text) return path
    throw new Error(`effort artifact already exists: ${path}`)
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text, "utf8")
  return path
}

function effortRepoPointerMarkdown(input: {
  title: string
  sourcePath: string
  repoRef?: string
}): string {
  return [
    `# ${input.title.trim()}`,
    "",
    `Source path: ${input.sourcePath}`,
    input.repoRef ? `Repo ref: ${input.repoRef}` : "",
    "",
    "This record points at a local repo or worktree. Stack records the pointer instead of recursively copying the directory.",
    "",
  ].filter((line, index, lines) => line || lines[index - 1] !== "").join("\n")
}

function resolveExistingEffortPath(effortFolderPath: string, path: string): string | undefined {
  const direct = resolve(path)
  if (existsSync(direct)) return direct
  const inEffort = resolve(effortFolderPath, path)
  if (existsSync(inEffort)) return inEffort
  return undefined
}

function isPathInside(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path))
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

function isExistingDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function safeReadText(path: string): string {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return ""
  }
}

function findingDirName(kind: StackEffortFindingKind): string {
  if (kind === "result") return "results"
  return kind === "idea" ? "ideas" : kind
}


function assertEffortStatus(status: string): asserts status is StackEffortStatus {
  if (!STACK_EFFORT_STATUSES.includes(status as StackEffortStatus)) {
    throw new Error(`unsupported effort status: ${status}`)
  }
}

function assertFindingKind(kind: string): asserts kind is StackEffortFindingKind {
  if (!STACK_EFFORT_FINDING_KINDS.includes(kind as StackEffortFindingKind)) {
    throw new Error(`unsupported effort finding kind: ${kind}`)
  }
}

function assertCaptureKind(kind: string): asserts kind is StackEffortCaptureKind {
  if (!STACK_EFFORT_CAPTURE_KINDS.includes(kind as StackEffortCaptureKind)) {
    throw new Error(`unsupported effort capture kind: ${kind}`)
  }
}

function normalizeRunEvidenceKind(kind: string): string {
  const cleaned = kind.trim().toLowerCase()
  if (!/^[a-z][a-z0-9_-]*$/.test(cleaned)) {
    throw new Error(`run evidence kind must be a lowercase identifier like smr, tinker, or local: ${kind}`)
  }
  return cleaned
}

function assertIdeaOrigin(origin: string): asserts origin is StackEffortIdeaOrigin {
  if (!STACK_EFFORT_IDEA_ORIGINS.includes(origin as StackEffortIdeaOrigin)) {
    throw new Error(`unsupported effort idea origin: ${origin}`)
  }
}

function assertNoteKind(kind: string): asserts kind is StackEffortNoteKind {
  if (!STACK_EFFORT_NOTE_KINDS.includes(kind as StackEffortNoteKind)) {
    throw new Error(`unsupported effort note kind: ${kind}`)
  }
}

function safeSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (!slug) throw new Error("effort slug is required")
  return slug
}

function safeFileSegment(value: string): string {
  const safe = safeSlug(value).slice(0, 80)
  return safe || "untitled"
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function tomlString(value: string): string {
  return JSON.stringify(value)
}

function tomlArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function readNumberishString(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return undefined
}

function cleanOptional(value: string | undefined): string | undefined {
  return value === undefined ? undefined : value.trim()
}

function requireString(value: unknown, label: string): string {
  const string = readString(value)?.trim()
  if (!string) throw new Error(`${label} is required`)
  return string
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean)
}
