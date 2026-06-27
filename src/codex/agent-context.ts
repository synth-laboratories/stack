import { existsSync, readdirSync, type Dirent } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, join, relative, resolve } from "node:path"

export type AgentSkillRef = {
  name: string
  path: string
}

export type AgentContextSnapshot = {
  agentsMd: string[]
  discoveredSkills: AgentSkillRef[]
  injectedSkills: AgentSkillRef[]
  usedSkills: AgentSkillRef[]
}

const AGENTS_HEADER_RE = /^# AGENTS\.md instructions for (.+)$/m
const SKILL_LINE_RE = /^- ([a-z0-9-]+(?::[a-z0-9-]+)?): .+\(file: ([^)]+)\)\s*$/

export function emptyAgentContext(workspaceRoot: string): AgentContextSnapshot {
  const discoveredSkills = discoverAvailableSkills(workspaceRoot)
  return {
    agentsMd: discoverAgentsMdPaths(workspaceRoot),
    discoveredSkills,
    injectedSkills: [],
    usedSkills: [],
  }
}

export function defaultCodexHome(): string {
  const fromEnv = process.env.CODEX_HOME?.trim()
  if (fromEnv) return resolve(fromEnv)
  return join(homedir(), ".codex")
}

export function discoverAvailableSkills(workspaceRoot: string, codexHome = defaultCodexHome()): AgentSkillRef[] {
  const byPath = new Map<string, AgentSkillRef>()

  for (const root of codexSkillRoots(workspaceRoot, codexHome)) {
    for (const path of findSkillFiles(root)) {
      byPath.set(path, skillRefFromDiscoveredPath(path))
    }
  }

  for (const skill of discoverPluginSkills(join(codexHome, "plugins", "cache"))) {
    byPath.set(skill.path, skill)
  }

  return [...byPath.values()].sort((left, right) => left.name.localeCompare(right.name))
}

function codexSkillRoots(workspaceRoot: string, codexHome: string): string[] {
  const roots: string[] = []
  const seen = new Set<string>()
  const addRoot = (candidate: string) => {
    const resolved = resolve(candidate)
    if (seen.has(resolved) || !existsSync(resolved)) return
    seen.add(resolved)
    roots.push(resolved)
  }

  addRoot(join(codexHome, "skills"))

  let current = resolve(workspaceRoot)
  const stop = resolve(homedir())
  while (current.startsWith(stop) || current === stop) {
    addRoot(join(current, ".codex", "skills"))
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  return roots
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
    if (entry.isDirectory()) {
      walkSkillRoot(full, results)
      continue
    }
    if (entry.isFile() && entry.name === "SKILL.md") {
      results.push(full)
    }
  }
}

const PLUGIN_SKILL_PATH_RE = /\/plugins\/cache\/[^/]+\/([^/]+)\/([^/]+)\/skills\/([^/]+)\/SKILL\.md$/

function discoverPluginSkills(cacheRoot: string): AgentSkillRef[] {
  if (!existsSync(cacheRoot)) return []
  const byKey = new Map<string, { version: string; skill: AgentSkillRef }>()
  for (const path of findSkillFiles(cacheRoot)) {
    const parsed = parsePluginSkillPath(path)
    if (!parsed) continue
    const key = `${parsed.plugin}:${parsed.skill}`
    const existing = byKey.get(key)
    if (!existing || parsed.version.localeCompare(existing.version, undefined, { numeric: true }) > 0) {
      byKey.set(key, { version: parsed.version, skill: { name: key, path } })
    }
  }
  return [...byKey.values()].map((entry) => entry.skill)
}

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

function skillRefFromDiscoveredPath(path: string): AgentSkillRef {
  const pluginSkill = parsePluginSkillPath(path)
  if (pluginSkill) {
    return { name: `${pluginSkill.plugin}:${pluginSkill.skill}`, path }
  }
  return skillRefFromPath(path)
}

