import { createHash } from "node:crypto"
import { spawn, spawnSync } from "node:child_process"
import {
  appendFileSync,
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
  type Dirent,
} from "node:fs"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import type { StackConfig } from "./config.js"
import { recordEffortArtifact } from "./effort.js"
import {
  publishHostedArtifact,
  publishHostedArtifactPublic,
  type PublishHostedArtifactResult,
} from "./remote/research.js"
import { bundledDefaultsRoot } from "./seed/defaults.js"

export const ARTIFACT_SITE_HOST = "127.0.0.1"
export const ARTIFACT_SITE_PORT = 3008
export const STACK_ARTIFACT_KINDS = ["result", "analysis", "bloglet", "blog"] as const

export type StackArtifactKind = (typeof STACK_ARTIFACT_KINDS)[number]

export type StackArtifactHostedEnvironment = {
  hosted_artifact_id?: string
  hosted_url?: string
  canonical_url?: string
  public_url?: string
  public_slug?: string
  cloud_visibility?: string
  artifact_version?: number
}

export type StackArtifactManifestEntry = {
  schema: "stack/artifact-page/v1"
  slug: string
  title: string
  kind: StackArtifactKind
  effort?: string
  created_at: string
  updated_at: string
  sha256: string
  page_path: string
  data_path: string
  html_path?: string
  local_url: string
  hosted_artifact_id?: string
  hosted_url?: string
  canonical_url?: string
  public_url?: string
  public_slug?: string
  cloud_visibility?: string
  artifact_version?: number
  compiled_sha256?: string
  compiled_bytes?: number
  publish_consent?: boolean
  splits_cited?: string[]
  hosted_environments?: Record<string, StackArtifactHostedEnvironment>
}

export type StackArtifactWriteRequest = {
  slug: string
  title?: string
  kind?: string
  effort?: string
  pagePath?: string
  htmlPath?: string
  dataPath?: string
  htmlContent?: string
  data?: unknown
  update?: boolean
}

export type StackArtifactWriteResult = {
  artifact: StackArtifactManifestEntry
  artifactsRoot: string
  siteDir: string
  pagePath: string
  dataPath: string
  htmlPath?: string
  localUrl: string
  served: StackArtifactServeResult
}

export type StackArtifactServeResult = {
  ok: boolean
  running: boolean
  started: boolean
  url: string
  siteDir: string
  logPath: string
  pid?: number
  message: string
}

export type StackArtifactStatus = {
  ok: boolean
  running: boolean
  port: number
  host: string
  url: string
  galleryUrl: string
  siteDir: string
  artifactsRoot: string
  manifestPath: string
  manifestEntries: number
  artifacts: StackArtifactManifestEntry[]
  pid?: number
  logPath: string
  message: string
}

export type StackArtifactCompileResult = {
  artifact: StackArtifactManifestEntry
  html: string
  sha256: string
  bytes: number
  warnings: string[]
}

export type StackArtifactLintResult = {
  ok: boolean
  errors: string[]
  warnings: string[]
  artifact?: StackArtifactManifestEntry
  sha256?: string
  bytes?: number
}

export type StackArtifactPublishRequest = {
  slug: string
  visibility?: "private" | "org" | "public"
  projectId?: string
  hostedEffortId?: string
  sourceRunIds?: string[]
  traceId?: string
  publicSlug?: string
  confirmPublish?: boolean
  confirmPublic?: boolean
}

export type StackArtifactPublishResult = {
  ok: boolean
  status: number
  message: string
  artifact: StackArtifactManifestEntry
  hosted?: PublishHostedArtifactResult
  public?: PublishHostedArtifactResult
  lint: StackArtifactLintResult
  receipt: string | null
  evidencePath?: string
  evidenceError?: string
}

type ArtifactSiteProbe = {
  running: boolean
  occupied: boolean
  message: string
}

const ARTIFACT_SITE_SCHEMA = "stack.artifacts-site.v1"
const ARTIFACT_SITE_START_ATTEMPTS = 120
const ARTIFACT_SITE_START_DELAY_MS = 500
const ARTIFACT_HTML_WARN_BYTES = 2 * 1024 * 1024
const ARTIFACT_HTML_MAX_BYTES = 4 * 1024 * 1024

export function artifactLocalUrl(slug: string): string {
  return `${artifactSiteBaseUrl()}/a/${encodeURIComponent(slug)}`
}

export function artifactSiteBaseUrl(): string {
  return `http://${ARTIFACT_SITE_HOST}:${ARTIFACT_SITE_PORT}`
}

export function artifactGalleryUrl(): string {
  return artifactSiteBaseUrl()
}

export function artifactsRoot(config: StackConfig): string {
  return join(config.stackDataRoot, ".stack", "artifacts")
}

