import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import type { StackConfig } from "../config.js"
import { appendThreadMetaEvent, stackEventId } from "../thread-events.js"
import { loadVoiceApiKeys } from "./keys.js"
import { transcribeAudio, voiceSttConfigFromStack } from "./providers/resolve.js"

export type VoiceHealth = "OFF" | "READY" | "BLOCKED" | "DEGRADED"

export type VoiceStatusSnapshot = {
  schema: "stack/voice-status/v1"
  health: VoiceHealth
  enabled: boolean
  provider: "groq" | "openai"
  fallback: "groq" | "openai"
  providers: {
    groq: "configured" | "missing"
    openai: "configured" | "missing"
  }
  message: string
  checkedAt: string
  statusPath: string
  lastCheck?: {
    ok: boolean
    provider?: string
    model?: string
    transcript?: string
    durationMs?: number
    error?: string
  }
}

export function voiceStatusPath(stackRoot: string): string {
  return join(stackRoot, ".stack", "voice", "status.json")
}

export function resolveVoiceStatus(config: StackConfig): VoiceStatusSnapshot {
  const checkedAt = new Date().toISOString()
  const keys = loadVoiceApiKeys(config.voice)
  const providers = {
    groq: keys.groq ? "configured" as const : "missing" as const,
    openai: keys.openai ? "configured" as const : "missing" as const,
  }
  const statusPath = voiceStatusPath(config.appRoot)
  if (!config.voice.enabled) {
    return {
      schema: "stack/voice-status/v1",
      health: "OFF",
      enabled: false,
      provider: config.voice.sttProvider,
      fallback: config.voice.sttFallback,
      providers,
      message: "enable in stack.config.json or STACK_VOICE_ENABLED=1",
      checkedAt,
      statusPath,
    }
  }
  const primaryReady = providers[config.voice.sttProvider] === "configured"
  const fallbackReady = providers[config.voice.sttFallback] === "configured"
  if (!primaryReady && !fallbackReady) {
    return {
      schema: "stack/voice-status/v1",
      health: "BLOCKED",
      enabled: true,
      provider: config.voice.sttProvider,
      fallback: config.voice.sttFallback,
      providers,
      message: `no STT keys; configure ${config.voice.envFile ?? "~/.stack/voice.env"}`,
      checkedAt,
      statusPath,
    }
  }
  return {
    schema: "stack/voice-status/v1",
    health: primaryReady ? "READY" : "DEGRADED",
    enabled: true,
    provider: config.voice.sttProvider,
    fallback: config.voice.sttFallback,
    providers,
    message: primaryReady ? "voice STT configured" : `${config.voice.sttProvider} missing; fallback available`,
    checkedAt,
    statusPath,
  }
}

export function writeVoiceStatus(config: StackConfig, status: VoiceStatusSnapshot): VoiceStatusSnapshot {
  mkdirSync(dirname(status.statusPath), { recursive: true })
  writeFileSync(status.statusPath, `${JSON.stringify(status, null, 2)}\n`)
  return status
}

export function readVoiceStatus(config: StackConfig): VoiceStatusSnapshot {
  const path = voiceStatusPath(config.appRoot)
  if (!existsSync(path)) return resolveVoiceStatus(config)
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<VoiceStatusSnapshot>
    if (parsed.schema === "stack/voice-status/v1" && parsed.health) {
      return {
        ...resolveVoiceStatus(config),
        ...parsed,
        statusPath: path,
      } as VoiceStatusSnapshot
    }
  } catch {
    // Ignore corrupt status and recompute below.
  }
  return resolveVoiceStatus(config)
}

