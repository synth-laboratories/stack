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
  let spawnError: Error | undefined
  child.on("error", (error) => {
    spawnError = error instanceof Error ? error : new Error(String(error))
  })
  if (!child.pid) {
    throw spawnError ?? new Error("voice recording failed: rec did not start (install sox: brew install sox)")
  }
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
    let settled = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
    }
    const finish = () => {
      void waitForRecordingFile(audioPath, 12, 40)
        .then((stat) => {
          resolve({
            audio: readFileSync(audioPath),
            audioPath,
            durationMs: Date.now() - startedAtMs,
          })
        })
        .catch((error) => {
          reject(error instanceof Error ? error : new Error(String(error)))
        })
    }
    child.once("exit", () => settle(finish))
    child.once("error", (error) => settle(() => reject(error)))
    child.kill("SIGINT")
  })
}

async function waitForRecordingFile(
  audioPath: string,
  attempts: number,
  delayMs: number,
): Promise<{ size: number }> {
  let lastError = "no audio file written"
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (existsSync(audioPath)) {
      const stat = statSync(audioPath)
      if (stat.size > 44) return stat
      lastError = "no microphone input captured"
    }
    await sleep(delayMs)
  }
  throw new Error(`voice recording failed: ${lastError}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
