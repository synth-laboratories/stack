const BRACKETED_PASTE_START = "\x1b[200~"
const BRACKETED_PASTE_END = "\x1b[201~"

export const ENABLE_BRACKETED_PASTE = "\x1b[?2004h"
export const DISABLE_BRACKETED_PASTE = "\x1b[?2004l"

export type BracketedPasteFeed = {
  accumulator: string
  paste: string | null
  prefix: string
  suffix: string
}

export function normalizePasteText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

export function feedBracketedPaste(accumulator: string, sequence: string): BracketedPasteFeed {
  if (accumulator) {
    const combined = `${accumulator}${sequence}`
    const endIdx = combined.indexOf(BRACKETED_PASTE_END)
    if (endIdx === -1) {
      return { accumulator: combined, paste: null, prefix: "", suffix: "" }
    }
    const paste = normalizePasteText(combined.slice(0, endIdx))
    const suffix = combined.slice(endIdx + BRACKETED_PASTE_END.length)
    return { accumulator: "", paste, prefix: "", suffix }
  }

  const startIdx = sequence.indexOf(BRACKETED_PASTE_START)
  if (startIdx === -1) {
    return { accumulator: "", paste: null, prefix: sequence, suffix: "" }
  }

  const prefix = sequence.slice(0, startIdx)
  const rest = sequence.slice(startIdx + BRACKETED_PASTE_START.length)
  const endIdx = rest.indexOf(BRACKETED_PASTE_END)
  if (endIdx === -1) {
    return { accumulator: rest, paste: null, prefix, suffix: "" }
  }

  const paste = normalizePasteText(rest.slice(0, endIdx))
  const suffix = rest.slice(endIdx + BRACKETED_PASTE_END.length)
  return { accumulator: "", paste, prefix, suffix }
}

export function splitSubmitLines(prompt: string): string[] {
  return normalizePasteText(prompt)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export function isEditableInputChunk(sequence: string): boolean {
  if (!sequence) return false
  for (const char of sequence) {
    const code = char.codePointAt(0)
    if (code === undefined) return false
    if (code === 9 || code === 10 || code === 13) continue
    if (code < 32 || code === 127) return false
  }
  return true
}

export function isRawEnterSequence(sequence: string): boolean {
  return (
    sequence === "\r" ||
    sequence === "\n" ||
    sequence === "\r\n" ||
    sequence === "\x1bOM" ||
    sequence === "\x1b[13~"
  )
}

export function isRawNewlineSequence(sequence: string): boolean {
  return sequence === "\n" || sequence === "\x0a"
}

export type RawTextInputOptions = {
  sequence: string
  readBuffer: () => string
  writeBuffer: (next: string) => void
  submit: () => boolean
  refresh: () => void
  deferSequence?: (sequence: string) => boolean
  blockWhileRunning?: boolean
  isRunning?: boolean
}

export function handleRawTextInputSequence(input: RawTextInputOptions): boolean {
  const { sequence } = input
  if (!sequence) return false
  if (input.deferSequence?.(sequence)) return false

  if (isRawNewlineSequence(sequence)) {
    input.writeBuffer(input.readBuffer() + "\n")
    input.refresh()
    return true
  }

  if (isRawEnterSequence(sequence)) {
    return input.submit()
  }

  if (sequence === "\t" || sequence === "\x1b") return false

  if (
    input.blockWhileRunning &&
    input.isRunning &&
    sequence !== "\x7f" &&
    sequence !== "\b" &&
    !isEditableInputChunk(sequence)
  ) {
    return false
  }

  if (sequence === "\x7f" || sequence === "\b") {
    input.writeBuffer(input.readBuffer().slice(0, -1))
    input.refresh()
    return true
  }

  if (!isEditableInputChunk(sequence)) return false

  input.writeBuffer(input.readBuffer() + normalizePasteText(sequence))
  input.refresh()
  return true
}

export function shouldTrackBracketedPaste(sequence: string, accumulator?: string): boolean {
  return Boolean(accumulator) || sequence.includes(BRACKETED_PASTE_START) || sequence.includes(BRACKETED_PASTE_END)
}

export function consumeBracketedPasteSequences(
  accumulator: string | undefined,
  sequence: string,
  onPaste: (paste: string) => void,
  onChunk: (chunk: string) => boolean,
): { accumulator?: string; handled: boolean } {
  const feed = feedBracketedPaste(accumulator ?? "", sequence)
  let handled = false

  if (feed.accumulator) {
    return { accumulator: feed.accumulator, handled: true }
  }

  if (feed.paste !== null) {
    onPaste(feed.paste)
    handled = true
  }

  if (feed.prefix) {
    handled = onChunk(feed.prefix) || handled
  }

  if (feed.suffix) {
    const nested = consumeBracketedPasteSequences(undefined, feed.suffix, onPaste, onChunk)
    handled = nested.handled || handled
  }

  return { accumulator: feed.accumulator || undefined, handled }
}
