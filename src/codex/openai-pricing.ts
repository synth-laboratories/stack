import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { CodexModelPricing } from "./usage-cost.js"
import { defaultCodexPricing } from "./usage-cost.js"

export type OpenAiPricingCache = {
  fetchedAt: string
  source: "openai"
  models: CodexModelPricing[]
}

export type OpenAiPricingLoadResult = {
  rows: CodexModelPricing[]
  source: "openai" | "cache" | "fallback" | "config"
  fetchedAt?: string
}

const OPENAI_MODEL_DOC_BASE = "https://developers.openai.com/api/docs/models"
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000

export function openAiPricingCachePath(appRoot: string): string {
  return join(appRoot, ".stack", "cache", "openai-pricing.json")
}

export async function loadOpenAiPricing(options: {
  appRoot: string
  models: readonly string[]
  configOverrides?: readonly CodexModelPricing[]
  cacheTtlMs?: number
  forceRefresh?: boolean
}): Promise<OpenAiPricingLoadResult> {
  const cachePath = openAiPricingCachePath(options.appRoot)
  const ttlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
  const overrides = options.configOverrides ?? []

  if (!options.forceRefresh) {
    const cached = await readPricingCache(cachePath, ttlMs)
    if (cached) {
      return {
        rows: mergePricingRows(cached.models, overrides),
        source: "cache",
        fetchedAt: cached.fetchedAt,
      }
    }
  }

  const fetched = await fetchOpenAiPricingForModels(options.models)
  if (fetched.length > 0) {
    await writePricingCache(cachePath, fetched)
    return {
      rows: mergePricingRows(fetched, overrides),
      source: "openai",
      fetchedAt: new Date().toISOString(),
    }
  }

  if (overrides.length > 0) {
    return {
      rows: mergePricingRows(defaultCodexPricing(), overrides),
      source: "config",
    }
  }

  return {
    rows: defaultCodexPricing(),
    source: "fallback",
  }
}

export async function fetchOpenAiPricingForModels(models: readonly string[]): Promise<CodexModelPricing[]> {
  const unique = [...new Set(models.map((model) => model.trim()).filter(Boolean))]
  const rows = await Promise.all(unique.map((model) => fetchOpenAiModelPricing(model)))
  return rows.filter((row): row is CodexModelPricing => Boolean(row))
}

export async function fetchOpenAiModelPricing(model: string): Promise<CodexModelPricing | undefined> {
  const slug = model.trim().toLowerCase()
  if (!slug) return undefined

  let response: Response
  try {
    response = await fetch(`${OPENAI_MODEL_DOC_BASE}/${encodeURIComponent(slug)}`, {
      headers: { Accept: "text/html" },
    })
  } catch {
    return undefined
  }
  if (!response.ok) return undefined

  const html = await response.text()
  return parseOpenAiModelDocPricing(slug, html)
}

export function parseOpenAiModelDocPricing(model: string, html: string): CodexModelPricing | undefined {
  const inputPerMillion = parsePriceLabel(html, "Input")
  const cachedInputPerMillion = parsePriceLabel(html, "Cached input")
  const outputPerMillion = parsePriceLabel(html, "Output")
  if (
    inputPerMillion === undefined ||
    cachedInputPerMillion === undefined ||
    outputPerMillion === undefined
  ) {
    return undefined
  }
  return {
    model,
    inputPerMillion,
    cachedInputPerMillion,
    outputPerMillion,
  }
}

export function mergePricingRows(
  base: readonly CodexModelPricing[],
  overrides: readonly CodexModelPricing[],
): CodexModelPricing[] {
  const merged = new Map<string, CodexModelPricing>()
  for (const row of base) merged.set(row.model.toLowerCase(), { ...row })
  for (const row of overrides) merged.set(row.model.toLowerCase(), { ...row })
  return [...merged.values()].sort((left, right) => left.model.localeCompare(right.model))
}

function parsePriceLabel(html: string, label: string): number | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const pattern = new RegExp(
    `<div>${escaped}</div><div class="text-2xl font-semibold">\\$([0-9]+(?:\\.[0-9]+)?)</div>`,
  )
  const match = html.match(pattern)
  if (!match?.[1]) return undefined
  const value = Number.parseFloat(match[1])
  return Number.isFinite(value) ? value : undefined
}

async function readPricingCache(cachePath: string, ttlMs: number): Promise<OpenAiPricingCache | undefined> {
  if (!existsSync(cachePath)) return undefined
  let parsed: OpenAiPricingCache
  try {
    parsed = JSON.parse(await readFile(cachePath, "utf8")) as OpenAiPricingCache
  } catch {
    return undefined
  }
  if (!parsed.fetchedAt || !Array.isArray(parsed.models) || parsed.models.length === 0) return undefined
  const ageMs = Date.now() - Date.parse(parsed.fetchedAt)
  if (!Number.isFinite(ageMs) || ageMs > ttlMs) return undefined
  return parsed
}

async function writePricingCache(cachePath: string, models: CodexModelPricing[]): Promise<void> {
  await mkdir(dirname(cachePath), { recursive: true })
  const payload: OpenAiPricingCache = {
    fetchedAt: new Date().toISOString(),
    source: "openai",
    models,
  }
  await writeFile(cachePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}
