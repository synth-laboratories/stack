import { createHash, randomUUID } from "node:crypto"
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { recordEffortCapture } from "./effort.js"
import {
  emitOperatorSessionEvent,
  operatorSessionCapturesDir,
  patchOperatorSessionRecord,
  type OperatorSessionRecord,
} from "./operator-session.js"

export type OperatorSessionCaptureKind = "fullscreen" | "terminal"

export type OperatorSessionCaptureRecord = {
  capture_id: string
  kind: OperatorSessionCaptureKind
  started_at: string
  ended_at?: string
  pid?: number
  device?: string
  output_path: string
  command?: string[]
  sha256?: string
  byte_size?: number
  duration_ms?: number
  status: "recording" | "stopped" | "failed"
  error?: string
}

export type StartOperatorSessionRecordingInput = {
  session: OperatorSessionRecord
  kind?: OperatorSessionCaptureKind
  display?: number
  device?: string
}

export type StopOperatorSessionRecordingInput = {
  session: OperatorSessionRecord
  captureId?: string
}

export type StartOperatorSessionRecordingResult = {
  capture: OperatorSessionCaptureRecord
  manifestPath: string
}

export type StopOperatorSessionRecordingResult = {
  capture: OperatorSessionCaptureRecord
  manifestPath: string
}

const STOP_SIGNAL_WAIT_MS = 5_000
const FILE_SETTLE_ATTEMPTS = 20
const FILE_SETTLE_DELAY_MS = 100

export function startOperatorSessionRecording(
  input: StartOperatorSessionRecordingInput,
): StartOperatorSessionRecordingResult {
  const kind = input.kind ?? "fullscreen"
  if (kind !== "fullscreen") {
    throw new Error("terminal recording is not wired yet; use kind=fullscreen for v0")
  }

  const stackDataRoot = input.session.stack_data_root
  const operatorSessionId = input.session.operator_session_id
  const active = readActiveOperatorSessionCapture(stackDataRoot, operatorSessionId)
  if (active) {
    throw new Error(
      `recording already active · ${active.capture_id} · stop it with: stack session record stop`,
    )
  }

  const ffmpegPath = resolveExecutable(
    "ffmpeg",
    "install ffmpeg (brew install ffmpeg) and grant Screen Recording permission to Terminal/Cursor",
  )
  const device = resolveAvfoundationDevice(input.display, input.device)
  const captureId = newCaptureId()
  const captureDir = operatorSessionCaptureDir(stackDataRoot, operatorSessionId, captureId)
  mkdirSync(captureDir, { recursive: true })
  const outputPath = join(captureDir, "fullscreen.mp4")
  const startedAt = new Date().toISOString()
  const command = [
    ffmpegPath,
    "-y",
    "-f",
    "avfoundation",
    "-framerate",
    "30",
    "-i",
    device,
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "28",
    "-pix_fmt",
    "yuv420p",
    outputPath,
  ]

  const child = spawn(command[0] ?? ffmpegPath, command.slice(1), {
    detached: true,
    stdio: ["ignore", "ignore", "pipe"],
  })
  let spawnError: Error | undefined
  child.on("error", (error) => {
    spawnError = error instanceof Error ? error : new Error(String(error))
  })

  let stderr = ""
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk)
  })

  if (!child.pid) {
    throw spawnError ?? new Error(`ffmpeg failed to start · command: ${formatCommand(command)}`)
  }
  child.unref()

  const capture: OperatorSessionCaptureRecord = {
    capture_id: captureId,
    kind,
    started_at: startedAt,
    pid: child.pid,
    device,
    output_path: outputPath,
    command,
    status: "recording",
  }
  const manifestPath = writeCaptureManifest(captureDir, capture)
  emitOperatorSessionEvent(stackDataRoot, input.session, {
    type: "operator_session.recording_started",
    thread_id: input.session.active_thread_id,
    payload: {
      capture_id: captureId,
      kind,
      device,
      output_path: relativeCapturePath(stackDataRoot, outputPath),
      pid: child.pid,
      command: command,
    },
  })

  return { capture, manifestPath }
}

