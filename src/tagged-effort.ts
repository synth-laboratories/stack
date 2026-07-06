import { listEfforts, readEffort, resolveEffortShortTitle, type StackEffortSummary } from "./effort.js"
import type { StackConfig } from "./config.js"
import { readStackUxSettings, writeStackUxSettings, normalizeTaggedEffortSlug } from "./ux-settings.js"

export function readTaggedEffortSlug(stackDataRoot: string): string | null {
  return readEvalTaggedEffortSlug() ?? normalizeTaggedEffortSlug(readStackUxSettings(stackDataRoot).taggedEffortSlug)
}

export function writeTaggedEffortSlug(stackDataRoot: string, slug: string | null): void {
  writeStackUxSettings(stackDataRoot, { taggedEffortSlug: normalizeTaggedEffortSlug(slug) })
}

export type TaggedEffortOption = {
  slug: string | null
  label: string
}

export function effortSummaryLabel(effort: StackEffortSummary): string {
  return effort.short_title
}

export function listTaggedEffortOptions(config: StackConfig): TaggedEffortOption[] {
  const efforts = listEfforts({
    stackDataRoot: config.stackDataRoot,
    workspaceRoot: config.workspaceRoot,
  }).sort((left, right) => right.updated_at.localeCompare(left.updated_at))
  return [
    { slug: null, label: "none (turn off active)" },
    ...efforts.map((effort) => ({
      slug: effort.slug,
      label: `${effort.short_title} · ${effort.slug}`,
    })),
  ]
}

export function taggedEffortOptionLabel(effort: StackEffortSummary): string {
  return effort.short_title
}

export function taggedEffortDisplayLabel(config: StackConfig, slug: string | null): string {
  if (!slug) return "none"
  const effort = readEffort(
    {
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
    },
    slug,
  )
  if (!effort) return slug.slice(0, 10)
  return resolveEffortShortTitle(effort.manifest)
}

export function effortIsActiveOn(activeSlug: string | null, effortSlug: string): boolean {
  return activeSlug !== null && activeSlug === effortSlug
}

export function activeEffortBarLabel(config: StackConfig, slug: string | null): string {
  if (!slug) return "active: none"
  return `active: ${taggedEffortDisplayLabel(config, slug)}`
}

export function applyEvalTaggedEffortFromEnv(stackDataRoot: string): string | null {
  return readEvalTaggedEffortSlug() ?? readTaggedEffortSlug(stackDataRoot)
}

function readEvalTaggedEffortSlug(): string | null {
  return normalizeTaggedEffortSlug(process.env.STACKEVAL_EFFORT_SLUG)
}