export function artifactSiteDir(config: StackConfig): string {
  return join(artifactsRoot(config), "site")
}

export function artifactManifestPath(config: StackConfig): string {
  return join(artifactsRoot(config), "manifest.jsonl")
}

export function artifactRuntimeDir(config: StackConfig): string {
  return join(config.stackDataRoot, ".stack", "runtime")
}

export function artifactSiteLogPath(config: StackConfig): string {
  return join(artifactRuntimeDir(config), "artifacts-site.log")
}

export function artifactSitePidPath(config: StackConfig): string {
  return join(artifactRuntimeDir(config), "artifacts-site.pid")
}

export function readArtifactManifestEntries(config: StackConfig): StackArtifactManifestEntry[] {
  const path = artifactManifestPath(config)
  if (!existsSync(path)) return []
  const entries: StackArtifactManifestEntry[] = []
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as Partial<StackArtifactManifestEntry>
      if (parsed.schema === "stack/artifact-page/v1" && parsed.slug && parsed.title) {
        entries.push(parsed as StackArtifactManifestEntry)
      }
    } catch {
      continue
    }
  }
  return entries
}

export function readLatestArtifacts(config: StackConfig): StackArtifactManifestEntry[] {
  const bySlug = new Map<string, StackArtifactManifestEntry>()
  for (const entry of readArtifactManifestEntries(config)) bySlug.set(entry.slug, entry)
  return [...bySlug.values()].sort((left, right) => right.updated_at.localeCompare(left.updated_at))
}

export async function readArtifactStatus(config: StackConfig): Promise<StackArtifactStatus> {
  ensureArtifactWorkspace(config)
  const manifestEntries = readArtifactManifestEntries(config)
  const artifacts = readLatestArtifacts(config)
  const probe = await probeArtifactSite()
  const pid = readArtifactSitePid(config)
  return {
    ok: probe.running,
    running: probe.running,
    port: ARTIFACT_SITE_PORT,
    host: ARTIFACT_SITE_HOST,
    url: artifactSiteBaseUrl(),
    galleryUrl: artifactGalleryUrl(),
    siteDir: artifactSiteDir(config),
    artifactsRoot: artifactsRoot(config),
    manifestPath: artifactManifestPath(config),
    manifestEntries: manifestEntries.length,
    artifacts,
    ...(pid ? { pid } : {}),
    logPath: artifactSiteLogPath(config),
    message: probe.message,
  }
}

export async function serveArtifactSite(config: StackConfig): Promise<StackArtifactServeResult> {
  ensureArtifactWorkspace(config)
  installArtifactSiteDependencies(config)
  const siteDir = artifactSiteDir(config)
  const logPath = artifactSiteLogPath(config)
  const url = artifactSiteBaseUrl()
  const probe = await probeArtifactSite()
  if (probe.running) {
    return {
      ok: true,
      running: true,
      started: false,
      url,
      siteDir,
      logPath,
      ...(readArtifactSitePid(config) ? { pid: readArtifactSitePid(config) } : {}),
      message: "Artifact Site already running.",
    }
  }
  if (probe.occupied) {
    return {
      ok: false,
      running: false,
      started: false,
      url,
      siteDir,
      logPath,
      message: probe.message,
    }
  }

  mkdirSync(dirname(logPath), { recursive: true })
  const logFd = openSync(logPath, "a")
  const child = spawn("bun", ["x", "next", "dev", "-p", String(ARTIFACT_SITE_PORT), "-H", ARTIFACT_SITE_HOST], {
    cwd: siteDir,
    detached: true,
    env: { ...process.env, STACK_ARTIFACTS_ROOT: artifactsRoot(config) },
    stdio: ["ignore", logFd, logFd],
  })
  child.unref()
  closeSync(logFd)
  if (child.pid) {
    writeFileSync(artifactSitePidPath(config), `${child.pid}\n`, "utf8")
    writeFileSync(
      join(artifactRuntimeDir(config), "artifacts-site.json"),
      `${JSON.stringify({
        pid: child.pid,
        site_dir: siteDir,
        url,
        log_path: logPath,
        started_at: new Date().toISOString(),
      }, null, 2)}\n`,
      "utf8",
    )
  }

  for (let attempt = 0; attempt < ARTIFACT_SITE_START_ATTEMPTS; attempt += 1) {
    await sleep(ARTIFACT_SITE_START_DELAY_MS)
    const nextProbe = await probeArtifactSite()
    if (nextProbe.running) {
      return {
        ok: true,
        running: true,
        started: true,
        url,
        siteDir,
        logPath,
        ...(child.pid ? { pid: child.pid } : {}),
        message: "Artifact Site started.",
      }
    }
  }

  return {
    ok: false,
    running: false,
    started: true,
    url,
    siteDir,
    logPath,
    ...(child.pid ? { pid: child.pid } : {}),
    message: `Artifact Site did not become healthy within 60s; see ${logPath}`,
  }
}

