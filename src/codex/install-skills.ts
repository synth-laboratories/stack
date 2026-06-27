import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

export function defaultCodexHome(): string {
  const fromEnv = process.env.CODEX_HOME?.trim()
  if (fromEnv) return resolve(fromEnv)
  return join(homedir(), ".codex")
}

export function bundledStackSkillsRoot(stackRoot: string): string {
  return join(stackRoot, ".codex", "skills")
}

export function installedStackSkillNames(stackRoot: string, codexHome = defaultCodexHome()): string[] {
  const bundledRoot = bundledStackSkillsRoot(stackRoot)
  if (!existsSync(bundledRoot)) return []
  return readdirSync(bundledRoot).filter((entry) => {
    const path = join(bundledRoot, entry)
    try {
      return lstatSync(path).isDirectory() && existsSync(join(path, "SKILL.md"))
    } catch {
      return false
    }
  })
}

export function ensureStackCodexSkills(stackRoot: string, codexHome = defaultCodexHome()): string[] {
  const bundledRoot = bundledStackSkillsRoot(stackRoot)
  if (!existsSync(bundledRoot)) return []

  const targetRoot = join(codexHome, "skills")
  mkdirSync(targetRoot, { recursive: true })

  const installed: string[] = []
  for (const name of installedStackSkillNames(stackRoot, codexHome)) {
    const source = resolve(join(bundledRoot, name))
    const target = join(targetRoot, name)
    if (linkPointsTo(source, target)) {
      installed.push(name)
      continue
    }
    replacePath(target)
    symlinkSync(source, target)
    installed.push(name)
  }
  return installed
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
  if (!existsSync(path)) return
  rmSync(path, { recursive: true, force: true })
}
