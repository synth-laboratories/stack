export type VoiceSttProviderId = "groq" | "openai"

export type VoiceTranscriptionResult = {
  text: string
  provider: VoiceSttProviderId
  model: string
  fallbackUsed: boolean
}

export type VoiceSttConfig = {
  provider: VoiceSttProviderId
  fallback: VoiceSttProviderId
  modelGroq: string
  modelOpenai: string
  language: string
  envFile?: string
}

export type SpeechToTextProvider = {
  id: VoiceSttProviderId
  model: string
  transcribe(audio: Buffer, options: { mime: string; language?: string }): Promise<{ text: string }>
}