export async function stopArtifactSite(config: StackConfig): Promise<StackArtifactServeResult> {
  ensureArtifactWorkspace(config)
  const pid = readArtifactSitePid(config)
  const siteDir = artifactSiteDir(config)
  const logPath = artifactSiteLogPath(config)
  const url = artifactSiteBaseUrl()
  if (!pid) {
    return { ok: true, running: false, started: false, url, siteDir, logPath, message: "No Artifact Site pidfile." }
  }
  if (!processAlive(pid)) {
    removeArtifactPid(config)
    return { ok: true, running: false, started: false, url, siteDir, logPath, message: "Removed stale Artifact Site pidfile." }
  }
  try {
    process.kill(pid, "SIGTERM")
  } catch (error) {
    return {
      ok: false,
      running: true,
      started: false,
      url,
      siteDir,
      logPath,
      pid,
      message: error instanceof Error ? error.message : String(error),
    }
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(250)
    if (!processAlive(pid)) {
      removeArtifactPid(config)
      return { ok: true, running: false, started: false, url, siteDir, logPath, pid, message: "Artifact Site stopped." }
    }
  }
  return { ok: false, running: true, started: false, url, siteDir, logPath, pid, message: "Artifact Site still running after SIGTERM." }
}

export async function writeArtifactPage(config: StackConfig, request: StackArtifactWriteRequest): Promise<StackArtifactWriteResult> {
  ensureArtifactWorkspace(config)
  const slug = normalizeArtifactSlug(request.slug)
  const existing = readLatestArtifacts(config).find((entry) => entry.slug === slug)
  if (!request.update && existing) {
    throw new Error(`artifact ${slug} already exists; use stack artifacts update ${slug}`)
  }
  if (request.update && !existing) {
    throw new Error(`artifact ${slug} does not exist; use stack artifacts create ${slug}`)
  }
  const contentSources = [request.pagePath, request.htmlPath, request.htmlContent].filter((value) => value !== undefined)
  if (contentSources.length > 1) throw new Error("provide pagePath, htmlPath, or htmlContent, not more than one")
  if (!request.update && !request.title?.trim()) throw new Error("create requires --title")
  if (!request.update && contentSources.length === 0) throw new Error("create requires pagePath, htmlPath, or htmlContent")
  if (request.dataPath && request.data !== undefined) throw new Error("provide dataPath or data, not both")

  const now = new Date().toISOString()
  const title = (request.title ?? existing?.title ?? titleFromSlug(slug)).trim()
  const kind = normalizeArtifactKind(request.kind ?? existing?.kind)
  const effort = normalizeOptionalString(request.effort ?? existing?.effort)
  const pageDir = join(artifactSiteDir(config), "app", "a", slug)
  const dataDir = join(artifactsRoot(config), "data", slug)
  mkdirSync(pageDir, { recursive: true })
  mkdirSync(dataDir, { recursive: true })

  const dataPath = join(dataDir, "data.json")
  if (request.data !== undefined) {
    writeFileSync(dataPath, `${JSON.stringify(request.data, null, 2)}\n`, "utf8")
  } else if (request.dataPath) {
    const source = resolveWorkspacePath(config, request.dataPath)
    const dataText = readFileSync(source, "utf8")
    JSON.parse(dataText)
    writeFileSync(dataPath, dataText.endsWith("\n") ? dataText : `${dataText}\n`, "utf8")
  } else if (!existsSync(dataPath)) {
    writeFileSync(dataPath, "{}\n", "utf8")
  }

  let htmlPath = existing?.html_path ? join(artifactsRoot(config), existing.html_path) : undefined
  if (request.htmlPath || request.htmlContent !== undefined) {
    const htmlText = request.htmlContent !== undefined
      ? request.htmlContent
      : readFileSync(resolveWorkspacePath(config, request.htmlPath!), "utf8")
    htmlPath = join(dataDir, "index.html")
    writeFileSync(htmlPath, htmlText, "utf8")
    writeFileSync(join(pageDir, "page.tsx"), htmlPassthroughPageSource(slug), "utf8")
  } else if (request.pagePath) {
    const source = resolveWorkspacePath(config, request.pagePath)
    cpSync(source, join(pageDir, "page.tsx"))
    htmlPath = undefined
  }

  const pagePath = join(pageDir, "page.tsx")
  if (!existsSync(pagePath)) throw new Error(`artifact page missing for ${slug}`)
  const sha256 = artifactDigest([pagePath, dataPath, ...(htmlPath ? [htmlPath] : [])])
  const entry: StackArtifactManifestEntry = {
    schema: "stack/artifact-page/v1",
    slug,
    title,
    kind,
    ...(effort ? { effort } : {}),
    created_at: existing?.created_at ?? now,
    updated_at: now,
    sha256,
    page_path: relative(artifactsRoot(config), pagePath),
    data_path: relative(artifactsRoot(config), dataPath),
    ...(htmlPath ? { html_path: relative(artifactsRoot(config), htmlPath) } : {}),
    local_url: artifactLocalUrl(slug),
    ...(existing?.hosted_artifact_id ? { hosted_artifact_id: existing.hosted_artifact_id } : {}),
    ...(existing?.hosted_url ? { hosted_url: existing.hosted_url } : {}),
    ...(existing?.canonical_url ? { canonical_url: existing.canonical_url } : {}),
    ...(existing?.public_url ? { public_url: existing.public_url } : {}),
    ...(existing?.public_slug ? { public_slug: existing.public_slug } : {}),
    ...(existing?.cloud_visibility ? { cloud_visibility: existing.cloud_visibility } : {}),
    ...(existing?.artifact_version ? { artifact_version: existing.artifact_version } : {}),
    ...(existing?.compiled_sha256 ? { compiled_sha256: existing.compiled_sha256 } : {}),
    ...(existing?.compiled_bytes ? { compiled_bytes: existing.compiled_bytes } : {}),
    ...(existing?.publish_consent ? { publish_consent: existing.publish_consent } : {}),
    ...(existing?.splits_cited ? { splits_cited: existing.splits_cited } : {}),
    ...(existing?.hosted_environments ? { hosted_environments: existing.hosted_environments } : {}),
  }
  appendFileSync(artifactManifestPath(config), `${JSON.stringify(entry)}\n`, "utf8")
  const served = await serveArtifactSite(config)
  return {
    artifact: entry,
    artifactsRoot: artifactsRoot(config),
    siteDir: artifactSiteDir(config),
    pagePath,
    dataPath,
    ...(htmlPath ? { htmlPath } : {}),
    localUrl: entry.local_url,
    served,
  }
}

