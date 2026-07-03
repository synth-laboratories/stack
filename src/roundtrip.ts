import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path"
import type { StackConfig } from "./config.js"
import {
  readRemoteDownloadHistory,
  uploadRemoteRunFile,
  type RemoteDownloadRecord,
  type RemoteActionResult,
} from "./remote/actions.js"
import {
  downloadHostedOptimizerArtifact,
  readHostedOptimizerSnapshot,
} from "./remote/optimizers.js"

export const ROUND_TRIP_ARTIFACT_KINDS = [
  "champion_prompt",
  "adapter_weights",
  "dataset",
  "eval_table",
] as const

export type RoundTripArtifactKind = (typeof ROUND_TRIP_ARTIFACT_KINDS)[number]
export type RoundTripSourceKind = "hosted_optimizer" | "saved_download" | "local_file"
export type RoundTripApplyMode = "toml-string-field" | "replace-file"
export type RoundTripFileVisibility = "model" | "verifier"

export type RoundTripResult = {
  ok: boolean
  status: number
  message: string
  data?: Record<string, unknown>
}

export type PullRoundTripArtifactOptions = {
  artifactKind: RoundTripArtifactKind
  sourceKind?: RoundTripSourceKind
  runId?: string
  projectId?: string
  artifactName?: string
  sourcePath?: string
  savedDownloadPath?: string
  outputId?: string
  index?: number
  destinationPath?: string
  receiptPath?: string
}

export type ApplyRoundTripArtifactOptions = {
  artifactKind: RoundTripArtifactKind
  artifactPath?: string
  receiptPath?: string
  targetPath: string
  mode?: RoundTripApplyMode
  tomlField?: string
  promptJsonPath?: string
  createMissing?: boolean
}

export type PushRoundTripArtifactOptions = {
  artifactKind: RoundTripArtifactKind
  artifactPath?: string
  receiptPath?: string
  runId: string
  remotePath?: string
  visibility?: RoundTripFileVisibility
  contentType?: string
}

type FileFingerprint = {
  sha256: string
  bytes: number
}

type SourceSelection = {
  sourceKind: RoundTripSourceKind
  sourcePath: string
  runId?: string
  projectId?: string
  artifactName?: string
  outputId?: string
  contentType?: string
  label?: string
  downloadedAt?: string
}

type RoundTripPullReceipt = {
  schema_version: "stack.roundtrip.receipt.v1"
  action: "pull"
  artifact_kind: RoundTripArtifactKind
  source_kind: RoundTripSourceKind
  environment: string
  api_base_url: string
  run_id?: string
  project_id?: string
  artifact_name?: string
  output_id?: string
  label?: string
  content_type?: string
  source_path: string
  workspace_path: string
  digest: FileFingerprint
  git_sha_at_pull?: string
  pulled_at: string
}

const DEFAULT_PROMPT_FIELD = "seed_candidate.stage2_system"

export function isRoundTripArtifactKind(value: string): value is RoundTripArtifactKind {
  return (ROUND_TRIP_ARTIFACT_KINDS as readonly string[]).includes(value)
}

