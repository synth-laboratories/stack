import { existsSync, readFileSync } from "node:fs"
import { basename, extname } from "node:path"
import { homedir } from "node:os"

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".heic", ".heif"])

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".heic": "image/heic",
  ".heif": "image/heif",
}

export type CodexTurnInputPart =
  | { type: "text"; text: string; text_elements: [] }
  | { type: "local_image"; path: string }

export type AcpPromptPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string; uri?: string }

export type ParsedChannelInput = {
  text: string
  imagePaths: string[]
  displayText: string
  missingPaths: string[]
}

export function isImageFilePath(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  return IMAGE_EXTENSIONS.has(extname(trimmed).toLowerCase())
}

export function expandHomePath(value: string): string {
  if (value.startsWith("~/")) return `${homedir()}${value.slice(1)}`
  return value
}

export function normalizeImageReference(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(trimmed).pathname)
    } catch {
      return trimmed.slice("file://".length)
    }
  }
  return expandHomePath(trimmed)
}

export function isFilePathLikeSlashInput(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed.startsWith("/") && !trimmed.startsWith("~/")) return false
  const token = trimmed.split(/\s/)[0] ?? trimmed
  if (isImageFilePath(token)) return true
  const normalized = normalizeImageReference(token)
  if (normalized.includes("/") && normalized.split("/").filter(Boolean).length >= 2) {
    if (existsSync(normalized)) return true
    if (isImageFilePath(normalized)) return true
  }
  return false
}

export function resolveImagePath(candidate: string): string | undefined {
  const normalized = normalizeImageReference(candidate)
  if (!normalized || !isImageFilePath(normalized)) return undefined
  if (!existsSync(normalized)) return undefined
  return normalized
}

export function parseChannelInput(raw: string): ParsedChannelInput {
  const lines = raw.replace(/\r\n/g, "\n").split("\n")
  const imagePaths: string[] = []
  const missingPaths: string[] = []
  const textLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      textLines.push("")
      continue
    }
    const resolved = resolveImagePath(trimmed)
    if (resolved) {
      if (!imagePaths.includes(resolved)) imagePaths.push(resolved)
      continue
    }
    if (isImageFilePath(trimmed) && (trimmed.startsWith("/") || trimmed.startsWith("~/") || trimmed.startsWith("file://"))) {
      const normalized = normalizeImageReference(trimmed)
      if (!missingPaths.includes(normalized)) missingPaths.push(normalized)
      continue
    }
    textLines.push(line)
  }

  const text = textLines.join("\n").trim()
  const displayText = formatChannelDisplayText(text, imagePaths, missingPaths)
  return { text, imagePaths, displayText, missingPaths }
}

export function formatChannelDisplayText(
  text: string,
  imagePaths: readonly string[],
  missingPaths: readonly string[] = [],
): string {
  const labels = [
    ...imagePaths.map((path) => `[Image] ${basename(path)}`),
    ...missingPaths.map((path) => `[Image missing] ${basename(path)}`),
  ]
  if (labels.length === 0) return text
  if (!text) return labels.join("\n")
  return `${text}\n${labels.join("\n")}`
}

export function buildCodexTurnInputParts(text: string, imagePaths: readonly string[]): CodexTurnInputPart[] {
  const parts: CodexTurnInputPart[] = []
  const trimmed = text.trim()
  if (trimmed) parts.push({ type: "text", text: trimmed, text_elements: [] })
  for (const path of imagePaths) {
    parts.push({ type: "local_image", path })
  }
  if (parts.length === 0) {
    parts.push({ type: "text", text: "(image attached)", text_elements: [] })
  }
  return parts
}

export function readImageForAcp(path: string): { data: string; mimeType: string; uri: string } | undefined {
  const resolved = resolveImagePath(path)
  if (!resolved) return undefined
  try {
    const data = readFileSync(resolved).toString("base64")
    const mimeType = MIME_BY_EXT[extname(resolved).toLowerCase()] ?? "application/octet-stream"
    return { data, mimeType, uri: `file://${resolved}` }
  } catch {
    return undefined
  }
}

export function buildAcpPromptParts(text: string, imagePaths: readonly string[]): AcpPromptPart[] {
  const parts: AcpPromptPart[] = []
  const trimmed = text.trim()
  if (trimmed) parts.push({ type: "text", text: trimmed })
  for (const path of imagePaths) {
    const image = readImageForAcp(path)
    if (image) {
      parts.push({ type: "image", data: image.data, mimeType: image.mimeType, uri: image.uri })
    }
  }
  if (parts.length === 0) parts.push({ type: "text", text: "(image attached)" })
  return parts
}

export function formatHarnessImageContext(imagePaths: readonly string[]): string {
  if (imagePaths.length === 0) return "(none)"
  return imagePaths.map((path) => `- ${path}`).join("\n")
}