export function lintArtifact(config: StackConfig, slugInput: string): StackArtifactLintResult {
  ensureArtifactWorkspace(config)
  const slug = normalizeArtifactSlug(slugInput)
  const artifact = readLatestArtifacts(config).find((entry) => entry.slug === slug)
  const errors: string[] = []
  const warnings: string[] = []
  if (!artifact) {
    return { ok: false, errors: [`artifact ${slug} not found`], warnings }
  }
  const pagePath = join(artifactsRoot(config), artifact.page_path)
  const dataPath = join(artifactsRoot(config), artifact.data_path)
  if (!existsSync(pagePath)) errors.push(`missing page ${artifact.page_path}`)
  if (!existsSync(dataPath)) errors.push(`missing data ${artifact.data_path}`)
  if (existsSync(dataPath) && statSync(dataPath).size > 4 * 1024 * 1024) {
    errors.push(`data file exceeds 4 MiB: ${artifact.data_path}`)
  }
  if (existsSync(pagePath)) {
    lintArtifactSource(readFileSync(pagePath, "utf8"), errors, { requireReceipt: !artifact.html_path })
  }
  if (artifact.html_path) {
    const htmlPath = join(artifactsRoot(config), artifact.html_path)
    if (!existsSync(htmlPath)) errors.push(`missing html ${artifact.html_path}`)
    else lintArtifactHtml(readFileSync(htmlPath, "utf8"), errors)
  }
  if (errors.length > 0) return { ok: false, errors, warnings, artifact }
  try {
    const compiled = compileArtifact(config, slug)
    warnings.push(...compiled.warnings)
    lintArtifactHtml(compiled.html, errors)
    lintArtifactSize(compiled.bytes, errors, warnings)
    return {
      ok: errors.length === 0,
      errors,
      warnings,
      artifact,
      sha256: compiled.sha256,
      bytes: compiled.bytes,
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
    return { ok: false, errors, warnings, artifact }
  }
}

export function compileArtifact(config: StackConfig, slugInput: string): StackArtifactCompileResult {
  ensureArtifactWorkspace(config)
  installArtifactSiteDependencies(config)
  const slug = normalizeArtifactSlug(slugInput)
  const artifact = readLatestArtifacts(config).find((entry) => entry.slug === slug)
  if (!artifact) throw new Error(`artifact ${slug} not found`)
  const dataPath = join(artifactsRoot(config), artifact.data_path)
  const dataText = existsSync(dataPath) ? readFileSync(dataPath, "utf8") : "{}"
  JSON.parse(dataText)
  const css = readArtifactCss(config)
  let bodyHtml: string
  if (artifact.html_path) {
    const htmlPath = join(artifactsRoot(config), artifact.html_path)
    if (!existsSync(htmlPath)) throw new Error(`missing html ${artifact.html_path}`)
    bodyHtml = normalizeHtmlBody(readFileSync(htmlPath, "utf8"))
  } else {
    bodyHtml = renderArtifactPageToMarkup(config, artifact, dataText)
  }
  const html = artifactHtmlDocument({
    title: artifact.title,
    bodyHtml,
    css,
    dataText,
    artifact,
  })
  const bytes = Buffer.byteLength(html, "utf8")
  const sha256 = createHash("sha256").update(html).digest("hex")
  const warnings: string[] = []
  if (bytes > ARTIFACT_HTML_WARN_BYTES && bytes <= ARTIFACT_HTML_MAX_BYTES) {
    warnings.push(`compiled HTML is ${bytes} bytes; keep artifact pages under 2 MiB when practical`)
  }
  return { artifact, html, sha256, bytes, warnings }
}

export async function publishArtifact(
  config: StackConfig,
  request: StackArtifactPublishRequest,
): Promise<StackArtifactPublishResult> {
  const slug = normalizeArtifactSlug(request.slug)
  const lint = lintArtifact(config, slug)
  const artifact = lint.artifact
  if (!artifact) {
    return { ok: false, status: 0, message: `artifact ${slug} not found`, artifact: missingArtifact(slug), lint, receipt: null }
  }
  if (!lint.ok) {
    return { ok: false, status: 0, message: "artifact lint failed", artifact, lint, receipt: null }
  }
  const hostedEnvironment = hostedArtifactEnvironment(config, artifact)
  if (!artifact.publish_consent && !hostedEnvironment.hosted_artifact_id && !request.confirmPublish) {
    return {
      ok: false,
      status: 0,
      message: "first publish requires operator confirmation; pass confirm_publish=true",
      artifact,
      lint,
      receipt: null,
    }
  }
  const compiled = compileArtifact(config, slug)
  const hosted = await publishHostedArtifact(config, {
    title: artifact.title,
    htmlContent: compiled.html,
    visibility: request.visibility ?? "org",
    projectId: request.projectId,
    effortId: request.hostedEffortId,
    hostedArtifactId: hostedEnvironment.hosted_artifact_id,
    sourceRunIds: request.sourceRunIds,
    traceId: request.traceId,
    slugHint: slug,
  })
  if (!hosted.ok) {
    return { ok: false, status: hosted.status, message: hosted.message, artifact, hosted, lint, receipt: null }
  }
  const updated = appendArtifactManifestPatch(config, slug, {
    ...hostedManifestPatch(config, artifact, {
      hosted_artifact_id: hosted.hostedArtifactId,
      hosted_url: hosted.hostedUrl,
      canonical_url: hosted.canonicalUrl,
      artifact_version: hosted.artifactVersion,
      cloud_visibility: hosted.visibility,
    }),
    compiled_sha256: compiled.sha256,
    compiled_bytes: compiled.bytes,
    publish_consent: true,
  })
  const evidence = request.publicSlug ? {} : recordArtifactEvidenceIfBound(config, updated, compiled.sha256, request)
  return {
    ok: true,
    status: hosted.status,
    message: "published",
    artifact: updated,
    hosted,
    lint,
    receipt: `RECEIPT PASS hosted_artifact_id=${hosted.hostedArtifactId} version=${hosted.artifactVersion ?? updated.artifact_version ?? 1} hosted_url=${hosted.hostedUrl ?? hosted.canonicalUrl}`,
    ...(evidence.path ? { evidencePath: evidence.path } : {}),
    ...(evidence.error ? { evidenceError: evidence.error } : {}),
  }
}

export async function shareArtifact(
  config: StackConfig,
  request: StackArtifactPublishRequest,
): Promise<StackArtifactPublishResult> {
  const published = await publishArtifact(config, request)
  if (!published.ok || !published.hosted?.hostedArtifactId) return published
  if (!request.publicSlug) return published
  if (!request.confirmPublic) {
    return {
      ...published,
      ok: false,
      status: 0,
      message: "public share requires --confirm-public",
      receipt: null,
    }
  }
  const publicResult = await publishHostedArtifactPublic(config, published.hosted.hostedArtifactId, {
    slug: request.publicSlug,
    kind: published.artifact.kind,
    effortId: request.hostedEffortId,
  })
  if (!publicResult.ok) {
    return {
      ...published,
      ok: false,
      status: publicResult.status,
      message: publicResult.message,
      public: publicResult,
      receipt: null,
    }
  }
  const updated = appendArtifactManifestPatch(config, published.artifact.slug, hostedManifestPatch(config, published.artifact, {
    public_url: publicResult.publicUrl,
    public_slug: publicResult.slug ?? request.publicSlug,
    hosted_artifact_id: publicResult.hostedArtifactId ?? published.hosted.hostedArtifactId,
    hosted_url: publicResult.hostedUrl ?? published.artifact.hosted_url,
    canonical_url: publicResult.canonicalUrl ?? published.artifact.canonical_url,
    artifact_version: publicResult.artifactVersion ?? published.artifact.artifact_version,
  }))
  const evidence = recordArtifactEvidenceIfBound(config, updated, updated.compiled_sha256, request)
  return {
    ...published,
    ok: true,
    status: publicResult.status,
    message: "shared",
    artifact: updated,
    public: publicResult,
    receipt: `RECEIPT PASS hosted_artifact_id=${updated.hosted_artifact_id} public_url=${updated.public_url}`,
    ...(evidence.path ? { evidencePath: evidence.path } : {}),
    ...(evidence.error ? { evidenceError: evidence.error } : {}),
  }
}

function appendArtifactManifestPatch(
  config: StackConfig,
  slugInput: string,
  patch: Partial<StackArtifactManifestEntry>,
): StackArtifactManifestEntry {
  const slug = normalizeArtifactSlug(slugInput)
  const existing = readLatestArtifacts(config).find((entry) => entry.slug === slug)
  if (!existing) throw new Error(`artifact ${slug} not found`)
  const entry: StackArtifactManifestEntry = {
    ...existing,
    ...dropUndefinedFields(patch),
    updated_at: new Date().toISOString(),
  }
  appendFileSync(artifactManifestPath(config), `${JSON.stringify(entry)}\n`, "utf8")
  return entry
}

function hostedArtifactEnvironment(
  config: StackConfig,
  artifact: StackArtifactManifestEntry,
): StackArtifactHostedEnvironment {
  const environment = artifact.hosted_environments?.[config.environmentName]
  if (environment?.hosted_artifact_id) return environment
  if (config.environmentName === "dev") return legacyHostedEnvironment(artifact) ?? {}
  return {}
}

function hostedManifestPatch(
  config: StackConfig,
  artifact: StackArtifactManifestEntry,
  patch: StackArtifactHostedEnvironment,
): Partial<StackArtifactManifestEntry> {
  const cleaned = dropUndefinedFields({ ...patch })
  const hostedEnvironments: Record<string, StackArtifactHostedEnvironment> = {
    ...(artifact.hosted_environments ?? {}),
  }
  const legacy = legacyHostedEnvironment(artifact)
  if (legacy && !hostedEnvironments.dev) hostedEnvironments.dev = legacy
  hostedEnvironments[config.environmentName] = dropUndefinedFields({
    ...(hostedEnvironments[config.environmentName] ?? {}),
    ...cleaned,
  })
  return {
    ...cleaned,
    hosted_environments: hostedEnvironments,
  }
}

function legacyHostedEnvironment(artifact: StackArtifactManifestEntry): StackArtifactHostedEnvironment | undefined {
  if (!artifact.hosted_artifact_id) return undefined
  return dropUndefinedFields({
    hosted_artifact_id: artifact.hosted_artifact_id,
    hosted_url: artifact.hosted_url,
    canonical_url: artifact.canonical_url,
    public_url: artifact.public_url,
    public_slug: artifact.public_slug,
    cloud_visibility: artifact.cloud_visibility,
    artifact_version: artifact.artifact_version,
  })
}

function recordArtifactEvidenceIfBound(
  config: StackConfig,
  artifact: StackArtifactManifestEntry,
  sha256: string | undefined,
  request: StackArtifactPublishRequest,
): { path?: string; error?: string } {
  if (!artifact.effort) return {}
  try {
    const result = recordEffortArtifact({
      ...config,
      effortRef: artifact.effort,
      slug: artifact.slug,
      title: artifact.title,
      localUrl: artifact.local_url,
      hostedUrl: artifact.hosted_url,
      publicUrl: artifact.public_url,
      hostedArtifactId: artifact.hosted_artifact_id,
      artifactVersion: artifact.artifact_version ? String(artifact.artifact_version) : undefined,
      sha256,
      splitsCited: artifact.splits_cited ?? [],
      sourcePath: join(artifactsRoot(config), artifact.page_path),
      filename: artifact.hosted_artifact_id && artifact.artifact_version
        ? `${artifact.slug}-${config.environmentName}-artifact-page-v${artifact.artifact_version}.tsx`
        : undefined,
      body: [
        `Artifact Site page published from local slug ${artifact.slug}.`,
        request.publicSlug ? `Public slug requested: ${request.publicSlug}.` : "",
      ].filter(Boolean).join("\n"),
    })
    return { path: result.path }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

function renderArtifactPageToMarkup(
  config: StackConfig,
  artifact: StackArtifactManifestEntry,
  dataText: string,
): string {
  const siteDir = artifactSiteDir(config)
  const runtimeDir = artifactRuntimeDir(config)
  mkdirSync(runtimeDir, { recursive: true })
  const token = `${artifact.slug}-${process.pid}-${Date.now()}`
  const scriptPath = join(siteDir, `.stack-artifact-compile-${token}.mjs`)
  const outputPath = join(runtimeDir, `artifact-compile-${token}.html`)
  const dataPath = join(artifactsRoot(config), artifact.data_path)
  const pagePath = join(artifactsRoot(config), artifact.page_path)
  writeFileSync(scriptPath, artifactCompileScript(pagePath, dataPath, outputPath), "utf8")
  const result = spawnSync("bun", [scriptPath], {
    cwd: siteDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      STACK_ARTIFACT_COMPILE_DATA: dataText,
    },
    encoding: "utf8",
  })
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim()
    throw new Error(
      `artifact ${artifact.slug} failed static render; provide --html fallback. ${detail}`.trim(),
    )
  }
  if (!existsSync(outputPath)) throw new Error(`artifact ${artifact.slug} compiler did not write HTML`)
  return readFileSync(outputPath, "utf8")
}

function artifactCompileScript(pagePath: string, dataPath: string, outputPath: string): string {
  return `import { readFileSync, writeFileSync } from "node:fs"
import { renderToStaticMarkup } from "react-dom/server"

const mod = await import(${JSON.stringify(pathToFileURL(pagePath).href)})
const Page = mod.default
if (typeof Page !== "function") throw new Error("artifact page default export must be a function")
const data = JSON.parse(readFileSync(${JSON.stringify(dataPath)}, "utf8"))
const rendered = Page({ data })
const element = rendered && typeof rendered.then === "function" ? await rendered : rendered
writeFileSync(${JSON.stringify(outputPath)}, renderToStaticMarkup(element), "utf8")
`
}

function artifactHtmlDocument(input: {
  title: string
  bodyHtml: string
  css: string
  dataText: string
  artifact: StackArtifactManifestEntry
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="stack-artifact-slug" content="${escapeHtml(input.artifact.slug)}">
<title>${escapeHtml(input.title)}</title>
<style>${input.css}</style>
</head>
<body>
<div class="artifact-shell"><div class="artifact-container">${input.bodyHtml}</div></div>
<script type="application/json" id="artifact-data">${escapeScriptJson(input.dataText)}</script>
</body>
</html>
`
}

function normalizeHtmlBody(html: string): string {
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)
  if (bodyMatch?.[1]) return bodyMatch[1]
  return html
}

function readArtifactCss(config: StackConfig): string {
  const cssPath = join(artifactSiteDir(config), "app", "globals.css")
  return existsSync(cssPath) ? readFileSync(cssPath, "utf8") : ""
}

function lintArtifactSource(source: string, errors: string[], options: { requireReceipt: boolean }): void {
  lintExternalRequests(source, errors)
  if (options.requireReceipt && !source.includes("ReceiptFooter") && !source.includes("data-artifact-receipt")) {
    errors.push("artifact page must include ReceiptFooter or data-artifact-receipt")
  }
  for (const match of source.matchAll(/<StatTile[\s\S]*?(?:\/>|<\/StatTile>)/g)) {
    const chunk = match[0]
    if (/(score|accuracy|f1|eval|metric|pass@|reward)/i.test(chunk) && !/(split|SplitBadge)/i.test(chunk)) {
      errors.push("score-like StatTile entries must name their split")
      break
    }
  }
}

function lintArtifactHtml(html: string, errors: string[]): void {
  lintExternalRequests(html, errors)
  if (!/(sha256|receipts?|data-artifact-receipt)/i.test(html)) {
    errors.push("compiled artifact must include a receipt footer with sha256 or receipt fields")
  }
}

function lintArtifactSize(bytes: number, errors: string[], warnings: string[]): void {
  if (bytes > ARTIFACT_HTML_MAX_BYTES) {
    errors.push(`compiled HTML exceeds 4 MiB: ${bytes} bytes`)
  } else if (bytes > ARTIFACT_HTML_WARN_BYTES) {
    warnings.push(`compiled HTML exceeds 2 MiB: ${bytes} bytes`)
  }
}

function lintExternalRequests(text: string, errors: string[]): void {
  if (/\b(?:src|poster|action|formaction)\s*=\s*["']https?:\/\//i.test(text)) {
    errors.push("artifact pages may not load external http(s) resources")
  }
  if (/<(?!a\b)[^>]+\bhref\s*=\s*["']https?:\/\//i.test(text)) {
    errors.push("artifact pages may not load external http(s) href resources outside anchors")
  }
  if (/url\(\s*["']?https?:\/\//i.test(text)) {
    errors.push("artifact CSS may not load external http(s) resources")
  }
}

function missingArtifact(slug: string): StackArtifactManifestEntry {
  const now = new Date().toISOString()
  return {
    schema: "stack/artifact-page/v1",
    slug,
    title: slug,
    kind: "result",
    created_at: now,
    updated_at: now,
    sha256: "",
    page_path: "",
    data_path: "",
    local_url: artifactLocalUrl(slug),
  }
}

function dropUndefinedFields<T extends Record<string, unknown>>(value: T): T {
  const cleaned: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) cleaned[key] = entry
  }
  return cleaned as T
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function escapeScriptJson(value: string): string {
  return value.replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")
}

export function ensureArtifactWorkspace(config: StackConfig): void {
  mkdirSync(artifactsRoot(config), { recursive: true })
  mkdirSync(join(artifactsRoot(config), "data"), { recursive: true })
  mkdirSync(artifactRuntimeDir(config), { recursive: true })
  if (!existsSync(artifactManifestPath(config))) writeFileSync(artifactManifestPath(config), "", "utf8")
  ensureArtifactSiteScaffold(config)
}

function ensureArtifactSiteScaffold(config: StackConfig): void {
  const source = join(bundledDefaultsRoot(config.appRoot), "artifacts-site")
  if (!existsSync(source)) throw new Error(`missing bundled Artifact Site scaffold: ${source}`)
  copyTreeIfMissing(source, artifactSiteDir(config))
  mkdirSync(join(artifactSiteDir(config), "app", "a"), { recursive: true })
}

function installArtifactSiteDependencies(config: StackConfig): void {
  const siteDir = artifactSiteDir(config)
  if (existsSync(join(siteDir, "node_modules", "next"))) return
  const result = spawnSync("bun", ["install"], {
    cwd: siteDir,
    env: process.env,
    stdio: "inherit",
  })
  if (result.status !== 0) {
    throw new Error(`Artifact Site dependency install failed in ${siteDir}`)
  }
}

function copyTreeIfMissing(source: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  let entries: Dirent[]
  try {
    entries = readdirSync(source, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const srcPath = join(source, entry.name)
    const dstPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      copyTreeIfMissing(srcPath, dstPath)
      continue
    }
    if (entry.isFile() && !existsSync(dstPath)) cpSync(srcPath, dstPath)
  }
}

async function probeArtifactSite(): Promise<ArtifactSiteProbe> {
  try {
    const response = await fetch(`${artifactSiteBaseUrl()}/api/health`, { signal: AbortSignal.timeout(1000) })
    const text = await response.text()
    let payload: Record<string, unknown> | undefined
    try {
      payload = JSON.parse(text) as Record<string, unknown>
    } catch {
      payload = undefined
    }
    if (response.ok && payload?.schema === ARTIFACT_SITE_SCHEMA && payload?.ok === true) {
      return { running: true, occupied: false, message: "Artifact Site is healthy." }
    }
    return {
      running: false,
      occupied: true,
      message: `Port ${ARTIFACT_SITE_PORT} responded but is not the Artifact Site.`,
    }
  } catch {
    return { running: false, occupied: false, message: "Artifact Site is not running." }
  }
}

function readArtifactSitePid(config: StackConfig): number | undefined {
  const path = artifactSitePidPath(config)
  if (!existsSync(path)) return undefined
  const pid = Number(readFileSync(path, "utf8").trim())
  return Number.isInteger(pid) && pid > 0 ? pid : undefined
}

function removeArtifactPid(config: StackConfig): void {
  for (const path of [artifactSitePidPath(config), join(artifactRuntimeDir(config), "artifacts-site.json")]) {
    if (existsSync(path)) unlinkSync(path)
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function normalizeArtifactSlug(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  if (!slug) throw new Error("artifact slug is required")
  return slug.slice(0, 120)
}

function normalizeArtifactKind(value: string | undefined): StackArtifactKind {
  const normalized = (value ?? "result").trim().toLowerCase()
  return STACK_ARTIFACT_KINDS.includes(normalized as StackArtifactKind) ? normalized as StackArtifactKind : "result"
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function resolveWorkspacePath(config: StackConfig, path: string): string {
  return isAbsolute(path) ? path : resolve(config.workingDir, path)
}

function artifactDigest(paths: string[]): string {
  const hash = createHash("sha256")
  for (const path of paths) {
    hash.update(basename(path))
    hash.update("\0")
    hash.update(readFileSync(path))
    hash.update("\0")
  }
  return hash.digest("hex")
}

function htmlPassthroughPageSource(slug: string): string {
  return `import { readFileSync } from "node:fs"
import { join } from "node:path"

export default function ArtifactHtmlPage() {
  const html = readFileSync(join(process.cwd(), "..", "data", ${JSON.stringify(slug)}, "index.html"), "utf8")
  return <main className="artifact-html-page" dangerouslySetInnerHTML={{ __html: html }} />
}
`
}

function titleFromSlug(slug: string): string {
  return slug.split("-").filter(Boolean).map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" ") || "Artifact"
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
