export type TelemetryInputState = {
  focusMode: string
}

export type TelemetryRawKey = {
  name: string
  sequence?: string
}

export function telemetryKeyFromRawSequence(sequence: string): TelemetryRawKey | undefined {
  if (sequence === "\x1b") return { name: "escape", sequence }
  if (sequence.length !== 1) return undefined
  if (!["g", "n", "r"].includes(sequence)) return undefined
  return { name: sequence, sequence }
}

export function telemetryKeyFromRawModalChunk(sequence: string): TelemetryRawKey | undefined {
  const direct = telemetryKeyFromRawSequence(sequence)
  if (direct) return direct
  const lowered = sequence.toLowerCase()
  const candidates = [
    { name: "g", index: lowered.indexOf("grant") },
    { name: "n", index: lowered.indexOf("decline") },
  ].filter((candidate) => candidate.index >= 0)
  candidates.sort((left, right) => left.index - right.index)
  const first = candidates[0]
  if (first) {
    return { name: first.name, sequence }
  }
  return undefined
}

export function telemetryModalCapturesRawInput(state: TelemetryInputState): boolean {
  return state.focusMode === "telemetry"
}