export async function pullRoundTripArtifact(
  config: StackConfig,
  options: PullRoundTripArtifactOptions,
): Promise<RoundTripResult> {
  const source = await resolveSource(config, options)
  if (!("selection" in source)) return source
  const selection = source.selection
  const sourceDigest = await fingerprintFile(selection.sourcePath)
  const destinationPath = resolveWorkspaceWritePath(
    config,
    options.destinationPath,
    defaultPulledArtifactPath(config, options.artifactKind, selection),
  )
  await mkdir(dirname(destinationPath), { recursive: true })
  await copyFile(selection.sourcePath, destinationPath)
  const destinationDigest = await fingerprintFile(destinationPath)
  if (destinationDigest.sha256 !== sourceDigest.sha256) {
    return {
      ok: false,
      status: 0,
      message: "copied artifact digest does not match source digest",
      data: {
        source_path: selection.sourcePath,
        destination_path: destinationPath,
        source_digest: sourceDigest,
        destination_digest: destinationDigest,
      },
    }
  }
  const pullGitSha = gitShaForConfig(config)

  const receipt: RoundTripPullReceipt = {
    schema_version: "stack.roundtrip.receipt.v1",
    action: "pull",
    artifact_kind: options.artifactKind,
    source_kind: selection.sourceKind,
    environment: config.environmentName,
    api_base_url: config.environment.apiBaseUrl,
    ...(selection.runId ? { run_id: selection.runId } : {}),
    ...(selection.projectId ? { project_id: selection.projectId } : {}),
    ...(selection.artifactName ? { artifact_name: selection.artifactName } : {}),
    ...(selection.outputId ? { output_id: selection.outputId } : {}),
    ...(selection.label ? { label: selection.label } : {}),
    ...(selection.contentType ? { content_type: selection.contentType } : {}),
    source_path: selection.sourcePath,
    workspace_path: destinationPath,
    digest: destinationDigest,
    ...(pullGitSha ? { git_sha_at_pull: pullGitSha } : {}),
    pulled_at: new Date().toISOString(),
  }
  const receiptPath = await writeRoundTripReceipt(config, receipt, options.receiptPath)
  return {
    ok: true,
    status: 0,
    message: `pulled ${options.artifactKind} to ${destinationPath}`,
    data: {
      artifact_kind: options.artifactKind,
      source_kind: selection.sourceKind,
      environment: config.environmentName,
      run_id: selection.runId ?? null,
      artifact_name: selection.artifactName ?? null,
      output_id: selection.outputId ?? null,
      path: destinationPath,
      receipt_path: receiptPath,
      digest: destinationDigest,
    },
  }
}

export async function applyRoundTripArtifact(
  config: StackConfig,
  options: ApplyRoundTripArtifactOptions,
): Promise<RoundTripResult> {
  if (options.artifactKind !== "champion_prompt") {
    return {
      ok: false,
      status: 0,
      message: "apply currently supports artifact_kind=champion_prompt only",
    }
  }
  const pullReceipt = options.receiptPath ? await readPullReceipt(config, options.receiptPath) : undefined
  const artifactPath = resolveWorkspaceReadPath(config, options.artifactPath ?? pullReceipt?.workspace_path)
  const targetPath = resolveWorkspaceWritePath(config, options.targetPath)
  const artifactBytes = await readFile(artifactPath, "utf8")
  const extracted = extractChampionPrompt(artifactBytes, options.promptJsonPath)
  if (!extracted.prompt.trim()) {
    return {
      ok: false,
      status: 0,
      message: "champion prompt artifact did not contain non-empty prompt text",
    }
  }

  const beforeDigest = await fingerprintIfExists(targetPath)
  const mode = options.mode ?? "toml-string-field"
  let previousValue: string | undefined
  if (mode === "replace-file") {
    await mkdir(dirname(targetPath), { recursive: true })
    await writeFile(targetPath, extracted.prompt.endsWith("\n") ? extracted.prompt : `${extracted.prompt}\n`, "utf8")
  } else {
    const existing = await readFile(targetPath, "utf8")
    const patched = patchTomlStringField(
      existing,
      options.tomlField ?? DEFAULT_PROMPT_FIELD,
      extracted.prompt,
      options.createMissing ?? false,
    )
    previousValue = patched.previousValue
    await writeFile(targetPath, patched.text, "utf8")
  }
  const afterDigest = await fingerprintFile(targetPath)
  const receipt = {
    schema_version: "stack.roundtrip.receipt.v1",
    action: "apply",
    artifact_kind: options.artifactKind,
    environment: config.environmentName,
    api_base_url: config.environment.apiBaseUrl,
    source_environment: pullReceipt?.environment ?? null,
    source_api_base_url: pullReceipt?.api_base_url ?? null,
    source_artifact_path: artifactPath,
    source_receipt_path: options.receiptPath ? resolveWorkspaceReadPath(config, options.receiptPath) : null,
    target_path: targetPath,
    mode,
    toml_field: mode === "toml-string-field" ? options.tomlField ?? DEFAULT_PROMPT_FIELD : null,
    prompt_source: extracted.source,
    prompt_sha256: sha256Text(extracted.prompt),
    target_digest_before: beforeDigest,
    target_digest_after: afterDigest,
    git_sha_at_apply: gitShaForConfig(config),
    applied_at: new Date().toISOString(),
  }
  const receiptPath = await writeRoundTripReceipt(config, receipt)
  return {
    ok: true,
    status: 0,
    message: `applied champion_prompt to ${targetPath}`,
    data: {
      artifact_kind: options.artifactKind,
      target_path: targetPath,
      receipt_path: receiptPath,
      prompt_source: extracted.source,
      prompt_sha256: sha256Text(extracted.prompt),
      prompt_preview: extracted.prompt.slice(0, 240),
      previous_value: previousValue ?? null,
      target_digest_before: beforeDigest ?? null,
      target_digest_after: afterDigest,
    },
  }
}

