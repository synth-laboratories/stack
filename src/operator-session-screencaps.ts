import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { readOperatorSession } from "./operator-session.js"
import { listOperatorSessionCaptures, type OperatorSessionCaptureRecord } from "./operator-session-recording.js"

export type ExtractOperatorSessionScreencapsInput = {
  stackDataRoot: string
  operatorSessionId: string
  captureId?: string
  /** Extract one frame every N seconds (default 2). Ignored when atSeconds is set. */
  intervalSec?: number
  /** Explicit timestamps in seconds. */
  atSeconds?: number[]
  /** Cap frame count for interval mode (default 50). */
  maxFrames?: number
  outputDir?: string
}

export type ScreencapFrame = {
  path: string
  offset_s: number
  index: number
}

export type ExtractOperatorSessionScreencapsResult = {
  operator_session_id: string
  capture_id: string
  video_path: string
  duration_s: number
  output_dir: string
  frames: ScreencapFrame[]
  manifest_path: string
}

const DEFAULT_INTERVAL_SEC = 2
const DEFAULT_MAX_FRAMES = 50

export function extractOperatorSessionScreencaps(
  input: ExtractOperatorSessionScreencapsInput,
): ExtractOperatorSessionScreencapsResult {
  const session = readOperatorSession(input.stackDataRoot, input.operatorSessionId)
  if (!session) {
    throw new Error(`operator session not found: ${input.operatorSessionId}`)
  }

  const capture = resolveCapture(session.stack_data_root, input.operatorSessionId, input.captureId)
  if (!capture.output_path || !existsSync(capture.output_path)) {
    throw new Error(`capture video missing: ${capture.capture_id}`)
  }
  if (capture.status !== "stopped") {
    throw new Error(`capture ${capture.capture_id} is not stopped (status=${capture.status})`)
  }

  const ffmpegPath = resolveExecutable("ffmpeg", "install ffmpeg (brew install ffmpeg)")
  const ffprobePath = resolveExecutable("ffprobe", "install ffmpeg (brew install ffmpeg)")
  const durationS = probeVideoDurationSec(ffprobePath, capture.output_path)
  if (!Number.isFinite(durationS) || durationS <= 0) {
    throw new Error(`could not read video duration for ${capture.output_path}`)
  }

  const outputDir =
    input.outputDir?.trim() ||
    join(
      input.stackDataRoot,
      ".stack",
      "operator-sessions",
      input.operatorSessionId,
      "captures",
      capture.capture_id,
      "screencaps",
    )
  mkdirSync(outputDir, { recursive: true })

  const atSeconds = normalizeAtSeconds(input.atSeconds, durationS)
  const frames =
    atSeconds.length > 0
      ? extractAtTimestamps(ffmpegPath, capture.output_path, outputDir, atSeconds)
      : extractAtInterval({
          ffmpegPath,
          videoPath: capture.output_path,
          outputDir,
          intervalSec: input.intervalSec ?? DEFAULT_INTERVAL_SEC,
          maxFrames: input.maxFrames ?? DEFAULT_MAX_FRAMES,
          durationS,
        })

  const manifestPath = join(outputDir, "screencaps-manifest.json")
  const manifest = {
    schema_version: "stack.operator_session_screencaps.v1",
    operator_session_id: input.operatorSessionId,
    capture_id: capture.capture_id,
    video_path: capture.output_path,
    duration_s: durationS,
    extracted_at: new Date().toISOString(),
    frames,
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")

  return {
    operator_session_id: input.operatorSessionId,
    capture_id: capture.capture_id,
    video_path: capture.output_path,
    duration_s: durationS,
    output_dir: outputDir,
    frames,
    manifest_path: manifestPath,
  }
}

function resolveCapture(
  stackDataRoot: string,
  operatorSessionId: string,
  captureId?: string,
): OperatorSessionCaptureRecord {
  const captures = listOperatorSessionCaptures(stackDataRoot, operatorSessionId).filter(
    (entry) => entry.kind === "fullscreen" && entry.status === "stopped",
  )
  if (captures.length === 0) {
    throw new Error(`no stopped fullscreen captures for ${operatorSessionId}`)
  }
  if (captureId) {
    const match = captures.find((entry) => entry.capture_id === captureId)
    if (!match) {
      throw new Error(`capture not found: ${captureId}`)
    }
    return match
  }
  return captures[0]!
}

function normalizeAtSeconds(atSeconds: number[] | undefined, durationS: number): number[] {
  if (!atSeconds || atSeconds.length === 0) return []
  const unique = [...new Set(atSeconds.map((value) => Math.max(0, value)))].sort((a, b) => a - b)
  return unique.filter((value) => value <= durationS + 0.05)
}

function extractAtInterval(input: {
  ffmpegPath: string
  videoPath: string
  outputDir: string
  intervalSec: number
  maxFrames: number
  durationS: number
}): ScreencapFrame[] {
  const intervalSec = Math.max(0.25, input.intervalSec)
  const frameCount = Math.min(
    input.maxFrames,
    Math.max(1, Math.floor(input.durationS / intervalSec) + 1),
  )
  const tempPattern = join(input.outputDir, "_frame_%04d.png")
  const args = [
    "-y",
    "-i",
    input.videoPath,
    "-vf",
    `fps=1/${intervalSec}`,
    "-frames:v",
    String(frameCount),
    "-q:v",
    "2",
    tempPattern,
  ]
  runFfmpeg(input.ffmpegPath, args)

  const numbered = readdirSync(input.outputDir)
    .filter((name) => name.startsWith("_frame_") && name.endsWith(".png"))
    .sort()
  const frames: ScreencapFrame[] = []
  for (let index = 0; index < numbered.length; index += 1) {
    const offsetS = Math.min(input.durationS, index * intervalSec)
    const sourceName = numbered[index]!
    const targetName = `frame_${formatOffsetLabel(offsetS)}.png`
    const sourcePath = join(input.outputDir, sourceName)
    const targetPath = join(input.outputDir, targetName)
    if (sourcePath !== targetPath) {
      renameSync(sourcePath, targetPath)
    }
    frames.push({ path: targetPath, offset_s: offsetS, index })
  }
  return frames
}

function extractAtTimestamps(
  ffmpegPath: string,
  videoPath: string,
  outputDir: string,
  atSeconds: number[],
): ScreencapFrame[] {
  const frames: ScreencapFrame[] = []
  for (let index = 0; index < atSeconds.length; index += 1) {
    const offsetS = atSeconds[index]!
    const targetPath = join(outputDir, `frame_${formatOffsetLabel(offsetS)}.png`)
    const args = [
      "-y",
      "-ss",
      String(offsetS),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      targetPath,
    ]
    runFfmpeg(ffmpegPath, args)
    frames.push({ path: targetPath, offset_s: offsetS, index })
  }
  return frames
}

function probeVideoDurationSec(ffprobePath: string, videoPath: string): number {
  const result = spawnSync(
    ffprobePath,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      videoPath,
    ],
    { encoding: "utf8" },
  )
  if (result.status !== 0) {
    throw new Error(`ffprobe failed: ${result.stderr || result.stdout || "unknown error"}`)
  }
  const parsed = Number.parseFloat(result.stdout.trim())
  return Number.isFinite(parsed) ? parsed : 0
}

