import { existsSync, readFileSync, readdirSync, type Dirent } from "node:fs"
import { basename, join, relative } from "node:path"
import {
  orgStyleDirs,
  orgSynthStyleFiles,
  personalGuidanceRoot,
  repoStyleDir,
  workspaceStyleFile,
  type StackStyleLayer,
} from "./guidance-layers.js"

export type { StackStyleLayer } from "./guidance-layers.js"
export type StackGuidanceScope = "style" | "records" | "workflows" | "all"
export type StackGuidanceOrigin = "stack" | "workspace" | "personal"

export type StackGuidanceItem = {
  guidanceId: string
  title: string
  description: string
  sourcePath: string
  rootPath: string
  relativePath: string
  scope: Exclude<StackGuidanceScope, "all">
  origin: StackGuidanceOrigin
  styleLayer?: StackStyleLayer
}

export type StackGuidanceRead = {
  item: StackGuidanceItem
  content: string
  truncated: boolean
}

export function stackGuidanceRoot(stackRoot: string): string {
  return join(stackRoot, ".stack", "guidance")
}

export function discoverStackGuidance(
  stackRoot: string,
  options: { workspaceRoot?: string; scope?: StackGuidanceScope; styleLayer?: StackStyleLayer } = {},
): StackGuidanceItem[] {
  const items = new Map<string, StackGuidanceItem>()
  const workspaceRoot = options.workspaceRoot ?? stackRoot
  const add = (item: StackGuidanceItem) => {
    if (!scopeMatches(item, options.scope)) return
    if (!styleLayerMatches(item, options.styleLayer)) return
    if (!items.has(item.guidanceId)) items.set(item.guidanceId, item)
  }

  const localRoot = stackGuidanceRoot(stackRoot)
  for (const path of findMarkdownFiles(localRoot)) {
    add(guidanceFromPath(path, localRoot, "stack", styleLayerForStackPath(path, localRoot, workspaceRoot)))
  }

  for (const path of orgSynthStyleFiles(workspaceRoot)) {
    if (existsSync(path)) add(guidanceFromPath(path, workspaceRoot, "workspace", "org"))
  }
  for (const root of orgStyleDirs(workspaceRoot)) {
    for (const path of findMarkdownFiles(root)) {
      add(guidanceFromPath(path, workspaceRoot, "workspace", "org"))
    }
  }

  const personalRoot = personalGuidanceRoot()
  for (const path of findMarkdownFiles(join(personalRoot, "style"))) {
    add(guidanceFromPath(path, personalRoot, "personal", "personal"))
  }
  for (const path of findMarkdownFiles(join(personalRoot, "records"))) {
    add(guidanceFromPath(path, personalRoot, "personal", undefined))
  }

  const repoStyle = workspaceStyleFile(workspaceRoot)
  if (existsSync(repoStyle)) {
    add(guidanceFromPath(repoStyle, workspaceRoot, "workspace", "repo"))
  }
  for (const path of findMarkdownFiles(repoStyleDir(workspaceRoot))) {
    add(guidanceFromPath(path, workspaceRoot, "workspace", "repo"))
  }

  return [...items.values()].sort((left, right) => left.guidanceId.localeCompare(right.guidanceId))
}

export function readStackGuidance(
  stackRoot: string,
  guidanceId: string,
  options: { workspaceRoot?: string; maxBytes?: number } = {},
): StackGuidanceRead | undefined {
  const item = discoverStackGuidance(stackRoot, { workspaceRoot: options.workspaceRoot }).find(
    (candidate) =>
      candidate.guidanceId === guidanceId ||
      candidate.sourcePath === guidanceId ||
      candidate.relativePath === guidanceId,
  )
  if (!item) return undefined
  const maxBytes = options.maxBytes ?? 50_000
  const buffer = readFileSync(item.sourcePath)
  const truncated = buffer.byteLength > maxBytes
  return {
    item,
    content: buffer.subarray(0, Math.max(0, maxBytes)).toString("utf8"),
    truncated,
  }
}

export function searchStackGuidance(
  stackRoot: string,
  query: string,
  options: {
    workspaceRoot?: string
    scope?: StackGuidanceScope
    styleLayer?: StackStyleLayer
    limit?: number
    maxExcerptBytes?: number
  } = {},
): Array<StackGuidanceItem & { score: number; excerpt: string }> {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const maxExcerptBytes = options.maxExcerptBytes ?? 600
  const scored = discoverStackGuidance(stackRoot, {
    workspaceRoot: options.workspaceRoot,
    scope: options.scope,
    styleLayer: options.styleLayer,
  })
    .map((item) => scoreGuidanceItem(item, terms, maxExcerptBytes))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.guidanceId.localeCompare(right.guidanceId))
  return scored.slice(0, options.limit ?? 20)
}

export function guidanceToJson(item: StackGuidanceItem): Record<string, string> {
  return {
    guidance_id: item.guidanceId,
    title: item.title,
    description: item.description,
    source_path: item.sourcePath,
    root_path: item.rootPath,
    relative_path: item.relativePath,
    scope: item.scope,
    origin: item.origin,
    ...(item.styleLayer ? { style_layer: item.styleLayer } : {}),
  }
}