export function stopOperatorSessionRecording(
  input: StopOperatorSessionRecordingInput,
): StopOperatorSessionRecordingResult {
  const stackDataRoot = input.session.stack_data_root
  const operatorSessionId = input.session.operator_session_id
  const capture =
    (input.captureId
      ? readOperatorSessionCapture(stackDataRoot, operatorSessionId, input.captureId)
      : undefined) ?? readActiveOperatorSessionCapture(stackDataRoot, operatorSessionId)
  if (!capture) {
    throw new Error("no active operator session recording; start one with: stack session record start")
  }
  if (capture.status !== "recording") {
    throw new Error(`capture ${capture.capture_id} is not recording (status=${capture.status})`)
  }

  const captureDir = operatorSessionCaptureDir(stackDataRoot, operatorSessionId, capture.capture_id)
  const startedAtMs = Date.parse(capture.started_at)
  let failed = false
  let errorMessage: string | undefined

  if (capture.pid && isProcessAlive(capture.pid)) {
    try {
      stopOwnedChild(capture.pid)
    } catch (error) {
      failed = true
      errorMessage = error instanceof Error ? error.message : String(error)
    }
  } else if (!existsSync(capture.output_path)) {
    failed = true
    errorMessage =
      "ffmpeg is not running and no output file exists; grant Screen Recording permission to Terminal/Cursor in System Settings → Privacy & Security → Screen Recording, then retry"
  }

  let byteSize = 0
  let sha256: string | undefined
  try {
    const settled = waitForCaptureFile(capture.output_path)
    byteSize = settled.size
    sha256 = sha256File(capture.output_path)
    if (byteSize <= 0) {
      failed = true
      errorMessage ??=
        "recording produced an empty file; grant Screen Recording permission to Terminal/Cursor and retry"
    }
  } catch (error) {
    failed = true
    errorMessage ??= error instanceof Error ? error.message : String(error)
  }

  const endedAt = new Date().toISOString()
  const durationMs = Number.isFinite(startedAtMs) ? Math.max(0, Date.parse(endedAt) - startedAtMs) : undefined
  const next: OperatorSessionCaptureRecord = {
    ...capture,
    ended_at: endedAt,
    ...(durationMs !== undefined ? { duration_ms: durationMs } : {}),
    ...(byteSize > 0 ? { byte_size: byteSize } : {}),
    ...(sha256 ? { sha256 } : {}),
    status: failed ? "failed" : "stopped",
    ...(errorMessage ? { error: errorMessage } : {}),
  }
  const manifestPath = writeCaptureManifest(captureDir, next)

  let session = input.session
  if (!failed) {
    const patched = patchOperatorSessionRecord(stackDataRoot, operatorSessionId, {
      capture_count: input.session.capture_count + 1,
    })
    if (patched) session = patched
    linkOperatorSessionCaptureToEffort(session, next)
  }

  emitOperatorSessionEvent(stackDataRoot, session, {
    type: "operator_session.recording_stopped",
    thread_id: session.active_thread_id,
    payload: {
      capture_id: next.capture_id,
      kind: next.kind,
      output_path: relativeCapturePath(stackDataRoot, next.output_path),
      sha256: next.sha256 ?? null,
      byte_size: next.byte_size ?? null,
      duration_ms: next.duration_ms ?? null,
      status: next.status,
      ...(next.error ? { error: next.error } : {}),
    },
  })

  if (failed) {
    throw new Error(next.error ?? "operator session recording failed")
  }

  return { capture: next, manifestPath }
}

export function readActiveOperatorSessionCapture(
  stackDataRoot: string,
  operatorSessionId: string,
): OperatorSessionCaptureRecord | undefined {
  for (const capture of listOperatorSessionCaptures(stackDataRoot, operatorSessionId)) {
    if (capture.status === "recording") return capture
  }
  return undefined
}

export function listOperatorSessionCaptures(
  stackDataRoot: string,
  operatorSessionId: string,
): OperatorSessionCaptureRecord[] {
  const root = operatorSessionCapturesDir(stackDataRoot, operatorSessionId)
  if (!existsSync(root)) return []

  const captures: OperatorSessionCaptureRecord[] = []
  for (const entry of readdirSync(root)) {
    const capture = readOperatorSessionCapture(stackDataRoot, operatorSessionId, entry)
    if (capture) captures.push(capture)
  }
  return captures.sort((left, right) => right.started_at.localeCompare(left.started_at))
}

function readOperatorSessionCapture(
  stackDataRoot: string,
  operatorSessionId: string,
  captureId: string,
): OperatorSessionCaptureRecord | undefined {
  const manifestPath = captureManifestPath(stackDataRoot, operatorSessionId, captureId)
  if (!existsSync(manifestPath)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as OperatorSessionCaptureRecord
    if (!parsed?.capture_id) return undefined
    return parsed
  } catch {
    return undefined
  }
}

