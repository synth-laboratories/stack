import type { OperatorSessionRecord } from "./operator-session.js"

export type OperatorSessionCaptureKind = "fullscreen" | "terminal"

export type OperatorSessionCaptureRecord = {
  capture_id: string
  kind: OperatorSessionCaptureKind
  started_at: string
  ended_at?: string
  pid?: number
  device?: string
  output_path: string
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

export function startOperatorSessionRecording(
  _input: StartOperatorSessionRecordingInput,
): StartOperatorSessionRecordingResult {
  throw new Error(
    "operator session recording is not wired yet; implement ffmpeg/asciinema spawn in operator-session-recording.ts",
  )
}

export function stopOperatorSessionRecording(
  _input: StopOperatorSessionRecordingInput,
): StopOperatorSessionRecordingResult {
  throw new Error(
    "operator session recording is not wired yet; implement capture stop + sha256 manifest in operator-session-recording.ts",
  )
}
