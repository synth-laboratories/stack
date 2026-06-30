import { randomUUID } from "node:crypto"
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  type Dirent,
} from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join, relative, resolve } from "node:path"
import { syncOptimizersGepaSkill } from "./research-skills.js"
import { stackGlobalSkillsRoot } from "../paths.js"

export type StackSkillOrigin = "stack" | "codex" | "plugin"
export type StackSkillActor = "primary" | "monitor" | "both"

export type StackSkill = {
  skillId: string
  name: string
  title: string
  description?: string
  version?: string
  sourcePath: string
  rootPath: string
  relativePath: string
  origin: StackSkillOrigin
  owner: string
  allowedActors: StackSkillActor
  mcpExposed: boolean
}

export type StackSkillUse = {
  actorId?: string
  actorRole?: "primary" | "monitor" | "unknown"
  skillId: string
  sourcePath: string
  startedAt: string
  completedAt?: string
  durationMs?: number
  reason: "explicit_user" | "trigger_rule" | "monitor_push" | "detected_session_use"
}

export type StackSkillContextPush = {
  eventId: string
  threadId: string
  monitorActorId: string
  targetActorId: string
  skillId: string
  sourcePath: string
  reason: string
  evidenceEventIds: string[]
  messageId: string
  message: string
  createdAt: string
}

type SkillFrontmatter = {
  name?: string
  title?: string
  description?: string
  version?: string
  owner?: string
  allowed_actors?: string
  allowedActors?: string
  mcp_exposed?: boolean | string
  mcpExposed?: boolean | string
}

export function defaultCodexHome(): string {
  const fromEnv = process.env.CODEX_HOME?.trim()
  if (fromEnv) return resolve(fromEnv)
  return join(homedir(), ".codex")
}

export function bundledStackSkillsRoot(stackRoot: string): string {
  return join(stackRoot, ".codex", "skills")
}

export function stackSkillsRoot(_stackRoot?: string): string {
  return stackGlobalSkillsRoot()
}

export function stackSkillContextPushLogPath(stackRoot: string): string {
  return join(stackSkillsRoot(stackRoot), "context-pushes.jsonl")
}

export function syncBundledStackSkills(stackRoot: string): string[] {
  const bundledRoot = bundledStackSkillsRoot(stackRoot)
  const consolidatedRoot = stackSkillsRoot(stackRoot)
  if (!existsSync(bundledRoot)) return []
  mkdirSync(consolidatedRoot, { recursive: true })

  const synced: string[] = []
  for (const entry of readdirSync(bundledRoot, { withFileTypes: true })) {
    if (entry.isFile()) continue
    const source = resolve(join(bundledRoot, entry.name))
    if (!existsSync(join(source, "SKILL.md"))) continue
    const target = join(consolidatedRoot, entry.name)
    if (!linkPointsTo(source, target)) {
      replacePath(target)
      symlinkSync(source, target)
    }
    synced.push(entry.name)
  }
  return synced.sort()
}

export function ensureStackSkills(stackRoot: string, _codexHome = defaultCodexHome()): string[] {
  const bridged = syncOptimizersGepaSkill(stackRoot)
  const synced = syncBundledStackSkills(stackRoot)
  return [...new Set([...synced, ...bridged])].sort()
}