function runFfmpeg(ffmpegPath: string, args: string[]): void {
  const result = spawnSync(ffmpegPath, args, { encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed: ${result.stderr || result.stdout || "unknown error"}`)
  }
}

function formatOffsetLabel(offsetS: number): string {
  if (Number.isInteger(offsetS)) return `${offsetS}s`
  return `${offsetS.toFixed(1).replace(/\.0$/, "")}s`
}

function resolveExecutable(command: string, hint: string): string {
  const result = spawnSync("which", [command], { encoding: "utf8" })
  if (result.status === 0) {
    const resolved = result.stdout.trim()
    if (resolved) return resolved
  }
  throw new Error(`${command} not found · ${hint}`)
}

export function parseAtSecondsFlag(value: string | undefined): number[] | undefined {
  if (!value?.trim()) return undefined
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean)
  const parsed = parts.map((part) => {
    const normalized = part.endsWith("s") ? part.slice(0, -1) : part
    const seconds = Number.parseFloat(normalized)
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new Error(`invalid timestamp: ${part}`)
    }
    return seconds
  })
  return parsed
}

export function formatScreencapSummary(result: ExtractOperatorSessionScreencapsResult): string {
  const lines = [
    `screencaps · ${result.capture_id} · ${result.frames.length} frames · ${result.duration_s.toFixed(1)}s video`,
    result.output_dir,
    result.manifest_path,
  ]
  for (const frame of result.frames) {
    lines.push(`  ${basename(frame.path)} @ ${frame.offset_s}s`)
  }
  return lines.join("\n")
}