export async function pushRoundTripArtifact(
  config: StackConfig,
  options: PushRoundTripArtifactOptions,
): Promise<RoundTripResult> {
  const pullReceipt = options.receiptPath ? await readPullReceipt(config, options.receiptPath) : undefined
  const artifactPath = resolveWorkspaceReadPath(config, options.artifactPath ?? pullReceipt?.workspace_path)
  const digest = await fingerprintFile(artifactPath)
  const remotePath = options.remotePath ?? join("roundtrip", options.artifactKind, basename(artifactPath))
  const result: RemoteActionResult = await uploadRemoteRunFile(config, {
    run: { runId: options.runId, state: "unknown" },
    localPath: artifactPath,
    remotePath,
    contentType: options.contentType ?? contentTypeForPath(artifactPath),
    visibility: options.visibility ?? "model",
    kind: options.artifactKind,
    metadata: {
      stack_tool: "stack_push_artifact",
      artifact_kind: options.artifactKind,
      sha256: digest.sha256,
      source_receipt_path: options.receiptPath ?? null,
    },
  })
  const receipt = {
    schema_version: "stack.roundtrip.receipt.v1",
    action: "push",
    artifact_kind: options.artifactKind,
    environment: config.environmentName,
    api_base_url: config.environment.apiBaseUrl,
    run_id: options.runId,
    local_path: artifactPath,
    remote_path: remotePath,
    visibility: options.visibility ?? "model",
    content_type: options.contentType ?? contentTypeForPath(artifactPath),
    digest,
    upload_ok: result.ok,
    upload_status: result.status,
    upload_message: result.message,
    git_sha_at_push: gitShaForConfig(config),
    pushed_at: new Date().toISOString(),
  }
  const receiptPath = await writeRoundTripReceipt(config, receipt)
  return {
    ok: result.ok,
    status: result.status,
    message: result.ok ? `pushed ${options.artifactKind} to run ${options.runId}` : result.message,
    data: {
      artifact_kind: options.artifactKind,
      run_id: options.runId,
      local_path: artifactPath,
      remote_path: remotePath,
      receipt_path: receiptPath,
      digest,
      upload_result: result.data ?? null,
    },
  }
}

async function resolveSource(
  config: StackConfig,
  options: PullRoundTripArtifactOptions,
): Promise<{ ok: true; selection: SourceSelection } | RoundTripResult> {
  const sourceKind = options.sourceKind ?? "hosted_optimizer"
  if (sourceKind === "hosted_optimizer") {
    if (!options.runId) return { ok: false, status: 0, message: "run_id is required for hosted_optimizer pull" }
    const artifactName = options.artifactName ?? await selectHostedArtifactName(config, options.runId, options.artifactKind)
    const download = await downloadHostedOptimizerArtifact(
      config,
      { runId: options.runId, projectId: options.projectId, algorithm: "unknown", status: "unknown" },
      artifactName,
    )
    if (!download.ok) return download
    const sourcePath = readRecordString(download.data, "outputPath")
    if (!sourcePath) return { ok: false, status: 0, message: "hosted optimizer download did not return outputPath" }
    return {
      ok: true,
      selection: {
        sourceKind,
        sourcePath,
        runId: options.runId,
        projectId: options.projectId,
        artifactName,
        contentType: readRecordString(download.data, "contentType"),
        downloadedAt: readRecordString(download.data, "downloadedAt"),
      },
    }
  }
  if (sourceKind === "saved_download") {
    const record = await selectSavedDownload(config, options)
    if (!record) {
      return { ok: false, status: 0, message: "no matching saved download found" }
    }
    return {
      ok: true,
      selection: {
        sourceKind,
        sourcePath: resolve(record.path),
        runId: record.runId,
        outputId: record.outputId,
        label: record.label,
        downloadedAt: record.downloadedAt,
      },
    }
  }
  const sourcePath = resolveWorkspaceReadPath(config, options.sourcePath)
  return {
    ok: true,
    selection: {
      sourceKind,
      sourcePath,
      runId: options.runId,
      projectId: options.projectId,
      artifactName: options.artifactName,
    },
  }
}

