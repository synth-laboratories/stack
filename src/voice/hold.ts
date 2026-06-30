export const MIN_VOICE_HOLD_MS = 450
export const MIN_VOICE_TRANSCRIPT_CHARS = 4

export function voiceHoldElapsedMs(startedAtIso: string | undefined): number {
  if (!startedAtIso) return 0
  const started = Date.parse(startedAtIso)
  if (!Number.isFinite(started)) return 0
  return Math.max(0, Date.now() - started)
}

export function isLikelyJunkVoiceTranscript(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (normalized.length < MIN_VOICE_TRANSCRIPT_CHARS) return true
  const junk = new Set([
    "thank you",
    "thanks",
    "mm hmm",
    "mm-hmm",
    "mmm",
    "uh",
    "um",
    "hmm",
    "okay",
    "ok",
    "you",
    "bye",
    "hello",
  ])
  return junk.has(normalized)
}