export function discoverAgentsMdPaths(workspaceRoot: string): string[] {
  const paths: string[] = []
  let current = resolve(workspaceRoot)
  const stop = resolve(homedir())
  while (current.startsWith(stop) || current === stop) {
    const candidate = join(current, "AGENTS.md")
    if (existsSync(candidate)) paths.push(candidate)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return paths
}

export function parseAgentContextFromSessionJsonl(text: string): Pick<
  AgentContextSnapshot,
  "agentsMd" | "injectedSkills" | "usedSkills"
> {
  const agentsMd: string[] = []
  const injectedSkills: AgentSkillRef[] = []
  let usedSkills: AgentSkillRef[] = []
  const seenAgents = new Set<string>()
  const seenInjected = new Set<string>()

  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (!record || typeof record !== "object") continue
    const event = record as Record<string, unknown>
    if (event.type !== "response_item") continue
    const payload = event.payload
    if (!payload || typeof payload !== "object") continue
    const message = payload as Record<string, unknown>

    if (message.type === "function_call" || message.type === "function_call_output") {
      const blob = [message.arguments, message.output]
        .filter((part): part is string => typeof part === "string")
        .join("\n")
      if (blob.includes("SKILL.md")) {
        usedSkills = noteUsedSkillsFromText(blob, usedSkills)
      }
      continue
    }

    if (message.type !== "message") continue
    const content = message.content
    if (!Array.isArray(content)) continue

    for (const part of content) {
      if (!part || typeof part !== "object") continue
      const textPart = (part as Record<string, unknown>).text
      if (typeof textPart !== "string") continue

      const agentsMatch = textPart.match(AGENTS_HEADER_RE)
      if (agentsMatch?.[1] && !seenAgents.has(agentsMatch[1])) {
        seenAgents.add(agentsMatch[1])
        agentsMd.push(agentsMatch[1])
      }

      if (!textPart.includes("### Available skills")) continue
      const block = textPart.split("### Available skills")[1]?.split("</skills_instructions>")[0] ?? ""
      for (const skill of parseSkillCatalogBlock(block)) {
        if (seenInjected.has(skill.path)) continue
        seenInjected.add(skill.path)
        injectedSkills.push(skill)
      }
    }
  }

  return { agentsMd, injectedSkills, usedSkills }
}

function parseSkillCatalogBlock(block: string): AgentSkillRef[] {
  const skills: AgentSkillRef[] = []
  for (const line of block.split("\n")) {
    const match = line.trim().match(SKILL_LINE_RE)
    if (!match?.[1] || !match[2]) continue
    skills.push({ name: match[1], path: match[2] })
  }
  return skills
}

export function skillRefFromPath(path: string): AgentSkillRef {
  const normalized = path.replace(/\\/g, "/")
  if (normalized.endsWith("/SKILL.md")) {
    return { name: basename(dirname(normalized)), path: normalized }
  }
  return { name: basename(normalized), path: normalized }
}

export function noteUsedSkillsFromText(text: string, usedSkills: AgentSkillRef[]): AgentSkillRef[] {
  const normalized = text.replace(/\\/g, "/")
  const matches = normalized.matchAll(/([^\s'"]+\/SKILL\.md)/g)
  let next = usedSkills
  for (const match of matches) {
    const path = match[1]
    if (!path || path.includes("skills_instructions")) continue
    next = upsertUsedSkill(next, skillRefFromPath(path))
  }
  return next
}

/** @deprecated use noteUsedSkillsFromText */
export function noteLoadedSkillsFromText(text: string, loadedSkills: AgentSkillRef[]): AgentSkillRef[] {
  return noteUsedSkillsFromText(text, loadedSkills)
}

export function upsertUsedSkill(usedSkills: AgentSkillRef[], skill: AgentSkillRef): AgentSkillRef[] {
  if (usedSkills.some((entry) => entry.path === skill.path || entry.name === skill.name)) {
    return usedSkills
  }
  return [...usedSkills, skill]
}

/** @deprecated use upsertUsedSkill */
export function upsertLoadedSkill(loadedSkills: AgentSkillRef[], skill: AgentSkillRef): AgentSkillRef[] {
  return upsertUsedSkill(loadedSkills, skill)
}

export function extractCodexThreadIdFromTurns(turns: ReadonlyArray<{ stdout: string }>): string | undefined {
  for (const turn of turns) {
    for (const line of turn.stdout.split("\n")) {
      if (!line.trim()) continue
      let record: unknown
      try {
        record = JSON.parse(line)
      } catch {
        continue
      }
      if (!record || typeof record !== "object") continue
      const event = record as Record<string, unknown>
      if (event.type !== "thread.started") continue
      const threadId = event.thread_id
      if (typeof threadId === "string" && threadId.trim()) return threadId.trim()
    }
  }
  return undefined
}

export function mergeAgentContext(
  current: AgentContextSnapshot,
  session: Pick<AgentContextSnapshot, "agentsMd" | "injectedSkills" | "usedSkills">,
): AgentContextSnapshot {
  return {
    agentsMd: session.agentsMd.length > 0 ? session.agentsMd : current.agentsMd,
    discoveredSkills: current.discoveredSkills,
    injectedSkills: session.injectedSkills.length > 0 ? session.injectedSkills : current.injectedSkills,
    usedSkills: mergeUsedSkills(current.usedSkills, session.usedSkills),
  }
}

function mergeUsedSkills(current: AgentSkillRef[], session: AgentSkillRef[]): AgentSkillRef[] {
  let merged = current
  for (const skill of session) {
    merged = upsertUsedSkill(merged, skill)
  }
  return merged
}

export async function resolveCodexSessionPath(threadId: string, sessionsRoot = defaultCodexSessionsRoot()): Promise<string | undefined> {
  const suffix = `${threadId}.jsonl`
  for (const dir of recentSessionDirs(sessionsRoot)) {
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      continue
    }
    const match = entries.find((entry) => entry.endsWith(suffix))
    if (match) return join(dir, match)
  }
  return undefined
}

export async function readAgentContextFromSession(
  threadId: string,
  sessionsRoot = defaultCodexSessionsRoot(),
): Promise<Pick<AgentContextSnapshot, "agentsMd" | "injectedSkills" | "usedSkills"> | undefined> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const sessionPath = await resolveCodexSessionPath(threadId, sessionsRoot)
    if (!sessionPath) {
      await sleep(attempt === 0 ? 80 : 160)
      continue
    }
    const text = await readFile(sessionPath, "utf8")
    const parsed = parseAgentContextFromSessionJsonl(text)
    if (parsed.agentsMd.length > 0 || parsed.injectedSkills.length > 0 || parsed.usedSkills.length > 0) return parsed
    await sleep(160)
  }
  const sessionPath = await resolveCodexSessionPath(threadId, sessionsRoot)
  if (!sessionPath) return undefined
  return parseAgentContextFromSessionJsonl(await readFile(sessionPath, "utf8"))
}