async function selectHostedArtifactName(
  config: StackConfig,
  runId: string,
  artifactKind: RoundTripArtifactKind,
): Promise<string> {
  const preferred = preferredArtifactNames(artifactKind)
  const snapshot = await readHostedOptimizerSnapshot(config)
  const detail = snapshot.runDetails[runId]
  const names = detail?.artifactNames ?? []
  for (const candidate of preferred) {
    const exact = names.find((name) => name === candidate)
    if (exact) return exact
  }
  for (const candidate of preferred) {
    const fuzzy = names.find((name) => name.toLowerCase().includes(candidate.toLowerCase()))
    if (fuzzy) return fuzzy
  }
  return preferred[0]
}

function preferredArtifactNames(artifactKind: RoundTripArtifactKind): string[] {
  switch (artifactKind) {
    case "champion_prompt":
      return ["best_candidate", "manifest", "result_manifest", "champion_prompt", "best_prompt", "optimized_prompt", "frontier", "run_registry"]
    case "adapter_weights":
      return ["adapter_weights", "weights", "adapter", "model"]
    case "dataset":
      return ["dataset", "data", "train_dataset", "eval_dataset"]
    case "eval_table":
      return ["eval_table", "metrics", "score_table", "score_chart", "events"]
  }
}

async function selectSavedDownload(
  config: StackConfig,
  options: PullRoundTripArtifactOptions,
): Promise<RemoteDownloadRecord | undefined> {
  const downloads = await readRemoteDownloadHistory(config)
  const index = options.index ?? 0
  if (index < 0) throw new Error("index must be 0 or greater")
  let matches = downloads
  if (options.savedDownloadPath) {
    const savedPath = resolve(options.savedDownloadPath)
    matches = matches.filter((download) => resolve(download.path) === savedPath)
  }
  if (options.runId) matches = matches.filter((download) => download.runId === options.runId)
  if (options.outputId) matches = matches.filter((download) => download.outputId === options.outputId)
  return matches[index]
}

function defaultPulledArtifactPath(
  config: StackConfig,
  artifactKind: RoundTripArtifactKind,
  selection: SourceSelection,
): string {
  const runSegment = safePathSegment(selection.runId ?? "local")
  const label = selection.artifactName ?? selection.outputId ?? selection.label ?? basename(selection.sourcePath)
  const extension = extname(label) || extname(selection.sourcePath) || extensionForContentType(selection.contentType)
  const stem = safePathSegment(stripExtension(label))
  return join(
    config.workingDir,
    ".stack",
    "roundtrip",
    config.environmentName,
    runSegment,
    `${artifactKind}-${stem}${extension}`,
  )
}

async function writeRoundTripReceipt(
  config: StackConfig,
  receipt: Record<string, unknown>,
  requestedPath?: string,
): Promise<string> {
  const receiptPath = resolveWorkspaceWritePath(
    config,
    requestedPath,
    join(
      config.workingDir,
      ".stack",
      "evidence",
      "roundtrip",
      `${timestampForPath()}-${safePathSegment(String(receipt.action ?? "roundtrip"))}-${safePathSegment(String(receipt.artifact_kind ?? "artifact"))}.json`,
    ),
  )
  await mkdir(dirname(receiptPath), { recursive: true })
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8")
  return receiptPath
}

async function readPullReceipt(config: StackConfig, receiptPath: string): Promise<RoundTripPullReceipt> {
  const resolved = resolveWorkspaceReadPath(config, receiptPath)
  const payload = JSON.parse(await readFile(resolved, "utf8")) as unknown
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("round-trip receipt is not an object")
  }
  const receipt = payload as Record<string, unknown>
  if (receipt.schema_version !== "stack.roundtrip.receipt.v1" || receipt.action !== "pull") {
    throw new Error("receipt must be a stack.roundtrip pull receipt")
  }
  if (receipt.artifact_kind !== "champion_prompt" && receipt.artifact_kind !== "adapter_weights" && receipt.artifact_kind !== "dataset" && receipt.artifact_kind !== "eval_table") {
    throw new Error("receipt artifact_kind is not supported")
  }
  if (typeof receipt.workspace_path !== "string") {
    throw new Error("receipt missing workspace_path")
  }
  return receipt as RoundTripPullReceipt
}

