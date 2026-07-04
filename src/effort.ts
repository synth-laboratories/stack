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

export const STACK_EFFORT_IDEA_ORIGINS = ["HUMAN", "AGENT", "MIXED"] as const
export type StackEffortIdeaOrigin = (typeof STACK_EFFORT_IDEA_ORIGINS)[number]

export const STACK_EFFORT_NOTE_KINDS = ["human", "note"] as const
export type StackEffortNoteKind = (typeof STACK_EFFORT_NOTE_KINDS)[number]

export type StackEffortLinks = {
  meta_thread_refs: string[]
  repo_refs: string[]
  initiative_id: string
}

export type StackEffortHostedRefs = {
  factory_id: string
  effort_id: string
  project_id: string
  optimizer_run_ids: string[]
  smr_run_ids: string[]
  tinker_run_ids: string[]
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
  hosted: StackEffortHostedRefs
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
  hosted_refs: StackEffortHostedRefs
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
    optimizer_runs: number
    smr_runs: number
    tinker_runs: number
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
  hosted_refs: StackEffortHostedRefs
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

export type WriteEffortHandoffInput = EffortLookupInput & {
  effortRef: string
  summary?: string
  next?: string
  risks?: string[]
  owner?: string
}

export type UpdateEffortRefsInput = EffortLookupInput & {
  effortRef: string
  factoryId?: string
  hostedEffortId?: string
  projectId?: string
  optimizerRunId?: string
  smrRunId?: string
  tinkerRunId?: string
  repoRef?: string
  initiativeId?: string
}

type EffortTemplateDefaults = {
  acceptanceCriteria: string[]
}

const RESEARCH_TEMPLATES = new Set(["research", "system-optimizer", "task-classifier", "task-agentic", "task-nonverifiable"])

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
  ensureEffortDirs(folderPath, RESEARCH_TEMPLATES.has(template))

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
    hosted: emptyHostedRefs(),
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
    hosted_refs: manifest.hosted,
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
    hosted_refs: normalizeHostedRefs(record.hosted_refs),
    updated_at: record.updated_at,
  }))
}

