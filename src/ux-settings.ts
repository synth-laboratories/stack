import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

export const DEFAULT_RIGHT_PANEL_WIDTH_FRACTION = 0.28
export const MIN_RIGHT_PANEL_WIDTH_FRACTION = 0.18
export const MAX_RIGHT_PANEL_WIDTH_FRACTION = 0.45

export const LIGHTS_PANEL_SECTION_IDS = [
  "threads",
  "efforts",
  "gardeners",
  "workflows",
  "actors",
  "cloud",
  "local",
  "sessions",
  "usage",
] as const

export type LightsPanelSectionId = (typeof LIGHTS_PANEL_SECTION_IDS)[number]

export type StackUxSettings = {
  rightPanelWidthFraction: number
  lightsCollapsedSections: LightsPanelSectionId[]
  lightsPanelOpen: boolean
  /** When true, the Lights panel shows only Threads (no gardeners/actors/cloud/local/usage). */
  lightsThreadsOnly: boolean
  /** Stack Effort slug tagged to the worker panel; null hides the badge. */
  taggedEffortSlug: string | null
}

export function normalizeTaggedEffortSlug(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeLightsCollapsedSections(value: unknown): LightsPanelSectionId[] {
  if (!Array.isArray(value)) return []
  const allowed = new Set<string>(LIGHTS_PANEL_SECTION_IDS)
  return value.filter((id): id is LightsPanelSectionId => typeof id === "string" && allowed.has(id))
}

export function stackUxSettingsPath(stackRoot: string): string {
  return join(stackRoot, ".stack", "config", "ux.json")
}

export function clampRightPanelWidthFraction(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_RIGHT_PANEL_WIDTH_FRACTION
  return Math.min(
    MAX_RIGHT_PANEL_WIDTH_FRACTION,
    Math.max(MIN_RIGHT_PANEL_WIDTH_FRACTION, value),
  )
}

export function readStackUxSettings(stackRoot: string): StackUxSettings {
  const path = stackUxSettingsPath(stackRoot)
  if (!existsSync(path)) {
    return {
      rightPanelWidthFraction: DEFAULT_RIGHT_PANEL_WIDTH_FRACTION,
      lightsCollapsedSections: [],
      lightsPanelOpen: false,
      lightsThreadsOnly: false,
      taggedEffortSlug: null,
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return {
      rightPanelWidthFraction: DEFAULT_RIGHT_PANEL_WIDTH_FRACTION,
      lightsCollapsedSections: [],
      lightsPanelOpen: false,
      lightsThreadsOnly: false,
      taggedEffortSlug: null,
    }
  }

  const record = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {}
  const raw =
    "rightPanelWidthFraction" in record
      ? Number(record.rightPanelWidthFraction)
      : DEFAULT_RIGHT_PANEL_WIDTH_FRACTION

  return {
    rightPanelWidthFraction: clampRightPanelWidthFraction(raw),
    lightsCollapsedSections: normalizeLightsCollapsedSections(record.lightsCollapsedSections),
    lightsPanelOpen: record.lightsPanelOpen === true,
    lightsThreadsOnly: record.lightsThreadsOnly === true,
    taggedEffortSlug: normalizeTaggedEffortSlug(record.taggedEffortSlug),
  }
}

export function writeStackUxSettings(stackRoot: string, patch: Partial<StackUxSettings>): void {
  const current = readStackUxSettings(stackRoot)
  const path = stackUxSettingsPath(stackRoot)
  mkdirSync(dirname(path), { recursive: true })
  const normalized: StackUxSettings = {
    rightPanelWidthFraction: clampRightPanelWidthFraction(
      patch.rightPanelWidthFraction ?? current.rightPanelWidthFraction,
    ),
    lightsCollapsedSections: patch.lightsCollapsedSections ?? current.lightsCollapsedSections,
    lightsPanelOpen: patch.lightsPanelOpen ?? current.lightsPanelOpen,
    lightsThreadsOnly: patch.lightsThreadsOnly ?? current.lightsThreadsOnly,
    taggedEffortSlug:
      patch.taggedEffortSlug !== undefined
        ? normalizeTaggedEffortSlug(patch.taggedEffortSlug)
        : current.taggedEffortSlug,
  }
  writeFileSync(path, `${JSON.stringify(normalized, null, 2)}\n`, "utf8")
}

export function rightPanelFractionFromMouseX(terminalWidth: number, mouseX: number): number {
  const width = Math.max(1, terminalWidth)
  const clampedX = Math.max(0, Math.min(width - 1, mouseX))
  const panelWidth = width - clampedX
  return clampRightPanelWidthFraction(panelWidth / width)
}
