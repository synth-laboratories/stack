import { mkdir, open, readFile, stat, writeFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import { basename, join, relative, resolve } from "node:path"
import { environmentAuthStatus, type StackConfig } from "../config.js"
import type { RemoteArtifactSummary, RemoteFactorySummary, RemoteSmrRunSummary, RemoteWorkProductSummary } from "./research.js"

export type RemoteActionKind =
  | "pause-run"
  | "resume-run"
  | "stop-run"
  | "preview-factory-wake"
  | "preview-output"
  | "preview-download"
  | "download-output"
  | "upload-run-file"
  | "message-run"
  | "message-factory"

export type RemoteActionResult = {
  ok: boolean
  status: number
  message: string
  data?: Record<string, unknown>
}

export type RemoteDownloadRecord = {
  environmentName: string
  runId: string
  kind: "work-product" | "artifact"
  outputId: string
  label: string
  path: string
  filename: string
  bytes: number
  downloadedAt: string
}

export type RemoteOutputPreview = {
  environmentName: string
  runId: string
  kind: "work-product" | "artifact"
  outputId: string
  label: string
  contentType?: string
  bytes: number
  previewBytes: number
  truncated: boolean
  preview: string
  previewedAt: string
}

export type RemoteSavedDownloadPreview = RemoteOutputPreview & {
  path: string
  filename: string
  downloadedAt: string
}

export type RemoteOutputSelection =
  | {
      kind: "work-product"
      run: RemoteSmrRunSummary
      item: RemoteWorkProductSummary
    }
  | {
      kind: "artifact"
      run: RemoteSmrRunSummary
      item: RemoteArtifactSummary
    }

export type RemoteRunFileUploadOptions = {
  run: RemoteSmrRunSummary
  localPath: string
  remotePath?: string
  contentType?: string
  visibility?: "model" | "verifier"
  kind?: string
  metadata?: Record<string, unknown>
}

export async function executeRemoteRunAction(
  config: StackConfig,
  run: RemoteSmrRunSummary,
  action: "pause-run" | "resume-run" | "stop-run",
): Promise<RemoteActionResult> {
  const suffix = action === "pause-run" ? "pause" : action === "resume-run" ? "resume" : "stop"
  const basePath = run.projectId
    ? `/smr/projects/${encodeURIComponent(run.projectId)}/runs/${encodeURIComponent(run.runId)}`
    : `/smr/runs/${encodeURIComponent(run.runId)}`
  return postRemote(config, `${basePath}/${suffix}`)
}

export async function sendRemoteRunMessage(
  config: StackConfig,
  run: RemoteSmrRunSummary,
  body: string,
): Promise<RemoteActionResult> {
  return postRemote(config, `/smr/runs/${encodeURIComponent(run.runId)}/runtime/messages`, {
    topic: "stack.operator_message",
    mode: "steer",
    spawn_policy: "live_only",
    sender: "stack",
    action: "operator_message",
    body,
    payload: {
      source: "stack_tui",
      project_id: run.projectId,
    },
  })
}

export async function sendRemoteFactoryMessage(
  config: StackConfig,
  factory: RemoteFactorySummary,
  body: string,
): Promise<RemoteActionResult> {
  return postRemote(config, `/smr/factories/${encodeURIComponent(factory.factoryId)}/messages`, {
    body,
    summary: `Stack message for factory ${factory.name}`,
    source: "operator",
    actor_type: "human",
    project_only: false,
    payload: {
      source: "stack_tui",
      factory_id: factory.factoryId,
      factory_name: factory.name,
      factory_project_id: factory.canonicalProjectId ?? factory.latestProjectId,
    },
  })
}

export async function previewRemoteFactoryWakeDue(
  config: StackConfig,
  factory: RemoteFactorySummary,
): Promise<RemoteActionResult> {
  return postRemote(config, `/smr/factories/${encodeURIComponent(factory.factoryId)}/wake-due`, {
    dry_run: true,
    limit: 10,
    allow_overlap: false,
    continue_on_error: true,
  })
}

export async function downloadRemoteOutput(
  config: StackConfig,
  selection: RemoteOutputSelection,
): Promise<RemoteActionResult> {
  const path =
    selection.kind === "work-product"
      ? `/smr/work-products/${encodeURIComponent(selection.item.workProductId)}/content?disposition=attachment`
      : `/smr/artifacts/${encodeURIComponent(selection.item.artifactId)}/content?disposition=attachment`
  const suggestedName =
    selection.kind === "work-product"
      ? selection.item.title ?? selection.item.workProductId
      : selection.item.title ?? selection.item.artifactId
  const outputId = selection.kind === "work-product" ? selection.item.workProductId : selection.item.artifactId
  return downloadRemote(config, path, {
    environmentName: config.environmentName,
    runId: selection.run.runId,
    kind: selection.kind,
    outputId,
    label: suggestedName,
    fallbackName: suggestedName,
  })
}

export async function previewRemoteOutput(
  config: StackConfig,
  selection: RemoteOutputSelection,
  maxBytes = 8192,
): Promise<RemoteActionResult> {
  const path =
    selection.kind === "work-product"
      ? `/smr/work-products/${encodeURIComponent(selection.item.workProductId)}/content?disposition=inline`
      : `/smr/artifacts/${encodeURIComponent(selection.item.artifactId)}/content?disposition=inline`
  const label =
    selection.kind === "work-product"
      ? selection.item.title ?? selection.item.workProductId
      : selection.item.title ?? selection.item.artifactId
  const outputId = selection.kind === "work-product" ? selection.item.workProductId : selection.item.artifactId
  return previewRemote(config, path, {
    environmentName: config.environmentName,
    runId: selection.run.runId,
    kind: selection.kind,
    outputId,
    label,
    maxBytes,
  })
}

export async function readRemoteDownloadHistory(config: StackConfig): Promise<RemoteDownloadRecord[]> {
  try {
    const payload = JSON.parse(await readFile(downloadHistoryPath(config), "utf8")) as unknown
    if (!Array.isArray(payload)) return []
    return payload.map(readDownloadRecord).filter((record): record is RemoteDownloadRecord => Boolean(record))
  } catch {
    return []
  }
}

export async function previewSavedRemoteDownload(
  config: StackConfig,
  record: RemoteDownloadRecord,
  maxBytes = 8192,
): Promise<RemoteActionResult> {
  const maxPreviewBytes = Math.max(1, Math.min(Math.floor(maxBytes), 64 * 1024))
  const resolvedPath = resolve(record.path)
  const root = downloadRoot(config)
  if (!isInsidePath(root, resolvedPath)) {
    return {
      ok: false,
      status: 0,
      message: "download path is outside Stack download state",
    }
  }

  try {
    const fileStat = await stat(resolvedPath)
    if (!fileStat.isFile()) {
      return {
        ok: false,
        status: 0,
        message: "download path is not a file",
      }
    }
    const file = await open(resolvedPath, "r")
    try {
      const buffer = Buffer.alloc(Math.min(fileStat.size, maxPreviewBytes))
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
      const preview = buffer.subarray(0, bytesRead).toString("utf8")
      const payload: RemoteSavedDownloadPreview = {
        environmentName: record.environmentName,
        runId: record.runId,
        kind: record.kind,
        outputId: record.outputId,
        label: record.label,
        contentType: contentTypeForPath(record.filename),
        bytes: fileStat.size,
        previewBytes: bytesRead,
        truncated: fileStat.size > bytesRead,
        preview,
        previewedAt: new Date().toISOString(),
        path: resolvedPath,
        filename: record.filename,
        downloadedAt: record.downloadedAt,
      }
      return {
        ok: true,
        status: 0,
        message: `previewed saved ${bytesRead}${payload.truncated ? `/${fileStat.size}` : ""} bytes from ${record.kind} ${record.label}`,
        data: payload,
      }
    } finally {
      await file.close()
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function uploadRemoteRunFile(
  config: StackConfig,
  options: RemoteRunFileUploadOptions,
): Promise<RemoteActionResult> {
  try {
    const bytes = await readFile(options.localPath)
    const remotePath = options.remotePath ?? basename(options.localPath)
    return await postRemote(config, `/smr/runs/${encodeURIComponent(options.run.runId)}/files:upload`, {
      files: [
        {
          path: remotePath,
          content: bytes.toString("base64"),
          encoding: "base64",
          content_type: options.contentType ?? contentTypeForPath(remotePath),
          kind: options.kind,
          visibility: options.visibility ?? "model",
          metadata: {
            source: "stack_mcp",
            local_path: options.localPath,
            ...(options.metadata ?? {}),
          },
        },
      ],
    })
  } catch (error) {
    return {
      ok: false,
      status: 0,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

async function previewRemote(
  config: StackConfig,
  path: string,
  target: {
    environmentName: string
    runId: string
    kind: "work-product" | "artifact"
    outputId: string
    label: string
    maxBytes: number
  },
): Promise<RemoteActionResult> {
  const token = process.env[config.environment.authEnv]
  if (!token) {
    return {
      ok: false,
      status: 0,
      message: environmentAuthStatus(config.environment).message,
    }
  }

  const maxBytes = Math.max(1, Math.min(Math.floor(target.maxBytes), 64 * 1024))

  try {
    const response = await fetch(`${config.environment.apiBaseUrl.replace(/\/+$/, "")}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Range: `bytes=0-${maxBytes - 1}`,
      },
      signal: AbortSignal.timeout(15000),
    })
    const bytes = Buffer.from(await response.arrayBuffer())
    if (!response.ok) {
      const text = bytes.toString("utf8")
      return {
        ok: false,
        status: response.status,
        message: summarizePayload(text) || `${response.status} ${response.statusText}`,
      }
    }

    const previewBytes = Math.min(bytes.length, maxBytes)
    const preview = bytes.subarray(0, previewBytes).toString("utf8")
    const contentType = response.headers.get("content-type") ?? undefined
    const payload: RemoteOutputPreview = {
      environmentName: target.environmentName,
      runId: target.runId,
      kind: target.kind,
      outputId: target.outputId,
      label: target.label,
      ...(contentType ? { contentType } : {}),
      bytes: bytes.length,
      previewBytes,
      truncated: bytes.length > previewBytes,
      preview,
      previewedAt: new Date().toISOString(),
    }
    return {
      ok: true,
      status: response.status,
      message: `previewed ${previewBytes}${payload.truncated ? `/${bytes.length}` : ""} bytes from ${target.kind} ${target.label}`,
      data: payload,
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

async function postRemote(config: StackConfig, path: string, body?: Record<string, unknown>): Promise<RemoteActionResult> {
  const token = process.env[config.environment.authEnv]
  if (!token) {
    return {
      ok: false,
      status: 0,
      message: environmentAuthStatus(config.environment).message,
    }
  }

  try {
    const response = await fetch(`${config.environment.apiBaseUrl.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    })
    const text = await response.text()
    const data = payloadRecord(text)
    return {
      ok: response.ok,
      status: response.status,
      message: response.ok ? summarizePayload(text) || `${path} ok` : summarizePayload(text) || `${response.status} ${response.statusText}`,
      ...(data ? { data } : {}),
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

async function downloadRemote(
  config: StackConfig,
  path: string,
  target: {
    environmentName: string
    runId: string
    kind: "work-product" | "artifact"
    outputId: string
    label: string
    fallbackName: string
  },
): Promise<RemoteActionResult> {
  const token = process.env[config.environment.authEnv]
  if (!token) {
    return {
      ok: false,
      status: 0,
      message: environmentAuthStatus(config.environment).message,
    }
  }

  try {
    const response = await fetch(`${config.environment.apiBaseUrl.replace(/\/+$/, "")}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) {
      const text = await response.text()
      return {
        ok: false,
        status: response.status,
        message: summarizePayload(text) || `${response.status} ${response.statusText}`,
      }
    }
    const bytes = Buffer.from(await response.arrayBuffer())
    const filename = filenameFromDisposition(response.headers.get("content-disposition")) ?? target.fallbackName
    const directory = join(
      config.appRoot,
      ".stack",
      "downloads",
      target.environmentName,
      safePathSegment(target.runId),
    )
    const outputPath = join(directory, `${target.kind}-${safePathSegment(filename)}`)
    await mkdir(directory, { recursive: true })
    await writeFile(outputPath, bytes)
    const downloadedAt = new Date().toISOString()
    const historyError = await persistRemoteDownloadRecord(config, {
      environmentName: target.environmentName,
      runId: target.runId,
      kind: target.kind,
      outputId: target.outputId,
      label: target.label,
      path: outputPath,
      filename,
      bytes: bytes.length,
      downloadedAt,
    })
    return {
      ok: true,
      status: response.status,
      message: `saved ${bytes.length} bytes to ${outputPath}`,
      data: {
        outputPath,
        bytes: bytes.length,
        filename,
        runId: target.runId,
        kind: target.kind,
        outputId: target.outputId,
        label: target.label,
        downloadedAt,
        ...(historyError ? { historyError } : {}),
      },
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

async function persistRemoteDownloadRecord(
  config: StackConfig,
  record: RemoteDownloadRecord,
): Promise<string | undefined> {
  try {
    const history = await readRemoteDownloadHistory(config)
    const nextHistory = [
      record,
      ...history.filter((item) => item.runId !== record.runId || item.outputId !== record.outputId || item.path !== record.path),
    ].slice(0, 20)
    const path = downloadHistoryPath(config)
    await mkdir(join(config.appRoot, ".stack", "downloads", config.environmentName), { recursive: true })
    await writeFile(path, `${JSON.stringify(nextHistory, null, 2)}\n`, "utf8")
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

function downloadHistoryPath(config: StackConfig): string {
  return join(downloadRoot(config), "history.json")
}

function downloadRoot(config: StackConfig): string {
  return resolve(config.appRoot, ".stack", "downloads", config.environmentName)
}

function isInsidePath(root: string, path: string): boolean {
  const relativePath = relative(root, path)
  return Boolean(relativePath) && !relativePath.startsWith("..") && !relativePath.startsWith("/")
}

function readDownloadRecord(value: unknown): RemoteDownloadRecord | undefined {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
  if (!record) return undefined
  const environmentName = readString(record.environmentName)
  const runId = readString(record.runId)
  const kind = readDownloadKind(record.kind)
  const outputId = readString(record.outputId)
  const label = readString(record.label)
  const path = readString(record.path)
  const filename = readString(record.filename)
  const bytes = readNumber(record.bytes)
  const downloadedAt = readString(record.downloadedAt)
  if (!environmentName || !runId || !kind || !outputId || !label || !path || !filename || bytes === undefined || !downloadedAt) {
    return undefined
  }
  return { environmentName, runId, kind, outputId, label, path, filename, bytes, downloadedAt }
}

function readDownloadKind(value: unknown): RemoteDownloadRecord["kind"] | undefined {
  return value === "work-product" || value === "artifact" ? value : undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}

function summarizePayload(text: string): string {
  if (!text.trim()) return ""
  try {
    const payload = JSON.parse(text) as unknown
    if (typeof payload === "object" && payload !== null) {
      const record = payload as Record<string, unknown>
      const detail = record.detail
      if (typeof detail === "string") return detail
      if (typeof detail === "object" && detail !== null) {
        const detailRecord = detail as Record<string, unknown>
        if (typeof detailRecord.message === "string") return detailRecord.message
        if (typeof detailRecord.error === "string") return detailRecord.error
      }
      if (typeof record.event_summary === "string") return record.event_summary
      if (typeof record.message_for_agents === "string") return record.message_for_agents
      if (typeof record.project_event_id === "string") return `project event ${record.project_event_id}`
      if (typeof record.status === "string") return record.status
      if (typeof record.message === "string") return record.message
      if (typeof record.file_count === "number" && typeof record.bytes_uploaded === "number") {
        return `uploaded ${record.file_count} file(s), ${record.bytes_uploaded} bytes`
      }
      if (typeof record.run_id === "string") return `run ${record.run_id}`
      if (Array.isArray(record.efforts)) return `wake preview: ${record.efforts.length} due efforts`
    }
  } catch {
    return text.slice(0, 120)
  }
  return text.slice(0, 120)
}

function payloadRecord(text: string): Record<string, unknown> | undefined {
  if (!text.trim()) return undefined
  try {
    const payload = JSON.parse(text) as unknown
    return typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

function filenameFromDisposition(value: string | null): string | undefined {
  if (!value) return undefined
  const match = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(value)
  if (!match?.[1]) return undefined
  return basename(decodeURIComponent(match[1].trim()))
}

function safePathSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  return cleaned || "output"
}

function contentTypeForPath(path: string): string {
  const normalized = path.toLowerCase()
  if (normalized.endsWith(".md")) return "text/markdown"
  if (normalized.endsWith(".txt")) return "text/plain"
  if (normalized.endsWith(".json")) return "application/json"
  if (normalized.endsWith(".csv")) return "text/csv"
  if (normalized.endsWith(".html")) return "text/html"
  return "application/octet-stream"
}

export async function openUrlInSystemBrowser(url: string): Promise<{ ok: boolean; message: string }> {
  if (!url || !/^https?:\/\//i.test(url)) {
    return { ok: false, message: "invalid url" }
  }
  const platform = process.platform
  try {
    if (platform === "darwin") {
      spawn("open", [url], { stdio: "ignore", detached: true })
    } else if (platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true })
    } else {
      spawn("xdg-open", [url], { stdio: "ignore", detached: true })
    }
    return { ok: true, message: `opened ${url}` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}
