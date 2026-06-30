import { existsSync, readFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"

export type ActorPromptConfig = {
  system?: string
  systemFile?: string
}

export type ActorModelConfig = {
  provider: string
  model: string
  reasoningEffort: string
  worker: "auto" | "deterministic" | "openai_responses" | "codex_app_server"
}

export type ActorToolsConfig = {
  allow: string[]
  deny: string[]
}

export type ParsedTomlSections = Record<string, Record<string, unknown>>

export function parseTomlLike(text: string): ParsedTomlSections {
  const result: ParsedTomlSections = {}
  let section = "monitor"
  result[section] = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim()
    if (!line) continue
    const sectionMatch = /^\[([A-Za-z0-9_.-]+)]$/.exec(line)
    if (sectionMatch?.[1]) {
      section = sectionMatch[1]
      result[section] ??= {}
      continue
    }
    const match = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line)
    if (!match?.[1] || match[2] === undefined) continue
    result[section] ??= {}
    result[section][match[1]] = parseTomlValue(match[2].trim())
  }
  return result
}

export function readTomlProfile(
  stackRoot: string,
  subdir: "monitors" | "gardeners",
  profile: string,
): ParsedTomlSections {
  const path = join(stackRoot, ".stack", subdir, `${profile}.toml`)
  if (!existsSync(path)) return {}
  return parseTomlLike(readFileSync(path, "utf8"))
}

export function resolveActorPrompt(
  stackRoot: string,
  prompt: ActorPromptConfig,
  fallback: string,
): string {
  const filePath = prompt.systemFile?.trim()
    || (prompt.system?.trim().endsWith(".md") || prompt.system?.trim().endsWith(".txt")
      ? prompt.system.trim()
      : undefined)
  if (filePath) {
    const absolute = isAbsolute(filePath) ? filePath : join(stackRoot, filePath)
    if (existsSync(absolute)) return readFileSync(absolute, "utf8").trim()
  }
  if (prompt.system?.trim() && !filePath) return prompt.system.trim()
  return fallback
}

export function mergeActorPrompt(
  base: ActorPromptConfig,
  parsed: ParsedTomlSections,
): ActorPromptConfig {
  return {
    system: readString(parsed.prompt?.system) ?? base.system,
    systemFile: readString(parsed.prompt?.system_file) ?? base.systemFile,
  }
}

export function mergeActorModel(
  base: ActorModelConfig,
  parsed: ParsedTomlSections,
): ActorModelConfig {
  return {
    provider: readString(parsed.model?.provider) ?? base.provider,
    model: readString(parsed.model?.model) ?? base.model,
    reasoningEffort: readString(parsed.model?.reasoning_effort) ?? base.reasoningEffort,
    worker: normalizeModelWorker(readString(parsed.model?.worker), base.worker),
  }
}

export function mergeActorTools(
  base: ActorToolsConfig,
  parsed: ParsedTomlSections,
): ActorToolsConfig {
  return {
    allow: readStringArray(parsed.tools?.allow) ?? base.allow,
    deny: readStringArray(parsed.tools?.deny) ?? base.deny,
  }
}

export function actorToolAllowed(tools: ActorToolsConfig, toolId: string): boolean {
  if (tools.deny.includes(toolId)) return false
  if (tools.allow.length === 0) return true
  return tools.allow.includes(toolId)
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

export function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

export function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return undefined
  return value
}

function parseTomlValue(raw: string): unknown {
  if (raw === "true") return true
  if (raw === "false") return false
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(",").map((part) => trimQuotes(part.trim()))
  }
  return trimQuotes(raw)
}

function stripTomlComment(line: string): string {
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') quoted = !quoted
    if (char === "#" && !quoted) return line.slice(0, index)
  }
  return line
}

function trimQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

function normalizeModelWorker(
  value: string | undefined,
  fallback: "auto" | "deterministic" | "openai_responses" | "codex_app_server",
): "auto" | "deterministic" | "openai_responses" | "codex_app_server" {
  if (
    value === "auto" ||
    value === "deterministic" ||
    value === "openai_responses" ||
    value === "codex_app_server"
  ) return value
  return fallback
}
