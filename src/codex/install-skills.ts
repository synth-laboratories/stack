import {
  bundledStackSkillsRoot,
  defaultCodexHome,
  ensureStackSkills,
  stackSkillsRoot,
  syncBundledStackSkills,
} from "./skills.js"
import { syncOptimizersGepaSkill } from "./research-skills.js"

export function installedStackSkillNames(stackRoot: string, codexHome = defaultCodexHome()): string[] {
  void codexHome
  const bundled = syncBundledStackSkills(stackRoot)
  const bridged = syncOptimizersGepaSkill(stackRoot)
  return [...new Set([...bundled, ...bridged])].sort()
}

export function ensureStackCodexSkills(stackRoot: string, codexHome = defaultCodexHome()): string[] {
  return ensureStackSkills(stackRoot, codexHome)
}

export { bundledStackSkillsRoot, defaultCodexHome, stackSkillsRoot }