function extractChampionPrompt(raw: string, promptJsonPath?: string): { prompt: string; source: string } {
  const trimmed = raw.trim()
  if (!trimmed) return { prompt: "", source: "empty" }
  if (!looksJson(trimmed)) return { prompt: raw, source: "raw_text" }

  let payload: unknown
  try {
    payload = JSON.parse(trimmed)
  } catch {
    return { prompt: raw, source: "raw_text_json_parse_failed" }
  }

  if (promptJsonPath) {
    const value = readJsonPath(payload, promptJsonPath)
    const prompt = stringFromPromptValue(value)
    if (!prompt) throw new Error(`prompt_json_path ${promptJsonPath} did not resolve to prompt text`)
    return { prompt, source: `json_path:${promptJsonPath}` }
  }

  for (const path of [
    "lever_bundle.values.stage2_system",
    "payload.stage2_system",
    "stage2_system",
    "react_system_prompt",
    "system_prompt",
    "champion_prompt",
    "best_prompt",
    "optimized_prompt",
    "prompt",
    "best_candidate.lever_bundle.values.stage2_system",
    "best_candidate.payload.stage2_system",
    "best_candidate.prompt",
    "result.best_candidate.lever_bundle.values.stage2_system",
    "result.best_candidate.payload.stage2_system",
    "result.best_prompt",
  ]) {
    const prompt = stringFromPromptValue(readJsonPath(payload, path))
    if (prompt) return { prompt, source: `json_path:${path}` }
  }

  const recursive = findPromptString(payload)
  if (recursive) return recursive
  return { prompt: "", source: "json_no_prompt" }
}

