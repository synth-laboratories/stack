import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

export const STACK_PROFILE_OPTIONS = ["default", "research", "engineering", "product"] as const
export type StackProfileName = (typeof STACK_PROFILE_OPTIONS)[number]

export const DEFAULT_STACK_PROFILE: StackProfileName = "engineering"

export type StackProfileDefaults = {
  codexModel: string
  codexReasoningEffort: string
}

export const STACK_PROFILE_DEFAULTS: Record<StackProfileName, StackProfileDefaults> = {
  default: {
    codexModel: "gpt-5.4-mini",
    codexReasoningEffort: "medium",
  },
  research: {
    codexModel: "gpt-5.5",
    codexReasoningEffort: "high",
  },
  engineering: {
    codexModel: "gpt-5.4-mini",
    codexReasoningEffort: "medium",
  },
  product: {
    codexModel: "gpt-5.5",
    codexReasoningEffort: "medium",
  },
}

export type StackProfileState = {
  active: StackProfileName
  path: string
  explicit: boolean
}

export function stackProfileConfigPath(stackRoot: string): string {
  return join(stackRoot, ".stack", "config", "profile.json")
}

export function normalizeStackProfileName(value: string | undefined): StackProfileName | undefined {
  const normalized = value?.trim().toLowerCase()
  return STACK_PROFILE_OPTIONS.find((option) => option === normalized)
}

type CachedStackProfile = {
  mtimeMs: number
  size: number
  state: StackProfileState
}

const stackProfileCache = new Map<string, CachedStackProfile>()

export function readStackProfile(stackRoot: string): StackProfileState {
  const path = stackProfileConfigPath(stackRoot)
  if (!existsSync(path)) {
    stackProfileCache.delete(path)
    return { active: DEFAULT_STACK_PROFILE, path, explicit: false }
  }

  const stats = statSync(path)
  const cached = stackProfileCache.get(path)
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    return { ...cached.state }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`profile config is invalid JSON: ${path}: ${message}`)
  }

  const active = normalizeStackProfileName(
    typeof parsed === "object" && parsed !== null && "active" in parsed
      ? String(parsed.active)
      : undefined,
  )
  if (!active) {
    throw new Error(`profile config active must be one of: ${STACK_PROFILE_OPTIONS.join(", ")} (${path})`)
  }

  const state = { active, path, explicit: true }
  stackProfileCache.set(path, { mtimeMs: stats.mtimeMs, size: stats.size, state })
  return { ...state }
}

export function writeStackProfile(stackRoot: string, active: StackProfileName): StackProfileState {
  const path = stackProfileConfigPath(stackRoot)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ active }, null, 2)}\n`, "utf8")
  const stats = statSync(path)
  const state = { active, path, explicit: true }
  stackProfileCache.set(path, { mtimeMs: stats.mtimeMs, size: stats.size, state })
  return { ...state }
}

export function nextStackProfile(current: StackProfileName, direction = 1): StackProfileName {
  const index = STACK_PROFILE_OPTIONS.indexOf(current)
  const next = (index + direction + STACK_PROFILE_OPTIONS.length) % STACK_PROFILE_OPTIONS.length
  return STACK_PROFILE_OPTIONS[next] ?? DEFAULT_STACK_PROFILE
}