export function discoverStackSkills(
  stackRoot: string,
  options: { workspaceRoot?: string; codexHome?: string; includeCodexHome?: boolean; includePlugins?: boolean } = {},
): StackSkill[] {
  const codexHome = options.codexHome ?? defaultCodexHome()
  const byKey = new Map<string, StackSkill>()
  const add = (skill: StackSkill) => {
    const existing = byKey.get(skill.skillId)
    if (!existing || originRank(skill.origin) < originRank(existing.origin)) byKey.set(skill.skillId, skill)
  }

  for (const path of findSkillFiles(stackSkillsRoot(stackRoot))) {
    add(skillFromPath(path, stackSkillsRoot(stackRoot), "stack"))
  }

  if (options.includeCodexHome !== false) {
    for (const path of findSkillFiles(join(codexHome, "skills"))) {
      add(skillFromPath(path, join(codexHome, "skills"), "codex"))
    }
  }

  if (options.workspaceRoot) {
    let current = resolve(options.workspaceRoot)
    const stop = resolve(homedir())
    while (current.startsWith(stop) || current === stop) {
      for (const path of findSkillFiles(join(current, ".codex", "skills"))) {
        add(skillFromPath(path, join(current, ".codex", "skills"), "codex"))
      }
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
  }

  if (options.includePlugins !== false) {
    for (const path of findSkillFiles(join(codexHome, "plugins", "cache"))) {
      const parsed = parsePluginSkillPath(path)
      if (!parsed) continue
      add(skillFromPath(path, dirname(dirname(dirname(path))), "plugin", `${parsed.plugin}:${parsed.skill}`))
    }
  }

  return [...byKey.values()].sort((left, right) => left.skillId.localeCompare(right.skillId))
}

export function readStackSkill(
  stackRoot: string,
  skillId: string,
  options: { workspaceRoot?: string; maxBytes?: number } = {},
): { skill: StackSkill; content: string; truncated: boolean } | undefined {
  const skill = discoverStackSkills(stackRoot, { workspaceRoot: options.workspaceRoot }).find(
    (item) => item.skillId === skillId || item.name === skillId || item.sourcePath === skillId,
  )
  if (!skill) return undefined
  const maxBytes = options.maxBytes ?? 50_000
  const buffer = readFileSync(skill.sourcePath)
  const truncated = buffer.byteLength > maxBytes
  return {
    skill,
    content: buffer.subarray(0, Math.max(0, maxBytes)).toString("utf8"),
    truncated,
  }
}

export function searchStackSkills(
  stackRoot: string,
  query: string,
  options: { workspaceRoot?: string; limit?: number } = {},
): StackSkill[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const scored = discoverStackSkills(stackRoot, { workspaceRoot: options.workspaceRoot })
    .map((skill) => ({ skill, score: scoreSkill(skill, terms) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.skill.skillId.localeCompare(right.skill.skillId))
  return scored.slice(0, options.limit ?? 20).map((entry) => entry.skill)
}

export function pushSkillContext(
  stackRoot: string,
  input: {
    threadId: string
    monitorActorId: string
    targetActorId: string
    skillId: string
    reason: string
    evidenceEventIds?: string[]
    message?: string
    workspaceRoot?: string
  },
): StackSkillContextPush {
  const read = readStackSkill(stackRoot, input.skillId, { workspaceRoot: input.workspaceRoot, maxBytes: 1 })
  if (!read) throw new Error(`unknown skill: ${input.skillId}`)
  const event: StackSkillContextPush = {
    eventId: `skillpush_${randomUUID()}`,
    threadId: input.threadId,
    monitorActorId: input.monitorActorId,
    targetActorId: input.targetActorId,
    skillId: read.skill.skillId,
    sourcePath: read.skill.sourcePath,
    reason: input.reason,
    evidenceEventIds: input.evidenceEventIds ?? [],
    messageId: `skillmsg_${randomUUID()}`,
    message: input.message ?? defaultSkillPushMessage(read.skill, input.reason),
    createdAt: new Date().toISOString(),
  }
  const logPath = stackSkillContextPushLogPath(stackRoot)
  mkdirSync(dirname(logPath), { recursive: true })
  appendFileSync(logPath, `${JSON.stringify(event)}\n`)
  return event
}

export function skillToJson(skill: StackSkill): Record<string, string | boolean> {
  return {
    skill_id: skill.skillId,
    name: skill.name,
    title: skill.title,
    description: skill.description ?? "",
    version: skill.version ?? "",
    source_path: skill.sourcePath,
    root_path: skill.rootPath,
    relative_path: skill.relativePath,
    origin: skill.origin,
    owner: skill.owner,
    allowed_actors: skill.allowedActors,
    mcp_exposed: skill.mcpExposed,
  }
}

function skillFromPath(path: string, rootPath: string, origin: StackSkillOrigin, forcedId?: string): StackSkill {
  const content = readFileSync(path, "utf8")
  const frontmatter = parseSkillFrontmatter(content)
  const dirName = basename(dirname(path))
  const name = frontmatter.name ?? forcedId ?? dirName
  const skillId = forcedId ?? name
  return {
    skillId,
    name,
    title: frontmatter.title ?? name,
    description: frontmatter.description,
    version: frontmatter.version,
    sourcePath: path,
    rootPath,
    relativePath: relative(rootPath, path),
    origin,
    owner: frontmatter.owner ?? (origin === "stack" ? "stack" : origin),
    allowedActors: normalizeAllowedActors(frontmatter.allowedActors ?? frontmatter.allowed_actors),
    mcpExposed: normalizeBoolean(frontmatter.mcpExposed ?? frontmatter.mcp_exposed, true),
  }
}

function parseSkillFrontmatter(content: string): SkillFrontmatter {
  if (!content.startsWith("---\n")) return {}
  const end = content.indexOf("\n---", 4)
  if (end < 0) return {}
  const result: SkillFrontmatter = {}
  for (const line of content.slice(4, end).split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line)
    if (!match?.[1]) continue
    const key = match[1] as keyof SkillFrontmatter
    const raw = (match[2] ?? "").trim()
    result[key] = unquote(raw) as never
  }
  return result
}

function unquote(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

function normalizeAllowedActors(value: string | undefined): StackSkillActor {
  if (value === "primary" || value === "monitor" || value === "both") return value
  return "both"
}

function normalizeBoolean(value: string | boolean | undefined, fallback: boolean): boolean {
  if (typeof value === "boolean") return value
  if (value === "true") return true
  if (value === "false") return false
  return fallback
}

function scoreSkill(skill: StackSkill, terms: string[]): number {
  if (terms.length === 0) return 1
  const haystack = [
    skill.skillId,
    skill.name,
    skill.title,
    skill.description ?? "",
    skill.owner,
    skill.relativePath,
  ].join(" ").toLowerCase()
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0)
}

function defaultSkillPushMessage(skill: StackSkill, reason: string): string {
  return [
    `Use skill ${skill.skillId}.`,
    `Reason: ${reason}.`,
    `Source: ${skill.sourcePath}.`,
    "Read the skill instructions before acting, then apply only the relevant guidance.",
  ].join("\n")
}

function originRank(origin: StackSkillOrigin): number {
  if (origin === "stack") return 0
  if (origin === "codex") return 1
  return 2
}

function findSkillFiles(root: string): string[] {
  const results: string[] = []
  walkSkillRoot(root, results)
  return results
}

function walkSkillRoot(dir: string, results: string[]): void {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isSymbolicLink() && existsSync(join(full, "SKILL.md"))) {
      results.push(join(full, "SKILL.md"))
      continue
    }
    if (entry.isDirectory()) {
      walkSkillRoot(full, results)
      continue
    }
    if (entry.isFile() && entry.name === "SKILL.md") results.push(full)
  }
}

const PLUGIN_SKILL_PATH_RE = /\/plugins\/cache\/[^/]+\/([^/]+)\/([^/]+)\/skills\/([^/]+)\/SKILL\.md$/

function parsePluginSkillPath(path: string): { plugin: string; version: string; skill: string } | undefined {
  const normalized = path.replace(/\\/g, "/")
  const match = normalized.match(PLUGIN_SKILL_PATH_RE)
  if (!match) return undefined
  const plugin = match[1]
  const version = match[2]
  const skill = match[3]
  if (!plugin || !version || !skill) return undefined
  return { plugin, version, skill }
}

function linkPointsTo(source: string, target: string): boolean {
  if (!existsSync(target)) return false
  try {
    const stat = lstatSync(target)
    if (!stat.isSymbolicLink()) return false
    return resolve(readlinkSync(target)) === source
  } catch {
    return false
  }
}

function replacePath(path: string): void {
  try {
    lstatSync(path)
  } catch {
    return
  }
  rmSync(path, { recursive: true, force: true })
}
