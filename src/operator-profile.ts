import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

export const STACK_PROFILE_OPTIONS = ["research", "engineering", "product"] as const
export type StackProfileName = (typeof STACK_PROFILE_OPTIONS)[number]

export const DEFAULT_STACK_PROFILE: StackProfileName = "engineering"

export type StackProfileDefaults = {
  codexModel: string
  codexReasoningEffort: string
}

export const STACK_PROFILE_DEFAULTS: Record<StackProfileName, StackProfileDefaults> = {
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

export function readStackProfile(stackRoot: string): StackProfileState {
  const path = stackProfileConfigPath(stackRoot)
  if (!existsSync(path)) {
    return { active: DEFAULT_STACK_PROFILE, path, explicit: false }
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

  return { active, path, explicit: true }
}

export function writeStackProfile(stackRoot: string, active: StackProfileName): StackProfileState {
  const path = stackProfileConfigPath(stackRoot)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ active }, null, 2)}\n`, "utf8")
  return { active, path, explicit: true }
}

export function nextStackProfile(current: StackProfileName, direction = 1): StackProfileName {
  const index = STACK_PROFILE_OPTIONS.indexOf(current)
  const next = (index + direction + STACK_PROFILE_OPTIONS.length) % STACK_PROFILE_OPTIONS.length
  return STACK_PROFILE_OPTIONS[next] ?? DEFAULT_STACK_PROFILE
}