export function readEffort(input: EffortLookupInput, effortRef: string): StackEffort | undefined {
  const record = findRegistryRecord(input.stackDataRoot, effortRef)
  if (!record) return undefined
  record.hosted_refs = normalizeHostedRefs(record.hosted_refs)
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
  const inventory = {
    generated,
    ideas: effortRelativeFiles(effort, "ideas"),
    human: effortRelativeFiles(effort, "human"),
    notes: effortRelativeFiles(effort, "notes"),
    repos: effortRelativeFiles(effort, "repos"),
    findings,
    receipt_sidecars: receiptSidecars,
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

export function readEffortBlockerTail(effort: StackEffort, limit = 5): StackEffortBlockerRecord[] {
  const records = readEffortActivityRecords(effort)
    .map(effortBlockerFromActivity)
    .filter((record): record is StackEffortBlockerRecord => Boolean(record))
  return records.slice(Math.max(0, records.length - limit))
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
  const researchRequired = RESEARCH_TEMPLATES.has(effort.manifest.template)
  const researchLogPath = join(effort.folder_path, "research_log.md")
  check(
    "research_log",
    !researchRequired || existsSync(researchLogPath) ? "pass" : "fail",
    researchRequired
      ? existsSync(researchLogPath)
        ? "Research-derived Effort has a research_log.md."
        : "Research-derived Effort is missing research_log.md."
      : "Template does not require a research log.",
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
  const activityTail = readEffortActivityTail(effort, 200)
  const blockerTail = readEffortBlockerTail(effort, 20)
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
  const promotedIdeaBacklinks = promotedIdeaBacklinkAudit(effort, findingFiles.ideas)
  check(
    "promoted_idea_backlinks",
    promotedIdeaBacklinks.missing.length === 0 ? "pass" : "warn",
    promotedIdeaBacklinks.missing.length === 0 ? "Promoted idea findings link back to raw idea files." : "Some promoted idea findings do not link back to a raw origin idea.",
    promotedIdeaBacklinks.evidence,
  )
  const handoffPath = join(effort.folder_path, "HANDOFF.md")
  const handoffText = existsSync(handoffPath) ? safeReadText(handoffPath) : ""
  const handoffMissing: string[] = []
  if (!handoffText.includes("## Latest Activity")) handoffMissing.push("Latest Activity")
  if (blockerTail.length > 0 && !handoffText.includes("## Recorded Blockers")) handoffMissing.push("Recorded Blockers")
  if (paths.acceptance_summary && !handoffText.includes("## Acceptance Packet")) handoffMissing.push("Acceptance Packet")
  if (!handoffText.includes("## Audit")) handoffMissing.push("Audit")
  check(
    "handoff_packet",
    existsSync(handoffPath) && handoffMissing.length === 0 ? "pass" : effort.manifest.acceptance.criteria.length > 0 ? "fail" : "warn",
    existsSync(handoffPath) && handoffMissing.length === 0 ? "Generated handoff packet contains required orientation sections." : "Generated handoff packet is missing or incomplete.",
    [
      existsSync(handoffPath) ? joinPathRef(effort.registry.folder_ref, "HANDOFF.md") : "missing HANDOFF.md",
      ...handoffMissing.map((section) => `missing section: ${section}`),
    ],
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
    if (effort.manifest.template === "task-classifier") {
      const v1Bar = taskClassifierV1BarAudit(effort, acceptanceSummaryText, findingFiles, researchLogPath)
      check(
        "task_classifier_v1_bar",
        v1Bar.ok ? "pass" : "fail",
        v1Bar.ok ? "Task-classifier v1 bar is proved by A0/A1 evidence." : "Task-classifier v1 bar is missing A0/A1 evidence.",
        v1Bar.evidence,
      )
      const graduation = taskClassifierGraduationAudit(effort, acceptanceSummaryText)
      check(
        "task_classifier_graduation_refs",
        graduation.ok ? "pass" : "fail",
        graduation.ok ? "Hosted/SMR/Tinker graduation refs are either absent or covered by recorded acceptance sections." : "Hosted/SMR/Tinker refs exist without recorded acceptance sections.",
        graduation.evidence,
      )
    }
  }
  const repoRefCount = effort.manifest.links.repo_refs.length
  const hostedRefCount = effort.manifest.hosted.optimizer_run_ids.length + effort.manifest.hosted.smr_run_ids.length + effort.manifest.hosted.tinker_run_ids.length
  check(
    "refs",
    repoRefCount > 0 || hostedRefCount > 0 || effort.manifest.links.meta_thread_refs.length > 0 ? "pass" : "warn",
    repoRefCount > 0 || hostedRefCount > 0 || effort.manifest.links.meta_thread_refs.length > 0 ? "Effort has thread, repo, or run refs." : "No thread, repo, or run refs are recorded yet.",
    [
      `meta_threads=${effort.manifest.links.meta_thread_refs.length}`,
      `repo_refs=${repoRefCount}`,
      `optimizer_runs=${effort.manifest.hosted.optimizer_run_ids.length}`,
      `smr_runs=${effort.manifest.hosted.smr_run_ids.length}`,
      `tinker_runs=${effort.manifest.hosted.tinker_run_ids.length}`,
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
      optimizer_runs: effort.manifest.hosted.optimizer_run_ids.length,
      smr_runs: effort.manifest.hosted.smr_run_ids.length,
      tinker_runs: effort.manifest.hosted.tinker_run_ids.length,
      findings: {
        ideas: findingFiles.ideas.length,
        code: findingFiles.code.length,
        data: findingFiles.data.length,
        proof: findingFiles.proof.length,
        results: findingFiles.results.length,
      },
    },
    latest_blocker: blockerTail[blockerTail.length - 1] ?? null,
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

export function updateEffortRefs(input: UpdateEffortRefsInput): StackEffort {
  const effort = requireEffort(input, input.effortRef)
  const changes: string[] = []
  const factoryId = cleanOptional(input.factoryId)
  const hostedEffortId = cleanOptional(input.hostedEffortId)
  const projectId = cleanOptional(input.projectId)
  const optimizerRunId = cleanOptional(input.optimizerRunId)
  const smrRunId = cleanOptional(input.smrRunId)
  const tinkerRunId = cleanOptional(input.tinkerRunId)
  const repoRef = cleanOptional(input.repoRef)
  const initiativeId = cleanOptional(input.initiativeId)

  if (factoryId !== undefined && effort.manifest.hosted.factory_id !== factoryId) {
    effort.manifest.hosted.factory_id = factoryId
    changes.push(`factory_id=${factoryId || "<cleared>"}`)
  }
  if (hostedEffortId !== undefined && effort.manifest.hosted.effort_id !== hostedEffortId) {
    effort.manifest.hosted.effort_id = hostedEffortId
    changes.push(`hosted_effort_id=${hostedEffortId || "<cleared>"}`)
  }
  if (projectId !== undefined && effort.manifest.hosted.project_id !== projectId) {
    effort.manifest.hosted.project_id = projectId
    changes.push(`project_id=${projectId || "<cleared>"}`)
  }
  if (optimizerRunId && !effort.manifest.hosted.optimizer_run_ids.includes(optimizerRunId)) {
    effort.manifest.hosted.optimizer_run_ids = uniqueStrings([...effort.manifest.hosted.optimizer_run_ids, optimizerRunId])
    changes.push(`optimizer_run_id=${optimizerRunId}`)
  }
  if (smrRunId && !effort.manifest.hosted.smr_run_ids.includes(smrRunId)) {
    effort.manifest.hosted.smr_run_ids = uniqueStrings([...effort.manifest.hosted.smr_run_ids, smrRunId])
    changes.push(`smr_run_id=${smrRunId}`)
  }
  if (tinkerRunId && !effort.manifest.hosted.tinker_run_ids.includes(tinkerRunId)) {
    effort.manifest.hosted.tinker_run_ids = uniqueStrings([...effort.manifest.hosted.tinker_run_ids, tinkerRunId])
    changes.push(`tinker_run_id=${tinkerRunId}`)
  }
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
    hosted_refs: effort.manifest.hosted,
    repo_refs: effort.manifest.links.repo_refs,
    initiative_id: effort.manifest.links.initiative_id,
  })
  return persistEffort(input, effort)
}

export function recordEffortFinding(input: RecordEffortFindingInput): { effort: StackEffort; path: string; sourceReceiptPath?: string } {
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
    return { effort: persistEffort(input, effort), path: linkedPath, sourceReceiptPath }
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
  return { effort: persistEffort(input, effort), path, sourceReceiptPath }
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
  const hosted = asRecord(parsed.hosted)
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
    hosted: {
      factory_id: readString(hosted.factory_id) ?? "",
      effort_id: readString(hosted.effort_id) ?? "",
      project_id: readString(hosted.project_id) ?? "",
      optimizer_run_ids: readStringArray(hosted.optimizer_run_ids),
      smr_run_ids: readStringArray(hosted.smr_run_ids),
      tinker_run_ids: readStringArray(hosted.tinker_run_ids),
    },
    acceptance: {
      criteria: readStringArray(acceptance.criteria),
    },
  }
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
  effort.registry.hosted_refs = effort.manifest.hosted
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
    "[hosted]",
    `factory_id = ${tomlString(manifest.hosted.factory_id)}`,
    `effort_id = ${tomlString(manifest.hosted.effort_id)}`,
    `project_id = ${tomlString(manifest.hosted.project_id)}`,
    `optimizer_run_ids = ${tomlArray(manifest.hosted.optimizer_run_ids)}`,
    `smr_run_ids = ${tomlArray(manifest.hosted.smr_run_ids)}`,
    `tinker_run_ids = ${tomlArray(manifest.hosted.tinker_run_ids)}`,
    "",
    "[acceptance]",
    `criteria = ${tomlArray(manifest.acceptance.criteria)}`,
    "",
  ].join("\n")
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
    hosted: normalizeHostedRefs(record.hosted_refs),
    acceptance: { criteria: [] },
  }
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
  if (!existsSync(path)) return { acceptanceCriteria: [] }
  try {
    const parsed = Bun.TOML.parse(readFileSync(path, "utf8")) as Record<string, unknown>
    const acceptance = asRecord(parsed.acceptance)
    return { acceptanceCriteria: readStringArray(acceptance.criteria) }
  } catch {
    return { acceptanceCriteria: [] }
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
  const risks = cleanStringList(input.risks)
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
    ...bulletLines("Optimizer runs", effort.manifest.hosted.optimizer_run_ids),
    ...bulletLines("SMR runs", effort.manifest.hosted.smr_run_ids),
    ...bulletLines("Tinker runs", effort.manifest.hosted.tinker_run_ids),
  ]
  if (effort.manifest.hosted.factory_id) lines.push(`- Factory: ${effort.manifest.hosted.factory_id}`)
  if (effort.manifest.hosted.project_id) lines.push(`- Project: ${effort.manifest.hosted.project_id}`)
  if (effort.manifest.hosted.effort_id) lines.push(`- Hosted Effort: ${effort.manifest.hosted.effort_id}`)
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
    acceptancePacket
      ? `- Summary: ${acceptancePacket}`
      : "- No acceptance summary recorded at findings/results/acceptance-summary.md.",
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
    ...limitedArtifactLines(artifactInventory.receipt_sidecars),
    "",
  )
  lines.push(
    "## Risks And Open Threads",
    "",
    ...(risks.length > 0 ? risks.map((risk) => `- ${risk}`) : ["- No risks recorded in this handoff packet."]),
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
    `Counts: progress=${audit.counts.progress_entries}, activity=${audit.counts.activity_receipts}, blockers=${audit.counts.blockers}, repos=${audit.counts.repo_refs}, optimizer=${audit.counts.optimizer_runs}, smr=${audit.counts.smr_runs}, tinker=${audit.counts.tinker_runs}`,
  ]
  if (audit.latest_blocker) {
    lines.push(`Latest blocker: ${audit.latest_blocker.blocker} | owner=${audit.latest_blocker.owner} | next=${audit.latest_blocker.next}`)
  }
  for (const check of audit.checks) {
    lines.push(`- ${check.status} ${check.id}: ${check.summary}`)
  }
  return lines
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
  return records.map((record) => `- ${record.observed_at} - ${record.blocker} Evidence: ${record.evidence}. Owner: ${record.owner}. Next safe action: ${record.next}.`)
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