function patchTomlStringField(
  text: string,
  fieldPath: string,
  value: string,
  createMissing: boolean,
): { text: string; previousValue?: string } {
  const parts = fieldPath.split(".").map((part) => part.trim()).filter(Boolean)
  if (parts.length === 0) throw new Error("toml_field must not be empty")
  const key = parts[parts.length - 1]
  const section = parts.slice(0, -1).join(".")
  const newline = text.includes("\r\n") ? "\r\n" : "\n"
  const lines = text.split(/\r?\n/)
  if (lines.length && lines[lines.length - 1] === "") lines.pop()

  let sectionStart = 0
  let sectionEnd = lines.length
  if (section) {
    sectionStart = -1
    sectionEnd = lines.length
    for (let index = 0; index < lines.length; index += 1) {
      const header = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/.exec(lines[index])
      if (!header) continue
      if (header[1].trim() === section) {
        sectionStart = index + 1
        sectionEnd = nextTomlSectionIndex(lines, sectionStart)
        break
      }
    }
    if (sectionStart < 0) {
      if (!createMissing) throw new Error(`TOML section [${section}] not found`)
      const additions = ["", `[${section}]`, `${key} = ${tomlString(value)}`]
      return { text: `${[...lines, ...additions].join(newline)}${newline}` }
    }
  }

  const keyPattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`)
  for (let index = sectionStart; index < sectionEnd; index += 1) {
    if (!keyPattern.test(lines[index])) continue
    const previousValue = lines[index].replace(keyPattern, "").trim()
    lines[index] = `${key} = ${tomlString(value)}`
    return { text: `${lines.join(newline)}${newline}`, previousValue }
  }
  if (!createMissing) throw new Error(`TOML field ${fieldPath} not found`)
  lines.splice(sectionEnd, 0, `${key} = ${tomlString(value)}`)
  return { text: `${lines.join(newline)}${newline}` }
}

function nextTomlSectionIndex(lines: string[], start: number): number {
  for (let index = start; index < lines.length; index += 1) {
    if (/^\s*\[/.test(lines[index])) return index
  }
  return lines.length
}

function readJsonPath(value: unknown, path: string): unknown {
  let cursor = value
  for (const part of parseJsonPath(path)) {
    if (cursor === undefined || cursor === null) return undefined
    if (typeof part === "number") {
      cursor = Array.isArray(cursor) ? cursor[part] : undefined
    } else if (typeof cursor === "object" && !Array.isArray(cursor)) {
      cursor = (cursor as Record<string, unknown>)[part]
    } else {
      return undefined
    }
  }
  return cursor
}

function parseJsonPath(path: string): Array<string | number> {
  return path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => /^\d+$/.test(part) ? Number(part) : part)
}

function stringFromPromptValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  for (const key of ["stage2_system", "react_system_prompt", "system_prompt", "prompt", "text", "content"]) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key]
  }
  return undefined
}

function findPromptString(value: unknown, prefix = ""): { prompt: string; source: string } | undefined {
  if (!value || typeof value !== "object") return undefined
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findPromptString(value[index], `${prefix}[${index}]`)
      if (found) return found
    }
    return undefined
  }
  const record = value as Record<string, unknown>
  for (const key of ["stage2_system", "react_system_prompt", "system_prompt", "champion_prompt", "best_prompt", "prompt"]) {
    if (typeof record[key] === "string" && record[key].trim()) {
      return { prompt: record[key], source: `recursive:${prefix ? `${prefix}.` : ""}${key}` }
    }
  }
  for (const [key, child] of Object.entries(record)) {
    const found = findPromptString(child, prefix ? `${prefix}.${key}` : key)
    if (found) return found
  }
  return undefined
}

function resolveWorkspaceReadPath(config: StackConfig, path: string | undefined): string {
  if (!path) throw new Error("path is required")
  const resolved = resolveWorkspacePath(config, path)
  return resolved
}

function resolveWorkspaceWritePath(config: StackConfig, path: string | undefined, defaultPath?: string): string {
  const candidate = path ? resolveWorkspacePath(config, path) : defaultPath
  if (!candidate) throw new Error("path is required")
  const resolved = resolve(candidate)
  const root = resolve(config.workingDir)
  if (!isInsideOrSame(root, resolved)) {
    throw new Error("path must stay inside Stack workingDir")
  }
  return resolved
}

function resolveWorkspacePath(config: StackConfig, path: string): string {
  const root = resolve(config.workingDir)
  const resolved = isAbsolute(path) ? resolve(path) : resolve(root, path)
  if (!isInsideOrSame(root, resolved)) {
    throw new Error("path must stay inside Stack workingDir")
  }
  return resolved
}

async function fingerprintFile(path: string): Promise<FileFingerprint> {
  const hash = createHash("sha256")
  let bytes = 0
  for await (const chunk of createReadStream(path)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    hash.update(buffer)
  }
  return { sha256: hash.digest("hex"), bytes }
}

async function fingerprintIfExists(path: string): Promise<FileFingerprint | undefined> {
  try {
    await stat(path)
    return await fingerprintFile(path)
  } catch {
    return undefined
  }
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function gitSha(cwd: string): string | undefined {
  const result = spawnSync("git", ["-C", cwd, "rev-parse", "HEAD"], { encoding: "utf8" })
  return result.status === 0 ? result.stdout.trim() || undefined : undefined
}

function gitShaForConfig(config: StackConfig): string | undefined {
  return gitSha(config.workingDir) ?? gitSha(config.appRoot)
}

function isInsideOrSame(root: string, path: string): boolean {
  const relativePath = relative(root, path)
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))
}

function readRecordString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key]
  return typeof value === "string" ? value : undefined
}

function stripExtension(value: string): string {
  const extension = extname(value)
  return extension ? value.slice(0, -extension.length) : value
}

function safePathSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  return cleaned || "artifact"
}

function timestampForPath(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
}

function extensionForContentType(contentType: string | undefined): string {
  if (!contentType) return ""
  const normalized = contentType.toLowerCase()
  if (normalized.includes("json")) return ".json"
  if (normalized.includes("csv")) return ".csv"
  if (normalized.includes("svg")) return ".svg"
  if (normalized.includes("html")) return ".html"
  if (normalized.includes("text")) return ".txt"
  return ""
}

function contentTypeForPath(path: string): string {
  const normalized = path.toLowerCase()
  if (normalized.endsWith(".json")) return "application/json"
  if (normalized.endsWith(".jsonl")) return "application/jsonl"
  if (normalized.endsWith(".toml")) return "application/toml"
  if (normalized.endsWith(".csv")) return "text/csv"
  if (normalized.endsWith(".md")) return "text/markdown"
  if (normalized.endsWith(".txt")) return "text/plain"
  return "application/octet-stream"
}

function tomlString(value: string): string {
  return JSON.stringify(value)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function looksJson(value: string): boolean {
  return value.startsWith("{") || value.startsWith("[")
}