export function agentContextRailLineCount(snapshot: AgentContextSnapshot): number {
  return agentContextRailLines(snapshot, 80, homedir()).length
}

export function agentContextRailText(
  snapshot: AgentContextSnapshot,
  workspaceRoot: string,
  columns: number,
): string {
  return agentContextRailLines(snapshot, columns, workspaceRoot).join("\n")
}

function agentContextRailLines(snapshot: AgentContextSnapshot, columns: number, workspaceRoot: string): string[] {
  const width = Math.max(20, columns - 2)
  const lines = ["context"]
  lines.push(`agents  ${formatAgentsLine(snapshot.agentsMd, workspaceRoot, width - 8)}`)
  lines.push(`seen    ${formatSeenSkillsLine(snapshot, width - 8)}`)
  lines.push(`used    ${formatUsedSkillsLine(snapshot.usedSkills, width - 8)}`)
  return lines
}

function formatAgentsLine(paths: string[], workspaceRoot: string, maxWidth: number): string {
  if (paths.length === 0) return "—"
  const labels = paths.map((path) => shortAgentLabel(path, workspaceRoot))
  return truncateJoined(labels, " · ", maxWidth)
}

function formatSeenSkillsLine(snapshot: AgentContextSnapshot, maxWidth: number): string {
  if (snapshot.injectedSkills.length > 0) {
    const prefix = `${snapshot.injectedSkills.length} · `
    return (
      prefix +
      truncateJoined(
        snapshot.injectedSkills.map((skill) => skill.name),
        " · ",
        Math.max(8, maxWidth - prefix.length),
      )
    )
  }
  if (snapshot.discoveredSkills.length > 0) {
    return `— (${snapshot.discoveredSkills.length} on disk, not injected yet)`
  }
  return "—"
}

function formatUsedSkillsLine(skills: AgentSkillRef[], maxWidth: number): string {
  if (skills.length === 0) return "—"
  return truncateJoined(
    skills.map((skill) => skill.name),
    " · ",
    maxWidth,
  )
}

function shortAgentLabel(path: string, workspaceRoot: string): string {
  try {
    const rel = relative(workspaceRoot, path)
    if (rel && !rel.startsWith("..")) return rel
  } catch {
    // fall through
  }
  const parts = path.replace(/\\/g, "/").split("/")
  if (parts.length >= 2) return `${parts.at(-2)}/${parts.at(-1)}`
  return basename(path)
}

function truncateJoined(parts: string[], separator: string, maxWidth: number): string {
  if (parts.length === 0) return "—"
  let text = parts[0] ?? "—"
  for (const part of parts.slice(1)) {
    const next = `${text}${separator}${part}`
    if (next.length > maxWidth) {
      const remaining = parts.length - parts.indexOf(part)
      if (remaining > 1) text = `${text}${separator}… +${remaining}`
      break
    }
    text = next
  }
  if (text.length > maxWidth) text = `${text.slice(0, Math.max(0, maxWidth - 1))}…`
  return text
}

function defaultCodexSessionsRoot(): string {
  return join(homedir(), ".codex", "sessions")
}

function recentSessionDirs(sessionsRoot: string): string[] {
  const dirs: string[] = []
  const now = new Date()
  for (let dayOffset = 0; dayOffset < 3; dayOffset += 1) {
    const date = new Date(now)
    date.setDate(now.getDate() - dayOffset)
    dirs.push(
      join(
        sessionsRoot,
        String(date.getFullYear()),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0"),
      ),
    )
  }
  return dirs
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}