function linkOperatorSessionCaptureToEffort(
  session: OperatorSessionRecord,
  capture: OperatorSessionCaptureRecord,
): void {
  const effortSlug = session.tagged_effort_slug?.trim()
  if (!effortSlug || capture.status !== "stopped") return
  try {
    const result = recordEffortCapture({
      stackDataRoot: session.stack_data_root,
      workspaceRoot: session.workspace_root,
      effortRef: effortSlug,
      captureKind: "video",
      title: `Operator session capture ${capture.capture_id}`,
      body: [
        `Operator session ${session.operator_session_id}`,
        capture.command ? `Command: ${formatCommand(capture.command)}` : "",
        capture.device ? `Device: ${capture.device}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      sourcePath: capture.output_path,
      sourceReceipt: {
        receipt_path: `operator_session:${session.operator_session_id}:${capture.capture_id}`,
        artifact_kind: "local_file",
        source_kind: "video_capture",
        environment: "local",
        label: capture.capture_id,
        workspace_path: capture.output_path,
        ...(capture.sha256 || capture.byte_size
          ? {
              digest: {
                ...(capture.sha256 ? { sha256: capture.sha256 } : {}),
                ...(capture.byte_size !== undefined ? { bytes: capture.byte_size } : {}),
              },
            }
          : {}),
        ...(capture.ended_at ? { pulled_at: capture.ended_at } : {}),
      },
    })
    emitOperatorSessionEvent(session.stack_data_root, session, {
      type: "operator_session.capture_linked_to_effort",
      effort_ref: effortSlug,
      effort_session_id: session.effort_session_id,
      payload: {
        capture_id: capture.capture_id,
        effort_path: result.path,
        capture_kind: "video",
      },
    })
  } catch {
    // Effort missing or capture linkage failed — keep the operator-session artifact.
  }
}

function operatorSessionCaptureDir(
  stackDataRoot: string,
  operatorSessionId: string,
  captureId: string,
): string {
  return join(operatorSessionCapturesDir(stackDataRoot, operatorSessionId), captureId)
}

function captureManifestPath(
  stackDataRoot: string,
  operatorSessionId: string,
  captureId: string,
): string {
  return join(operatorSessionCaptureDir(stackDataRoot, operatorSessionId, captureId), "capture-manifest.json")
}

function writeCaptureManifest(captureDir: string, capture: OperatorSessionCaptureRecord): string {
  const manifestPath = join(captureDir, "capture-manifest.json")
  writeFileSync(manifestPath, `${JSON.stringify(capture, null, 2)}\n`, "utf8")
  return manifestPath
}

function newCaptureId(): string {
  return `opcap_${randomUUID()}`
}

function resolveExecutable(command: string, hint: string): string {
  const result = spawnSync("which", [command], { encoding: "utf8" })
  if (result.status === 0) {
    const resolved = result.stdout.trim()
    if (resolved) return resolved
  }
  throw new Error(`${command} not found · ${hint}`)
}

function resolveAvfoundationDevice(display?: number, device?: string): string {
  const trimmed = device?.trim()
  if (trimmed) return trimmed
  const index = display ?? 0
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`display must be a non-negative integer; got ${String(display)}`)
  }
  return `Capture screen ${index}:none`
}

function stopOwnedChild(pid: number): void {
  if (!isProcessAlive(pid)) return
  process.kill(pid, "SIGINT")
  const deadline = Date.now() + STOP_SIGNAL_WAIT_MS
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return
    sleepSync(50)
  }
  if (isProcessAlive(pid)) {
    process.kill(pid, "SIGTERM")
    const termDeadline = Date.now() + 1_000
    while (Date.now() < termDeadline) {
      if (!isProcessAlive(pid)) return
      sleepSync(50)
    }
  }
}

function waitForCaptureFile(path: string): { size: number } {
  let lastError = "no capture file written"
  for (let attempt = 0; attempt < FILE_SETTLE_ATTEMPTS; attempt += 1) {
    if (existsSync(path)) {
      const stat = statSync(path)
      if (stat.size > 0) return stat
      lastError = "capture file is empty"
    }
    sleepSync(FILE_SETTLE_DELAY_MS)
  }
  throw new Error(
    `${lastError}; if ffmpeg never started, grant Screen Recording permission to Terminal/Cursor in System Settings → Privacy & Security → Screen Recording`,
  )
}

function sha256File(path: string): string {
  const hash = createHash("sha256")
  hash.update(readFileSync(path))
  return hash.digest("hex")
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function relativeCapturePath(stackDataRoot: string, absolutePath: string): string {
  if (absolutePath.startsWith(`${stackDataRoot}/`)) {
    return absolutePath.slice(stackDataRoot.length + 1)
  }
  return absolutePath
}

function formatCommand(command: readonly string[]): string {
  return command
    .map((part) => (/\s/.test(part) ? `"${part}"` : part))
    .join(" ")
}

function sleepSync(ms: number): void {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    // busy-wait for short ffmpeg finalize windows
  }
}