function guidanceFromPath(
  path: string,
  rootPath: string,
  origin: StackGuidanceOrigin,
  styleLayer?: StackStyleLayer,
): StackGuidanceItem {
  const relativePath = relative(rootPath, path)
  const guidanceId = guidanceIdFor(path, rootPath, origin, styleLayer)
  const { title, description } = readMarkdownTitle(path)
  return {
    guidanceId,
    title: title ?? stripMarkdownExtension(basename(path)),
    description: description ?? "",
    sourcePath: path,
    rootPath,
    relativePath,
    scope: scopeFromRelativePath(relativePath, styleLayer),
    origin,
    styleLayer,
  }
}

function findMarkdownFiles(root: string): string[] {
  const results: string[] = []
  walkMarkdownRoot(root, results)
  return results
}

function walkMarkdownRoot(dir: string, results: string[]): void {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      walkMarkdownRoot(full, results)
      continue
    }
    if (entry.isFile() && entry.name.endsWith(".md")) results.push(full)
  }
}

function scoreGuidanceItem(
  item: StackGuidanceItem,
  terms: string[],
  maxExcerptBytes: number,
): StackGuidanceItem & { score: number; excerpt: string } {
  let content = ""
  try {
    content = readFileSync(item.sourcePath, "utf8")
  } catch {
    return { ...item, score: 0, excerpt: "" }
  }
  const haystack = [
    item.guidanceId,
    item.title,
    item.description,
    item.relativePath,
    item.origin,
    item.scope,
    item.styleLayer ?? "",
    content,
  ].join("\n").toLowerCase()
  const score = terms.length === 0
    ? 1
    : terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0)
  return { ...item, score, excerpt: excerptForTerms(content, terms, maxExcerptBytes) }
}

function excerptForTerms(content: string, terms: string[], maxBytes: number): string {
  const normalizedMax = Math.max(0, maxBytes)
  if (normalizedMax === 0) return ""
  const lower = content.toLowerCase()
  const firstHit = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0
  const start = Math.max(0, firstHit - Math.floor(normalizedMax / 3))
  const slice = Buffer.from(content.slice(start)).subarray(0, normalizedMax).toString("utf8")
  return `${start > 0 ? "..." : ""}${slice}${Buffer.byteLength(content.slice(start), "utf8") > normalizedMax ? "..." : ""}`
}

function readMarkdownTitle(path: string): { title?: string; description?: string } {
  try {
    const content = readFileSync(path, "utf8")
    const title = content.split(/\r?\n/).find((line) => line.startsWith("# "))?.slice(2).trim()
    const description = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#") && !line.startsWith("---") && !line.startsWith("STACK_MEMORY"))
    return { title, description }
  } catch {
    return {}
  }
}

function scopeFromRelativePath(relativePath: string, styleLayer?: StackStyleLayer): Exclude<StackGuidanceScope, "all"> {
  const normalized = relativePath.replace(/\\/g, "/")
  if (styleLayer === "personal" && normalized.startsWith("records/")) return "records"
  const first = normalized.split("/")[0]
  if (first === "style" || first === "records" || first === "workflows") return first
  if (normalized === "STYLE.md") return "style"
  return "workflows"
}

function styleLayerForStackPath(path: string, localRoot: string, workspaceRoot: string): StackStyleLayer | undefined {
  const relativePath = relative(localRoot, path).replace(/\\/g, "/")
  if (relativePath.startsWith("style/repo/")) return "repo"
  if (relativePath.startsWith("style/org/")) return "org"
  if (relativePath.startsWith("style/")) return "app"
  return undefined
}

function guidanceIdFor(
  path: string,
  rootPath: string,
  origin: StackGuidanceOrigin,
  styleLayer?: StackStyleLayer,
): string {
  const relativePath = relative(rootPath, path).replace(/\\/g, "/")
  const base = stripMarkdownExtension(relativePath)
  if (origin === "personal") return `personal/${base}`
  if (styleLayer === "repo") {
    if (relativePath === "STYLE.md") return "repo/STYLE"
    const repoPrefix = ".stack/guidance/style/repo/"
    if (relativePath.startsWith(repoPrefix)) {
      return `repo/${stripMarkdownExtension(relativePath.slice(repoPrefix.length))}`
    }
    return `repo/${stripMarkdownExtension(basename(path))}`
  }
  if (styleLayer === "org") return `org/${base}`
  if (styleLayer === "app") return `app/${base}`
  return base
}

function styleLayerMatches(item: StackGuidanceItem, styleLayer: StackStyleLayer | undefined): boolean {
  return !styleLayer || item.styleLayer === styleLayer
}

function scopeMatches(item: StackGuidanceItem, scope: StackGuidanceScope | undefined): boolean {
  return !scope || scope === "all" || item.scope === scope
}

function stripMarkdownExtension(path: string): string {
  return path.replace(/\\/g, "/").replace(/\.md$/i, "")
}