export async function runVoiceCheck(config: StackConfig, options: { threadId?: string } = {}): Promise<VoiceStatusSnapshot> {
  const base = resolveVoiceStatus(config)
  if (base.health === "OFF" || base.health === "BLOCKED") {
    return writeVoiceStatus(config, base)
  }

  const audioPath = join(config.appRoot, ".stack", "voice", "check.wav")
  ensureCheckAudio(audioPath)
  const audio = readFileSync(audioPath)
  const startedAt = Date.now()
  try {
    const transcription = await transcribeAudio(audio, {
      mime: "audio/wav",
      language: config.voice.language,
      config: voiceSttConfigFromStack(config.voice),
    })
    const status: VoiceStatusSnapshot = {
      ...base,
      health: transcription.fallbackUsed ? "DEGRADED" : "READY",
      checkedAt: new Date().toISOString(),
      message: transcription.fallbackUsed ? "fallback STT passed" : "primary STT passed",
      lastCheck: {
        ok: true,
        provider: transcription.provider,
        model: transcription.model,
        transcript: transcription.text,
        durationMs: Date.now() - startedAt,
      },
    }
    recordVoicePreflight(config, status, options.threadId)
    return writeVoiceStatus(config, status)
  } catch (error) {
    const status: VoiceStatusSnapshot = {
      ...base,
      health: "BLOCKED",
      checkedAt: new Date().toISOString(),
      message: "STT preflight failed",
      lastCheck: {
        ok: false,
        durationMs: Date.now() - startedAt,
        error: sanitizeVoiceError(error),
      },
    }
    recordVoicePreflight(config, status, options.threadId)
    return writeVoiceStatus(config, status)
  }
}

export function voiceStatusLine(status: VoiceStatusSnapshot): string {
  const groq = status.providers.groq === "configured" ? "groq ✓" : "groq missing"
  const openai = status.providers.openai === "configured" ? "openai ✓" : "openai missing"
  if (status.health === "OFF") return `Voice OFF · ${status.message}`
  if (status.health === "READY") return `Voice READY · ${groq} · ${openai}`
  if (status.health === "DEGRADED") return `Voice DEGRADED · ${groq} · ${openai}`
  return `Voice BLOCKED · ${status.message}`
}

export function voiceInputHintLine(input: {
  status: VoiceStatusSnapshot
  recording?: boolean
  transcribing?: boolean
  /** When true, voice submits to the active gardener Codex thread instead of the inbox queue. */
  gardenerChat?: boolean
}): string {
  const target = input.gardenerChat ? "gardener" : "gardener inbox"
  if (input.recording) return `Shift+V · recording… · release to transcribe · enter to send`
  if (input.transcribing) return `Shift+V · transcribing…`
  if (input.status.health === "OFF") {
    return "Shift+V · voice off · enable in stack.config.json or STACK_VOICE_ENABLED=1"
  }
  if (input.status.health === "BLOCKED") {
    return `Shift+V · voice blocked · ${input.status.message}`
  }
  const status = voiceStatusLine(input.status)
  return input.gardenerChat
    ? `Shift+V hold · release to transcribe · enter to send · ${status}`
    : `Shift+V hold · release to transcribe → gardener · ${status}`
}

function ensureCheckAudio(path: string): void {
  if (existsSync(path)) return
  mkdirSync(dirname(path), { recursive: true })
  const aiffPath = path.replace(/\.wav$/, ".aiff")
  const say = spawnSync("say", ["-o", aiffPath, "stack voice check"], { encoding: "utf8" })
  if (say.status !== 0) throw new Error(`say failed: ${say.stderr || say.stdout}`)
  const ffmpeg = spawnSync("ffmpeg", ["-y", "-i", aiffPath, "-ar", "16000", "-ac", "1", path], {
    encoding: "utf8",
  })
  if (ffmpeg.status !== 0) throw new Error(`ffmpeg failed: ${ffmpeg.stderr || ffmpeg.stdout}`)
}

function recordVoicePreflight(config: StackConfig, status: VoiceStatusSnapshot, threadId?: string): void {
  if (!threadId) return
  appendThreadMetaEvent(config.appRoot, {
    event_id: stackEventId("voice_preflight"),
    type: status.lastCheck?.ok ? "voice.preflight.ready" : "voice.preflight.blocked",
    thread_id: threadId,
    observed_at: status.checkedAt,
    actor_id: "gardener",
    actor_role: "system",
    payload: {
      health: status.health,
      provider: status.lastCheck?.provider,
      model: status.lastCheck?.model,
      duration_ms: status.lastCheck?.durationMs,
      error: status.lastCheck?.error,
    },
  })
}

function sanitizeVoiceError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]")
    .replace(/(api[_-]?key[=:]\s*)[A-Za-z0-9._-]+/gi, "$1[redacted]")
    .slice(0, 500)
}
