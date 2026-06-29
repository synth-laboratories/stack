import { loadVoiceApiKeys } from "../keys.js"
import type { SpeechToTextProvider, VoiceSttConfig, VoiceSttProviderId, VoiceTranscriptionResult } from "../types.js"
import { createGroqSttProvider } from "./groq.js"
import { createOpenAiSttProvider } from "./openai.js"
import type { StackVoiceConfig } from "../../config.js"

export function defaultVoiceSttConfig(): VoiceSttConfig {
  const provider = readProviderEnv("STACK_VOICE_STT_PROVIDER", "groq")
  const fallback = readProviderEnv("STACK_VOICE_STT_FALLBACK", "openai")
  return {
    provider,
    fallback,
    modelGroq: process.env.STACK_VOICE_STT_MODEL_GROQ?.trim() || "whisper-large-v3-turbo",
    modelOpenai: process.env.STACK_VOICE_STT_MODEL_OPENAI?.trim() || "gpt-4o-mini-transcribe",
    language: process.env.STACK_VOICE_STT_LANGUAGE?.trim() || "en",
  }
}

export function voiceSttConfigFromStack(config: StackVoiceConfig): VoiceSttConfig {
  return {
    provider: config.sttProvider,
    fallback: config.sttFallback,
    modelGroq: config.sttModelGroq,
    modelOpenai: config.sttModelOpenai,
    language: config.language,
    envFile: config.envFile,
  }
}

export function resolveSttProviders(config: VoiceSttConfig = defaultVoiceSttConfig()): SpeechToTextProvider[] {
  const keys = loadVoiceApiKeys({ envFile: config.envFile })
  const providers: SpeechToTextProvider[] = []
  for (const id of [config.provider, config.fallback]) {
    if (id === "groq" && keys.groq) providers.push(createGroqSttProvider(keys.groq, config.modelGroq))
    if (id === "openai" && keys.openai) providers.push(createOpenAiSttProvider(keys.openai, config.modelOpenai))
  }
  const seen = new Set<VoiceSttProviderId>()
  return providers.filter((provider) => {
    if (seen.has(provider.id)) return false
    seen.add(provider.id)
    return true
  })
}

export async function transcribeAudio(
  audio: Buffer,
  options: { mime?: string; language?: string; config?: VoiceSttConfig } = {},
): Promise<VoiceTranscriptionResult> {
  const config = options.config ?? defaultVoiceSttConfig()
  const providers = resolveSttProviders(config)
  if (providers.length === 0) {
    throw new Error("voice STT requires GROQ_API_KEY and/or OPENAI_API_KEY (see synth-ai/.env)")
  }
  const mime = options.mime ?? "audio/wav"
  const language = options.language ?? config.language
  let lastError: unknown
  for (const [index, provider] of providers.entries()) {
    try {
      const result = await provider.transcribe(audio, { mime, language })
      return {
        text: result.text,
        provider: provider.id,
        model: provider.model,
        fallbackUsed: index > 0,
      }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function readProviderEnv(name: string, fallback: VoiceSttProviderId): VoiceSttProviderId {
  const value = process.env[name]?.trim().toLowerCase()
  return value === "openai" || value === "groq" ? value : fallback
}
