import { readFileSync } from "node:fs"
import { enqueueGardenerInbox, readGardenerInbox } from "../gardener.js"
import { appendThreadMetaEvent, stackEventId } from "../thread-events.js"
import { transcribeAudio, voiceSttConfigFromStack } from "./providers/resolve.js"
import type { VoiceSttConfig, VoiceTranscriptionResult } from "./types.js"
import type { StackVoiceConfig } from "../config.js"

export type VoiceGardenerDictationResult = {
  transcription: VoiceTranscriptionResult
  inboxItemId: string
  threadId: string
  eventIds: {
    dictationFinal: string
    gardenerQueued: string
  }
}

export async function transcribeAudioFile(input: {
  audioPath: string
  mime?: string
  language?: string
  config?: VoiceSttConfig
}): Promise<VoiceTranscriptionResult> {
  const audio = readFileSync(input.audioPath)
  return transcribeAudio(audio, { mime: input.mime ?? guessMime(input.audioPath), language: input.language, config: input.config })
}

export async function transcribeAndEnqueueGardenerVoice(input: {
  stackRoot: string
  threadId: string
  audio: Buffer
  mime?: string
  language?: string
  durationMs?: number
  voiceConfig?: StackVoiceConfig
}): Promise<VoiceGardenerDictationResult> {
  const startedAt = new Date().toISOString()
  appendThreadMetaEvent(input.stackRoot, {
    event_id: stackEventId("voice_dictation_start"),
    type: "voice.dictation.start",
    thread_id: input.threadId,
    observed_at: startedAt,
    actor_id: "gardener",
    actor_role: "system",
    payload: { source: "voice" },
  })

  const transcription = await transcribeAudio(input.audio, {
    mime: input.mime ?? "audio/wav",
    language: input.language,
    config: input.voiceConfig ? voiceSttConfigFromStack(input.voiceConfig) : undefined,
  })

  const dictationFinalId = stackEventId("voice_dictation_final")
  appendThreadMetaEvent(input.stackRoot, {
    event_id: dictationFinalId,
    type: "voice.dictation.final",
    thread_id: input.threadId,
    observed_at: new Date().toISOString(),
    actor_id: "gardener",
    actor_role: "system",
    payload: {
      text: transcription.text,
      duration_ms: input.durationMs,
      provider: transcription.provider,
      model: transcription.model,
      fallback_used: transcription.fallbackUsed,
      source: "voice",
    },
  })

  const inboxItem = enqueueGardenerInbox(input.stackRoot, input.threadId, transcription.text, { source: "voice" })
  const pending = readGardenerInbox(input.stackRoot, input.threadId)
  if (!pending.some((item) => item.id === inboxItem.id)) {
    throw new Error("voice dictation failed to land in gardener inbox")
  }

  return {
    transcription,
    inboxItemId: inboxItem.id,
    threadId: input.threadId,
    eventIds: {
      dictationFinal: dictationFinalId,
      gardenerQueued: inboxItem.id,
    },
  }
}

function guessMime(path: string): string {
  if (path.endsWith(".webm")) return "audio/webm"
  if (path.endsWith(".mp3")) return "audio/mpeg"
  if (path.endsWith(".m4a")) return "audio/mp4"
  return "audio/wav"
}
