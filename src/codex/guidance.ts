import { existsSync, readFileSync, readdirSync, type Dirent } from "node:fs"
import { basename, dirname, join, relative, resolve } from "node:path"

export type StackGuidanceScope = "style" | "records" | "workflows" | "all"
export type StackGuidanceOrigin = "stack" | "jstack" | "workspace"

export type StackGuidanceItem = {
  guidanceId: string
  title: string
  description: string
  sourcePath: string
  rootPath: string
  relativePath: string
  scope: Exclude<StackGuidanceScope, "all">
  origin: StackGuidanceOrigin
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
  options: { workspaceRoot?: string; scope?: StackGuidanceScope } = {},
): StackGuidanceItem[] {
  const items = new Map<string, StackGuidanceItem>()
  const add = (item: StackGuidanceItem) => {
    if (!scopeMatches(item, options.scope)) return
    if (!items.has(item.guidanceId)) items.set(item.guidanceId, item)
  }

  const localRoot = stackGuidanceRoot(stackRoot)
  for (const path of findMarkdownFiles(localRoot)) add(guidanceFromPath(path, localRoot, "stack"))

  for (const path of jstackGuidanceSources(stackRoot, options.workspaceRoot)) {
    if (existsSync(path)) add(guidanceFromExternalPath(path, options.workspaceRoot ?? dirname(stackRoot)))
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
  options: { workspaceRoot?: string; scope?: StackGuidanceScope; limit?: number; maxExcerptBytes?: number } = {},
): Array<StackGuidanceItem & { score: number; excerpt: string }> {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const maxExcerptBytes = options.maxExcerptBytes ?? 600
  const scored = discoverStackGuidance(stackRoot, { workspaceRoot: options.workspaceRoot, scope: options.scope })
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
  }
}

function guidanceFromPath(path: string, rootPath: string, origin: StackGuidanceOrigin): StackGuidanceItem {
  const relativePath = relative(rootPath, path)
  const guidanceId = stripMarkdownExtension(relativePath)
  const { title, description } = readMarkdownTitle(path)
  return {
    guidanceId,
    title: title ?? stripMarkdownExtension(basename(path)),
    description: description ?? "",
    sourcePath: path,
    rootPath,
    relativePath,
    scope: scopeFromRelativePath(relativePath),
    origin,
  }
}

function guidanceFromExternalPath(path: string, workspaceRoot: string): StackGuidanceItem {
  const normalized = path.replace(/\\/g, "/")
  let guidanceId = `workspace/${stripMarkdownExtension(basename(path))}`
  let scope: Exclude<StackGuidanceScope, "all"> = "style"
  let origin: StackGuidanceOrigin = "workspace"
  if (normalized.includes("/Jstack/.jstack/product/specs/stack_guidance.md")) {
    guidanceId = "jstack/product/specs/stack_guidance"
    scope = "workflows"
    origin = "jstack"
  } else if (normalized.endsWith("/specifications/tanha/references/synthstyle.md")) {
    guidanceId = "style/synthstyle-source"
  }
  const { title, description } = readMarkdownTitle(path)
  return {
    guidanceId,
    title: title ?? stripMarkdownExtension(basename(path)),
    description: description ?? "",
    sourcePath: path,
    rootPath: workspaceRoot,
    relativePath: relative(workspaceRoot, path),
    scope,
    origin,
  }
}

function jstackGuidanceSources(stackRoot: string, workspaceRoot?: string): string[] {
  const roots = unique([workspaceRoot, dirname(stackRoot), dirname(dirname(stackRoot))].filter(Boolean) as string[])
  const paths: string[] = []
  for (const root of roots) {
    paths.push(join(root, "Jstack", ".jstack", "product", "specs", "stack_guidance.md"))
    const activeSynthStyle = join(root, "backend", "specifications", "tanha", "references", "synthstyle.md")
    paths.push(
      existsSync(activeSynthStyle)
        ? activeSynthStyle
        : join(root, "specifications", "old", "tanha", "references", "synthstyle.md"),
    )
  }
  return unique(paths.map((path) => resolve(path)))
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
      .find((line) => line && !line.startsWith("#") && !line.startsWith("---") && !line.startsWith("JSTACK_HEATMAP"))
    return { title, description }
  } catch {
    return {}
  }
}

function scopeFromRelativePath(relativePath: string): Exclude<StackGuidanceScope, "all"> {
  const first = relativePath.split(/[\\/]/)[0]
  if (first === "style" || first === "records" || first === "workflows") return first
  return "workflows"
}

function scopeMatches(item: StackGuidanceItem, scope: StackGuidanceScope | undefined): boolean {
  return !scope || scope === "all" || item.scope === scope
}

function stripMarkdownExtension(path: string): string {
  return path.replace(/\\/g, "/").replace(/\.md$/i, "")
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}