function bulletLines(label: string, values: string[]): string[] {
  return values.length > 0 ? values.map((value) => `- ${label}: ${value}`) : [`- ${label}: none recorded`]
}

function limitedArtifactLines(paths: string[]): string[] {
  if (paths.length === 0) return ["- None recorded."]
  const shown = paths.slice(0, 20).map((path) => `- ${path}`)
  if (paths.length > shown.length) shown.push(`- ... ${paths.length - shown.length} more`)
  return shown
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

function isFindingReceiptSidecarRef(ref: string): boolean {
  return ref.endsWith(".receipt.json") || ref.endsWith("/_receipt.json")
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

function taskClassifierV1BarAudit(
  effort: StackEffort,
  summaryText: string,
  findingFiles: Record<"ideas" | "code" | "data" | "proof" | "results", string[]>,
  researchLogPath: string,
): { ok: boolean; evidence: string[] } {
  const a0 = acceptanceSection(summaryText, "A0")
  const a1 = acceptanceSection(summaryText, "A1")
  const humanContextCount = effortRelativeFiles(effort, "human").length + effortRelativeFiles(effort, "ideas").filter((path) => basename(path).startsWith("[HUMAN]-")).length
  const researchLog = existsSync(researchLogPath) ? researchLogShape(researchLogPath) : { ok: false, evidence: ["missing research_log.md"] }
  const a0Ok = acceptanceSectionIsRecorded(a0)
    && effort.manifest.links.meta_thread_refs.length > 0
    && humanContextCount > 0
    && existsSync(join(effort.folder_path, "HANDOFF.md"))
  const a1Ok = acceptanceSectionIsRecorded(a1)
    && effort.manifest.hosted.optimizer_run_ids.length > 0
    && findingFiles.code.length > 0
    && findingFiles.data.length > 0
    && findingFiles.proof.length > 0
    && researchLog.ok
    && /candidate/i.test(a1)
    && /heldout/i.test(a1)
    && /research log/i.test(a1)
  return {
    ok: a0Ok && a1Ok,
    evidence: [
      `A0_section=${sectionState(a0)}`,
      `A0_meta_threads=${effort.manifest.links.meta_thread_refs.length}`,
      `A0_human_context=${humanContextCount}`,
      `A0_handoff=${existsSync(join(effort.folder_path, "HANDOFF.md")) ? "present" : "missing"}`,
      `A1_section=${sectionState(a1)}`,
      `A1_optimizer_runs=${effort.manifest.hosted.optimizer_run_ids.length}`,
      `A1_code_findings=${findingFiles.code.length}`,
      `A1_data_findings=${findingFiles.data.length}`,
      `A1_proof_findings=${findingFiles.proof.length}`,
      `A1_mentions_candidate=${/candidate/i.test(a1)}`,
      `A1_mentions_heldout=${/heldout/i.test(a1)}`,
      `A1_mentions_research_log=${/research log/i.test(a1)}`,
      `research_log_shape=${researchLog.ok ? "pass" : "missing_or_weak"}`,
    ],
  }
}

function taskClassifierGraduationAudit(effort: StackEffort, summaryText: string): { ok: boolean; evidence: string[] } {
  const checks = [
    {
      label: "A2",
      required: Boolean(effort.manifest.hosted.factory_id || effort.manifest.hosted.project_id || effort.manifest.hosted.effort_id),
      refs: [
        effort.manifest.hosted.factory_id ? `factory=${effort.manifest.hosted.factory_id}` : "",
        effort.manifest.hosted.project_id ? `project=${effort.manifest.hosted.project_id}` : "",
        effort.manifest.hosted.effort_id ? `hosted_effort=${effort.manifest.hosted.effort_id}` : "",
      ].filter(Boolean),
    },
    {
      label: "A3",
      required: effort.manifest.hosted.smr_run_ids.length > 0,
      refs: effort.manifest.hosted.smr_run_ids.map((id) => `smr=${id}`),
    },
    {
      label: "A4",
      required: effort.manifest.hosted.tinker_run_ids.length > 0,
      refs: effort.manifest.hosted.tinker_run_ids.map((id) => `tinker=${id}`),
    },
  ]
  const evidence: string[] = []
  let ok = true
  for (const check of checks) {
    const section = acceptanceSection(summaryText, check.label)
    const recorded = acceptanceSectionIsRecorded(section)
    if (check.required && !recorded) ok = false
    evidence.push(`${check.label}_required=${check.required}`)
    evidence.push(`${check.label}_section=${sectionState(section)}`)
    evidence.push(...(check.refs.length > 0 ? check.refs : [`${check.label}_refs=none`]))
  }
  return { ok, evidence }
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
  return section.trim().length > 0 && !/^Status:\s*not recorded\b/im.test(section)
}

function sectionState(section: string): "missing" | "not_recorded" | "recorded" {
  if (!section.trim()) return "missing"
  return acceptanceSectionIsRecorded(section) ? "recorded" : "not_recorded"
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
} | undefined {
  try {
    const payload = JSON.parse(readFileSync(path, "utf8")) as unknown
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined
    return payload as { schema?: string; receipt?: unknown; finding_path?: string }
  } catch {
    return undefined
  }
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

function emptyHostedRefs(): StackEffortHostedRefs {
  return {
    factory_id: "",
    effort_id: "",
    project_id: "",
    optimizer_run_ids: [],
    smr_run_ids: [],
    tinker_run_ids: [],
  }
}

function normalizeHostedRefs(refs: Partial<StackEffortHostedRefs> | undefined): StackEffortHostedRefs {
  return {
    factory_id: refs?.factory_id ?? "",
    effort_id: refs?.effort_id ?? "",
    project_id: refs?.project_id ?? "",
    optimizer_run_ids: uniqueStrings(refs?.optimizer_run_ids ?? []),
    smr_run_ids: uniqueStrings(refs?.smr_run_ids ?? []),
    tinker_run_ids: uniqueStrings(refs?.tinker_run_ids ?? []),
  }
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
