import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"

export type VoiceRecordingHandle = {
  audioPath: string
  startedAt: string
  stop: () => Promise<{ audio: Buffer; audioPath: string; durationMs: number }>
}

export function startVoiceRecording(stackRoot: string): VoiceRecordingHandle {
  const dir = join(stackRoot, ".stack", "voice", "recordings")
  mkdirSync(dir, { recursive: true })
  const audioPath = join(dir, `${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}-${randomUUID()}.wav`)
  const startedAtMs = Date.now()
  const startedAt = new Date(startedAtMs).toISOString()
  const child = spawn("rec", ["-q", "-r", "16000", "-c", "1", audioPath])
  let stderr = ""
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk)
  })
  return {
    audioPath,
    startedAt,
    stop: () => stopRecording(child, audioPath, startedAtMs, stderr),
  }
}

function stopRecording(
  child: ChildProcessWithoutNullStreams,
  audioPath: string,
  startedAtMs: number,
  stderr: string,
): Promise<{ audio: Buffer; audioPath: string; durationMs: number }> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      if (!existsSync(audioPath)) {
        reject(new Error(`voice recording failed: ${stderr.trim() || "no audio file written"}`))
        return
      }
      const stat = statSync(audioPath)
      if (stat.size <= 44) {
        reject(new Error(`voice recording is empty: ${stderr.trim() || "no microphone input captured"}`))
        return
      }
      resolve({
        audio: readFileSync(audioPath),
        audioPath,
        durationMs: Date.now() - startedAtMs,
      })
    }
    child.once("exit", finish)
    child.once("error", reject)
    child.kill("SIGINT")
  })
}
