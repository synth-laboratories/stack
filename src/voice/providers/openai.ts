import type { SpeechToTextProvider } from "../types.js"

export function createOpenAiSttProvider(apiKey: string, model: string): SpeechToTextProvider {
  return {
    id: "openai",
    model,
    async transcribe(audio, options) {
      const body = new FormData()
      body.append("file", new Blob([new Uint8Array(audio)], { type: options.mime }), "clip.wav")
      body.append("model", model)
      if (options.language) body.append("language", options.language)

      const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body,
      })
      if (!response.ok) {
        const detail = await response.text()
        throw new Error(`openai transcription failed (${response.status}): ${detail.slice(0, 400)}`)
      }
      const parsed = (await response.json()) as { text?: string }
      const text = typeof parsed.text === "string" ? parsed.text.trim() : ""
      if (!text) throw new Error("openai transcription returned empty text")
      return { text }
    },
  }
}
